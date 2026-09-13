# Keep manifest transport out of page preparation

The retained [two-line net runtime change](manifest-transport-lane.patch) reuses
`AsyncPreparationOwner` for a dedicated eight-job manifest queue. Fetching and
parsing an authored manifest no longer occupies the root page-preparation
queue. Disposal rejects queued manifest work before resource aborts cancel
active reads. Page reads and decoding retain their existing scheduling.

The [previously starved GPU case](manifest-lane-native-gate.json) now passes:
eight native manifests remain gated until SVG has 168 resident pages, then all
336 pages become resident. Real context restoration returns to 336 residents,
with 672 uploads and no failed, pending or unresident pages. This is headless
Intel Vulkan, sixteen mixed sources and a 64 MiB budget. It demonstrates
progress under the imposed dependency, not a measured frame-rate improvement.

The manifest scheduling regression claims ten sources, verifies only eight
network reads start, and runs a foreground preparation task while those reads
remain held. It removes a queued claim and an active claim, checks the next
eligible read starts, then disposes and verifies every remaining active request
aborts. Returning transport to the shared queue fails the progress assertion;
raising its concurrency to 32 fails the eight-read bound. Both mutations were
restored. The test lives in its own file to respect the repository test-source
size limit.

The additional scheduler is allocated once per VT runtime. Existing scheduling
objects are reused as an implementation, not as a shared queue: transport and
preparation can now run concurrently with independent limits. Pending manifest
queue size still follows source claims, and total concurrent transport plus
preparation can exceed eight. This change does not add per-frame work or change
page-buffer ownership, but it does add a retained scheduler instance. No whole-
browser allocation or GC improvement is claimed. Root preparation snapshots
now exclude manifest transport; per-asset manifest loading status remains.

The full suite passes 1,467 tests across 150 files and 65 glTF manifest cases.
Root types, lint and final bundle checks pass. A named 32-byte allowance covers
observed gzip overages of 22 lazy, 17 deployed-total and 19 main-graph bytes.
Packed imports pass; the first tarball check measured 751,823 bytes, 1,103 above
its old ceiling, so a named 1,152-byte allowance sets the ceiling to 751,872.
The final packed consumer check passes. These overages are not exact
source-to-source binary deltas. [Validation hashes](manifest-transport-lane-validation.json).
No commit was made.

## Full-queue disposal follow-up

A second regression disposes with eight active and four queued manifest reads.
The active transports intentionally ignore abort, then return successful
responses after disposal. All active signals are aborted, queued reads never
start, no obsolete change notifications publish, and no GPU textures allocate.
Removing the successful-response abort/disposal guard makes this test fail with
eight obsolete notifications instead of zero. Production source is restored
byte-for-byte afterward. Both manifest scheduling tests, root typechecking and
the test-source size guard pass. This is lifecycle correctness evidence, not a
heap-retention or GC measurement. [Validation hashes](manifest-disposal-validation.json).

## Failure refill follow-up

Four further regressions cover transport rejection, HTTP 503, invalid JSON and
invalid manifest schema. After the first of eight held requests fails, the ninth
source starts without waiting for the seven remaining requests. Its valid
manifest becomes ready. One hundred updates do not retry the failed version;
changing that asset's version starts one new read and recovers it without
disturbing the already-ready neighbor.

A mutation that releases scheduler capacity only for successful jobs makes all
four cases fail because the ninth request never starts. The scheduler is restored
byte-for-byte. All six manifest scheduling tests, root typechecking and the
test-source size guard pass. No production change was needed in this follow-up.
[Validation hashes](manifest-failure-refill-validation.json).

## Delayed-source format matrix

The [four-case GPU matrix](manifest-lane-gpu-matrix.json) covers holding native
manifests or SVG sources until the opposite class has 168 resident pages, for
both ASTC6×6 and ASTC8×8. All use sixteen mixed sources and a 64 MiB budget on
headless Intel Vulkan. Every case settles all admitted coverage, with no failed,
pending or unresident pages, and completes context restoration.

Both ASTC6×6 cases and the held-native ASTC8×8 case reach 336 resident pages
before and after restoration. The held-SVG ASTC8×8 case initially admits and
resides 208 of 336 desired pages, then reaches 336 after restoration. Thus the
new transport queue resolves the tested preparation starvation, but does not
eliminate allocation-order effects on detail. These are coverage checks, not
comparative frame-time or GC benchmarks. No production change was needed.
