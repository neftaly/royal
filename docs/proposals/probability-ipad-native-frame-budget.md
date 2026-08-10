# Proposal: native-resolution Probability frame budget on iPad

## Consumer need

Probability should sustain the display's 60 Hz ceiling for an ordinary large
board-game scene without reducing device pixel ratio, render scale, source
quality, scene contents, lighting, or interaction fidelity. This proposal is
evidence for Royal to evaluate and generalize; it does not prescribe a public
API or authorize Probability to change Royal implementation.

The measured scene is the production Settlers game:

`https://prob.nz/play/#{%22doc%22:%22automerge:3BSiQ5NjqRqCYdAqKwdNB7p35XKK%22,%22sync%22:[%22wss://subduction.sync.inkandswitch.com%22]}`

The exact device was `iPad7,6`, iPadOS 17.7.11, Safari/WebKit, connected over
USB. The canvas was settled before every warm measurement.

## Royal evaluation (2026-08-10)

Royal evaluated the current production document on the same physical iPad by
serving a local renderer build through Safari's inspector without changing the
document, source assets, backing size, DPR, four-sample default framebuffer, or
camera-motion workload. Repeating the existing exact position-only depth pass
outside its camera-volume admission gate produced a real but partial gain:

| Local Settlers build | FPS | Median frame | p95 frame |
| --- | ---: | ---: | ---: |
| Current camera-volume policy, run 1 | 28.58 | 36 ms | 43 ms |
| Current camera-volume policy, run 2 | 29.39 | 36 ms | 44 ms |
| Forced outside-camera prepass, run 1 | 31.88 | 32 ms | 39 ms |
| Forced outside-camera prepass, run 2 | 30.89 | 33 ms | 40 ms |

The repeatable 3--4 ms median improvement identifies hidden-fragment PBR work
as one owner, but the remaining 32--33 ms median is still about twice the 60 Hz
budget. The result therefore clears the proposal's useful-partial-result bar,
not its acceptance boundary.

The general admission change fails an adversarial cross-scene check. On the
same device and exact local build, the normalized Bistro Exterior camera-motion
benchmark measured 33 ms median / 36 ms p95 with the current outside-camera
single pass. Forcing the depth pass measured 34 / 38 ms and raised submitted
draws from 147 to 192 per frame. Primitive count alone is therefore not a sound
visibility classifier and no Probability-specific exception is accepted.

Royal retained a narrower general classifier after a second physical A/B. The
cold plan now sums eligible world-bound area along each principal viewing axis.
An outside camera can admit the exact depth pass only when the dominant
camera-facing coverage is at least 2×, the target is the direct default
framebuffer, and that framebuffer is multisampled. Settlers has 56 eligible
surfaces and 2.61× coverage along its camera-facing axis. A corrected
wall-clock camera path, whose displacement does not vary with rendered frame
count, measured 33 / 39 ms median/p95 with the classifier versus 37 / 44 ms for
the matched single-pass control. The cleaned final build repeated at 30 / 38
ms. A faster-looking 24 / 28 ms run was discarded because its original motion
driver advanced by frame count and therefore did not preserve the same path.

Bistro's high raw bound overlap does not admit the new branch because its
retained linear composite is single-sample. The final physical path remained
at exactly 147 submissions per rendered frame; the globally forced control had
raised it to 192. Nonoverlapping retained bounds are rejected by the same pure
classifier even on a direct multisampled target. This is a useful partial
result, not the acceptance result: Settlers still remains well above 16.7 ms.

The retained single-sample presentation experiment is not admissible for this
scene without a larger semantic design. The production frame mixes standard
and unlit output with alpha blending, while this Safari exposes
`EXT_color_buffer_float` but not `EXT_float_blend`. An RGBA8 retained target
would clamp HDR, one terminal tone-map would incorrectly transform unlit
output, and rendering blended work after presentation would not share the
default framebuffer's multisampled depth. Merely disabling default MSAA was
already neutral and is not quality preserving.

WebGL occlusion queries are likewise not retained: waiting for a same-frame
answer stalls, while a prior-frame answer becomes stale during camera motion
and can hide newly exposed geometry. The next justified Royal work is exact
material/pass attribution. This proposal remains open because the retained
classifier does not yet meet the native-resolution frame target.

## Current evidence

Canvas and context:

