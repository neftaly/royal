# Surface authoring primitives for Probability

Status: measured experiment on `experiment/surface-paint`. The lab is evidence, not proposed product API.

## Decision

Probability needs two renderer lanes with one atomic hand-off:

1. **Live lane:** exact surface picks feed a small appendable ribbon. Confirmed input and the predicted tail are separate; replacing predictions never rewrites confirmed geometry.
2. **Settled lane:** completed ordered strokes are drawn into occurrence-local, canvas/SVG-generated virtual-texture pages. A committed ribbon remains visible until the replacement pages are resident, then disappears in the same publication.

Ribbons remain the correctness fallback for UV-less, overlapping-UV, proxy-picked, or otherwise unparameterised surfaces. Cards and sheets have known UVs and should normally settle into VT. A textured glTF miniature may settle into VT only when the picked base-colour mapping is usable; it must not silently paint mirrored UV islands.

Royal already supplies the vector-backed automatic-VT raster path. Probability should use it. Royal is missing generic ownership, update, and query primitives around that path; it does not need a Probability paint engine.

## Real-device evidence

All iPad results used the connected iPad Safari at native DPR 2. Captured pixels were inspected as well as counters.

### Static presentation

The lab uses 96 independently movable pieces: 48 cards and 48 curved mini proxies. Each stroke has 20 surface samples.

| presentation | strokes / piece | iPad p95 | result |
| --- | ---: | ---: | --- |
| grouped ribbon geometry, 12 colours | 12 | 13–15 ms | comfortably static |
| grouped ribbon geometry, 12 colours | 384 | 19–20 ms | density crosses the 60 fps target |
| one SVG/VT material per piece | 384 | 18 ms after settling | draw cost no longer grows with stroke count |

The SVG/VT case is one draw per piece rather than one draw or node per stroke. That is the right dense display shape, but the current route is not yet the right authoring/lifetime API.

With 96 unique 2048-pixel SVG fallbacks and 384 strokes per piece, the run took 21.0 seconds to reach the benchmark window, retained 201.0 MB of ordinary GPU textures in addition to the 1.67 MB shared VT atlas, retained 16.5 MB of encoded SVG, and WebKit observed 93.1 MB of repeated SVG decode-resource reads.

SVG's intrinsic dimensions need not define its VT detail. Keeping the same 2048-unit viewBox while declaring a 128-pixel fallback reduced ordinary texture residency from 201.0 MB to 8.39 MB. However, measurement began while complex SVG pages were still rasterising: p50 stayed 18 ms, while p95 rose to 47 ms and p99 to 106 ms. A shared two-texture control finished in 4.15 seconds, showing that independently owned derived paint—not final draw count—is the scaling pressure.

Conclusion: use the existing small ordinary SVG fallback plus vector VT, but let Probability generate requested pages directly from its decoded stroke cache. Re-serialising and re-decoding the whole SVG for each page is avoidable work.

### Live geometry

The current immutable-scene control changes one growing stroke but repeatedly processes about 825 KiB and 774 uploads per frame. On iPad it raised a 15 ms static case to 22 ms p95 / 30 ms p99 and produced captured frames where established geometry disappeared during replacement. A brush preview must not use this path.

### Exact picking

The current exact query bounds-tests surfaces but linearly scans triangles within a candidate. The corrected iPad probe repeatedly hit the same visible mini surface:

| rendered triangles | average pick | p95 pick |
| ---: | ---: | ---: |
| 100,000 | 3.15 ms | 4 ms |
| 1,000,000 | 35.77 ms | 37 ms |

This consumes too much of an 8.3 ms 120 Hz Pencil interval before sampling, tessellation, or rendering. Exact picking needs a retained geometry acceleration structure. A BVH is the smallest general fix; a previous-triangle continuation or batched query can be evaluated later, but cannot replace the fallback index.

### Browser input capabilities

The same iPad Safari exposes pressure, tilt, twist, and tangential pressure. It does **not** expose `pointerrawupdate`, `getCoalescedEvents()`, `getPredictedEvents()`, altitude angle, or azimuth angle. Desktop Chromium in the same lab exposes all of them. Royal should not own Pointer Events policy, but its live resource must be cheap enough for both the basic `pointermove` path and higher-frequency confirmed/predicted batches.

## 1. Exact surface result

The branch prototypes:

```ts
interface PickSurface {
  normal: Direction3;
  source: 'rendered' | 'picking-proxy';
  baseColorTextureCoordinates?: readonly [number, number];
}
```

The optional coordinate is interpolated from the winning rendered triangle and transformed with the same UV set and affine rows as the base-colour shader. Proxy picks deliberately omit it. Direct textured meshes now reuse the rendered canonical geometry for exact picking rather than lowering a UV-less duplicate.

This is deliberately not a public triangle ID. World point plus normal is the universal rigid-surface attachment. Base-colour UV is an optional fast presentation coordinate. Probability must keep local point/normal samples canonical so a missing or invalid UV falls back to ribbons.

Before landing, cover direct meshes, glTF primitives and instances, UV0/UV1, `KHR_texture_transform`, negative/non-uniform and imperative transforms, absent normals/UVs, context restoration, and proxy exclusion.

## 2. Accelerated exact picking

Build and retain an acceleration structure with each exact canonical triangle geometry. Requirements:

