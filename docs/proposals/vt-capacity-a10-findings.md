# VT capacity and A10 iPad findings (2026-09-08)

## Review status

The fixed 32 MiB allocation below is an uncommitted experiment, not the accepted
automatic memory policy. Preserve its measurements and implementation for
comparison. [Automatic texture memory](automatic-texture-memory.md) defines the
proposed direction and separates the correctness fixes from allocator work.
Its preview-to-target policy supersedes requiring a vector coarsest page as
an intermediate step: coarse source authority is needed when coarse is the
target, while supplied preview coverage may bridge directly to finer targets.

## Implemented direct-target follow-up

The working tree now requests automatic target mips plus one coverage page,
uses supplied previews for that coverage when coarse is not itself a target,
and shares whole target rasters up to 512px across multiple demanded pages.
The shared raster cache is limited to 4 MiB per root including active decodes;
source disposal, cancellation, and idle eviction release ownership explicitly.
Small occurrences retain authoritative coarse targets even when the same
texture also has larger visible occurrences. Partial VT bindings cannot expose
unmapped grey regions, and source failure retains preview coverage.

Two physical A10 runs of the same 273-piece renderer fixture settled at 135
resident/requested pages, versus the prior 155, at the 8.061 s and 7.178 s
samples. Both had zero failed pages, denied GPU allocations, browser errors, or
context interruptions. Final tracked GPU bytes remained 40,102,721; automatic
decoded storage increased from 855,808 to 2,395,904 bytes with raster sharing.
Captured text retained source-rendered detail; page reduction does not come
from lowering target resolution. Raw observations are retained in
[`direct-target-a10.json`](../../research/svg-preview/direct-target-a10.json).

These are repeated observations, not a controlled speedup claim. The second
run still had a 306 ms maximum initial frame gap and a 104 ms refinement gap.
Automatic pool growth remains separate work; this change retains the 256 MiB
root budget and fixed pool allocation policy while reducing page preparation.

## Prototype policy

Use the existing 32 MiB shared-atlas target, bounded by remaining root GPU
budget, reserved allocation headroom, and detected WebGL texture dimensions.
Do not cap a whole scene's compatible textures at 24 pages. Unspecified
per-texture limits may use shared capacity; explicitly authored `physicalSlots`
and `physicalByteBudget` remain ceilings. No new public knob or device-model
table is needed for this correction. Changes are intentionally uncommitted.

For the producer's 128px RGBA pages with 2px borders this yields 480 slots,
33,523,776 allocated bytes. This is an allocated pool, not demand-grown GPU
storage: a single small visible texture can still allocate that pool. Only
demanded pages are decoded; four page uploads per frame and the existing
preparation/admission bounds remain unchanged. The 32 MiB value is a policy
ceiling, not detected free hardware memory.

## Capability research

WebGL exposes texture dimensions and extension support, not a portable query
for available VRAM. A large MAX_TEXTURE_SIZE is not permission to allocate that
much memory. MDN recommends estimating a per-rendered-pixel budget and measuring
it on representative devices:
https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#estimate_a_per-pixel_vram_budget

Recommended follow-up, if measured demand requires more adaptation:

- Derive useful detail from projected UV footprint and actual backing pixels
  (including DPR), as current demand collection already does.
- Calibrate a bytes-per-backing-pixel working-set target with an explicit hard
  cap and the root's remaining allocation budget. Do not infer memory from GPU
  model strings or probe by allocating until failure.
- Detect compressed-format support, but keep SVG refinement RGBA unless an
  actual background encoding experiment justifies compression latency. Native
  ETC2/ASTC support alone does not make live SVG-to-compressed-page encoding free.
- If demand exceeds capacity, prioritize broad visible coverage before finer
  levels. Pending work reaching zero is NOT proof that all desired resolution
  was admitted: a saturated protected atlas can simply admit no more pages.
- Treat memory capacity and scheduling separately. Increasing capacity does
  not authorize larger synchronous preparation/upload batches.

## Physical device comparison

Apple A10 is the project's minimum supported hardware. The device below is
therefore the baseline acceptance device for the proposed memory policy, not
merely an optional low-end performance sample.

Attached iPad7,6 (A10), iPadOS 17.7.11, real Safari via USB Web Inspector
automation. Viewport 768 x 954 CSS pixels, DPR 2; MAX_TEXTURE_SIZE 16384;
ETC2 and ASTC extensions supported. No browser/device emulation.

