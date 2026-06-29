# Dynamic LOD, Impostors, And glTF Virtual Texturing Roadmap

Date: 2026-06-29

Status: research-only. This document does not add renderer APIs, examples,
package exports, app routes, workflows, or source changes. It synthesizes the
current research notes into a staged implementation plan for dynamic LOD,
impostors, and arbitrary glTF texture virtualization.

## Position

Royal should treat LOD, impostors, and virtual texturing as private renderer
strategies chosen from asset manifests, material resources, visibility packets,
and capability rows. Authors should keep declaring ordinary scenes, meshes,
glTF assets, materials, and asset ids. The backend should lower those facts into
packets, LOD choices, texture residency, page-table updates, and draw commands.

The target is automatic dynamic mesh LOD first, then billboard and impostor
representations as candidates in the same private selection policy. Manual
per-object impostor nodes, hand-authored switch distances, and public cache
handles are useful signs that the design is not mature enough. The renderer
should be able to choose among source mesh, simplified mesh, meshlet group,
billboard, octahedral impostor, or culled state from the same asset identity and
frame facts.

Non-current future API sketch, not public API for this research pass:

```tsx
<gltf asset="world/oak-grove" />
<mesh geometry={treeGeometry} material={leafMaterial} asset="tree/oak" />

// If public control is needed later, prefer scene/root quality budgets over
// per-object algorithm switches.
<renderer quality="balanced" streamingBudget="default" />
```

This is not an API proposal for this research pass. It is the direction to keep
private research from drifting toward `DynamicImpostorNode`, `BillboardLOD`, or
`virtualTexture: true` feature knobs.

The current research points are consistent:

- `research/visibility-packets` defines the shared bounded work stream needed by
  culling, LOD, texture demand, lighting, and future occlusion.
- `research/asset-manifest` and `research/asset-manifest-contract` keep stable
  asset, page, artifact, bounds, revision, and LOD identity outside the current
  narrow glTF loader.
- `research/virtual-texturing` has a deterministic fixture, page-table/cache
  runtime design, worker-transport plan, demo gates, and package-private WebGL2
  runtime seeds.
- `research/dynamic-impostors` has a forest/impostor manifest and CPU-only
  pressure harness for representation selection plus virtual-texture residency
  pressure.
- `research/rendering-wishlist` and `research/renderer-foundations` already
  prune public algorithm nodes and put material texture resources before real
  virtual-texture binding.

The implementation risk is sequencing. Arbitrary glTF virtual texturing should
not bypass material resources, and impostors should not become a special public
node family. Both should consume the same packet, manifest, LOD, and residency
interfaces.

## Decomplected Model

Keep four responsibilities separate throughout the research:

1. **Asset preparation**: offline or research-only tooling reads source glTF,
   mesh, terrain, and material inputs, then emits stable manifest rows for mesh
   LODs, meshlets, billboard atlases, octahedral impostor atlases, material
   variants, VT page groups, bounds, hashes, animation support flags, shadow
   proxies, and picking proxies. This stage owns reproducibility and cache
   invalidation, not runtime selection.
2. **Policy selection**: a pure data policy consumes visibility packets, camera
   packets, asset rows, material rows, capability rows, hysteresis state, and
   frame budgets. It emits selected representation, transition intent, fallback
   quality, page demand, and diagnostic counters. It does not allocate GL
   resources, parse glTF, or own atlas uploads.
3. **Runtime swapping and residency**: a renderer-private state machine tracks
   previous and next representations, cross-fade windows, stable object ids,
   pending page demand, upload budgets, evictions, and fallback labels. It does
   not choose policy thresholds or shader layouts.
4. **Renderer binding**: WebGL/WebGPU binding lowers the selected
   representation into batches, buffers, material resources, page tables,
   shadow passes, picking passes, and draw commands. It may reject unsupported
   routes with diagnostics, but it should not become the owner of LOD policy.

The seam between these pieces should be serializable rows and typed buffers.
That keeps research fixtures, benchmark probes, renderer-private prototypes,
and future public diagnostics aligned without exposing backend handles.

## Current Findings

- Current glTF authoring is intentionally small: `gltf({ asset })` references an
  asset id, URI, optional revision, and optional bounds. The WebGL loader handles
  JSON glTF, separate buffers, non-interleaved float accessors, unsigned-short
  indices, `TEXCOORD_0`, and base-color image textures.
- Current glTF texture loading uploads ordinary `ImageBitmap` textures directly.
  That path is a compatibility and demo path, not the production source of
  texture identity, compression variants, streaming pages, or LOD metadata.
