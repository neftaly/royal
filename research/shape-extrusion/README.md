# Shape Extrusion Research

Date: 2026-06-28

This is a self-contained research prototype for turning a 2D rounded-card
contour into renderable 3D geometry and a separate 2D collision shape. It does
not change renderer packages, examples, public exports, root configs, or app
code.

Run the DOM-free benchmark and contact checks:

```sh
node research/shape-extrusion/shape-extrusion-bench.mjs
node research/shape-extrusion/shape-extrusion-bench.mjs --json
```

## Intent

The target case is a card with rounded corners:

```txt
rounded rect/card contour
  -> triangulated front and back faces
  -> side walls
  -> optional bevel/chamfer rings
  -> contour-based hit region and collision shape
```

A card texture can still come from a canvas-rasterized SVG or canvas-drawn
card face. That raster is only sampled by the face material. The footprint,
extrusion, hit testing, and contact model all come from the rounded-rect
contour so transparent texture bounds do not become interactive or collide.

## Files

- `geometry.mjs`: contour normalization, rounded-rect generation, 2D face
  triangulation, extrusion, edge loops, hit region, collision shape, SAT/contact
  checks, signed-distance approximation, and texture material sketch.
- `shape-extrusion-bench.mjs`: runnable validation/benchmark for multiple
  corner segment counts, depths, bevel settings, and rounded-corner contact
  cases.

## API Sketch

```js
import {
  closestContact,
  extrudeShape,
  roundedRectContour,
  shapeGeometry,
  textureMaterial,
} from './geometry.mjs';

const cardContour = roundedRectContour({
  id: 'spell-card',
  x: 0,
  y: 0,
  width: 320,
  height: 448,
  radius: 36,
  cornerSegments: 16,
});

const shape = shapeGeometry({
  contours: [cardContour],
});

const mesh = extrudeShape({
  shape,
  depth: 24,
  bevel: { size: 2, depth: 1.5 },
});

const material = textureMaterial({
  id: 'spell-card-face',
  source: 'canvas-rasterized-svg',
  width: 1024,
  height: 1434,
});

const contact = closestContact(mesh.collisionShape, otherMesh.collisionShape);
```

`shapeGeometry({ contours })` returns normalized contours, 2D vertices,
triangulated face indices, edge loops, bounds, a `hitRegion`, and a
`collisionShape`.

`extrudeShape({ depth, bevel })` returns:

- `vertices`: object records with position, normal, UV, loop id, source contour
  id, and source point index.
- `positions`, `normals`, `uvs`, `indices`: flat arrays ready for renderer
  upload in a future adapter.
- `edgeLoops`: named loops for front/back face boundaries, outer rim loops, and
  bevel boundaries.
- `bounds`: 3D min/max/size plus the original 2D bounds.
- `hitRegion`: point containment over the original 2D contour.
- `collisionShape`: convex 2D contour with axes and bounds for collision.
- `textureMaterial`: omitted by default; texture sampling is intentionally a
  separate product responsibility.

## Collision And Contact

`closestContact(a, b)` uses convex polygon SAT over the contour segments, then
computes closest segment witnesses for separated/touching cases. For overlap it
reports a penetration depth and normal from the minimum-overlap SAT axis. This
is deliberately contour-based; texture width/height never participate.

The benchmark covers:

- corner-corner touch
- corner-corner overlap
- corner-corner separation
- edge-corner touch
- edge-corner overlap
- signed-distance samples inside and outside the card

Rounded corners touching each other work because the card footprint is a
segmented contour, not an opaque rectangle or texture AABB.

## Benchmark Results

Measured in this workspace with:

```sh
node research/shape-extrusion/shape-extrusion-bench.mjs
```

```txt
mesh cases: 48
triangles per mesh: 28-1052
vertices per mesh: 48-1848
min validated triangle area: 2e-9

corner-corner touch: touching, distance=0, penetration=0
corner-corner overlap: overlapping, distance=-2.82502, penetration=2.82502
corner-corner separation: separated, distance=5.656854
edge-corner touch: touching, distance=0, penetration=0
edge-corner overlap: overlapping, distance=-2, penetration=2
signed distance: center=-80, outside-left-corner=8

timing: 5760 extrusions in 1366.596 ms (4215/sec)
segments=1 points=8: 22995/sec
segments=2 points=12: 18485/sec
segments=4 points=20: 11335/sec
segments=8 points=36: 6527/sec
segments=16 points=68: 3129/sec
segments=32 points=132: 1308/sec
```

## Product Recommendation

Use the rounded-rect contour as the authoritative geometry/collision contract
for card-like objects. Let SVG/canvas rendering produce a face texture only,
then map it with face UVs generated from the contour bounds. Start with
chamfer-style bevels and segmented rounded corners; this keeps the data model
small, deterministic, and easy to promote into renderer code later.
