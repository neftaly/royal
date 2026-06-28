# Private Renderer Foundations Plan

Date: 2026-06-28

## Scope

This plan connects the current research lanes into a private implementation
order for `@royal/renderer-webgl`. It does not add public renderer APIs, public
algorithm nodes, package exports, examples, or shared package configuration.

Owned implementation surface for this document:

- `research/renderer-foundations/**`

Future implementation patches should keep the same principle: public Royal
scene nodes continue to describe scenes, meshes, materials, text, and assets.
Visibility packets, path lowering, virtual-texture page tables, cache policy,
and terrain LOD selection are renderer-private mechanics until there is a
stable product reason to expose a smaller public contract.

## Current Research Inputs

The plan joins these lanes:

- `research/visibility-packets`: typed packet buffers, conservative bounds,
  CPU frustum culling, and culling benchmarks.
- `research/asset-manifest`: stable tile/page/asset identities, bounds,
  artifacts, provenance, coordinate-system policy, and LOD replacement rules.
- `research/pathfinder-svg`: SVG parsing/extraction adapter shape and packed
  path command output.
- `research/svg-tiger-demo`: full/fallback tiger demo gates and provenance
  policy.
- `research/virtual-texturing`: virtual texture manifest, page-table/cache
  model, upload budgets, fallback modes, and demo readiness gates.
- `research/terrain`: terrain chunk rows, asset/provenance rows, LOD benchmark
  gates, and renderer pressure points.

The WebGL package currently draws boxes, glTF primitives, and vector text
through private caches. `packages/renderer-webgl/src/render-graph.ts` still
rejects non-box mesh geometry, so indexed/path geometry must land before tiger
or terrain can render through the normal mesh path.

## Implementation Order

### 1. Visibility Packets

Build the first private packet extractor in `@royal/renderer-webgl`.

Deliverables:

- A frame-local `VisibilityPacketBuffer` built from one `RenderPass`.
- Bounds adapters for box mesh, glTF manifest rows when available, current
  vector text assets, and fallback demo bounds.
- CPU sphere-vs-frustum culling that writes a dense visible index list.
- Private diagnostics: packet count, visible count, culled count, cull time,
  bounds-source counts, and rejected draw submissions.

Why first:

- Virtual textures need visible material/asset demand.
- Terrain LOD needs camera/pass identity and visible tile bounds.
- Path/tiger rendering needs a packet identity and bounds contract before it
  becomes another draw source.
- Draw code stops owning traversal, visibility, resource lookup, and GL
  submission in one step.

Decomplection:

- Keep extraction, culling, and drawing as separate private modules.
- Keep object allocation in extraction only; culling reads typed arrays.
- Do not add `VisibilityNode`, culling flags, or public packet exports.

### 2. Asset Manifest Adapter

Add a private manifest normalizer consumed by WebGL caches and examples later.

Deliverables:

- Manifest rows for stable `worldId`, `tileId`, `pageId`, `assetId`, `revision`,
  coordinate system, artifact URI/hash/media type, and bounds.
- A manifest lookup that can answer "bounds for asset" and "best artifact for
  page" without opening a GLB or image payload.
- Runtime identity policy for replacement: same page id plus newer revision or
  better quality, not a new render object identity.
- Validation hooks that reuse the research manifest checks before assets are
  accepted by renderer-private caches.

Why second:

- Packets can initially use direct node-derived bounds, but glTF, terrain,
  virtual textures, and generated assets need manifest-first identity before
  streaming or LOD work can be trusted.

Decomplection:

- Keep manifest parsing/validation outside draw code.
- Keep artifact identity separate from WebGL buffer/texture object lifetime.
- Do not turn terrain pages, virtual textures, or SVG payloads into public
  render graph nodes.

### 3. Indexed Geometry Backbone

Introduce the private data and upload path needed by SVG paths and terrain.

Deliverables:

- `IndexedGeometryData` as the backend-neutral internal geometry payload.
- A `GeometryCache.indexed(...)` private path that uploads positions, optional
  normals, optional UVs, optional colors/material ids, and indices.
- Draw helpers that can bind indexed geometry without going through the
  box-only `asBoxGeometry` path.
- Support for `Uint16Array` first, with `Uint32Array` gated by WebGL extension
  or WebGL2 capability.

