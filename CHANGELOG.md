# Changelog

Royal follows semantic versioning once packages are published. Until then,
versions identify source-level prerelease checkpoints in this repository.

## Unreleased

### Public API

- Normalized glTF and ordinary-image descriptor references on `src`, matching
  their constructors, while retaining explicit `manifestUri` for authored
  virtual textures.
- Preserved `pickingId` on pick targets instead of renaming it to a generic
  `id` at the result boundary.
- Folded material `variantNames` into `useGltfAssetStatus()` and removed the
  duplicate `useGltfAssetVariants()` subscription API.

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
