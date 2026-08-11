# Probability surface-paint renderer primitives

Status: measured experiment on `experiment/surface-paint`, not a request to merge the lab as product API.

## Outcome

Sparse, depth-tested ribbon geometry is a viable common presentation for handwriting on flat pieces and paint on rigid miniatures. Static playback is already fast enough. Royal is missing three generic capabilities needed to make authoring correct and cheap:

1. exact picked-surface normal and rendered-vs-proxy provenance;
2. an appendable triangle-geometry resource that does not replace the scene; and
3. a scale-independent way to place an ordinary depth-tested surface immediately above a coincident surface.

This proposal does not require a Probability-specific paint API, SVG support in the 3D renderer, mutable glTF textures, or a new texture-atlas lifecycle.

## Reproduction

The branch adds `/surface-paint-lab`. Its default workload is 96 independently movable tabletop pieces, 12 strokes per piece, 20 samples per stroke, and four paint materials. Half the pieces are 63 × 88 × 0.35 mm cards; half are curved miniature proxies. Each piece/palette pair is one triangle mesh, so the scene represents 1,152 authored strokes and 23,040 samples in 480 draws without making every stroke a node.

Useful query parameters are:

```text
paintOwnership=piece|world
paintPieces=96
paintStrokes=12
paintPoints=20
paintLiftMicrometres=500
paintLive=1
```

The `world` ownership mode is only an upper-bound control. It is not a valid application representation because moving one piece would rewrite the table-wide geometry.

Host benchmark:

```sh
EXAMPLES_BENCH_ROUTE=surface-paint-lab \
EXAMPLES_BENCH_ROUTE_SEARCH='paintOwnership=piece&paintPieces=96&paintStrokes=12&paintPoints=20&paintLive=1' \
EXAMPLES_BENCH_CAMERA_DRAG=1 \
EXAMPLES_BENCH_FRAMES=120 \
EXAMPLES_BENCH_WARMUP_FRAMES=30 \
pnpm --filter @royal/examples-react bench:examples
```

The existing USB `bench:ipad-safari` harness was used against the exact dirty build, at native DPR 2 and a 1,984 × 992 backing canvas. Captured final pixels were inspected as well as counters.

| iPad Safari case | p95 | p99 | draws/frame | geometry upload/frame | upload calls/frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| static, visibly complete | 15 ms | 15 ms | 480 | 0 | 0 |
| one growing immutable stroke | 22 ms | 30 ms | 481 | 824,583 B | 774 |

The visibly complete cases use a 500 µm physical lift only as a measurement oracle, not as an accepted product solution. The static case uploads 822,228 bytes once. The live case changes only one short ribbon, yet the immutable scene path repeatedly processes and uploads essentially the complete scene. A live capture also caught frames in which established paint/base geometry was absent while the replacement scene was being admitted. This is both a pacing and presentation-lifetime failure.

On desktop hardware, the same live case measured 4.0 ms render-callback p95, 10.56 ms GPU p95, and about 824,527 uploaded bytes per camera frame. Static playback was materially cheaper. The exact numbers are less important than the disproportionality: one appended sample invalidates unrelated geometry.

## 1. Exact surface pick result

The branch prototypes this minimal public addition:

```ts
type PickResult = {
  // existing client position, distance, world point, and target
  surface: {
    normal: Direction3; // unit, Royal world space
    source: 'rendered' | 'picking-proxy';
  };
};
```

Royal already computes the winning triangle and barycentric coordinates for exact picking. The prototype retains those values, interpolates authored normals (falling back to the face normal), transforms the result with the same normal transform as rendering, and exposes only the world normal. It does not expose glTF primitive IDs or renderer-owned triangle identity.

World point plus world normal is sufficient for a rigid caller to store a point in its own local transform. `source` is required: a coarse caller-authored picking proxy must not silently become a painted render surface. Probability can require `source === 'rendered'` without coupling its document to glTF internals.

Before acceptance, tests should cover non-uniform and negative scale, imperative render-object transforms, authored and absent normals, direct meshes, glTF, instances, and context restoration. Skinned or morphed surface anchoring is intentionally not claimed by this API.

