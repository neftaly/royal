# Changelog

Royal follows semantic versioning once packages are published. Until then,
versions identify source-level prerelease checkpoints in this repository.

## Unreleased

### Contact surfaces

- Add one backend-neutral `surfaceDepth: "contact"` intent to filled `mesh`,
  `gltf`, and `gltfInstances` nodes so intentionally coplanar visual surfaces
  win near-equal depth comparisons without changing transforms or bounds.
- Map that intent to one private fixed WebGL fill bias while retaining ordinary
  alpha, sorting, picking, outlines, LOD, instancing, and depth-prepass paths.
- Keep raw depth functions, bias parameters, render-order numbers, automatic
  contact inference, and ordering between multiple contact layers out of the
  public API.

## 0.0.9 - 2026-08-07

### Correctness

- Preserve the correct retained GPU geometry when direct triangle descriptors
  are reordered, replaced with same-sized values, or share a compact candidate
  key; exact typed-array value equality now proves reuse.
- Copy public direct-triangle arrays at canonicalization so caller mutation
  cannot silently alter renderer-owned geometry.
- Recompute ordinary and virtual-texture descriptor identities from their
  current values, allowing reconciled descriptor objects to change `src` or
  explicit `version` without retaining stale texture work.
- Make the browser context-restoration smoke wait for final glTF, texture,
  geometry, and optional virtual-texture fidelity instead of treating an
  available lifecycle alone as recovery.

### Architecture and performance

- Centralize canonical geometry equality in the surface functional core and
  use allocation-free typed-array comparisons without temporary byte views.
- Bucket direct geometry by compact value-derived candidates, prove equality
  only within each bucket, and keep ordinary candidate ordering independent of
  scene traversal.
- Remove object-identity texture memoization that obscured descriptor value
  changes and duplicated ownership rules.

### Verification

- Added focused same-size replacement, reorder, forced-collision, defensive
  ownership, reconciled texture identity, explicit-version reload, and
  context-restoration readiness tests.
- Passed 872 tests across 118 files, lint, typecheck, production builds, bundle
  gates, package imports, and the packed TypeScript/runtime consumer.

## 0.0.8 - 2026-08-07

### Correctness

- Match every public `EulerRads` tuple to Three.js's default
  `Euler(x, y, z, "XYZ")` matrix semantics without an order option or legacy
  compatibility path.
- Apply the convention to render objects, cameras, environments, root
  transforms, and packed Euler instance streams while leaving authored glTF
  quaternions and explicit matrices unchanged.
- Decompose orbit camera poses into the corrected XYZ convention so existing
  orbit views remain aimed at their target across ordinary and gimbal-boundary
  angles.

### Verification

- Added an executable Three.js oracle for representative and 128 generated
  rotations with translation and signed scale, plus generated camera-inverse,
  orbit-target, instance-stream, and glTF-quaternion controls.
- Passed 863 tests across 117 files, lint, typecheck, production builds, bundle
  gates, package imports, and the packed TypeScript/runtime consumer.
- Passed hardware WebGL smoke for ordinary orbit rendering and glTF instancing;
  the focused camera drag measured 0.30 ms input-handler and renderer-callback
  p95 with 0.42 ms GPU p95.

## 0.0.7 - 2026-08-06

### Outline presentation

- Batch exact-compatible glTF outline occurrences while borrowing their
  resident geometry, active LOD, instance provenance, and ordered primitive
  semantics instead of rebuilding the world or uploading duplicate geometry.
- Reuse overlapping mask samples and decoded normals, pair exact binary resolve
  samples, discard unused mask depth, and restrict sampled presentation work to
  conservative projected bounds without resolution, browser, or quality-policy
  branches.
- Keep allocation, budget, and optional shader failures on the same correct
  ordinary ordered mask path.

### WebXR

- Start an immersive session without blocking renderer setup on the optional
  preferred-frame-rate request.
- Make the ordinary Tiger example use one solid guide/outline presentation;
  retain its shimmer-prone three-way one-pixel partition only as the explicit
  `?coverage=partitioned` stress case.

### Verification

- Reduced the 72-outline Quest 2 lab from 21.33--22.23 ms median to
  8.38--8.39 ms median / 13.49--14.23 ms p95 over two warm-up-inclusive
  600-frame runs, with eight submissions per frame.
