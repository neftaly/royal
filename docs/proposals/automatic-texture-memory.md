# Automatic texture memory

Status: partially implemented in the working tree, 2026-09-08. Direct-target
automatic demand, preview coverage, authoritative coarse targets, and bounded
sharing of small target rasters are implemented. RGBA atlases now start from
demand and grow through bounded GPU copies, with both allocations charged until
the swap. The root budget remains 256 MiB; the combined atlas allowance is 75%
of that budget. ETC2 retains its 32 MiB pool policy. Shrinking, redistribution
between existing pools, and automatic default-budget calibration remain
proposed.
Sections below retain the design rationale; the specification describes current
behavior. See [device findings](vt-capacity-a10-findings.md).

The final working-tree refinement uses 256px SVG pages, shared bounded target
regions, cached-page scheduling, incremental page-table additions, and a 4 ms
upload-work target starting at first admission. Atlas growth preserves columns
where legal to avoid rewriting page tables. Authored VT and ordinary-raster
page sizes/eligibility are unchanged. The A10 zoom fixture reaches its target
in about 4.1 seconds after zoom, compared with the earlier 16.1-second run.

## Objective and platform limit

Royal should automatically use additional texture capacity when it improves
visible detail, without application-specific page counts or device tables.
Small scenes should have small allocations; large scenes should be able to grow
beyond the prototype's fixed 32 MiB pool ceiling when the root budget permits.

Apple A10 is the minimum supported hardware, as specified by the project owner.
Use the existing physical A10 iPad as the baseline for default-budget, peak
allocation, and responsiveness acceptance. This hardware floor does not imply
a fixed amount of free memory or establish a minimum browser/OS version.

