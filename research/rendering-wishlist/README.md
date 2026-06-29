# Royal Rendering Wishlist Prune/Build Plan

Date: 2026-06-28

## Scope

This is a concrete plan for turning the broad rendering wishlist into staged
Royal work. It intentionally does not edit renderer public APIs, examples,
text-vector work, blender-pipeline work, WebGPU code, or package config.

Royal today has a small authoring surface:

- `@royal/renderer-core`: `scene`, `pass`, cameras, `mesh`, `gltf`,
  `directionalLight`, vector text, and simple materials.
- `@royal/react`: a WebGL2 root and JSX/runtime adapter.
- WebGL2 internals: geometry, glTF, text, programs, capabilities, and draw
  caches are implementation details.
- `@royal/tarstate-lens`: relation-style state, diagnostics, and capability
  boundaries that can host renderer facts without exposing backend handles.

The plan keeps that split. Apps should declare scene intent, assets, lights,
and budgets. Renderer backends should choose Forward+, clustered, deferred,
texture paging, culling, and LOD strategies from capability facts and asset
manifests. Backend strategy names should not become author-facing nodes until
there is a stable reason.

## Prototype Sketch

`rendering-budget-sketch.mjs` is a standalone sketch for the first build step.
It creates a deterministic synthetic scene and estimates:

- CPU frustum culling over bounded drawables.
- Clustered point-light assignment cost.
- Virtual texture page demand from visible objects.
- Meshlet/LOD selection from distance and screen-pressure heuristics.

Run:

```sh
node research/rendering-wishlist/rendering-budget-sketch.mjs
node research/rendering-wishlist/rendering-budget-sketch.mjs --check
```

This is not a renderer patch. It is a cheap fixture for tuning target numbers
before adding internal render-packet extraction. `--check` gates only
deterministic structural pressure values such as visible packet budget, cluster
overflow, LOD accounting, and highest-mip demand; local timing numbers remain
reported but are not treated as pass/fail gates.

## VT Browser Benchmark Coverage

The live virtual-texturing hitch benchmark is
`apps/examples-react/scripts/virtual-texturing-smoothness.mjs`. It should stay
pointed at browser-observed or probe-observed facts that can catch hitches:

- Initial load: navigation-to-canvas, navigation-to-probe-ready, and first
  usable probe-ready time when pending pages are drained below the configured
  threshold.
- Zoom/rotation hitches: input-correlated rAF p95/max, per-phase rAF p95/max,
  and phase settle time after wheel/drag bursts.
- Page request planning: `performance.lastPlanMs` / `maxPlanMs` when the probe
  exposes them.
- Worker page generation and saturation: worker availability/count, queue
  depth, in-flight bytes, generation latency, generated/fallback pages, stale
  drops, and oldest queued work in frames.
- Upload bursts: atlas upload count, page-table upload count, page generation
  time, texture upload time, page-table upload time, and cumulative bytes
  uploaded.
- Render frame timing: browser rAF p50/p95/p99/max plus probe frame p95/max and
  slow-frame count.

Current missing probe TODOs before adding stricter direct timings:

- `cameraInput.handlerDurationMs`: direct wheel/pointer handler self-time. The
  benchmark currently uses input-correlated rAF as the hitch-catching proxy.
- `uploadQueue.waitMsByPageOrPriority`: queue age is exposed as
  `oldestQueuedWorkFrames`, not per-page wait timing.
- `textureUpload.bytesPerChunk`: only cumulative `bytesUploaded` exists today.
- `renderFrame.gpuMs`: WebGL timer-query/GPU frame timing is not exposed.

## Build Order

### 1. Internal Visibility Packets

Build a private render-packet extraction step inside the WebGL2 backend. It
should flatten pass children into packets with kind, transform, bounds,
material/asset key, light metadata, and draw callback. The public `Scene` and
`RenderPass` shapes can stay unchanged.

Decomplection: separate "what is visible" from "how a node is drawn". The
current render loop interleaves traversal, resource lookup, GL state, and draws;
visibility packets are the pressure-release point for culling, LOD, batching,
and metrics without adding public node variants.

