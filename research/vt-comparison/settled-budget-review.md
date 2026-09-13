# Rejected settled-budget early exit

Date: 2026-09-13. Experiment reverted; no production change or commit.

Current steady profiles attribute substantial allocations to VT update and pool
sharing. A one-line allocator experiment returned immediately after initial
integer assignments when no budget remained or no request needed more coverage.
That avoids a redundant final flooring pass in those cases. It adds no cached
state and preserves all 10,036 seeded and boundary comparisons per run.

The first CPU benchmark appeared promising: its single request asks for exactly
minimum coverage, and median CPU fell from 46.13 to 40.26 ms per 400,000 calls.
Review identified that this does not represent the larger demand in the moving
scene. The benchmark now accepts `VT_DEMAND_SCALE` and a separate output path,
allowing demand above minimum without changing historical reports.

With demand multiplied by 32, the common single-pool case regressed in both runs:

| Single request | Baseline median CPU | Candidate median CPU |
|---|---:|---:|
| Minimum coverage | 46.13 ms | 40.26 ms |
| 32x coverage, first run | 53.37 ms | 58.04 ms |
| 32x coverage, repeat | 50.24 ms | 57.66 ms |

GC event counts are unchanged: 16 across four rounds for each single-pool variant.
Other pool counts are mixed. The extra branch is therefore not retained: no
allocation reduction was demonstrated, and active single-pool CPU cost increased
roughly 9–15%. These are direct Node measurements, not browser frame times. No
host-GPU candidate run was needed after rejecting it on this evidence.

Review first checked that initial values are already floored, and that an empty
budget or no pending requests cannot enter redistribution. A second pass checked
the workload's minimum/wanted relationship and repeated the active case before
the decision. The production allocator is byte-identical to the pre-experiment
checkpoint. Its four tests, benchmark syntax and whitespace checks pass.

Evidence: [minimum-demand comparison](settled-budget-comparison.json),
[active demand](settled-budget-active-comparison.json),
[active repeat](settled-budget-active-repeat.json),
[rejected patch](settled-budget.patch). Reports include source hashes and exact
Node flags; all runs alternate order across four warmed rounds with a fixed
16 MiB V8 nursery. The original comparison script's default behavior is preserved.
