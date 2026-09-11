# Many-light investigation, 2026-09-11

Work follows the clean Royal 0.0.25 release (`f017d692a5acf9decfd7d157b7ee327bb04e2236`).
The `many-lights-prototype` branch implements an automatic, lazy texture path for
up to **512 combined directional, point and spot lights**. This is an intermediate
finite limit, not completion of the unlimited-light proposal or a frame-rate
promise. Spatial lists remain an experiment outside the renderer.

## Decision supported by the measurements

Keep the existing exact-count uniform shaders for at most four directional and
eight local lights. Above either threshold, load one module, pack all canonical
lights into a root-owned RGBA32F texture, and reuse Royal's material and light
loops. A single shader family uses runtime counts rather than compiling a
variant for every larger count. The 513th active light fails explicitly during
lowering; imported instances count individually. Lights omitted by
`importLights: false` retain their existing behavior.

A10 Safari supports a 16 KiB uniform block, which fits only 256 of these 64-byte
records. Quest 2 exposes 64 KiB. Both devices successfully rendered 512 records
from the texture. This makes a data texture a simpler common transport for the
requested 256+ target. Multiple UBOs could raise the UBO ceiling, but introduce
another selection/storage policy and do not reduce per-fragment light work.

The initial texture holds 256 records (16 KiB), grows to 512 (32 KiB), and retains
capacity until the scene returns to the small path. Growth reserves the old plus
new GPU storage before replacement, so that transition requires 48 KiB of light
storage temporarily. Uploads use the frame upload budget and retain canonical
order. Allocation denial and module failure are visible failures, not dropped
lights. Upload errors are checked before publishing counts or retiring previous
storage. Context restoration rebuilds from the current canonical scene.

Directional and missing-range local lights are global. Dense bounded lights may
also affect every tile. Those cases remain expensive even with a spatial list.
The measurements favor investigating conservative tile lists for sparse bounded
lights, with the exact global loop as a storage-overflow fallback. No finite
influence radius is inferred for a missing glTF range.

## Physical devices and transport comparison

- iPad7,6, A10, iOS 17.7.11 Safari; `Apple GPU`, 16 fragment texture units,
  16,384 maximum texture dimension, 16,384-byte maximum uniform block.
- Quest 2 browser; `Adreno (TM) 650`, 16 fragment texture units,
  8,192 maximum texture dimension, 65,536-byte maximum uniform block.
- Both devices returned no `EXT_disjoint_timer_query_webgl2` support.

The table reports milliseconds per draw from **batched submission to fence
completion**, divided by four. These are 1024×1024 full-screen synthetic draws,
nine samples after warmup. They include CPU/fence polling overhead, are not exact
GPU timings, and cannot be converted into application/XR frame-rate guarantees.

| Device, 256 lights | Global texture | UBO | Orthographic tile list |
| --- | ---: | ---: | ---: |
| iPad directional | 46.75 | 39.75 | 52.75 |
| iPad sparse bounded | 91.75 | 53.25 | 7.50 |
| iPad dense bounded | 91.50 | 58.25 | 97.25 |
| iPad mixed | 82.25 | 50.25 | 15.25 |
| Quest directional | 67.38 | 73.17 | 72.93 |
| Quest sparse bounded | 90.03 | 79.57 | 5.30 |
| Quest dense bounded | 94.43 | 87.05 | 106.27 |
| Quest mixed | 85.83 | 78.40 | 19.23 |

See [iPad 1024 results](ipad-1024-results.json) and
[Quest 1024 results](quest-1024-results.json). The 256×256, batch-16 measurements
are in [iPad batched results](ipad-batched-results.json) and
[Quest batched results](quest-batched-results.json). Small sample p95 values are
order statistics, not a statistical tail estimate. The initial unbatched Quest
run has coarser timer quantization and predates the independent CPU oracle;
retain it as preliminary evidence only.

