# Royal

Royal is the clean package monorepo for the Royal renderer and Royal-owned integrations. Patchpit remains the research, prototype, and commit-history repo; this repo starts from a clean export.

Royal links `@tarstate/core` from the sibling Tarstate repo for app and lens integrations. The generic Tarstate core package and Tarstate demo app live outside this repository.

## Packages

- `@royal/renderer-core` - DOM-free scene data and authoring helpers.
- `@royal/react` - React JSX/runtime adapter and WebGL root implementation.
- `@royal/tarstate-lens` - Royal-specific Tarstate lens and v1 API.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
