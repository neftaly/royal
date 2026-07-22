# @royal/renderer-core

Backend-neutral Royal scene descriptors and versioned resource channels.

React applications should normally import the same authoring vocabulary from
`@royal/react/scene`. Use this package directly when a non-React host owns scene
construction or when implementing a renderer adapter.

```ts
import {
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

`gltf({ src, sceneIndex })` selects one exact zero-based document scene;
omitting `sceneIndex` uses the glTF document default. The selected scene is part
of asset/status identity, while shared source-derived mesh and image identities
remain stable across selections.

`gltf({ src, tint })` and `gltfInstances({ src, tint, ... })` apply one
scene-linear RGBA presentation multiplier to every selected base color without
rewriting the asset or changing its source/preparation identity.

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