The timed list builder in these runs uses conservative orthographic XY sphere
bounds across all fragment depths. It is not a production Forward+ implementation.
Lists preserve order and never truncate a tile. The later `view-lists.mjs`
experiment constructs clip-space tile frusta for perspective, orthographic and
asymmetric stereo projections, with no opaque-depth assumption. Its independent
point-in-sphere/projected-pixel checks exercise conservative coverage, global
lights, near-plane intersections and explicit storage exhaustion. The corresponding full-shader experiment passes 216 software pixel comparisons
across orthographic and asymmetric stereo projections, three depths and explicit
storage-overflow fallback, with exact pixels. This does not establish production
integration or useful device frame cost.

## Correctness and integration

`probe.mjs` uses Royal's actual BRDF with a simplified material/plane fixture.
Texture, UBO, small uniform and tiled transport outputs are compared pixel by
pixel at three depths. Texture results also check sampled pixels against an
independent JavaScript double-precision BRDF implementation. Fixtures include
zero lights, the final light as the only active light, directional, bounded point
and spot, missing range, mixed and dense overlap. The comparison tolerance is
2/255 per channel; transport comparisons on both devices were exact.

`material-probe.ts` uses the full Royal fragment shader with opaque, blended,
masked, normal, metallic/roughness, specular, emissive and combined material cases,
and both tone mappings. Repeating four reference lights with scaled intensity
produces 256 and 512 lights with the same mathematical contribution. All 48
cases passed on software, iPad and Quest, with maximum difference 1/255. These
cases do not cover transmission, volume or environment textures.

`integration-probe.ts` exercises actual renderer roots and `captureImage`,
including retained geometry, small/large transitions, opaque and overlapping
transparent mixed-light scenes, texture growth, removal and context restoration.
The 21 software cases pass both as source modules and as a self-contained bundle.
The self-contained bundle inlines optional modules for Safari inspector injection;
it cannot establish network lazy-loading behavior.

Review found two readiness omissions: retained geometry could be captured before
large-light upload, and transparent scenes could be captured before the lazy
linear compositor arrived. Both now participate in renderer readiness. Unit
regressions cover these cases. The latter also affects ordinary small-light
captures and is not a light-transport failure.

Actual asynchronous GLB tests also cover 512 imported lights, object-handle
translation/rotation, bulk instance pose updates, and import opt-out. These found
that a temporarily unilluminated standard scene incorrectly required uniforms
that the shader compiler removes. Such scenes now preserve emissive and alpha
without requiring unused BRDF uniforms. The richer glTF fixture combines
transmission, volume, shared specular/normal/emissive textures, environment light
and automatic virtual texturing; all eight software comparisons pass exactly.

The built-package test caught and fixed a separate formatting assumption in the
lazy shader adapter: production GLSL removes whitespace around loop conditions.
`run-package.mjs` now exercises the built renderer and capture entrypoints,
verifies no optional-light request for the first small scene, and requires exactly
one lazy chunk request across the complete large-light sequence and restoration.

Ownership tests cover stale module completion, scene replacement during import,
small/large/small generations, failed imports and recovery, frame admission,
GPU-budget denial, failed replacement cleanup and context recovery. Capture can
retry a valid replacement immediately after an allocation failure; it first lets
the replacement frame clear the old diagnostic. Canonical
lowering tests accept 512 mixed lights and 512 imported instance lights and reject
the 513th. The unchanged small-light behavior remains covered by the full suite.

## Bundle cost

The final measured Royal fixture is 142,531 initial gzip bytes, 126,727 lazy gzip
bytes and 269,258 total gzip bytes. Worker bytes are a subset of the lazy total.
The initial increase over the recorded 0.0.25 baseline is 974 gzip bytes; the lazy
increase is about 1.6 KiB. Named size allowances keep these additions reviewable.
The isolated activation/runtime measurement is not an integrated delta: its
819/1,694 gzip bytes must not be added to the fixture totals.

## Reproduction and remaining acceptance work

