# Royal

Royal is a WebGL2 renderer with a React-first public API and pure scene
descriptors. It targets Safari 17 on A10-class iPads and Quest 2-class WebXR
hardware without requiring WebGPU, WASM, an engine runtime, or worker-owned
canvas rendering.

Royal is an open-source prerelease at `0.0.1`. Its accepted behavior and clean
replacement architecture are defined in [docs/specs](docs/specs/README.md).
The implementation owns a demand-rendered WebGL2 lifecycle, progressive static
glTF and texture publication, PBR presentation, exact CPU picking, retained
camera/instance resources, LOD and variants, WebXR, and optional virtual
texturing through shared canonical scene paths. Unsupported required glTF
semantics fail explicitly. The detailed status and remaining gaps live in the
[conformance ledger](docs/specs/conformance-and-review.md); old renderer code is
evidence and oracle material, never a runtime fallback.

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
  return <output>{lifecycle.status}</output>;
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
pnpm check:vt-pages-build
pnpm bench:vt-pages
```

The default example exercises the replacement root under React StrictMode.
`/gltf-bistro-web` is the approximate 100 MB Draco + AVIF integration workload;
its selected scene fetches only the texture sources it actually references.
The Royal bundle baseline tracks total initial gzip and the incremental
Royal cost separately. glTF, VT, IBL, codecs, and XR receive their own reachable
and lazy-byte gates when their actual slices land; unused features are not
counted as working merely because legacy source still exists.

`check:vt-pages-build` verifies that the VT2 page-generation and page-table
benchmark still compiles against the current source graph. `bench:vt-pages`
runs that microbenchmark in a native browser when loopback and headless browser
execution are available. It is a focused regression signal, not a substitute
for representative scene traces or physical Safari and Quest evidence.

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

Royal is distributed under [AGPL-3.0-only](LICENSE). The proposed Royal SVG glTF extension and its
security/texture behavior are retained in the specification set.