Why third:

- It removes the current box-only blocker.
- SVG-filled paths and terrain chunks can both lower to indexed triangles.
- glTF primitive handling can later converge on the same buffer ownership
  shape, reducing duplicated buffer lifecycle code.

Decomplection:

- Split geometry data, geometry upload, and draw binding.
- Keep the existing public `Geometry<Kind>` escape hatch untouched.
- Do not expose `IndexedGeometry` publicly until examples prove the shape.

### 4. SVG Path Geometry

Lower SVG extraction output into private indexed draw data.

Deliverables:

- `Path2dGeometryData` as the renderer-private path payload.
- A path tessellation/lowering stage that converts filled paths into
  `IndexedGeometryData`.
- Bounds from command coordinates before upload, stored on packet rows.
- Tiger/fallback manifest rows that map source SVG, provenance, packed path
  artifact, screenshot artifact, and benchmark metadata.

Why fourth:

- It depends on indexed geometry for rendering.
- It provides a real non-box geometry workload before terrain complexity.
- It proves packed asset payloads can feed WebGL without making SVG parsing a
  route component or public renderer feature.

Decomplection:

- Keep SVG parsing in the asset pipeline.
- Keep path tessellation separate from WebGL buffer upload.
- Keep source/provenance mapping in manifests, not renderer shader code.

### 5. Material Texture Resources

Add private texture-resource indirection behind current material binding.

Deliverables:

- Backend material resources that resolve a material slot to a solid color,
  normal 2D texture, virtual texture, or fallback texture.
- Resource lifetime tracking for WebGL textures independent from glTF loader
  internals.
- Capability-selected texture variants from the asset manifest.
- Diagnostics for selected variant, fallback reason, upload bytes, and texture
  readiness.

Why fifth:

- Virtual texturing needs a material slot to bind page table/cache/fallback
  resources without adding a public `VirtualTextureNode`.
- glTF and future manifest-backed materials should share texture ownership.

Decomplection:

- Keep author-facing materials stable.
- Keep texture resource selection separate from shader program choice.
- Move ad hoc glTF texture ownership toward reusable private cache primitives
  only when the new resource path is ready.

### 6. Virtual Texture Resources

Implement the WebGL-private virtual texture runtime.

Deliverables:

- Page loader driven by manifest page ids, URIs, hashes, variants, color space,
  and border-padded dimensions.
- Physical cache atlas with LRU or clock eviction.
- Page-table texture with dirty-entry updates proportional to uploads and
  evictions.
- Residency scheduler that consumes visible packet material demand.
- Parent fallback lookup, one-ring prefetch, upload page/byte budgets, and
  seam-candidate diagnostics.
- WebGL2 route first; WebGL1 derivative fallback or fixed low-mip fallback when
  capability rows require it.

Why sixth:

- It needs packets for demand, manifests for identity, and material resources
  for binding.
- It can render through existing or indexed geometry once the material path is
  private and resource-based.

Decomplection:

- Keep page loading, residency, page-table encoding, cache eviction, and shader
  binding as separate private modules.
- Keep page-table/cache formats backend-owned.
- Do not expose megatexture or page-cache controls as public scene nodes.

### 7. Tiger Demo

Land the SVG tiger route only after path payloads can render through private
indexed geometry.

Deliverables:

- Manifest row for full Ghostscript tiger or fallback tiny tiger.
- Packed path artifact generated by the SVG-to-path pipeline.
- WebGL draw path using `Path2dGeometryData -> IndexedGeometryData`.
- Demo controls limited to debug views; the route should not parse SVG at
  runtime.
- Screenshot/canvas acceptance and complexity checks from the tiger plan.

Why seventh:

- It is the first visible proof for path asset extraction.
- It should validate provenance, source mapping, packed bytes, draw coverage,
  and nonblank rendering without introducing public path nodes.

Decomplection:

- Keep the demo as an asset-pipeline consumer.
- Keep full tiger licensing/provenance beside the source asset.
- Keep renderer diagnostics generic enough for other path assets.

### 8. Terrain And LOD

Land terrain only after indexed geometry, manifests, packets, and virtual
texture resource hooks exist.

Deliverables:

- Private terrain chunk rows: tile key, level, x/y, bounds, LOD reason, seed,
  status, and revision.