Run from the repository root with the normal dependencies installed. These
research files are not package entrypoints. USB browser access requires the
owner's authorization. Device identifiers and browser target IDs are intentionally
not part of the fixtures.

```sh
# Serve source on localhost; Quest uses adb reverse for the same port.
pnpm dev --host 127.0.0.1 --port 4583 --strictPort
# Local software correctness, not physical GPU throughput.
LIGHTS_OPTIONS='{"size":64,"samples":3}' node research/many-lights/run-cdp.mjs
# Actual Quest browser target, after adb forward of its inspector to 9222.
LIGHTS_CDP_PORT=9222 LIGHTS_REPORT=/tmp/quest-lights.json node research/many-lights/run-cdp.mjs
# Fresh Safari automation tab through pymobiledevice3; no LAN server exposure.
python research/many-lights/run-ipad.py
# Built-package lazy loading and renderer parity (requires package build).
node research/many-lights/run-package.mjs
# Independent conservative perspective-list checks.
node research/many-lights/view-lists.test.mjs
# Build the self-contained actual-renderer probe for Safari injection.
node research/many-lights/build-integration.mjs
LIGHTS_INLINE_FILE=/tmp/royal-many-light-integration/probe.js python research/many-lights/run-ipad.py
```

`soak.mjs` repeats 512×512 comparisons for 90 minutes, checking parity every cycle,
keeping the texture reference first, rotating the remaining mode order and
disposing each context. `frame-probe.ts` measures animated
actual-renderer RAF pacing. `xr-probe.ts` uses an actual immersive session and
records frame intervals separately from CPU submission duration. Device results
and final sustained-run conclusions are recorded after those runs complete.

Before the unlimited proposal can be accepted, a spatial path still needs full
material/XR integration, list-upload budgeting, correct changes after object and
camera movement, representative Play workloads and explicit dense/global
fallback costs. No hardware-accelerated desktop is available in the current
sandbox; software results are labeled accordingly. Shadow maps remain separate.


## Sustained device results

Both 90-minute 512×512 transport soaks completed: 382 cycles on the A10 iPad and
192 on Quest 2, with zero pixel differences between supported transports in every
cycle. Full evidence is preserved in `ipad-soak-results.json.gz` and
`quest-soak-results.json.gz`; `summarize-soaks.py` produces `soak-summary.json`.
The single-block 512-light UBO case is explicitly unsupported on the iPad.

Global-texture completion medians were stable between the first and last quarter:

| Device | 512-light fixture | First quarter ms/draw | Last quarter ms/draw |
| --- | --- | ---: | ---: |
| A10 iPad | Directional | 6.188 | 6.187 |
| A10 iPad | Dense local | 11.750 | 11.812 |
| Quest 2 | Directional | 32.697 | 32.669 |
| Quest 2 | Dense local | 46.166 | 46.147 |

These are batched fence-completion timings, not GPU timer-query results or an XR
frame-rate guarantee. They show no material sustained slowdown in this fixture;
they do not establish a temperature-controlled thermal characterization.

Quest's final actual-renderer acceptance passes all 326 cases across seven groups:
21 integration/context-restoration, eight glTF import/pose, 48 material, one budget
recovery, 216 conservative view-list, eight rich material and 24 frame-pacing cases.
The view-list experiment initially failed on Adreno with dense lists because its
CSR offsets exceeded default fragment integer precision. Explicit `highp int`
fixes that research-only shader; software rendering had not exposed the error.
This is a prerequisite for future spatial integration, not a production global
light-table change.

The Quest 2D browser fixture has a roughly 33.4 ms baseline RAF interval. At
1024×1024, 256 overlapping point lights reached 100.2 ms median / 167.0 ms p95,
and 512 reached 200.4 / 267.3 ms. Thus 512 is a finite composition/storage ceiling,
not a recommended active-light budget. A useful limit depends on coverage,
material cost, resolution and global versus bounded local lights. Spatial lists
remain justified for finite sparse local lighting; they cannot rescue arbitrary
numbers of globally contributing lights.


