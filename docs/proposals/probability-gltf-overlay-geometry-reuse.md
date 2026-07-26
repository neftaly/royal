# Probability: reuse rendered glTF geometry for visual feedback

Status: implemented in Royal. Probability should consume `outlineGltf(...)`
and should not approximate this in application code.

## Consumer problem

Probability's selection and pending-action feedback must fit the visible piece
exactly. Its current integration cannot express that authority directly:

1. Royal prepares and renders a `gltf(...)` node.
2. Probability visits the prepared asset's CPU triangles.
3. Probability copies those triangles and node transforms into an app-owned
   `SupportShape`.
4. Probability flattens that shape into a second `TriangleGeometry`.
5. Royal uploads and renders the second geometry with a wireframe material.

The borrowed visitor is appropriate for Probability's stacking/contact
algorithms. It is not the right visual authority. Card outlines have visibly
diverged from cards in real play, and nominal equality of copied positions does
not establish equality with Royal's selected scene, presentation LOD, instances,
or future render-time geometry behavior.

Probability should retain `SupportShape` for stacking and other specialized
spatial queries. Selection, hover/action previews, and movement outlines should
reuse the geometry Royal actually renders.

## Proposed primitive

Royal exposes a constrained overlay-only glTF descriptor rather than implying
that ordinary scene glTF materials can be replaced:

```ts
const preview = outlineGltf({
  src,
  transform,
  material: edgeMaterial({
    color: previewColor,
    widthCssPixels: 3,
  }),
});

sceneOverlay({ nodes: [preview] });
```

`materialOverride` applies one Royal material to every selected primitive.
`edgeMaterial` is intentionally distinct from the existing diagnostic
`wireframeMaterial`:

- it emits boundary and crease edges, not every authored triangle edge;
- it has a constant CSS-pixel width independent of distance and DPR;
- it does not expose card-face triangulation diagonals;
- its line color supports alpha for pending-action previews;
- it remains crisp when always-visible over the retained scene.

The crease threshold can have a conservative Royal default; expose it only if
materially different general-purpose assets demonstrate the need. Probability
expects roughly five CSS pixels for committed selection and three for the
reduced-opacity pending-action preview. Play 1 used Drei/Three `Edges` with a
five-pixel screen-space line, which is the useful visual reference; its
box-geometry approximation and screen-space pattern shader are not requirements.

`SceneOverlay.nodes` would accept this constrained glTF form as well as its
existing mesh form. Overlay validation continues to reject picking IDs and
picking geometry. A glTF overlay without an accepted material override should
remain invalid rather than silently rendering authored PBR surfaces in the
always-visible lane.

`outlineGltf(...)` accepts the same source/version/selected-scene identity and
outer transform fields as `gltf(...)`. It deliberately has no picking ID,
picking geometry, render-object ref, tint, material variant, or authored
material path. `SceneOverlay.nodes` accepts it alongside the existing direct
mesh overlay.

`edgeMaterial(...)` accepts scene-linear RGBA and a width within `(0, 16]` CSS
pixels. Five CSS pixels remains the committed-selection reference and three the
pending-action reference.

## Implemented renderer path

This is a combination of world-space geometry authority and a private
screen-space presentation texture:

1. Royal lowers the outline asset through the ordinary selected-scene,
   primitive, nested-transform, instance, and LOD path. This preparation omits
   lights and picking surfaces.
2. At draw time, the overlay must match a currently rendered base occurrence
   by asset identity, composed model matrix, primitive geometry, and internal
   instance cohort.
3. The base `SurfaceGpuOwner` lends the currently selected LOD's VAO, index
   range, and instance count. The edge owner never owns or uploads those
   buffers. A non-matching overlay is an error instead of a silent second
   geometry authority.
4. The borrowed triangles render into a private RGBA8 normal/coverage/object-ID
   mask with a private depth attachment. The depth attachment resolves the
   outlined geometry against itself; it is not the base world's depth, so the
   final edge remains always visible.
5. A screen-space pass detects mask boundaries, occurrence-ID boundaries, and
   normal discontinuities above Royal's conservative 30-degree crease default.
   Coplanar triangle neighbours encode the same normal and ID, so card-face
   triangulation diagonals do not become edges.
6. Horizontal then vertical expansion produces the requested pixel width and
   alpha-composites the result after the ordinary mesh overlay.

