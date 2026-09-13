# Cancelled preparation queue retention

When preparation capacity was full, cancellation reduced the public queued
count and cleared the preparation callback but left the cancelled job record in
the FIFO. `#drain()` discarded cancelled records only inside its capacity-available
loop. Repeated scene replacement could therefore retain promises, signals and
job metadata while an active transport remained unresolved.

One additional line in the cancellation callback discards the cancelled prefix
of the affected lane immediately. It adds no persistent data or per-frame work,
does not release running-job capacity and reuses the existing amortized FIFO
cleanup. It stops at live queued work. Cancelled entries behind a live queued job
can still remain until that job advances; this is not arbitrary queue compaction
or a hard bound on every cancellation pattern.

Two tests alternate enqueue/cancel 100 times with capacity held full, separately
for detail and foreground lanes. Before the fix no cancelled records are
dequeued, despite the public count being zero; afterward all 100 are released.
Two further cases preserve a live queued head ahead of a cancelled tail. An
unconditional-dequeue mutation fails those cases. The mutation was restored
byte-for-byte. The first version of that control reached test timeouts after
losing live work; a direct dequeue assertion now detects it immediately.

## Browser heap evidence

The headless Intel Iris Xe ANGLE Vulkan runner holds one job active and performs
six windows of 1,000 alternating foreground/detail cancellations. It forces GC
between windows while retaining the owner, without tracing or allocation
sampling. Both builds report one active job and zero queued jobs throughout.

| Checkpoint | Previous live JS heap bytes | Fixed live JS heap bytes |
| --- | ---: | ---: |
| Prepared | 672,456 | 672,456 |
| 1,000 cancellations | 1,119,456 | 721,296 |
| 2,000 | 1,533,828 | 725,360 |
| 3,000 | 1,943,712 | 725,512 |
| 4,000 | 2,356,084 | 725,512 |
| 5,000 | 2,760,632 | 725,536 |
| 6,000 | 3,176,972 | 725,536 |

Artifacts: `cancelled-queue-retention-before.json` and
`cancelled-queue-retention-after.json`; fixture `cancelled-preparation-queue.ts`.
The previous implementation is a single-file build override. This confirms
reduced retention for cancelled-prefix workloads, not reduced allocation churn,
frame latency, GPU memory or arbitrary interior cancellation patterns. The
initial fixed-heap increase includes browser/JIT/fixture overhead.

Validation: 1,487 tests plus 65 glTF manifest cases; root and research TypeScript,
lint, packed consumer and bundle checks. The package fits its previous ceiling.
Initial bundle output exceeded its ceiling by one gzip byte, covered by a named
eight-byte allowance; other ceilings were unchanged. No commit was made.

## Interior cancellation follow-up

The fixture's `?interior` mode keeps one live queued job at the front of each lane
for three cancellation windows. Before window four it settles the active job,
waits for both live queued jobs to complete, then holds a new active job while
continuing cancellations. The current implementation produces these forced-GC
live JS heap samples:

| Checkpoint | Bytes |
| --- | ---: |
| Prepared | 680,308 |
| 1,000 cancellations behind live work | 1,134,400 |
| 2,000 | 1,548,820 |
| 3,000 | 1,958,712 |
| Live jobs advanced; 4,000 cancellations total | 732,692 |
| 5,000 | 734,940 |
| 6,000 | 734,940 |

Artifact: `cancelled-queue-interior-retention.json`, headless Intel Iris Xe ANGLE
Vulkan. Cancelled callbacks never execute; the two live queued jobs complete
before the second phase. This confirms eventual release when the queue advances.
It does not bound retained metadata if live work indefinitely blocks the queue.

No further queue redesign is retained from this pass. Eager full-queue removal
would need its scan/movement cost evaluated under sustained cancellation; a
linked queue would add state and implementation complexity. The immediate prefix
fix stays small, and the interior-stall limitation is now measured explicitly.
Research TypeScript passes; no production change or commit in this follow-up.

## Renderer lifecycle integration

The current-worktree delayed lifecycle fixture also passes on the headless Intel
host GPU for SVG and raster sources, each reusing the same source URL across
three measured windows. Each case completes 18 resident loads and six early
replacements, records six transport aborts, and ends with zero active reads,
atlas bytes/pools, resident/pending pages, pending-page bytes, automatic resources
and automatic decoded bytes. Every removal is checked for release and GL errors.
Artifacts are `cancelled-queue-svg-lifecycle.json` and
`cancelled-queue-raster-lifecycle.json`.

Forced-GC live JS heap samples (prepared and after each eight-cycle window):

- SVG: 2,561,276 → 2,971,076 → 3,136,096 → 3,156,020 bytes.
- Raster: 2,315,792 → 2,700,172 → 2,847,628 → 2,887,452 bytes.

These short runs do not establish a heap plateau or attribute the remaining JS
growth. They verify VT resource release and loading progress, not a comparative
heap improvement in the renderer. Transport counts end at response headers and
are not a count of live decoded bitmaps. The fixture exercises scene removal and
reloading, not context loss; the preceding mixed-source GPU tests cover context
restoration separately. No additional production change or commit.

## Extended lifecycle follow-up

Twelve-window runs complete 72 resident loads and 24 early replacements per
source class (192 measured load/removal cycles total). Both record 24 transport
aborts and zero final VT ownership counters. Backing-buffer storage remains
constant throughout: 405,536 bytes for SVG and 402,533 for raster.

| Case | Prepared live JS bytes | After 96 cycles | Range of final six samples |
| --- | ---: | ---: | ---: |
| SVG | 2,561,312 | 3,440,836 | 79,700 |
| Raster | 2,315,792 | 3,091,308 | 49,640 |

The growth slows but does not establish a flat plateau. Current artifacts are
`cancelled-queue-svg-lifecycle-long.json`,
`cancelled-queue-raster-lifecycle-long.json` and the checked counter/hash summary
`cancelled-queue-long-lifecycle-validation.json`. Earlier
[heap attribution](lifecycle-heap-results.md) on this fixture found mostly engine
code and browser bookkeeping growth; that is useful context, not attribution
proof for this newer checkpoint. Current residual JS growth remains unattributed.
Neither zero VT ownership nor stable backing storage alone proves every JS
object lifetime is bounded.

A subsequent [current SVG snapshot analysis](cancelled-queue-lifecycle-attribution.md)
attributes 81.0% of shallow-size growth to V8 code/metadata and 17.1% to native
bookkeeping. Relevant bitmap/buffer/texture node counts do not grow. This updates
the SVG attribution at the current checkpoint. Its raster follow-up independently
attributes 92.3% to code/metadata and 5.5% to native bookkeeping with unchanged
resource-node counts. Neither run establishes a flat long-term heap plateau.

The first raster launch was rejected because automatic approval review timed
out before process creation. The permitted single retry succeeded; no duplicate
browser workload was launched. No production change or commit in this pass.
