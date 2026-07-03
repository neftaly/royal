# @royal/react

React adapter for Royal. It renders Royal scene descriptors into a canvas
without using the DOM as the scene model.

Examples and documentation should import React adapter APIs from `@royal/react`
and render graph primitives from `@royal/renderer-core`.

## Example

`<Canvas>` is the primary React API. It owns the canvas element, accepts exactly
one Royal scene child, and can host React-only control components such as
`<OrbitControls>`.

The WebGL renderer currently supports a practical glTF subset: `.gltf` and
`.glb` documents, external/data URI/GLB BIN buffers, bufferView images, node
hierarchies and transforms, mesh primitives with `POSITION`/`NORMAL`/selected
`TEXCOORD_n` accessors, sparse and strided accessors, normalized integer
attributes, `UNSIGNED_BYTE`/`UNSIGNED_SHORT`/`UNSIGNED_INT` indices, triangle
and line drawing, base color factor/texture/sampler data, and selected required
extensions.
That supported required-extension set includes meshopt-compressed bufferViews
via `EXT_meshopt_compression` and KTX2/Basis base-color textures via
`KHR_texture_basisu` through an RGBA8 transcode path.
Optional `EXT_lights_image_based` diffuse irradiance is renderer groundwork
only; assets that require the extension are rejected until specular cubemap
sampling support lands.

```tsx
/** @jsxImportSource @royal/react */
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import {
  boxGeometry,
  standardMaterial,
} from '@royal/renderer-core';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [1, 0, 0, 1] });
const helmetSrc = '/DamagedHelmet/DamagedHelmet.gltf';

export function App() {
  const orbit = useOrbitCamera({ distance: 5 });

  return (
    <Canvas aria-label="Royal scene">
      <scene>
        <pass camera={orbit.camera}>
          <directionalLight direction={[1, -2, -1]} color={[1, 1, 1, 1]} />
          <mesh geometry={cube} material={red} />
          <model src={helmetSrc} variant="display" />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} />
    </Canvas>
  );
}
```

The imperative `createRendererRoot(canvas)` path uses
`@royal/react/renderer` as its JSX import source. It is a lower-level host and
testing escape hatch for already-lowered Royal scenes: descriptor objects from
`@royal/renderer-core`, Royal intrinsic JSX such as `<scene>`, or plain
function components that return one renderer descriptor. React children,
hooks, and controls belong under `<Canvas>`.

React commits render the latest descriptor graph immediately. Use
`useInvalidate()` inside `<Canvas>` only for changes React did not commit, such
as external store mutations, imperative animation state, or host integration
events. Royal render-object refs already invalidate the current canvas when
their transform changes.

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
