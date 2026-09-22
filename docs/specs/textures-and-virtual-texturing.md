# Textures and virtual texturing

Royal derives virtual-texture pages from ordinary decoded image sources. There is no public authored-page or manifest input.

## Canonical texture semantics

Royal has one authored texture orientation: upper-left source origin. Ordinary
images, glTF images, and generated VT pages
MUST produce the same visible U/V orientation. Upload-time or ingestion-time
normalization happens once; there is no public `flipY` policy and no shader path
may compensate differently by source kind.

Color textures decode from sRGB and sample into scene-linear values. Data
textures remain linear. Alpha semantics MUST remain consistent across ordinary
and virtual representations. A representation change MUST NOT visibly flip,
re-color, or re-premultiply content.

Samplers support nearest/linear mip filters and clamp/repeat/mirrored-repeat.
VT page gutters and addressing MUST reproduce the authored sampler at page
boundaries, including non-power-of-two dimensions.

## Canonical prepared representation

Source format is cold-path ingestion data. Every accepted complete texture
source—whether browser-decoded PNG/JPEG/WebP/AVIF, offline native KTX2, a
buffer view, a data URI, or a future decoder—MUST lower to one prepared texture
upload contract containing semantic storage class, dimensions, mip slices,
row/block layout, color/alpha interpretation, and reconstruction identity. This
sentence does not add a format to glTF or promise that every browser decodes it.
Resource reconciliation consumes the contract; material binding and draw
submission MUST NOT branch on source file format.

A VT page is a scheduled raster region derived from the retained decoded source. Its page source owns rasterization; the runtime owns demand, residency, and GPU publication.

Royal standardizes on the portable ETC2/EAC family for retained GPU-compressed
WebGL2 data. It does not force every texture into one physical format. The
canonical storage classes are deliberately few:

- color with alpha: sRGB or linear ETC2 RGBA, with RGBA8 fallback;
- two-channel data/normal: EAC RG where encodable, with RG8 fallback;
- scalar data: EAC R where encodable, with R8 fallback;
- HDR/environment: the explicit HDR representation required by that pipeline.

Opaque color MAY use a smaller RGB representation when alpha absence is proven
before upload. A complete authored mip chain may remain GPU-compressed. A direct
compressed source that is incomplete for its sampler or otherwise incompatible
fails during preparation rather than inventing a transcode or branching during
drawing. Browser-decoded AVIF/WebP is not automatically GPU compressed and
enters an uncompressed plan unless an offline container supplies blocks.

Offline native ASTC LDR 6x6/8x8 and BC1 RGBA/BC3/BC7 MAY use the same
compressed path behind WebGL capability checks. Format choice is authored;
Royal does not encode browser images or automatic VT pages
into block-compressed storage at runtime. Native format measurements and
limitations are recorded in `research/native-texture-formats/README.md`.

## Ordinary texture lifecycle

Decoded content identity is source or `contentKey` plus version. A logical
texture binding additionally includes color interpretation and sampler state.
Fetch/decode is shared by decoded content identity; GPU representation and
allocation remain root/context-owned. Sampling state MUST NOT change decoded
content identity even while the current backend includes it in an upload or
binding cache key.

Material rendering is progressive. Before color content is available, neutral
50% grey SHOULD be used for perceptual color where no semantic white/black
identity is required. Data inputs use their neutral material value: flat normal,
no occlusion, no emissive contribution, and factor-preserving metallic/roughness.
Failure placeholders MUST be stable and non-flashing; conspicuous debug colors
belong in explicit diagnostics, not ordinary presentation.

Decoded raster sources MAY be retained for context restoration or an active
automatic-VT representation only within CPU budget. Eviction MUST leave a reconstruction recipe or legal refetch path.

Ordinary texture allocation redistributes unused shares from decoded small
sources to larger sources. Every claimed color-space storage representation
counts toward the allocation; unknown sources retain a fair share until decoded.
Finite per-representation allocations are capped at a 64 MiB mip-chain budget,
keeping raster base pixels within the existing VT CPU-source and inspection
limits. A fitted source can be decoded again when returned budget restores detail;
its replacement passes the same inspection gate before publication. Automatic
pages derive from that retained raster, never from a new vector rendering.
Once an automatic VT root is resident, ordinary raster storage used exclusively
by virtual base-color maps is reduced to a 512-pixel-long-edge fallback. Shared
non-VT material-map uses retain full storage. Approved source pixels stay alive
until paging and full-storage restoration no longer need them. VT therefore
saves steady-state GPU storage; the decoded source and transient initial full
upload still have memory costs.

