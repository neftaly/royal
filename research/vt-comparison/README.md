# VT follow-up — 2026-09-12

For retained behavior, current limitations, and how to interpret the evidence, start with the [current worktree guide](CURRENT.md).

The opening report below describes the initial September 12 checkpoint. Later
reports at the end of this file record further changes and rejected experiments;
their candidates are not all part of the retained renderer. See the
[retained checkpoint review](retained-checkpoint-review.md) for the combined
validation record and source hashes.

That initial follow-up completed the renderer-scene benchmarks, integrated mip filtering, exercised the
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

## Explicit raster-preview follow-up

The proposal review accepted required full-source combinations and explicit
raster preview intent. See [the implementation and measured review](raster-preview-results.md)
for the shared SVG/raster refinement path, bounded bitmap admission and the
headless host-GPU comparison against 56130d34. This is separate from the historical
release comparison above.

The subsequent [range-demand simplification](demand-range-results.md) removes
67 renderer lines, fixes independent-axis wrapping and measures reduced GC churn.
Both follow-ups remain uncommitted at the user's request.

[Cached vertex clipping flags](demand-flags-results.md) then reduce repeated
finite/plane checks with 256 bytes of fixed scratch. CPU and headless GPU results
are reported separately, including browser timing variance.

[Raster preview callback omission](raster-demand-callbacks-results.md) removes
unused SVG demand/cache callbacks from bitmap authority. A moving-camera audit
counts eliminated page-list allocations while verifying unchanged SVG behavior.

[Unchanged source-demand reuse](source-demand-publication-results.md) then avoids
republishing identical SVG page lists while preserving immutable lists for
asynchronous readers. The camera audit records 98.5% fewer SVG demand-list objects.

[Eligibility before cache probing](cache-probe-order-results.md) avoids cache work
for resident or blocked pages without adding source lines. The moving-camera
audit records 97% fewer decoded SVG cache lookups, with identical pixels.

[Warmed VT profiling](steady-profile-results.md) separates loading and diagnostics
from repeated frames and preserves source-mapped CPU/allocation samples. It
identifies pool-budget work as the next measured optimization target.

[Repeated live-scene retention checks](retention-results.md) disable profiling and
measure six consecutive windows. The initial heap increase tapers off in fixed
SVG, moving SVG and moving raster scenes.

[Pool-budget allocation](pool-budget-results.md) removes temporary filtered arrays
and Map entry pairs. Allocation results match 10,036 baseline cases; the warmed
host-GPU profile attributes about 59% less allocation to this helper.

[Stable atlas bookkeeping](stable-atlas-results.md) exits before unnecessary
migration calculations. Existing migration behavior passes 86 targeted tests and
24 headless host-GPU source cases, with identical comparison screenshots.

[Atlas membership and key experiments](membership-key-results.md) retains a simpler
membership scan with lower sampled allocation. A shorter atlas key was rejected:
real Map-lookup measurements showed more CPU and GC despite fewer source lines.

[Source replacement and cancellation](lifecycle-results.md) checks repeated unique
SVG/PNG sources and controlled fetch cancellation. Reported VT ownership releases
cleanly, while JS heap growth still needs longer-run retention investigation.

[Source identity retention control](identity-results.md) compares 96 replacements
with unique versus reused URLs. Their heap traces are nearly identical; the
remaining increase calls for heap-retainer inspection rather than a URL-cache fix.

[Lifecycle heap attribution](lifecycle-heap-results.md) identifies most retained
growth as V8 code and browser timing metadata. Source-like new objects are engine
literal templates; checked resource-wrapper counts remain flat.

[Late full-raster bitmap review](late-bitmap-review.md) tests marked ASTC 6x6/8x8
previews through removal and same-glTF replacement. Late bitmaps close once without
disturbing replacement residency or decode accounting.

[Real-browser AVIF authority review](avif-review.md) closes the mocked-decode gap:
32 source cases and six late-bitmap cases now include actual required AVIF with
ASTC previews, unsupported fallback, migration and context restoration.

[Failed native authority storage](authority-failure-review.md) fixes a reproduced
empty-atlas retention bug. Failed full sources preserve their native preview while
releasing unused VT storage and stopping detail demand; twelve GPU failure cases
and the full suite pass.

[Failed-authority context restoration](failure-restoration-review.md) verifies that
native previews return without new reads or VT allocations. All twelve failure
cases retain identical VT snapshots across loss/restoration.

[Versioned authority recovery](version-recovery-review.md) verifies that explicit
glTF version replacement clears a prior source failure through a fresh identity,
without enabling per-frame retries for the old version.

[Shared-atlas failure isolation](shared-failure-review.md) tests both resource
orders: failed authority releases its page table while the healthy neighbour keeps
its binding and residency, then the final owner releases the atlas.

[Failed-authority alias diagnostics](alias-failure-review.md) covers a later sampler
alias of an already-failed source: it reports the inherited failure without new
loads or GPU allocations.

