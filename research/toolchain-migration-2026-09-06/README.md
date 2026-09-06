# Toolchain migration, 2026-09-06

Following maintenance commit c0a99893, migrate pnpm 10.34.5 → 12.3.4,
TypeScript 6.0.3 → 7.0.2, Vitest 4.1.11 → 5.0.0, oxlint 1.70.0 →
1.81.0, and oxlint-tsgolint 0.23.0 → 7.0.2001. No renderer dependency
or feature changes are included. The package version stays at 0.0.21;
this work is not a release.

## Compatibility changes

- TypeScript 7 performs source checking and declaration emission. It has no
  stable JavaScript compiler API, so the architecture test imports the official
  `@typescript/typescript6` 6.0.2 package. This dependency is development-only.
  It also checks generated declarations in the isolated packed consumer, ensuring
  consumers do not need to migrate their compiler to use Royal.
- Two existing negative type tests now put their `@ts-expect-error` directives
  on the invalid properties where TypeScript 7 reports diagnostics. Their
  prohibited API examples and expected rejection remain unchanged.
- Vitest 5 passes the suite with its default automatic mock-history clearing;
  no compatibility switch or test exclusion was needed.
- pnpm 12 is provisioned here as a native executable. The previous smoke runner
  always sent `npm_execpath` to Node and failed parsing its ELF bytes as JS.
  `pnpmCommand` now dispatches JS CLIs through Node and native CLIs directly,
  without shell interpolation. Five regression cases cover native paths,
  three JavaScript extensions, and PATH fallback.
- The isolated consumer declares its overrides in `pnpm-workspace.yaml`.
  Its React dependency uses the exact installed version instead of a `link:`
  specifier, allowing pnpm 12 to resolve and enforce its peer range. Installation
  uses strict peer checking. The rest of the compiler/type fixtures remain local
  links; both `tsc` and `tsc6` run over the installed package declarations.
- The examples Vite config now imports the shared config with its explicit .ts
  extension, addressing Vite's native-config warning.

## Validation

953 tests across 133 files pass on Vitest 5. TypeScript 7 checking, native lint,
all package/example builds, packed consumer imports and exact codec geometry,
and both compiler versions' consumer type checks pass. The package and bundle
budgets pass unchanged (257,279 total fixture gzip bytes). Fresh and existing
workspace `pnpm install --frozen-lockfile` checks pass; a clean workspace runs
TypeScript 7.0.2, Vitest 5.0.0 and oxlint 1.81.0. Root peer checks report no
issues, and pnpm audit reports zero advisories.

Every emitted package JavaScript file has the same SHA-256 as before this
migration, recorded in runtime-hashes.json. The preceding dependency update's
runtime timing evidence remains applicable; this migration makes no new
cold-start, FPS, or hardware-speed claim. No timed compiler-speed claim is made.

The temporary Probability copy was restarted through literal root `pnpm dev`
and its actual port 3004 used for five Play checks: history preview/restore,
SVG texture rasterization, map gestures, one-finger piece drag, and loading the
rebuilt Royal module without failed JS/module requests, page errors or a Vite
error overlay. The real Probability checkout was not modified.

## Upstream references

- [TypeScript 7 and the absent stable programmatic API](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Vitest 5 migration guide](https://vitest.dev/guide/migration/)
- [pnpm 11 changes](https://github.com/pnpm/pnpm/releases/tag/v11.0.0)
- [pnpm 12 changes](https://github.com/pnpm/pnpm/releases/tag/v12.0.0)
