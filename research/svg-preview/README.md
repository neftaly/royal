# Preview-first SVG consumer verification

## Resolved SVG crop semantics (A10 and Quest 2)

The crop wrapper now retains the complete authored viewport and SVG layout.
Before nesting, stylesheet selector matches are captured against the original
SVG document. Generated selectors retain each original selector's specificity,
including selector lists, while avoiding matches against the new crop root.
Viewport lengths are frozen in geometry/presentation attributes and CSS;
quoted strings and identifiers such as `id="50vw"` remain untouched.
Prepared DOMs are weakly retained only for sources that need rewriting, so
ordinary sources do not retain a second DOM. A weak set remembers unchanged
sources so subsequent page requests skip the rewriting scan. Shared raster strips and their
4 MiB admission bound remain unchanged.

A small, released SVG image probes whether the browser uses inline CSS for
intrinsic image sizing. Safari and Chromium differ here; no user-agent test
or application-specific option is used. The final implementation does not
embed another SVG image or transform the root bitmap: those experiments were
rejected after Safari lost image content or detailed text pixels changed.
The original strict alpha tolerance remains in the crop probe.

Both the attached A10 and USB-connected Quest 2 passed all 48 crop cases and
10 adversarial cases, including document-root selectors, specificity, nested
SVG selectors, authored transforms, CSS sizing, viewport units, and fragment IDs.
The detailed text/gutter comparison had maximum channel error 2 on A10 and 1
on Quest 2, within the existing tolerance. All 845 renderer tests passed;
42 focused tests passed after the fragment-ID safeguard, followed by 20 focused
tests after caching unchanged-source decisions. Type checking, renderer build,
and lint also passed.

The final instrumented A10 run of the 273-piece scene completed zoom refinement
in 1,735 ms (35 uploads), overview in 919 ms, and return in 1,371 ms. Initial page
completion took 6,302 ms. There were no page failures, GPU denials, or context
losses; final tracked GPU memory was 70,071,041 bytes. A preceding run took
2,804 ms for zoom, including one 1,179 ms asynchronous bitmap-decode outlier;
the final run's longest zoom decode was 23 ms. These are individual runs, not
controlled benchmarks, and do not isolate the unchanged-source cache's effect.
Updated pixel evidence is in `fixed`, and both scene profiles are in `fullScene`
of [svg-crop-review-results.json](./svg-crop-review-results.json).

## Atlas alignment adversarial review

The atlas shader previously added half a texel to an already-continuous UV
coordinate. This predates `e5cb9ebd`. Removing that offset restores the same
sample positions as an ordinary texture. The earlier solid-color resident-detail
probe could not detect the shift.

`vt-alignment-probe.mjs` reproduces an edge moving from x=32 to approximately
31.5, 31, and 30 with the old offset at resident mips 0, 1, and 2. The corrected
shader keeps it at x=32. `vt-sampling-parity-probe.mjs` compares patterned atlas
pages against ordinary GPU textures, covering page boundaries, unrelated atlas
slots, clamp/repeat/mirrored-repeat, linear/nearest filtering, three uniform
resident mips, and mixed mip 0/1 residency. All 24 cases match every channel
exactly on Chromium and A10; every old-offset control has mismatches.
Evidence: [vt-alignment-results.json](./vt-alignment-results.json).

These probes isolate sampler coordinates and gutters, not every SVG rasterizer,
texture dimension, or full-scene transition. The focused VT/shader suite also
passed all 153 tests. No additional blocker was found in the alignment fix.

## Nonblocking automatic VT shader publication

Automatic VT now starts its required shader variant while an ordinary preview
is drawable. With `KHR_parallel_shader_compile`, frames poll only completion
status until linking finishes, then reconcile bindings and draw the VT variant.
Pending compilation keeps the render loop scheduled even after page work stops.
The fallback uses matching ordinary texture bindings and shader features.
Authored-only surfaces, transmission variants, and devices without the extension
retain the existing synchronous behavior. Shader-source replacement, context
loss, and disposal discard pending variants.

The A10 exposes the extension. The 273-piece fixture completed initial loading,
zoom, overview, and return with no page failures, GPU denials, or context losses;
final tracked GPU memory remained 70,071,041 bytes. The largest shader-status
call was 11 ms and largest rAF gap 348 ms. Shader caches were not cleared, so
these timings do not establish a cold-start speedup. Runtime SVG generation
remains enabled. Evidence: [shader-compilation-results.json](./shader-compilation-results.json).

