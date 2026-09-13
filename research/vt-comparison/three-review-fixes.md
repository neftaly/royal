# Three adversarial-review fixes — 2026-09-13

All three reported reproductions are fixed. Changes remain uncommitted.
The production delta from the reviewed checkpoint is 143 net lines, with no
new dependencies, public renderer options, runtime encoder or transcoder.

## Cancellation retention

Preparation jobs now carry intrusive previous/next links. Cancellation removes
any queued job in constant time, including entries behind indefinitely stalled
live work. No queue scan or separate node allocation is introduced. Active jobs
still retain their concurrency slots until their actual work settles.

[The headless retained-heap run](cancelled-interior-fixed.json) holds an active
job and a live head in each lane throughout 12 windows of 1,000 cancellations.
The final six heap samples vary by 576 bytes, ending at 728,628 bytes. The queue
and live jobs remain owned throughout. This establishes bounded retention for
this reproduction, not a reduction in allocation churn or universal heap bounds.
Behavioral tests cover FIFO order, both lanes, arbitrary removals, repeated abort,
disposal and preserved concurrency limits.

## Ordinary texture budget recovery

Only referenced authored VT contributes the provisional ordinary-storage reserve.
Settled unsupported/failed manifests and unreferenced declarations reserve none.
Format checks occur before allocation and also re-enable extensions when GPU
storage is recreated. A manifest finishing during context loss defers the check.

Ordinary preparation proceeds while manifests load. Increased allowance can
restore fitted raster dimensions or reread discarded native mip levels. Optional
raster leases are released only when a larger fit is useful; vector authority
and explicit native-preview refinement remain intact. The previous ordinary GPU
texture survives while a replacement is deferred. Unchanged allowances do not
repeatedly decode assets.

[The integrated GPU test](ordinary-vt-budget-recovery.json) deliberately hides
ASTC support and holds its manifest until a fitted PNG has automatic VT residency.
The PNG renders while transport is held, then grows from 1773×1773 to 2048×2048
when unsupported VT releases the reserve. The restored pixel is [255,0,0,255].
This covers actual raster lease release, browser re-decode and GPU publication.

## Migration recovery

When old/new overlap blocks growth, RGBA pools can first compact to resident
coarse roots, then grow. Every visible resource must have its root resident, and
the final replacement must fit beside the intermediate atlas. Both migrations
reuse bounded copy/upload scheduling, fences and real budget claims. Newly
needed coarse roots cancel a pending compaction that would discard them.
The blocked-plan cache retries after page uploads, since a newly resident root
can make compaction possible without changing demand or free GPU bytes.

Unit tests cover complete 341-page recovery, validation failure preserving old
coverage, late root arrival, bounded accounting and stable blocked-plan caching.
Removing upload progress from the cache key makes the late-root test fail; the
production source was restored and the complete suite rerun afterward.

| Headless Intel Vulkan, 64 MiB, 16 mixed sources | Before loss | After restore | Submission median / p95 | Measured GC |
| --- | ---: | ---: | ---: | ---: |
| [ASTC 8×8, staggered SVG arrival](three-fixes-staggered-8x8.json) | 336/336 | 336/336 | 0.6 / 0.9 ms | 1 event, 0.503 ms |
| [ASTC 6×6, staggered native arrival](three-fixes-staggered-6x6.json) | 336/336 | 336/336 | 0.5 / 0.8 ms | 1 event, 0.669 ms |

Both runs require full admitted demand before context loss and after restoration;
zero pending pages alone can describe an intermediate coarse atlas. They finish
without failed or unresident pages. Each measures 120 moving frames. These are
regression checks, not demonstrated speedups or physical iPad/Quest results.

Compaction temporarily reduces detail and may reread discarded pages. Without
resident roots or sufficient intermediate storage, it preserves the existing
atlas rather than pretending impossible allocations fit. Native pools remain
fixed after allocation.

## Final validation and size

- 1,504 tests across 152 files, plus 65 glTF manifest cases.
- Root and research typechecks, lint, packed consumer/codec checks, bundle checks,
  and `git diff --check` pass.
- The measured build exceeded the previous deployed-JS ceiling by 581 gzip bytes
  and the initial ceiling by 464. Named allowances add 640 and 512 respectively;
  the lazy allowance adds 128 bytes. The worker ceiling is unchanged.
- The package exceeded its previous ceiling by about 3 KiB; its named allowance
  adds 4 KiB. Final packed-consumer validation passes.

The final review specifically checked late completion, context loss, queue
ownership, preservation of old GPU storage during upgrade deferral, migration
failure, missing-root recovery and allocation/retry churn. No further blocker
was found in that scope. The user-owned proposal was not edited; nothing was
committed, pushed or deployed.
