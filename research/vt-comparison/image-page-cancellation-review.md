# Cancelled image-page bitmap ownership

An authored image page can be cancelled while its first `createImageBitmap`
operation is in flight. Previously, a decoded size mismatch still started a
second bitmap decode with resize options. The runtime eventually discarded the
obsolete result, but could not prevent this unnecessary preparation work.

A four-line guard after the first bitmap resolves closes that bitmap and rejects
with `AbortError` before resizing. It adds no persistent state, helper or work to
the per-frame path. Native block copying is unchanged. This does not interrupt
an already-running browser decode or prevent cancellation during a resize that
has already started; existing runtime result ownership handles that completion.

Three held-decode tests cancel before resolving 128-, 144- and 4096-pixel square
bitmaps for a 144-pixel stored page. Each closes the first bitmap exactly once,
rejects with `AbortError` and invokes the bitmap decoder once. The two size
mismatches previously invoked it twice. Removing the guard makes all three
cancellation tests fail. Three non-cancelled controls still produce 144-pixel
pages and preserve the expected one- or two-decode path.

Validation:

- Full checkpoint: 1,477 tests in 151 files, plus 65 glTF manifest cases.
- The subsequent six-case cancellation/normal-path file passes (three additional
  normal-path cases were added after that full checkpoint).
- Root TypeScript, lint, packed consumer entrypoints/codecs and bundle checks pass.
- The package fits its existing ceiling. An initial bundle run exceeded prior
  incremental/lazy/main/deployed ceilings by 4/3/15/13 gzip bytes respectively.
  After package rebuilding, the bundle exceeded the original initial/lazy/main/
  deployed ceilings by 4/18/42/40 bytes. Named allowances are 8 bytes for initial
  and 64 bytes for incremental/lazy/main/deployed output. These overages are not
  isolated binary deltas against a separately rebuilt baseline; the variation
  also means the first run alone underestimated the allowance needed.

This is measured operation-count evidence from mocked bitmap completion, not
host-GPU timing or a quantified GC reduction. Avoiding an unnecessary resize is
the retained improvement; no steady-frame speedup is claimed. No commit was made.

## Headless host-GPU integration follow-up

Rebuilt the current worktree and ran the sixteen-source SVG/native mixed workload
at 64 MiB with 120 moving frames and context restoration, sequentially for ASTC
6x6 and 8x8. Both used ANGLE Vulkan on Intel Iris Xe (TGL GT2), not software
rendering. Artifacts are `image-cancellation-gpu-6x6.json` and
`image-cancellation-gpu-8x8.json`.

Both runs have 336 admitted/resident pages before loss and after restoration,
672 total uploads, two atlas pools and zero pending, failed or unresident pages.
The sampled center pixel is [255,255,255,255] for 6x6 and [254,254,254,255]
for 8x8, within the fixture's rendering tolerance. Median/p95 submission times are
0.5/0.9 ms in each run; each measured window contains one GC event. These are
single current-worktree samples, not a comparative speedup or churn reduction.
This workload uses automatic SVG pages beside authored native pages and does not
directly exercise cancelled authored-image resizing; that behavior is established
by the six deterministic bitmap tests above.

## Real bitmap decoding follow-up

`image-page-cancellation.html` exercises real browser PNG decoding with prepared
Blobs, cancelling immediately after the first decode is submitted. It runs three
repetitions of cancelled and non-cancelled 128-, 144- and 2048-pixel square images.
The fixture observes bitmap dimensions and close calls and checks that every
bitmap is already closed before its diagnostic cleanup. The previous implementation
is built through a single-file override; current production stays unchanged.

Both eighteen-case runs pass their expected contracts on headless Chromium with
Intel Iris Xe ANGLE Vulkan. In the previous implementation cancelled reads return
a page; the current implementation rejects them with `AbortError`. Non-cancelled
pages still return 144-pixel bitmaps in both builds.

| Cancelled input | Previous decode calls per read | Current calls | Previous/current median elapsed ms |
| --- | ---: | ---: | ---: |
| 128 × 128 | 2 | 1 | 1.5 / 0.6 |
| 144 × 144 | 1 | 1 | 0.5 / 0.5 |
| 2048 × 2048 | 2 | 1 | 44.9 / 23.8 |

Artifacts: `image-cancellation-real-browser-baseline.json` and
`image-cancellation-real-browser.json`. These timings include fixture wrappers,
promise handling and cleanup, and have only three samples per condition. They
illustrate the avoided second decode, not a stable speedup estimate. Both builds
must still finish the initial full-size decode. Output-pixel counts are not peak
browser memory measurements, and this fixture performs no GPU texture uploads.
The research TypeScript check passes. No additional production change or commit.

## Resize already in flight

Three runtime regressions now hold the second bitmap decode until removal,
disposal or context invalidation. Removal and disposal close its late result
exactly once, issue no texture upload and release pending-page bytes. An omitted
late-result close fails both regressions.

Context invalidation has a different contract: it invalidates GPU storage while
preserving CPU work for restoration. The first test incorrectly expected this
case to discard the bitmap. Inspection of `invalidate()` established that this
was a test assumption, not a runtime defect. The corrected regression verifies
one queued page charged at 82,944 bytes, no upload or close before restoration,
then exactly one uploaded/resident page, closed bitmap and zero pending bytes
after a restored update. The decoder is called only twice throughout. A mutation
that discards decoded work merely because GPU storage is absent fails this test.

Both controls were restored byte-for-byte; all nine image-cancellation tests and
root TypeScript pass. No additional production change was needed. These lifecycle
checks use fake GL and held bitmap promises; they do not measure restore latency.