- Manifest-backed terrain assets: mesh chunk artifacts, material/texture page
  references, provenance, and quality tier.
- LOD selector that emits stable visible chunk/page demand for packets and
  virtual texture residency.
- Chunk geometry upload through `IndexedGeometryData`, initially non-instanced.
- Later instancing once draw packet and buffer lifetimes are proven.

Why eighth:

- Terrain touches every earlier foundation: visibility, asset identity, indexed
  geometry, material resources, virtual textures, and LOD/cache policy.
- Landing it earlier would force public API decisions before private backend
  contracts have had real workloads.

Decomplection:

- Keep LOD selection outside draw submission.
- Keep generated/offline asset provenance outside renderer-core.
- Keep terrain examples behind manifest/resource rows, not public terrain nodes.

## Internal Data Contracts

These contracts are private implementation targets. Names may live under
`packages/renderer-webgl/src/internal` or equivalent, but they should not be
exported from package public entry points.

### Packet Bounds

```ts
interface PacketBounds {
  readonly center: readonly [number, number, number];
  readonly radius: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly source:
    | "asset-manifest"
    | "box-geometry"
    | "gltf-loader"
    | "path-geometry"
    | "terrain-tile"
    | "text-layout"
    | "procedural";
  readonly boundsVersion: number;
}
```

Rules:

- Bounds are conservative.
- Sphere is the fast cull path.
- AABB stays available for debug overlays, screen-rect work, HZB, and tighter
  future tests.
- `boundsVersion` changes when geometry, layout, elevation range, or manifest
  content changes.

### Visibility Packet Buffer

```ts
interface VisibilityPacketBuffer {
  readonly count: number;
  readonly idHi: Uint32Array;
  readonly idLo: Uint32Array;
  readonly kind: Uint16Array;
  readonly flags: Uint32Array;
  readonly assetIndex: Int32Array;
  readonly instanceIndex: Int32Array;
  readonly materialIndex: Int32Array;
  readonly boundsSource: Uint16Array;
  readonly centerX: Float32Array;
  readonly centerY: Float32Array;
  readonly centerZ: Float32Array;
  readonly radius: Float32Array;
  readonly minX: Float32Array;
  readonly minY: Float32Array;
  readonly minZ: Float32Array;
  readonly maxX: Float32Array;
  readonly maxY: Float32Array;
  readonly maxZ: Float32Array;
  readonly transformVersion: Uint32Array;
  readonly boundsVersion: Uint32Array;
  readonly visibilityVersion: Uint32Array;
  readonly sortKey: BigUint64Array | Uint32Array;
  readonly visibleIndices: Uint32Array;
  readonly visibleCount: number;
}
```

Rules:

- Stable ids derive from ownership: `worldId`, `passId`, owner path, node key,
  asset id, and instance ordinal.
- Packet indices are frame-local and dense.
- Culling mutates visible output only; extraction owns packet population.
- Draw grouping and virtual texture demand consume `visibleIndices`.

### IndexedGeometryData

```ts
interface IndexedGeometryData {
  readonly id: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly topology: "triangles";
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  readonly colors?: Float32Array | Uint8Array;
  readonly materialIds?: Uint16Array;
  readonly bounds: PacketBounds;
  readonly revision: string | number;
}
```

Rules:

- Positions are 3D, even when generated from 2D path data.
- Indices are `Uint16Array` until vertex counts or terrain chunks require
  `Uint32Array`; gate `Uint32Array` by WebGL capability.
- `revision` invalidates cached WebGL buffers for the same id.
- `materialIds` are optional and private; do not turn them into public shader
  nodes in the first pass.

### Path2dGeometryData

```ts
interface Path2dGeometryData {
  readonly id: string;
  readonly viewBox: readonly [number, number, number, number];
  readonly opcodes: Uint8Array;
  readonly coords: Float32Array;
  readonly pathRanges: Uint32Array;
  readonly styles: readonly Path2dStyleData[];
  readonly fillRule: "nonzero" | "evenodd";
  readonly transformVersion: number;
  readonly sourceRevision: string;
  readonly bounds: PacketBounds;
}

interface Path2dStyleData {
  readonly fill: readonly [number, number, number, number];
  readonly stroke?: readonly [number, number, number, number];
  readonly strokeWidth?: number;
  readonly opacity: number;
}
```