Renderer-only probe using `/tmp/probability-model-dedup.zip`: 273 pieces,
56 glTF sources, 60 automatic textures, original portable previews and SVGs.
An orthographic stationary camera and simple thickness-based stack transforms
isolate renderer behavior. This is not the full Probability importer, exact
Probability positioning, input-latency measurement, or a memory-pressure soak.
Absolute exported resource URIs are remapped into a token-protected local HTTP
namespace; asset/image bytes are otherwise unchanged. Initial harness runs
with unresolved fixture URLs were discarded.

| Stationary result | Original planner | Budget-sized planner |
| --- | ---: | ---: |
| Allocated atlas bytes | 1,672,704 | 33,523,776 |
| Resident pages | 24 | 155 |
| Tracked persistent GPU bytes | 8,251,649 | 40,102,721 |
| Failed pages / context interruptions / denied allocations | 0 / 0 / 0 | 0 / 0 / 0 |
| Longest rAF gap, repeat comparison | 256 ms | 230 ms |
| rAF gaps over 50 ms during roughly 50 seconds | 15 | 58 |

The original planner remained at 24 resident pages through 45 seconds even
though pending reads were zero. Both variants include the already-landed
full-atlas queue fix; the baseline overrides only storage-plan.ts with HEAD.
The new planner reached 110 resident pages at 9.2 seconds and 155 before the
19.2-second sample, then stayed settled. An earlier new-planner run reached 155
before 16.4 seconds but had a 1,081 ms longest initial gap. These are sparse
single-device observations with warm-cache/compiler effects, not speedup claims.

Real-device canvas captures show substantially clearer mat grid and rules text:
`/tmp/probability-ipad-vt-baseline.png` and
`/tmp/probability-ipad-vt-budget.png`. Captures force a final renderer draw in
the same task before canvas readback; screenshots are outside timing samples.

The repeat new-planner run still had a 103 ms gap at 8.8 seconds during
refinement. Capacity starvation is corrected, but hitch-free refinement is NOT
established. Profile that work before raising upload/preparation concurrency.

## Reproduction and review

Temporary harness: `/tmp/probability-vt-device-server.mjs`,
`/tmp/probability-vt-device.js`, `/tmp/probability-vt-device.html`,
`/tmp/probability-ipad-vt.py`, `/tmp/royal-vt-baseline-build.mjs`.
The server binds the host LAN interface and rejects requests lacking a random
temporary token. Do not publish the fixture or expose an unrestricted server.

## Small-on-screen quality correction

Capacity alone did not fix small resource cards: the coarsest VT page was
always generated from the portable 64px preview. A piece whose projected
footprint required only that mip never requested SVG authority, regardless of
available atlas space. The mip planner could report settled while displaying
an enlarged, low-quality fallback forever.

The normal coarse page now comes from SVG too. Until it is ready, the ordinary
preview remains drawable. Coarse SVG work uses the same background detail lane
as finer refinement; failure retains the preview. The complete coarsest image
fits within one page and is rasterized once, with gutters generated by canvas
copies instead of up to nine separate SVG decodes. No SVG size reduction,
extra preview tier, finer-mip bias, or additional permanent raster cache.

The repeated physical-iPad overview still settles at 155 pages and 40,102,721
tracked persistent GPU bytes, but resource-card labels/icons and small card
text are visibly clearer in `/tmp/probability-ipad-vt-coarse.png` compared with
the capacity-only capture. No zoom was performed. This run had a 267 ms worst
initial rAF gap and a 102 ms gap at 5.4 seconds during refinement; smoothness
remains a separate open problem. The success-path device capture predates a
subsequent failure-only retry guard, which has focused regression coverage.

Regression coverage includes 60 visible logical textures refining without a
camera change, at most four uploads per update, shared storage, authored byte
and slot limits, small GPU dimension limits, constrained memory, and disposal
returning tracked allocations to zero, authoritative coarsest-page pixels,
single-decode coarse gutters, and no endless retries when vector and preview
both fail. Focused VT suite: 52 passing tests; final broader WebGL suite:
753 tests passed. Final Royal TypeScript and VT lint checks passed.
No Automerge, dependency, or other external
library changes are part of this correction.

