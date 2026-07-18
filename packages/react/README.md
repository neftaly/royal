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
import {
  planeGeometry,
  mesh,
  perspectiveCamera,
  scene,
  unlitMaterial,
} from "@royal/react/scene";

const renderScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  clearColor: [0.03, 0.06, 0.12, 1],
  nodes: [mesh({
    geometry: planeGeometry([2, 1]),
    material: unlitMaterial({ color: [0.04, 0.32, 0.9, 1] }),
    pickingId: "panel",
  })],
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
`useCanvasPick()` calls the root's exact picker and returns `undefined` before
mount or when no visible triangle is hit.

The replacement is being implemented in vertical slices. The current slice
renders opaque solid unlit planes and boxes and proves canvas ownership, sizing,
recovery, frame scheduling, and exact shared-path picking. Scene pointer-event
bindings, controls, assets, other materials, and XR remain absent rather than
being exposed as compatibility shims.
