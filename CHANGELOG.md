# Changelog

Royal follows semantic versioning once packages are published. Until then,
versions identify source-level prerelease checkpoints in this repository.

## 0.0.17 - 2026-08-11

### Correctness and contracts

- Accept linker-elided `normalTransform` uniforms for standard geometry without
  authored normals. The derivative-normal shader no longer fails on Firefox or
  WebKit, and avoids an inert matrix upload on every such draw.
- Add `screenSpaceSegment({ start, end, material })` as the single
  world-anchored fixed-presentation-width guide primitive inside
  `SceneOverlay`. It reuses `edgeMaterial` color, width, and complementary
  coverage semantics.
- Encode scene-linear edge and segment RGB at the sRGB presentation boundary.
  Outline colors previously wrote raw linear components into the display
  buffer while direct unlit overlays applied the documented encoding.

### Architecture and performance

- Retain segment endpoints in one root-budgeted float32 buffer, batch
  consecutive equal styles through instanced draws, and expand per view in the
  vertex shader. Endpoint replacement does not republish the world; unchanged
  frames upload no segment geometry; scenes without segments construct no
  segment pipeline.
- Make the overlay kind-lane order explicit: direct meshes, then segments, then
  outline postprocessing, with relative authored order retained within each
  kind.

### Verification

- Exercise no-normal standard geometry in real Chromium, Firefox, and WebKit.
- Render 4-CSS-pixel guides at different perspective depths in all three
  engines. Their solid centers encode `[0.2, 0.6, 0.9]` to the identical
  `rgb(124, 203, 243)`, plus focused descriptor, batching, DPR/coverage,
  unchanged-frame, packed-consumer, and context-restoration tests. The examples
  browser smoke also requires a segment's instanced draw on a real WebGL2
  context instead of accepting a mock-only implementation.

## 0.0.16 - 2026-08-11

### Correctness and contracts

- Preserve AVIF alpha when an ordinary texture is resized to its fair GPU
  budget. Firefox's encoded or decoded `createImageBitmap` resize replaces the
  alpha channel with another colour channel; Royal now materializes only
  budget-resized AVIF pixels through a 2D canvas before WebGL upload.
- Keep native-size AVIF decoding and direct PNG/WebP fitting unchanged. The
  selection follows declared or inferred image format and contains no browser,
  device, application, or user-agent policy.

### Verification

- Reproduce the public Probability ruler defect in the complete scene and
  trace its first textured draw: Chromium retained `87/255` alpha while Firefox
  produced `249/255` from the same AVIF and blend state.
- Reduce the defect to browser decode/upload operations, then force the exact
  ruler through Royal's fitted-texture path. Chromium, Firefox, and WebKit all
  produce `rgb(154, 181, 200)` at the sampled body pixel after the fix.
- Complete 912 tests across 121 files, typecheck, warning-free renderer lint,
  production builds, package entrypoint and packed-consumer checks, and bundle
  gates. The change adds 138 bytes to lazy gzip and 621 bytes to the packed
  renderer, with no initial-runtime or worker growth.

## 0.0.15 - 2026-08-10

### Correctness and contracts

- Distinguish unavailable WebGL2 creation from a context already or concurrently
  lost through the public `RendererContextCreationError` reason.
- Install lifecycle listeners before the context request and make root
  construction transactional, with reverse-order rollback for completed owners
  and complete listener cleanup when any construction stage fails.
- Recover React `Canvas` from creation-time context loss only after the browser's
  matching restoration event, on the same canvas and without timer retries or a
  renderer-owned page-lifecycle policy.

### Verification

- Cover pre-existing loss, loss during capability reads, late-construction
  rollback, recovery-listener cleanup, and non-loss error propagation with
  focused tests.
- Force a real WebGL context loss inside the first browser `getContext` call and
  verify one restoration, a second construction attempt, the identical sole
  canvas, and a rendered scene.
- Complete 912 tests across 121 files, typecheck, warning-free lint, production
  builds, package entrypoint and packed-consumer checks, and bundle-size gates.
  Lazy chunks and the worker remain unchanged while the release measures
  136,261 initial, 279,916 deployed, and 220,608 Royal-only gzip bytes; the
  packed renderer is 642,609 bytes.

