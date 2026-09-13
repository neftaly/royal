# Heap attribution for repeated SVG replacement

Date: 2026-09-13. Research-only pass; no production changes or commits.

The unique/reused URL control left about 0.85 MB of additional live JS heap after
96 replacements. This pass captures heap snapshots after warm-up, after twelve
replacement windows, and after cleanup, using the reused-URL SVG fixture. Snapshots
perturb GC and warm-up; the earlier [uninstrumented identity runs](identity-results.md)
remain the reference for the heap trend.

## Findings

Snapshot shallow/self-size totals increase by 948,852 bytes from before to after:

| Node category | Increase | Share of snapshot self-size increase |
|---|---:|---:|
| V8 code nodes | 757,724 B | 79.9% |
| Native/browser nodes | 172,948 B | 18.2% |
| All other categories | 18,180 B | 1.9% |

Instruction streams account for 516,736 bytes of the code increase. Feedback
vectors and other code metadata account for much of the remainder. Native increases
include the engine's double-string cache, weak-array storage and browser resource,
long-task and long-animation-frame timing records. These categories come directly
from the snapshot labels; they are not renderer-owned-byte estimates. Snapshot
self-size totals include native nodes and must not be equated with CDP `usedSize`.

Plain `Object` nodes increase from 270 to 346 (+76). Comparing node identities finds
96 new plain objects and 20 removed ones. Exactly 76 of the new objects have strong
reference paths through V8 `AllocationSite` nodes. The source-like objects that
initially looked suspicious—texture references, decoded-owner entries and VT demand
workspaces—are examples of these engine-held literal templates. The remaining 20
new plain objects are current renderer scene/state caches and diagnostic snapshots,
replacing the 20 removed objects rather than accumulating one per load.

Bitmap, Blob, WebGLTexture, canvas-wrapper and ArrayBuffer node counts do not grow
between the snapshots. These counts include prototypes/wrappers and do not measure
GPU residency or prove that a wrapper represents an open browser resource. The VT
fixture independently asserts zero reported atlas/source ownership after each
removal, with no errors.

This evidence explains the dominant growth as engine warm-up and browser timing
bookkeeping. It does not establish a VT source leak in this fixture, so no speculative
production fix is justified. It does not prove all lifetimes leak-free: the capture
covers ordinary SVG replacement on this host, not marked ASTC promotion, every
cancellation point, or another browser/device.

## Cleanup and review

After cleanup the snapshot total is 28,968 bytes smaller; most warmed code remains.
The fixture's module still holds its disposed root object, so this is a cleanup
check, not a test that all root JavaScript objects become unreachable.

The first review separated shallow size from retained/dominator size and checked
that ordinary object growth was not mistaken for live source ownership. The second
followed graph paths for new plain objects and checked relevant wrapper counts.
The graph reader uses breadth-first paths from the root while excluding weak edges;
these paths are reference evidence, not a retained-size calculation. The net/new/
removed counts reconcile exactly. Node syntax, snapshot JSON parsing and whitespace
checks pass; the hardware fixture completes 72 resident loads and 24 early
replacements with the expected zero final VT ownership counters.

## Evidence and reproduction

- [Host report](lifecycle-snapshot.json)
- [Category and resource-node summaries](lifecycle-heap-summary.json)
- [Reference paths and object classification](lifecycle-retainers.json)
- [Snapshot summarizer](summarize-lifecycle-heaps.mjs)
- [Reference-path reader](inspect-lifecycle-retainers.mjs)

Raw snapshots remain in `/tmp/royal-vt-lifecycle-snapshot-{before,after,disposed}.heapsnapshot`;
the summary records their SHA-256 hashes. They are local temporary artifacts, not
portable repository evidence. Regenerate them with the same renderer checkpoint
from [the lifecycle source hashes](lifecycle-sources.json):

```sh
VT_RETENTION_WINDOWS=12 \
VT_HEAP_SNAPSHOTS=/tmp/royal-vt-lifecycle-snapshot \
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/lifecycle.html?case=svg&reuse=1' \
VT_BENCH_OUTPUT=research/vt-comparison/lifecycle-snapshot.json \
node research/vt-comparison/run-host.mjs
node research/vt-comparison/summarize-lifecycle-heaps.mjs
node research/vt-comparison/inspect-lifecycle-retainers.mjs
```

Snapshot mode requires retention mode and is separate from CPU/allocation sampling.
The runner keeps snapshot chunks in the Node controller, writes them to disk, and
cleans up the isolated headless browser as usual.
