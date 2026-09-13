# Reserve coarse coverage for pending automatic sources

Retained fix: new compressed pools participate in the existing initial pool
allocator alongside known image pools, with a 32 MiB upper request. Already
allocated compressed pools retain their fixed size. Pending automatic sources
reserve one generated RGBA page each from the combined allowance. An initial
native allocation with insufficient allowance waits instead of becoming a
permanent unsupported-source error.

This adds one textual runtime line, no persistent fields and no package/bundle
allowances. The waiting count and automatic page dimensions already exist.

## Correctness and scope

The original mixed-source GPU failure is resolved at a 16 MiB root budget, in
both insertion orders. Each run has two ASTC 8×8 resources and two SVG resources:

| Metric | Before | After |
| --- | --- | --- |
| Allocated pools | 1 | 2 |
| Desired pages | 84 | 84 |
| Admitted pages | 84 | 44 |
| Resident pages | 42 | 44 |
| Unresident pages | 42 | 0 |
| Allocated atlas bytes | 12,577,280 | 12,582,576 |

The combined allowance remains 12,582,912 bytes. This restores coarse SVG
coverage, not full detail: each SVG receives one coarse page while the native
resources retain 42 pages together. Both orderings pass white-center and GL
error checks through 120 moving-camera frames after settling.

Twelve authored-source regression cases cover BC1, BC3, BC7, ETC2, ASTC 6×6 and
ASTC 8×8 in both insertion orders. A separate delayed automatic-source test
requires native pages to become resident while decode is still pending, then
requires both pools to settle after decode becomes available. It also checks
disposal releases all budget ownership. The earlier synchronous-only candidate
failed the real GPU fixture and was rejected; these tests address that gap.

The reservation is conservative: pending sources can prove ineligible or be
offscreen. Reserving their coarse pages can reduce the capacity of a native
pool that subsequently remains fixed. It does not guarantee space for source
classes added to the scene after fixed native allocation, nor solve compressed
atlas migration. If the budget cannot fit all coarse reservations, allocation
may wait for pending preparation to resolve. No runtime encoding/transcoding or
compressed GPU-copy assumption is introduced.

First adversarial review checked representation compatibility, initial share
bounds, committed native accounting, and the native allocation-denial path.
Second review tested delayed source readiness, both real GPU insertion orders,
and distinguished admitted coarse coverage from desired full detail. The
conservative reservation and future-source limitation remain explicit.

Validation: 1,305 tests across 149 files, the 65-case glTF manifest check, types,
lint, packed consumers and existing size ceilings pass. The 44-case headless
host-GPU source matrix passes. No permission to commit has been assumed.

Artifacts: [patch](pending-reservation.patch), [source hashes](pending-reservation-sources.json),
[SVG first](pending-reservation-16-svg-first.json),
[native first](pending-reservation-16-native-first.json),
[source matrix](pending-reservation-source-regression.json).

## Steady-frame cost check

Headless Intel Iris Xe Vulkan host GPU; 16 moving SVG resources; 256 MiB;
600 frames per run; warm-up and diagnostics excluded. Source maps match the
recorded runtime hashes. This scene isolates ongoing frame cost after sources
have settled, not the memory-constrained loading case above.

| Run | Median / p95 submission | Sampled allocation bytes | GC events / total pause |
| --- | --- | --- | --- |
| before | 0.5 / 0.9 ms | 14,449,580 | 10 / 8.317 ms |
| after | 0.6 / 0.9 ms | 13,958,808 | 10 / 7.815 ms |
| after-repeat | 0.6 / 0.9 ms | 13,104,012 | 10 / 8.721 ms |
| before-repeat | 0.6 / 0.9 ms | 15,414,460 | 10 / 8.357 ms |

No general speed or GC improvement is claimed from this correctness fix.
Sampled allocations and GC remain in the same range; both p95 pairs are 0.9 ms.
The first pair's final VT state matches. The change adds arithmetic and initial
pool bookkeeping without a persistent cache or per-waiting-source allocation.
Raw profiles and mapped allocation summaries are archived under
`pending-reservation-host-*` and `pending-reservation-profile-*`.
Everything remains uncommitted.
