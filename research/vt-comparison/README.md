# VT follow-up — 2026-09-12

Completed the renderer-scene benchmarks, integrated mip filtering, exercised the
offline baker through browser rendering, and investigated demand scaling and GC.
The renderer changes total 26 net lines and add no dependencies or public
options. The authoring and benchmark tools remain outside the renderer bundle.

## Resulting behavior

`linear-mipmap-linear` and `nearest-mipmap-linear` now blend adjacent virtual mips
using the existing sampler contract. Automatic raster/SVG demand includes the
next coarser mip needed for that blend, plus the coarsest fallback; it still skips
unneeded intermediate ancestors. Other filters retain single-mip selection.
Mip lookup retains the existing resident-ancestor and fast-zoom-out fallback.
The filtering flag survives atlas growth and shrink migration. Automatic SVG
page production remains RGBA; no runtime encoder or transcoder is introduced.

Demand reuses a fixed 256-entry transformed-vertex cache, adding 13 KiB of typed
scratch per resource regardless of mesh size. The cache resets per geometry,
model and view, and collisions replace entries. Flat/orthographic triangles
with constant clip W need one derivative sample instead of four. Squared
footprint lengths replace repeated `Math.hypot` calls, matching the shader's LOD
calculation. Previously requested pages skip repeated ancestor traversal. A pass that newly
overflows the page limit stops immediately before the runtime retries at a
coarser minimum mip; an earlier truncation flag remains preserved.

## Production comparison

The final comparison uses minified production builds of the same scene harness,
with the released `v0.0.28` versions of demand/runtime/shader modules as baseline.
`build-client.mjs` substitutes those files during bundling without editing the
working tree. Results: [before](production-before.json), [after](production-after.json).
Both ran sequentially in isolated, **headless Chromium 152**, using ANGLE Vulkan
on **Intel Iris Xe**, verified from the WebGL renderer string. Local HTTP serving
was used. There were no parallel test/build jobs during these measurements.

Each case runs both sampler settings, 15 moving warm-up frames and 90 measured
frames at 512×512. Camera motion crosses mip boundaries in zoom/SVG cases.
The dense mesh contains 20,000 distinct grid triangles; `hidden` puts it behind
an opaque surface. `overdraw` deliberately repeats coincident triangles and is
an extreme rasterization stress case. These are reproducible renderer scenes,
not a comparison of unrelated engines or a mobile-device performance claim.

Numbers below use the default `linear-mipmap-linear` sampler. Submission timing
covers camera commit and renderer flush. Frame intervals include browser/host
scheduling and cold diagnostics; they are not GPU execution times.

| Scene | Before submission p95 ms | After submission p95 ms | Before frame p95 ms | After frame p95 ms |
| --- | ---: | ---: | ---: | ---: |
| zoom | 2.2 | 1.8 | 18.3 | 17.4 |
| oblique | 0.7 | 0.5 | 17.0 | 17.3 |
| hidden | 40.8 | 12.6 | 45.9 | 41.0 |
| dense | 59.7 | 8.5 | 67.0 | 17.3 |
| overdraw | 69.1 | 18.0 | 135.6 | 51.7 |
| raster | 0.4 | 0.6 | 17.0 | 25.3 |
| svg | 1.3 | 1.3 | 17.8 | 17.8 |
| astc-6x6 | 0.4 | 0.3 | 17.1 | 17.1 |
| astc-8x8 | 0.5 | 0.4 | 17.1 | 17.0 |

Dense demand improved substantially, but CPU demand still scales with surviving
triangles and does not know depth occlusion. The extreme overdraw case remains
slow; these changes do not promise a hard frame-time ceiling. Small-scene timing
differences are susceptible to host load. In particular, hidden/raster frame intervals vary with scheduling and
GPU work; submission improvements do not guarantee matching frame-time gains.
These short runs should not be generalized to every scene or device.

Across the complete production run, GC observations fell from **991 events /
417.0 ms** to **381 events / 153.5 ms**. The longest recorded collection fell
from 7.8 to 5.5 ms. These aggregate traces include scene construction, snapshots,
source preparation and screenshots; they are not per-bind allocation counts.
Forced-GC heap usage after disposal was 3.44 versus 3.46 MB, with backing storage
about 399 KB in both runs. This short lifetime check is not a long-duration leak
proof. Sampling profiles in `hidden-profile*.json` attributed much of the dense
case's transient allocation to footprint calculations and `Math.hypot`.

All 18 production scenarios settled with zero failed/unresident pages and no GL
errors. Screenshots are saved under `production-before-images/` and
`production-after-images/`. The host driver accepted ASTC 6×6 and 8×8; this proves
that the advertised path rendered correctly, not that the GPU has a dedicated
ASTC decoder. The two formats preserve artwork orientation and text in the
captured images. The oblique checkerboard still shows filtering limitations;
trilinear is not anisotropic filtering.