Bench targets:

- 10,000 bounded packets culled in less than 1.0 ms on desktop Node/Chromium
  and less than 3.0 ms on mid mobile hardware.
- Zero per-frame object allocations after warmup.
- Frustum result stable across camera jitter smaller than 0.25 px.
- Offscreen scenes should skip at least 90% of draw calls.

Demo target: extend an internal test/probe with many boxes or manifest-backed
placeholder bounds, then report packet count, visible count, and cull time.

### 2. CPU Frustum Culling First, CPU Occlusion Later

Add CPU frustum culling before any occlusion work. Bounds can be derived now for
box meshes, vector text layouts, and glTF assets that carry manifest bounds.
Current glTF JSON loading does not expose full scene bounds cheaply, so
production culling should prefer a sidecar manifest over opening every asset.

CPU occlusion should remain a second step and should start conservative:
screen-space rectangles or coarse occluder boxes for static panels/terrain
tiles. Do not build a large CPU BVH API yet.

Prune:

- Do not expose `culled`, `occluder`, or BVH knobs on public render nodes in v1.
- Do not use current glTF parsing as the source of truth for production bounds.
  It is a demo loader path and should not become the asset-manifest contract.
- Do not add a DOM/layout-specific culling path separate from renderer packets.

Bench targets:

- Frustum culling: less than 0.1 us per packet after warmup.
- Coarse CPU occlusion, when added: less than 2.0 ms for 2,000 occludees and
  200 occluders at 1080p.
- False-negative rule: CPU occlusion may draw too much but must not hide visible
  geometry.

### 3. Optional GPU Features As Capability Rows

Keep optional WebGL2/WebGPU support behind capability rows, not public flags.
The existing probe direction is right: collect facts for backend mode,
instancing, multiple render targets, depth textures, timer queries, anisotropy,
float/half-float textures, compressed texture families, and context loss.

Use those facts to choose backend routes:

- WebGL2/WebGPU instancing: repeated meshes, terrain tiles, impostors.
- WebGL2/WebGPU multiple render targets: deferred/G-buffer experiments only.
- WebGL2/WebGPU depth textures: depth prepass, shadow/depth experiments, Hi-Z
  input.
- WebGL2/WebGPU timer queries: benchmark rows, never product logic.
- Compressed texture extensions: KTX2/Basis target selection.
- Anisotropy: material quality upgrade only.

Prune:

- Do not expose extension names in JSX or renderer-core.
- Do not build WebGL1 emulations for deferred rendering, virtual texturing, or
  GPU occlusion. If an advanced route depends on too many extensions, gate it
  off and keep the simpler backend.
- Do not let benchmark/probe helpers leak renderer handles across the public
  capability boundary.

Bench targets:

- Capability probe less than 5 ms at root creation.
- Missing optional extensions produce diagnostics but no render failure.
- Timer-query overhead less than 0.2 ms CPU per measured frame when enabled.

### 4. KTX2/Basis Before Megatextures

The texture plan should start with asset compression, not full virtual
texturing. Current WebGL2 texture loading uploads decoded `ImageBitmap` data.
For real scenes, add an asset manifest path that selects KTX2/Basis Universal
textures when compressed texture capability rows support the target family,
with PNG/JPEG fallback for portability.

Only after that should Royal prototype virtual texturing/page caches. A virtual
texture needs page tables, residency tracking, shader indirection, upload
budgets, and debug views. Megatextures are a research topic until asset
manifests, compressed textures, and material indirection are stable.

Future-facing API fit (sketch, not current public API):

- Public JSX nodes keep pointing at assets (`<gltf src="..." />` today, or a
  future asset id).
- Asset manifests carry texture variants, dimensions, mips, page size,
  color-space, and hashes.
- Backend caches choose compressed/fallback variants from capabilities.

Prune:

- Do not add public `virtualTexture` or `megatexture` node types now.
- Do not expand the PNG/JPEG path into the premium path for large worlds.
  It remains the compatibility fallback.
- Do not add separate texture APIs for text, glTF, terrain, and materials.
  They should share an asset/cache policy.

