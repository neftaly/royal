# Blender Terrain POC

This is a low-quality handoff pipeline for offline terrain research. It turns a
small JSON recipe into durable files Royal can consume later: a GLB tile, PNG
material/preview artifacts, a tile manifest, and a small build report.

It is intentionally outside `packages/*` and app routes. The goal is to prove the
handoff shape for Blender/Infinigen-generated assets without adding renderer
APIs or workspace package-manager changes.

## Quick Run

From the repository root:

```sh
node tools/blender-terrain-poc/run.mjs
```

The wrapper looks for `blender` on `PATH`. If Blender is installed elsewhere, set
`BLENDER` or pass `--blender`:

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender \
  node tools/blender-terrain-poc/run.mjs
```

Without Blender installed, the wrapper fails before doing work and prints the
exact Blender command it would run.

Validate the checked fixture and, when present, generated output:

```sh
node tools/blender-terrain-poc/validate.mjs
node tools/blender-terrain-poc/validate.mjs --out tools/blender-terrain-poc/out/low
```

## Low-Quality Output

Default output goes to `tools/blender-terrain-poc/out/low/` and is ignored. A
successful run writes:

- `manifest.json`
- `meshes/terrain-tile.glb`
- `textures/albedo-preview.png`
- `textures/normal-preview.png`
- `textures/material-mask-preview.png`
- `previews/tile-preview.png`
- `reports/build-report.json`

The checked `fixtures/sample-manifest.json` is a tiny handoff fixture that shows
the same records without committing generated binary assets.

## Higher-Quality PC Run

Use the same tile identity and raise the recipe quality knobs:

```sh
node tools/blender-terrain-poc/run.mjs \
  --config tools/blender-terrain-poc/config/low.json \
  --out dist/blender-terrain/royal-blender-terrain-poc/x0-z0 \
  -- \
  --quality high \
  --segments 128 \
  --texture-size 1024 \
  --preview-size 1024
```

For a gaming PC handoff, commit or upload the output directory only when the
assets are intentionally small enough for review. Otherwise hand off the output
bundle out-of-band and commit the manifest plus build report. Keep:

- stable `world.id`, `tile.id`, `tile.pageId`, bounds, and grid coordinates
- GLB mesh tiles under `meshes/`
- PNG review textures and previews under `textures/` and `previews/`
- later KTX2/Basis texture pages beside the PNG sources
- `manifest.json` and `reports/build-report.json` with seed, Blender version,
  recipe revision, inputs hash, artifact hashes, and the exact command

## VT/LOD Handoff

The manifest keeps tile/page identity separate from artifact quality. A later
Royal loader can read it as plain data, select an LOD by `screenSpaceError`, and
feed:

- `meshes[]` into an indexed-geometry or asset-backed geometry cache
- `materialTextures[]` into virtual-texture page upload or compressed texture
  promotion
- `previews[]` into CI/review thumbnails and low-budget placeholders
- `tile.bounds` and `tile.grid` into culling, neighbor lookup, and page residency

This POC does not define public Royal package exports. Renderer VT/LOD work
should consume this manifest through a private adapter after runtime asset
lifetime and upload policy are clear.