The actual immersive attempt could not complete: Quest displayed “Finding
position in room” and the session request timed out. No XR throughput result is
claimed. The viewer-space runner remains available for a tracking-ready headset.
Quest's built-package probe separately passes all 21 integration cases and
observes exactly one optional light chunk request, with none for the initial
small-light scene. The iPad's injected bundle inlines optional code and cannot
prove network lazy loading.


The A10 iPad also passes all 326 acceptance cases. Its actual animated 1024×1024
MSAA fixture is substantially slower than the simplified transport plane: at
256 lights, directional pacing is 443 ms median / 457 ms p95 and point pacing is
657 / 665 ms. At 512 point lights it is 1,274 / 1,279 ms (only three measured
intervals). CPU submission medians remain about 1 ms. These short high-cost cases
have too few samples for robust tail estimates. Do not extrapolate the simplified
BRDF transport timings into an application performance promise. This is another
reason to keep the finite implementation as a draft pending workload and spatial
optimization, while retaining the useful glTF/capture correctness improvements.


The physical two-block UBO follow-up passes exact parity on both devices. At
1024×1024 with 512 dense local lights, the A10 completion median is 123.5 ms with
two UBOs versus 180.25 ms with the texture. Quest is 179.45 versus 184.90 ms; its
directional case instead favors texture (131.23 versus 151.40 ms). This supports
keeping multi-block UBOs as a concrete alternative, not dismissing them based on
the single-block iPad limit. These are simplified transport results; changing the
production transport still requires the full material/ownership acceptance suite.

Disabling MSAA in a separate iPad actual-renderer run reduces the 256-directional
median from 443 to 134 ms and the 256-point median from 657 to 185 ms. Four-light
baselines are 17 ms without MSAA, while 16-directional/point are 28/30 ms. MSAA
therefore contributes substantially but does not explain all of the high-count
cost. The renderer default is unchanged; this diagnostic is not a recommendation
to silently reduce consumer rendering quality. See
`ipad-no-msaa-frame-results.json` for the eight measurements.

## Full shader transport and CPU list follow-up

`full-shader-transport.ts` compares the actual complete opaque fragment shader's
high-precision texture fetches with two uniform blocks. It separates MSAA and
single-sample cases and checks pixel parity before timing batched completion.
On Quest, the single-sample 512-point case favors texture (164.20 ms/draw) over
UBOs (220.27 ms/draw); the MSAA case is 169.88 versus 228.53. All 32 Quest cases
pass. This reverses the slight UBO advantage in the simplified local-light
transport fixture, demonstrating why that fixture alone cannot pick a production
transport. This follow-up excludes scene traversal and material textures.

The original conservative CPU list builder also needs optimization before
integration. `view-lists-fast.mjs` reuses a typed plane workspace and removes
per-candidate closures and array traversal. Eighty randomized exact comparisons
preserve every CSR word and budget-exhaustion decision. The paired browser
benchmark alternates implementation order. Quest's 16×16 sparse 512-light median
falls from 20.0 to 5.5 ms, with identical output. Dense 512 falls from 21.4 to
7.7 ms. These results still exclude upload and shading, and require further
scene/view caching and dense/global fallback policy before production use.

The iPad's single-draw 512-light MSAA diagnostic passes all four full-shader
comparisons. Texture/UBO medians are 1,440/1,405 ms for directional and
2,152/1,950 ms for point lighting. The full shader therefore shows only modest
transport gains, unlike the simplified transport fixture. An earlier long,
four-draw-batch iPad run returned an opaque Safari exception and did not complete;
its timings are excluded. The smaller diagnostic passes, but does not establish
the cause of that exception or prove a GPU watchdog timeout.

