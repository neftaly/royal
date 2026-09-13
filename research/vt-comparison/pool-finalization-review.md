# Finalize each image-pool request once

Retained candidate: calculate minimum and wanted byte totals after aggregating
all resources, once per image pool. Previously these totals, including a
power-of-two rounding logarithm, were recalculated for every contributing
resource. This adds one textual production line, no persistent state, and no
size allowance. Each pool still creates one request object per update.

The temporary minimumBytes field initially holds bytes per page, then becomes
the final minimum before the allocator sees it. This is safe because an atlas
key includes padded page dimensions and encoding: all image resources in that
pool use the same byte size. Compressed-pool accounting is unchanged.

## Evidence

The comparison script extracts both actual aggregation blocks and checks
10,000 generated cases, including empty collections, failed/missing manifests,
shared/multiple pools, compressed pools, per-resource slot and byte limits,
and an existing atlas. Request order, amounts and remaining budget match.
Refresh, key construction, page-byte lookup and allocation are stubbed equally;
this measures aggregation, not the complete renderer.

Median CPU milliseconds for 50,000 warmed invocations, four alternating rounds:

| Resources | Pools | Before | After |
| --- | --- | --- | --- |
| 1 | 1 | 47.84 | 35.53 |
| 16 | 1 | 150.42 | 88.29 |
| 16 | 8 | 197.74 | 151.05 |
| 128 | 1 | 817.84 | 413.48 |
| 128 | 8 | 886.62 | 551.14 |

The one-resource configuration appears twice in the raw results because the
pool-count variants coincide; its median above includes all eight rounds.

Headless Chromium with the Intel Iris Xe Vulkan host GPU, 16 moving SVG
resources, 256 MiB budget, 600 measured frames per run:

| Order | Before sampled bytes | After sampled bytes | Before median/p95 | After median/p95 |
| --- | --- | --- | --- | --- |
| Before → after | 15,767,980 | 14,154,484 | 0.5 / 0.9 ms | 0.6 / 0.9 ms |
| After → before | 14,183,472 | 15,137,192 | 0.6 / 0.9 ms | 0.6 / 0.9 ms |

Allocation differences reverse between runs. All runs have ten GC events with
7.373–8.133 ms total pauses. No full-frame timing or GC improvement is claimed.
The first pair's images are byte-identical and final VT state matches. Source
maps match the recorded before/after runtime hashes. The reason to retain this
small change is the repeated reduction in aggregation CPU work, with no new
state or increased size ceilings, rather than a general frame-rate claim.

## Review

First review checked that aggregation finishes before atlas resizing, request
iteration preserves first-encounter order, zero-demand resources do not create
new pools, and failed manifests remain excluded. Second review checked the
page-byte invariant, transient field finalization, compressed reservations,
physical limits, and the contradictory allocation samples above. No cache,
new lifecycle or speculative fast path is introduced.

Artifacts: [CPU/equivalence results](pool-finalization-comparison.json),
[comparison script](compare-pool-finalization.mjs), [patch](pool-finalization.patch),
[first before](pool-finalization-host-before.json),
[first after](pool-finalization-host-after.json),
[repeat before](pool-finalization-host-before-repeat.json),
[repeat after](pool-finalization-host-after-repeat.json).

The script reads `/tmp/royal-vt-before-pool-finalization.ts` and
`/tmp/royal-vt-pool-finalization-candidate.ts`; reconstruct this pair using the
archived patch and verify the hashes in the comparison JSON before rerunning.
Run with `node --expose-gc research/vt-comparison/compare-pool-finalization.mjs`.
Everything remains uncommitted.

Validation: 93 targeted tests; full suite 1,292 tests across 149 files; 65-case
glTF manifest check; types, lint, packed consumers and existing bundle ceilings
all pass. The 44-case headless host-GPU source matrix passes on the retained
candidate. Final VT state also matches in the reverse-order pair.
