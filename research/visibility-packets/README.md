# Royal Visibility Packets Prototype

Date: 2026-06-28

## Scope

This is a renderer-feature prototype, not a renderer patch. It stays outside
`renderer-core`, `renderer-webgl`, examples, exports, and package config while
making the rendering wishlist's CPU frustum-culling step concrete enough to
budget.

Run:

```sh
node research/visibility-packets/visibility-packet-bench.mjs
```

## Why Visibility Packets First

Royal should land visibility packets before Forward+, deferred rendering, HZB,
virtual textures, or meshlet/terrain streaming because all of those features
need the same input: a compact, stable list of bounded render work for one
camera pass.

CPU frustum culling is the first useful consumer because it can run on the
current WebGL path and it forces the renderer to separate scene traversal from
draw execution. Once a pass can produce packets, later work can consume the
same packet stream:

- Forward+/clustered lighting can attach visible light packets and draw packet
  depth ranges without changing public scene nodes.
- Deferred and depth prepasses need the same opaque packet partition before
  they choose a G-buffer or forward path.
- HZB/GPU occlusion needs packet or meshlet bounds before it can reject draws.
- Virtual textures need visible packet material and asset references to request
  page residency.
- Terrain and text need the same stable IDs, bounds, and asset relations as
  mesh and glTF instances.

Starting with packets avoids exposing render-algorithm names as author-facing
API. It also gives WebGL extraction a small internal seam: "extract bounded
packets, cull, then draw" rather than interleaving traversal, resource lookup,
GL state, metrics, and draw calls.

## Packet Data Model

The prototype uses struct-of-arrays storage because the renderer will touch
every packet every frame. The eventual internal implementation can keep a
friendly object builder at extraction time, but culling should read typed arrays.

Required per-packet fields:

| Field | Purpose |
| --- | --- |
| `packetIndex` | Dense frame-local index for typed arrays and result masks. |
| `stableId` | 64-bit deterministic ID split into `idHi`/`idLo`; survives reorder. |
| `kind` | Mesh, glTF, vector text, terrain tile, light, or occluder metadata. |
| `flags` | Visibility policy bits such as opaque, alpha, casts shadow, dynamic. |
| `assetIndex` | Asset table row: geometry, glTF, glyph run, terrain chunk, material set. |
| `instanceIndex` | App/renderer instance row for transform and lifecycle ownership. |
| `materialIndex` | Material table row or material-set slot. |
| `boundsSource` | Local box, asset manifest, text layout, terrain tile, or procedural. |
| `centerX/Y/Z` | World-space bounding-sphere center. |
| `radius` | World-space bounding-sphere radius for fast plane rejection. |
| `minX/Y/Z`, `maxX/Y/Z` | World-space AABB for optional tighter tests and debug overlays. |
| `transformVersion` | Increments when world transform changes. |
| `boundsVersion` | Increments when geometry/layout/asset bounds change. |
| `visibilityVersion` | Last pass/camera revision that wrote this packet result. |
| `sortKey` | Backend-owned material/depth/phase key after culling. |

Stable IDs should be derived from ownership, not array position:

```text
stableId = hash64(worldId, passId, ownerPath, nodeKey, assetId, instanceOrdinal)
```

For generated terrain, `nodeKey` should include tile coordinates and LOD level.
For dynamic text, the packet keeps the same instance ID while `boundsVersion`
changes when the shaped layout changes. For glTF, the asset manifest should
carry bounds; runtime JSON parsing is not the production source of truth.

## Bounds Policy

Packet bounds are conservative. A false positive draws extra work; a false
negative hides visible content and is not allowed.

- Box mesh: derive local AABB from geometry dimensions, transform to world AABB,
  and derive a sphere from the world AABB.
- glTF asset: prefer manifest bounds keyed by asset URI/hash; fallback demo
  bounds may come from the narrow loader only for tests.
- Vector text: use shaped layout/glyph mesh bounds, not DOM text metrics.
- Terrain tile: use tile horizontal extents plus min/max elevation from the
  terrain asset manifest or generation job output.
- Procedural/generated asset: include recipe, seed, inputs hash, coordinate
  system, and artifact hash in the asset row so stale bounds can be diagnosed.

The first core implementation should use sphere-vs-frustum planes for the fast
path and keep the AABB for future screen-rect, HZB, and debug work.

## Frustum Plane Tests

The benchmark extracts six normalized planes from a view-projection matrix and
tests each packet's bounding sphere:

```text
dot(plane.xyz, center) + plane.w < -radius => culled
```

The result is deterministic for a fixed scene and camera path. A small
hysteresis epsilon is included so camera jitter around a plane does not churn
results. The later renderer path should use the same relation:

1. Build or refresh packets during pass extraction.
2. Compute camera frustum planes once per pass.
3. Write a dense visible index buffer and optional per-packet visible bit.
4. Submit only visible packets to draw grouping, material sorting, texture
   residency, light assignment, and metrics.

## Benchmark Targets

Initial desktop targets for the later internal implementation:

- 10,000 packets culled in under 1.0 ms after warmup.
- 50,000 packets culled in under 5.0 ms after warmup.
- Less than 0.1 us per packet for the sphere plane test.
- No per-frame object allocation in the culling loop after packet buffers are
  built.
- Stable visible set for camera jitter smaller than roughly 0.25 px.
- Offscreen scenes skip at least 90% of draw submissions.

The standalone harness reports these values for synthetic mesh, glTF, text, and
terrain packets. It intentionally does not test Forward+, deferred, HZB, or
virtual textures because those should consume packet output, not define it.

## Landing In Core After WebGL Extraction

After the WebGL extraction settles, land this as a private internal path:

1. Add an internal packet builder in the WebGL package that walks one
   `RenderPass` and emits typed packet buffers.
2. Add private bounds adapters for box mesh, vector text mesh/layout, glTF
   manifest bounds, and terrain/asset-manifest rows when they exist.
3. Add CPU frustum culling before draw dispatch and include packet count,
   visible count, culled count, and cull time in diagnostics.
4. Keep all packet types and buffers internal; do not export visibility knobs
   from `renderer-core` yet.
5. Use the packet stream as the shared input for later light clustering,
   texture residency, terrain LOD, HZB, and meshlet selection.

Decomplection in that landing patch: traversal owns packet extraction, culling
owns visibility, and draw code owns backend submission. No public API should
need to know which stage rejected or accepted a packet.
