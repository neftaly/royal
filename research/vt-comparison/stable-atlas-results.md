# Avoid migration bookkeeping for stable atlases

Date: 2026-09-13. Uncommitted change, one fewer production line.

The existing stable-atlas exit ran after scanning other atlas demands, calculating
budget pressure and constructing a blocked-growth fingerprint. It now runs as soon
as target capacity is known, before that bookkeeping. Compressed and unchanged
atlases reuse one private unchanged-result object. Active migration, growth,
shrinking and capacity-pressure branches keep their existing behavior.

## Review and correctness

The first review checked equivalence of the early-return condition: no active
migration, no shrink, and target capacity no larger than current capacity. The
second checked shrink timer clearing, failed-growth retry fingerprints, pressure
from other pools, migration cancellation and the shared result's consumers. The
result is used only internally and its fields are read, never mutated. Clearing
`shrinkAfter` still occurs before the stable return. Active migrations cannot take
that exit, and unchanged pressure fingerprints are still checked for actual resize
attempts.

All 86 runtime/growth tests pass, including shrink cancellation, incompatible pool
pressure, delayed shrink, context restoration, migration failure and retry. The
24 headless host-GPU ASTC/full-source regression cases pass, covering supported and
unsupported ASTC 6x6/8x8, authoritative source combinations, raster preview promotion,
atlas growth/shrink and context restoration. Root type checking, lint and the
deployed bundle budget pass. The full suite also passes all 1,248 tests. Packed
package consumer validation passes within the unchanged package-size ceiling.

## Headless host-GPU comparison

Intel Iris Xe through ANGLE Vulkan, 600 warmed moving-SVG frames in each build.
The baseline overrides only `runtime.ts` with the saved pre-change source; both
builds include the preceding pool-budget optimization. CPU/heap sampling is enabled
in both runs, so timings include profiling overhead.

| Metric | Before | After |
|---|---:|---:|
| Submission median / p95 | 0.3 / 0.5 ms | 0.3 / 0.5 ms |
| Sampled resize-atlas allocation | 131,176 B | No samples |
| Total sampled allocation | 4,131,720 B | 3,673,440 B |
| GC events / time | 5 / 8.578 ms | 5 / 5.281 ms |

Screenshots and final VT snapshots match exactly. No new page requests occur in
measurement, and there are no pending, unresident or failed pages. Sampling can
miss small allocations; no samples does not prove zero allocation. The lower
sampled total supports the removal of unnecessary work, but these single runs do
not establish a frame-rate or GC-time improvement.

Evidence: [before](stable-atlas-before.json), [after](stable-atlas-after.json),
[source-mapped before](stable-atlas-profile-before.json),
[source-mapped after](stable-atlas-profile-after.json),
[24-case regression](stable-atlas-regression.json), [patch](stable-atlas.patch),
[source hashes](stable-atlas-sources.json). After capture only the compressed-atlas
comment and the private method’s redundant return annotation were removed; executable code did not change. Profile locations refer to
the original captured build.

## Diagnostic image correction (2026-09-13)

The old steady-fixture image/pixel comparisons do not establish visual equivalence:
a later audit found that finish-hook readback could occur after WebGL discarded
the drawing buffer. Identical black images were therefore an invalid visual oracle.
Timing, allocation profiles and VT state counters were captured separately and
remain the recorded measurements. The separate source-combination rendering gates
are unaffected. See [the diagnostic redraw review](diagnostic-redraw-review.md).
