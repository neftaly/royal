# Bug: camera-dependent occlusion between overlapping BLEND surfaces

Status: closed for separated BLEND surfaces. Fixed in Royal 0.0.23 by
`fd045a7b`, with a standalone glTF pixel regression covering camera and object
motion. Intersecting bounds and geometry within a single draw retain approximate
centre-depth ordering; this does not claim general order-independent transparency.
See the [rendering contract](../../specs/rendering-and-presentation.md) and
[0.0.23 changelog](../../../CHANGELOG.md#0023---2026-09-08).

The original 0.0.22 report below describes the pre-fix behaviour.

## Original status and scope

Reproduced in Probability with Royal 0.0.22 using a small local scene with the
material settings read from the affected game. No Royal code was changed.
Probability has fixed a separate importer bug that classified opaque SVG paint
as translucent because of antialias coverage/compositing roundoff. That avoids
this renderer path for opaque artwork; genuinely translucent pieces still need
correct compositing.

The Probability fix conservatively proves opacity from supported SVG paint
instructions, uses MASK for coverage and opaque stock, and retains the original
pixels/SVG/preview resolution. Explicit translucency or unsupported effects and
styles keep the existing pixel-inspection fallback. Different back artwork is
classified independently of the front's opacity proof. Existing generated
models require an update reimport; the shared game was not mutated for this test.

The original game is:
http://localhost:3000/play/#{%22doc%22:%22automerge:3nXj1P9FySpL2M24Lep8ZkubvgaQ%22,%22sync%22:[%22wss://subduction.sync.inkandswitch.com%22]}

Its glTF documents were inspected successfully. Some dependent texture requests
timed out or remained unavailable in the clean browser, so the verified visual
reproduction used local Settlers assets with the actual material flags below,
not a claim that the entire shared game finished rendering.

## Observed result

A large mat lies beneath two smaller award cards. From overhead, both cards are
visible. Tilt towards one side and their faces disappear behind the mat. Orbit
to the opposite side and they reappear. Piece positions and document contents
remain unchanged. Selection was cleared, and all local models were visually
ready before the camera checks.

Generated materials in the affected document:

| Piece | Printed face | Edge/plain-back alpha |
| --- | --- | --- |
| cutting-mat_2mm_001 | BLEND | 0.9999975328287968, BLEND |
| largest-army_2mm_001 | BLEND | 0.999983522820893, BLEND |
| longest-road_2mm_001 | BLEND | 0.999983522820893, BLEND |

The printed textures are effectively opaque, despite their BLEND declaration.
Ordinary resource cards in the same game instead use MASK faces and opaque
stock, which helps explain the selective nature of the symptom.

## Minimal reproduction

Use a horizontal mat box 0.841 x 0.002 x 0.594 metres (XYZ), with its centre at
(0, 0.001, 0). Place two 0.088 x 0.002 x 0.126 metre boxes above it, centred at
(-0.3765, 0.003, -0.234) and (-0.3765, 0.003, -0.100). Give the mat and cards
contrasting colours and BLEND materials on all faces. Use the alphas above;
also test genuinely translucent materials rather than only almost-opaque ones.

Camera-only checks: overhead pitch pi/2, then pitch 0.6 with yaw 0, then pitch
0.6 with yaw pi. Target the mat and use a distance around 0.8 to 1 metre.

The verified local test used the generated Settlers geometry/textures, an extra
opaque support mat introduced by Probability's ZIP loader, and a small contact
presentation gap. Those do not change the ordering relationship described here.

Local investigation artifacts (temporary, not committed fixtures):

- `/tmp/probability-mat-minimal.mjs` creates and renders the reduced scene.
- `/tmp/probability-mat-minimal-above.png`: cards visible.
- `/tmp/probability-mat-minimal-angled.png`: cards hidden by mat.
- `/tmp/probability-mat-minimal-opposite.png`: cards visible again.
- `/tmp/probability-mat-fixed-angled.png`: the actual Settlers SVGs reimported
  with the Probability fix; both cards remain visible at the failing angle.

## Likely renderer cause

`packages/renderer-webgl/src/surface/surface-depth-order.ts` sorts blended
surfaces by the view depth of each world-bounds centre.
`surface-gpu-owner.ts` disables depth writes for alpha-blended surfaces.

For a large horizontal plane and smaller planes sitting above its far side,
centre-depth ordering disagrees with per-pixel ordering. Camera motion changes
the centre ordering, allowing the mat to composite over physically nearer card
faces. This is a limitation of the sorting approach, not incorrect stack heights,
VT resolution, or missing selection overlays.

## Expected behaviour / regression coverage

- Camera motion must not reverse occlusion between a support plane and
  non-intersecting pieces above it.
- Test near-opaque BLEND, genuine fractional opacity, and mixed opaque/MASK/BLEND
  surfaces; preserve visibility through actual transparent portions.
- Include unequal-sized planes, offset cards on both sides of the mat centre,
  flipped cards, and multiple translucent layers.
- Keep an opaque control scene and verify that geometry transforms are stable.
- A static scene-order override or globally enabling transparent depth writes
  is not a general solution: both can break legitimate transparency elsewhere.

Please address this in Royal's transparency/compositing path. The importer fix
does not remove the requirement to render valid BLEND materials correctly. No
change to SVG texture resolution or automatic VT is requested.
