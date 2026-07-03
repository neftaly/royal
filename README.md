# Royal

Royal is the clean package monorepo for the Royal renderer and Royal-owned integrations. Patchpit remains the research, prototype, and commit-history repo; this repo starts from a clean export.

Tarstate control-plane experiments live under `research/`; they are not part of the product workspace surface.

## Packages

- `@royal/examples-react` - source-backed product examples and browser smoke surface.
- `@royal/renderer-core` - DOM-free scene data and authoring helpers.
- `@royal/renderer-webgl` - WebGL renderer implementation.
- `@royal/react` - React JSX/runtime adapter.

## Direction

See [Royal Direction](docs/royal-direction.md) for the current product goals, boundaries, and cleanup priorities.
See [glTF Extension Priority](docs/gltf-extension-priority.md) for the current
WebGL glTF support set, including required extension handling.

## glTF Materials

The WebGL loader supports factor-level `KHR_materials_specular`,
`KHR_materials_ior`, `KHR_materials_clearcoat`, `KHR_materials_sheen`,
`KHR_materials_iridescence`, `KHR_materials_transmission`,
`KHR_materials_volume`, and `KHR_materials_dispersion` for deterministic forward
rendering. Transmission uses renderer-private current-frame color sampling with
volume attenuation; dispersion is approximated as scalar per-channel screen
sampling on that path. Texture fields from these extensions are currently
ignored with renderer diagnostics.

## glTF Image-Based Lights

Optional `EXT_lights_image_based` scene references are parsed as renderer
groundwork and can drive diffuse spherical-harmonic irradiance for glTF
materials. The required specular cubemap path (`specularImages`,
`specularImageSize`, mip/face upload, RGBD HDR unpacking, and `samplerCube` LOD
sampling) is not implemented, so assets that list `EXT_lights_image_based` in
`extensionsRequired` are still rejected.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