This cannot mean discovering and consuming all free hardware memory. WebGL
provides no portable VRAM-capacity query. Texture dimension limits describe
legal dimensions, not available bytes. MDN recommends a calibrated budget based
on rendered pixels rather than allocating as much as possible:
[WebGL memory budgeting](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#estimate_a_per-pixel_vram_budget).

Royal currently exposes `persistentGpuByteBudget`, defaulting to 256 MiB per
root. `PersistentGpuBudgetOwner.availableBytes` is the unclaimed portion of
that configured allocation estimate, not free device memory. Geometry, ordinary
textures, render targets, and VT storage share this authority. Multiple roots
have independent budgets; their sum is not currently coordinated.

There is already relevant calibration evidence in
[Royal's device benchmark notes](../../research/examples-benchmarks/README.md):
the July 20 resource-floor report records Sponza on A10/iPadOS 17.7 with a
256 MiB ceiling, 210,238,614 retained bytes, and no denied claims. A preceding
512 MiB run left WebKit unresponsive beyond the measurement window. These are
historical workload observations, not a universal failure threshold, but they
support retaining 256 MiB as the baseline rather than raising it speculatively.

## Proposed allocation contract

- Start with a bounded allocation sized to current demand, then grow in coarse
  steps when useful visible pages cannot fit. Do not allocate the maximum pool
  just because its first texture became visible.
- Let compatible pools compete for a root-wide texture allowance based on
  demand. Neither an unconditional 24-page residency limit nor an unconditional
  32 MiB per-pool ceiling should define final quality.
- Bound the combined allocations by the root budget after accounting for other
  resources and reserved headroom. Include page tables and temporary migration
  storage; a replacement atlas must not be charged only at its final size.
- Preserve explicitly authored per-texture slot and byte ceilings. Unspecified
  limits should allow a texture to use capacity assigned to its shared pool.
- Prioritize usable coverage across visible textures before finer detail; an
  already drawable model preview satisfies that coverage requirement.
  Saturation must lead to an explicit quality compromise rather than allowing
  the first admitted textures to monopolize protected pages indefinitely.
- Stop growing when useful demand is satisfied. Reuse spare resident capacity
  for recently visible detail where beneficial; reclaim idle capacity with
  hysteresis to avoid reallocations on every camera movement.
- Keep preparation and upload limits independent from allocation size. Extra
  capacity must not cause larger foreground rasterization or upload bursts.
- Report desired versus resident detail and capacity-limited demand separately
  from pending work. Zero pending jobs alone does not establish final quality.

Retain the existing root budget option as the explicit override. Choosing an
automatic default from backing-pixel count remains a calibration task, with a
hard ceiling; higher DPR is not evidence of more hardware memory. Do not infer
free memory from GPU names or deliberately allocate until failure.

## Preview directly to target detail

The project owner's requested sequence is: show a fast model-provided preview,
prepare the detail required by the current view directly, and consider likely
future needs only as optional background work. Intermediate quality levels are
not prerequisites for reaching the target.

The current `addPageWithAncestors` in `demand.ts` inserts every ancestor from
coarsest to target. `#publicationAncestorReady` in `runtime.ts` blocks a finer
read until an available ancestor is resident or intervening ancestors have
failed. Together these enforce progressive refinement even when a usable
ordinary preview already exists. Replace that requirement in the future
implementation; changing scheduling priority alone is insufficient.

Target means the set of pages and mip levels required by projected visible UV
footprints across active views, within the available budget. It need not be
one page or one mip for an entire model. Select a feasible target directly when
capacity is limited, and report any reduction from desired detail.

- Reuse the supplied preview immediately. Prepare target pages without first
  rasterizing or fetching each intermediate ancestor.
- Preserve preview coverage wherever target pages are missing, including after
  camera changes and read failures. The current automatic binding activates on
  the first resident page, and missing VT mappings return grey. Removing the
  ancestor gate alone would therefore expose holes. Either make the existing
  preview accessible to VT sampling (potentially through one preview-derived
  coarse page), or retain the ordinary binding until target coverage is safe
  to publish. Evaluate the latter against large targets and partial failures.
- If there is no usable supplied preview, establish one bounded initial
  fallback when needed for timely coverage, then go directly to the target.
  Do not create a replacement ladder of intermediate SVG decodes.
- A coarse mip that is itself the current target must ultimately use source
  authority. Preview pixels are acceptable during loading or source failure,
  but must not permanently substitute for requested target quality.
- Recompute targets on view changes; cancel or deprioritize obsolete reads.
  Already resident useful pages can remain cached without scheduling missing
  ancestors solely to complete a mip chain.
- Speculative future-view pages are optional. Admit them only when current
  visible demand is satisfied and preparation, upload, and memory allowances
  permit. They yield to input and new visible demand, are evicted first, and
  must not delay visible settlement. No prediction mechanism is required for
  the initial implementation.

This changes the earlier recommendation to require a vector-rendered coarsest
page before refinement: require authoritative pixels at the selected target,
and retain only the fallback coverage needed to present it safely.

## Page-count evaluation (2026-09-08)

Separate allocated slots, resident pages, and pages actually needed for current
target detail. The recorded A10 run has 480 allocated slots and 155 residents
across 60 automatic textures. At 132 x 132 x 4 bytes per stored page, that is
31.90 MiB allocated, 10.30 MiB occupied, and 21.60 MiB of empty slot capacity.
These figures exclude page tables and other resources. The empty capacity is
allocated storage, not evidence that 480 pages were decoded. The resident total
alone does not identify how many of the 155 pages are needed by visible targets.

Code review establishes these sources of excess work:

- Every requested target currently includes its ancestors. For a fully covered
  square mip with 16 target pages, its 4-page parent and 1-page root increase
  residency to 21; 64 target pages become 85. For a single fine tile of a large
  texture, the chain can cost several ancestors per target. A direct-target
  design may still need one preview-derived fallback, so removing the ladder
  does not necessarily remove all ancestor storage. These are analytical
  examples of the algorithm, not a measured decomposition of the A10 scene.
- `addClampedRange` requests a rectangular UV page range for each clipped
  triangle or subdivided triangle. It does not test triangle/page intersection.
  That can include untouched tiles for diagonal or narrow triangles. The union
  of two triangles forming a fully visible rectangular card can legitimately
  need the full range, so this does not establish waste for every card.
- Demand collection clips to the view frustum but does not reject geometry
  occluded by other objects or apply material-aware backface rejection. Hidden
  stack contents can therefore create demand. Quantify this before adding an
  occlusion mechanism whose cost could outweigh savings on A10.
- Perspective demand uses the finest sampled mip within each bounded
  subdivision. It is conservative and can request detail unnecessary for part
  of a triangle. The collector's derivative-based mip formula matches the
  shader's choice in form; there is no obvious unconditional finer-mip bias
  justifying a global quality reduction.

The 128px page size is not yet shown to be wrong. Its 2px gutters add 6.35%
storage over the interior. Larger pages reduce job counts but increase minimum
allocation and overfetch for small visible regions; smaller pages do the
opposite. Keep 128px as the comparison baseline while measuring total bytes,
rasterization time, and time to target, not just page count. The 16,384px SVG
logical extent describes available detail; it does not cause a full-size
bitmap or every mip to be decoded eagerly.

Evaluate direct-target demand before raising capacity further. Add a durable
measurement that separates target, fallback-only, cached, and speculative pages
per texture/mip, plus desired demand dropped by capacity or the collector's
512-page workspace bound. Ancestors can also consume that bound today. Compare
isolated cards, partially visible cards, and opaque stacks to distinguish
necessary target coverage from conservative visibility estimates. Current
demand tests pass (10 tests), but do not establish optimal page counts or the
actual visible-target fraction of the recorded 155 residents.

## Reuse small target rasters

The page source already retains `EncodedSvgTextureSource.parsed`; keeping the
SVG document in memory is implemented. However, `rasterizeSvgRegion` deep-clones
that document, changes the viewport, serializes a new SVG Blob, and asks the
browser to decode it for each region. The clamp optimization reduces this to
one decode per page, but does not share rasterization across neighboring pages.
The browser receives a new serialized image each time; its internal parsing
and rasterization costs have not been isolated in the recorded profiles.

Evaluate a bounded shared raster at the requested target resolution when the
whole target image is small and multiple demanded pages can reuse it. Rasterize
once, then crop pages and generate gutters from those pixels. For orientation,
256-square RGBA8 pixels occupy 256 KiB and 512-square pixels occupy 1 MiB,
excluding browser overhead and page copies. A 512-square target spans sixteen
128px interior pages; this offers a possible reduction from sixteen region
decodes to one whole-target decode. It is not a measured speedup, and a large
or sparsely visible texture should retain region rasterization.

Choose this path using target pixel dimensions, expected reuse, aggregate
decoded bytes, and measured job duration, not SVG file size alone. A small
output can still contain expensive vector artwork. Do not rasterize the
16,384px logical maximum for a small on-screen target, recreate the intermediate
mip ladder, or require the shared raster before showing the supplied preview.

First evaluate sharing only across the current target batch. Longer retention
is a separate cache decision: bound its total bytes, deduplicate in-flight work
by source generation and raster recipe, reference-count active users, and evict
unused entries explicitly. Close image resources on eviction and cancellation;
GC timing must not govern the cache budget. Source replacement, context loss,
and concurrent pages must not retain stale pixels or close shared pixels early.
Include temporary whole rasters and derived pages in admission accounting.

A browser image/canvas handle must not be described as guaranteed ordinary
CPU-only memory. If explicitly CPU-addressable storage is needed, RGBA8
[ImageData exposes a typed pixel array](https://developer.mozilla.org/en-US/docs/Web/API/ImageData/data),
but obtaining and copying those pixels may add readback cost. Compare that
with a temporary browser-managed raster. Explicit
[ImageBitmap.close()](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap/close)
releases its graphical resources. Neither representation makes retained image
memory free merely because Royal has not uploaded it to its own atlas.

Existing findings constrain this experiment:

- [Preview verification](../../research/svg-preview/README.md) establishes
  preview/failure/restoration behavior and bounded admission, not comparative
  whole-target versus per-region rasterization performance.
- [Preview-first findings](preview-first-svg-refinement.md) explicitly caution
  that unattributed native `(program)` time is not proof of SVG decode cost.
- The July 14 Safari Tiger entry in the device benchmark notes reports
  origin-unclean pixels when repainting the same SVG through Canvas 2D in that
  older implementation. Retest the proposed raster representation on current
  A10 Safari; do not assume this historic result rules out every bitmap path.
- [Pathfinder research](../../research/pathfinder-svg/README.md) evaluates path
  extraction with only its custom JS adapter executable. Its alternative
  backend recommendations are not a measured replacement rasterizer result.

Benchmark direct-target region rendering against shared small-target rendering
after removing mandatory intermediate levels. Record clone/serialization time,
decode duration, crop/copy time, first target publication, peak decoded bytes,
and A10 input/frame gaps. Verify alpha, color, non-square framing, SVG effects,
gutters, origin cleanliness, failures, and cancellation. Preserve browser SVG
semantics and the existing source validation contract in both paths.

## Implementation boundary

The runtime currently allocates each atlas once with `texStorage2D`, and its
bindings and page tables assume one atlas per compatible pool. Automatic growth
therefore requires an allocation lifecycle, not just removing a constant.

Evaluate replacement-atlas migration first because it can preserve that binding
model. Specify admission for simultaneous old/new storage, bounded copying or
repopulation, page-table publication, and retirement of the old texture. Keep
existing coverage drawable until replacement coverage is usable. If temporary
headroom is unavailable, retain current capacity and report the limitation;
avoid repeated unsuccessful allocation attempts. Segmented storage is an
alternative only if migration costs justify changes to bindings and shaders.

Ordinary textures and other pools must be able to obtain headroom after VT has
grown. Define reclamation and allocation-failure behavior before claiming that
automatic growth can use the root's remaining allowance reliably.

## Prototype disposition

Review the existing work in separate units:

1. Authoritative pixels at the current target, background detail scheduling,
   and failure handling: general correctness fixes. Reuse the coarse SVG path
   when coarse is the target, without making it a mandatory refinement stage.
2. Single-decode SVG regions and gutters: retain the implementation, but verify
   browser pixels for non-square images, boundary pages, and wrap modes.
3. Progress notifications without unnecessary redraw: verify the actual root
   presents stationary refinement and eventually stops scheduling frames.
4. Atlas capacity: retain the 32 MiB experiment as evidence, then implement the
   allocation contract above independently. Do not present the fixed eager
   allocation as automatic memory adaptation.

No wholesale renderer rewrite is proposed. Probability import and persistence
measurements remain historical workload evidence, not renderer requirements.

## Acceptance evidence

Use durable synthetic fixtures with one small texture, more than 24 visible
textures, multiple incompatible pools, and demand exceeding the root allowance.
Exercise camera movement, shrinking demand, small texture-dimension limits,
allocation denial, context restoration, and disposal. Verify explicit authored
limits and peak migration accounting as well as final retained bytes.

For preview-backed textures, assert that initial requests contain target pages
and at most the preview-derived fallback needed by the chosen binding design,
with no mandatory intermediate source mips. Verify uninterrupted coverage during
partial target arrival, target changes, and failures. Include targets spanning
multiple pages/mips, coarse-only targets, sources without previews, and visible
work arriving while speculative work is pending. Measure time to target and
total decoded/uploaded bytes against the existing ancestor ladder on A10.

Browser coverage must establish pixel correctness and stationary presentation,
not merely mocked draw calls or repeated manual runtime updates. Device runs
must report refinement time, frame/input responsiveness, baseline and peak
allocation estimates, and quality under saturation. Compare small and large
scenes on the minimum-supported A10 device and representative newer mobile and
desktop hardware before selecting growth thresholds or changing default
budgets. Include sustained use and repeated scene changes on A10, not just a
stationary import. The current A10 observations establish a capacity problem;
they do not establish hitch-free growth or a universally suitable memory cap.
