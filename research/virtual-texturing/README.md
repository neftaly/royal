# Royal Virtual Texturing Research

Date: 2026-06-28

## Scope

This spike stays under `research/virtual-texturing` while the WebGL renderer
package extraction settles. It does not add public renderer APIs, examples,
package config, or backend code.

Target the first demo at WebGL2. WebGPU can make page-table formats, compute
visibility, and asynchronous copies cleaner later, but WebGL1 is unsupported
and should not get a fallback or reduced virtual-texturing route.

## First Demo

Build a large generated terrain/material atlas after the renderer split lands.
The scene should look like a huge painted landscape rather than a technical
checkerboard:

- A 16k x 16k virtual albedo/material map generated from deterministic terrain
  rules: altitude bands, slope streaks, roads or river scars, and sparse decal
  stamps.
- A camera that pans close to the ground across several biomes so missing pages
  and replacements are visible if the cache is undersized.
- A physical-page debug overlay showing resident slots, page-table entries,
  requested pages, misses, evictions, fallback mip use, and upload budget.
- A seam stress toggle that exaggerates tile borders and mip fallback so bleed
  problems are obvious during review.
- Stats for frame demand, page hits/misses, uploads, evictions, upload bytes,
  estimated upload time, page-table updates, and shader indirection mode.

The first slice is now checked in as a tiny deterministic asset bundle. It is
small enough for review, but it exercises the actual story: generated terrain
material pages, padded borders, a manifest shape, a cache overlay mock, and
camera-pan stream stats.

### Landed First Slice

`generate-demo-assets.mjs` writes and verifies `demo-assets/`:

- `demo-assets/manifest.json`: asset-first virtual texture manifest with page
  dimensions, padding, sampler policy, hashes, preview files, and budget rows.
- `demo-assets/pages/**`: 21 PNG `RGBA8` pages for a 128 x 128 virtual
  terrain material, with 32 x 32 usable texels plus a 4 texel border.
- `demo-assets/preview/terrain-pages-overview.png`: a visual overview of the
  generated material, including tile boundaries for seam review.
- `demo-assets/preview/page-cache-debug-overlay.svg`: the intended debug
  overlay shape: physical slots, resident pages, stream probes, and camera pan.
- `demo-assets/stats/camera-pan-stream.json`: deterministic cold-pan stats for
  requests, hits, misses, uploads, evictions, dirty page-table entries,
  fallback samples, and resident-mip seam candidates.

Run:

```sh
node research/virtual-texturing/generate-demo-assets.mjs --check
node research/virtual-texturing/generate-demo-report.mjs --check
node research/virtual-texturing/generate-example-fixture.mjs --check
```

The checker regenerates the expected bytes in memory, compares every committed
artifact, and verifies that adjacent tile borders match. Current fixture:

- 21 total pages across 3 mips.
- 28 adjacent tile pairs.
- 8,960 padded-border pixel comparisons.
- 0 border mismatches.

This fixture is intentionally tiny. It proves the asset contract and visual
debug story without freezing renderer APIs or checking in a heavy tile set.

`demo-readiness.md` defines the exact Royal route to add after renderer hooks
exist: `/labs/virtual-texturing` in the examples app, backed by asset/material
resources and a private renderer implementation. It also lists the controls,
debug overlay rows, stats, tests, and gates for moving from this fixture to the
browser demo.

`generate-demo-report.mjs` writes `demo-assets/report/index.html` and
`demo-assets/report/virtual-texturing-demo-readiness.svg` from the committed
manifest, page metadata, overview image, cache overlay, and camera-pan stats.
Its `--check` mode validates manifest hashes for pages, previews, and stats,
then compares the committed report bytes.

`example-plan.md` defines the simplified examples-app prototype route that can
land before renderer virtual-texturing hooks exist. `generate-example-fixture.mjs`
writes `demo-assets/example-fixture.json`, a compact import/copy payload with
route metadata, preview assets, fixture stats, visual acceptance, and migration
notes for the future real renderer-backed example.