Full Probability stationary-import smoke through literal root `pnpm dev` with
local Royal reaches 76 resident pages, zero failed/pending pages and no browser
errors without camera changes. Its scene/view differs from the device probe.
Refinement took between the 20- and 40-second post-import samples, so end-to-end
refinement latency still needs work even though it no longer stalls forever.
Probability currently has a temporary uncommitted Vite alias pointing at this
local Royal build (including xr/ktx2 subpaths) for interactive verification.

## Refinement-delay adversarial review

Two avoidable costs were corrected without increasing concurrency or texture
resolution:

- Starting a page read publishes progress but no longer invalidates the whole
  scene. Uploading pages during a frame also publishes progress without asking
  for an extra unchanged frame. Ready pixels still request presentation;
  authored asset subscribers and root progress subscribers remain notified.
- Clamped SVG boundary pages now rasterize one bounded region and copy its
  edge/corner gutters, instead of serializing and decoding the SVG three to
  nine times. Interior pages retain their direct path; repeat/mirrored wrapping
  retains its existing partitioned implementation. No additional retained image
  cache is introduced.

Fresh physical-A10 comparison, same stationary fixture and final quality:

| Observation | Control | Both corrections |
| --- | ---: | ---: |
| First one-second sample settled at 155 pages | 12.48 s | 9.07 s |
| Rendered frames through settlement | 278 | 221 |
| rAF gaps over 50 ms | 61 | 35 |
| Largest rAF gap | 395 ms | 217 ms |
| Tracked persistent GPU bytes | 40,102,721 | 40,102,721 |

These are individual device runs, not a statistically established speedup.
The corrected run still had a 98 ms rAF gap at 5.4 seconds: rAF sampling is
neither input latency nor attribution of a stall to JavaScript versus GPU work.
The final canvas capture retains the small-text quality improvement.
Control build: `/tmp/royal-vt-redraw-control-dist`; logs and captures use labels
`redraw-control` and `refinement-optimized` in `/tmp/probability-ipad-*`.

The restarted literal root `pnpm dev` stationary import smoke settles at the
20-second sample rather than between 20 and 40 seconds, with 104 rendered
frames instead of 160, the same 76 resident pages, and no browser/module/overlay
errors. Its view differs from the iPad renderer-only fixture.

The fresh full renderer suite passes 759 tests across 94 files, plus TypeScript
and targeted lint. Added checks cover single-decode early quality levels,
square/rectangular/thin clamped boundary pages, bounded decode dimensions,
source crop bounds, complete gutter coverage, and progress-only versus
presentation notifications. Royal remains uncommitted.

### Remaining hitch attribution

Two opt-in instrumented A10 repeats also settled at about 9.1 seconds, with
214/217 rendered frames. API wrappers are diagnostic instrumentation, not
unbiased benchmark runs. In the frame-instrumented repeat:

- Largest renderer rAF callback: 189 ms during setup; other early callbacks
  reached 95, 86 and 74 ms. These are elapsed JavaScript callback durations,
  potentially including synchronous browser/GPU waits.
- SVG cloning: 86 ms cumulative over 155 calls, 12 ms maximum; serialization:
  68 ms cumulative, 7 ms maximum. Moving serialization alone to a worker does
  not account for the observed long gaps.
- `getImageData`: 458 ms cumulative over 119 calls, 26 ms maximum. Origin-clean
  validation is retained; do not remove this safety check as an optimization.
- `texSubImage2D`: 604 ms cumulative, 32 ms maximum. Byte/time admission cannot
  interrupt an individual already-submitted browser upload.
- Program link-status queries: 112 ms cumulative over 23 calls, 15 ms maximum.
  Existing program prewarming explicitly excludes VT variants. A follow-up
  could prewarm these after shader declarations are available, retaining the
  ordinary-preview shader until completion. That requires pending-variant
  invalidation/context-recovery coverage; merely removing the exclusion is
  unsafe because declaration changes currently skip pending programs.

The approximately 100 ms later rAF gaps are not fully explained by individual
timed calls; do not label them SVG decode or GPU stalls without a native
timeline. Asynchronous bitmap elapsed time includes queueing and concurrent
work and is not equivalent to main-thread blocking time. Logs:
`/tmp/probability-ipad-refinement-profile.log` and
`/tmp/probability-ipad-refinement-frame-profile.log`.