A separate shader-family experiment removes the inactive directional/local loop
and compares pixels against the unchanged combined shader. Both devices pass
within one channel value. The iPad texture medians remain about 1,445 ms for
directional and 2,152 ms for point lighting. There is no compelling gain here to
justify additional production shader families; the working implementation keeps
one large-count family. These diagnostic runs use only three samples and one draw
per batch, so they are not interchangeable with the longer batched timing runs.

`view-lists-factored.mjs` makes a larger exact algorithmic improvement: each sphere
is tested against column, row and depth planes once, then the surviving row/column
combinations produce the same CSR lists in source order. It avoids repeating the
same plane tests for every tile. The two-pass fill adds a mask workspace and tile
cursors; at 512 lights and a 16×16 grid these plus plane coefficients consume
20,048 bytes beyond the CSR allocation. Production integration must account for
this CPU workspace and reuse it rather than treating it as free.

| Device, 16×16 grid, 512 lights | Reference ms | No candidate allocations ms | Factored ms |
| --- | ---: | ---: | ---: |
| iPad, sparse | 146 | 119 | 11 |
| iPad, dense | 312 | 258 | 13 |
| Quest, sparse | 19.2 | 4.7 | 1.4 |
| Quest, dense | 21.5 | 7.6 | 2.7 |

These are paired 15-sample CPU measurements with rotating implementation order,
not frame times. Exact randomized comparisons cover 80 inputs including resource
exhaustion; the device benchmarks also compare every emitted CSR word. Both devices'
216 pixel cases pass with the factored builder. Even after this improvement,
11 ms of CPU list building alone is substantial on the iPad. Per-view caching,
motion invalidation, upload budgeting and an inexpensive global/dense path are
still required before integrating spatial lighting into the renderer.

## Browser ownership in research runners

`run-cdp.mjs` (including `run-package.mjs`) and `run-xr.mjs` create a new
research tab, navigate only that tab and close it afterward, including on
failure. They fail if the browser cannot create a target; they never fall back
to an existing tab. Cleanup verifies closure and reports failures. Externally
connected browsers remain running.

## Equal-count mode overhead and zero-contribution rejection

The follow-up `light-rejection.ts` uses the complete opaque material shader to
compare the existing large-light texture transport, an experimental early exit
for exactly zero local-light contribution, and exact-count uniform shaders for
counts up to 16. Uniform counts above the shipping small-path limits are research
comparators only. No production rendering behavior changes in this experiment.

Both physical devices pass 44 local-light and 15 directional comparisons at
512×512 without MSAA. Texture/reference versus rejection pixels are identical;
uniform comparisons differ by at most one channel value. Nine samples of eight
draws measure submission-to-fence completion divided by eight, not application
frame time. Mode order alternates by count, not by sample. Timer quantization,
fixed within-case order and short runs limit close comparisons.

At five directional lights, the existing texture and forced uniform paths are
both about 1.05 ms on Quest and 0.625 ms on iPad. Four/eight dense point lights are
also similar across transports. These fixtures provide no evidence of a large
performance cliff caused solely by crossing the lazy-path threshold. They do not
measure first-load network or shader-compilation latency.

For 256 lights, the experimental range/cone rejection gives these completion
medians (ms/draw):

| Device / distribution | Existing | Rejection |
| --- | ---: | ---: |
| iPad sparse bounded | 9.375 | 4.000 |
| Quest sparse bounded | 18.463 | 7.188 |
| iPad dense unbounded | 9.250 | 9.250 |
| Quest dense unbounded | 18.463 | 20.063 |
| iPad spot | 12.125 | 9.250 |
| Quest spot | 23.075 | 14.350 |

The sparse improvement is promising, but the roughly 9% dense Quest regression
means the rejection shader is not adopted universally. The production shader is
unchanged. Spatial lists remain the next larger opportunity for bounded lights;
directional and unbounded lights still require their contributions to be shaded.

Evidence: [iPad local](ipad-light-rejection-results.json),
[Quest local](quest-light-rejection-results.json),
[iPad directional](ipad-light-threshold-results.json),
[Quest directional](quest-light-threshold-results.json).

