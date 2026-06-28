# WebGL2 Virtual Texturing Runtime Design Note

Date: 2026-06-29

Status: research-only. This note does not add renderer code, examples, package
exports, public scene nodes, or root/package config. It describes the real
WebGL2 renderer path that should eventually replace fixture previews.

## Boundary

There are two separate tracks:

- Fixture previews: committed research assets, static overview images, SVG
  cache diagrams, JSON camera-pan stats, and generated reports under
  `research/virtual-texturing/demo-assets/**`.
- Real renderer path: private WebGL2 runtime resources that allocate a page
  table texture, stream border-padded pages into a physical atlas, bind shader
  indirection, collect feedback/demand rows, and publish backend stats.

The fixture preview is allowed to describe the asset contract and debug UX. It
must not claim live page-table sampling, live residency, or renderer-produced
stats. The real renderer path is the only track that may claim virtual texturing
is active.

There is no public `VirtualTextureNode` yet. The author-facing shape remains
asset and material data: a virtual texture manifest id, material texture slots,
sampler policy, and fallback color or texture. Page tables, cache atlases,
feedback buffers, shader defines, and scheduler state stay private to the
renderer package.

## Current Research Inputs

Build the first runtime worker from the current research pieces:

- `demo-assets/manifest.json` gives stable page ids, dimensions, mips, padding,
  sampler policy, variant metadata, hashes, and demo budgets.
- `virtual-texturing-cache-sim.mjs` models demand collection, resident fallback,
  LRU replacement, dirty page-table entries, upload budgets, seam candidates,
  and benchmark rows.
- `demo-assets/stats/camera-pan-stream.json` is fixture evidence only. It is
  useful as a regression baseline, but the real route must replace it with
  runtime rows produced by the package-private worker.
- `example-plan.md` stays a static examples-app handoff until renderer hooks
  exist.
- `packages/renderer-webgl/src/virtual-texture-runtime.ts` is the current
  package-private runtime worker seed. It already defines stable page ids,
  parent-page lookup, resident pages, RGBA8 page-table entries, dirty
  page-table rows, fallback/missing resolve results, slot snapshots, and debug
  snapshots.

The package-private runtime worker layer should own scheduling and bookkeeping,
not public API. It can run on the main thread first, but its message shape
should be worker-ready: compact demand rows in, upload/page-table commands and
stats out. The existing `VirtualTextureRuntime` class is the starting point for
residency and page-table state; the worker layer should build around it rather
than introducing a second state model.

## Runtime Ownership

Keep these pieces package-private:

- `VirtualTextureRuntime`: owns the manifest snapshot, selected variant,
  capability row, physical atlas allocation, page-table texture allocation,
  fallback texture, active page map, dirty page-table queue, and stats
  accumulators.
- `VirtualTextureWorker`: owns frame demand reduction, exact-hit lookup,
  parent fallback lookup, prefetch scoring, upload budget capping, eviction,
  dirty page-table command batching, and benchmark counters. This can initially
  be an adapter around `VirtualTextureRuntime` rather than a browser `Worker`.
- `VirtualTextureMaterialBinding`: binds ordinary material texture slots to
  either a normal texture or the private virtual texture shader path.
- `VirtualTextureDebugProbe`: exposes renderer diagnostics to debug overlays
  without adding public scene nodes.

The worker should not call WebGL directly. It should emit commands that the
renderer drains on the render thread:

- `uploadPage`: page id, mip, virtual page x/y, physical slot x/y, source
  variant, byte length, and padded dimensions.
- `evictPage`: page id, old slot, and page-table downgrade or invalidation row.
- `writePageTable`: mip, virtual page x/y, encoded bytes, resident mip delta,
  flags, and version.
- `dropStaleRequest`: page id and reason, usually camera superseded demand.
- `publishStats`: frame counters and rolling benchmark counters.

## Page Table Texture

WebGL2 should start with a portable `RGBA8` page-table texture:

