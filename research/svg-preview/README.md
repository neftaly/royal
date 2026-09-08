# Preview-first SVG consumer verification

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