When the persistent budget requires a smaller ordinary PNG/JPEG/WebP/AVIF,
Royal reads a bounded encoded-header prefix through a pure, non-authoritative
dimension parser and asks the browser to decode directly to the selected fitted
size. Fixed-header PNG and WebP reads stop at 24 and 30 bytes respectively;
JPEG reads stop at 16 KiB, while AVIF and missing-MIME container reads stop at
128 KiB. AVIF dimensions are accepted only from the primary item's associated
BMFF spatial property; Royal does not scan for plausible width/height bytes.
Malformed, truncated, unsupported, or unusually deep headers fall back to the
browser-authoritative decode-then-fit path. The hint cannot expand an image,
change aspect ratio, accept a format, or bypass browser validation; it avoids a
second full decoded bitmap only when the same budget decision is known early.

Browser decode prefers `createImageBitmap` with a direct fitted resize. When
that API is absent or rejects an otherwise browser-decodable source, the DOM
image/canvas path MUST apply the same fitted storage plan and preserve the
original source dimensions. Capability detection is behavioral; user-agent or
engine-name branching is not part of the texture contract.

Ordinary images used by pickable `MASK` materials additionally retain one
8-bit alpha plane at the already fitted upload dimensions. When their sampler
uses mipmaps, they retain a complete deterministic alpha-only box pyramid; a
square power-of-two pyramid costs less than one third again the base alpha
plane, and arbitrary dimensions remain below twice the base plane. This demand is
keyed by decoded content, shared across color interpretations and samplers, and
is absent for ordinary opaque/blended textures and authoritative picking
proxies. Browser images use a transient canvas RGBA readback only during
demanded decode. Offline ETC2 RGBA decodes only each demanded authored EAC alpha
mip into that same one-byte-per-texel representation; RGB remains compressed
and no GPU readback occurs. Non-mipmapped samplers retain only the base plane.
The upload source is released after GPU upload. Removing the final mask claim
releases the alpha pyramid. Decode failure keeps the visible/pick fallback
opaque rather than inventing a cutout.

Automatic VT may retain decoded pixels beyond ordinary GPU upload. A new mask
claim MUST NOT wait for that representation lease to end: auxiliary alpha
preparation preserves the leased source and releases its own temporary pixels
when the alpha plane is published or discarded.

### Direct offline native KTX2 subset

An ordinary `textureAsset` or `imageTexture` URI ending in `.ktx2`, or served as
`image/ktx2`, enters the same root-owned texture lifecycle as a browser image.
Royal accepts only two-dimensional, non-array, single-face, unsupercompressed
KTX2 in one of these native formats (linear/sRGB Vulkan enums): ETC2 RGBA
151/152, ASTC LDR 6x6 165/166, ASTC LDR 8x8 171/172, BC1 RGBA 133/134,
BC3 RGBA 137/138, or BC7 RGBA 145/146. An internal `ktx2-native` source marker
also supports opaque transport URLs; `ktx2-etc2` remains an exact ETC2 claim.
The declared format
MUST match the asset color-space request. Level storage is bounds-, size-,
alignment-, and overlap-validated before publication, and upload borrows the
level byte views without a second block copy. Orientation is absent/default
`rd` or explicitly `rd`, swizzle is absent/identity `rgba`, and premultiplied
alpha descriptors are rejected so this path cannot violate Royal's canonical
upper-left, straight-alpha contract.

A mipmapped sampler requires a complete authored pyramid. Under a per-texture
storage ceiling, Royal MAY drop the largest authored levels and rebase a
complete remaining suffix; it never resamples compressed texels or calls
`generateMipmap` for this path. BC base levels, including a rebased suffix,
MUST have dimensions divisible by four; later BC levels are restricted to
1, 2, or multiples of four. Exact compressed bytes, not an RGBA estimate,
participate in the persistent GPU budget. This direct storage profile is not a
glTF extension. `KHR_texture_basisu` is a separate official glTF delivery
contract and remains unsupported because Royal ships no Basis runtime
transcoder. Direct ETC2 upload additionally requires the root to enable
`WEBGL_compressed_texture_etc`; unsupported direct Royal KTX2 sources fail
explicitly before upload. ASTC requires the extension's LDR profile; BC1/BC3
require S3TC (the separate sRGB extension for sRGB), and BC7 requires BPTC.
An unsupported native source settles as a local texture error, releases its
preparation/handoff reservation, and uses the neutral material-slot fallback;
it does not throw out of rendering or block other textures. Custom decoded
native sources receive an empty GPU binding if unsupported. Capability caches
are cleared on context loss.

