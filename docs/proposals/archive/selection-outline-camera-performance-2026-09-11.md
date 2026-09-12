> Historical proposal, archived 2026-09-11. Retained lookup is implemented.
> See [proposal decisions](../README.md) for current status.

# Selection-outline performance during camera movement

Status: partially implemented. Retained source indexing landed in `a1b4961d`
and is included in Royal 0.0.23, with differential and native pixel checks.
Hardware performance, equivalent descriptor replacement, and GPU submission
follow-up remain investigations.
Re-establish the baseline against current Royal before choosing another
optimization: the original software-rendered 0.0.22 comparison predates retained
indexing and the `cf6ebcf7` camera-copy change. The original code-cost discussion
below is historical, not a claim that the full scans remain.
No public API change.

## Problem and scope

Probability's Settlers scene becomes substantially slower to pan or orbit when
all pieces are selected. It contains 269 pieces arranged into 14 root groups.
Selecting a stack outlines its descendants, so a small selection list can still
produce hundreds of `outlineGltf` occurrences.

Keep that behavior. Royal should make presentation of a large outline set
cheaper without understanding selection, cards, folders, or application state.
Probability remains responsible for which occurrences receive outlines.

This proposal targets Royal's outline source lookup, retained preparation, and
camera-frame submission. It does not change import behavior, SVG texture
resolution, selection semantics, or visual quality.

## Evidence and limitations

An exploratory browser comparison on 2026-09-07 used Probability at commit
`9a58df2` with Royal `0.0.22`, a 1280 × 668 backing canvas, and Chromium's
SwiftShader software GPU. The renderer preparation queue had drained before
measurement. The camera followed a small sinusoidal yaw sweep with selection
off and on; no game document contents were changed.

| Measurement | No selection | All root groups selected |
| --- | ---: | ---: |
| Measured animation-frame intervals, excluding 10 warm-up frames | 40 | 12 |
| Mean interval | 827 ms | 1,961 ms |
| Median interval | 833 ms | 1,917 ms |
| p95 interval | 1,117 ms | 2,683 ms |
| Observed imperative `setOverlay` calls, including warm-up | 23 | 10 |
| Total time inside those calls, including warm-up | 0.5 ms | 558 ms |

The mean interval was approximately 2.4× larger with selection. Outline drawing
also introduced additional instanced mask draws and screen-space passes. This
is evidence of a reproducible cost difference, **not** a hardware performance
target or proof that one function explains that difference.

Important limitations:

- Software rendering, development mode, tracing, and other open browser tabs
  distort absolute timings. Repeat on hardware-accelerated desktop and physical
  iPad Safari.
- The runs had different lengths and were not randomized paired trials. The
  selected p95 has only 12 samples. Repeat the same complete path and sample
  count in both states before claiming a speedup.
- `setOverlay` timing includes synchronous work beneath that call, not GPU
  completion. It does not include every possible declarative submission path.
- Trace analysis timed out. A raw capture was saved locally at
  `/tmp/probability-selection-camera-trace.json.gz`, but its inspected CPU
  profiles did not include the target localhost:3000 page. Do not use those
  profiles to attribute the target's CPU time, and do not depend on that
  temporary artifact as a permanent fixture.

## Code-confirmed costs

### Repeated source-occurrence lookup

[`SurfaceGpuOwner.borrowPresentedGeometry`](../../../packages/renderer-webgl/src/surface/surface-gpu-owner.ts)
scans the entire canonical surface array for each requested edge surface. It
checks source identity, resource readiness, and active LOD membership. Matching
an automatically instanced source can additionally scan cohort members and
compare their stored transforms.

[`EdgeOverlayOwner`](../../../packages/renderer-webgl/src/surface/edge-overlay-owner.ts)
resolves the requested source surfaces during `drawViews`. Consequently, with
`E` outlined primitive surfaces and `S` world surfaces, source resolution can
perform `O(E × S)` matching work per frame, plus cohort-member comparisons.
When most of the world is outlined, this becomes roughly quadratic in surface
count. Piece count is not surface count: multi-primitive models amplify it.

This establishes an avoidable scaling problem, but not its measured share of
the observed slowdown.

### Overlay replacement and outline rasterization

The application was observed submitting overlays during camera movement even
though selection stayed unchanged. Investigate why; do not assume every such
submission is redundant or that all camera updates originate in React.

Royal's `setOverlay` skips the same descriptor reference, while a replacement
passes through canonical overlay preparation. The existing edge owner already
retains batch structure when the canonical overlay and borrowed resources are
unchanged. Preserve and extend that ownership rather than adding a parallel
cache or assuming no caching exists today.

Camera movement still legitimately changes projection, visibility, and sometimes
LOD. Outlines need mask rasterization and sampled expansion/resolve passes.
Current material runs have an occurrence-ID capacity of 255; outlining 269
occurrences can cross that boundary even when their materials match. Measure
this discontinuity separately from lookup and preparation costs. Existing
compatible instanced batches and conservative scissors must remain in use.

## Proposed approach

### 1. Establish a controlled baseline

Build a deterministic Royal fixture with repeated shared geometry, distinct
mounted occurrences, multi-primitive cutouts, deep stacks, and a large board.
Do not require the private Automerge document or Probability's import pipeline.

Record separate scenarios: idle selection, adding/removing outlines, camera-only
motion with stable descriptors, equivalent descriptor replacement, and genuine
transform/resource/LOD changes. Check that all assets and uploads are settled.
Measure 0, 1, 32, 128, 254, 255, 256, 269, and 512 outlined occurrences, including
a large world with only a small outlined subset.