Build with `node research/many-lights/build-light-rejection.mjs`. Set
`LIGHTS_INLINE_FILE=/tmp/royal-light-rejection/probe.js` for the existing device
runners. Local comparisons use
`LIGHTS_OPTIONS='{"size":512,"counts":[4,8,16,256],"samples":9,"batch":8}'`;
directional comparisons use
`LIGHTS_OPTIONS='{"size":512,"counts":[4,5,8,9,16],"kinds":["directional"],"samples":9,"batch":8}'`.
Use a separate `LIGHTS_REPORT` destination for each run. The research build and
research TypeScript check pass. Review confirmed that the candidate only skips
contributions already zero under the existing attenuation formula, retains
missing-range lights, and does not alter production or small-scene shaders.

## Dense-regression follow-up: integrated scalar gate

The subsequent fix uses a zero attenuation value to mask `normalLight` to zero
inside the existing BRDF early-return test. It adds no loop `continue`, keeps
light order and accumulation unchanged, and passes a constant one for directional
lights. The lazy adapter defines `LARGE_LIGHT_ZERO_REJECTION`; small-light shaders
compile the added blocks out. Removing those blocks reproduces the committed
pre-change shader byte-for-byte, also preserving the benchmark's old reference.

This is a more conservative optimization than the original rejection experiment.
It reduces, but does not universally eliminate, its dense-scene cost. The exact
integrated shader versus the pre-change reference measured:

| Device / 256 lights | MSAA | Reference | Integrated | Change |
| --- | --- | ---: | ---: | ---: |
| Quest dense unbounded | off | 18.063 | 18.513 | +2.5% |
| Quest dense unbounded | on | 18.463 | 18.475 | approximately unchanged |
| Quest dense bounded | on | 18.488 | 18.463 | approximately unchanged |
| Quest sparse bounded | on | 18.488 | 15.387 | -16.8% |
| Quest spot | on | 23.087 | 18.475 | -20.0% |
| iPad dense unbounded | on | 275.0 | 276.5 | +0.5% |
| iPad dense bounded | on | 275.0 | 275.0 | unchanged |
| iPad sparse bounded | on | 275.5 | 274.0 | -0.5% |

Values are 512×512 batched fence completion normalized by submitted draws.
Quest uses ten samples/batches of eight; iPad uses six samples/batches of two.
Mode order rotates within every sample. Compare modes within the same run;
absolute normalized values vary substantially with batching and do not represent
application frame time. The iPad gain is marginal and the remaining 2.5% Quest
non-MSAA dense cost is not described as a complete regression elimination.

Both final 16-case device matrices have zero pixel differences. Earlier broader
60-case matrices per device covered mixed and dense-spot scenes for the BRDF
predicate candidate; those are exploratory evidence, not validation of the final
scalar gate. Other candidates included a guarded call, combined BRDF predicate,
explicit weight early return, masked direction and a per-light function. The
larger sparse gains retained larger dense regressions; they remain research only.
The results are saved under `*-rejection-*-results.json`, with final evidence in
[iPad integrated results](ipad-rejection-production-results.json) and
[Quest integrated results](quest-rejection-production-results.json).

Reproduce the final probe with `variants:["reference","production"]`,
`counts:[256]`, `kinds:["dense","dense-bounded","sparse","spot"]` and
`antialiasModes:[false,true]` in `LIGHTS_OPTIONS`, using the build and device
runners above. Previous variants remain available for comparison. Inputs require
an explicit original reference and reject unknown variant names.

Verification: 53 targeted tests, 21 built-package integration cases, 48 material
comparisons, package build, lint, research typecheck and bundle-size gate pass.
The bundle budget records a 100-byte gzip allowance for this change. The follow-up
review checked exact-zero behavior, directional calls, disabled small-path blocks,
compressed production shader compilation and truthful benchmark baselines. The
remaining dense cost and lack of a useful iPad speedup are known limitations.