Bench targets:

- KTX2/Basis path: at least 3x lower GPU texture memory than RGBA8 PNG upload
  for representative albedo/normal/ORM sets.
- Texture upload budget: less than 4 MB or less than 2 ms CPU-triggered upload
  per frame during streaming.
- First visible material: less than 250 ms from asset request on cached local
  dev assets.
- Virtual texture research gate: 95% page-hit ratio during slow camera movement
  and no more than 8 page uploads per frame.

### 5. Forward+/Clustered Lighting Before Deferred

Royal currently has one directional-light style in practical use. The next
lighting demo should add many local lights without changing app code into a
rendering-algorithm API.

Build direction:

1. Represent point/spot light intent in renderer-core only when product needs
   it, not as `ForwardPlusLight`.
2. Backend extracts visible lights into light packets.
3. WebGL2/WebGPU route builds screen-space clusters and a light index texture or
   storage buffer.
4. Materials keep asking for lighting inputs; the backend chooses simple
   forward, Forward+, clustered, or deferred.

Deferred rendering is not first. It wants multiple render targets, a G-buffer
material contract, depth/normal precision policy, transparency fallback,
post-processing order, and bandwidth tests. WebGL2 can prototype parts with
MRT, but WebGPU is the realistic backend for the full path.

Prune:

- Do not expose `ForwardPlus`, `Clustered`, or `Deferred` as public pass types.
- Do not maintain both tiled-forward and clustered-forward product paths unless
  benchmarks prove a real split. Clustered forward is the default research path.
- Do not add a public material graph solely to support deferred experiments.

Bench targets:

- 128 dynamic point lights, 2,000 visible draw packets, 1080p, under 6 ms GPU
  lighting cost on desktop integrated GPU.
- CPU cluster build less than 1.0 ms for 16 x 9 x 24 clusters and 128 lights.
- Per-cluster average light list less than 32 lights; clamp with diagnostics
  when exceeded.
- Fallback simple-forward path remains under 2 ms GPU for 8 lights.

### 6. Meshlet And Virtualized LOD As Asset-Manifests First

Meshlets should begin as offline asset data: bounds, cone culling data, LOD
levels, vertex/index ranges, material key, and byte ranges. Royal should not add
`MeshletNode` as an authoring primitive. It should load a normal asset and let
the backend select meshlets or LOD chunks from the manifest.

Current glTF support is intentionally narrow: JSON glTF, separate buffers,
non-interleaved float accessors, unsigned-short indices, base-color image
texture, and no general production LOD. Do not turn that path into the whole
streaming asset system. Put streaming metadata beside or inside a future asset
manifest.

WebGPU helps later with compute culling, indirect draws, storage buffers, and
large index/meshlet tables. Browser WebGPU should not be assumed to have mesh
shader hardware features; the portable path is still compute/indirect style
selection or CPU selection plus instanced/ranged draws.

Prune:

- Do not add one public geometry kind per LOD technique.
- Do not expose raw meshlet ranges to apps.
- Do not require runtime meshlet building in the browser for production assets.
  Build meshlets offline and validate them in the asset pipeline.

Bench targets:

- CPU LOD/meshlet selection less than 2 ms for 100,000 meshlets with a spatial
  index, or less than 0.5 ms for 10,000 visible-region meshlets.
- Draw submitted triangles within 1.5x of the target screen-error budget.
- LOD switch churn less than 5% of selected meshlets per small camera step.
- Asset manifest parse less than 20 ms for 100,000 meshlet records, with a
  binary path researched if JSON exceeds the target.

### 7. Hi-Z And GPU Occlusion As WebGPU-First Research

Hierarchical Z and GPU occlusion should wait until CPU frustum culling and asset
bounds are in place. A WebGL2 prototype is possible with depth textures,
framebuffers, and careful mip generation, but readback and synchronization make
it easy to lose the win. WebGPU is the better target for depth pyramid
construction, compute culling, indirect draw compaction, and debug visibility.

Build direction:

