# @royal/renderer-core

Backend-neutral Royal scene descriptors and versioned resource channels.

React applications should normally import the same authoring vocabulary from
`@royal/react/scene`. Use this package directly when a non-React host owns scene
construction or when implementing a renderer adapter.

```ts
import {
  boundedVolume,
  boxGeometry,
  linearRgbaFromSrgb,
  mesh,
  perspectiveCamera,
  scene,
  standardMaterial,
} from '@royal/renderer-core';

const renderScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 4] }),
  nodes: [
    mesh({
      geometry: boxGeometry({ size: [1, 1, 1] }),
      material: standardMaterial({
        color: linearRgbaFromSrgb([0.9, 0.2, 0.16, 1]),
      }),
    }),
  ],
});
```

Scene data is TypeScript-`readonly` intent and contains no WebGL or React
objects. Constructors copy caller-owned tuples and arrays but do not add runtime
freezing. World-space positions and sizes are metres, rotations are radians,
and public color fields are scene-linear `LinearRgba` values.
Invalid authoring fails synchronously: malformed types and closed choices throw
`TypeError`, while invalid numeric ranges and contradictory bounds throw
`RangeError`.

Source names remain stable across constructor inputs and normalized
descriptors: glTF and ordinary image references expose `src`; authored virtual
textures expose `manifestUri` because that source is a JSON manifest. Pick
targets likewise preserve the authored `pickingId` name.

`boundedVolume(...)` adds a non-pickable emissive medium to the world scene. It
is a scene node, not a material, because its box or closed outward-wound convex
triangle hull owns a depth-aware volume pass rather than surface shading:

```ts
boundedVolume({
  geometry: boxGeometry([1, 2, 1]),
  color: [0.08, 2.2, 0.48, 0.88], // linear emission; alpha scales density
  extinctionPerMetre: 3.4,
  densityProfile: [[0, 0.45], [0.2, 1], [1, 0]],
  noiseScale: [4, 8, 5],
  noiseStrength: 0.4,
});
```

Custom hulls may have at most 32 distinct face planes. Volumes render after
opaque surfaces and before transmission/alpha-blended surfaces; overlapping
media use ordered alpha rather than a coupled extinction solve. Replace the
immutable scene descriptor to animate a volume.

`gltf({ src, sceneIndex })` selects one exact zero-based document scene;
omitting `sceneIndex` uses the glTF document default. The selected scene is part
of asset/status identity, while shared source-derived mesh and image identities
remain stable across selections.

`gltf({ src, tint })` and `gltfInstances({ src, tint, ... })` apply one
scene-linear RGBA presentation multiplier to every selected base color without
rewriting the asset or changing its source/preparation identity.

Separately authored world surfaces that must remain visually distinct require
distinct geometry. In particular, coplanar triangles can produce different
stored depths even when their source planes are mathematically equal, so Royal
does not infer a winner or expose a polygon-offset classification. Use a small
physical separation, or the explicit overlay lane for depth-independent UI.

`mesh({ ref })` and `gltf({ ref })` expose one renderer-attached
`RenderObjectHandle`. Its position, rotation, scale, and `setTransform()` API
update the retained object without republishing the scene. Object and callback
refs clear after their final renderer attachment is removed; a later
declarative transform synchronizes the same handle.

Textured standard and unlit materials accept an optional scene-linear `tint`
multiplier. The name is deliberately distinct from the mutually exclusive
solid `color` form. An authored `color` or `tint` alpha below one selects the
renderer's ordered blend path:

```ts
standardMaterial({
  texture: imageTexture('/paint.webp'),
  tint: linearRgbaFromSrgb([0.8, 0.35, 0.2, 0.75]),
});
```

Unlit fills and edge materials may select complementary presentation coverage:

```ts
const coverage = screenSpacePartition({
  cellSizeCssPixels: 2,
  count: 2,
  index: 0,
});

unlitMaterial({ color: [1, 1, 1, 1], coverage });
edgeMaterial({ color: [0, 0, 0, 1], coverage, widthCssPixels: 3 });
```

Create the other member with the same cell size and `count`, and `index: 1`.
Matching members share a deterministic screen-space phase and cover every cell
exactly once. Coverage affects presentation only: it does not change picking.
It is intentionally unavailable on standard and wireframe materials.

`sceneOverlay({ nodes })` creates a non-picking, always-visible presentation
lane. It accepts solid-color unlit/wireframe meshes,
`screenSpaceSegment({ start, end, material })` guides, and `outlineGltf(...)`
nodes. Segments and outlines share `edgeMaterial(...)` scene-linear color,
fixed presentation width—CSS pixels on canvas and per-view presentation pixels
in external/XR views—and optional complementary coverage. `widthCssPixels` is
required, finite, and within `(0, 16]`. An outline borrows a matching rendered
glTF occurrence's selected scene, active LOD, instances, and GPU geometry. Use
`sourceTransform` to identify a stationary source occurrence while `transform`
places a displaced preview. Coincident equivalent occurrences may share
resident geometry; missing sources fail instead of creating a second geometry
authority.

`prefilteredEnvironment({ src, version, rotation, radianceScaleNits })` selects
one offline Royal KTX 1 environment artifact. Raw HDR decode and convolution
are deliberately not runtime scene operations. `src` plus the type and value of
`version` identifies bytes; rotation and radiance scale may change without
changing that content identity. See the repository rendering specification and
`scripts/repack-royal-environment.ts --help` for the pinned artifact workflow.

## Entrypoints

- `@royal/renderer-core` — cameras, scenes, nodes, materials, textures, lights,
  picking types, and versioned resource factories.
- `@royal/renderer-core/render-object` — low-level render-object transform
  state and attachment utilities used by renderer adapters.

Royal is currently an open-source prerelease. See the repository
[README](../../README.md) and [changelog](../../CHANGELOG.md).
