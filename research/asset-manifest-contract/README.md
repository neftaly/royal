# Asset Manifest Contract Research

This directory is an unstable research-only proposal for normalizing asset manifest
vocabulary across current Royal research outputs. It is not exported from any
package, is not a public API, and should not be used as a compatibility promise.

The current research manifests are intentionally left untouched:

- `research/virtual-texturing/demo-assets/manifest.json`
- `research/offline-terrain-pipeline/fixtures/sample-manifest.json`
- `research/offline-terrain-pipeline/fixtures/world-index.json`
- `research/dynamic-impostors/fixtures/sample-forest-impostor-manifest.json`

The normalized fixtures in `fixtures/` translate those source manifests into a
single proposed vocabulary so renderer, tooling, and content-pipeline work can
compare concepts without forcing the source research files or public package APIs
to converge too early.

## Proposed Vocabulary

- `asset`: stable research identity, kind, revision, and quality.
- `world`: world id, units, coordinate-system policy, and optional camera or seed
  metadata.
- `bounds`: typed spatial records with explicit spaces such as `world`,
  `virtual-texture`, `atlas`, `tile`, and `object`.
- `artifacts`: concrete files or asset URIs, including textures, meshes, reports,
  stats, previews, and debug overlays.
- `pages`: addressable residency/page-table units for virtual textures, terrain
  tiles, and impostor atlas regions.
- `lod`: normalized levels and representation transitions that reference
  artifacts and pages by id.
- `residency`: upload budgets, cache/page-group policy, fallback behavior, and
  prefetch priorities.
- `previews`, `debug`, `provenance`, and `extensions`: non-runtime metadata used
  to keep demos inspectable without making runtime contracts unstable.

## Validation

Run the research-only validator from the repository root:

```sh
node research/asset-manifest-contract/validate-normalized-fixtures.mjs
```

The validator is deliberately small. It checks that normalized fixtures have the
required top-level records, unique ids, well-formed typed bounds, and valid
references between pages, artifacts, LOD levels, previews, debug records, and
residency page groups. It does not make the schema stable.
