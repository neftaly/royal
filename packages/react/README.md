# @royal/react

The React-first host for Royal. `Canvas` renders an ordinary `<canvas>` and
ordinary React children; scene data remains pure and lives in
`@royal/react/scene`.

```tsx
import {
  Canvas,
  useCanvasSize,
  useRendererLifecycle,
} from "@royal/react";
import { perspectiveCamera, scene } from "@royal/react/scene";

const renderScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  clearColor: [0.03, 0.06, 0.12, 1],
  nodes: [],
});

function Status() {
  const lifecycle = useRendererLifecycle();
  const size = useCanvasSize();
  return <output>{lifecycle.state}: {size?.backingWidth ?? 0}px</output>;
}

export function App() {
  return (
    <Canvas aria-label="Royal scene" scene={renderScene}>
      <Status />
    </Canvas>
  );
}
```

CSS owns layout. Royal measures that layout and owns the canvas backing size, so
native `width` and `height` props are intentionally excluded. Native canvas
props, ARIA attributes, event handlers, class/style, refs, and application
`data-*` attributes pass through; `data-*` is not a Royal scene protocol.

`rendererOptions` contains immutable `alpha` and `antialias` context requests,
both defaulting to `true`. A semantic option change replaces both the root and
canvas. `rendererRef` exposes the active lower-level root or `null` during the
mount lifecycle.

Focused hooks use one placement rule: call them under `Canvas`, or pass
`{ root }` from a parent-owned `rendererRef`. Passing `root: null` represents
pre-mount. `useRendererLifecycle()` and `useCanvasSize()` do not poll or wake for
unrelated frames. `useInvalidate()` requests one coalesced frame.

The replacement is being implemented in vertical slices. The current slice
renders empty scene clear color and proves canvas ownership, sizing, recovery,
and frame scheduling. Unsupported render nodes, picking, controls, assets, and
XR are absent rather than exposed as compatibility shims.
