# Exact native page backing storage

Native page reads now copy the validated compressed blocks into an exact-size
Uint8Array before returning them. This prevents arbitrary container padding or
metadata from remaining attached to queued decoded pages, whose reservations
count compressed block bytes. The general KTX2 parser still returns zero-copy
views; only the VT page adapter compacts its result. A shared no-op close function
avoids a new closure per native page. Net production change: one source line,
no persistent state and no per-frame work.

This changes retained decoded storage, not peak Fetch memory. The full response
body still exists during parsing and the block copy, and metadata validation
still processes supplied metadata. No runtime transcoding is introduced.

## Retention and adversarial review

Six padded-container regressions cover all supported native formats, asserting
backing-buffer length equals block length and byteOffset is zero. Running those
regressions against the original source fails all six. The candidate was restored
byte-for-byte afterward and the restored cases pass.

The separate headless browser fixture strongly holds six decoded pages, each
read from a container with 1 MiB trailing data. WeakRefs track the original
response arrayBuffers and are inspected only after forced GC. Before compaction,
all six original bodies remain reachable and decoded views retain 6,379,328 bytes.
After compaction, none of those bodies remains reachable and held block storage
is exactly 86,976 bytes. Thus the close callback does not keep those bodies alive
in this browser. This is a targeted retention check, not a universal GC deadline.

Both mixed-source insertion orders pass actual headless Intel GPU context loss
and restoration with compacted native uploads: 84 resident pages in two pools,
zero failed/pending/unresident pages, healthy pixel and GL-error checks. The
44-case source-combination matrix passes as well.

## Normal-read cost

Four sequential in-memory read runs, builds/tests idle, in before/after/after/
before order. Each run includes 4,800 reads in eight alternating-format rounds:

| Format | Before µs/page | After µs/page | After repeat | Before repeat |
| --- | ---: | ---: | ---: | ---: |
| ktx2-etc2 | 59.5 | 52.0 | 55.5 | 56.5 |
| ktx2-astc-6x6 | 44.0 | 39.5 | 52.5 | 40.5 |
| ktx2-astc-8x8 | 33.5 | 31.5 | 49.0 | 35.5 |
| ktx2-bc1 | 43.0 | 40.0 | 53.5 | 46.5 |
| ktx2-bc3 | 59.5 | 59.0 | 63.0 | 55.0 |
| ktx2-bc7 | 57.0 | 63.0 | 69.5 | 55.0 |

These are medians of 100-read batch averages. The copy adds work; several formats
are slower in the repeat, and results vary between runs. No speed improvement
or absence of overhead is claimed. All runs record nine GC events; total GC times
are 10.316, 12.739, 11.156, and 9.118 ms in run order. These short runs do not
establish a general GC regression or improvement. Retaining exact memory bounds
is the reason for the change. Network, runtime scheduling and GPU upload are
excluded from these read timings.

## Validation and size

Full suite: 1,387 tests across 149 files plus 65 glTF manifest cases. Root and
research typechecks, lint, packed consumers and final bundle checks pass. The
packed renderer is 750,388 bytes, four bytes above the previous ceiling; a named
16-byte allowance raises that ceiling to 750,400. Lazy/total bundle overages
were 20/29/31 bytes; a named 32-byte allowance raises the affected ceilings.
Overages are not binary deltas. An initial bundle run during package builds
failed import resolution; rerunning after those builds completed exposed the
actual size overages and passed after their recorded allowance.

The [patch](native-page-compaction.patch) and [source hashes](native-page-compaction-sources.json)
record the exact source pair; both benchmark source maps match those hashes.
No commits were made.

Evidence: [retention before](native-page-compaction-retention-before.json),
[retention after](native-page-compaction-retention-after.json),
[read before](native-page-compaction-read-before.json),
[read after](native-page-compaction-read-after.json),
[read after repeat](native-page-compaction-read-after-repeat.json),
[read before repeat](native-page-compaction-read-before-repeat.json),
[SVG-first restoration](native-page-compaction-gpu-svg-first.json),
[native-first restoration](native-page-compaction-gpu-native-first.json),
[source matrix](native-page-compaction-source-regression.json).

## Exact payload preservation follow-up

The six compaction cases now each run with and without metadata: orientation,
identity swizzle, and a longer unknown writer value before block storage. The
fixture's indexed block range is filled with a deterministic nonuniform pattern;
the test compares every returned byte with that range, as well as checking exact
backing size and zero byte offset. These are opaque structural test payloads,
not compressed blocks asserted to render valid pixels.

A mutation returned a correctly sized zero-filled array instead of copied blocks.
All twelve tests failed, proving the coverage checks content rather than only
allocation size. The first deep-array assertion took 47.69 seconds to render its
large failure diffs; it was allowed to finish and restored the source normally.
The assertion now reports the first mismatching byte index. The same mutation
fails all twelve in 1.35 seconds while still scanning every byte on success.
Production source was restored byte-for-byte after each mutation.

The final runtime/growth suites pass 180 tests; root typechecking and diff
whitespace checks pass. The page-source hash still matches the retained
compaction fix. This follow-up changes only tests and evidence; no commits.

## Valid padded ASTC GPU uploads

The steady fixture now supports selecting authored ASTC 6x6 or 8x8 and adding
1 MiB trailing padding to each valid page response. Unlike the patterned unit
test bytes, these original page blocks encode the fixture artwork and are rendered
through the real native atlas upload path. The padding mode is separate from
failure injection.