### Growth synchronization correction (2026-09-08)

The 273-piece delayed-zoom fixture exposed a 94 ms synchronous `getError`
after growth. Waiting only for allocation moved the stall to first use;
inserting a fence immediately after allocation/copy moved it into `fenceSync`
(86–101 ms in diagnostic runs). The final path submits and flushes each batch,
yields a frame before creating its fence, and validates errors only after a
zero-timeout completion poll succeeds. The old atlas stays drawable throughout;
failed or timed-out validation discards the replacement.

In the final instrumented A10 observation, maximum `getError`, `fenceSync`,
and `clientWaitSync` calls were approximately 1 ms each. All 135 old pages were
copied, all 583 current target pages became resident, and the final atlas used
71,368,704 bytes with no failures, denied claims, or context interruptions.
Settlement was 27.2 seconds overall, about 15.2 seconds after the scripted zoom.
Remaining gaps reached 245 ms during startup and 134 ms near growth completion;
the zoom `setScene` call took 41 ms. This is removal of a measured synchronous
wait, not a claim of hitch-free rendering or a statistically established total
latency improvement. Timed API wrappers add overhead.

The final repeat without timing wrappers retained identical page demand,
residency, copy count, and memory usage, with zero failures. It settled at
28.1 seconds overall (16.1 seconds after zoom), versus 27.1 seconds for the
earlier synchronous-growth observation. Its worst recorded gap near growth
completion was 146 ms, with a 257 ms startup maximum; the earlier run's maximum
was 383 ms near zoom. These are individual observations, not controlled
statistical estimates. Extra yielded frames deliberately favor responsiveness
over minimum migration latency.

Raw reports and timing aggregates, including intermediate experiments, are in
[`growth-sync-a10.json`](../../research/svg-preview/growth-sync-a10.json).
The approach retains allocation error checks while avoiding immediate queries,
consistent with [WebGL guidance on blocking APIs](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#avoid_blocking_api_calls_in_production).

### Final SVG refinement and page granularity (2026-09-08)

The remaining 16-second zoom refinement was not solved by serialization reuse
alone. Shared bounded regions reduced clone/serialization calls from 669 to
110 in an intermediate run, but the two-millisecond admission window still
produced mostly one or two page uploads per frame. Fractional edge regions
now retain the old per-page path to avoid stretching neighboring text.

The retained changes are:

- 256px automatic SVG pages, preserving requested texel density. Ordinary
  raster and authored VT page sizes and eligibility are unchanged.
- Cached small whole targets and clamped two-by-two-page regions (at most
  516px per axis), within the same 4 MiB reservation-inclusive raster cache.
  Cached demand is consumed before cold reads can evict its pixels.
- Incremental CPU page-table additions, with full rebuilds for eviction or
  atlas-column changes. Growth preserves columns whenever the full planned
  capacity still fits, avoiding the growth-completion rewrite in that case.
- A four-millisecond root upload-work target starting at the first admission,
  with unchanged byte limits, detail concurrency, and four-page frame cap.

| Uninstrumented observation | Earlier 128px SVG pages | Final 256px SVG pages |
| --- | ---: | ---: |
| Settlement after scripted zoom | 16.1 s | 4.1 s |
| Current target pages | 583 | 172 |
| Retained pages including earlier views | 697 | 227 |
| Atlas bytes | 71,368,704 | 69,222,400 |
| Total retained GPU estimate | 77,947,649 | 72,065,793 |
| Maximum rAF gap near zoom/growth | 146 ms | 128 ms |
| Maximum rAF gap during startup | 257 ms | 351 ms |

The final instrumented run also settled about 4.1 seconds after zoom. It
recorded 126 clone/serialization calls across initial loading and zoom, and
maximum error/fence/wait calls of 1/4/1 ms respectively. Final pixel inspection
retains readable text; the native 1024 x 560 reference comparison differs by
at most one 8-bit channel level across all pages and gutters.

These are individual workload observations, not a statistical speed guarantee
or a claim that general renderer startup is hitch-free. Both final runs have
zero page failures, growth failures, denied claims, and context interruptions.
Raw reports and API timing aggregates, including intermediate experiments, are
in [`refinement-a10.json`](../../research/svg-preview/refinement-a10.json).