Collect CPU source-lookup comparisons and duration, canonical rebuild counts,
borrowed-resource changes, batch rebuilds, mask and resolve draw counts,
submitted instances, upload bytes, allocations, and median/p95 frame intervals.
Use GPU timing where supported without introducing synchronous `readPixels` or
`finish` into the measured path. Report instrumentation overhead and compare
against an uninstrumented run.

### 2. Resolve candidates through retained source identity

Prototype an index owned by `SurfaceGpuOwner`, using the existing canonical
source-occurrence identity. Prefer a direct existing occurrence handle if it
can preserve all matching semantics; otherwise use bounded candidate buckets.
Do not invent application IDs or make asset URL alone the key.

Required identity includes asset/version/selected scene, primitive and cohort
identity, and the full source transform. Automatic members must match the same
float32 transform representation as the current implementation. Index cohort
members once when their provenance changes, not by scanning them per outline
per frame. Any compact hash needs exact collision checking.

Candidate discovery should become approximately `O(S)` on structural changes
and `O(E)` during steady camera frames, subject to genuinely ambiguous candidate
buckets. Document the worst case for coincident occurrences instead of claiming
unconditional constant-time lookup.

Retain candidate identity, not an eternally valid GPU-resource pointer. Read
current readiness and LOD from the candidate set so a camera-induced LOD change
can choose the correct resident geometry without a full-world scan. Preserve
the existing absent/pending/inactive/ready distinction and the rule that
presentation-equivalent coincident occurrences may share a ready resource.

### 3. Reuse preparation across camera-only changes

Keep source matching and batch topology separate from view-local projection,
visibility, transform packing, and draw submission. Audit the application
submission boundary and Royal's existing retained state before adding new state.

First compare stable descriptor reuse with the current replacement pattern.
Then decide whether any general Royal improvement is warranted for equivalent
replacement descriptors. Avoid deep scene equality or rebuilding string keys
on every frame; these can merely move the cost elsewhere. The caller should
not need to imperatively clear and restore selection to obtain a fast frame.

Do not cache rendered outline pixels across changing camera views. Preserve
the existing per-frame visible-occurrence union and shared stereo upload rules.

### 4. Re-measure before changing GPU submission

After lookup and unnecessary preparation costs are isolated, measure the mask
and resolve stages. Only pursue additional batching, tighter conservative
scissors, or a different ID representation if GPU evidence justifies it.

Crossing 255 occurrences deserves a targeted benchmark, not an automatic wider
ID format or quality switch. Any alternative must preserve occurrence
boundaries, authored material-run ordering, crease behavior, and overlapping
collaborator outlines. Compare memory, bandwidth, shader, and fallback costs.

## Invalidation and ownership

Keep the index and candidate caches root-owned, bounded by live canonical scene
data, and released with their existing owner. No global or time-based cache.
Use existing scene/resource lifecycle signals where possible. Explicitly cover:

- scene replacement, removal, and changed source transforms;
- automatic-instance regrouping, member transforms, and authored instances;
- asset version or selected-scene changes and asynchronous readiness;
- geometry residency changes, eviction, and selected LOD transitions;
- displaced previews whose `sourceTransform` differs from `transform`;
- context loss/restoration, root disposal, and stale async publications;
- duplicate source matches with different readiness or LOD states.

Resizing or changing DPR invalidates size-owned targets, not source identity.
Camera/XR view changes update visibility and LOD decisions without gratuitously
rebuilding the source index. No cache may retain obsolete VAOs or buffers after
their owner releases them.

## Correctness and adversarial verification

Compare indexed lookup against the current scan as a test oracle for ordinary,
automatically instanced, authored-instanced, mirrored, nested-transform,
multi-primitive, and displaced occurrences. Include coincident instances,
deliberate hash collisions, asset replacement, and readiness transitions.

Verify pixels for thin exposed stack edges, irregular silhouettes, alpha-masked
and translucent art, overlapping outline colors, and material-run boundaries.
Selecting a stack must not silently reduce to its top or root piece. World
occlusion is not permission to omit an always-visible outline; retain the
existing overlay depth and visibility contract.

Exercise perspective and orthographic cameras, near-plane crossings, offscreen
occurrences, fractional DPR, resize, multiple views/XR, active LOD changes,
budget denial, and context restoration. Adding/removing outlines must not alter
world pixels, picking, world instancing, or geometry ownership. The no-outline
path must not allocate outline-only targets or introduce new recurring work.

## Acceptance and rollout

1. Land reproducible fixtures and diagnostics before optimizing.
2. Demonstrate that static camera-only sweeps no longer perform a complete world
   scan for each outlined surface. Show comparison counts across scene sizes.
3. Preserve lookup status semantics and pass pixel, lifecycle, and ownership
   regressions, including the existing ordered ordinary-draw fallbacks.
4. Show lower selected-frame CPU cost and meaningful end-to-end improvement on
   hardware, with no material regression in small or unselected scenes. Record
   retained memory, setup cost, steady-state allocations, and bundle impact.
5. Evaluate GPU follow-up work independently. Do not promise a particular FPS or
   recovery of the full exploratory 2.4× difference from lookup changes alone.

Prefer a small internal change with no public API additions. Review competing
direct-handle and indexed-candidate approaches for semantics, invalidation,
ownership, and total complexity before selecting one. Integrate into Probability
through a normal Royal release; do not patch its installed bundle as the fix.

The existing [overlay presentation contract](../../specs/rendering-and-presentation.md#always-visible-scene-overlays)
and [resource/performance requirements](../../specs/resources-and-performance.md)
remain authoritative. Changing selection policy, reducing texture or mask
resolution, hiding selected descendants, disabling world instancing, or
introducing Probability-specific renderer branches is out of scope.
