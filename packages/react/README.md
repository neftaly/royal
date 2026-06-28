# @royal/react

React adapter for Royal.

Examples and documentation should import React adapter APIs from `@royal/react`
and render graph primitives from `@royal/renderer-core`.

## Example

```tsx
/** @jsxImportSource @royal/react */
import {
  createRoot,
} from '@royal/react';
import {
  boxGeometry,
  standardMaterial
} from '@royal/renderer-core';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [1, 0, 0, 1] });

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
      <gltf src="/DamagedHelmet/DamagedHelmet.gltf" />
    </pass>
  </scene>
);
```

## Workflows

From the repository root:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @royal/examples-react test:browser
```