## 2. Appendable triangle geometry

Royal needs a generic retained geometry resource analogous to its camera and instance resources. Desired semantics, not final naming:

```ts
const geometry = createTriangleGeometryResource(initialGeometry);

geometry.append({ positions, normals, indices }); // staged; chunk-local indices
geometry.truncate({ indices, vertices });         // undo/cancel/edit support
geometry.replace(nextGeometry);                   // reload or arbitrary rewrite
geometry.commit();                                // one publication/invalidation

mesh({ geometry, material });
```

Requirements:

- Stable resource identity; a commit must not require a new React tree or scene descriptor.
- Append cost proportional to the appended channels and indices. Unchanged surfaces must have zero validation/upload work.
- Automatic internal growth and compaction; no arbitrary public capacity or depth limit.
- The resource retains enough canonical CPU state for WebGL context restoration.
- `commit()` batches multiple channel changes and publishes one renderer invalidation.
- Exact validation at the imperative boundary; the renderer must not accept partially indexed or mismatched channels.
- `replace` is the correctness path for arbitrary document changes. Append/truncate are optimizations with explicit semantics, not byte-prefix guessing.
- Resource release, abandoned staged changes, Strict Mode, and remounts must not leak buffers or subscriptions.

Probability would ordinarily retain at most one mesh per piece/palette and append a tessellated stroke chunk. The in-progress stroke stays local; the completed immutable stroke remains application document data. This keeps Royal a renderer rather than an ink document owner.

The acceptance benchmark should reduce the live workload from about 825 KiB per frame to the new ribbon segment's bytes, keep unrelated upload calls at zero, preserve every established surface in captured frames, and keep iPad live p95 within 2 ms of the static case.

## 3. Coincident depth-tested surfaces

The lab initially offsets ribbon vertices along their surface normals. Real-device captures show why this cannot be the product rule:

- 20 µm and 100 µm offsets produced missing/dotted ink at ordinary camera angles.
- 500 µm produced complete paint, but the test card itself is only 350 µm thick.
- A large world-space offset can visibly float away from a small miniature at silhouettes and changes physical geometry merely to influence raster ordering.

Royal should experiment with a generic decal/coincident-surface primitive. Required observable behavior:

- it remains an ordinary scene surface and is occluded by genuinely nearer geometry;
- it deterministically wins against the surface on which it is coincident;
- it does not render always-on-top like a scene overlay;
- it does not require application-authored physical displacement; and
- it behaves consistently across iPad Safari, desktop browsers, camera distance, incidence angle, near/far range, and context restoration.

WebGL polygon offset, a constrained depth-bias descriptor, or another renderer-owned implementation may satisfy this. The Royal API should describe the general rendering relationship, not Probability strokes. A physical-metre offset is explicitly rejected by the device evidence.

## Rejected first steps

- **SVG as canonical 3D paint:** excellent for flat paths, but it cannot attach a stroke to an arbitrary curved glTF surface without a second model.
- **Per-stroke scene nodes:** makes draw/submission count grow with history rather than painted pieces/materials.
- **Mutable per-piece textures/VT first:** needs surface UVs, unique non-overlapping UV ownership, texture mutation, mip generation, and occurrence-specific material binding. Arbitrary glTF does not guarantee that UV contract.
- **Rebuilding immutable scenes during input:** measured above and rejected.
- **Table-wide packed geometry:** fast control, but destroys independent piece ownership and cheap transforms.
- **Renderer paint document or Probability operation types:** outside Royal's rendering responsibility.
- **Automatic unique-geometry batching now:** static iPad playback already meets the frame budget. Revisit only if a post-resource benchmark identifies submission as the remaining bottleneck.

## Suggested delivery order

1. Adversarially review and land exact surface normal/provenance.
2. Build the appendable resource and rerun static/live host and iPad probes.
3. Experiment with coincident depth semantics using the 20/100/500 µm visual oracle.
4. Only then integrate the minimal Probability drawing route and reassess whether dense paint warrants a texture-backed tier.