`webgl2-runtime-design.md` is the research-only design note for the real WebGL2
runtime path. It separates fixture previews from live renderer implementation,
names the package-private worker responsibilities, defines page table and
physical atlas ownership, outlines shader indirection and demand rows, and
standardizes benchmark counter names. It also keeps the public API boundary
explicit: there is no public `VirtualTextureNode` yet.

`shared-array-buffer-worker-research.md` adds the worker transport decision:
start with a worker-ready command protocol and transferable `ArrayBuffer`s,
then prototype `SharedArrayBuffer` only when benchmarks show transfer,
allocation, or GC churn, or when a controlled deployment needs bounded memory.
SAB is viable for HTTPS/localhost deployments with cross-origin isolation
headers, but the default path remains gated by frame-time and memory results.

## Design

### Page Table / Indirection Texture

The virtual texture is split into fixed-size virtual pages for each mip level.
The shader computes the desired virtual mip from derivatives, finds the virtual
page coordinate, samples an indirection texture, then remaps the sample into a
slot inside a physical cache atlas.

WebGL2 path:

- Store page-table entries in an `RGBA8` texture first for portability:
  physical slot x, physical slot y, resident mip delta, flags/version.
- Use `textureLod` only where available. The baseline fragment path can rely on
  implicit derivatives plus a page-table mip-selection helper.
- Update dirty page-table texels with `texSubImage2D` after page uploads.
- Keep the table representation private to the backend. Public Royal data
  should name assets and material resources, not indirection formats.

Unsupported capabilities:

- WebGL1 does not run virtual texturing and should report an unsupported
  capability path.
- If a WebGL2 context is available but enough texture units, adequate texture
  limits, or required texture update support are missing, render a fixed
  low-mip material instead of virtual texturing.

### Physical Page Cache

Use one or more 2D atlas textures as the physical cache. A slot stores one
border-padded page. A simple LRU or clock policy is enough for v1, as long as
the eviction path also invalidates or downgrades page-table entries.

Recommended starting budget:

- Usable tile size: 128 x 128 texels.
- Border/bleed: 4 texels on each side, copied from neighboring source tiles or
  generated by evaluating the source function outside the tile.
- Uploaded slot size: 136 x 136 texels.
- Format: start with `RGBA8` for deterministic WebGL behavior, then add KTX2
  variants.
- Physical cache: 256 slots for the demo, about 18.1 MiB in `RGBA8`.
- Upload budget: 4 to 8 pages per frame, capped by both estimated bytes and
  timer-query feedback when available.

### Mips And Residency

Every page request should resolve to the best resident page at or above the
requested mip. If the exact page is missing, climb to a resident parent mip and
record a fallback sample. The scheduler prioritizes:

1. Visible exact pages.
2. Parent pages needed to hide missing high mips.
3. One-ring prefetch pages along the camera velocity.
4. Lower-priority debug or far-field pages.

Keep parent pages resident longer than children so evictions degrade softly.
Use hysteresis in mip selection to avoid upload churn as the camera hovers near
a threshold.

### Border / Bleed Handling

Seams are the main visible failure mode. The tile generator must emit border
texels for each tile and mip, not only clamp inside the tile. For generated
terrain materials, the cleanest path is to evaluate the procedural material
function over the padded tile bounds. For image assets, copy or resample
neighbor pixels before compression.

Shader sampling should remap the in-page UV away from the padding edge:

- Compute virtual-page local UV.
- Scale by usable tile size.
- Add the border offset.
- Normalize by the padded slot size.

Debug modes should visualize mismatched resident mip levels across neighboring
pages and count seam candidates where adjacent visible pages resolve to
different resident mips.

### KTX2 / Basis Compatibility

KTX2 should be an asset-manifest variant, not a public node type. The manifest
can list page dimensions, mips, color space, hashes, and variants:

- `ktx2-basis-uastc` for high-quality albedo/normal-like pages.
- `ktx2-basis-etc1s` for smaller far mips or low-frequency material masks.
- `rgba8` or PNG/JPEG fallback for devices without compressed texture support.

