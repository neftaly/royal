# Preview-first SVG consumer verification

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
