# Review complete-level coarsening before partial refinement

No partial-refinement change is retained. `truncateVirtualTextureDemand`
explicitly uses complete-level coarsening to keep detail uniform. Filling an
arbitrary prefix of finer pages would change that policy; it is not simply an
equivalent way to use spare atlas cells. Such a change needs visual and residency
stability evaluation rather than assuming that a higher occupied-slot count is
always better.

The new property test checks 64 seeded rectangular demand sets, with optional
adjacent-level requests and four capacities each. Its oracle directly projects
the original regions to each candidate mip and selects the finest complete
level that fits. It does not use the production routine's iterative in-place
merging. All 256 scenarios match, including root coverage, membership keys and
the capacity bound. Artificially halving usable capacity makes the test fail
because it skips feasible detail; the mutation is restored byte-for-byte.

Unused capacity can be intentional under this policy. Sixteen fine cells plus
a root need seventeen slots; with sixteen available, replacing those fine cells
with four parents plus the root needs five. The unused eleven slots do not
establish excessive coarsening by themselves. The migration-headroom issue is
separate: a larger atlas would allow the full fine level to fit.

Property and demand tests pass after restoration, as does root typechecking.
This proves the tested planner behavior, not visual superiority of uniform
detail or GPU performance. No production lines were added and no commit was
made. [Validation hashes](coarsening-oracle-validation.json).
