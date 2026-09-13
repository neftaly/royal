# Wrapped demand translation review

Existing tests cover enormous finite offsets, non-finite derivatives, bounded
tile traversal and sampled coverage across wrap modes. This pass adds a different
invariant: whole-period UV translations must preserve the page demand set.

The regression checks 192 translated cases against twelve unshifted baselines:
independent repeat/mirror modes on both axes, scales 0.125, -0.375 and 1.5, and
positive/negative translations of 3–1,024 periods per axis. Mirror periods are
two texture units; repeat periods are one. Binary-exact offsets and scales keep
the assertion focused on wrap logic. A reused workspace is reset between cases.
Every result stays nonempty, has no workspace overflow and matches the complete
baseline key set, including ancestor levels.

A control removing the absolute value from mirrored-tile parity fails on negative
translations. Production is restored byte-for-byte afterward. Demand and VT
property tests and root TypeScript pass. No production fix was needed.

This is a deterministic demand-set check, not a GPU precision equivalence test
for arbitrarily large coordinates or a performance benchmark. Matching page sets
means equivalent periods add no demand in these cases; it does not measure
overall collection CPU time or allocation churn. No commit was made.
