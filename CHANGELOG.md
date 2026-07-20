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

- Added a selectable glTF scene gallery for Sponza, A Beautiful Game, Virtual
  City, and Damaged Helmet, with source-pinned Khronos fixtures and browser
  smoke coverage for every entry.

### Renderer

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