- CSS size: 1024 × 504 pixels
- backing size: 2048 × 1008 pixels (2.06 megapixels)
- device pixel ratio: 2; Royal render scale: 1
- WebGL2 `alpha: true`, `antialias: true`, `SAMPLES: 4`
- Apple GPU; no `EXT_disjoint_timer_query_webgl2`
- `WEBGL_multi_draw` is present and Royal uses it

Settled Royal snapshot:

- 282 scene nodes
- 107 geometry claims over 24 unique geometries; 83 claims reuse prepared
  geometry
- 45 ordinary resident textures, 130,279,720 GPU bytes
- automatic VT disabled; no VT atlas or pages
- no pending preparation, transport, upload, or resource denial

Measured five-second windows:

| Workload | FPS | Median frame | p95 frame |
| --- | ---: | ---: | ---: |
| Idle Safari RAF ceiling | 60.08 | 17 ms | 18 ms |
| Continuous camera through Probability controls | 25.54 | 40 ms | 49 ms |
| Direct Royal camera-resource updates (no presence update) | 25.58 | 41 ms | 47 ms |
| Direct camera, Royal overlay removed then restored | 25.18 | 41 ms | 49 ms |
| Direct camera, Probability's eleven grid nodes removed then restored | 25.54 | 40 ms | 46 ms |
| Direct camera, environment removed then restored | 28.44 | 36 ms | 44 ms |
| Direct camera, exactly matched opaque framebuffer | 26.17 | 37 ms | 54 ms |

One instrumented control run observed 45 submitted draw groups per rendered
frame: 14 ordinary indexed draws, 30 instanced indexed draws, and one
multi-draw. Probability input dispatch was 0–1 ms p95. Wrapping the actual
Royal scheduled-frame callback measured 2 ms median and 3 ms p95, while the
driver callback measured 0–1 ms. A following-frame `gl.finish()` measured
0 ms median/p95. Together with the 36–49 ms presentation intervals, this
places the sustained gap after Royal's JavaScript submission work, in GPU and
browser presentation rather than React, Zustand, presence publication, the
grid, or the always-visible overlay. `gl.finish()` alone is not treated as a
GPU timer.

Removing the environment gains only about 11% and visibly changes the scene,
so it is not an acceptable fix. Royal's existing A10 research also says an
intentionally incorrect cross-material texture collapse moved a 52-card SVG
workload only from roughly 49 ms to 44 ms. Automatic VT or fewer submissions
must therefore not be assumed to solve this case without a physical A/B.

An app-level matched opaque-framebuffer build was also measured and reverted.
Its roughly 2% throughput difference was within run variance and its p95 was
worse. Alpha compositing is therefore not a useful owner of the sustained gap.

## Experiments worth owning in Royal

Please choose the smallest general renderer experiments that can distinguish
these hypotheses on the exact physical device:

1. Measure a native-resolution single-sample retained surface followed by a
   quality-preserving antialiasing/presentation pass. Choose the AA method only
   after visual and timing comparison; merely disabling AA is not an accepted
   outcome.
2. Measure conservative visibility/occlusion work for the many fully hidden
   members of physical stacks. It must avoid synchronous query stalls, retain
   exact visible results as stacks move, and preserve picking semantics. Do not
   infer application stack rules inside Royal.
3. Attribute the remaining fragment/presentation cost by pass and material
   feature. The environment A/B supplies an upper bound but is not itself a
   proposed product change.

The experiments should account for CPU callback time, presented-frame
intervals, submission count, backing pixels, samples, and visual output. Since
Safari exposes no timer-query extension on this device, prefer matched
end-to-end physical A/Bs over guessed GPU timings.

## Acceptance boundary

The target is a settled native 2048 × 1008 Settlers camera-motion window close
to 60 Hz (ideally median at the 16.7 ms cadence and p95 below 20 ms). A useful
partial result must show a repeatable material gain and identify the remaining
owner.

The following do not count as gains:

- lowering DPR, render scale, canvas size, texture resolution, or geometry;
- removing pieces, the grid, overlays, environment, lights, AA, or supported
  visual behavior;
- changing the source game files;
- measuring idle RAF, JavaScript completion, or DOM readiness instead of
  presented camera-motion frames;
- special-casing Probability or Settlers in Royal.

If a quality-preserving post-AA or visibility primitive is warranted, Royal
should design its public contract for other retained 3D consumers. Probability
can then consume the released primitive without importing Royal internals.
