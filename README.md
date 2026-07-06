# Royal

Royal is a DOM-free renderer core with a thin React authoring layer for canvas
interface scenes. `@royal/react` exposes `<Canvas>` as the primary React API:
it owns the canvas element, renders one Royal scene, and lets React-only
controls live beside that scene.

## Quickstart

Install the React facade and its React peer:

```bash
pnpm add @royal/react react react-dom
```

Royal scene JSX uses a custom JSX runtime. Configure it once in `tsconfig.json`
for files that author Royal scenes:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@royal/react"
  }
}
```

You can also use `/** @jsxImportSource @royal/react */` at the top of a single
file. The React runtime still delegates ordinary DOM tags such as `<div>` to
React, so DOM JSX and Royal scene JSX can coexist in one file.

```tsx
/** @jsxImportSource @royal/react */
import { Canvas, OrbitControls, useOrbitCamera } from '@royal/react';
import { boxGeometry, standardMaterial } from '@royal/react/scene';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [1, 0, 0, 1] });

export function App() {
  const orbit = useOrbitCamera({ distance: 5 });

  return (
    <Canvas aria-label="Royal scene">
      <scene>
        <pass camera={orbit.camera}>
          <directionalLight direction={[1, -2, -1]} color={[1, 1, 1, 1]} />
          <mesh geometry={cube} material={red} />
        </pass>
      </scene>
      <OrbitControls {...orbit.orbitControlsProps} />
    </Canvas>
  );
}
```

Use `@royal/react/renderer` only for the lower-level imperative renderer root:

```tsx
/** @jsxImportSource @royal/react/renderer */
```

That runtime returns already-lowered Royal descriptor objects and does not host
React controls or DOM elements.

## Local Development

From the repository root:

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

The example app runs through `pnpm dev` and contains the main task-oriented
React scenes.

## API Shape

`createRendererRoot(canvas)` is the lower-level host and testing escape hatch
for code that already owns a canvas and lowered renderer descriptors. App
examples and docs should start with `<Canvas>`. React root snapshots stay
backend-neutral; WebGL diagnostics are available through
`webGlRootForRoyalRoot(root).snapshot()`.

Royal renderer APIs stop at renderer primitives. App-specific surface
descriptors, placement contracts, product panels, and event rows belong in
Patchpit/Opshop lab or example integration code, not in the product renderer
API.

glTF support is first-class. Optional and draft features should stay isolated
until they are useful through the public renderer and React APIs.

## SVG textures (beta)

Royal supports `.svg` texture images and the beta `GS_texture_svg` glTF
extension. The WebGL renderer selects the SVG source when present, keeps a core
raster fallback for non-supporting loaders, validates SVG dimensions, and
resolves relative SVG image references before rasterization.

Spec: [docs/GS_texture_svg.md](docs/GS_texture_svg.md)

Example: [apps/examples-react/src/examples/cases/GltfGhostscriptTigerSvg.tsx](apps/examples-react/src/examples/cases/GltfGhostscriptTigerSvg.tsx)

```json
{
  "extensionsUsed": ["GS_texture_svg"],
  "textures": [{
    "source": 0,
    "extensions": {
      "GS_texture_svg": { "source": 1 }
    }
  }],
  "images": [
    { "uri": "label-fallback.jpg", "mimeType": "image/jpeg" },
    { "uri": "label.svg", "mimeType": "image/svg+xml" }
  ]
}
```
