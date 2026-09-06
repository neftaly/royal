# Cold-start evaluation, 2026-09-06

The shared-codec change is worthwhile for cold delivery of worker-prepared assets. It does not establish an A10/Quest FPS or full-Play startup improvement. No features or fidelity were intentionally removed.

The first implementation added a serial codec request: paired median constrained-network regressions were approximately +79 ms for small main-thread Draco and +25 ms for worker Draco. Starting codec delivery after document validation, alongside external buffer reads, removed that regression in the revised measurements. The codec implementation remains minidraco; no dependency update is included.

## Method

Baseline: released Royal 0.0.20 (`bcbac2d332521c36857b9b4d9b17ebad598813bb`), extracted from its release tarballs. Candidate: the working shared-codec implementation, rebuilt with codec prefetch. Consumer bundles are production Vite builds with gzip delivery.

Each run contains 480 navigations: 20 paired repetitions × 3 workloads × 2 network profiles × 2 versions × cold/warm. A/B order alternates. Both the original and revised candidates have a complete run, 960 navigations overall. Chromium 151.0.7922.34, headless SwiftShader, 512×512 rendering. Cold means a fresh isolated browser context with empty HTTP cache; the browser process and server persist. Warm means reloading the same page/context with HTTP cache enabled, recreating the renderer and workers.

Workloads: an asset made with Probability Play's actual `createBoxPieceGltf` card generator and a fixture PNG; a small Draco Duck GLB taking main-thread preparation; and a JSON Duck with duplicated primitives exercising preparation plus nested decode workers. These are isolated Royal scenes, not the full Play route or a representative large game. Card input comes from Probability checkout `e9af8ed`; a Duck texture stands in for game artwork.

Normal profile: local server, no added delay. Constrained profile: each response waits 80 ms plus its gzip body size / 187,500 bytes per second (1.5 Mbps). This includes worker requests. It is a controlled per-response delay model, **not shared-link bandwidth shaping**, real internet variability, or device CPU emulation. Warm HTML still incurs a request; cached JS/model resources avoid delivery. Do not translate these milliseconds directly to users' devices.

Endpoint: navigation time until asset status ready, explicit render flush, then two animation frames. This is a settled-frame proxy, not instrumented first GPU presentation, first input readiness, or full application interactivity. Raw data also records renderer-start, asset-ready, asset timings, resource timings, and buffered main-thread long tasks. Renderer start follows static module imports; parse/compile time is included in navigation elapsed time but not separately profiled.

## Revised results

All times are milliseconds. CI is a deterministic 5,000-resample paired bootstrap interval for the **mean delta**; it is not an interval for the displayed medians. With 20 pairs, p95 is exploratory.

| Profile | Asset | Cache | Baseline median | Candidate median | Paired median Δ | Mean Δ 95% CI | Baseline / candidate p95 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| normal | card | cold | 128.9 | 126.1 | -4.4 | [-18.5, -0.9] | 169.8 / 139.7 |
| normal | card | warm | 137.4 | 129.4 | -0.3 | [-8.5, -2.3] | 156.9 / 145.8 |
| normal | dracoMain | cold | 170.1 | 166.7 | -2.8 | [-9.5, +3.1] | 184.0 / 176.9 |
| normal | dracoMain | warm | 146.2 | 145.9 | +0.0 | [-4.8, +12.9] | 161.5 / 159.4 |
| normal | dracoWorker | cold | 169.9 | 172.1 | +1.6 | [-4.3, +3.6] | 201.1 / 194.1 |
| normal | dracoWorker | warm | 146.1 | 146.1 | -0.1 | [-8.0, +7.2] | 179.8 / 162.1 |
| latency | card | cold | 1320.2 | 1139.7 | -178.6 | [-184.8, -178.8] | 1327.4 / 1143.1 |
| latency | card | warm | 179.1 | 162.6 | -16.3 | [-14.1, -5.5] | 179.4 / 179.2 |
| latency | dracoMain | cold | 1501.4 | 1489.5 | -11.6 | [-15.9, -8.4] | 1515.2 / 1505.8 |
| latency | dracoMain | warm | 195.9 | 195.5 | -0.2 | [-4.4, +2.4] | 196.3 / 196.1 |
| latency | dracoWorker | cold | 1399.2 | 1274.2 | -119.4 | [-128.0, -118.3] | 1413.8 / 1289.8 |
| latency | dracoWorker | warm | 212.8 | 212.6 | -0.3 | [-4.3, -0.1] | 229.1 / 228.0 |

