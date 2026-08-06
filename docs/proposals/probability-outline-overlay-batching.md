# Automatically batch exact-compatible glTF outlines

## Consumer evidence

Probability Play presents drag intent as displaced `outlineGltf` occurrences.
The document geometry remains stationary; local presence changes only the
overlay transforms. This is the intended Royal overlay model, not a copied
application mesh path.

An isolated local benchmark imports the 73-piece Bus fixture, marquee-selects
72 pieces, then performs 120 paced pointer moves before mouse-up. It closes the
sync WebSocket, records actual WebGL submissions, and excludes the drop.
Probability first removed 71 redundant per-piece movement rulers in favour of
one formation ruler; exact destination outlines for all 72 pieces remain.

With the reduced application overlay and a freshly restarted Royal 0.0.6 dev
server, the original isolated run measured:

| median frame interval | p95 frame interval | submissions/frame | long-task time |
| ---: | ---: | ---: | ---: |
| 116.70 ms | 333.24 ms | 220.95 | 8.94 s / 30.21 s |

The settled world scene is already automatically instanced: the adjacent map
camera measurement uses about 62 submissions/frame. The moving overlay uses
26,735 submissions across 121 submitted frames. Its remaining count is
consistent with three mask primitives per outlined card, the shared two-mesh
movement guide, and small fixed scene overhead. A 0.0.6 CPU profile attributes
about 1.3% of samples to Probability's stacking and scene projection combined;
browser/GPU waiting and Royal's render path dominate. The reproducible
artifacts are:

- `/tmp/probability-drag-royal-0.0.6-fresh.json`
- `/tmp/probability-drag-royal-0.0.6-fresh-drag.cpuprofile`
- `probability/research/benchmarks/large-tabletop/large-tabletop-bench.mjs`

## Requested renderer behaviour

Please evaluate automatically lowering adjacent exact-compatible
`outlineGltf` occurrences into instanced mask submissions. This should be a
renderer optimization of the existing descriptor, not a Probability-specific
selection API and not an application-owned copy of glTF geometry.

Compatibility can be decided only after each outline has resolved its exact
source occurrence. Candidate outlines must agree on the resident geometry and
draw state required by the edge mask, including primitive topology/indexing,
active LOD, handedness, edge material/pattern lane, and any boundary/crease
inputs. Different source assets may join only when Royal's existing exact
cross-root geometry identity proves them compatible. Authored overlay order
must remain observable when incompatible nodes or materials separate groups.

The instance lane needs a distinct occurrence value for every member wherever
the mask relies on occurrence boundaries. `gl_InstanceID` plus a retained
batch allocation appears sufficient in principle, but that is an implementation
hypothesis for Royal to review. Picking is irrelevant because overlays remain
non-picking.

Frequently replaced overlays should reuse the compatible batch allocation and
update its packed presentation transforms instead of rebuilding GPU geometry.
Source transforms still identify the stationary world occurrences exactly;
presentation transforms remain independently displaced. Missing, ambiguous,
inactive-LOD, or failed source occurrences must retain current explicit
failure behaviour rather than entering a guessed batch.

## Success criterion

The same 72-piece drag should scale with the number of compatible primitive
cohorts, not the number of outlined occurrences. The important measurements
are median/p95 frame interval, submissions/frame, long-task time, and exact
visual equivalence for boundaries, creases, overlaps, displaced transforms,
mixed handedness, LOD, and cross-root geometry sharing. Do not accept a change
that merely coalesces frames while leaving hundreds of submissions in each
displayed frame.

The single-piece control is 7.95 submissions/frame for the complete overlay
pipeline. The Bus group has a small number of physical geometry cohorts, so a
successful result should be in the low tens rather than the current 220.95;
the exact value must follow compatibility and correctness, not a forced draw
budget.

## Probability prototype evidence