- Package-private virtual-texture helpers already cover page ids, parent lookup,
  resident pages, RGBA8 page-table entries, dirty table rows, physical atlas
  upload planning, and resource allocation. They are not yet connected to glTF
  material binding or live renderer demand.
- The virtual-texturing fixture checks 21 pages and 8,960 seam comparisons with
  zero border mismatches. The demo report check validates 21 pages and 6 camera
  frames.
- The dynamic-impostor check passes its deterministic thresholds: average
  hit ratio 0.979, average draw calls 4.232, average estimated texture upload
  0.074 ms, zero evictions, and 20,357 total LOD switches against a 22,000
  threshold. Its CPU-only LOD selection cost averages about 25 ms, so runtime
  integration needs packet buffers, spatial indexing, and visible-set reduction
  before a browser route.
- The rendering budget sketch shows the right combined pressure surface:
  visibility, clustered-light planning, texture-page demand, and LOD selection
  are all consumers of the same compact frame data.

## Prototype Readiness Ladder

Use these readiness labels before moving work between directories or toward
public API:

### Research-only

- Evidence is documents, JSON fixtures, CPU-only scripts, and deterministic
  checks under `research/**`.
- No app routes, examples, package exports, public JSX props, or renderer source
  changes are required.
- Output can be conservative estimates if the assumptions are named.
- Success means the boundaries, edge cases, failure labels, and measurable gates
  are clear enough to justify a probe.

### Probe/benchmark

- Evidence is a focused CPU, Node, or headless-browser probe with repeatable
  fixtures and `--check` thresholds.
- Probes measure one responsibility at a time: asset normalization, policy
  selection, residency pressure, visual equivalence, or renderer binding cost.
- Output is still not a product example. A probe may render offscreen only to
  compare pixels or measure page residency, not to advertise a feature.
- Success means the probe replaces guesswork with a budget row or failure mode.

### Internal prototype

- Evidence is renderer-private implementation behind non-exported adapters,
  debug routes, or tests.
- Public authoring remains ordinary assets, meshes, glTF, materials, lights,
  and root-level budgets. Algorithm choices stay private.
- Diagnostics come from renderer runtime rows, not committed fixture JSON.
- Success means real renderer integration meets probe budgets and survives
  capability fallback, context restore, and route smoke checks.

### Public API

- Evidence is repeated internal use with stable terms, few required knobs, and
  diagnostics that explain fallback without exposing implementation handles.
- The default remains automatic. Public API should be limited to asset identity,
  broad quality/streaming budgets, and opt-in diagnostics.
- Public API is not ready while users must tune switch distances, pick impostor
  kinds, manage page caches, or wire shader defines.

## Edge Case Contract

These cases must be modeled before a browser example claims dynamic impostor or
automatic LOD support:

- **Animated/skinned meshes**: static impostors are invalid unless the asset
  declares baked animation states, pose families, or a future live-regeneration
  path. Until then, choose mesh LOD, keep skinning/material identity intact,
  inflate bounds by animation extents, and emit degradation diagnostics.
- **Alpha and transparency**: split opaque, alpha-test, and blended materials
  before batching. Impostor transitions need depth-stable cross-fades,
  alpha-test depth policy for foliage, stable sort keys for blended cards, and
  a labeled fallback when alpha/depth atlas pages are missing.
- **Lighting/material variants**: asset rows must name which lighting
  assumptions and material variants an impostor atlas represents: albedo-only,
  normal/depth, baked lighting, seasonal variant, wetness/damage, or material
  override. Runtime policy may only choose an impostor if its variant matches
  the active material and lighting contract, or it must label the mismatch.
- **Shadows**: source mesh, simplified mesh, billboard, and impostor may need
  different shadow casters. Near shadows should prefer mesh or simplified mesh.
  Distant shadows can use cards or depth impostors only when bias, alpha-test,
  and light-direction error are bounded and debug counters identify the selected
  caster.
- **Picking and hit testing**: selection identity stays the source object id,
  not the billboard or atlas cell. Picking can use source bounds, a coarse proxy
  mesh, or an ID/depth impostor pass, but the chosen proxy must be declared in
  asset rows and report whether it is exact, conservative, or approximate.
- **Terrain/object integration**: terrain chunks and object impostors share
  visibility packets, material resources, VT budgets, and occlusion uncertainty.
  Terrain may provide placement, normal, cell, and occluder facts, but object LOD
  remains a generic policy and must not become forest-specific.
