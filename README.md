# Royal

Royal is the clean package monorepo for the Royal renderer and Royal-owned integrations. Patchpit remains the research, prototype, and commit-history repo; this repo starts from a clean export.

Royal links `@tarstate/core` from the sibling Tarstate repo for app and lens integrations. The generic Tarstate core package and Tarstate demo app live outside this repository.

## Packages

- `@royal/examples-react` - source-backed product examples and browser smoke surface.
- `@royal/renderer-core` - DOM-free scene data and authoring helpers.
- `@royal/renderer-webgl` - WebGL renderer implementation.
- `@royal/renderer-webgpu` - WebGPU capability/probe package while backend semantics settle.
- `@royal/react` - React JSX/runtime adapter.
- `@royal/tarstate-lens` - Royal-specific Tarstate lens and v1 API.

## Direction

See [Royal Direction](docs/royal-direction.md) for the current product goals, boundaries, and cleanup priorities.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
