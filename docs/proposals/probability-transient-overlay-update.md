# Probability: transient overlay updates without base-scene publication

Status: resolved by `SceneOverlay`, `RendererRoot.setOverlay`, and retained base
presentation.

## Consumer need

Probability wants to preview the exact geometry that a click will select. On
pointer hover it adds one reduced-opacity wireframe derived from the same
prepared geometry as selection, and removes or replaces that wireframe when the
pointer target changes. The overlay has no picking ID, so it cannot become the
interaction target.

This is transient renderer state. It does not belong in the game document or
presence, and pointer movement must not rebuild or republish the tabletop.

## Measured blocker

A Probability prototype expressed the preview as an ordinary React scene
change. On the loaded Settlers fixture, publishing or removing the single
wireframe caused a roughly 280 ms GPU commit on each transition:

- first add: 275 ms GPU task;
- subsequent remove: 278 ms GPU task;
- subsequent add: 279 ms GPU task.

The traces are `/tmp/prob-hover-trace.json.gz` and
`/tmp/prob-hover-trace2.json.gz` in the current development environment.

The rendered result was correct, but this cost makes hover unusable. Probability
removed the prototype rather than hiding the hitch with a delay. Predeclaring
one hidden exact outline per game piece is also not acceptable: it eagerly
duplicates support geometry, retained surfaces, and first-load work merely to
avoid scene publication.

## Implemented primitive

Royal owns an independently published overlay scene. Consumers update it with
`RendererRoot.setOverlay` or React's `Canvas.overlay` without mutating the
canonical base scene or depending on renderer internals. A retained copy of the
completed base presentation prevents warm overlay transitions from redrawing
unchanged world surfaces.

The required semantics are:

- one root owns the base scene and transient layer lifecycle;
- replacing or clearing the transient layer does not lower, upload, or commit
  unchanged base-scene surfaces;
- overlay nodes can use ordinary Royal geometry, materials, transforms, refs,
  and optional picking IDs;
- base and overlay depth/order behavior is explicit enough for wireframes and
  movement guides to remain visible over opaque geometry;
- resize, context restoration, cancellation, and root disposal include the
  transient layer without a second canvas or WebGL context;
- ordinary applications that do not use the capability pay no bundle or
  runtime cost beyond the accepted Royal policy.

For this consumer, a hover transition should be comfortably inside one frame
and scale with the one changed overlay, not with the hundreds of unchanged glTF
instances in Settlers.

## Probability integration

Probability retains one local hovered occurrence, projects its existing
`SupportShape` to the same `TriangleGeometry` used by committed selection, and
publishes a wireframe with the selection color at approximately 28% opacity. It
remains outside document and presence state and is not pickable.