- `R`: physical slot x.
- `G`: physical slot y.
- `B`: resident mip delta from the requested virtual mip.
- `A`: flags/version bucket.

Use one page-table mip level per virtual texture mip where practical. If table
size or texture unit pressure makes that brittle, use a packed 2D table with an
explicit mip offset table in uniforms. Both encodings stay private.

The renderer updates only dirty table texels with `texSubImage2D` after physical
page uploads and eviction downgrades. A full table rewrite is a bug except for
initialization, context restore, or manifest replacement.

Required page-table stats:

- `vt.pageTableDirtyEntries`
- `vt.pageTableTexSubImageCalls`
- `vt.pageTableBytesUploaded`
- `vt.pageTableFullRebuilds`
- `vt.pageTableVersionSkips`

## Physical Atlas

The physical cache is one or more `TEXTURE_2D` atlas textures containing
border-padded pages. Start with `RGBA8` pages because it is deterministic in
WebGL2. KTX2/Basis pages remain manifest variants of the same page ids and can
be added after capability selection is stable.

Initial budget:

- Usable page: 128 x 128 texels.
- Border: 4 texels on every side.
- Uploaded page: 136 x 136 texels.
- Physical slots: 256 for the first full demo, 96 for stress checks.
- Upload cap: 4 to 8 pages per frame and a byte cap.

Eviction must update both runtime maps and page-table entries. If an evicted
child has a resident parent, downgrade the table row to the parent. If no parent
is resident, mark the row as fallback/invalid so the shader samples the fixed
low-mip material instead of stale atlas memory.

Required physical-cache stats:

- `vt.physicalSlots`
- `vt.residentPages`
- `vt.freeSlots`
- `vt.evictedPages`
- `vt.uploadedPages`
- `vt.uploadBytes`
- `vt.uploadTexSubImageCalls`
- `vt.uploadEstimatedMs`
- `vt.uploadTimerQueryMs`
- `vt.uploadFramesOverBudget`

## Shader Indirection

The material shader path for one virtual albedo texture needs:

- Virtual texture dimensions, usable page size, padded page size, and border.
- Page-table sampler.
- Physical atlas sampler.
- Fixed fallback sampler or fallback color.
- Mip count and selected indirection mode.

Fragment flow:

1. Compute desired virtual mip from derivatives.
2. Compute virtual page x/y and in-page UV.
3. Sample the page table at the chosen virtual mip.
4. Decode physical slot, resident mip delta, flags, and version.
5. If invalid, sample fixed low-mip fallback.
6. Remap in-page UV into the padded physical slot, away from border texels.
7. Sample the physical atlas.

The shader must not expose page table details through public scene APIs. Shader
defines, uniform block names, and texture unit assignments remain backend
implementation details.

Required shader stats:

- `vt.shaderIndirectionMode`
- `vt.shaderPageTableSamplesPerFragment`
- `vt.shaderPhysicalSamplesPerFragment`
- `vt.shaderFallbackSamples`
- `vt.shaderResidentMipDeltaSamples`
- `vt.shaderSeamStressEnabled`

## Feedback And Demand Rows

The first WebGL2 path can collect demand on the CPU from camera/material
visibility, matching the cache sim. GPU feedback can come later. The worker
should receive compact rows:

```ts
type VirtualTextureDemandRow = {
  pageId: string;
  mip: number;
  x: number;
  y: number;
  samples: number;
  priority: number;
  materialSlot: "baseColor" | "normal" | "orm";
  frame: number;
};
```

Demand processing order:

1. Exact visible pages.
2. Resident parent pages needed for fallback coverage.
3. One-ring prefetch along camera velocity.
4. Low-priority debug rows.

The worker emits upload rows only after applying upload-count and upload-byte
budgets. It also emits queued-after-budget rows so the overlay can distinguish
missing demand from deliberately delayed demand.

Required demand stats:

