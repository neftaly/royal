# Always-visible scene overlays for Probability

Status: resolved by Royal's `SceneOverlay` primitive. Probability consumes the
general primitive and does not reach into WebGL state or add a second renderer.

## Required behavior

Probability renders world-space selection outlines and movement guides. These
are interaction feedback, not physical surfaces:

- they must remain visible through every scene surface;
- they must retain world-space geometry, transforms, clipping and sizing;
- they must not write depth or alter later world rendering;
- their visual presentation must not make hidden geometry win picking;
- movement guides and selection outlines need the same mechanism;
- ordinary scenes must pay no cost when the mechanism is unused.

Appending an unlit or wireframe mesh is insufficient because Royal currently
depth-tests both. Raising the geometry is also incorrect: it changes the
authored movement endpoints and still fails for tall occluders.

## Implemented primitive

Royal provides one deliberately narrow, independently published presentation
lane:

```ts
const overlay = sceneOverlay({
  nodes: [
    mesh({
      geometry,
      material: wireframeMaterial,
      transform,
    }),
  ],
})

root.setOverlay(overlay) // or <Canvas overlay={overlay} />
```

`SceneOverlay` means:

1. render after ordinary opaque, transparent and transmission world surfaces;
2. disable depth testing and depth writes for the overlay draw;
3. preserve stable authored scene order within the overlay lane;
4. retain the normal color-management/presentation path;
5. reject picking IDs and picking geometry, keeping interaction on the ordinary
   depth-tested scene path;
6. omit the surface from depth prepasses, shadows and transmission inputs.

Overlay nodes are restricted to solid-color unlit or wireframe meshes. The
default remains ordinary world presentation; Royal does not expose arbitrary
numeric render order or a general WebGL depth-state escape hatch.

## Probability acceptance case

Render an opaque box between the camera and:

- a wireframe selection outline around a piece; and
- the two box-geometry segments of a movement guide.

Both hints must remain fully visible. Picking the visible overlay outside the
physical nearest surface must not select the occluded piece. Existing scenes
without overlay nodes must retain their current packets, results and bundle
path.
