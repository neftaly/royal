# Pending reservations through removal and context restoration

Expanded the delayed-source regression into ready, ineligible and removed
outcomes. Native pages must become resident before the pending source settles.
Each outcome clears the waiting count; only the eligible source creates an
automatic page source. Runtime invalidation then re-uploads native pages,
restores the expected one or two pools, and stays within the combined atlas
allowance. Disposal releases all budget ownership.

The headless host-GPU fixture now accepts `restore`, explicitly loses the WebGL
context, waits for the loss event, restores it, waits for restoration, and
settles again before 120 moving-camera frames. At 16 MiB with two authored ASTC
8×8 resources and two automatic SVG sources:

| Insertion order | Resident before loss | Resident after restore | Atlas bytes before | Atlas bytes after |
| --- | --- | --- | --- | --- |
| svg-first | 44 | 84 | 12,582,576 | 12,575,664 |
| native-first | 44 | 84 | 12,582,576 | 12,575,664 |

Both runs retain two pools and end with no pending, unresident or failed pages.
White-center and GL-error checks pass. The combined atlas allowance is
12,582,912 bytes. Restoring the context replans the fixed native atlas when both
automatic sources are already known, allowing all 84 desired pages to fit.
This does not imply that an existing fixed native atlas can rebalance without
replacement; that limitation remains. Context restoration is a recovery test,
not a recommended allocation strategy or timing optimization.

Validation: 104 runtime/growth tests, root typechecking and research typechecking
pass. No production changes or new size allowances were made in this pass.
The last full-suite result remains the earlier 1,305-test run; this pass added
two lifecycle variants and ran the relevant suites. No new performance or GC
claim follows from these recovery checks.

Artifacts: [SVG-first recovery](pending-restore-svg-first.json),
[native-first recovery](pending-restore-native-first.json).
Reproduce using the existing headless host runner with
`steady.html?case=mixed&motion=move&copies=4&budget=16&frames=120&restore`, adding
`&native-first` for the other order. Everything remains uncommitted.

## Budget denial and retry guard

A fourth lifecycle variant uses a 64 KiB runtime budget so the pending automatic
coarse-page reservation leaves no initial atlas allowance. The native manifest
finishes opening, but 100 updates perform only that one fetch, no GPU texture
storage calls and no retained GPU-byte claims. Its source status remains ready
rather than unsupported. Removing the pending source lets the same native
identity acquire storage and load pages without a version change. Subsequent
runtime invalidation and disposal remain covered.

Mutation check: temporarily restricting the allocation-allowance guard to image
pools causes the new case to fail with `unsupported` instead of `ready`. The
runtime was restored in a finally block and its SHA-256 matches the retained
pending-reservation source artifact. All 105 runtime/growth tests pass after
restoration; root typechecking passes. This demonstrates that the test detects
permanent misclassification of temporary native allocation denial, not just a
successful happy path. It is a mocked-runtime ownership test, not a 64 KiB
browser-root benchmark or a GC measurement. No production changes were retained.
