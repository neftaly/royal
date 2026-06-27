# Royal

Royal is the clean package monorepo for the Royal renderer and Tarstate core. Patchpit remains the research, prototype, and commit-history repo; this repo starts from a clean export.

## Packages

- `@tarstate/core` - relation schemas, query evaluation, diagnostics, and writes.
- `@royal/renderer-core` - DOM-free scene data and authoring helpers.
- `@royal/react` - React JSX/runtime adapter and WebGL root implementation.
- `@royal/tarstate-lens` - Royal-specific Tarstate lens and v1 API.
- `react-royal-fiber` / `react-regl-fiber` - compatibility aliases over `@royal/react`.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