Native ASTC/BC remain unsupported for retained CPU alpha queries: a pickable
MASK source requiring exact alpha fails preparation coherently instead of
adding a software block decoder or inventing alpha. Use ETC2/raster storage or
an explicit picking proxy for that case. GPU blending uses native alpha normally.
ASTC HDR, other ASTC footprints, BC1 RGB, BC2/BC4/BC5/BC6H, supercompression,
and ETC1S/UASTC transcoding are outside this direct LDR profile.

## Representation choice

Automatic VT is selected for eligible ordinary sources. The current raster policy
considers base-color triangle textures whose decoded
RGBA texel count exceeds the default 24-slot atlas payload and whose longest
edge spans more than two 128-texel pages. This prevents the representation from
costing more GPU storage than the ordinary image it replaces.

Representation choice is sticky for one capability/content generation. Royal
MUST NOT oscillate ordinary/virtual strategies frame by frame. Context
restoration MAY choose a new representation revision after capabilities are
re-evaluated.

Automatic VT is progressive: the ordinary texture remains the drawable source
until generated VT coverage is valid. Transition occurs through one material
binding policy and MUST NOT expose an uninitialized page table, white frame, or
debug-color frame.

## Demand and coverage

Demand derives from actual projected textured coverage across every render
view. Close inspection, oblique surfaces, large ground planes, UV transforms,
repeated wrapping, partial clipping, geometry crossing the near plane, stereo
eyes, and camera motion are required stress cases.

Demand MUST be conservative enough that a visible fragment can resolve to a
resident page or ancestor. It MUST be bounded by visible geometry and quality
policy; it MUST NOT request the whole virtual texture merely because one draw is
visible. Degenerate or non-finite projections must fall back safely without
unbounded demand.

Perspective-varying triangles use bounded demand-only subdivision when sampled
mip requirements differ. Each leaf requests its observed mip range;
the subdivision never mutates or tessellates rendered geometry. Four fixed
levels and caller-owned numeric scratch bound CPU, memory, and stack work while
preventing a far corner of a two-triangle ground plane from forcing its close
region to an unnecessarily coarse mip. Near-plane clipping happens before this
analysis and uses the same path.

The coarsest usable ancestor SHOULD be requested first. A finer page MUST NOT be
published to the page table until its atlas upload is complete. Missing fine
pages sample the closest resident ancestor. Added pages patch only their
affected descendants in the CPU table, preserving finer resident mappings;
eviction and changes to atlas columns require a full rebuild.

When current demand exceeds physical capacity, Royal coarsens direct automatic
targets until the
retained working set fits. It does not keep an arbitrary
spatial prefix at fine detail, because a stable uniformly coarser image is
preferred to a hard moving boundary between sharp and ancestor-resolved areas.

The GPU page table is one mipmapped `RGBA8` texture. Its base page grid is
padded to power-of-two dimensions so every ceil-divided logical grid fits the
corresponding WebGL mip level; unused cells remain invalid. Sampling selects
the desired mip with derivatives. Each mip lookup uses an explicit-level
page-table fetch and an atlas fetch, with an optional base-table fallback during
zoom-out. Linear mip filters blend two adjacent virtual mips; automatic demand
requests that adjacent mip and the coarsest fallback without loading the entire
ancestor chain. Other filters retain single-mip selection. This avoids dynamic
uniform-array indexing. Publication uploads each retained table level after an atlas
batch, trading a few cold driver calls and bounded padding bytes for the smaller
Quest/Safari fragment path. All padded storage is charged to the VT GPU and
per-frame upload budgets.

Root texture anisotropy defaults to 16, capped by device support. Ordinary
textures use the extension's sampler parameter. Virtual textures instead select
LOD from the pixel footprint's minor ellipse axis, widened to respect that cap,
and average at most 16 taps along its major axis. Each tap wraps the authored UV
and resolves its own page before a level-zero atlas fetch. Hardware anisotropy
on an atlas sampler is not used: neighbouring physical slots need not represent
neighbouring virtual pages. CPU demand uses the same footprint calculation and
includes the tap extent when splitting wrapped UV ranges. Existing residency
budgets and complete-level coarsening still apply. At anisotropy 1, or for nearest
filtering, the existing isotropic LOD and single-tap path remain in use.

