# Royal Terrain Spike

Date: 2026-06-28

## Sources Checked

- Hello Terrain site and docs: https://hello-terrain.kenny.wtf/
- Hello Terrain source: https://github.com/kenjinp/hello-terrain
- Infinigen site: https://infinigen.org/
- Infinigen source/docs: https://github.com/princeton-vl/infinigen
- Royal local source: `packages/renderer-core`, `packages/react`, `packages/royal-tarstate-lens`
- Tarstate source: sibling `../tarstate/packages/core`

## Recommendation

Use a staged path.

V1 should define the terrain runtime contract around current Royal primitives and
Tarstate-style observable state. It should not try to reproduce Hello Terrain's
full WebGPU task graph yet, because Royal's renderer-core currently exposes only
small scene/pass/node descriptions and the WebGL backend hard-fails on non-box
mesh geometry. A v1 runtime/schema proof can still answer the core API question:
can terrain be modeled as queryable chunk assets with provenance, material
assignments, and LOD selection outside the renderer?

V2 should be the renderer/API change. Hello Terrain's strongest ideas require
first-class backend concepts Royal does not yet have: dynamic indexed geometry
buffers, instancing, storage/compute buffers, GPU readback, material/elevation
shader nodes, and render-backend extension points. Adding terrain as a public
core node before those seams exist would create API pressure in the wrong place.
Offline procedural generation should stay a separate asset pipeline concern until
that runtime seam is stable.

## Hello Terrain Architecture Notes

Hello Terrain is built for Three.js WebGPU and React Three Fiber. The core path is:

- A `TerrainGeometry` unit mesh with skirt rings, alternating inner diagonals, and `Uint32Array` indices.
- A `TerrainMesh` extending Three's `InstancedMesh`; visible terrain is many active quadtree leaves rendered as instances.
- A topology-agnostic quadtree that produces typed-array `LeafSet` output: `space`, `level`, `x`, `y`, plus 2:1 balancing.
- Topology plugins for bounded flat, infinite flat, cube-sphere, and torus surfaces. The topology owns neighbor lookup, root tile selection, bounds, and projection.
- A `@hello-terrain/work` graph with `param()` inputs, memoized `task()` nodes, graph-local param ownership, target runs, lanes, reports, and event hooks.
- GPU compute stages for elevation fields, terrain fields, bounds reduction, normal/world-position data, and spatial query/readback support.
- TSL callbacks for elevation/material node composition.
- React wrappers that expose a `useTerrain()` handle with `graph`, `tasks`, `runtime.query`, `runtime.raycast`, `ready`, and generated `positionNode`.

The important idea for Royal is not the exact Three.js/R3F API. It is the split between declarative terrain inputs, a task graph that owns derived assets, and a renderer backend that consumes compact tile instances and GPU-side field data.

## Procedural Generation Correction

Hello Terrain should not be described as an Infinigen-style procedural world generator. Its README calls it a real-time web terrain engine with variable LOD, elevation manipulation, texture painting, TSL elevation/texture assignment nodes, and composable compute stage plugins. Its docs describe an engine for terrain rendering in Three.js WebGPURenderer with tools for procedural terrain authoring.

For Royal, that means Hello Terrain is evidence for the runtime architecture: quadtree LOD, chunk/instance rendering, elevation/material node inputs, compute stages, and query/readback APIs. Infinigen is separate evidence for offline or background procedural asset provenance. The local spike intentionally combines those ideas to test Royal's data model, but that should not be read as a claim about Hello Terrain's feature scope.

## Runtime LOD And Offline Artifacts

The more likely Royal product path is not live Infinigen-quality generation in the browser. Infinigen is probably too slow for that. Treat it as a high-quality offline or server-side asset factory that can render/export large scenes, then publish static assets that Royal can stream: mesh tiles, glTF/GLB chunks, height/normal/albedo/roughness tiles, texture pages, object placement manifests, and provenance records.

That still wants LOD, but the ownership is split. The server/offline pipeline owns expensive quality generation, tile promotion, baking, validation, and artifact hashes. The client owns viewport selection, culling, cache policy, cross-fade/replacement, and querying the current best available artifact. A live demo can still start with cheap placeholder tiles or low-sample renders, then stream better artifacts as they finish, but that should be an asset-version update path rather than the core renderer abstraction.

This points to a holistic LOD model: every terrain/object region has stable identity, bounds, coordinate-system metadata, quality tier, artifact kind, dependencies, and provenance. The runtime asks for "best artifact available within budget" and the asset service can answer with fixed offline tiles, live preview tiles, or upgraded offline renders without changing the render graph shape.

Keep the Blender-backed static tile research in
`research/blender-pipeline/README.md`. This terrain note should only describe the
runtime/API implications: tile identity, artifact selection, renderer upload
requirements, query/readback expectations, and schema fields the runtime needs in
order to consume offline outputs safely.

## Infinigen Relevance

Infinigen is relevant as an offline/background generation model, not as a runtime renderer template and not as a description of Hello Terrain. Its useful ideas for Royal are:

- Treat terrain and objects as generated assets with seed/config provenance.
- Separate generation stages: terrain field, mesh/chunk output, materials, scatters/assets, export/annotation.
- Allow expensive generation to run outside the render frame, then publish chunk manifests and artifacts.
- Keep material/elevation decisions data-driven and reproducible, with enough metadata to regenerate or invalidate chunks.

