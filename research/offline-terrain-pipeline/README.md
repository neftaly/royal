# Offline Terrain Pipeline POC

Date: 2026-06-28

## Scope

This research area defines a fast proof of contract for offline terrain assets
before Royal runtime terrain APIs exist. It is intentionally asset-first and
runtime-agnostic: Blender, Infinigen, or a render farm can produce durable files;
Royal or any other viewer can later consume the manifest without depending on
current package exports.

The checked-in POC is light. It contains a schema, an example manifest, and a
Node harness that generates tiny deterministic placeholder artifacts. It does
not require Blender, a GPU, or Royal app/package code.

## Pipeline Contract

Each terrain build publishes immutable files plus a JSON manifest:

- `manifestVersion`: contract version for this research manifest.
- `world`: stable world identity, coordinate system, units, and generator seed.
- `tile`: stable tile/page identity, bounds, terrain dimensions, and runtime
  selection metadata. Tile/page identity must not change when preview output is
  replaced by high-quality output.
- `lod`: stable LOD records for mesh and material promotion. Each LOD names
  mesh artifacts, texture artifacts, preview renders, and quality metadata.
- `meshes`: durable mesh artifacts, preferably `.glb` or `.gltf` plus optional
  sidecar diagnostics. Mesh records include vertex/index counts, bounds, hashes,
  and source stage ids.
- `materialTextures`: durable texture slots such as PNG development outputs and
  KTX2-ready slots for albedo, normal, roughness, height, and masks.
- `previews`: lightweight renders for review, thumbnails, and CI inspection.
- `provenance`: source recipe, git revision, source scene path, generator
  command, input hashes, machine hints, and creation time.

The manifest is the source of identity and cache policy. GLB, PNG, KTX2, and
preview files are content-addressed artifacts referenced by the manifest, not
implicit runtime state.

## World Index And Seams

`fixtures/world-index.json` models a small multi-tile terrain world without
depending on Royal runtime APIs. It contains a stable world identity, four tile
entries, per-tile manifest URIs, grid coordinates, bounds, neighbors, and seam
metadata. One tile points at the committed `sample-manifest.json`; the remaining
tile entries show how later durable tile manifests can be referenced before the
runtime adapter exists.

Validate the world index and seam metadata with:

```sh
node research/offline-terrain-pipeline/validate-world-index.mjs
```

The validator is CPU-only Node code. It checks that tile IDs, page IDs, manifest
URIs, grid coordinates, bounds, neighbor links, reciprocal seam links, seam edge
names, border hashes, and seam deltas agree. This lets an artist or build worker
render adjacent tiles on a GPU host, publish durable per-tile manifests plus a
world index, and catch mismatched borders before Royal consumes those manifests
later through a private runtime adapter.

## Durable Outputs

Prefer these output families:

- Meshes: `model/gltf-binary` GLB for runtime loading; optional `model/gltf+json`
  glTF during debugging.
- Images: PNG for low-friction development previews; KTX2/Basis-compatible slots
  for final compressed material pages.
- Metadata: JSON manifest, JSON tile/page indexes, and JSON generation reports.
- Preview renders: PNG thumbnails, orbit renders, debug overlays, and tile
  contact sheets.

The contract does not assume a Royal renderer node, material API, backend cache,
or app route. A future runtime adapter should read the manifest, choose the best
available LOD/artifact for budget and device capabilities, then map artifacts
into the renderer privately.

## Local POC

Generate a tiny sample bundle:

```sh
node research/offline-terrain-pipeline/offline-terrain-pipeline.mjs --write
```

Validate the committed example and generated bundle:

```sh
node research/offline-terrain-pipeline/offline-terrain-pipeline.mjs --check
node research/offline-terrain-pipeline/validate-world-index.mjs
```

The harness writes `sample-output/` with:

- `manifest.json`
- `meshes/tile-lod0.glb`
- `textures/albedo-lod0.png`
- `textures/normal-lod0.png`
- `textures/material-mask-lod0.png`
- `textures/albedo-lod0.ktx2.placeholder.json`
- `previews/tile-lod0-preview.png`
- `reports/build-report.json`

The GLB is a tiny placeholder with a valid GLB container and metadata JSON
chunk. The PNG files are deterministic 1 x 1 images. The KTX2 entry is a JSON
placeholder so the contract can model the final compressed slot without checking
in heavy texture data.

`sample-output/` is generated and ignored. Commit real artifacts only when they
are small enough for review or explicitly needed as fixtures.

## Later High-Quality Blender/Infinigen Run

A high-quality production run should keep the same manifest shape and replace
only artifact quality/revision fields:

1. Generate terrain source data with a fixed `world.id`, `tile.id`, seed, and
   recipe version.
2. Run Infinigen or Blender in batch mode on a GPU host to produce high-density
   terrain meshes, material passes, scatters, and preview renders.
3. Export terrain tile meshes as GLB/glTF with explicit coordinate-system
   metadata and stable bounds.
4. Bake material pages to PNG for inspection and KTX2/Basis variants for runtime
   upload.
5. Render review previews: thumbnail, orbit stills, material debug overlays, and
   tile-neighbor seam checks.
6. Write one manifest per tile/page plus a world index manifest that records
   tile grid placement, neighbors, and seam hashes.
7. Validate artifact existence, hashes, dimensions, LOD identity, provenance,
   reciprocal neighbors, and seam metadata before publishing.

Sketch:

```sh
blender --background --factory-startup \
  --python path/to/offline_terrain_export.py -- \
  --world royal-offline-terrain-demo \
  --tile x0-z0 \
  --seed royal:offline-terrain:demo:001 \
  --quality final \
  --out dist/offline-terrain/royal-offline-terrain-demo/x0-z0
```

For Infinigen-backed source scenes, use the Infinigen job to create the source
scene and Blender export stage, then normalize the resulting GLB, material
textures, previews, and provenance into this manifest. Keep source-scene paths
and generator commands in `provenance`; keep runtime consumption out of the
exporter.

## Decomplection Notes

This area separates generation concerns from runtime consumption:

- Offline generation owns quality, baking, previews, hashes, and provenance.
- The manifest owns durable identity, artifact relationships, and LOD policy.
- Future Royal adapters own renderer-specific loading and cache behavior.

Do not add public Royal package APIs from this POC. The next useful change is a
separate adapter spike that reads the manifest as plain data after renderer asset
lifetimes are clearer.