Tests hold compilation unfinished while checking that the preview is drawn,
no VT uniforms are used prematurely, another frame is requested, and VT replaces
the preview after completion without a camera update. Owner tests prohibit
blocking link-status queries while pending and cover pending-program cleanup.

## Current 512px SVG page policy

The A10 comparison now retains 512px SVG pages, with 128px ordinary raster
pages and unchanged authored sizes. The same zoom requested 35 uploads instead
of 151 and completed in 1,904 ms, versus 3,750 ms with the 256px copy-pipeline
build. The final build, including shared raster strips, completed in 1,881 ms.
Tracked final GPU memory was 70,071,041 bytes versus 72,065,793 bytes previously.
These are individual runs on the same 273-piece fixture, not general guarantees.

The final run also zoomed out and back in, completing those transitions in
928 ms and 1,419 ms, with no page failures, GPU denials, or context losses.
It did not exercise atlas shrinking: the 512px atlas remained at 64 slots.
Startup still stalled (582 ms maximum rAF gap in the final run); the earlier
512px run included a 635 ms shader-status call and a 962 ms startup gap.
Larger pages do not solve shader startup costs or make uncached content instant.

Two neighboring pages share a bounded horizontal SVG raster strip, rather than
rasterizing the same region twice. The root cache remains 4 MiB, including
reservations. Native Chromium pixel comparisons passed all three wrap modes
for a one-page target with zero error; the four-page target used two strips,
with maximum channel error one. Cache cleanup is also checked by the probe.
The historical 256px results below describe earlier builds.

Authored tile streaming had a separate bottleneck: downloads occupied the
single detail slot. Transport and response-body reads now overlap for up to
four pages; decode remains serialized and the existing 16 MiB reservation
limit remains enforced. Regression tests verify overlap, decode admission,
and cancellation. This authored-path fix does not explain the SVG timings.

Evidence: [page-size-results.json](./page-size-results.json). All 831 renderer
tests, TypeScript checking, renderer build, and production VT lint passed.

## A10 loading throughput comparison

The same 273-piece fixture was profiled with the original serial detail path,
an experimental two-job detail limit, and consecutive atlas-copy batches.
Completion below is measured from the zoom's `setScene` entry to the last page
upload, rather than rounding to the probe's one-second samples.

| Variant | Target completion after zoom | Copy calls | Fences |
| --- | ---: | ---: | ---: |
| Serial baseline | 4,647 ms | 76 | 21 |
| Two detail jobs (reverted) | 4,738 ms | 76 | 20 |
| Consecutive copy batches (retained) | 3,750 ms | 76 | 3 |

The retained change queues at most four page copies per frame without waiting
for each batch individually. Allocation is still validated first; final copy
validation precedes the binding/page-table swap. Cancellation, allocation/copy
failures, and context-loss tests retain their coverage.

The measured completion improvement is about 19% in this single A10 comparison,
not a universal speedup guarantee. All three runs ended with 172 admitted targets,
227 resident pages, 72,065,793 tracked GPU bytes, and no failures or denials.
Cloning and serialization consumed about 84 ms across the baseline run, so
replacing the SVG parser was not justified by these measurements. New detail
still requires rasterization and upload; resident detail can be used immediately.
Raw reports and profiling events: [loading-throughput-results.json](./loading-throughput-results.json).

## Resident detail and atlas-uniform regression

`resident-detail-probe.mjs` exports `probeResidentDetail(declarations)`. Pass the
production `VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS` string in a WebGL2 browser.
The probe renders a missing zoom-out target with two finer resident tiles,
coarse coverage elsewhere, and an unrelated neighboring atlas cell. It checks
every output pixel, then publishes the requested target and checks that it
takes priority. The old shader produces 16 mismatched channels in the missing
target case. The fixed shader produces zero mismatches and no GL errors in
Chromium and on the attached A10.

The renderer regression also verifies that unlit and standard materials upload
current atlas dimensions after growth and shrinking without changing material
identity. Previously the material-uniform cache retained the old dimensions,
allowing a newly bound atlas to be sampled at another cell's coordinates.

