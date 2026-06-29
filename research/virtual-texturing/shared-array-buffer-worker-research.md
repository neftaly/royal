# SharedArrayBuffer / Worker Virtual Texturing Note

Date: 2026-06-29

Status: research-only. This note does not add renderer code, examples, package
exports, package config, lockfiles, or public docs.

## Recommendation

Build the VT worker boundary first. Use Web Worker messages and transferable
`ArrayBuffer`s if that is the quickest way to validate the protocol, page
generation cost, upload commands, cache churn, and debug counters. Treat
`SharedArrayBuffer` as viable for controlled deployments.

Prototype a SAB ring buffer when benchmarks show allocation, detachment,
transfer, or GC churn in the transfer-buffer path, or when the prototype needs
deterministic bounded memory from the start.

Do not make OffscreenCanvas or worker-owned WebGL the first page-generation
step. The first worker should produce CPU-side page bytes plus renderer-drained
commands; main-thread WebGL should still own texture upload, page-table texture
updates, and material binding.

## Repo Context

Existing VT research already points to a private runtime boundary:

- `webgl2-runtime-design.md`: worker responsibilities, command rows, `vt.*`
  stats.
- `virtual-texturing-cache-sim.mjs`: demand, fallback, LRU, upload budgets,
  dirty page-table entries, seam candidates.
- `demo-assets/stats/camera-pan-stream.json`: fixture evidence only; future
  prototypes should replace it with runtime rows.
- `demo-readiness.md`: readiness stays tied to renderer internals, not a public
  `VirtualTextureNode`.

- demand rows in: page id, mip, x/y, priority, samples, material slot, frame
- commands out: upload page, evict page, write page table, drop stale request,
  publish stats
- WebGL calls remain on the render thread

## Sources

- MDN `SharedArrayBuffer`: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer>
- MDN `crossOriginIsolated` / COOP / COEP: <https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated>
- web.dev COOP/COEP guide: <https://web.dev/articles/coop-coep>
- MDN worker `postMessage()` transferables: <https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage>
- MDN `OffscreenCanvas`: <https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas>

## SAB Prerequisites

- serve over HTTPS or localhost
- set `Cross-Origin-Opener-Policy: same-origin`
- set `Cross-Origin-Embedder-Policy: require-corp` or `credentialless`
- avoid blocking the feature with `Permissions-Policy: cross-origin-isolated`
- assert `window.crossOriginIsolated === true` before enabling SAB
- ensure worker scripts and embedded assets satisfy the selected COEP policy

These requirements are not a reason to avoid SAB when deployment is controlled.
They are a readiness checklist for the SAB path.

## Transferable Buffer Path

Main thread sends demand rows; the worker fills allocated or pooled
`ArrayBuffer`s; the worker transfers ownership back with
`postMessage(message, [buffer])`; the renderer uploads bytes with
`texSubImage2D`; the renderer returns or discards empty buffer tokens.

Use first when it makes validation faster. It works without cross-origin
isolation and is easier to inspect in tests. Measure allocations per frame,
detached-buffer churn, GC pauses, stale arrivals, peak in-flight bytes, and
queue growth when generation outruns the upload budget.

Decision: keep transferables if simple pooling holds frame time and peak
in-flight bytes inside readiness gates.

## SAB Ring-Buffer Path

Allocate one SAB arena sized from page size, upload budget, and slack. Expose
typed-array views for a fixed command ring and page-byte arena. The worker
claims slots, writes page bytes, and publishes command records; the main thread
drains commands, uploads bytes, and releases slots. Use `Atomics` for cursors,
slot state, and wakeups.

SAB gives a deterministic memory ceiling, removes ownership detachment, lowers
allocation pressure during cache churn, and makes backpressure explicit. It also
requires a correct Atomics protocol, hard version checks, and explicit data
lifetime rules because the renderer reads shared memory.

Decision: prefer SAB for controlled deployments when bounded memory is required
or measured transfer/allocation churn threatens frame stability.

## OffscreenCanvas

Keep OffscreenCanvas out of the first prototype. Terrain/material pages can be
generated into typed arrays, and renderer-owned WebGL uploads are the real
integration point.

Revisit OffscreenCanvas only for worker-side diagnostics, page-generation
algorithms that need canvas APIs, or a later worker-WebGL experiment with a
measured reason to move context ownership.

Decision: do not adopt worker WebGL unless texture upload/resource ownership is
cleaner or measurably faster than renderer-drained commands.

## Staged Prototype Plan

Stage 1: worker-ready main-thread adapter.
Keep runtime state package-private, define demand/command structs, run the
scheduler behind the same boundary, and publish existing `vt.*` stats. Move on
when tests can feed demand rows and assert upload, eviction, dirty page-table,
stale-drop, and stats rows without WebGL.

Stage 2: dedicated Worker plus transfer buffers.
Move page decode/generation and scheduling into a Worker, transfer page-byte
buffers back to the renderer, add a small reusable buffer pool, and benchmark
cache-thrash camera paths. Stay here if transfer/allocation churn is not
material.

Stage 3: SAB ring-buffer prototype.
Add opt-in SAB transport behind the same command protocol, require
`crossOriginIsolated`, expose a clear disabled reason, fix arena size from the
upload budget, and backpressure when the renderer cannot drain fast enough.
Promote SAB only when it reduces churn or gives needed bounded memory without
fragile synchronization failures.

Stage 4: optional OffscreenCanvas experiments.
Test worker-side visual diagnostics or canvas-specific page generation. Keep
worker WebGL separate until context ownership has a measured benefit.

## Memory Thrash Risks

- page demand oscillates near mip thresholds and reuploads the same pages
- generation outruns per-frame upload budget
- transfer path allocates many short-lived buffers under fast camera movement
- SAB arena stalls because the renderer cannot release slots quickly enough
- stale pages consume in-flight memory after camera demand changes
- dirty page-table updates scale with table size instead of changed pages
- parent fallback pages are evicted too aggressively

Mitigate with mip hysteresis, upload count and byte caps, bounded queue depth,
stale-demand dropping, parent-page residency bias, capped prefetch, and either
a fixed SAB arena or a transfer-buffer pool sized from measured budgets.

## Metrics And Gates

- `vt.uniquePageRequests`
- `vt.exactHits`, `vt.misses`, `vt.exactHitRatio`
- `vt.fallbackSamples`, `vt.fallbackRatio`
- `vt.uploadedPages`, `vt.uploadBytes`, `vt.uploadFramesOverBudget`
- `vt.evictedPages`, `vt.queuedPagesAfterBudget`, `vt.staleRequestsDropped`
- `vt.pageTableDirtyEntries`, `vt.pageTableFullRebuilds`
- `vt.residentMipSeamCandidates`

- generated page bytes per frame
- in-flight page bytes
- transfer count and bytes per frame
- buffer allocations per frame and detached buffers waiting for reuse
- worker queue depth and oldest queued frame
- main-thread drain time and worker generation time
- SAB arena bytes, occupied slots, blocked producer/consumer frames, and slot
  overwrite attempts

- exact hit ratio reaches the existing demo target after warmup
- upload count, upload bytes, and estimated upload time stay under budget
- no full page-table rebuilds during normal streaming
- stale requests are dropped before upload when superseded
- peak in-flight bytes are bounded by the configured budget
- SAB enables only when `crossOriginIsolated` and protocol version checks pass
- transfer fallback remains available unless deployment chooses SAB-only

- default transferables when they meet frame-time and memory gates with simpler
  code
- default SAB when bounded memory is required or measured transfer/allocation
  churn threatens frame stability
- keep OffscreenCanvas off by default until a canvas-specific experiment wins