## 0.0.14 - 2026-08-10

### Correctness and contracts

- Extend the invariant opaque depth prepass to outside-camera scenes only when
  they render directly to a multisampled default framebuffer and retained
  camera-facing bound coverage is at least 2x. Sparse views, composite targets,
  coverage-dependent materials, transmission, lines, and unlit work remain on
  their established single pass.
- Require exact depth equality for color draws covered by the invariant
  position-only pass, while preserving less-or-equal depth for every other
  draw and separating incompatible multi-draw runs.
- Discard the renderer-owned default-framebuffer depth attachment only after
  all ordinary canvas passes finish. Offscreen composite and external/XR
  framebuffer lifecycles remain unchanged.

### Architecture and performance

- Keep outside-view admission in a cold, allocation-free retained classifier;
  no route, asset, browser, device, or measured-frame branch enters submission.
- On a physical A10 iPad at 2048 x 1008 with four samples, alternating Settlers
  runs measured 19--20 ms median / 24--25 ms p95 after exact equality and final
  depth discard, around an equality-only control at 26 / 32 ms. Bistro retained
  147 submissions and a pixel-identical capture at 28 / 35 ms.
- Reject redundant color-pass depth-write suppression and offscreen-composite
  depth discard after matched physical controls showed no gain and a regression,
  respectively. The final measured packed renderer remains below its 641,000-byte
  ceiling, and lazy and worker bundle budgets do not increase.

### Verification

- Cover depth-function transitions in both directions, exact-depth multi-draw
  partitioning, final default-depth invalidation, outside-view admission, sparse
  rejection, and retained-plan storage reuse.
- Complete 906 tests across 121 files, typecheck, lint, production builds,
  package entrypoint and packed-consumer checks, and bundle-size gates. Physical
  Safari repeats Settlers in alternating order; Bistro settles 202/202 images
  with RMSE 0 output; Sponza completes 120/120 full-DPR moving frames with all
  69 images resident and no warning, failure, or WebGL error.
- Mutation-test the injected real-WebGL ownership oracle itself, proving that it
  rejects inherited element-array writes, native/model binding divergence, and
  sticky buffer-target changes while accepting an explicitly rebound owner.
- Require the WebXR Tiger smoke to observe a default-VAO index preparation, not
  merely an unrelated instanced draw, before accepting the forced combined-edge
  path as exercised.
- Removing the production VAO bind makes the deterministic regression, seeded
  state-sequence test, and source-fitness boundary fail independently. The exact
  forced route passes on both NVIDIA/Vulkan WebGL and CI-equivalent SwiftShader.

## 0.0.13 - 2026-08-09

### Correctness and contracts

- Bind Royal's non-drawing default VAO before preparing a combined outline
  index buffer, so resource creation cannot rewrite the element binding retained
  by the world VAO left current by a preceding draw.
- Specify VAO ownership and sticky WebGL buffer targets explicitly. State-shadow
  invalidation is not treated as a repair for mutated resource state.

### Architecture and performance

- Keep the fix to one cold-path VAO bind when a combined geometry allocation is
  created; ordinary and retained-frame submission gain no production query,
  allocation, fallback, or per-draw branch. The packed renderer is 639,366 bytes
  under the unchanged 640,000-byte ceiling.
- Add an architecture-fitness roster for every direct production
  `ELEMENT_ARRAY_BUFFER` write. New write owners fail review until they establish
  a local VAO boundary and are added deliberately.

### Verification

- Add a semantic WebGL fake that models current and deleted VAOs, retained
  element bindings, sticky buffer targets, context generations, implicit
  mutations, and the index resource consumed by each draw.
- Run 32 deterministic 24-step ownership sequences across absent, single, and
  batched overlays, replacement, publication states, budget denial, viewport
  changes, repeated frames, and context restoration.