The 273-piece A10 fixture completed zoom-out, shrink, and regrowth with no failed
pages, denied allocations, or context loss. Atlas storage fell from 69,222,400
to 34,611,200 bytes, then returned to 69,222,400 bytes with all 172 targets
resident. The first zoom settled in about 5.36 seconds; this run had a 1,225 ms
startup frame gap and does not establish a performance improvement. Saved
evidence: [resident-detail-results.json](./resident-detail-results.json).

## Direct-target working-tree verification (2026-09-08)

The current automatic path skips intermediate mips, uses supplied preview
coverage while target pages arrive, and shares small target rasters across
pages within a 4 MiB root-local cache. Coarse source authority remains required
when coarse is an actual visible target. This supersedes the older scheduling
description below.

`target-raster-probe.mjs` exports `runTargetRasterProbe()` for the dev server.
It compares every pixel of four generated 256px SVG pages, including text and gutters,
against a whole-image 512 x 280 reference. Chromium passed clamp, repeat, and
mirrored-repeat with zero pixel difference and one SVG decode attempt per
four-page target. Each source released all 573,440 cached bytes on disposal.
Passing `2` tests a 1024 x 560 target spanning twelve pages and four shared
regions, with a maximum channel error of one against the full-image reference.
The native lifecycle probe uses a camera distance of 0.2 to exercise a target
larger than the new 256px coverage page; refinement, failed detail, disposal,
restoration, and failed-detail restoration pass, including pixel-identical
preview retention on failure.

`refinement-a10.json` records the subsequent page-granularity investigation.
The final instrumented and uninstrumented runs both settle about 4.1 seconds
after the scripted zoom, versus 16.1 seconds in the earlier uninstrumented
128px-page run. Final SVG pages are 256px; authored and ordinary-raster pages
are unchanged. All 172 current target pages are resident, with 227 retained
pages including earlier views, and 69,222,400 atlas bytes. No page failures,
growth failures, denied GPU claims, or context interruptions occurred. These
are individual observations; startup can still hitch (351 ms maximum gap in
the final uninstrumented run).

The existing native root probes also passed refinement, optional-detail failure,
last-claim cancellation, restoration, and failure/restoration. Failure retained
pixel-identical preview coverage. These are browser correctness checks, not
device performance claims. A10 workload results are recorded in
[the capacity findings](../../docs/proposals/vt-capacity-a10-findings.md).

Working-tree implementation, 2026-09-08, based on `5bb9ab6c`.

Royal removes the automatic-VT option and attaches VT lazily when decoded
base-color sources are eligible. Optional `GS_texture_svg` base color uses a
bounded raster preview; required SVG and other color slots keep direct-source
semantics. Early image discovery uses the same recipe as final preparation.

Preview pixels remain resident as the coarsest VT page. Vector transport starts
on visible detail demand and does not occupy a rasterization slot. Validation
joins the existing detail lane after bytes arrive. One detail job executes at a
time, pending page pixels reserve at most 16 MiB, and shared ordinary/VT upload
admission observes bytes and a 2 ms elapsed-work target, including allocation.
These limits cannot interrupt a browser rasterization or driver call.
The existing transport owner admits at most four SVG detail reads within its
sixteen total slots, keeping capacity available for new previews. It reuses the
preparation owner's bounded fairness policy: an eligible waiting detail read
gets a turn after at most four foreground admissions.

## Reproduce the browser probes

Start the literal root `pnpm dev`, open the Tiger route, and evaluate:

```js
const base = '/@fs/home/neftaly/dev/royal/';
const renderer = await import(base + 'packages/renderer-webgl/src/index.ts');
const core = await import(base + 'packages/renderer-core/src/index.ts');
const { runSvgPreviewProbe } = await import(base + 'research/svg-preview/probe.mjs');
await runSvgPreviewProbe(renderer, core, 'refine');
await runSvgPreviewProbe(renderer, core, 'fail');
await runSvgPreviewProbe(renderer, core, 'dispose');
await runSvgPreviewProbe(renderer, core, 'restore');
await runSvgPreviewProbe(renderer, core, 'fail-restore');
```

Reload after source changes so all imports use the same Vite generation.
The probe holds the vector read until colored preview pixels and a resident
coarsest page exist. It checks native WebGL errors, detail settlement,
pixel-identical failure fallback, last-claim cancellation, and restored coverage.
Pixel reads occur only at verification checkpoints, not in timed frame loops.