[JPEG authority and metadata coverage](jpeg-review.md) extends the host checks to
core JPEG, including a frame header beyond the initial read window and delayed
bitmap delivery. All 44 source combinations and 10 bitmap lifetime cases pass.

[JPEG failure and recovery](jpeg-recovery-review.md) completes the expanded
20-case failure matrix: native previews survive, failed authorities retain no VT
atlas, and explicit version replacement recovers with one fresh source read pair.

[Steady diagnostic redraw](diagnostic-redraw-review.md) corrects a discarded-buffer
readback in the performance fixture. Earlier steady screenshot equality is not
visual evidence; refreshed profiles retain valid images and unchanged VT state.

[Rejected settled-budget early exit](settled-budget-review.md) records a one-line
experiment that helped minimum-only demand but repeatedly slowed active single-pool
allocation. The renderer is unchanged; the CPU benchmark now covers both demands.

[Large raster fitting](large-raster-review.md) verifies real 4096px PNG/JPEG
authorities: fitted browser bitmaps stay within the retained-source budget and
survive atlas resizing/context restoration with one decode and one source read.

[Large-authority contention](large-contention-review.md) checks two real decoded
sources competing for one root budget. The second keeps its preview without a
detail read, then promotes automatically after the first is removed.

[Simultaneous admission](simultaneous-contention-review.md) starts both large
authorities together in both scene orders. A fetch-level guard rules out transient
double admission before the winning texture releases capacity.

[Resident atlas-key reuse](resident-key-review.md) removes repeated JSON key
construction using existing GPU ownership. The helper benchmark improves with
no extra state and three fewer runtime lines; full-frame speedup is not claimed.

[Context loss during contention](contention-restore-review.md) checks the resident
key change with both large textures alive: retained detail restores, waiting
preview coverage remains bounded, and release still permits later promotion.

[Shared pool requests](pool-requests-review.md) updates one request per atlas pool
inside each frame. The 16-texture fixture shows reduced VT-update allocation with
unchanged median/p95 submissions and no increase in runtime line count.

[Rejected key-set usage marking](usage-keys-review.md) records a shorter loop
that improved isolated CPU tests but increased allocation in the browser's full
frame-preparation method. The original array loop remains in the renderer.

[Page-key boundaries](page-key-validation-review.md) adds parser regressions for
malformed coordinates, packed/string transitions and numeric keys beyond 32 bits,
without adding validation work to the frame loop.

[Idle cached-page scans](idle-scan-review.md) uses the scheduler's existing idle
counter to avoid repeated unsuccessful scans. Matched host runs improve submission
times with no additional state, runtime lines or size allowance.

[Idle-scan contention regression](idle-scan-contention-review.md) checks that
large sources still resume after memory release and context restoration, with
both ASTC block sizes and both simultaneous scene orders on the host GPU.

[Bounded UV tile traversal](bounded-tiles-review.md) fixes a demand-loop hang
when a repeating coordinate is too large for adding one to advance its tile
index, with two additional renderer lines and measured ordinary-demand cost.

[Coarsest fallback overflow](coarsest-overflow-review.md) stops malformed-UV
fallback traversal when demand capacity is exhausted, including authored mip
chains whose coarsest level still contains many pages.

[Indeterminate derivative fallback](derivative-overflow-review.md) preserves
coarse coverage when finite UVs overflow derivative arithmetic, with isolated
CPU/allocation checks and a matched headless host-GPU profile.

[Shared raster cancellation](shared-raster-cancellation-review.md) verifies that
cancelling a pending page read leaves another consumer of the same lazy image
usable and allocates no canvas for the cancelled request.

[Rejected lazy compressed-atlas set](lazy-compressed-review.md) records a small
sampled allocation reduction that did not justify code and bundle growth; the
original runtime remains in place.

[First texture presentation](first-presentation-review.md) measures small native
previews against full PNG loading, separating first visibility from later raster
refinement and repeating the comparison in a fresh headless browser.

[First-presentation decode audit](first-presentation-decode-review.md) records
the different bitmap sizes and resize costs behind those timings, preventing
an equal-output decoder-speed interpretation.

[Direct versus staged PNG resizing](bitmap-resize-review.md) isolates that resize
cost with matching output sizes and quality settings. Staging was slower and
held an additional returned bitmap, so the production path remains unchanged.

[ETC2 unsupported-device parity](etc2-unsupported-review.md) extends the native
VT regression matrix to the root-supplied ETC capability path, with no page
downloads, allocations or frame exceptions when unavailable.

[Rejected admission request loop](admission-loop-review.md) records a
filter/map-to-loop experiment that increased isolated CPU cost and allocation
attributed to the browser frame update. The original code remains in place.

[Material-role sharing](preview-role-sharing-review.md) checks one glTF texture
index reused across preview-enabled and ordinary roles, preserving decoded-pixel
sharing where appropriate while keeping preview recipes separate.

[Large rectangular authorities](rectangular-raster-review.md) exercises portrait
and landscape PNG/JPEG fitting and refinement with both ASTC preview sizes,
including atlas resizing and context restoration without repeated source reads.