WebGL can upload compressed page data with `compressedTexSubImage2D` only when
the chosen transcode format, block alignment, and page dimensions are valid.
Keep page sizes multiples of 4 blocks, including padding. If that gets brittle,
transcode into a staging buffer and upload `RGBA8` pages while preserving the
same manifest and residency logic.

### Update Budget

The renderer should treat texture updates as a frame budget, not a blocking
load:

- Hard cap page uploads per frame.
- Hard cap upload bytes per frame.
- Optional timer-query feedback to reduce budget if uploads exceed target ms.
- Page-table updates are batched after physical uploads.
- Stale requests are dropped when camera demand changes before data arrives.

Initial targets:

- 95% or better page-hit ratio during slow pan after warmup.
- No more than 8 physical page uploads per frame.
- Less than 2 ms estimated texture upload time per frame on desktop WebGL.
- Page-table dirty entry count proportional to uploads and evictions, not full
  table rewrites.

### Capability Policy

The first demo should choose from capability rows:

- WebGL2 plus adequate max texture size: full virtual-texture route.
- WebGL1: unsupported, with no reduced virtual-texturing route.
- WebGL2 with too-small max texture size, missing required texture update
  support, missing compressed texture target, or context pressure: fixed
  low-mip atlas/material.
- Missing timer queries: use byte and upload-count budgets only.

Unsupported or insufficient capabilities should produce diagnostics and render
the fixed low-mip material rather than a reduced virtual-texturing path.

## Minimal Royal API Surface

Keep virtual texturing out of public scene nodes for now. Avoid a public
`VirtualTextureNode` until there is a stable reason.

The minimal author-facing surface should be asset and material data:

- Asset manifest entry:
  - virtual texture id
  - virtual dimensions
  - page size and border
  - mip count
  - color space and channel meaning
  - tile URI template or generated recipe id
  - variants with formats, hashes, and byte ranges
- Material or texture resource reference:
  - base color / normal / ORM virtual texture asset id
  - sampler policy such as repeat/clamp and anisotropy preference
  - fallback texture or color
- Backend capability/resource facts:
  - selected variant
  - resident page budget
  - current diagnostics and stats

Renderer packages can later consume those manifests privately and bind page
tables, cache atlases, and debug overlays without freezing a megatexture node
into the public API.

## Renderer Hooks Needed After API Cleanup

Keep these internal to the renderer/backend at first. They are hooks, not a
public `VirtualTextureNode`.

- Texture resource: an internal virtual texture resource that owns the physical
  cache atlas texture, the page-table texture, the fallback texture, the
  decoded-page staging buffer, and the selected manifest variant.
- Material resource: a material texture slot that can resolve either a normal
  texture asset or a virtual texture asset id. The public material should keep
  naming base color/normal/ORM assets plus fallback color or texture.
- Page loader: a manifest-driven tile fetch/decode path using stable page ids,
  URI templates, hashes, color space, and variant selection. PNG/RGBA8 is the
  first dev variant; KTX2 stays a variant of the same asset.
- Residency scheduler: frame-scoped demand collection, parent fallback lookup,
  prefetch priority, LRU or clock eviction, and hard upload page/byte budgets.
- Page-table upload: a batched dirty-entry writer that updates only texels
  affected by uploads and evictions. For WebGL2 this starts as `RGBA8`
  `texSubImage2D`; WebGL1 is unsupported and should not have a separate
  encoding path.
- Shader binding: a private material path that binds the page table, physical
  atlas, fallback texture, page size, border size, and selected indirection
  mode for one virtual albedo texture.
- Stats/probe rows: a backend diagnostics stream for requested pages, resident
  slots, exact hits, misses, fallback samples, uploads, evictions, upload
  bytes, estimated upload time, dirty page-table entries, and resident-mip
  seam candidates.