Scene publication indexes each VT resource directly to its canonical demand
surfaces. Per-frame demand MUST NOT rescan unrelated surfaces once per resource.
Each ordered view computes one retained frustum broad phase for all of those
surfaces. Canonical world bounds reject off-screen surfaces before triangle
clipping; surfaces that survive still use exact clipped projected coverage, so
the broad phase cannot reduce visible demand.
Instanced surfaces additionally test each affine-transformed local bound against
that retained frustum before visiting its triangles. One retained bounds
workspace avoids per-instance allocation, and exact clipped coverage remains authoritative for
every surviving instance.
Projected vertices use a fixed 256-entry cache reset for each model and view;
cache collisions cannot reuse another vertex's coordinates. Constant-W
triangles need one derivative sample, while perspective-varying triangles keep
the bounded sampling/subdivision path. CPU demand remains linear in surviving
triangles and does not infer depth occlusion.
Atlas uploads admitted in one resource/frame batch normally publish through one
complete page-table revision and one lifecycle notification after every
successful atlas write. A failed overwrite may publish an immediate repair
revision only to remove the now-invalid old slot mapping; failed or partial
page bytes never receive a logical mapping.

At very close range, required detail is capped by source resolution, configured
quality, hardware limits, and budgets rather than by an arbitrary camera
distance. Near-plane clipping is camera geometry, not a VT quality policy.

## Raster page sources

Automatic virtual texturing MUST be enabled for every root without an opt-in
option. Eligibility, visible demand, CPU/GPU budgets, and coverage govern
representation selection; small raster images may remain ordinary textures.

Raster automatic VT may decode one source image and crop/downsample requested
pages. It MUST account for the retained decoded source against ordinary texture
CPU ownership as well as report it in VT diagnostics; the same bytes are not
two independent allocations. The current root retains at most 64 MiB of such
decoded raster sources for automatic VT; candidates beyond that ceiling remain
on the ordinary texture path instead of stalling the shared decode queue.

Explicit low-resolution ASTC previews for full raster sources use the
[private raster-preview contract](raster-texture-previews.md). Unmarked ASTC
alternatives remain final textures.

When automatic VT has a drawable ordinary preview and parallel shader
compilation is available, its non-transmission detail variant may link while
that preview remains visible. Until completion, the renderer MUST retain
ordinary bindings and matching shader features, poll only nonblocking
completion status, and schedule another presentation frame. Completion MUST
publish the VT variant without requiring a camera or asset update. Pending
variants are discarded on shader-source replacement, disposal, and context
loss. Devices without the parallel compilation extension compile synchronously.

Automatic raster sources use 128px pages with 2px gutters.

## Residency and eviction

Atlas allocation is transactional. A slot selected for reuse cannot become
visible for the new page until upload completes, and the old mapping cannot be
invalidated in a way that samples new/partial bytes under the old identity.
Failed, cancelled, or generation-stale uploads abort publication.

If the requested mip is missing after zooming out, sampling consults the base
page table for finer resident coverage before accepting a coarser fallback.
Each pixel resolves its own resident tile; partially loaded regions keep their
existing coarse fallback. Once the requested mip is resident it takes priority.
This reuses existing GPU detail without requesting extra pages or preventing
budget-driven eviction and delayed shrinking.

Declaring or preparing a VT source does not itself allocate an atlas. The first
non-empty projected demand does, so off-screen assets do
not each reserve the default physical working set merely by existing in a scene.

Compatible logical textures share one root-owned physical atlas pool. Pool
compatibility is exact stored-page extent and color space; samplers and page tables remain per logical texture. RGBA pools start from visible demand rounded
toward a power-of-two slot count, bounded by legal rectangular atlas dimensions.
They grow as demand increases, within the remaining root GPU budget and a
combined atlas allowance of 75% of that budget. The default root budget remains
256 MiB. Both the old and replacement atlas count against it during migration;
when growth is blocked by that overlap, a pool can first compact to resident
coarse roots, then grow. This requires a resident root for every visible resource
and proof that the final allocation fits beside the intermediate atlas. Missing
roots or insufficient space can still prevent growth. Temporary compaction
reduces detail and may require reloading discarded pages. Automatic sources still waiting for decode reserve one generated RGBA page each in that allowance for later coarse coverage. Terminal decode failures release that reservation.

Ordinary fitting accounts for scene storage and the current shared GPU budget. When the allowance increases, fitted sources can be prepared at higher resolution while the previous GPU texture remains usable until replacement storage is admitted. With texture inspection enabled, every newly decoded raster passes the same inspection gate before publication.

Preparation queues unlink cancelled jobs in constant time, including jobs
behind live queued work. Their intrusive links reuse the existing job record;
no cancellation scan or additional queue-node allocation is required.

When a resource has no resident pages and every page in its current demand is
known to have failed, the runtime clears that demand and releases its empty GPU
resource. A shared atlas remains alive for healthy neighbors. Failure records
remain, preventing repeated allocation and page preparation for unchanged failed
demand. A changed view can request previously untested pages and allocate again;
a new source version also permits retry. Failed-page counts remain observable
even when fully failed demand is suppressed.

