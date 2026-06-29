# Royal Cheap Blender Pipeline

This is a local stand-in for an offline/static tile asset pipeline. It does not
depend on Infinigen yet; the goal is to prove the shape of a Blender-backed
generator that can publish small web-usable artifacts and enough metadata for a
Royal runtime or asset service to choose them later.

## Runnable Handoff POC

The current low-quality handoff tool lives in `tools/blender-terrain-poc/`. It
wraps Blender with a clear missing-Blender failure path, reads a small JSON
recipe, exports a GLB terrain tile plus primitive proxy assets, writes PNG
texture/preview artifacts, and validates the manifest shape Royal VT/LOD work can
consume later. Keep generated output out of app examples unless it is promoted as
an actual verified demo asset.

## Run

```sh
/usr/bin/blender --background --factory-startup \
  --python research/blender-pipeline/generate_scene.py -- \
  --out research/blender-pipeline/out
```

The default output directory is anchored to this pipeline directory, so the same
command can be run from any repo working directory. Use `--seed` and
`--revision` to intentionally invalidate generated terrain/assets:

```sh
/usr/bin/blender --background --factory-startup \
  --python research/blender-pipeline/generate_scene.py -- \
  --seed "royal:cheap-blender-static-tile:001" \
  --revision "cheap-blender-pipeline@0.1.0"
```

The script writes:

- `out/royal-cheap-blender-tile.glb` when Blender's glTF exporter is available.
- `out/manifest.json` with coordinate-system metadata, tile bounds, asset bounds,
  revision/stage/provenance, artifact hashes, and export diagnostics.
- `out/timings.json` with scene/export/manifest timings and export artifact
  file sizes.

The checked fixture should stay small and scoped to `out/`. Regenerate it with
the command above rather than committing ad hoc larger Blender exports.

The fixture scene is intentionally cheap: one heightfield terrain mesh plus four
primitive asset groups, using deterministic seed-derived placement and material
assignment. Blender remains the source authoring coordinate system, while the
manifest describes the exported Royal/glTF web system as right-handed `+Y` up and
`-Z` forward.

## Mapping To Offline Static Tiles

The manifest is the important contract, not the specific terrain recipe. A future
asset service can treat each Blender run as a tile build stage:

- `worldId` and `tileId` give stable identity.
- `revision`, `recipe`, `seed`, and `inputsHash` describe invalidation inputs.
- `bounds` and per-asset bounds let the runtime cull, stream, or query tiles
  without opening the GLB.
- `artifacts` give URI/path, media type, byte size, and content hash for cache
  and promotion.
- `coordinateSystem` records the source-to-export axis mapping so later Blender,
  Infinigen, and web runtime stages do not silently disagree.

That matches the planned offline model: expensive generators produce immutable
tile artifacts and lightweight manifests; Royal chooses the best available tile
or asset version for the current view and budget.

## Next Benchmarks

- Sweep tile sizes and terrain segment counts, then record generation time,
  export time, GLB size, vertex count, and bounds accuracy.
- Add a multi-tile run that writes one manifest per tile and a world index
  manifest.
- Compare primitive assets with imported or Blender-procedural proxy libraries.
- Add deterministic thumbnail/render output for review without loading the GLB.
- Validate GLB loading in an isolated demo before touching renderer package APIs.
