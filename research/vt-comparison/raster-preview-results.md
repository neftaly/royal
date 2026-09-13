# Explicit raster previews: implementation and review

Date: 2026-09-13. Baseline: 56130d34, which already fixes required SVG/WebP/AVIF
composition with optional ASTC. The proposal's raster follow-up is accepted and
implemented using private metadata, documented in
[the authoring contract](../../docs/specs/raster-texture-previews.md).

## Outcome

Marked base-color textures use ASTC immediately, then load the full raster only
when projected demand exceeds the preview's actual resolution. Unmarked ASTC
remains a final alternative. Unsupported devices and non-base-color uses load
the full source directly. No runtime transcoder or encoder was added.

SVG and raster previews share the existing lifetime, detail queue and VT page
publication path. Raster detail reserves retained bitmap bytes before reading,
against the existing 64 MiB automatic-source budget. Shared decoded sources count
once, including a sampler added after the full bitmap has loaded. Denied loads
remain retryable after capacity is released; failed loads retain native coverage.

The runtime keeps the original full raster extent separate from preview upload
size. It also retains the minimum squared footprint in eight bytes of existing
scratch, converting it to a fractional LOD when testing preview sufficiency.
This handles both a 32px preview below the coarsest 128px page and non-power-of-two
preview sizes. Raster headers are validated before browser bitmap decoding.

## Correctness and host GPU

All 24 cases in [the transport/render oracle](raster-preview-results.json) pass
on headless Chromium with Intel Iris Xe through ANGLE Vulkan. Both ASTC 6x6 and
8x8 are exercised with hardware capability available and forcibly unavailable:
SVG, WebP, PNG, PNG plus SVG, marked PNG preview and marked required-WebP preview.
The images use distinct red preview and blue authority pixels.

Supported marked cases read only ASTC for the first small view, with zero RGBA
atlas allocation. A larger view requests the full raster exactly once. PNG
promotes while still needing only one coarse page. WebP exercises atlas growth
from 69,696 to 627,264 bytes, shrink back to 69,696 bytes, and context restoration.
The restored pages reuse full authority without another source read. Unsupported
cases read only the portable full source. Saved screenshots accompany the JSON.

Unit coverage includes required AVIF with its bounded header fixture and a mocked
bitmap decoder; AVIF is not part of the physical-GPU oracle. Additional tests
cover metadata and identity, incorrect headers before decode, bad preview/full
source, CPU alpha, pending reservations, shared aliases, budget retry, cancellation
and late bitmap disposal. The complete suite passes 1,242 tests across 149 files.

## Demand cost and GC

[The alternating CPU comparison](raster-demand-comparison.json) warms both
versions in one Node process, then alternates their order over four rounds.
Fixtures include dense grids and coincident triangles. Node's nursery is fixed
to 16 MiB so GC counts are comparable. This isolates demand computation, excluding
GPU rendering, image transport, browser decoding and upload.

Median across the four 20,000-triangle run medians, milliseconds:

| Geometry / ancestor policy | Before | After |
| --- | ---: | ---: |
| Grid / coarsest | 9.451 | 9.741 |
| Grid / all | 9.464 | 9.781 |
| Coincident / coarsest | 13.552 | 13.325 |
| Coincident / all | 13.603 | 13.525 |

The grid runs produce 173 GC events in both versions, totaling 45.96 versus
47.51 ms. Neither coincident group collects during measurement. This supports
similar allocation volume, with roughly 3% higher grid median CPU cost; it is
not a claim of zero overhead. Earlier default-heap runs had different collection
counts despite sampled allocation totals being similar. GC counts alone were
therefore insufficient to attribute new allocation to the footprint accumulator.
Sampling attributes substantial existing churn to triangle demand/range calls;
removing that churn is a separate next optimization.

Reproduce the isolated comparison:

```sh
node --min-semi-space-size=16 --max-semi-space-size=16 --expose-gc research/vt-comparison/compare-demand.mjs
```

`VT_PROFILE=1` enables allocation sampling for attribution, reducing the run to
one round and adding overhead. `VT_DEMAND_OUTPUT` selects a separate output.

## Browser scene comparison

The matched 18-scene runs are saved as [before](raster-overhead-before.json) and
[after](raster-overhead-after.json). Each uses 15 warm-up and 90 measured frames
per case, a 512px canvas, local HTTP and headless Iris Xe. Default mip-linear
submission median / p95, milliseconds:

| Scene | Before | After |
| --- | ---: | ---: |
| Zoom | 0.4 / 2.5 | 0.4 / 2.2 |
| Oblique | 0.4 / 0.6 | 0.4 / 1.3 |
| Hidden dense mesh | 8.8 / 14.7 | 8.3 / 12.8 |
| Dense mesh | 7.3 / 9.9 | 9.1 / 14.0 |
| Extreme overdraw | 11.4 / 15.7 | 11.9 / 14.3 |
| Raster | 0.3 / 0.5 | 0.3 / 0.5 |
| SVG | 0.3 / 1.3 | 0.4 / 1.4 |
| ASTC 6x6 | 0.2 / 0.4 | 0.3 / 0.4 |
| ASTC 8x8 | 0.2 / 0.4 | 0.2 / 0.3 |

The dense-scene result is slower, while hidden geometry is faster. Exploratory
reverse-order focused runs had dense medians of 6.9 versus 7.3 ms; the magnitude
is not stable across runs. The isolated CPU comparison above still finds roughly
3% overhead on grids, so these results do not establish performance neutrality.
Ordinary texture scenes remain small compared with a frame; extreme overdraw
remains far above a 16.7 ms frame interval (55.0 ms p95 after versus 56.9 before).

Aggregate GC time is 166.6 versus 182.0 ms, and post-GC JS heap is 3,441,892 versus
3,477,264 bytes. Backing storage is 399,217 versus 403,946 bytes. These are whole
renderer-process traces, including fixture setup and diagnostic screenshots;
they are not per-bind allocation measurements. Unlike the Node comparison,
Chrome nursery sizing is not fixed. The added feature does not resolve existing
triangle-demand churn or overdraw costs.

## Two adversarial review passes

1. Correctness and source authority: checked required source roles, metadata
   ambiguity, non-base-color quality, actual/logical dimensions, native failure,
   unsupported capability, and full-source failures. Regression tests caught a
   duplicate unsupported-source preload and premature promotion for non-power-of-two
   previews; both are fixed. No dimension-based inference replaces explicit intent.
2. Performance and ownership: checked shared sampler identity, pending reservation
   timing, late completion/disposal, decoded-source accounting, page publication,
   atlas migration and restored context. Review found and fixed duplicate bitmap
   charging during later sampler admission. Minimum footprint uses fixed scratch;
   unique source accounting reuses weak identity marks rather than rebuilding a
   set on every snapshot. CPU sampling and fixed-heap comparison are reported above.

The implementation adds 134 net renderer source lines, sharing preview machinery.
Measured deployed JavaScript grows about 1.35 kB gzip; the renderer package with
source maps grows about 4.4 kB. Narrow budget allowances cover 192 bytes initial,
1,152 lazy, 1,408 deployed/total, 256 worker, and 4,608 packed bytes. Research
harnesses and fixtures are not published in the renderer package.

Browser codecs can still use transient full-image decode memory. The retained
budget does not make PNG/WebP/AVIF out of core; authored VT pages remain the path
for avoiding whole-source decode. Host GPU results do not establish mobile or
Quest performance.

Validation at the raster-preview checkpoint: full tests, type checking, lint,
research harness type checking, packed entrypoint/standalone-codec consumers and
bundle ceilings all pass. Changes remain uncommitted at the user's request.
