# Royal

Royal is a WebGL2 renderer with a React-first public API and pure scene
descriptors. It targets Safari 17 on A10-class iPads and Quest 2-class WebXR
hardware without requiring WebGPU, WASM, an engine runtime, or worker-owned
canvas rendering.

Royal is a source-level prerelease at `0.0.1`. Its accepted behavior and clean
replacement architecture are defined in [docs/specs](docs/specs/README.md).
The implementation is landing as independently verified vertical slices; the
current executable slice owns a CSS-sized canvas, WebGL2 context lifecycle,
coalesced frame clock, complete opaque state, direct unlit planes and boxes,
exact CPU picking, and focused React observation. Unsupported nodes and
materials fail explicitly. The old renderer is evidence and oracle material,
not a fallback path.

## Current React API

```tsx
import { Canvas, useRendererLifecycle } from "@royal/react";
import {
  boxGeometry,
  mesh,
  perspectiveCamera,
  scene,
  unlitMaterial,
} from "@royal/react/scene";

const renderScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  clearColor: [0.035, 0.07, 0.14, 1],
  nodes: [mesh({
    geometry: boxGeometry(1),
    material: unlitMaterial({ color: [0.04, 0.32, 0.9, 1] }),
    pickingId: "hero",
  })],
});

function Status() {
  const lifecycle = useRendererLifecycle();
  return <output>{lifecycle.state}</output>;
}

export function App() {
  return <Canvas scene={renderScene}><Status /></Canvas>;
}
```

`Canvas` is an ordinary React/DOM boundary: CSS owns layout, Royal owns backing
resolution, and native canvas/ARIA/event/ref/`data-*` props pass through where
they do not conflict with renderer ownership. Pure constructors stay in
`@royal/react/scene`; the imperative escape hatch is
`createRendererRoot(canvas, options)`.

## Development

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm check:package-imports
pnpm check:package-consumer
pnpm check:bundle-size:details
```

The default example exercises the replacement root under React StrictMode.
The Royal bundle baseline tracks total initial gzip and the incremental
Royal cost separately. glTF, VT, IBL, codecs, and XR receive their own reachable
and lazy-byte gates when their actual slices land; unused features are not
counted as working merely because legacy source still exists.

## Core conventions

- One Royal world unit is one metre.
- Public colors are explicit linear or sRGB tuple domains.
- Scene descriptors are TypeScript-`readonly` intent, not render passes or
  mutation logs; constructors copy inputs without runtime freezing.
- Functional cores plan transitions; narrow imperative owners perform browser
  and WebGL effects.
- WebGL state is complete for each operation and diffed by one root-local owner.
- Optional features converge on canonical render paths instead of alternate
  renderers.
- Consumer DX comes before backend vocabulary; focused observation comes before
  broad diagnostics.

Royal remains AGPL-3.0-only. The proposed Royal SVG glTF extension and its
security/texture behavior are retained in the specification set.