[Rectangular page crops](rectangular-page-crops-review.md) adds spatial checks
with coordinate-coded artwork across wrap modes, mips and gutters. An isolated
wrong-axis mutation confirms that the check detects scale errors.

[Viewport-origin demand reuse](viewport-origin-review.md) removes origin-only
invalidation and shrinks view scratch while retaining matrix and size changes,
with runtime regressions, an independent cache oracle and host profiles.

[Native color-space rollback](native-color-rollback-review.md) checks that an
incompatible storage interpretation releases its attempted allocation while
preserving an existing valid native texture across all supported ASTC/BC formats.

[Retained code cost](retained-code-cost-review.md) records the current source-line
delta and size ceilings separately from research code and already-committed
native-format support.

[Native color-space sharing review](native-color-sharing-review.md) records a
confirmed first-claim failure-isolation limitation using the real decoder and
source owner; it remains unresolved and is not covered by GPU rollback tests.

[Pool finalization review](pool-finalization-review.md) retains a one-line
aggregation change: repeated isolated CPU savings, 10,000 equivalence cases,
full regression checks, and no general frame-time or GC improvement claim.

[Mixed native/image pool review](mixed-pools-review.md) verifies both insertion
orders at 256 MiB and reproduces existing RGBA-pool starvation at 16 MiB before
and after pool finalization. Initial fixed native allocation remains a concrete
unresolved budget-fairness issue.

[Rejected initial native-pool sharing](mixed-fairness-candidate-review.md) passed
synchronous format tests but failed the real mixed-source GPU fixture; pending
SVG preparation is not covered by sharing only currently known pool requests.

[Pending automatic-source reservation](pending-reservation-review.md) resolves
the 16 MiB mixed SVG/ASTC starvation with coarse coverage in both GPU insertion
orders. It adds one runtime line, passes 1,305 tests and existing size ceilings,
and leaves fixed-native migration and sources added later as explicit limits.

[Pending-reservation lifecycle review](pending-reservation-lifecycle-review.md)
checks removal, ineligibility and actual GPU context restoration. Both mixed-pool
insertion orders recover at 16 MiB; 104 relevant runtime tests pass.

[Terminal-failure reservation release](failed-reservation-review.md) fixes
failed decodes retaining pending VT space. Both GPU insertion orders and the
44-case matrix pass; full suite 1,309 tests. The three-line correctness fix has
named 160-byte package and 8-byte total gzip allowances.

[Rejected native-minimum accounting change](native-minimum-review.md) reduced
isolated native aggregation cost but did not improve image aggregation
consistently. The retained runtime was restored; no size allowances changed.

[Native KTX2 container review](native-container-review.md) adds subview boundary,
zero-copy mip ownership and duplicate-metadata regressions for ASTC and BC.
A weakened-bound mutation is detected; all 59 relevant tests pass after restore.

[Malformed native-page lifetime](malformed-native-page-review.md) checks six
formats for bounded failure, no invalid upload, version recovery and scene
cleanup. Full suite passes 1,325 tests; allocated-but-unused atlases remain an
explicit policy limitation while failed authored sources stay in the scene.

[Empty failed-atlas reclamation](empty-failed-atlas-review.md) releases unusable
storage without discarding healthy neighbors. The 16 MiB GPU fixture frees
about 10.9 MiB of accounted atlas storage and restores healthy detail; 1,329
tests and the 44-case GPU matrix pass. The fix adds 14 runtime lines.

[Wrapped UV division experiment](wrap-divisions-review.md) rejects explicitly cached divisions after equivalent demand results but no consistent CPU improvement.

[Native page color-space failure containment](native-color-failure-review.md) prevents incompatible page storage from escaping into frame upload and retrying indefinitely.

[Failed native page retention](native-failure-retention-review.md) records stable backing storage and request counts; a twelve-window follow-up reaches a plateau and attributes most growth to engine code/metadata.

[Native page CPU preparation](native-page-read-review.md) measures fresh in-memory page reads for all six native formats in headless Chromium, including validation and GC.

[Native container retention gap](native-container-retention-review.md) records the original padded-container retention finding, now addressed by exact block compaction.

[Exact native page backing storage](native-page-compaction-review.md) fixes padded-container retention with one net production line; includes browser retention evidence, normal-read timing tradeoffs, and GPU restoration.

[Constructor-copy experiment](native-copy-review.md) keeps the existing block copy after isolated gains failed to yield a consistent full-read benefit.

[Early zero-demand allocation skip](zero-demand-review.md) is not retained after mixed CPU screening across absent and existing pools.

## Three adversarial-review fixes

[Review and validation](three-review-fixes.md): constant-time removal of interior
cancelled jobs, ordinary texture budget recovery after unsupported authored VT,
and coarse intermediate migration to resolve blocked atlas growth. Both delayed
ASTC sizes now recover all 336 pages before and after context loss. Changes remain
uncommitted.

The [final pre-commit review](precommit-review.md) fixes a reentrant scene-budget
reservation race and records the 1,505-test validation checkpoint.