Chromium with SwiftShader passed these behavior probes. The held-read preview
contained 16,369 colored pixels; successful refinement contained 23,836. An
injected detail failure retained exactly the preview bytes, reported one failed
page, and left no pending pages. Disposal aborted the held read; restoration
advanced the context generation and recovered coverage without another SVG read.

The emitted production build also passed the Tiger browser smoke with context
loss/restoration and, separately, an injected SVG-detail request failure. Both
runs explicitly allowed SwiftShader as a behavior oracle. The failure run was
repeated on dedicated ports after an earlier attempt encountered an occupied
preview port before navigation.
Both runs completed their browser assertions but stalled during harness cleanup;
their harness processes were terminated explicitly. These runs are recorded as
passing browser assertions, not successful end-to-end harness exits.

Adversarial regression results are retained in `adversarial-fixes.json`:
sixteen requested SVG refinements leave a new PNG preview able to complete while
four vector reads remain held; a failed vector source restores pixel-identical
coarse coverage after context loss without another SVG fetch; and an authored
2052-square ETC2 page reserves 4,210,704 bytes, uploads successfully, and releases
its pending reservation with no native WebGL errors. Unit regressions also cover
queued detail cancellation and pending compressed-page disposal.

The second adversarial pass found and fixed foreground transport starvation of
detail and alpha upgrades waiting indefinitely for scene-long VT leases.
`adversarial-ownership-fairness.json` records real browser decodes: a supplemental
alpha decode closes its temporary bitmap while preserving the leased source and
produces correct transparent/opaque values; queued SVG detail starts after four
foreground admissions under a continuing backlog. Unit tests cover late lease
acquisition, release, removal, disposal, and alpha-decode failure during lost GPU
residency. Alpha publication does not replace the leased source.

## Probability producer control

The existing `/tmp/probability-settlers-svg-previews.zip` was extracted into a
temporary directory and served on localhost with CORS. The ordinary public
`gltfResourceReader` loaded all 273 exported models as non-visual claims:

- 273 ready models, no model failures;
- 60 shared PNG reads and one shared normal-map image;
- zero SVG reads, VT pages, or persistent GPU allocations before visibility.

Showing the largest-army card, cutting mat, ruler, and counter with a studio
environment loaded five vector sources, retained five automatic resources, and
settled 24 pages with no pending bytes, failures, or GPU denials. A 512-square
native capture contained 45,956 colored pixels and returned `NO_ERROR`.
The temporary package is a consumer integration control, not a committed fixture
or a dependency of the deterministic tests.

## Remaining acceptance work

Physical desktop/mobile frame and input latency, a worker-capable SVG backend,
occluded-stack demand, and a supported Basis KTX2 comparison remain outstanding.
The current DOM rasterizer can still block on a complex SVG. This evidence does
not establish an absolute hitch-free guarantee or a production speedup.
## Atlas growth verification (2026-09-08)

`growth-sync-a10.json` records the subsequent synchronization investigation.
The final implementation yields between submitting work and creating its GPU
fence, then polls without blocking and validates before publication. Final
instrumented maxima for error checks, fence creation, and fence waits were
about 1 ms each, versus the original 94 ms error-check wait. The run without
timing wrappers retained all target pages and recorded a 146 ms gap near growth
completion (257 ms maximum during startup), settling about 16.1 seconds after
zoom. See the capacity findings for limitations and intermediate experiments.

`atlas-copy-probe.mjs` exports `runAtlasCopyProbe()` for the Royal Vite page.
It relocates four patterned pages between different atlas column counts and
compares every channel, including alpha, for RGBA8 and SRGB8_ALPHA8. Chrome
reported zero mismatches and GL errors, with the read framebuffer restored.

`growth-a10.json` records overview and delayed zoom observations on the A10
iPad using the same 273-piece fixture as the earlier direct-target runs.
The overview uses 17,842,176 atlas bytes for 135 pages. Zooming the camera extent
from 0.85 to 0.3 after 12 seconds grows to 71,368,704 atlas bytes, copying all
135 existing pages and reaching all 583 currently demanded pages. The final
697 resident pages include retained earlier detail. Both runs have zero
growth/page failures, denied GPU claims, and context interruptions. These are
single observations, not latency guarantees: the zoom run settles at 27.1
seconds overall and records a 383 ms maximum rAF gap near the zoom transition.