RGBA growth copies resident GPU pages without decoding them again. Copies and
page uploads share the four-page frame limit and upload-byte/time admission.
Each source atlas reuses one validated read framebuffer across copy batches;
deleting the atlas also deletes that framebuffer. Texture-size limits are
queried once per context lifetime and refreshed after context loss.
Growth preserves the column count when that layout fits the full planned
capacity within legal dimensions, avoiding page-table rewrites in that case.
The old atlas remains drawable until all copies complete, then bindings and
page tables switch together. Binding changes invalidate cached material
uniforms as well, so an unchanged material samples with the new atlas dimensions.
Allocation is flushed before yielding a frame; its completion fence is created
on a later frame, then polled with a zero timeout. Copy batches are submitted
on consecutive frames within the existing upload limits. After all copies have
been queued, one fence covers the complete copy sequence, including any earlier
batches followed by empty slots. Error validation occurs only after completion,
before publication. This separation matters on
WebKit, where creating a fence immediately after work can itself block. A
failed fence or 120 unsuccessful frame polls abandons that replacement.
Failed migration preserves the old atlas and retries when demand, available
capacity, or uploaded coverage changes.

RGBA pools also shrink when the rounded demand fits at most half their slots.
A two-second low-demand delay avoids reallocating for brief camera changes;
a single timer wakes an idle root instead of drawing continuously during the
wait. Capacity shortages can bypass the delay. Pending shrink savings remain
reserved until commit, so cancellation cannot overcommit the atlas allowance.
Shrinking compacts resident pages into a smaller replacement, prioritizing
visible coarsest coverage, then demanded pages and recent spare pages. Copies
use the bounded, fenced migration path; compacted indices rebuild page tables.
Ordinary low-demand shrinking preserves bounded desired demand and restarts
when the view needs discarded pages. Disposal and context invalidation cancel
the wakeup and release migration claims.

RGBA pools reserve enough budget for visible coarse coverage where capacity
permits, then share the remaining allowance equally up to each pool's rounded
demand. A pool above its share can shrink below its desired detail to admit
another pool. Its replacement may temporarily be smaller than the final share
so old-plus-new storage fits; it can grow toward the share after releasing the
old allocation. Migration reuses page tables and can use the full unclaimed
capacity instead of reserving those tables and initial-allocation headroom
again. It never bypasses the persistent root budget.

Visible logical textures also share the slots within each pool, reserving one
coarse slot each where possible and distributing the remainder up to per-texture
demand. Demand is refitted when those shares change, so an
earlier texture cannot protect every slot from later textures indefinitely.
Unused resident detail may remain cached until another texture needs its slot;
resident counts therefore need not be equal even when admission is balanced.

Released storage becomes available to ordinary resources and other pools.
An initial VT allocation blocked by current budget capacity remains retryable
when capacity returns, rather than permanently becoming unsupported. If even a
replacement preserving minimum coverage cannot fit alongside the old atlas,
capacity remains unchanged. Compressed native pools retain their fixed policy and
are accounted before dividing RGBA shares; Compressed-pool resizing and automatic
calibration of the root's default budget remain unimplemented.

Direct-target demand that exceeds a texture's admitted capacity is coarsened
to complete parent targets. Collection exceeding the bounded demand workspace
is repeated at a coarser minimum mip, avoiding a spatially partial prefix.
Diagnostics report `atlasPools`, `atlasBytes` (including in-progress migration),
`atlasGrowthFailures` (failed growth or shrink migrations), bounded `desiredPages`, capacity-fitted `admittedPages`,
and `unresidentPages` separately from logical `residentPages`. Desired counts
are measured after workspace coarsening; they are not unlimited ideal demand.

Shared slots are identified by both resource and page identity. Cross-resource
eviction invalidates the evicted logical mapping and republishes every dirty
page table before the next draw, so an overwritten cell cannot appear under a
different texture's identity.

Protected pages required by the current frame are not eviction candidates.
Eviction policy MAY approximate recency but MUST terminate under full pressure.
Backoff and denial state MUST be bounded and wake when capacity or demand
changes; permanent failures MUST NOT retry every frame.

GPU atlas, page tables, decoded pages, source images, request jobs, transient
raster data, and per-frame upload bytes all participate in the root resource
governor.

## Observable readiness

Ordinary sources expose `useTextureAssetStatus(srcOrRef)`. Automatic VT progress is available through `root.getSnapshot().resources.virtualTextures` or React `useRendererSnapshot()` for diagnostics. `pendingPages` includes generated pages waiting for GPU publication; it is not a promise that every source page will become resident. Ineligible sources keep ordinary rendering.