The local branch `probability-outline-batching`, based on Royal 0.0.6 commit
`bf0075da`, implements this as an internal lowering optimization. It borrows
the exact resident geometry for single-primitive batches. Repeated compatible
multi-primitive occurrences retain one combined occurrence-major position/index
allocation so the primitive sequence still precedes the next occurrence. The
renderer groups only exact geometry sequences and handedness, uploads all hot
presentation transforms once per overlay run, and issues one instanced mask
draw per cohort. It does not add a public API.

A clean release/prototype A/B was then run back-to-back with the same fixture,
viewport, browser, SwiftShader device, machine load, and benchmark revision:

| Royal | median frame | p95 frame | callback median | callback p95 | submissions/frame | long-task time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.0.6 release | 199.99 ms | 500 ms | 7.2 ms | 105.1 ms | 220.97 | 10.49 s |
| prototype | 183.40 ms | 500 ms | 4.8 ms | 97.7 ms | 10.97 | 10.18 s |

The submission reduction is decisive and the same-run frame result is a
modest improvement, not a solved drag path. The remaining time scales with
mask geometry/raster work on SwiftShader rather than Probability's drop or
presence core. Retain the prototype only if Royal's visual/lifecycle review
accepts its ordering and borrowed-buffer ownership; do not infer a real-device
GPU result from the software renderer timings.

The corresponding artifacts are:

- `/tmp/probability-outline-release.json`
- `/tmp/probability-outline-batch-v2.json`

The reviewed occurrence-major path reduces the same isolated Bus drag to 836
submissions across 120 submitted frames, or 6.97 submissions per frame. Its
headless frame timings are not device evidence: a contemporaneous single-piece
control was equally slow under the contended software renderer. The structural
submission result is retained in `/tmp/probability-outline-owned-combined.json`.

A physical Safari 17.14 pass on Apple GPU then marquee-selected 72 objects in
the Probability Settlers fixture and kept all 72 selected during 120 displaced
drag frames at a 2048-by-1008 backing size and DPR 2. The path submitted 1,902
draws across 119 drawn frames, or 15.98 per frame, with no WebGL error before or
after the run. Input handlers stayed at or below 1 ms p95. Frame intervals were
79 ms median and 90 ms p95, so this is correct low-tens submission and visual
evidence on the A10-class floor, not a claim that the complete use case now
meets a 60 Hz frame budget. The displaced capture and report are
`/tmp/probability-ipad-outline-batching.png` and
`/tmp/probability-ipad-outline-batching.json`. The optional batch shader and
combined allocation both fail closed to ordinary ordered draws; the latter is
budgeted only after required overlay targets.

The completed renderer path adds 3,142 initial gzip bytes over an exact 0.0.6
rebuild (134,611 bytes current versus 131,469 bytes at `bf0075da`). The packed
renderer adds 13,098 bytes over the published 0.0.6 tarball (635,613 versus
622,515 bytes). Both release gates record the exact 0.0.6 reference; their
allowance names batching and bounded screen-space presentation rather than
hiding the added path inside an unrelated ceiling.

A subsequent physical Quest 2 pass used Meta Browser 149 and Adreno 650 in an
immersive 120 Hz session. A matched lab rendered 72 automatically instanced
opaque Box glTF occurrences, first without an overlay and then with 72 displaced
outlines sharing one selection material. The baseline submitted 2 draws per XR
frame and measured 8.36 ms median / 10.05 ms p95 frame intervals. The outline
run submitted 8 draws per frame and measured 21.33 ms median / 40.84 ms p95,
with no page or WebGL errors in either run. The two additional instanced draws
are one batched outline mask per eye; four full-screen presentation draws make
up the rest of the six-draw delta. Reports are
`/tmp/royal-quest-box-outline-xr-baseline.json` and
`/tmp/royal-quest-box-outline-xr-overlay.json`.

