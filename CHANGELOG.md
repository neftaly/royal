# Changelog

Royal follows semantic versioning once packages are published. Until then,
versions identify source-level prerelease checkpoints in this repository.

## Unreleased

### Public API

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
- Moved pure orbit authoring helpers from the React runtime barrel to
  `@royal/react/scene`, alongside the rest of the pure scene vocabulary.
- Standardized authoring failures on `TypeError` for malformed values and
  `RangeError` for invalid finite ranges, and stopped silently clamping invalid
  normalized sRGB input.

### Examples

- Added an authored ground-plane preset to the VT stress example and made the
  automated close-view oracle exercise it at 10 cm, including physical Safari
  17.14 evidence at DPR 2.
- Added compositor screenshots to opt-in performance traces and expanded GPU
  draw labels to identify transmission, volume, environment, lighting, alpha,
  and specular shader variants.
- Added a selectable glTF scene gallery for Sponza, A Beautiful Game, Virtual
  City, and Damaged Helmet, with source-pinned Khronos fixtures and browser
  smoke coverage for every entry.
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

## 0.0.1 - 2026-07-14

Initial source-level prerelease for application development inside the Royal
workspace.

### React authoring

- Added the `<Canvas>` scene host, orbit-camera controls, frame invalidation,
  picking events, renderer lifecycle observation, and glTF asset status hooks.
- Added pure scene factories through `@royal/react/scene` and explicit WebXR
  session integration through `@royal/react/xr`.
- Defined scene-linear color types, metric units, camera/transform defaults,
  and discriminated loading and failure states.

### Renderer

- Added WebGL2 rendering for built-in meshes, lighting, image and virtual
  textures, glTF assets and instances, material variants, picking, and WebXR.
- Added bounded diagnostics, resource-governor policies, context recovery,
  async demand scheduling, and explicit renderer-root ownership boundaries.

### Packaging and validation

- Added narrow package export maps and tarballs that exclude source and build
  metadata.
- Added clean packed-package consumer validation covering TypeScript React
  usage and every documented runtime entrypoint.
- Added unit, property, integration, hardware browser, context-loss, and WebXR
  regression coverage.

The packages remain private and are not available from a registry at this
checkpoint.
