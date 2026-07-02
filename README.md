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
`KHR_materials_ior`, `KHR_materials_clearcoat`, `KHR_materials_transmission`,
and `KHR_materials_volume` for deterministic forward rendering. Transmission
uses renderer-private current-frame color sampling with volume attenuation;
texture fields from these extensions are currently ignored with renderer
diagnostics.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
