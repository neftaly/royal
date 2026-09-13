# Authored residency ceilings during view changes

The authored `physicalSlots` and `physicalByteBudget` ceilings previously limited
current demand, but did not limit cached resident pages. A one-page ASTC texture
could retain two pages after panning between regions because the shared atlas
still had free slots. Eight initial ASTC cases reproduced this in both scene
orders, for both byte and slot ceilings.

The retained fix supplies the texture's existing resident-slot map to slot
selection once its capacity is reached. Selection then chooses the oldest
unprotected owned page, preserving neighboring textures, protected pages and
existing-page replacement. The ordinary shared-atlas scan remains unchanged.
There is no new persistent state or encoding/transcoding work. The change adds
14 production lines across the runtime and residency helper; the helper comment
no longer claims allocation-free execution because the capped path iterates a map.
[Exact patch](resident-limit.patch) and [source hashes](resident-limit-sources.json).

## Adversarial checks

Twelve runtime cases cover ASTC 6×6, ASTC 8×8 and generated RGBA pages, byte/slot
ceilings, and both resource orders. One texture is limited to one page; its
neighbor holds two pages in the same atlas. Panning left, right, then left keeps
the first at one resident page and the neighbor at two. It makes five total page
uploads and seven fetches including the two manifests. A further 100 updates
cause no extra reads, uploads or atlas allocations. Pending bytes settle to zero
and disposal releases all retained GPU budget.

A pure-selector test includes empty slots, neighboring slots, older protected
owned pages and newer unprotected owned pages. It verifies oldest eligible owned
selection, existing-page reuse and a blocked result when every owned page is
protected. The supplied map is the runtime's internal resident index, not an
untrusted caller-provided manifest field.

Removing the runtime's owned-slot argument makes all twelve moving-view cases
fail. The source was restored byte-for-byte afterward. This specifically checks
the connection between authored capacity and actual slot selection; a standalone
capacity calculation or a fixed view would miss the defect.

### Replacement upload failure ordering

Six additional runtime cases cover synchronous replacement-upload exceptions
for every native format. After the exception, the original binding, resident
page, retained GPU budget and published page table remain unchanged. The failed
ready page releases its pending-byte reservation. Returning to the original
region for 100 updates needs no new read; revisiting the replacement region
then succeeds with the same asset/version and existing atlas. Final disposal
returns retained GPU budget to zero.

A mutation removes the old logical resident before attempting upload. All six
cases fail; the runtime was restored byte-for-byte afterward. The related
runtime/growth/storage/residency suites pass 249 tests and root typechecking
passes. This uses a mocked synchronous exception before physical upload. The
exception still propagates as designed; the test does not claim to detect a
driver's asynchronous error flag or undo partially written GPU pixels.
[Validation record](capped-upload-failure-validation.json).

### Upload-budget deferral and cancellation

Twelve cases cover all six native formats, followed by either admission or
cancellation of a deferred replacement. A one-byte test upload budget is
consumed before each VT update, modeling other work using the frame allowance.
After 100 such updates, exactly one decoded replacement and its unchanged byte
reservation remain pending. The existing binding, resident page and published
page table are preserved, with no repeated read or upload.

An empty next frame admits the oversized page, completing replacement without
another read. In the cancellation variant, returning to the old region first
releases the ready page and its bytes while preserving old coverage; revisiting
the new region performs one fresh read. Both variants finish with one resident
page and release all GPU budget on disposal.

A mutation discarded ready pages when upload admission was denied. All twelve
cases fail on the extra fetch, then pass after byte-for-byte source restoration.
The related five suites pass 265 tests and root typechecking passes. These are
controlled accounting/scheduling tests, not frame-time or GC measurements.
[Validation record](capped-deferral-validation.json).

## Actual GPU replacement and restoration

The [headless host-GPU matrix](resident-limit-gpu.json) covers ASTC 6×6/8×8,
byte/slot limits and both scene orders. The capped texture pans red → blue → red;
its neighbor retains green and yellow pages. After context loss/restoration, the
same three poses are repeated. All eight cases pass: 48 settled views and 144
sampled pixels match the intended colors exactly. Each case ends with one shared
atlas, three resident pages, ten page uploads, twelve fetches including manifests,
and zero failed/pending pages or pending bytes. Another 100 updates cause no
extra reads or uploads; root disposal returns retained GPU budget to zero.