1. Depth prepass or depth-producing main pass with known opaque ordering.
2. Depth pyramid generation.
3. GPU occlusion test against packet/meshlet bounds.
4. One-frame-late visibility with conservative fallback.
5. Optional CPU readback only for diagnostics.

Prune:

- Do not block near-term demos on GPU occlusion.
- Do not read back per-object occlusion every frame in WebGL2.
- Do not couple Hi-Z to glTF only; it should operate on generic visibility
  packets/meshlet bounds.

Bench targets:

- Depth pyramid build less than 0.5 ms at 1080p.
- GPU occlusion pass less than 1.0 ms for 50,000 candidate bounds.
- End-to-end improvement at least 25% GPU frame-time reduction on occlusion
  stress scenes before promoting beyond research.
- No visible popping from one-frame-late decisions under normal camera motion.

## Demo Order

Soon, no public API change:

1. Run and tune `rendering-budget-sketch.mjs`.
2. Add internal visibility packets and CPU frustum culling.
3. Add capability-gated benchmark rows for visibility, draw count, texture
   upload bytes, and light counts.
4. Add asset-manifest bounds for glTF-style assets, keeping current loader as
   fallback.

Soon after, still WebGL2-capable with gates:

1. KTX2/Basis asset variant selection and compressed texture diagnostics.
2. Instancing route for repeated geometry when WebGL2/WebGPU support exists.
3. Clustered-light CPU planner and shader prototype behind WebGL2/WebGPU gates.
4. Offline LOD/meshlet manifest reader with CPU selection and normal draw calls.

Requires WebGPU or should remain WebGPU-first:

1. Compute-built clustered light lists.
2. Hi-Z depth pyramid and GPU occlusion.
3. Indirect draw compaction.
4. Large meshlet tables in storage buffers.
5. Practical deferred renderer with typed G-buffer policy.

Remain research until earlier gates pass:

1. Full virtual texturing/megatextures.
2. Deferred material graph.
3. Runtime meshlet generation.
4. Cross-backend render graph scheduling exposed as public API.

## API Direction

Recommended public stance:

- Keep `Scene`, `RenderPass`, and authoring nodes declarative.
- Add product concepts only when needed: local lights, asset ids/manifests,
  render budgets, and material properties.
- Keep rendering techniques backend-private: Forward+, clustered, deferred,
  Hi-Z, occlusion, virtual texturing, and meshlet selection are strategies.
- Surface facts through diagnostics and relation rows: capability rows,
  benchmark rows, selected asset variants, culling counts, and budget misses.
- Prefer one asset manifest contract over many specialized render nodes.

Potential internal rows or diagnostics:

- `rendererCapabilities`: current probe rows plus backend strategy choices.
- `renderPackets`: pass id, packet id, node kind, bounds, asset/material keys.
- `visibilityStats`: total, frustum-visible, occlusion-visible, submitted.
- `assetVariants`: asset id, variant kind, format, byte size, capability gate.
- `textureResidency`: texture/page id, resident bytes, requested mips/pages.
- `lightClusters`: cluster grid, lights, overflow count, build time.
- `lodSelections`: asset id, selected level/meshlets, screen error, churn.

## Pruning Summary

Remove or avoid exposing these paths:

- Public rendering-algorithm pass types such as `ForwardPlusPass`,
  `DeferredPass`, or `HiZPass`.
- Public WebGL extension flags or extension-specific props.
- WebGL1 emulation paths for advanced clustered/deferred/virtual texture/GPU
  occlusion features.
- A production asset path based on expanding the current narrow glTF JSON loader
  instead of adding manifests and variants.
- Separate texture systems for text, glTF, terrain, and materials.
- Public `MeshletNode`, `VirtualTextureNode`, or raw page/meshlet controls.
- A second public text rendering path. Keep vector text authoring stable; any
  glyph atlases or texture caches should be backend details.
- CPU occlusion APIs before CPU frustum culling and bounds manifests are proven.

The first concrete build should be visibility packets plus CPU frustum culling.
It unlocks immediate draw reduction, gives later systems a shared unit of work,
and decomplects render traversal from GL submission without freezing public API.