- `vt.frameDemandRows`
- `vt.uniquePageRequests`
- `vt.exactHits`
- `vt.misses`
- `vt.fallbackSamples`
- `vt.exactHitRatio`
- `vt.fallbackRatio`
- `vt.parentFallbackPagesRequested`
- `vt.prefetchPagesQueued`
- `vt.queuedPagesAfterBudget`
- `vt.staleRequestsDropped`

## Debug And Seam Stats

The renderer-owned debug overlay should consume runtime stats, not fixture JSON.
Rows should include:

- Selected capability path: `webgl2-virtual-texture`, `fixed-low-mip`, or
  `unsupported-webgl1`.
- Physical slot grid with free/resident/visible/queued/evicted states.
- Dirty page-table entry count.
- Requested, queued, uploaded, and evicted pages.
- Exact hits, misses, fallback samples, and hit ratio.
- Upload bytes, estimated upload time, timer-query upload time when available.
- Resident mip deltas and seam candidates.

Required seam/debug stats:

- `vt.seamCandidates`
- `vt.borderMismatchCount`
- `vt.visiblePagesWithMixedResidentMips`
- `vt.capabilityPath`
- `vt.fixedLowMipFallbackFrames`
- `vt.unsupportedFrames`
- `vt.debugOverlayRows`

## Benchmark Counters

Use these names for repeatable checks and future browser traces:

- `vt.frames`
- `vt.warmupFrames`
- `vt.averageExactHitRatioAfterWarmup`
- `vt.averageFallbackRatioAfterWarmup`
- `vt.maxUploadsPerFrame`
- `vt.averageUploadsPerFrame`
- `vt.framesOverUploadPageBudget`
- `vt.framesOverUploadByteBudget`
- `vt.averageUploadBytesPerFrame`
- `vt.maxUploadBytesPerFrame`
- `vt.averageEstimatedUploadMs`
- `vt.maxEstimatedUploadMs`
- `vt.averageTimerQueryUploadMs`
- `vt.maxTimerQueryUploadMs`
- `vt.totalEvictions`
- `vt.maxQueuedPages`
- `vt.averagePageTableDirtyEntries`
- `vt.maxPageTableDirtyEntries`
- `vt.pageTableUpdatesPerUpload`
- `vt.maxSeamCandidates`
- `vt.borderMismatchCount`
- `vt.cpuDemandMs`
- `vt.cpuScheduleMs`
- `vt.gpuFrameMs`

Initial gates:

- `vt.averageExactHitRatioAfterWarmup >= 0.95` during slow pan.
- `vt.maxUploadsPerFrame <= 8`.
- `vt.maxEstimatedUploadMs < 2` on desktop WebGL2.
- `vt.pageTableUpdatesPerUpload` remains proportional to uploads plus
  evictions.
- `vt.borderMismatchCount === 0` for generated checked pages.

## Capability Policy

Capability rows are explicit:

- WebGL2 with adequate texture size, texture units, and update support: real
  virtual texturing path.
- WebGL2 with insufficient limits or context pressure: fixed low-mip material.
- WebGL1: unsupported. Do not add a reduced WebGL1 virtual-texturing path.
- Missing timer queries: still run virtual texturing if other requirements pass,
  but use upload-count and byte budgets instead of timer feedback.

The fixed low-mip path is a fallback material route. It is not virtual
texturing, and stats must label it as `fixed-low-mip`.

## Handoff Order

1. Keep fixture previews and generated reports as research artifacts.
2. Add package-private runtime worker data structures and tests.
3. Add private WebGL2 page-table and physical-atlas resource allocation.
4. Drain worker upload/page-table commands on the render thread.
5. Add shader indirection for one virtual albedo material slot.
6. Replace fixture stats in the real route with runtime-produced stats.
7. Add overlay rows before tuning visuals.
8. Consider KTX2 variants only after `RGBA8` residency, fallback, and debug
   stats are stable.

Do not introduce `VirtualTextureNode` during these steps.