An isolated control build uses the pre-fix runtime with the current helper. It
fails on the first pan of the first ASTC 6×6 byte-limit case, retaining four
pages rather than three. The control stops there; it does not establish eight
independent GPU failures. The production worktree was not mutated for this check.
[Fixture](resident-limit-gpu.ts), [validation and source hashes](resident-limit-gpu-validation.json).

The fixture recolors the test helper's valid constant-color LDR void-extent ASTC
blocks. It uses real compressed uploads and page-table rendering, with no codec
or production encoder. This is a correctness test, not a timing or GC benchmark;
its aggregate trace includes setup, screenshots and repeated context creation.
These results cover capped eviction directly, unlike the warm timing workload
below. They do not change the fixed native atlas allocation policy.

## Performance and GC review

The first three-line candidate filtered owners inside every atlas scan. Isolated
Node measurements showed roughly 23–24% slower uncapped full scans, and scanning
3,600 slots for a capped texture took 11.434 µs even with only six owned pages.
That version was replaced. Its [patch](resident-limit-first.patch),
[hashes](resident-limit-first-sources.json) and [measurements](resident-limit-first-cpu.json)
remain evidence of the rejected approach.

The revised [CPU measurement](resident-limit-cpu.json) extracts and transpiles the
actual selectors. Six alternating rounds of 10,000 calls cover 512/3,600 slots,
partially empty/full pools, and uncapped/capped resources. Uncapped full scans
change from 3.033 to 2.981 µs and 21.045 to 20.539 µs; partially empty scans change
from 0.243 to 0.249 µs and 0.249 to 0.271 µs. Capped scans over the mostly empty
3,600-slot pool take 0.161 µs. Capped before/after timings are a cost comparison,
not equivalent behavior: the old selector ignores the ownership restriction.

The headless Intel-GPU 16-texture ASTC 8×8 moving-camera workload runs 600 measured
frames per build. Median/p95 submission times are 0.5/0.9 ms in both runs, with
336 pages resident and zero pending or failed pages. Both sampled center pixels
are `[254,254,254,255]`. GC is 11 events/8.419 ms before and 10 events/7.936 ms after;
sampled allocation totals are 15,007,924 and 14,526,624 bytes. These profiled runs
support no observed regression for this path, not a speed or allocation benefit.
They exercise a warm scene, not sustained capped-page replacement.
[Before](resident-limit-host-before.json), [after](resident-limit-host-after.json),
[before allocation summary](resident-limit-profile-before.json),
[after allocation summary](resident-limit-profile-after.json).

Full screenshots are not byte-identical: before/after differs at 3,306 of 262,144
pixels, by at most `[2,1,2,0]` RGBA levels. An [unchanged-build repeat](resident-limit-host-after-repeat.json)
differs from the first after run at 7,444 pixels, by at most `[4,2,2,0]` levels.
All three final VT snapshots are identical. Thus the initial mismatch does not
isolate a change-induced regression; the underlying source of this small
run-to-run rendering variation was not determined. The repeat measures 0.5/0.8 ms
median/p95 and ten GC events totaling 6.870 ms.
[Pixel comparison](resident-limit-image-comparison.json),
[repeat allocation summary](resident-limit-profile-after-repeat.json).

A separate browser [capped selector profile](resident-limit-slot-profile.json)
performs 2.4 million choices after 300,000 warm-up calls, over 1/8/64 owned pages
in a 3,600-slot array. Median costs are 0.0155/0.058/0.3795 µs per choice. The trace
contains one GC event (1.984 ms); sampled allocation is 131,704 bytes total, with
33,152 attributed to the selector. This does not show sustained iterator churn
in this warmed V8 run and does not guarantee zero allocation in every engine.
There is no rendering or transport in that selector probe; the host GPU is only
the runner's capability check.

## Validation

The full suite passes 1,438 tests across 149 files and 65 glTF manifest cases.
Root and research typechecking, lint and diff whitespace checks pass. GPU runs
use headless Chromium on the Intel host, with no physical-device claim. All
changes remain uncommitted.

Packed-package and bundle validation pass. The renderer tarball measures 750,644
bytes, 244 above the old ceiling; a named 256-byte allowance makes the ceiling
750,656. Lazy/deployed/main-only gzip sizes measure 130,634/274,271/214,983 bytes,
50/55/57 over the old ceilings. A named 64-byte allowance covers each affected
ceiling; initial and worker ceilings are unchanged. These overages are not claims
about exact baseline binary deltas. The first bundle attempt exhausted the host's
`/tmp` filesystem; rerunning with temporary storage on the workspace disk resolved
that environmental failure. [Validation record](resident-limit-validation.json).