The isolated GPU experiment (`host-results.json`) measured 0.041 ms for one mip
and 0.087 ms for two at 256×256 using non-disjoint timer queries. That motivated
checking the full renderer before integration. It is a historical pre-integration
microbenchmark, not the final frame-time evidence.

The final [production sampler check](sampler-results.json) verifies quarter-step
blends, the midpoint and missing-detail fallback using the exact renderer GLSL.
Its non-disjoint GPU queries measured 0.110 ms for single-mip sampling and
0.162 ms for trilinear at 256×256. Filtering has a measurable GPU cost; it is
enabled by the existing mip-linear sampler setting, not claimed to be free.

## Memory and transport findings

Automatic PNG VT retained the 1024² decoded source (4 MiB). Authored PNG and ASTC
pages retained no full decoded source. Automatic SVG raster-cache usage stayed
inside the existing 4 MiB bound, including adjacent-mip rasters. Page uploads
and pending work remain under the existing admission limits.

Native pools currently reserve approximately 32 MiB per compatible format pool
and do not resize; the test explicitly exposes this cost. The PNG atlas can grow
and shrink. Compressed payloads alone therefore do not guarantee lower *allocated*
GPU memory for a tiny scene. Changing compressed-pool migration is a separate
tradeoff, requiring re-upload or a supported copy path; this change preserves the
existing fixed-pool behavior.

The generated checker/text source is deliberately easy for PNG compression:
85 PNG pages total 60,578 bytes, versus 671,840 bytes for ASTC 6×6 and 406,640 bytes
for ASTC 8×8, excluding manifests. ASTC saves decode work and block storage, but
is not universally a smaller download. Resource Timing reports both body bytes
and transferred bytes. The second sampler run can reuse HTTP cache, so cold-load
timing or transferred-byte comparisons between sampler modes are not controlled.

## Offline page authoring

`scripts/bake-vt-pages.py` generates a complete VT2 mip/page tree from an sRGB
PNG. Supported outputs are PNG, ASTC LDR 6×6 KTX2, and ASTC LDR 8×8 KTX2.
It uses offline Pillow/NumPy and, for ASTC, an external Arm `astcenc` binary.
None are runtime dependencies. Other native formats remain supported by the
renderer but this baker does not add their encoders.

```sh
python3 scripts/bake-vt-pages.py artwork.png public/artwork-vt
ASTCENC=/path/to/astcenc python3 scripts/bake-vt-pages.py artwork.png public/artwork-astc --format astc-6x6
ASTCENC=/path/to/astcenc python3 scripts/bake-vt-pages.py artwork.png public/artwork-astc8 --format astc-8x8
```

The current input profile is power-of-two dimensions up to 16384, authored in
sRGB with straight alpha. The baker downsamples whole mips in linear light with
premultiplied alpha, then stores straight-alpha pages. It duplicates neighboring
texels into gutters before encoding: 128 usable texels plus 2-texel gutters for
PNG/6×6 (132 stored), or 4-texel gutters for 8×8 (136 stored). Edge behavior is
clamp by default; use `--wrap repeat` and matching sampler settings for repeating
artwork. Mirrored or mixed-axis wrapping is not supported by this baker.

The destination must not exist. A manifest is written only after all pages
succeed; a failed run can leave an incomplete directory which should be removed
before retrying. This tool uses whole-image CPU memory offline; it does not make
the build process itself out of core. Compression happens once during authoring,
not when a browser requests a page.

```ts
import { virtualTexture, unlitMaterial } from '@royal/renderer-core';
const texture = virtualTexture('/artwork-vt/manifest.json');
const material = unlitMaterial({ texture });
// For a tree baked with --wrap repeat:
const repeated = virtualTexture({ manifestUri: '/artwork-repeat/manifest.json',
  sampler: { wrapS: 'repeat', wrapT: 'repeat' } });
```

Serve the entire directory. Native ASTC pages require device ASTC support;
this manifest does not implement cross-format fallback selection. Choose the
PNG tree for a portable authored VT asset. Merely keeping both directories
does not attach them as alternatives.

The 256² tiger fixture produces 5 pages: PNG 102,925 bytes, ASTC 6×6 39,520
bytes, and ASTC 8×8 23,920 bytes, excluding manifests. ASTC used `fastest`
for the smoke check; these are file sizes, not quality-equivalence claims.
All 10 ASTC pages were accepted by Royal's production KTX2 parser and matched
their manifests' encoding, color space, dimensions and payload byte counts.
The larger browser fixtures also passed full parser validation: all 170 ASTC
pages across the two 85-page trees.

## Reproduction

```sh
# Requires offline Pillow/NumPy and Arm astcenc. Generated trees are ignored.
ASTCENC=/path/to/astcenc python3 research/vt-comparison/generate-scenes.py
VT_BASELINE=1 node research/vt-comparison/build-client.mjs
node research/vt-comparison/build-client.mjs
python3 -m http.server 5185 --bind 127.0.0.1 --directory node_modules/.cache/royal-vt-build-before
# Another terminal:
python3 -m http.server 5186 --bind 127.0.0.1 --directory node_modules/.cache/royal-vt-build-after
```