Both formats pass headless Intel GPU rendering, actual context loss/restoration,
and 120 moving frames afterward. Each loads 21 pages before loss and restores
21 afterward (42 padded page reads total), with zero failed/pending/unresident
pages and zero pending page bytes at completion. White-center and GL-error
checks pass. Separate unpadded controls on the same build have exactly matching
final VT snapshots, sampled pixels, and screenshot PNG bytes for each format.

[6x6 padded](native-page-padding-6x6.json),
[6x6 control](native-page-unpadded-6x6.json),
[8x8 padded](native-page-padding-8x8.json),
[8x8 control](native-page-unpadded-8x8.json).

These are correctness comparisons, with independent formats allowed to run
concurrently; their timing/GC fields are not used as performance evidence.
Research typechecking and diff whitespace checks pass. The production page-source
hash is unchanged. Only fixture support and evidence changed; no commits.

## Cancellation before queued native decoding

Twelve new source-boundary cases cover each native format with valid blocks and
with invalid container bytes. The response body arrives, then an injected decode
scheduler holds work. The read is cancelled before that scheduler deliberately
resumes the callback. Every case rejects with AbortError; valid bytes are not
returned as a decoded page, and malformed bytes do not produce a parser error.
The source therefore protects its own decode boundary even when a scheduler does
not suppress cancelled callbacks. This is cancellation after body acquisition,
not a claim that the response allocation is avoided.

A mutation removed the native callback's abort guard. All twelve cases failed,
then the page source was restored byte-for-byte in a finally block. With the guard
restored, all 192 runtime/growth tests and root typechecking pass. Diff whitespace
checks pass and the page-source hash remains that of the retained compaction fix.
Only regressions and evidence changed; no production changes or commits.

## Ready-page cleanup on context invalidation

Six runtime cases stop after a native page has decoded and queued, before any
compressed upload. Invalidation immediately clears its pending-page count and
byte reservation, releases the atlas/table budget, and leaves no uploaded page.
A subsequent update reloads that page successfully without reopening the manifest:
three total fetches (manifest, original page, replacement page) and one upload.
Final disposal returns retained GPU budget to zero.

Removing clearReadyPages from runtime invalidation makes all six cases fail.
The runtime was restored byte-for-byte in a finally block. The final runtime/growth
suites pass 198 tests, root typechecking and diff whitespace checks pass. These
mocked-GL cases target a queued-before-upload state; earlier physical host-GPU
restoration runs cover rendering after resident-page loss. No production changes
or commits were made.

## In-flight page completion while GPU storage is absent

The six ready-page invalidation cases now each have a loading variant. Transport
is held before returning page bytes, runtime invalidation releases GPU storage,
and the existing read remains active with its original pending-byte reservation.
The test then releases transport before performing another runtime update. Read
completion queues the valid native page while atlas storage is still absent.
The next updates recreate storage and upload that page without another read.
Each loading case makes two fetches total (manifest and page), one compressed
upload, and settles pending bytes to zero. The ready-page variant still makes
three fetches because invalidation deliberately cleared its already-decoded queue.

A mutation aborted active page controllers during invalidation. All six loading
cases failed; the runtime was restored byte-for-byte afterward. Final runtime/
growth suites pass 204 tests, root typechecking and diff whitespace checks pass.
These controlled transport/runtime checks distinguish GPU invalidation from asset
removal or demand cancellation. No production changes or commits were made.

## Shared format matrix maintenance

Five runtime test matrices now share one explicit six-format/Vulkan-ID table:
malformed-page lifecycle, unsupported capability, block compaction, queued decode
cancellation and context invalidation. The table remains independent of production
format mappings so those mappings are still tested against explicit expected
values. Specialized block-size/WebGL-format cases retain their separate expected
facts. This removes repeated format lists without removing any cases: all 204
runtime/growth tests and root typechecking pass, with one fewer test-source line.
No production changes or commits were made.

## Authored ASTC byte-limit boundaries

Eight runtime cases cover ASTC 6×6 and 8×8 at one byte below, and exactly at,
one and two stored pages. A 128-pixel page with an eight-pixel border stores
144×144 pixels: 9,216 bytes for 6×6 and 5,184 bytes for 8×8. The fixture uses
two pages in a single authored mip so the test isolates capacity rather than
whole-level coarsening. An initial five-page fixture correctly settled on one
coarse page at a two-page capacity; that was a test assumption, not a runtime bug.

Below one page the resource becomes unsupported without fetching a page. At the
other boundaries it fetches and uploads exactly the admitted number of pages.
Another 100 updates cause no additional reads or atlas allocations. Pending page
bytes settle to zero, and disposal releases all retained GPU budget. These limits
bound per-resource residency, not the allocation size of a shared native atlas.

Changing the capacity calculation from floor to ceil makes all four below-boundary
cases fail. The production file was restored byte-for-byte afterward. Runtime,
growth and storage-plan suites pass 220 tests; root typechecking and diff whitespace
checks pass. Logs: `/tmp/royal-vt-native-byte-boundary-suite.log` and
`/tmp/royal-vt-native-byte-boundary-mutation.log`. These are mocked-GL correctness
checks, not new performance measurements. No production changes or commits were made.