Occurrence IDs let occurrences with the same style share a mask pass without
merging a selected stack into one silhouette. A run is split after 255
occurrences, matching the mask's eight-bit ID channel. Different contiguous
styles remain ordered as authored.

The mask, depth, and horizontal scratch targets cost approximately nine bytes
per target pixel and belong to the existing root-local persistent GPU budget.
They are resize- and context-generation-owned. The pass adds no public
screen-space node, second canvas, second renderer, or new picking lane.

On an ordinary canvas, `widthCssPixels` is converted independently through the
actual backing-to-CSS width and height scales. That includes device pixel ratio,
capability clamping, and integer backing-size rounding. XR framebuffers do not
have a CSS coordinate system; Royal therefore interprets the same number as
view-framebuffer pixels for external/XR frames. This makes the XR rule explicit
rather than inventing a DOM scale for headset views.

The retained-base presentation remains in force. A warm selection/preview
replace restores the retained world, renders only any direct mesh overlay, then
runs the edge mask and two fullscreen edge passes. It does not redraw the
complete Settlers world.

## Required ownership and identity

The overlay node must:

- share the existing prepared asset, selected scene, primitive geometry, and
  GPU geometry allocations with the ordinary glTF node;
- use the same node/instance transforms and the same geometry selection Royal
  would render for that asset identity;
- follow Royal's active LOD choice if LOD selection can change presentation
  geometry;
- apply the overlay node's outer transform normally;
- create no picking surface and never win a hit;
- avoid copying vertex/index arrays through the public geometry visitor;
- avoid a second geometry upload merely because the same asset is also an
  overlay;
- retain the existing independent overlay publication and retained-base-frame
  behavior.

The ordinary and overlay nodes need not be coupled by application IDs or
object references. Repeating the same immutable glTF asset identity is enough
for Royal to share its prepared and GPU resources.

## Adversarial alternatives

- Keeping the current copied `TriangleGeometry` preserves two geometry
  authorities and has already failed visually.
- Expanding or biasing the copied geometry hides mismatches and cannot preserve
  the authored silhouette.
- Using asset bounds is cheaper but incorrect for non-box geometry.
- Asking Probability to cache more aggressively removes allocation frequency,
  not the duplicate authority.
- The existing native-line triangle wireframe is approximately one device
  pixel, exposes triangulation diagonals, and cannot reproduce Play 1's readable
  selection cue.
- World-space boxes or tubes can be thick, but their apparent width changes
  with camera distance and they cease to fit non-box geometry.
- A post-process edge detector is useful for some whole-scene effects, but it
  does not identify one pending selection without another mask/object channel
  and would be a much larger primitive.
- A renderer-private reference to a lowered surface would be fast but would
  expose lifecycle-sensitive implementation identity. Reusing the immutable
  glTF asset descriptor keeps the public API declarative.

## Probability completion

Once this primitive lands, Probability can remove
`supportShapeTriangles(...)` and its `WeakMap<SupportShape, TriangleGeometry>`
from the visual-feedback path. It will keep the support shape only for
stacking/contact calculations, then project committed selection and pending
action results as edge-rendered glTF overlay nodes.

Royal verification covers closed descriptor validation, non-picking overlay
admission, nested glTF transforms, exact base occurrence matching, authored
`EXT_mesh_gpu_instancing` cohorts, retained-base ordering, CSS/backing width
conversion, and the absence of a second geometry or instance-buffer upload.
The shader contract is also checked for derivative face normals and
occurrence-ID discontinuities. Probability still owns the fixture-level visual
check and representative-device latency measurement after switching its
feedback path to this primitive.

## Acceptance

- On the Settlers fixture, every resource/development card, the robber, wooden
  pieces, and multi-primitive pieces have overlay edges generated from the
  exact geometry Royal presents for that occurrence.
- Nested glTF node transforms and instanced meshes align without an app-side
  matrix-flattening path.
- Resource and development cards show a thick exterior/crease outline without
  their two face-triangulation diagonals. Line width remains visually stable
  while zooming.
- A selected stack outlines each selected occurrence with its own outer
  transform while sharing each source asset's prepared geometry.
- Overlay publication performs no duplicate glTF source preparation or
  geometry upload.
- The overlay remains always visible, non-picking, independently replaceable,
  resize/context-safe, and compatible with retained base presentation.
