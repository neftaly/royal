# Current delayed SVG lifecycle heap attribution

The twelve-window snapshot run completes 72 resident loads and 24 early
replacements with 24 transport aborts and zero final VT ownership. It uses the
current queue fix, repeated source URL and delayed transport on headless Intel
Iris Xe ANGLE Vulkan. Snapshots bracket the measured cycles and cleanup. The
unsnapshotted long lifecycle artifacts remain the heap-trend reference.

Snapshot shallow/self-size totals grow by 977,380 bytes:

| Category | Increase | Share |
| --- | ---: | ---: |
| V8 code and metadata | 791,892 B | 81.0% |
| Native/browser nodes | 167,064 B | 17.1% |
| Other categories | 18,424 B | 1.9% |

Instruction streams contribute 541,568 bytes and trusted byte arrays 115,112.
Native growth includes double-string cache storage, weak-array lists and browser
timing records. These labels come from the snapshot; self-size totals include
native nodes and must not be equated with CDP live JS `usedSize` or GPU memory.

Plain objects increase from 267 to 346. There are 99 new IDs and 20 removed IDs;
79 new objects have non-weak reference paths through V8 allocation-site nodes.
Those are engine-held literal templates, not evidence that 79 VT sources remain
owned. The other 20 objects describe current scene/camera state, sampler bindings
and resource diagnostic snapshots. Counts reconcile: 99 new minus 20 removed
equals the observed 79-object increase.

ImageBitmap, Blob, WebGLTexture, canvas and ArrayBuffer node counts do not grow.
Wrapper counts can include prototypes and do not establish whether browser
resources are open; the fixture independently verifies zero VT ownership after
each removal. Cleanup reduces total snapshot self-size by 20,264 bytes, while
the fixture module still holds its disposed root and warmed engine code remains.

This follow-up attributes the dominant current SVG growth to engine warm-up and
browser bookkeeping and finds no basis for a speculative VT source-leak fix.
It does not prove every object lifetime bounded, attribute the separate raster
run, or establish a flat long-term browser heap plateau.

Evidence:

- `cancelled-queue-svg-snapshot.json`: browser result and local snapshot paths.
- `cancelled-queue-svg-heap-summary.json`: exact category/resource counts and
  SHA-256 hashes of the three raw snapshots.
- `cancelled-queue-svg-retainers.json`: non-weak BFS reference paths for new plain
  objects; these are reference paths, not dominator or retained-size estimates.

Raw snapshots are stored under `node_modules/.cache/royal-vt-cancelled-queue-svg-snapshot-*`.
The existing summarizer and retainer reader produced the reports without changes.
JSON parsing, count reconciliation and whitespace checks pass. No production
change or commit was made.

## Raster follow-up

The same current-worktree, delayed, reused-URL capture also completes for raster
sources: 72 resident loads, 24 early replacements and 24 transport aborts, with
zero final VT ownership. Snapshot shallow-size growth is 797,056 bytes:

| Category | Increase | Share |
| --- | ---: | ---: |
| V8 code and metadata | 735,804 B | 92.3% |
| Native/browser nodes | 43,504 B | 5.5% |
| Other categories | 17,748 B | 2.2% |

Instruction streams contribute 500,032 bytes, trusted byte arrays 106,564 and
feedback vectors 42,092. Native growth includes weak-array lists and resource
timing entries. Relevant bitmap, Blob, texture, canvas and ArrayBuffer node counts
again remain unchanged. Plain objects rise from 256 to 329: 93 new IDs minus
20 removed IDs. Of the new objects, 73 have non-weak reference paths through V8
allocation-site templates. The other 20 describe current scene, bindings and
resource snapshots rather than accumulated source instances. Cleanup reduces
snapshot self-size by 19,072 bytes.

Evidence is `cancelled-queue-raster-snapshot.json`,
`cancelled-queue-raster-heap-summary.json` and
`cancelled-queue-raster-retainers.json`. Raw snapshots are under
`node_modules/.cache/royal-vt-cancelled-queue-raster-snapshot-*`, with hashes in the
summary. The same limitations apply: shallow size is not retained size or GPU
memory, snapshot instrumentation perturbs execution, and this workload does not
prove a universal memory bound. It independently explains the dominant raster
growth without importing the SVG attribution. No production fix is indicated by
these captures. JSON parsing, count reconciliation and whitespace checks pass;
no production change or commit.