- **Hysteresis and transition churn**: refinement and coarsening thresholds need
  separate margins plus a minimum stable-frame count. Pending pages, cross-fade
  carry, and small camera jitter must not cause alternating mesh/impostor
  choices.
- **Streaming budgets**: policy must know per-frame upload pages/bytes, physical
  slots, residency priority, and fallback quality before it chooses a
  representation. It should prefer a resident lower-quality representation over
  a higher-quality one that would exceed the current frame budget.
- **VT interaction**: glTF material pages, terrain pages, billboard atlases, and
  impostor atlases share the VT scheduler. Page groups must include color,
  alpha, normal/depth, and variant pages where required. Page misses degrade
  representation or material quality with counters; they must not silently
  sample undefined atlas data.
- **Nonuniform scale and shear**: bounds use max-axis inflation. Octahedral
  depth/normal impostors are skipped unless the asset explicitly declares
  support for the transform class.
- **Capability fallback**: WebGL2, WebGPU, compressed textures, depth textures,
  timer queries, and large texture limits are capability rows. Missing
  capability selects a lower representation or fixed fallback, not a public
  feature flag.

## Stages

### 0. Keep The Boundary Frozen

Outcome: no public API commitments while private seams settle.

Work:

- Keep `VirtualTextureNode`, `DynamicImpostorNode`, `MeshletNode`, page-table
  handles, raw LOD ranges, and WebGL extension flags out of public packages.
- Treat fixture stats as research evidence only. Live examples must later
  replace them with renderer-produced rows.
- Keep shader/material composition as an open seam. Virtual-texture shader
  indirection should enter through private material binding until the separate
  shader API work defines stable extension points.

Gate:

- Public smoke tests still pass without new public exports.
- New research prototypes can run under `research/**` without touching apps or
  workflows.

### 1. Demand Substrate: Visibility Packets Plus Manifest Bounds

Outcome: every later system consumes the same bounded packet stream.

Work:

- Land private packet extraction in the WebGL backend after the current
  extraction work allows it.
- Prefer manifest bounds for glTF and generated assets. Use loader-derived
  bounds only as a fallback for demos and tests.
- Add packet rows for asset id, material slot index, transform/bounds versions,
  opacity flags, and stable ids derived from ownership rather than frame order.
- Emit texture-demand rows from visible packets, not from scene traversal or
  glTF loader internals.

Gates:

- 10,000 packets culled in less than 1.0 ms after warmup.
- 50,000 packets culled in less than 5.0 ms after warmup.
- No per-frame object allocations in the culling loop after packet buffers are
  built.
- Camera jitter below roughly 0.25 px does not churn the visible set.
- Offscreen stress scenes skip at least 90% of draw submissions.

### 2. Material Texture Resource Substrate

Outcome: ordinary textures and virtual textures bind through the same private
material slot abstraction.

Work:

- Lower public `TextureRef` and glTF material textures into private material
  texture resources: solid color, 2D texture, virtual texture, or fallback.
- Move glTF base-color image ownership toward the shared texture-resource path
  when the private resource API exists.
- Select PNG/RGBA8, KTX2/Basis, or virtual-texture variants from manifest and
  capability rows.
- Keep sampler policy, color space, fallback color, and selected variant in
  diagnostics.

Gates:

- Existing glTF textured fixtures render through the compatibility path while
  private resources are introduced.
- Texture readiness and fallback diagnostics are available without exposing
  WebGL texture handles.
- Variant selection does not require author-facing texture node changes.

### 3. WebGL2 Virtual Texture Runtime For One Material Slot

Outcome: a real private VT path exists for one albedo/base-color slot before
glTF generalization.

Work:

- Build the worker-ready demand/command adapter around the existing
  `VirtualTextureRuntime`.
- Drain upload, evict, page-table, stale-drop, and stats commands on the render
  thread.
- Allocate a private page-table texture and physical atlas resource.
- Bind shader indirection privately for one material slot with fixed low-mip
  fallback.
- Start with transferable buffers. Add SharedArrayBuffer only after transfer,
  allocation, queue-depth, or in-flight-byte measurements justify it.

Gates:

- `vt.averageExactHitRatioAfterWarmup >= 0.95` during slow pan.
- `vt.maxUploadsPerFrame <= 8`.
- Estimated or measured texture upload time stays below 2 ms per frame on
  desktop WebGL2.
- Page-table dirty writes scale with uploads plus evictions; no full rebuilds
  after initialization or context restore.
- `vt.borderMismatchCount === 0` for generated checked pages.
- WebGL1 reports unsupported for VT. WebGL2 with insufficient limits renders a
  fixed low-mip material and labels stats as `fixed-low-mip`.

