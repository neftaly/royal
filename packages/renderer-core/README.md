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

Scene data is immutable and contains no WebGL or React objects. World-space
positions and sizes are metres, rotations are radians, and public color fields
are scene-linear `LinearRgba` values.

Source names remain stable across constructor inputs and normalized
descriptors: glTF and ordinary image references expose `src`; authored virtual
textures expose `manifestUri` because that source is a JSON manifest. Pick
targets likewise preserve the authored `pickingId` name.

## Entrypoints

- `@royal/renderer-core` — cameras, scenes, nodes, materials, textures, lights,
  picking types, and versioned resource factories.
- `@royal/renderer-core/render-object` — low-level render-object transform
  state and attachment utilities used by renderer adapters.

Royal is currently a private source-level prerelease. See the repository
[README](../../README.md) and [changelog](../../CHANGELOG.md).
