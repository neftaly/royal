# Rejected: share only currently known pool requests

Follow-up: [pending-source reservation](pending-reservation-review.md) resolves
the original mixed SVG/ASTC fixture; future source classes and native migration
remain outside that fix. The findings below record the earlier experiment.

A candidate put unallocated native pools through the same allocator as image
pools, requesting up to 32 MiB and reserving committed native atlases at their
actual size. Initial native storage used the resulting allowance. It added no
production lines or persistent state.

Two ASTC 8×8 tests first reproduced starvation in both insertion orders with a
16 MiB budget and a 16,384-pixel texture limit. Both passed with the candidate.
The matrix was expanded to BC1, BC3, BC7, ETC2, ASTC 6×6 and ASTC 8×8; all twelve
cases passed. The runtime/growth/pool-budget suites passed 95 tests before the
ten extra format cases were added. Types passed at that stage.

However, the headless host-GPU mixed SVG/ASTC fixture still failed with exactly
the original counters: one 12,577,280-byte atlas, 42 resident pages and 42
unresident pages after 600 updates. The real fixture prepares automatic SVG
sources asynchronously, whereas the test supplies both authored manifests
immediately. The unchanged full native allocation indicates the image pool
was not requesting its allowance when that fixed atlas was allocated. Merely
splitting currently known requests is therefore insufficient.

A subsequent review also identified the need to treat an insufficient native
allowance as temporary allocation denial rather than a permanent unsupported
manifest error. That guard change is included in the archived candidate patch
but was not in the GPU-tested build; it does not address the missing future
pool reservation.

Decision: reject and restore the retained runtime byte-for-byte. The candidate
unit tests are archived as a patch, not retained as misleading proof that the
real mixed-source problem is fixed. No size allowances were changed. No timing
or GC improvement is claimed; correctness failed before performance evaluation.

The next investigation must explicitly model a native manifest arriving before
an automatic source can contribute a manifest. Delaying fast native display
until every SVG finishes would conflict with the preview-loading objective.
A successful design must reserve room for pending source classes or revise the
fixed native allocation policy without claiming unsupported compressed-copy
migration. The original starvation remains unresolved.

Artifacts: [production candidate](mixed-fairness-candidate.patch),
[test candidate](mixed-fairness-test-candidate.patch),
[source hashes](mixed-fairness-candidate-sources.json),
[host failure](mixed-fairness-host-failure.txt).
Everything remains uncommitted.
