# Complexity and allocation audit

This pass builds on the uncommitted decoupled VT presentation change. The saved
before/after Nova fixtures both include that change, isolating this audit's work.

## Fixed

- **Opaque run sorting:** insertion sort previously assumed state-equivalent
  runs were small, but the run planner has no size cap. Reversing a large run
  therefore cost O(n²). Runs over 32 elements now use stable O(n log n) mergesort.
  Small and already-sorted runs keep their inexpensive paths. A root-owned scratch
  array reuses capacity; each used entry is cleared so it cannot retain surfaces.
  Scratch is released with the GPU surface state. Sorting stays within existing
  state-equivalent run boundaries and preserves equal-depth ordering.
- **Atlas shrink validation:** checking every protected slot against
  `retainedSlots.includes` was O(slots × retained slots) on each migration step.
  A membership set, constructed once with the shrink plan, makes each validation
  scan expected O(slots). The ordered list still determines copies and remapping.
- **Texture reconciliation:** aggregate active/pageable flags while collecting
  shared-source claims, rather than repeatedly expanding storage-key sets into
  arrays for `every`, `some`, `flatMap`, and filter/map chains. Claim ownership,
  aliases, source activity, and residency policies are unchanged. This removes
  temporary arrays; it does not make the entire reconciliation allocation-free.

## Evidence

The focused camera-reversal benchmark (median of six measured iterations after
three warmups) produced:

| Surfaces in one run | Before | After |
| ---: | ---: | ---: |
| 1,000 | 7.31 ms | 0.76 ms |
| 4,000 | 69.53 ms | 2.39 ms |
| 16,000 | 546.54 ms | 2.48 ms |

These are synthetic CPU results, not Nova load-time savings. Reproduce with
`node research/texture-loading-performance/depth-order-scaling.mjs BASELINE.ts`;
the baseline sorting source is available at commit `0eb2e3b1`. The regression
test bounds comparison work without relying on timing, while randomized tests
check ordering, ties, mixed run sizes, boundaries, and cleared scratch references.

Physical Quest CPU profiles of Nova took 18.42 s before and 18.48 s after to reach
readiness. Both reached 147 pages and detail fraction 1, with no errors. Sampled
GC time was 559 ms versus 531 ms. A single pair does not establish a meaningful
loading or GC improvement. Keep these fixes for large-scene scaling and reduced
allocation churn, not as another claimed multi-second Nova improvement.

The remaining inspected depth partition construction sorts each axis once and
has a bounded recursion depth. Its camera traversal already reuses retained
partitions. VT snapshot aggregation remains linear in resources and demanded
pages; changing that to cached counters would add invalidation complexity without
evidence of sufficient benefit from the current profile. No such rewrite added.

All 1,493 tests across 170 files and 64 glTF manifest cases pass, as do typecheck,
renderer lint, and builds. Nova also passes the restarted literal root `pnpm dev`
smoke test with no page errors or failed JavaScript modules. Shrink cancellation/failure coverage remains green.
See `scaling-audit-summary.json`; local raw profiles and flame graphs are in
`/tmp/royal-nova-profiles/scaling-quest-{before,after}/`.