Rules:

- This is an asset payload, not a public node.
- Curves may be retained in source payload, but WebGL v1 rendering consumes a
  tessellated `IndexedGeometryData` product.
- Source SVG/provenance/debug mapping belongs in the manifest row.

### Material Texture Resources

```ts
type MaterialTextureResource =
  | SolidColorTextureResource
  | Texture2dResource
  | VirtualTextureResource;

interface SolidColorTextureResource {
  readonly kind: "solid-color";
  readonly color: readonly [number, number, number, number];
}

interface Texture2dResource {
  readonly kind: "texture-2d";
  readonly assetId: string;
  readonly colorSpace: "linear" | "srgb";
  readonly sampler: MaterialSamplerPolicy;
  readonly fallbackColor: readonly [number, number, number, number];
  readonly revision: string;
}

interface VirtualTextureResource {
  readonly kind: "virtual-texture";
  readonly assetId: string;
  readonly pageTableId: string;
  readonly physicalCacheId: string;
  readonly fallbackTextureId: string;
  readonly sampler: MaterialSamplerPolicy;
  readonly stats: VirtualTextureFrameStats;
}

interface MaterialSamplerPolicy {
  readonly wrapS: "clamp" | "repeat";
  readonly wrapT: "clamp" | "repeat";
  readonly minFilter: "nearest" | "linear" | "mipmap";
  readonly magFilter: "nearest" | "linear";
  readonly anisotropy?: number;
}
```

Rules:

- Public materials still describe colors or asset references.
- WebGL material binding resolves these private resources per draw packet.
- KTX2, PNG/RGBA8, and fallback atlas choices are manifest variants, not public
  material kinds.

### Page Table And Cache Stats

```ts
interface VirtualTextureFrameStats {
  readonly frameId: number;
  readonly requestedPages: number;
  readonly exactHits: number;
  readonly misses: number;
  readonly fallbackSamples: number;
  readonly queuedPages: number;
  readonly uploadedPages: number;
  readonly uploadedBytes: number;
  readonly evictions: number;
  readonly dirtyPageTableEntries: number;
  readonly residentPages: number;
  readonly seamCandidates: number;
  readonly estimatedUploadMs: number;
  readonly selectedMode:
    | "webgl2-virtual-texture"
    | "webgl1-virtual-texture"
    | "fixed-low-mip";
}

interface PageCacheStats {
  readonly slotCount: number;
  readonly freeSlots: number;
  readonly lruClock: number;
  readonly residentByMip: readonly number[];
  readonly pendingUploads: number;
  readonly uploadBudgetPages: number;
  readonly uploadBudgetBytes: number;
}
```

Rules:

- Demand is collected from visible packets.
- Upload and eviction mutate page-table dirty entries, not the whole table.
- Parent fallback pages stay resident longer than high-detail children.
- Stats power private diagnostics and demo overlays; they are not public scene
  API.

## How This Feeds `@royal/renderer-webgl`

The WebGL frame path should become:

1. Traverse each `RenderPass` and build private packet buffers.
2. Resolve or refresh private asset/material/geometry resources by stable id and
   revision.
3. Cull packet buffers against the pass camera frustum.
4. Collect material texture demand from visible packets.
5. Update virtual texture residency within upload budgets.
6. Sort visible packets by backend sort key.
7. Draw through private mesh, glTF, text, path, and terrain submitters.
8. Publish diagnostics for tests and demo overlays.

Public APIs remain unchanged:

- No public `VisibilityPacket`.
- No public `VirtualTextureNode`.
- No public `PathNode` or SVG parser node.
- No public terrain node in the first implementation sequence.
- No public material variant for page tables or cache atlases.

Renderer-private adapters bridge from existing public data to backend resources:

- `MeshNode + BoxGeometry` -> packet + existing box geometry buffers.
- `GltfNode + manifest row` -> packet + glTF primitives + manifest bounds.
- `VectorTextNode + text asset` -> packet + text geometry buffers.
- `Path2dGeometryData` -> packet + tessellated indexed geometry buffers.
- `Terrain chunk row + manifest artifacts` -> packet + indexed geometry buffers
  + material texture resource demand.
- `Material asset reference` -> texture resource or virtual texture resource.

## Benchmark Gates

