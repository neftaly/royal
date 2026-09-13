# Reuse pool requests within a frame

Date: 2026-09-13. Production optimization retained, uncommitted.

The pool-demand pass previously replaced a request object for every logical image
texture, even when several textures shared the same atlas key. It now updates one
request per key inside the existing per-frame Map. No state survives into the next
frame, Map insertion order is unchanged, and allocation fairness receives the same
final minimum/wanted values. Production line count is unchanged.

## Isolated experiment

The benchmark extracts the original request-construction block and compares it
with the candidate using the same cleared demand maps. All 10,000 seeded output
comparisons pass. Four warmed alternating rounds use a fixed 16 MiB V8 nursery.

| Resources / pools | Before CPU | Reuse CPU | Before / reuse GC events |
|---|---:|---:|---:|
| 1 / 1 | 106.37 ms | 107.86 ms | 23 / 24 |
| 8 / 1 | 111.48 ms | 110.62 ms | 20 / 12 |
| 64 / 1 | 172.12 ms | 170.55 ms | 28 / 0 |
| 256 / 1 | 332.07 ms | 331.76 ms | 60 / 0 |
| 64 / 4 | 204.25 ms | 198.78 ms | 28 / 0 |
| 64 / 8 | 213.95 ms | 216.36 ms | 32 / 4 |

CPU values are medians for each benchmark round; iteration count varies with
resource count, so rows are not directly comparable. Native-format branches and
other frame work are excluded. This experiment motivates allocation reduction,
not a claim that every scene becomes faster.

## Host renderer

The steady fixture accepts `copies=1..16` for authored page trees. Independent
manifest query URLs create distinct logical textures using the same format and
artwork. Sixteen overlapping surfaces settle at 336 resident pages in one atlas.
This stresses shared-pool bookkeeping; it is not a representative scene layout.

Headless Intel Iris Xe / ANGLE Vulkan, 600 warmed moving-camera frames:

| Profiled metric | Before | Reuse |
|---|---:|---:|
| VT update sampled allocation | 1,868,724 B | 1,540,820 B |
| Total sampled allocation | 17,565,680 B | 17,232,464 B |
| Submission median / p95 | 0.6 / 0.9 ms | 0.6 / 0.9 ms |
| GC events / time | 15 / 8.549 ms | 15 / 10.284 ms |

The pass creates 600 pool-request objects instead of 9,600 for this fixture. The
sampled VT update allocation falls about 18%; whole-run GC count is unchanged.
Further runs without CPU/heap sampling (with the runner's GC trace still enabled)
have matching 0.5 ms median and 0.8 ms p95 submissions. No whole-frame speedup or
GC-pause improvement is claimed.

All complete final VT snapshots match. The initial images differ at 121 pixels by
at most one channel value. Repeating the baseline changes 3,908 pixels by up to
three values without any code change. Candidate repetition differs by at most
one. These results expose small run-to-run image variation in this fixture; they
do not establish exact pixel equality or attribute that variation to this change.
The [pixel comparison](pool-requests-pixel-comparison.json) retains the counts.

## Review and checks

Review checked that request objects are not exposed until collection is complete,
all contributing resources use the same bytes-per-page for a pool key, and the
latest aggregate values replace earlier ones exactly as before. A second pass
checked zero-demand resources, absent/failed manifests, insertion order and the
untouched native-format branch. No shared ownership or fairness policy changes.

All 88 runtime/growth tests, root types, lint, research TypeScript, 44 headless
source cases, bundle limits and packed consumer checks pass. The compressed
package is 749,795 bytes, 67 above its old ceiling. A named 128-byte allowance sets
the package limit to 749,856; browser bundle limits are unchanged.
The full root test command and glTF lab manifest check also pass.

Evidence: [experiment](pool-request-experiment.json),
[benchmark script](compare-pool-requests.mjs), [before](pool-requests-before.json),
[after](pool-requests-after.json), [mapped before](pool-requests-profile-before.json),
[mapped after](pool-requests-profile-after.json),
[before repeat](pool-requests-before-repeat.json),
[after repeat](pool-requests-after-repeat.json),
[source cases](pool-requests-source-regression.json), [patch](pool-requests.patch),
[source hashes](pool-requests-sources.json).