### Transformed VT shader regression

`transformed-vt-probe.mjs` checks the report in Probability's
`research/royal-linen-vt-shader-bug.md` (released Royal 0.0.23). The same linker
failure was reproduced in Chromium against this checkout before the fix:
`surfaceBaseColorTextureCoordinate` was declared by the fragment stage but omitted
from the standard vertex stage for VT with nonidentity texture coordinates.
Both vertex guards now include virtual base colour. Unlit already used the correct
`TEXTURED` guard, and both program and draw owners already bind the UV uniforms.

Run `runTransformedVtProbe()` from this module on the Royal Vite origin. It links
production standard and unlit VT programs with identity and transformed UVs, then
captures the production vertex outputs using transform feedback. UV0 and UV1 are
swapped between artwork and the normal map, with independent artwork transforms
and normal tiling of 1500 × 750. All six Chromium cases passed, with exact expected
coordinates. This is a shader-level regression, not an end-to-end verification of
Probability's Linen import or AVIF decoding.

### Shrinking and spare-budget reuse (2026-09-08)

`atlas-copy-probe.mjs` now also compacts source slots 3 and 1 into destination
slots 0 and 1 of a smaller atlas. Native Chromium RGBA8 and SRGB8_ALPHA8 checks
pass with zero channel errors and preserved read-framebuffer bindings for both
growth and compaction.

[`shrink-a10.json`](shrink-a10.json) records the same 273-piece/60-texture A10
fixture with camera extents 0.85 → 0.3 at 12 seconds → 0.85 at 24 seconds → 0.3
at 34 seconds. Atlas allocation fell from 69,222,400 bytes to 34,611,200 bytes by
the 29.24-second sample. Page requests remained 227 across shrinking: migration
copied existing pixels without rerasterizing them. By 39.25 seconds the second
zoom-in had all 172 target pages, with 326 cumulative page requests. The 99 new
requests repopulated discarded detail. Final retained GPU bytes were 72,065,793,
with zero migration failures, page failures, denied claims, or context losses.
The root stayed at frame 402 between the final two samples. Startup still had a
336 ms maximum rAF gap; the repeated zoom-in had a 102 ms gap. These observations
do not establish hitch-free interaction.

The runtime regression covers delayed shrinking, cancellation, copy-failure
rollback, temporary initial-budget exhaustion, and two incompatible RGBA pools
sharing a 16 MiB root budget. Shrinking preserves all bounded desired pages and
releases spare capacity; it does not forcibly take actively demanded capacity
from one pool to equalize pools. The root default remains 256 MiB and resizing
still requires old-plus-new allocation headroom. Compressed ETC2 resizing and
automatic default-budget calibration remain separate work.


Adversarial follow-up found and fixed two multi-pool policy errors. First, a
pending shrink previously lent its expected savings to another pool; cancelling
that shrink retained 14,331,200 atlas bytes against a 12,582,912-byte allowance in
the 16 MiB regression. Accounting now reserves the larger old/replacement size
until commit. Second, any new pool could bypass shrink hysteresis even with ample
budget. The bypass now requires a measured capacity shortage. Both regressions
failed before the fixes and pass afterward; the 30 migration tests pass together.

### Repeatable saturation and lifecycle soak

`soak-probe.mjs` generates its own authored PNG pages and manifests. It needs no
Probability assets. It uses 128px and 256px pools, alternates which appears first,
pans, zooms out, clears the scene, and repeats three cycles. `sharedPool` instead
uses two 128px textures in one atlas. Checks include coverage of both textures at
phase boundaries, page/migration/context errors, the hard GPU ceiling, zero
claims after clearing/disposal, and no rendering during the final idle window.
The test uses a deliberately small 16 MiB root to expose saturation; this is not
a proposed production default. It exercises residency policy rather than SVG
rasterization or optimal page-size selection.

Build `renderer-core` and `renderer-webgl`, then run:

```sh
node research/svg-preview/soak-server.mjs
```

Open the token-bearing URL printed by the server. Optional query parameters are
`budget=16`, `cycles=3`, `dwell=6000` (milliseconds), and `shared=1`. For USB iPad
automation, run the server with `ROYAL_SOAK_HOST` set to the host's LAN address,
then run `soak-ipad.py` with a Python environment containing `pymobiledevice3`:

