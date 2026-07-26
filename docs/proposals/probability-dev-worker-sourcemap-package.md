# Ship or remove the emitted worker source-map reference

Status: resolved in Royal's package build.

## Consumer failure

Probability links `@royal/react` and allows the Royal workspace through Vite's
development filesystem boundary. Loading a real game through the literal root
`pnpm dev` command makes Vite transform:

`packages/renderer-webgl/dist/assets/static-preparation-worker-ZZTflNtN.js`

The emitted worker ends with:

```text
//# sourceMappingURL=static-preparation-worker-ZZTflNtN.js.map
```

but that sibling map is absent. Vite reports:

```text
Failed to load source map for .../static-preparation-worker-ZZTflNtN.js
ENOENT: no such file or directory, open '...static-preparation-worker-ZZTflNtN.js.map'
```

This is a Royal distribution-integrity issue rather than a Probability runtime
adapter concern. Probability should neither suppress the diagnostic nor patch
Royal's generated output.

## Requested outcome

Every shipped JavaScript asset either ships the source map named by its
`sourceMappingURL`, or omits that reference. Apply the rule to emitted worker
assets as well as entry chunks.

## Resolution

Royal intentionally omits the separately bundled static-preparation worker map
from the published package. The build now also removes that worker's trailing
`sourceMappingURL` comment. After output normalization, the package build walks
every emitted JavaScript file recursively and fails if any remaining
file-relative `sourceMappingURL` target is missing.

This keeps ordinary entry and chunk maps while making the map-less worker
self-consistent. Probability does not need a warning suppression or linked
package patch. A clean Royal build followed by Probability's literal root
`pnpm dev` and loaded Settlers fixture produced no missing-map server
diagnostic.

## Acceptance

1. Build or pack Royal using the normal release path.
2. For every emitted `.js` file containing a `sourceMappingURL`, resolve the
   reference relative to that file and assert the target exists in the package.
3. Link the packed result into a minimal Vite development consumer and load the
   worker path without a missing-source-map server diagnostic.

The package-integrity assertion is the important regression boundary; it avoids
coupling Royal's tests to Probability or to a particular worker hash.
