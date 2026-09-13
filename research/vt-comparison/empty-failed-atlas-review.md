# Reclaim empty GPU resources after fully failed demand

Retained change: when a resource has no resident pages and all current demand
keys are known failures, clear its demand and release its empty GPU resource.
The failed keys remain, so unchanged demand does not repeatedly allocate or
refetch. Shared atlases remain owned by healthy neighbors. A view requesting
previously untested pages can allocate again, and new source versions retain
normal retry behavior.

Cleanup applies during both demand refresh passes, including the pass after
admission changes. Releasing storage requests a subsequent update so other
pools can consume the freed allowance. The implementation adds 14 runtime
lines and no persistent state. Healthy sources avoid the failure-key scan;
failed demand uses the existing key set and workspace reset operation.

## Memory and correctness

Headless Intel Iris Xe Vulkan host GPU, 16 MiB root budget, two deliberately
truncated authored ASTC 8×8 sources and two healthy SVG sources. Failure surfaces
are separated from the healthy center pixel. Both insertion orders pass:

| Metric | Previous runtime | Retained runtime |
| --- | --- | --- |
| Accounted atlas bytes | 12,582,576 | 1,115,136 |
| Allocated pools | 2 | 1 |
| Healthy resident pages | 2 | 10 |
| Failed pages | 10 | 10 |
| Unresident admitted pages | 10 | 0 |

The difference is 11,467,440 accounted atlas bytes (about 10.9 MiB). The healthy
SVG sources gain detail, retaining 524,288 decoded/cache bytes rather than zero
in the prior coarse-only state. This is final renderer-accounted storage, not
a claim about driver VRAM overhead or lower initial peak allocation. The atlas
is still allocated before its page data is discovered to be malformed.

Six native-format regressions require empty failed resources to release GPU
ownership and avoid further allocations/read retries across 100 updates,
invalidation and another 100 updates. Version replacement recovers. Four
ASTC 6×6/8×8 cases cover both resource orders: start at a failed coarse mip,
then zoom into healthy detail without changing version, preserve the healthy
neighbor and its atlas, restore after invalidation, and release on scene removal.

First review caught that admission can trigger a second demand refresh, which
could recreate a just-released allocation. Suppression now happens inside the
shared refresh method. Second review checked healthy residency protection,
pending-page cleanup, shared ownership, and rescheduling after freeing budget.
A resource with no resident pages exposes no usable binding, so releasing its
empty storage does not remove a currently usable texture handle. Previously untested demand can still
cause allocation: this is intentionally not a permanent whole-source failure.

## Steady-frame cost

Separate healthy workload: 16 moving SVG sources, 256 MiB, 600 measured frames,
with warm-up and diagnostics excluded:

| Metric | Before | After |
| --- | --- | --- |
| Median / p95 submission | 0.6 / 0.9 ms | 0.5 / 0.9 ms |
| Sampled allocations | 14,420,120 bytes | 13,801,888 bytes |
| GC events / total pause | 10 / 8.050 ms | 10 / 8.340 ms |

No general timing or GC improvement is claimed from this single pair. The
purpose is memory reclamation and restoring healthy demand under pressure.
Source-map runtime hashes match the recorded versions.

## Validation and size

Full suite: 1,329 tests across 149 files plus the 65-case glTF manifest check.
Root/research types, lint and packed consumers pass. Named allowances add 256
package bytes and 64 gzip bytes to lazy/total ceilings: the initial overages
were 233 package bytes and 36–45 gzip bytes. Final ceilings are 750,320 package,
130,552 lazy gzip, 214,894 main-only gzip and 274,184 deployed gzip bytes. All
size gates pass. These overages are relative to ceilings, not actual binary
growth measurements.

Artifacts: [patch](empty-failed-atlas.patch), [hashes](empty-failed-atlas-sources.json),
[previous failure state](empty-failed-atlas-baseline-state.json),
[SVG-first GPU result](empty-failed-atlas-svg-first.json),
[native-first GPU result](empty-failed-atlas-native-first.json),
[steady before](empty-failed-atlas-host-before.json),
[steady after](empty-failed-atlas-host-after.json).
Everything remains uncommitted.

The 44-case [source matrix](empty-failed-atlas-source-regression.json) passes.
Healthy steady-run final state and screenshot bytes match between versions.