Royal can borrow the pipeline shape for optional generation: seed plus recipe in,
chunk/material/asset rows out. Blender/Python generation belongs in offline or
server-side asset tooling, not in renderer-core.

## Royal Fit

Current Royal facts:

- `@royal/renderer-core` has `Scene`, `RenderPass`, `RenderNode`, `mesh`, `boxGeometry`, materials, glTF, lights, text, transforms, and explicit coordinate-system helpers.
- `MeshNode.geometry` is typed as `Geometry<GeometryKindValue>`, so source types leave room for custom geometry kinds.
- The WebGL adapter rejects every mesh geometry except `GeometryKind.Box`; custom terrain geometry cannot draw today without backend work.
- Materials are flat `StandardMaterial | UnlitMaterial`; there is no shader-node/material graph.
- `@royal/tarstate-lens` already models app-owned stores as relation rows with diagnostics and write routes. That is a good fit for terrain pipeline state: chunks, assets, readback status, generation jobs, and failures.

This argues for a v1 proof that stays outside public exports and validates the
runtime state model, artifact schema, and budgets first.

## Minimal Runtime Schema Target

Implement first:

1. A pure terrain pipeline state adapter that takes:
   - `seed`
   - `worldId`
   - root/chunk size
   - camera origin
   - LOD thresholds
   - generation recipe version
2. It emits relation-like rows:
   - `terrainChunks`: tile key, level, x/y, bounds, LOD reason, seed, status
   - `terrainAssets`: asset id, chunk id, artifact kind, uri/status/hash/provenance
   - `terrainMaterials`: chunk id, material id, coverage, recipe
   - `terrainGenerationJobs`: chunk id, priority, status, started/finished/diagnostics
3. A runtime artifact contract for one chunk:
   - positions/normals/indices/material ids, or an artifact URI plus dimensions
4. A benchmark that sweeps camera positions and records:
   - LOD update ms
   - selected leaf count
   - vertex/index budget estimate
   - chunk cache hit/miss/change count

Run target for this spike:

```sh
node research/terrain/royal-terrain-v1-spike.mjs
```

Expected first benchmark gates:

- 256 selected chunks or fewer at `maxLevel <= 6`
- LOD selection under 2 ms on local Node for five camera samples
- manifest/material/provenance row generation averaging under 15 ms for the same samples
- deterministic chunk ids/provenance for the same seed and recipe
- stable diff count when the camera moves less than one chunk hysteresis threshold

## Standalone Runtime Prototype

`royal-terrain-v1-spike.mjs` is a standalone prototype. It does not import Royal and does not participate in the workspace build. It proves the data path Royal can wrap now:

- deterministic chunk ids and seed-derived heights
- quadtree-style flat terrain LOD
- material classification from generated elevation/slope
- optional offline-generator provenance metadata
- relation-like rows suitable for a future tarstate lens
- benchmark output for frame-to-frame chunk churn

This is intentionally not a renderer patch. The current WebGL backend would need new buffer/geometry handling before it could render these chunks directly.

## API Pressure

Likely v2 API/backend seams:

- `IndexedGeometry` or `GeometryAsset` in renderer-core, with typed arrays or asset handles.
- Renderer backend extension for geometry upload/cache/dispose independent of `BoxGeometry`.
- Instanced mesh node or draw packet node for many terrain leaves with one shared geometry.
- Material policy that can represent generated material fields, texture arrays, or shader-node inputs.
- WebGPU backend resource model: storage buffers, compute passes, readback buffers, and async readiness.
- Tarstate terrain lens package rather than bloating the existing layout lens.
- Explicit asset provenance fields: `seed`, `recipe`, `generator`, `inputsHash`, `sourceCoordinateSystem`, `artifactHash`.

## Risks And Blockers

- Rendering blocker: current WebGL renderer only draws boxes.
- Backend mismatch: Hello Terrain relies on WebGPU compute and Three TSL; Royal has a WebGL root and no shader graph.
- Public API risk: exposing terrain nodes too early would freeze assumptions about geometry, materials, and async generation.
- Performance risk: chunk churn and buffer upload policy matter more than the quadtree algorithm itself.
- State risk: generated chunks need cancellation/backpressure and stale-result diagnostics, not just rows.
- Source-of-truth risk: Infinigen-style offline assets need clear invalidation rules so seeds/config changes do not silently reuse stale artifacts.

## Next Step

Proceed on two tracks:

1. Prove the terrain runtime schema outside public package exports: chunk rows,
   artifact rows, material coverage, generation/readiness status, provenance,
   coordinate-system metadata, LOD budget fields, and deterministic invalidation
   keys.
2. Validate offline manifests in `research/blender-pipeline`: artifact hashes,
   bounds, coordinate-system conversion, seed/revision invalidation, tile index
   shape, and diagnostics needed before any renderer consumes a static tile.

Only after both tracks are stable should renderer-core grow a narrow terrain
dependency, such as a private indexed geometry draw path or asset-backed geometry
cache. Do not add Blender/Python generation to renderer-core, and do not expose a
public terrain component before the backend geometry/material seams exist.
