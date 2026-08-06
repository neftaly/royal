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

The renderer-webgl bundle adds 2,277 gzip bytes over an exact 0.0.6 rebuild
(133,746 bytes current versus 131,469 bytes at `bf0075da`). The packed renderer
adds 9,655 bytes over the published 0.0.6 tarball (632,170 versus 622,515
bytes). Both release gates now record the exact 0.0.6 reference instead of the
older ceilings that 0.0.6 itself already exceeded. A current Quest pass remains
required; the connected headset exposed only USB mass storage and no ADB or
browser-inspector interface during this review.
