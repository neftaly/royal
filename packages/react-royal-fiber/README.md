# @royal/react

Legacy React bridge for Royal, a WebGL renderer targeting XR and low-end
devices.

New examples and documentation should import the canonical React facade from
`@royal/react`. This package remains as the legacy implementation bridge for
existing `@royal/react` consumers and for compatibility with older code.

## Example

```tsx
/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  createRoot,
  standardMaterial
} from '@royal/react';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [1, 0, 0, 1] });

createRoot(canvas).render(
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

Legacy imports from `@royal/react` continue to work, but should not be used
for new Royal examples.

## Workflows

From the repository root:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Agents should read `AGENTS.md` at the repository root.