The constrained cold card median improves 180.5 ms (13.7%), worker Draco 125.0 ms (8.9%), and small Draco 11.9 ms (0.8%). Local Draco paired deltas are a few milliseconds with mean intervals crossing zero. Warm Draco is effectively unchanged. The warm card benefit is small and frame-quantized; its median pair improves 16.3 ms. The worthwhile result is reduced cold worker-path delivery, not a broad execution-speed improvement.

Median main-thread long-task time is zero in every condition. Across 240 samples per version, baseline has two samples with long tasks (maximum task 99 ms); candidate has one (maximum 56 ms). These rare counts do not support a reliable stall reduction claim. Worker CPU stalls, retained memory, sustained interaction, GPU frame times, shader-cache coldness, and thermal behaviour were not characterized.

All three paired screenshots are pixel-identical, and every benchmark navigation completed without page errors or HTTP errors. Separate browser parity checks compare Draco positions/normals/indices exactly between main and nested-worker paths, and decode a known Meshopt triangle. Play smoke checks cover history restore, SVG rasterization, camera gestures, one-finger piece drag and module loading. Physical A10/Safari and Quest 2 measurements remain outstanding; no devices were attached.

Final gzip: 253,609 B total fixture JS versus 287,811 B baseline; 194,301 B incremental over React versus 228,503 B. Saving 34,202 B (15.0% of Royal's complete incremental graph); initial entry rises only 59 B. Prefetch retains the bundle saving while avoiding the serial-request regression.

## Evidence and reproduction

`results-prefetch.json.gz` and `results-before-prefetch.json.gz` contain all raw samples. Their summary JSON files contain paired statistics. PNGs capture baseline and final output. Scripts preserve the measurement setup; paths default to this workspace and `/tmp/royal-cold-start`.

To reproduce on this workspace, build Royal, create `/tmp/royal-cold-start/baseline-packages/{renderer-core,renderer-webgl}`, and extract the corresponding **released** 0.0.20 tarballs into those folders with `tar --strip-components=1`. Symlink `/tmp/royal-cold-start/node_modules` to Royal's `packages/renderer-webgl/node_modules`. Royal and Probability dependencies, Playwright Chromium, Node, and Python 3 must already be installed. Then, from Royal:

```sh
pnpm build
ROYAL_BUILD_VARIANTS=baseline,candidate-prefetch node research/size-evaluation-2026-09-06/cold-start/setup.mjs
node research/size-evaluation-2026-09-06/cold-start/server.mjs
# In another terminal, with other browser workloads stopped:
ROYAL_COLD_CANDIDATE=candidate-prefetch ROYAL_COLD_OUTPUT=/tmp/royal-cold-start/results-prefetch.json node research/size-evaluation-2026-09-06/cold-start/run.mjs
python3 research/size-evaluation-2026-09-06/cold-start/analyze.py /tmp/royal-cold-start/results-prefetch.json
```

Restart the server after rebuilding fixture files: it caches response bodies. The original rejected candidate is represented by archived raw results, not a committed source revision. Avoid mixing runs from changed code. Hardware validation should repeat paired cold/warm loads on Safari/A10 and Quest Browser and include a real Play game plus interaction/XR frame-time and memory measurements before making device-performance claims.

Final verification logs are retained in `verification/`: 945 tests, typecheck, lint, builds, packed consumers/real codecs, and tightened size budgets pass. All five Play checks pass. The combined browser run initially failed two codec harness checks because the production rebuild removed temporary model assets and the source server reloaded; restoring fixture assets and rerunning both checks passed (`codec-browser.log`). No product-code change was needed for those harness failures. These measurements were captured before the 0.0.21 release; see the subsequent adversarial review for release validation.