## Context restoration after cleanup

The restore fixture now explicitly waits for zero unresident demand before
losing the context. Its first exploratory run had lost the context before the
native cleanup update occurred; that was a different scenario and was not used
as evidence for restoration after cleanup. The final runs confirm one healthy
pool before loss, then restore on the headless host GPU and render 120 moving
frames:

| Order | Atlas bytes before loss | Atlas bytes after restore | Failed native reads, total | Final healthy resident pages |
| --- | --- | --- | --- | --- |
| svg-first | 1,254,528 | 1,115,136 | 10 | 10 |
| native-first | 1,254,528 | 1,115,136 | 10 | 10 |

The ten failure records survive restoration and there are only ten total native
page reads, so failed pages are not fetched again. The final state has one pool,
zero pending/unresident pages and the healthy white-center/GL-error checks pass.
The pre-loss snapshot may include healthy atlas migration storage; the check
requires the unusable native pool to be gone, not every healthy migration to
have finished. No driver-memory or timing claim is inferred from these recovery
runs.

[SVG-first restoration](empty-failed-atlas-restore-svg-first.json),
[native-first restoration](empty-failed-atlas-restore-native-first.json).
Research typechecking passes and the production runtime hash remains unchanged.
This follow-up changed only the research fixture and evidence, with no commits.

## Returning to a failed coarse mip after detail recovery

The four ASTC 6x6/8x8 × insertion-order runtime cases now return from the
healthy detail view to the failed coarse-only view for 100 updates, then zoom
back in. The four resident detail pages and their atlas texture survive; page
reads remain at 12 and compressed uploads at nine, with no new texture storage
allocations. This checks the cleanup boundary after a resource has recovered
useful pages, rather than only its initially empty state.

A temporary mutation removed both resident-page guards from demand suppression
and GPU release. All four cases failed at the new zoom-out assertion: resident
pages fell from four to zero. The production source was restored byte-for-byte
in a finally block. The restored runtime/growth suites pass all 116 tests, root
typechecking passes, and diff whitespace checks pass. This follow-up changes
only regression coverage and this report; it makes no GPU performance claim
and adds no runtime code. No commits were made.

## Late transport rejection after cancellation

Two native runtime regressions (ASTC 6x6 and 8x8) hold the first page transport
open even after its signal is aborted. The view moves away and returns; a second
read of the same page loads successfully before the old transport rejects.
After that rejection and 100 updates, the valid page remains resident with zero
failed pages and zero pending page bytes. Runtime invalidation reloads the page
successfully (three reads total, two uploads), and removing the scene releases
all retained GPU budget.

Removing the per-read abort guard from the rejection handler temporarily makes
both cases fail: the late rejection incorrectly marks the currently resident
page failed. The original production file was restored byte-for-byte in a
finally block. The restored runtime/growth suites pass 118 tests and root
typechecking passes. This is deterministic transport/runtime coverage with
mocked GL, not a physical GPU or timing measurement. No production change was
needed and no commits were made.

## Native transport reservations

The existing authored transport overlap test now covers PNG, ASTC 6x6, and
ASTC 8x8, each with normal completion and cancellation. It first loads the
coarse page, then holds four detail transports simultaneously while asserting
that the preparation owner has zero active decode jobs. Pending page storage
is exactly 270,400 bytes for four 130×130 RGBA pages, 36,864 bytes for four
144×144 ASTC 6x6 pages, and 20,736 bytes for four 144×144 ASTC 8x8 pages.

Normal completion reaches five resident pages with zero pending pages/bytes.
Cancellation aborts all four signals and releases all pending bytes after the
transport rejects. The native cases never invoke image decoding and issue one
coarse compressed upload when cancelled or five uploads when completed.
The restored runtime/growth suites pass 122 tests; root typechecking and diff
whitespace checks pass. Only tests and this evidence changed, with no commits.

Review boundary: runtime byte/job reservations remain held until asynchronous
work settles. A custom transport that ignores abort and never settles can retain
those reservations; releasing them at cancellation alone would break the bound
on outstanding operations. This test uses transport rejection on abort and does
not claim a deadline for network cancellation or test browser Fetch internals.
No production workaround for a never-settling custom transport was introduced.
