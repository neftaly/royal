# Royal Asset Manifest Research

This research area defines the first small contract between offline Blender
output and a future Royal runtime asset path. It intentionally stays outside
examples and renderer packages while WebGL extraction is in flight.

## Contract Shape

The source Blender pipeline still owns `research/blender-pipeline/out/manifest.json`.
The Royal-facing contract is the normalized view a loader should derive from
that manifest before touching renderer code:

- `contractVersion`: version for this Royal research contract.
- `worldId`, `tileId`: stable identity. These do not change when preview output
  is replaced by a final artifact.
- `stage`: generation stage and status from the source manifest.
- `revision`: pipeline revision that invalidates artifacts when generator code
  or inputs change.
- `coordinateSystem`: explicit source and runtime axes. Runtime assets are
  expected to be right-handed, meters, `+Y` up, and `-Z` forward.
- `tile`: terrain tile dimensions and bounds, including a fixed page identity
  for runtime cache/service replacement.
- `artifacts`: static files with media type, bytes, SHA-256, and role.
- `assets`: static object records with kind, bounds, source object names,
  provenance, and the tile/page identity they belong to.
- `lod`: stable page/revision policy for preview/final replacement.

The contract is deliberately manifest-first. The runtime should be able to
cull, budget, cache, and ask an asset service for replacements without opening a
GLB. GLB loading is the final artifact step, not the identity source.

## LOD Policy

Use fixed tile/page identities and revisioned content:

- `tileId` identifies the terrain/object page.
- `pageId` identifies a renderable page within a tile and remains stable across
  preview and final artifacts.
- `revision` identifies generated content for the same page.
- `quality` may move from `preview` to `final`, but it must not create a new
  tile/page identity.
- Client and server replacement should be expressed as "same page, newer
  revision or better quality", not as dynamic chunk-quality ids.

That keeps render graph and cache identity stable while allowing offline or
server-generated assets to promote over time.

## Validator

Run the prototype validator against the committed Blender fixture:

```sh
node research/asset-manifest/validate-blender-manifest.mjs
```

It checks:

- source manifest schema, stage, revision, world, and tile fields
- Royal/glTF coordinate-system expectations
- terrain and global bounds consistency
- asset ids, kinds, object names, bounds, stage, and provenance
- artifact file existence, byte size, hash, media type, and status
- stable LOD identity policy for the derived contract

The script prints the normalized contract summary as JSON when validation
passes.

## First Runtime Example Step

Once WebGL extraction settles, add a small example-side adapter that imports this
contract shape as data and resolves the `model/gltf-binary` artifact URI into
the existing glTF mesh path. Keep the first example read-only:

1. Load and validate the manifest before rendering.
2. Register `tileId` and `pageId` in example state as stable identities.
3. Render the best available GLB artifact for the page.
4. Keep terrain bounds and asset records available for culling/debug overlays.
5. Replace preview with final by updating artifact revision/quality on the same
   page id.

Do not add public terrain APIs until indexed/custom geometry and backend asset
lifetimes are settled.
