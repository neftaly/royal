# Separate dependency maintenance, 2026-09-06

This follows the 0.0.21 release and is separate from its code-size investigation.

## Changes

- pnpm 10.33.2 → 10.34.5; Vite 8.1.0 → 8.2.2; React Vite plugin 6.0.3 → 6.1.1; GLSL plugin 1.6.0 → 1.6.1; Vitest 4.1.9 → 4.1.11.
- React/DOM development dependencies 19.2.7 → 19.2.8; React typings 19.2.17 → 19.2.18; DOM typings 19.2.3 → 19.2.7; Node 24 typings 24.13.2 → 24.13.3.
- Keep Royal's published React peer range at ^19.2.7, decoupled from the development catalog, so Probability need not update React to consume Royal.
- minidraco 0.3.0 → 0.5.0. Keep the raw decoder API and Royal's worker scheduling, without adopting the Three.js loader or a second worker pool.
- Refresh the lockfile to PostCSS 8.5.28 and nanoid 3.3.18. Registry audit falls from three high and one moderate advisory to zero. These findings were in the build-tool dependency chain; no runtime exploit in Play was demonstrated. Audit JSON is archived here.
- Use an explicit .ts extension in the codec-plugin config import, addressing the new Vite native-config warning.

No Node runtime upgrade, TypeScript 7, Vitest 5, pnpm 12, or paired oxlint/tsgolint migration is included. Meshoptimizer remains current at 1.2.0; Three stays at 0.184.0 because its development comparison fixtures deserve a separate update. The real Probability checkout and its catalog are untouched.

## Fidelity and warmed decode

The released 0.0.21 codec (minidraco 0.3.0) and published 0.5.0 decode all nine compressed primitives in Duck and Sunglasses with exactly equal face indices and every attribute. Three repeated comparison rounds also confirm earlier extracted outputs remain stable after subsequent decodes. The packed consumer now hashes all decoded faces and Float32 attributes against golden SHA-256 values generated from the released decoder, in addition to the known Meshopt triangle.

An isolated Chromium 151 headless microbenchmark uses 40 interleaved paired samples after five warmup batches. Each sample decodes and extracts all nine primitives ten times, including face traversal. Median total time is 85.95 ms with the old codec versus 67.40 ms with the new codec (21.6% lower); paired median delta is -19.00 ms, paired mean-delta bootstrap 95% interval [-19.48, -18.33] ms. These are warmed desktop V8 results, not A10/Quest frame-time measurements or a claim about whole-app speed. Scripts and samples are archived here; scripts default to the original temporary harness paths.

## Size tradeoff

| Fixture gzip bytes | Released 0.0.21 | Tooling only | Tooling + minidraco 0.5.0 |
| --- | ---: | ---: | ---: |
| Initial | 139,919 | 139,818 | 139,817 |
| Complete JS | 253,609 | 253,582 | 257,279 |
| Royal incremental over React | 194,301 | 194,294 | 197,991 |
| Preparation worker | 22,952 | 23,025 | 23,025 |
| Standalone Draco | 24,220 | 24,224 | 27,919 |

The decoder update adds about 3.7 KB gzip. The original lazy/complete budgets correctly failed. This change explicitly adds a 3,700-byte minidraco allowance to those three ceilings, justified by the measured warmed decoding improvement and exact fidelity. Initial and worker ceilings remain unchanged; no rendering feature is removed to offset it. Total JS remains about 30.5 KB below 0.0.20.

## Cold/warm navigation comparison

480 navigations: 20 interleaved paired repetitions × three workloads × two network profiles × old/new × cold/warm. Baseline is the exact production fixture from the released 0.0.21 implementation; candidate uses the updated tooling and minidraco. Same Play card generator, Duck GLB and duplicated-primitive Duck JSON workloads as the previous investigation, same camera/material settings, Chromium 151 headless SwiftShader. Cold means a fresh isolated browser context, not a new browser process; warm means reloading with its HTTP cache retained.

The latency profile delays each response by 80 ms plus gzip body bytes / 187,500 B/s. This is a controlled per-response network simulation, not shared-link bandwidth shaping. Endpoint is asset ready, render flush, then two animation frames from navigation start; it is not full Play interactivity or GPU-present instrumentation. See the earlier [methodology](../size-evaluation-2026-09-06/cold-start/README.md). No A10 or Quest device measurements were possible.

| Profile | Asset | Cache | 0.0.21 median ms | Updated median ms | Paired median delta ms | Mean delta 95% bootstrap CI |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| normal | card | cold | 126.6 | 123.3 | -4.2 | [-22.5, +0.8] |
| normal | card | warm | 129.2 | 129.4 | +0.1 | [-2.1, +2.8] |
| normal | dracoMain | cold | 168.3 | 162.7 | -4.4 | [-6.2, +1.1] |
| normal | dracoMain | warm | 145.8 | 145.7 | -0.3 | [-5.1, +4.8] |
| normal | dracoWorker | cold | 173.6 | 171.5 | -1.6 | [-3.6, +2.4] |
| normal | dracoWorker | warm | 146.0 | 146.0 | -0.0 | [-4.5, +5.8] |
| latency | card | cold | 1138.4 | 1140.1 | +2.7 | [-2.3, +4.3] |
| latency | card | warm | 162.6 | 162.6 | +0.0 | [-1.4, +5.1] |
| latency | dracoMain | cold | 1487.8 | 1507.5 | +21.8 | [+18.3, +25.5] |
| latency | dracoMain | warm | 196.0 | 195.3 | -0.1 | [-6.0, +0.6] |
| latency | dracoWorker | cold | 1280.2 | 1293.5 | +16.3 | [+12.3, +20.7] |
| latency | dracoWorker | warm | 212.5 | 212.7 | +0.1 | [-1.8, +3.9] |

The complete update is not a universal startup improvement. The larger codec adds a consistent constrained-network cold penalty: approximately +22 ms paired for small main-thread Draco and +16 ms paired for worker Draco. The card and warm scene-load measurements are broadly unchanged; local-run mean intervals cross zero. Accepting that roughly 1–1.5% cold-load penalty in these compressed fixtures buys approximately 22% less warmed raw decode/extraction time. This is an explicit throughput-versus-first-delivery tradeoff, and shader/rendering features are unchanged.

All benchmark navigations completed without page or HTTP errors. Pixel data in all three baseline/candidate screenshots is identical. Raw samples, paired summaries (including p95 and long tasks), scripts, and images are in `cold-start/`. Script paths default to the original workspace and temporary directories. Reproduction requires the saved 0.0.21 fixture under `/tmp/royal-dependency-cold-start/baseline/dist`; build the candidate with `ROYAL_BUILD_VARIANTS=candidate node setup.mjs`, start `server.mjs`, then run `run.mjs` and `python3 analyze.py results.json` with their configured absolute output paths.

## Verification

948 tests, type checking, lint, builds, packed consumer types/imports and exact golden geometry, adjusted size budgets, and ten Play/codec browser checks pass. The first smoke attempt targeted the old port 3002; the rebuilt-module assertion caught this. The complete ten-check run was repeated successfully against the temporary root `pnpm dev` server's actual port 3003. The user's Probability checkout was untouched. Final registry audit reports zero advisories.

This maintenance change does not publish a release; package version remains 0.0.21 pending a separately requested release.