Visibility packets:

- 10,000 packets culled in under 1.0 ms after warmup.
- 50,000 packets culled in under 5.0 ms after warmup.
- Less than 0.1 microseconds per packet for sphere-plane tests.
- No per-frame object allocation in the culling loop after buffers are built.
- Camera jitter smaller than roughly 0.25 px keeps the visible set stable.
- Offscreen scenes skip at least 90% of draw submissions.

Asset manifests:

- Manifest validation passes before renderer-private caches consume rows.
- Bounds and artifact hashes are present for generated/offline assets.
- Preview/final replacement preserves `tileId` and `pageId`.
- Coordinate-system metadata is explicit and converted before bounds are used.

Indexed/path geometry:

- Indexed upload cache reuses buffers for the same `id` and `revision`.
- `Uint32Array` indices are rejected with a diagnostic when unsupported.
- Path payload packed bytes stay under the tiger/fallback route gates.
- Tessellation changes update bounds and geometry revision deterministically.

Virtual textures:

- At least 95% exact page-hit ratio after warmup during slow pan.
- No more than 8 physical page uploads per frame.
- Less than 2 ms estimated texture upload time per frame on desktop WebGL.
- Page-table dirty entry count is proportional to uploads plus evictions.
- Generated padded borders have zero checked mismatches.
- Fixed low-mip fallback renders when virtual texturing is unavailable.

Terrain/LOD:

- 256 selected chunks or fewer at `maxLevel <= 6` for the current spike budget.
- LOD selection under 2 ms on local Node for five camera samples.
- Manifest/material/provenance row generation averages under 15 ms.
- Chunk ids and provenance are deterministic for the same seed and recipe.
- Small camera movement below hysteresis threshold produces stable diff counts.

## Demo Acceptance Gates

Tiger:

- Route renders from a manifest/packed artifact, not runtime SVG parsing.
- Full tiger or fallback fixture has recorded command count and packed bytes.
- Command count changes by no more than 5% unless reviewed.
- Parse/extraction p95 is under 50 ms for fallback and under 250 ms for full
  tiger on local dev.
- Packed bytes are under 32 KB for fallback and under 512 KB for full tiger
  unless reviewed.
- Screenshot/canvas oracle reports nonblank color/alpha coverage.
- Full tiger shows at least 8 distinct fills/regions; fallback shows at least 4.
- Source SVG, provenance, packed artifact, and screenshot artifact are mapped by
  manifest row.

Virtual texturing:

- `/labs/virtual-texturing` uses material asset references lowered privately to
  page-table/cache resources.
- Overlay shows physical slots, page ids, resident/free state, page-table dirty
  entries, requested/queued pages, hits, misses, fallback samples, uploads,
  evictions, upload bytes, upload time, seam candidates, and selected mode.
- Controls cover camera pan, cache slot budget, upload page budget, overlay,
  seam stress, and fixed low-mip fallback.
- Overlay on/off visual smoke passes.
- Canvas smoke is nonblank in full and fallback capability modes.

Terrain:

- First demo consumes chunk rows and manifest artifacts.
- LOD/chunk diagnostics show selected leaves, cache hit/miss/change counts,
  chunk bounds, and active quality tier.
- Terrain geometry uses the private indexed geometry path.
- Terrain material demand can drive virtual texture page requests.
- Public terrain APIs stay absent until this private path survives demo review.

## First Worker Slices

Recommended implementation slices after this plan:

1. Private packet extractor and culling benchmark inside `renderer-webgl`.
2. Private `IndexedGeometryData` upload/cache path with a box-equivalent test
   fixture, still no public exports.
3. Manifest bounds adapter for glTF and generated assets.
4. Path payload lowering from the existing SVG prototype output into indexed
   geometry, using the tiny tiger fixture.
5. Material texture resource cache and fallback texture ownership.
6. Virtual texture page table/cache skeleton with stats and fixed low-mip
   fallback.
7. Browser virtual-texturing route after private resource hooks pass tests.
8. Terrain chunk LOD adapter using indexed geometry and virtual texture demand.

Handoff decomplection:

- Each worker owns one private module boundary plus focused tests.
- Shared cache/resource code should move only when a second consumer appears.
- Public API changes should be treated as a separate design review, not bundled
  with these private renderer foundations.