```sh
ROYAL_SOAK_URL='<printed URL>&shared=1' ROYAL_SOAK_REPORT=/tmp/soak.json \
  python research/svg-preview/soak-ipad.py
```

Safari automation must already be enabled and the iPad trusted. The driver polls
at ten-second intervals, saves the full report, and fails if the probe reports
errors or does not finish within its polling window. Default runs take about two
minutes; excessively large cycle/dwell overrides will exceed the driver window.

[`soak-results.json`](soak-results.json) includes the baseline and final runs.
The baseline lacked the later explicit phase-boundary coverage assertion; its
empty error list must not be interpreted as a coverage pass. All three baseline
A10 cycles left the second incompatible pool at zero resident pages in the
`both` phase. Reversing arrival order left the later pool with only one page.
This motivated active-pool budget sharing and admission shares within a pool.

Final A10 observations (three cycles per mode, about 113 seconds each):

| Observation | Mixed 128/256px pools | Shared 128px pool |
| --- | ---: | ---: |
| Desired / admitted pages at `both` | 258 / 74 | 402 / 114 |
| Unresident admitted pages at each `both` / `reverse-both` phase end | 0 | 0 |
| Peak claimed GPU bytes | 16,766,250 | 16,738,046 |
| Page/migration/context failures | 0 | 0 |
| Final empty-scene GPU claims | 0 | 0 |
| Final idle frame delta | 0 | 0 |
| Recorded maximum rAF gap | 50 ms | 96 ms |

Retained page counts can remain asymmetric because useful old detail stays
cached until its slots are needed. Admission and coarse coverage are shared;
identical cached-resident counts are not required. Saturation deliberately
reduces target quality instead of leaving later textures without coverage.

Chromium also passed coverage and cleanup at 16 MiB with 12-second dwell, but
still had 14 unresident admitted pages at one phase boundary and a 333 ms maximum
rAF gap. Its earlier default-budget control likewise had pending refinement at
six-second boundaries. These headless observations do not establish comparable
refinement performance to native A10, and the recorded gap differences between
runs are not an isolated performance comparison.

The original 273-piece SVG fixture was rerun on A10 with the final policy and the
unchanged 256 MiB default. It settled at 16.26 seconds (about 4.26 seconds after
the scripted zoom), with all 172 target pages resident, 227 page requests,
69,222,400 atlas bytes, and 72,065,793 total claimed GPU bytes. No failures,
denials, or context losses occurred. This is consistent with the earlier
approximately 4.1-second runs, rather than evidence for a new speedup. Startup
still had a 270 ms maximum rAF gap. The 256px SVG/128px ordinary-raster page-size
policy is unchanged.
# Atlas-copy overhead follow-up

The source atlas now retains its validated copy framebuffer across batches,
and the runtime caches `MAX_TEXTURE_SIZE` until context invalidation. This
removes repeated framebuffer creation/attachment checks and limit queries;
binding restoration and deferred copy-error validation remain intact.

The attached A10 repeated the 273-piece original SVG fixture with these changes:
all 172 target pages settled about 4.28 seconds after zoom, with 72,065,793
tracked GPU bytes, no failed pages, allocation denials, or context loss, and
no further frames while idle. Text remained readable in the captured image.
This is consistent with the previous ~4.3-second result, not evidence of an
end-to-end speedup. Raw results: [copy-cache-a10-results.json](./copy-cache-a10-results.json).

## Historical nested SVG crop review (resolved above)

The new outer crop viewport passes the 48 existing browser parity cases and
42 focused unit tests, but introduces a supported-CSS regression: an authored
`<style>:root > rect {fill:red}</style><rect width="100%" height="100%"/>`
inside a 200x100 SVG renders black after its root becomes a nested SVG. The
committed `e5cb9ebd` crop path matches the ordinary red reference exactly;
the new path differs in 131,072 channels across a 512x256 tile. This blocks
acceptance of the wrapper approach without preserving CSS document-root
semantics or providing a correct fallback for affected sources.

A second fixture using `50vw` also differs from ordinary rendering, but fails
in both the committed and current implementations. It is an existing limitation,
not a new regression. These are Chromium results; this review did not repeat
them on A10. `svg-crop-adversarial-probe.mjs` exports the diagnostic fixtures;
nonzero mismatches intentionally report the reproduced problems. Evidence:
[svg-crop-review-results.json](./svg-crop-review-results.json).