- construction is shared wherever exact geometry is shared;
- scene transforms do not rebuild asset-local acceleration data;
- the result and alpha-mask acceptance remain bit-for-bit equivalent to the linear query;
- malformed/degenerate triangles remain bounded and deterministic;
- memory is visible in renderer diagnostics and released with geometry;
- context loss does not rebuild CPU-only data unnecessarily; and
- property/fuzz tests compare accelerated and linear winners across rays, transforms, winding, LOD, and alpha masks.

Acceptance target: both 100k and 1m probe cases below 1 ms p95 on the same iPad, without weakening exact rendered picking.

## 3. Appendable triangle geometry

Royal needs a generic retained resource analogous to its camera and instance resources. Desired semantics, not final naming:

```ts
const geometry = createTriangleGeometryResource(initial);

geometry.append({ positions, normals, indices });
geometry.truncate({ indices, vertices });
geometry.replace(next);
geometry.commit();

mesh({ geometry, material });
```

Requirements:

- stable resource identity; no React update or scene replacement per sample;
- append cost proportional to the new bytes, with zero work for unrelated surfaces;
- automatic internal capacity growth, with no public arbitrary limit;
- staged changes publish once at `commit()`;
- retained canonical CPU state supports context restoration;
- truncate supports cancellation and replacement of a predicted tail;
- exact channel/index validation at the imperative boundary; and
- Strict Mode, remount, abandoned staging, and release do not leak.

Probability uses one resource for confirmed local ink and a much smaller resource for predictions. A new confirmed batch truncates predictions, appends confirmed geometry, then appends the new predicted tail. Peers and completed history never enter the prediction resource.

Acceptance target: live iPad p95 within 2 ms of static; a new segment uploads only its own bytes; established pixels never disappear.

## 4. Generated, region-invalidated VT source

Royal's internal `VirtualTexturePageSource` already has the correct read shape, while the public descriptor only accepts an authored manifest URI. Expose a generic generated-source ownership boundary so an application can paint requested pages with Canvas/SVG without manufacturing data URLs or a fake HTTP filesystem.

Required semantics:

- caller supplies logical extent, colour space, sampler, and an abortable page reader;
- reader receives mip/page bounds including gutters and returns an image/canvas/bitmap representation accepted by the normal VT upload path;
- regional invalidation dirties only intersecting pages and mip ancestors;
- old resident pages remain presentable until replacements are ready;
- one atomic publication swaps replacement pages and allows the caller to retire its live geometry;
- rapid edits coalesce and obsolete reads abort;
- generated resources share Royal's existing atlas pools, budgets, diagnostics, and context lifecycle;
- source identity and revision are explicit without requiring a URL; and
- ordinary fallback can remain a deliberately small SVG/image representation.

The exact API should be chosen adversarially by Royal. A structural page-provider object or a retained root-owned resource both fit; a Probability-specific `paintTexture` does not.

Probability's reader draws base art and ordered committed strokes straight into the requested page. SVG is a useful derived display form, especially for variable-width outline paths, but is not document state. A worker/OffscreenCanvas implementation is optional acceleration; correctness must also work on main-thread Canvas.

## 5. Coincident depth-tested surfaces

Live ribbons and UV-less settled paint need a generic coincident/decal depth relationship. Physical lifts are rejected by iPad evidence: 20 and 100 µm produced missing paint; 500 µm was complete but exceeds the 350 µm card thickness.

Required behavior:

- paint wins only against its coincident host surface;
- genuinely nearer geometry still occludes it;
- it is not a screen-space always-on-top overlay;
- no physical-metre displacement is authored; and
- behavior is stable across camera range/angle, iPad Safari, desktop, and context restoration.

Royal may implement this with constrained depth bias, polygon offset, or another renderer-owned method. The API should state the relationship, not the mechanism or Probability use case.

## UV-less dense miniatures

Existing glTF UVs may overlap or mirror and therefore cannot be assumed paint-safe. Ribbons preserve correctness but eventually scale with history. The strongest long-term route is a per-face/Ptex-like parameterisation feeding the same VT atlas: it needs no source UVs and naturally assigns unique detail to faces. That is a separate measured renderer research project, not an MVP requirement and not something Probability should fake with object IDs.

Do not silently bake through overlapping source UVs. Until a paint-safe mapping is proven, keep that occurrence on grouped ribbon geometry.

## Rejected directions

- canonical SVG or bitmap paint state;
- rebuilding immutable scenes during input;
- one scene node per stroke or dab;
- publishing predicted samples to document or presence;
- replacing full textures on every pointer move;
- per-piece 2048² ordinary texture fallbacks;
- vertex colours as a dense-paint substitute;
- exposing renderer triangle IDs in Probability state; and
- absorbing Probability brush, undo, or Automerge semantics into Royal.

## Suggested Royal order

1. Review and land exact normal/provenance/optional base-colour UV.
2. Add the geometry BVH and rerun the 100k/1m iPad probe.
3. Add append/truncate/commit geometry and rerun the live workload.
4. Prototype the generated VT page source with 96 unique × 384-stroke pieces; require bounded fallback memory and smooth page arrival.
5. Land coincident depth semantics for the live and UV-less lane.
6. Only then evaluate per-face VT for dense UV-less miniatures.
