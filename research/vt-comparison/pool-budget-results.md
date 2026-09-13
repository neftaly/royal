# Pool-budget allocation without temporary arrays

Date: 2026-09-13. Changes remain uncommitted.

The warmed profiles attributed substantial temporary allocation to pool budgeting.
The allocator now counts unfinished requests instead of filtering new arrays on
every distribution pass. It rounds results by request key, avoiding Map entry
pairs. The allocation algorithm still reserves minimum coverage, divides the
remainder equally, redistributes capped shares, and floors final byte counts.
The change adds five production lines and no retained workspace or cache.

## Correctness and adversarial review

The comparison script checked 10,036 cases against the saved prior implementation:
empty and one-pool cases, up to 60 pools, insufficient/excess budgets, uneven caps,
and 10,000 seeded integer/fractional cases. Outputs match exactly. A regression
checks successive caps and reversed insertion order; all four allocator tests and
37 VT runtime tests pass. Root type checking, lint, deployed bundle checks and
packed-package consumer validation pass.

Review checked pending-count updates, already-capped requests, zero remaining
budget, final integer rounding, the floating-residual exit, and unchanged request
objects. The second pass examined the cost of scanning requests that have already
capped: the old arrays shrink while the new scans retain all requests. The tested
31/60-pool cases still improve, but arbitrary much larger pool sets were not
benchmarked. Runtime constructs these requests from unique pool keys and integer
nonnegative byte counts.

## Measurements

[CPU comparison](pool-budget-comparison.json): four warmed alternating rounds,
fixed 16 MiB V8 nursery. CPU is median process time per round; GC events are summed
across four rounds. Iteration counts vary with pool count, so compare within rows.

| Pools | CPU before / after (ms) | GC events before / after |
|---:|---:|---:|
| 1 | 58.32 / 49.88 | 44 / 16 |
| 3 | 96.33 / 74.06 | 60 / 8 |
| 7 | 149.16 / 97.50 | 76 / 16 |
| 31 | 351.52 / 277.15 | 192 / 48 |
| 60 | 491.00 / 337.84 | 252 / 64 |

The headless Intel Iris Xe / ANGLE Vulkan comparison uses 600 warmed moving-SVG
frames, with CPU/heap sampling enabled in both builds. The baseline replaces only
`pool-budget.ts` with the saved pre-change source. Screenshots, center pixels and
final VT snapshots match exactly; no new page requests or failed/missing pages.

| Metric | Before | After |
|---|---:|---:|
| Submission median / p95 | 0.3 / 0.5 ms | 0.3 / 0.5 ms |
| Sampled pool-budget allocation | 885,408 B | 360,752 B |
| Total sampled allocation | 5,148,820 B | 4,427,092 B |
| GC events / time | 5 / 4.270 ms | 5 / 5.532 ms |

The roughly 59% lower attributed allocation supports keeping the change. These
single profiled browser runs do not establish a frame-rate or GC-time improvement.
Raw reports/profiles: [before](pool-budget-before.json), [after](pool-budget-after.json).
Source-mapped summaries: [before](pool-budget-profile-before.json),
[after](pool-budget-profile-after.json). Source hashes are in the CPU report;
the [patch](pool-budget.patch) reconstructs the baseline from this checkpoint.

Reproduce CPU comparison with the saved baseline (or reverse the patch into a
separate file), then run:

```sh
VT_BASELINE_FILE=/tmp/royal-vt-retention-checkpoint-pool-budget.ts \
node --min-semi-space-size=16 --max-semi-space-size=16 --expose-gc \
research/vt-comparison/compare-pool-budget.mjs
```

## Diagnostic image correction (2026-09-13)

The old steady-fixture image/pixel comparisons do not establish visual equivalence:
a later audit found that finish-hook readback could occur after WebGL discarded
the drawing buffer. Identical black images were therefore an invalid visual oracle.
Timing, allocation profiles and VT state counters were captured separately and
remain the recorded measurements. The separate source-combination rendering gates
are unaffected. See [the diagnostic redraw review](diagnostic-redraw-review.md).