- Reduced the default Tiger Quest example from roughly 46 to 22 submissions per
  frame; its resident repeat held 21 VT pages with no pending, failed, or upload
  work and measured 8.37 ms median / 9.69 ms p95 after entry.
- Passed 855 tests across 117 files, lint, typecheck, production builds, public
  package imports, measured bundle gates, and the packed TypeScript/runtime
  consumer before release.

## 0.0.6 - 2026-08-05

### Progressive presentation

- Prepare selected material-LOD base images globally from the lowest authored
  preview toward the preferred level, while retaining base-color-first slot
  ordering and shared texture identity.
- Select a material level only after its base presentation is GPU-resident, so
  a pending or failed preferred image preserves the nearest drawable preview.
- Share one validated material-LOD edge reader between early planning and
  canonical preparation, preventing the two paths from drifting.

### Verification

- Added browser-level texture-binding coverage for failed preferred images,
  settlement-order property coverage, and cross-primitive/variant ordering
  controls.
- Kept the affected lazy and worker bundles within their existing gzip
  ceilings without raising ratchets.

## 0.0.5 - 2026-08-04

### Correctness

- Retain exact source-occurrence provenance inside automatic instance batches,
  allowing a glTF outline to borrow one same-root or cross-root member without
  outlining unrelated instances or duplicating GPU geometry.
- Match source transforms against their exact float32 instance storage while
  preserving missing, ambiguous, pending, inactive-LOD, and authored-instance
  behavior.

### Rendering lifecycle

- Removed the asset-wide outline instancing exclusion and its world-scene
  re-lowering path. Adding, replacing, or removing an outline now preserves
  automatic world cohorts and their instance buffers.

## 0.0.4 - 2026-08-03

### Rendering

- Automatically lower exact-compatible repeated static opaque glTF surfaces
  into the existing instanced submission path while preserving authored
  occurrence-level picking.
- Keep alpha blending, transmission, LOD, explicit instances, render-object
  bindings, mixed handedness, outlines, and non-triangle geometry on their
  correctness-first paths.
- Compare embedded geometry and pixel payloads exactly, and derive stable
  cohort transform revisions without relying on source object identity.

## 0.0.3 - 2026-08-02

### Correctness

- Reacquire decoded image pixels when a live root retires and later reclaims
  ordinary GPU texture storage, preventing closed browser image sources from
  being uploaded after transient scene replacement or React hot refresh.

### Tooling

- Added deterministic JSON bundle attribution for Draco, Meshopt, KTX2, SVG,
  environment, transmission, and XR without weakening the existing size gates.

## 0.0.2 - 2026-08-02

### Correctness

- Distinguished unversioned, numeric, and string virtual-texture identities,
  while canonicalizing omitted and explicit default color-space/sampler values.
- Validated complete focused-status references instead of discarding malformed
  presentation-only fields, and made every subscription boundary validate
  callbacks consistently after root disposal.
- Made shared screen-space partition allocation rollback atomic and required
  surface owners to receive the root-owned pattern dependency explicitly.
- Rejected malformed scene node collections with a stable authoring error.

### Browser and React behavior

- Removed partial scheduling, pointer, size-observation, and WebGL capability
  fallbacks below Royal's Safari 17 browser floor. Missing `ResizeObserver`
  now fails explicitly instead of leaving element-only layout changes stale.

### Documentation

- Consolidated overlay, displaced-edge, screen-space partition, resize, and
  depth-policy behavior into the permanent specifications.
- Removed completed proposals and historical implementation plans from the
  active documentation set.
- Recorded the currently failing bundle and packed-renderer size ratchets
  without raising their ceilings.

## 0.0.1 - 2026-08-02

### Public API

- Standardized every focused lifecycle union on the `status` discriminator,
  matching XR and removing the former `FooStatus.state` naming mismatch.
- Renamed the authored descriptor types to `Scene`, `SceneNode`, and
  `SceneToneMapping`, avoiding confusion with the imperative renderer root.
- Changed `createOrbitCameraController` to one options object and exposed its
  composition-only camera as `orbit.camera`; camera mutation remains owned by
  the controller.
- Removed unused render-object identity/version counters and the mutable
  `defaultImageTextureSampler` constant from the public surface.