### 4. Arbitrary glTF Texture Virtualization

Outcome: existing glTF assets can opt into virtualized texture slots through
manifests, not new scene nodes.

Work:

- Add an offline or research-only glTF texture normalizer that reads glTF
  material texture slots and emits manifest rows for texture identity, source
  image URI/hash, UV set, sampler, color space, channel meaning, dimensions,
  mips, page size, border, page ids, and variants.
- Start with `baseColorTexture` on `TEXCOORD_0`. Then add normal, ORM, emissive,
  alpha/cutout, repeated wrap modes, non-square source images, and multiple
  material indices.
- Let `gltf({ asset })` keep its current author-facing shape. The backend
  chooses ordinary 2D texture or virtual texture per material slot from the
  manifest and capabilities.
- Keep runtime glTF parsing out of production identity. If no sidecar/manifest
  exists, fall back to the current direct texture path.
- Preserve one material-resource model for terrain, glTF, impostor atlases, and
  ordinary material textures.

Gates:

- A glTF fixture with multiple materials can mix ordinary 2D and VT slots
  without public API changes.
- VT and non-VT base-color output match within an agreed visual tolerance for a
  static camera when all exact pages are resident.
- Repeated and clamped sampler modes produce no visible page-border seams in
  seam-stress mode.
- Manifest parse and texture-slot lowering remain below 5 ms for small glTF
  fixtures and below 20 ms for large manifest-backed assets, or the asset path
  gets a binary manifest follow-up.
- Unsupported texture semantics fall back to ordinary textures or fixed material
  fallback with diagnostics, not partially virtualized undefined output.

### 5. Dynamic LOD Selection

Outcome: LOD becomes a private packet-to-representation decision with stable
diagnostics.

Work:

- Consume visible packets plus manifest LOD rows to select mesh level, meshlet
  group, impostor representation, or culled state.
- Use screen-error, projected height, distance, and hysteresis policies from
  manifest rows rather than author-facing switches.
- Add a spatial index or cell-level prefilter before per-instance LOD selection.
- Emit `lodSelections`, churn counters, screen-error estimates, and budget
  misses as diagnostics.
- Include material, alpha, shadow, picking, animation, and transform support
  flags in the candidate rejection reasons.
- Keep terrain chunks and object packets in the same selection budget so nearby
  terrain cannot starve object LOD or VT residency.
- Keep cross-fade policy internal until alpha, ordering, and shader/material
  seams are proven.

Gates:

- CPU LOD or meshlet selection under 2 ms for 100,000 meshlets with a spatial
  index, or under 0.5 ms for 10,000 visible-region meshlets.
- Submitted triangles stay within 1.5x of the target screen-error budget.
- LOD switch churn stays below 5% of selected work for small camera steps.
- No false-negative visibility decisions. LOD may draw too much, but it must
  not hide visible geometry.
- Dynamic-impostor pressure check continues to pass or is replaced by a stricter
  runtime-equivalent gate.

### 6. Impostor Integration

Outcome: impostors are a backend representation that uses the same LOD and VT
resource substrate.

Work:

- Map impostor manifest rows into source mesh artifacts, octahedral atlas
  regions, billboard atlas regions, page groups, thresholds, and debug counters.
- Render impostors through private packet kinds: instanced quads first, then
  octahedral direction selection.
- Demand impostor atlas pages through the same VT residency scheduler used by
  glTF and terrain.
- Keep source mesh identity, impostor atlas identity, and runtime page residency
  separate.
- Treat billboard as the first far-representation fallback, not a separate
  authoring feature. Octahedral impostors can refine billboard quality only
  after variant, alpha/depth, picking, and shadow contracts are present.
- Carry previous representation, selected atlas direction, material variant,
  and fallback label through transitions so swapping is debuggable.
- Leave live impostor regeneration out of the first renderer path. It can reuse
  the same manifest concepts later.

Gates:

- Forest fixture remains at or below 5 average draw calls and 27 million
  estimated triangles in the research check, or the runtime equivalent provides
  a stricter GPU-measured replacement.
- Average exact page-hit ratio stays at least 0.955 for the deterministic forest
  camera path after warmup.
- Total LOD switches stay below the current 22,000 check threshold until a
  better churn metric is in place.
- Page evictions remain zero for the default fixture budget, and stress budgets
  label evictions and fallback samples clearly.
- Alpha/cross-fade transitions have debug counters before visual polish work.

### 7. Combined Streaming Route