An independent repeat preserved the structural result exactly: 2 submissions
per frame without the overlay and 8 with it. It measured 8.38 ms median /
19.95 ms p95 for the baseline and 22.23 ms median / 40.52 ms p95 with outlines.
The repeated overlay run again had no page or GL error. The repeated baseline,
which contains no outline work, ended with one unlocalized
`GL_INVALID_OPERATION`; the other three opaque runs were clean. Retain that as
a separate physical-runtime diagnostic rather than assigning it to the outline
path. Repeat reports append `-2` to the artifact names above.

This proves exact occurrence batching and ordered stereo execution, but it
also rejects release readiness on the Quest 2 floor: full-screen mask
presentation, not per-object submission count, is now the dominant renderer
cost. The first exploratory run used 72 SVG-textured tiger cards and visibly
flickered in-headset. That asset was removed from the timing A/B; its SVG/VT/XR
behavior is a separate unresolved observation, not evidence against or for
outline batching. Quest Browser also left an optional frame-rate preference
promise unsettled during initial session setup. Royal now starts the XR layer
without awaiting that optional preference, while containing asynchronous and
synchronous runtime failures.

The next renderer pass kept full-resolution output and the same public
descriptor. It discarded the mask depth attachment before leaving the mask
target, reused overlapping horizontal mask samples, paired adjacent binary
vertical samples through a dedicated linear sampler, and conservatively
projected visible outline bounds to scissor only the two sampled screen-space
passes. A scissored scratch clear covers the complete resolve sampling halo, so
pixels from an earlier frame or material run cannot enter the result. If bounds
cannot be projected or the region reaches the viewport, Royal retains the
ordinary full-target path. There is no XR/browser branch, resolution reduction,
temporal state, or consumer tuning knob.

On the same Quest 2 lab, shader fetch reduction alone brought width-four
outlines to 18.02--18.64 ms median. The bounded screen-space path then measured
14.13 ms median / 26.82 ms p95 and 13.64 ms median / 30.49 ms p95 in two runs.
It retained exactly eight submissions per frame and both runs ended with no
page or GL error. Width one measured 10.40 ms median / 17.28 ms p95, isolating
about 3.2--3.7 ms of the width-four result to radius-dependent sampling. An
unpaired-resolve counterfactual regressed the bounded path to 14.83 ms median;
scissoring the mask clear regressed it to 14.64 ms, so Royal retains the paired
resolve and Adreno's cheap full mask clear. Reports are:

- `/tmp/royal-quest-box-outline-xr-scissored.json`
- `/tmp/royal-quest-box-outline-xr-scissored-2.json`
- `/tmp/royal-quest-box-outline-xr-scissored-width-1.json`
- `/tmp/royal-quest-box-outline-xr-scissored-unpaired-resolve.json`
- `/tmp/royal-quest-box-outline-xr-scissored-mask-clear.json`

This is a material improvement over the original 21.33--22.23 ms medians, but
it does not satisfy a 120 Hz 8.33 ms frame or a stable 60 Hz p95. The Quest
release concern is narrowed rather than removed. The Tiger SVG/automatic-VT
flicker also remains a separate open physical observation; none of these opaque
Box measurements explain or resolve it.

A focused follow-up narrows that observation without claiming a fix. The first
Tiger XR session progressively moved from 7 resident / 4 pending automatic-VT
pages to 21 resident / 0 pending. A second session preserved 21 resident pages,
zero pending or failed pages, zero uploads, and one unchanged VT snapshot across
all 32 samples. The existing solid-coverage control produced a coherent physical
stereo capture with the same settled residency and no page or GL error. Thus
steady-state atlas eviction or page-request churn is not supported by this run;
startup refinement, discrete mip sampling, the example's default one-pixel
three-way screen-space partition, and its 46-submission / roughly 20 ms median
presentation remain distinct hypotheses. The reports and capture are:

- `/tmp/royal-quest-tiger-xr-vt-samples.json`
- `/tmp/royal-quest-tiger-xr-vt-steady.json`
- `/tmp/royal-quest-tiger-xr-solid-steady.json`
- `/tmp/royal-tiger-solid-xr.png`