- Normalized glTF and ordinary-image descriptor references on `src`, matching
  their constructors, while retaining explicit `manifestUri` for authored
  virtual textures.
- Preserved `pickingId` on pick targets instead of renaming it to a generic
  `id` at the result boundary.
- Folded material `variantNames` and selected-scene node, primitive, and light
  counts into `useGltfAssetStatus()`, and removed the duplicate
  `useGltfAssetVariants()` subscription API.
- Renamed `useCanvasSize()` layout dimensions to `cssWidth` and `cssHeight`,
  keeping them distinct from `backingWidth` and `backingHeight`.
- Removed required internal `kind` discriminators from texture-status identity
  objects and made every focused status hook reject misspelled input fields.
- Kept authored `standardMaterial` values named `metallic` and `roughness` in
  both constructor input and normalized public output.
- Added an explicit scene-linear `tint` multiplier for textured standard and
  unlit materials, keeping solid `color` authoring unambiguous.
- Added `sceneIndex` to glTF and glTF-instance descriptors and their focused
  status identity, selecting one exact document scene before mesh, Draco, and
  image inventory.
- Moved pure orbit authoring helpers from the React runtime barrel to
  `@royal/react/scene`, alongside the rest of the pure scene vocabulary.
- Removed browser-session test-port types and the scene-only `WorldPosition3`
  alias from React runtime entrypoints; browser ports stay internal and authored
  coordinate types remain on `@royal/react/scene`.
- Kept authored vertex normals smooth across non-degenerate model scales by selecting
  the authored-normal shader path explicitly; derivative face normals remain
  the fallback only for geometry that actually omits normals.
- Expanded packed-consumer and bundle gates across React scene observation,
  XR, picking proxies, instances, glTF authoring, and entrypoint ownership; glTF
  scene authoring adds about 1.1 kB gzip to the measured Royal initial path.
- Decoupled coherent PBR map publication from WebGL bindings: the functional
  core now consumes a compact residency mask, keeps paced map groups atomic,
  and publishes successful maps once failed sibling slots settle to their
  semantic-neutral behavior without changing authored material factors.
- Standardized authoring failures on `TypeError` for malformed values and
  `RangeError` for invalid finite ranges, and stopped silently clamping invalid
  normalized sRGB input.
- Exposed one root-scoped `gltfResourceReader` dependency on imperative and
  React canvases, with source kind, URI/version identity, abort propagation,
  and Royal-owned shared-read claims instead of per-node loader callbacks.
- Added a cold borrowed prepared-glTF geometry visitor so spatial tools can
  reuse selected canonical triangles and transforms without another read,
  decode, or renderer-owned physics policy.
- Added `tint` to glTF and bulk glTF-instance nodes as a scene-linear
  presentation multiplier, reusing prepared geometry, textures, variants, and
  equal canonical materials without rewriting source assets.
- Made focused asset-status hooks explicitly accept complete constructor refs as
  well as minimal identities, while retaining semantic identity as their only
  subscription key.

### Examples

- Added the unchanged official external Duck Draco variant as a glTF Lab oracle,
  covering worker preparation, lazy decoder loading, external buffers, ordinary
  images, and visual equivalence with the uncompressed Duck.
- Added an authored ground-plane preset to the VT stress example and made the
  automated close-view oracle exercise it at 10 cm, including physical Safari
  17.14 evidence at DPR 2.
- Added compositor screenshots to opt-in performance traces and expanded GPU
  draw labels to identify transmission, volume, environment, lighting, alpha,
  and specular shader variants.
- Added a selectable glTF scene gallery for Sponza, A Beautiful Game, Virtual
  City, and Damaged Helmet, with source-pinned Khronos fixtures and browser
  smoke coverage for every entry.
- Added a URL-backed selector for all three document scenes in the Bistro web
  workload without copying or rewriting its source asset.
- Made every rendered glTF Lab oracle fit from its prepared selected-scene
  bounds, replacing the fixed camera that clipped wide transmission grids.
- Corrected the synthetic WebXR layer's framebuffer contract and made fake-XR
  reports reject inactive or zero-frame sessions instead of presenting window
  RAF timing as XR evidence.

### Renderer

