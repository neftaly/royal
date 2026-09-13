# Blocked atlas planning review

The current runtime already caches unsuccessful RGBA atlas growth by demand,
available budget and atlas allowance. No production change was warranted by
this review. The migration-headroom limitation remains unresolved.

The existing budget-release regression now observes the storage planner directly.
After an external claim leaves only 1,024 bytes available, larger view demand
requires 85 pages but retains five admitted pages. Planning runs once across the
first three updates. Another 100 updates add no planner calls, texture storage
allocations or fetches, and submit no atlas copies. Releasing the external claim
invalidates the cached outcome and the runtime reaches all 85 resident pages.
Disposal releases the remaining budget.

Two temporary production mutations establish the regression's sensitivity:

- Removing the blocked-growth cache produces three planner calls where one is
  expected, failing before the 100-update stretch.
- Treating any previous blocked result as permanent leaves only five resident
  pages after budget release, failing the recovery assertion.

Both mutations were restored byte-for-byte. The 66 growth tests and root
TypeScript check pass. These are operation-count and correctness checks using
fake GL, not a host-GPU timing or GC benchmark. They do not imply zero allocation
inside an update: the fingerprint string and other update work still execute.
The existing GPU evidence in `staggered-growth-review.md` remains the authority
for the physical replacement-memory limitation. No commit was made.
