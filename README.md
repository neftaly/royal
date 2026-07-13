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

`@royal/react` uses the ordinary React JSX runtime. Scenes are explicit pure
data; build and memoize them separately from React controls.

```tsx
import { Canvas, OrbitControls, useOrbitCamera } from '@royal/react';
import { boxGeometry, directionalLight, mesh, scene, standardMaterial } from '@royal/react/scene';
import { useMemo } from 'react';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [1, 0, 0, 1] });

export function App() {
  const orbit = useOrbitCamera({ initial: { distance: 5 } });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    nodes: [
      directionalLight({ direction: [1, -2, -1], color: [1, 1, 1, 1] }),
      mesh({ geometry: cube, material: red }),
    ],
  }), [orbit.cameraResource]);

  return (
    <Canvas
      aria-label="Royal scene"
      scene={renderScene}
    >
      <OrbitControls orbit={orbit} />
    </Canvas>
  );
}
```

The orbit hook's `initial` view is initial-only. Its stable `cameraResource` is
an explicit versioned resource, so controls can commit camera motion without
causing React renders or rebuilding the scene.

There is no second React root. Read Context or external stores in the React
component, then pass immutable snapshots to pure scene builders. Controls and
imperative `useFrame` controllers remain ordinary children under `<Canvas>`.
Interactive nodes declare a stable `pickingId`; React handlers are supplied
separately through `Canvas.interactions` under that ID.

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
backend-neutral; the imperative root exposes a bounded, backend-neutral
`diagnostics()` payload for profiling and integration checks. Creation options
are accepted directly by `createRendererRoot(canvas, options)` and exposed as
`root.options`; interruptions and recoveries live in the snapshot's neutral
`lifecycle` model.

Royal renderer APIs stop at renderer primitives. App-specific surface
descriptors, placement contracts, product panels, and event rows belong in
Patchpit/Opshop lab or example integration code, not in the product renderer
API.

## Units

Royal world space is metric: **one Royal world unit is exactly one metre**.
Geometry sizes, positions and translations, camera clipping distances and
orthographic bounds, orbit targets/distances, punctual-light ranges, glTF
bounds and instance positions, and picking points/distances all use metres.
glTF and WebXR enter Royal at their native metre scale, so adapters must not
apply a hidden scene-scale conversion.

Transform scales and directions are dimensionless. Rotations, fields of view,
and spotlight cone angles are radians. Light quantities keep their named SI
units (`intensityCandela`, `illuminanceLux`); colors are normalized values.
Pointer coordinates and gesture deltas are CSS pixels, frame timing is seconds,
API durations named `Ms` are milliseconds, texture dimensions are texels, and
memory/storage budgets are bytes. These domains never redefine world scale.

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