- Localized VT mip demand across large perspective-varying triangles with four
  bounded allocation-free subdivision levels, preserving close ground-plane
  detail without tessellating rendered geometry.
- Made unsupported optional glTF extension payloads opaque to required-placement
  validation while recursively validating extension payloads Royal executes,
  preserving core `KHR_texture_transform` behavior in the official mixed
  clearcoat oracle.
- Decoupled intermediate geometry and texture commitment from scene
  presentation, cutting the Bistro startup profile from 3,185 to 1,110 draws
  while preserving urgent first-usable and terminal frames.
- Bounded early texture-budget inspection to fixed 24-byte PNG, 30-byte WebP,
  and 16 KiB JPEG prefixes while retaining a bounded AVIF container prefix,
  without changing the browser-authoritative decode fallback.
- Consolidated shader validation at program link, allowing both stages to
  compile before one synchronization while preserving stage-specific failure
  logs without successful-path status polling.
- Ordered depth-writing transmission front-to-back ahead of alpha-blended
  transmission, preserving screen-space composition while allowing early depth
  rejection in overlapping glass and volume scenes.
- Latched scheduled render failures until an explicit scene, backing-size,
  context, or imperative retry boundary, preventing pending progressive work from
  repeatedly consuming RAF callbacks and flooding the console.
- Split thin transmission from nonzero-thickness volume at shader selection,
  keeping refraction and attenuation work out of thin-walled fragments while
  retaining the same canonical material and composite path.
- Extended optional `WEBGL_multi_draw` submission to exact-compatible
  transmission and alpha runs after depth sorting, preserving logical draw
  order while cutting the Bistro motion profile from 382 to about 178 WebGL
  submissions per frame without changing renderer CPU p95.
- Made ordinary browser texture decode fall back to a budget-fitted DOM
  image/canvas path when `createImageBitmap` is absent or rejects the source,
  preserving source dimensions and GPU admission semantics.
- Limited rough-transmission scene-color storage to the mip prefix reachable by
  visible authored roughness, preserving the original LOD mapping while
  avoiding unreachable target memory and mip generation.
- Made incremental texture publication compare retained GPU bindings as well as
  shader features, so replacing a resident image cannot leave an old texture
  handle in an otherwise compatible draw packet.
- Added required `EXT_meshopt_compression` and ordinary
  `KHR_mesh_quantization` ingestion through demanded async preparation. Meshopt
  source ranges decode before the existing canonical accessor path and the
  decoder remains outside the initial bundle.
- Compacted prepared glTF binary storage to selected final buffer views after
  codec work, dropping compressed source ranges, fallback holes, and
  unselected-scene bytes before semantic lowering.
- Moved canonical texture-coordinate transforms below glTF ingestion so direct
  surfaces and VT do not pull the glTF parser into the initial graph.
- Rejected `KHR_mesh_quantization` use that omits its required document
  declaration before reads or codec work begin.
- Removed avoidable opaque-frame frustum work, clear-color iteration, and
  repeated per-primitive glTF tint-key construction from retained hot paths.
- Made queued browser texture work reject immediately on cancellation and
  release abandoned decode/preparation closures before earlier active work
  settles.

### Initial workspace checkpoint - 2026-07-14

Initial source-level prerelease for application development inside the Royal
workspace.

#### React authoring

- Added the `<Canvas>` scene host, orbit-camera controls, frame invalidation,
  picking events, renderer lifecycle observation, and glTF asset status hooks.
- Added pure scene factories through `@royal/react/scene` and explicit WebXR
  session integration through `@royal/react/xr`.
- Defined scene-linear color types, metric units, camera/transform defaults,
  and discriminated loading and failure states.

#### Renderer

- Added WebGL2 rendering for built-in meshes, lighting, image and virtual
  textures, glTF assets and instances, material variants, picking, and WebXR.
- Added bounded diagnostics, resource-governor policies, context recovery,
  async demand scheduling, and explicit renderer-root ownership boundaries.

#### Packaging and validation

- Added narrow package export maps and tarballs that exclude source and build
  metadata.
- Added clean packed-package consumer validation covering TypeScript React
  usage and every documented runtime entrypoint.
- Added unit, property, integration, hardware browser, context-loss, and WebXR
  regression coverage.

The packages were not published to a registry at this checkpoint.