- Instrument real WebGL2 draws, including instanced, range, array, and
  `WEBGL_multi_draw` paths, and compare each indexed submission with the native
  `ELEMENT_ARRAY_BUFFER_BINDING`. The forced multi-primitive Tiger outline,
  complete hardware-WebGL browser sweep, and context-loss restoration pass with
  no ownership or native GPU violations.

## 0.0.12 - 2026-08-08

### Correctness and contracts

- Treat coincident glTF occurrences as interchangeable sources for non-picking
  edge presentation only when asset version, selected scene, primitive geometry,
  authored instance cohort, complete source transform, and active LOD agree.
- Preserve missing-source failure and displaced `sourceTransform` semantics
  without exposing application occurrence IDs or reusing picking identity.

### Architecture and performance

- Isolate borrowed-source equivalence in an allocation-free functional core and
  stop automatic-cohort matching at the first exact source member.
- Keep the existing bundle and package ceilings: the measured Royal initial and
  deployed graphs are 135,424 and 279,075 gzip bytes, while the source-map-bearing
  packed renderer is 639,267 bytes.

### Verification

- Added focused source-equivalence and renderer integration coverage for
  coincident ordinary occurrences, automatic instances, authored instance
  cohorts, multi-primitive assets, malformed provenance, and distinct source
  identities.
- Passed 891 tests across 119 files, typecheck, lint, production builds,
  package imports, packed TypeScript/runtime consumption, virtual-texture build
  validation, bundle-size gates, the hardware-WebGL browser sweep, and browser
  context-loss restoration.

## 0.0.11 - 2026-08-07

### Correctness and contracts

- Remove the prerelease `surfaceDepth: "contact"` API after the reduced
  Probability reproduction showed that a single semantic polygon offset cannot
  classify arbitrary glTF primitives or guarantee continuous coplanar depth.
- Specify small physical separation as the portable representation for visually
  distinct world surfaces. Royal explicitly rejects automatic near-depth
  tie-breaking because every generic tolerance can override real geometry.

### Architecture and performance

- Remove contact classification from canonical surfaces and automatic-instance
  identity, and delete the renderer's otherwise-unused depth-bias packet,
  transition, multi-draw partition, and WebGL polygon-offset state paths.
- Reduce the named synchronous/deployed gzip allowance from 4,250 to 4,100
  bytes over the 0.0.6 reference and ratchet the packed renderer ceiling from
  641,024 to 640,000 bytes around the measured 639,183-byte artifact.

### Verification

- Passed 879 tests across 118 files, typecheck, lint, production builds,
  package imports, packed TypeScript/runtime consumption, virtual-texture build
  validation, and bundle-size gates.

## 0.0.10 - 2026-08-07

### Correctness and contracts

- Validate nested material, texture, edge-material, canvas-size, and React
  pointer-handler records at their public composition boundaries, including
  symbol and non-enumerable own keys.
- Keep picking-only direct geometry out of visual draw records, avoid preparing
  it when picking is disabled, and preserve the exact proxy in the picking scene.
- Document `useCanvasSize().pixelRatio` as the requested ratio; backing limits
  may produce a lower applied render scale.

### Architecture and performance

- Retain resource-dependent outline mask plans across frames and views, scan
  borrowed geometry without per-frame candidate collections, and reuse one
  packed visible-transform upload across stereo draws.
- Reuse outline visibility, batch, packet, and clear workspaces, omit transforms
  outside every submitted view, and release context-invalid retained plans on
  abandonment.
- Clear only live and formerly-live LOD selection slots rather than each typed
  workspace's complete historical high-water capacity.
- Keep lazy and worker payload budgets unchanged; the complete boundary and
  retained-frame work adds about 0.75 kB gzip to the synchronous/deployed graph.
- Ratchet the packed renderer ceiling to 641,024 bytes around the measured
  639,837-byte artifact; core and React package ceilings remain unchanged.

### Verification

- Passed 883 tests across 118 files, lint, typecheck, clean production builds,
  package imports, packed TypeScript/runtime consumption, and bundle gates.
- Passed the complete local hardware-WebGL browser smoke, including direct
  materials, picking, ordinary/virtual texture transitions, glTF, Tiger SVG,
  LOD, instancing, and the emulated WebXR route.

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
