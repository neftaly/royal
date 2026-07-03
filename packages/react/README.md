# @royal/react

React adapter for Royal.

Examples and documentation should import React adapter APIs from `@royal/react`
and render graph primitives from `@royal/renderer-core`.

## Example

The WebGL renderer currently supports a practical glTF subset: `.gltf` and
`.glb` documents, external/data URI/GLB BIN buffers, bufferView images, node
hierarchies and transforms, mesh primitives with `POSITION`/`NORMAL`/selected
`TEXCOORD_n` accessors, sparse and strided accessors, normalized integer
attributes, `UNSIGNED_BYTE`/`UNSIGNED_SHORT`/`UNSIGNED_INT` indices, triangle
and line drawing, base color factor/texture/sampler data, and the supported
required extensions documented in `docs/gltf-extension-priority.md`.
That supported required-extension set includes meshopt-compressed bufferViews
via `EXT_meshopt_compression` and KTX2/Basis base-color textures via
`KHR_texture_basisu` with an RGBA8 transcode fallback.
Optional `EXT_lights_image_based` diffuse irradiance is renderer groundwork
only; assets that require the extension are rejected until specular cubemap
sampling support lands.

```tsx
/** @jsxImportSource @royal/react/renderer */
import {
  createRoot,
} from '@royal/react';
import {
  boxGeometry,
  standardMaterial
} from '@royal/renderer-core';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({
  color: [1, 0, 0, 1]
});
const helmetSrc = '/DamagedHelmet/DamagedHelmet.gltf';

createRoot(canvas, {
  context: { alpha: true, antialias: true }
}).render(
  <scene>
    <pass>
      <perspectiveCamera
        position={[0, 1, 5]}
        rotation={[0, 0, 0]}
        fovY={Math.PI / 4}
        near={0.1}
        far={1000}
      />
      <directionalLight direction={[1, -2, -1]} color={[1, 1, 1, 1]} />
      <mesh geometry={cube} material={red} />
      <model src={helmetSrc} variant="display" />
    </pass>
  </scene>
);
```

The imperative `createRoot(canvas)` path uses `@royal/react/renderer` as its
JSX import source. It is for already-lowered Royal scenes: descriptor objects
from `@royal/renderer-core`, Royal intrinsic JSX such as `<scene>`, or
components marked with `markRendererComponent`. Arbitrary React components and
DOM overlays belong under `<Canvas>` in a React DOM tree.

glTF material variants from `KHR_materials_variants` can be selected with
`gltf({ src, variant })` or `<model variant>`. Pass a variant name, or pass a
zero-based variant index when an asset has unnamed variants.

## Workflows

From the repository root:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @royal/examples-react test:browser
```