Run sequentially with host GPU access:

```sh
VT_BENCH_URL='http://127.0.0.1:5185/research/vt-comparison/scenes.html?case=zoom,oblique,hidden,dense,overdraw,raster,svg,astc-6x6,astc-8x8' VT_BENCH_OUTPUT=research/vt-comparison/production-before.json node research/vt-comparison/run-host.mjs
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/scenes.html?case=zoom,oblique,hidden,dense,overdraw,raster,svg,astc-6x6,astc-8x8' VT_BENCH_OUTPUT=research/vt-comparison/production-after.json node research/vt-comparison/run-host.mjs
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/index.html' VT_BENCH_OUTPUT=research/vt-comparison/sampler-results.json node research/vt-comparison/run-host.mjs
python3 research/vt-comparison/baker-test.py
```

The runner defaults to headless Vulkan, rejects software renderer strings, and
uses an isolated temporary profile. It never launches a headed browser.
`VT_PROFILE=1` adds sampling profiles for attribution, with overhead; do not use
those runs to rank frame times. The standalone scenes page also has a run button
and exercises the actual `createRendererRoot` / `virtualTexture` APIs.

The original `browser-results.json`, `host-*.json`, `cpu-*.json`, `scenes-*.json`
and `hidden-profile*.json` retain exploratory evidence from earlier stages. Use
the `production-*` pair for the final comparison; do not mix their baselines.
`validate-bake.ts` can be bundled with Vite SSR and passed generated ASTC trees
to verify every page against the production manifest and native KTX2 parsers.

## Decisions on the other researched approaches

| Approach | Decision and reason |
| --- | --- |
| GPU feedback | Retain CPU demand. Dense-scene measurements justified smaller CPU fixes first. Feedback needs a render target/readback pipeline and latency handling; no matched evidence establishes a net benefit for Royal's current workload. Occluded textures still receive conservative demand. |
| Anisotropy | Not added. Oblique screenshots expose the remaining quality limit, but correct atlas filtering needs border-aware footprint handling and additional samples. Enabling a sampler extension alone would not implement virtual anisotropy. |
| Prefetch | Not added. Rapid-zoom scenarios expose temporary demand misses and then settle correctly. Prefetch would consume page/raster budgets and can waste reads on camera reversals; no measured benefit yet justifies a prediction policy. |
| Multiple material layers | Keep VT focused on base color. Shared stacks help when several maps use the same UVs, but the SVG/artwork workload does not establish that requirement. |
| Runtime encoding/transcoding | Excluded. Author native pages offline; keep generated SVG pages RGBA. |
| Packed/range transport | Individual page URIs remain. The complete offline authoring path now avoids full-source decoding in the browser without introducing a new container or transport protocol. |

These are completed scope decisions, not claims that the optional techniques
have been implemented. Unreal documents GPU visibility feedback and material
stacks; Unity documents asynchronous feedback readback and cache management.
[Unreal SVT](https://dev.epicgames.com/documentation/unreal-engine/streaming-virtual-texturing-in-unreal-engine?lang=en-US),
[Unity SVT](https://docs.unity3d.com/6000.0/Documentation/Manual/svt-how-it-works.html),
[Unity cache management](https://docs.unity3d.com/6000.0/Documentation/Manual/svt-cache-management.html).

## Adversarial review

First pass covered correctness: the filtering flag survives atlas migration;
one-mip textures avoid a second lookup; missing detail resolves through the
existing ancestor path; adjacent mip requests respect capacity coarsening;
coarsest SVG previews remain deferred. Repeated demand after truncation,
vertex-cache collisions and geometry/view/instance changes are tested. Flat
triangles take the one-sample shortcut only when their reciprocal-W values are
identical. Squared footprint overflow clamps to the coarsest mip.

Second pass covered cost and lifetime: fixed scratch prevents mesh-sized cache
allocation; no per-triangle arrays or new dependencies were introduced; the
sampling profile led to the `Math.hypot` removal; production builds verify both
rendering and aggregate GC; all scene resources are disposed. Native fixed-pool
allocation, full-raster retention, driver ASTC support and the lack of occlusion
feedback are reported explicitly rather than hidden behind compressed-byte or
microbenchmark numbers.

Bundle accounting: the measured lazy/deployed increase is roughly 0.2 kB gzip.
Only the three affected lazy/total ceilings receive a 256-byte allowance; initial
and worker ceilings are unchanged. The source-map-bearing renderer package gets
a 1 KiB ceiling allowance. The baker and benchmark fixtures are not published.

Final checks: all 1,216 tests across 148 files passed, as did type checking,
renderer lint/build, bundle ceilings, packed-package consumer checks, the four
offline baker tests and the research harness type check.