Outcome: a browser route proves real renderer integration rather than fixture
previews.

Work:

- Build a scene with manifest-backed glTF assets, virtualized glTF texture
  slots, dynamic LOD selection, and impostor atlas residency.
- Expose debug overlay rows for visible packets, selected LODs, material
  resources, page table dirty entries, uploads, evictions, fallback samples,
  and capability path.
- Keep controls limited to debug budgets and route-local toggles. Do not expose
  reusable public nodes or renderer algorithm props.

Gates:

- Smoke route: nonblank canvas, no runtime exceptions, fallback path labeled.
- Perf route: rAF p95 <= 20 ms, rAF p99 <= 33 ms, long-frame ratio <= 0.02
  over 50 ms, final pending pages = 0, sampled pending pages <= 16, and texture
  upload max <= 2 ms.
- No full page-table rebuilds during normal streaming.
- Debug overlay numbers come from renderer runtime rows, not committed fixture
  JSON.

## APIs To Avoid Exposing Yet

- Public `VirtualTextureNode`, `virtualTexture(...)`, `MegaTexture`, or page
  cache controls.
- Public `DynamicImpostorNode`, `ForestNode`, `BillboardLodNode`, or per-object
  impostor thresholds.
- Public `MeshletNode`, raw meshlet ranges, raw LOD chunk ranges, or runtime
  meshlet-building hooks.
- Public `CrossFadePolicy`, `LodPolicy`, `ImpostorAtlas`, `BillboardAtlas`, or
  transition state handles.
- Public culling, occluder, BVH, HZB, or visibility-packet flags.
- Public WebGL extension flags, texture-unit assignments, page-table formats,
  shader defines, or GLSL snippets.
- Public SAB, transferable-buffer, OffscreenCanvas, or worker-ownership knobs.
- Public glTF virtualization flags such as `gltf({ virtualTextures: true })`.
  The manifest and backend capabilities should choose the route.
- A public material graph or shader API just to make VT work. Treat that as the
  separate shader API seam and integrate only after that work defines a stable
  shape.

## Future API Readiness Test

Before exposing anything, the design should pass this test:

- An app can render a manifest-backed asset with automatic mesh LOD, billboard,
  impostor, ordinary textures, and VT textures using the same authoring shape it
  uses for a normal asset.
- The only likely knobs are broad quality and streaming budgets at root, scene,
  or renderer configuration scope.
- Diagnostics explain selected representation, fallback reason, page pressure,
  shadow/picking proxy, and material variant without requiring public access to
  atlas pages, page tables, or switch thresholds.
- Removing all advanced manifests still renders through ordinary mesh and 2D
  texture fallbacks.
- A user cannot accidentally make correctness depend on a single backend
  extension, texture cache size, or hand-picked impostor distance.

## Prototypes Worth Building

1. `research/gltf-vt-normalizer`: read one or two glTF fixtures, emit a
   normalized texture-slot/page manifest, verify hashes, border padding, sampler
   policy, and fallback rows.
2. `research/vt-worker-protocol`: wrap existing VT runtime state in demand and
   command structs, benchmark transfer-buffer pooling, stale-drop behavior,
   queue depth, and in-flight bytes.
3. `research/lod-selection-spatial-index`: extend the dynamic-impostor harness
   with cell or grid prefiltering so the CPU selection target is plausible
   before renderer integration.
4. `research/gltf-vt-visual-oracle`: compare ordinary base-color glTF rendering
   against all-pages-resident VT rendering for a static camera and seam-stress
   views.
5. `research/impostor-atlas-fixture`: generate or validate a tiny octahedral
   atlas plus billboard atlas with page groups, alpha/depth/normal metadata,
   and VT residency rows.
6. `research/combined-streaming-bench`: a CPU-only or headless-browser pressure
   bench that mixes visible packets, glTF material slots, LOD choices, impostor
   pages, and VT upload budgets before the full route lands.

## Open Seams

- Shader API and material composition: this roadmap only needs a private
  virtual-texture material binding hook. It does not design the shader API.
- Alpha ordering and cross-fades: impostor transitions need a clear opaque vs
  alpha packet policy before polished blending.
- KTX2/Basis integration: compression variants should remain manifest choices
  and can follow RGBA8 residency correctness.
- WebGPU: useful later for compute culling, indirect draw compaction, storage
  buffers, and cleaner copy paths, but not required for the WebGL2 proof.
- Binary manifests: JSON is acceptable for research fixtures. Large glTF
  texture manifests, meshlets, and page tables may need a binary path after
  parse-time gates are measured.