- Debug overlay: a renderer-owned overlay consuming those probe rows. It should
  render the cache slots and table state before the material is tuned, so cache
  churn and seam pressure are visible during review.

### Worker Transport

Keep worker transport package-private and protocol-compatible across
implementations. The first integration should move demand rows and renderer
commands across a boundary while main-thread WebGL still owns texture uploads,
page-table texture updates, and material binding.

Default to transferable `ArrayBuffer`s until benchmark rows prove the added SAB
protocol is worth it. For controlled deployments, SAB can become the preferred
transport when `crossOriginIsolated` is true and measured transfer/allocation
churn or peak in-flight bytes threaten the demo gates. OffscreenCanvas remains
out of the first prototype unless a canvas-specific page-generation experiment
wins on measurements.

## Prototype

`virtual-texturing-cache-sim.mjs` is a standalone deterministic simulation. It
does not import Royal and does not participate in package builds.

Run:

```sh
node research/virtual-texturing/virtual-texturing-cache-sim.mjs
node research/virtual-texturing/virtual-texturing-cache-sim.mjs --check
```

Pass `--frames` to include every simulated frame in the JSON output.
The check mode validates the deterministic live-data snapshot hash and the
budget gates. The prototype intentionally uses a 96-slot stress cache, smaller
than the 256-slot demo recommendation, so uploads and evictions both exercise
the dirty page-table path.

It models:

- generated virtual page metadata and sample manifest rows
- derivative-like mip demand from a panning camera
- physical cache slots as plain data, including slot coordinates, resident page
  ids, load frames, last-use frames, and LRU replacement
- page-table entries as plain data, including virtual-page coordinates,
  physical slot coordinates, `RGBA8`-style encoded bytes, flags, versions, and
  local UV remap metadata for padded pages
- upload and eviction events with the page-table entry each upload creates
- a dirty-entry queue for upload and eviction texels that future renderer code
  can batch into page-table texture updates
- residency summaries, per-mip counts, page-table summaries, and seam/debug
  summaries
- seam candidates from neighboring visible pages resolving to different mips

## Benchmark Sketch

Use this script as the first repeatable budget check before wiring renderer
code:

- Page uploads per frame: average, max, and frames over budget.
- Cache hits/misses: exact hit ratio and fallback ratio after warmup.
- Memory budget: padded page bytes, physical slot count, and total cache MiB.
- Texture upload time: estimate now, replace with WebGL timer-query rows later.
- Shader cost: count one page-table sample plus one physical-cache sample per
  material texture; measure real fragment cost in the demo.
- Visible seams: count adjacent visible page pairs with different resident mips
  or missing fallback coverage.

## Recommended Demo Steps After Renderer Split

1. Use `demo-assets/manifest.json` as the first fixture for loader and material
   work. Do not add a public virtual texture scene node.
2. Add a private WebGL texture resource that can own a page-table texture and a
   physical page atlas.
3. Add an internal material path for one virtual albedo texture on terrain,
   driven by an asset manifest. Keep public scene code using material assets.
4. Stream the lightweight terrain tiles from the deterministic recipe through
   the page scheduler with a strict upload budget.
5. Add the debug overlay and stats before tuning visuals; otherwise seams and
   churn are hard to diagnose.
6. Generate the larger 16k demo tile set out of band from the same recipe. Keep
   only recipes, manifests, and small fixtures in git until storage policy is
   clear.
7. Add KTX2/Basis variants in the manifest, with `RGBA8` fallback using the
   exact same page ids and residency policy.
8. Only then consider a WebGPU path for richer page-table formats, async copy,
   compute visibility, or larger caches.

## Blockers

- Renderer package/API cleanup must settle before adding backend resource code.
- Royal needs an asset manifest/resource concept before this should become
  public API.
- Current texture code needs compressed texture capability selection before
  KTX2-backed virtual pages can be tested seriously.
- WebGL timer-query availability varies; budget logic must work without it.
- The tiny fixture proves border generation, but a real screenshot pass still
  needs renderer integration and a larger streamed tile set.
