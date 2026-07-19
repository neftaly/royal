# @royal/react

The React-first host for Royal. `Canvas` renders an ordinary `<canvas>` and
ordinary React children; scene data remains pure and lives in
`@royal/react/scene`.

```tsx
import {
  Canvas,
  type ScenePointerEvents,
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

const pointerEvents: ScenePointerEvents = {
  panel: { onClick: (event) => console.log(event.hit.point) },
};

function Status() {
  const lifecycle = useRendererLifecycle();
  const size = useCanvasSize();
  return <output>{lifecycle.state}: {size?.backingWidth ?? 0}px</output>;
}

export function App() {
  return (
    <Canvas
      aria-label="Royal scene"
      scene={renderScene}
      scenePointerEvents={pointerEvents}
    >
      <Status />
    </Canvas>
  );
}
```

CSS owns layout. Royal measures that layout and owns the canvas backing size, so
native `width` and `height` props are intentionally excluded. Native canvas
props, ARIA attributes, event handlers, class/style, refs, and application
`data-*` attributes pass through; `data-*` is not a Royal scene protocol.
Canvas defaults to `display: block; width: 100%` so its renderer-owned backing
dimensions cannot feed back into unconstrained intrinsic CSS sizing. An explicit
React `style` may override either default; CSS should keep at least one axis
independent of the canvas's intrinsic dimensions.

`rendererOptions` contains readonly `alpha` and `antialias` context requests,
both defaulting to `true`, plus immutable resource policy. The default
`persistentGpuByteBudget` is 256 MiB and `maxConcurrentPreparationJobs` is 8.
The latter is a root-wide FIFO ceiling shared by glTF, ordinary texture, VT,
and prefiltered-environment preparation; it is not a worker count. A semantic
option change replaces both the root and canvas. `rendererRef`
exposes the active lower-level root or `null` during the mount lifecycle.
`ordinaryTextureUploadByteBudgetPerFrame` defaults to 16 MiB and paces new ordinary-texture
transfer across real canvas/XR frames without changing focused asset readiness.
One individually larger texture is admitted alone rather than starving.

Focused hooks use one placement rule: call them under `Canvas`, or pass
`{ root }` from a parent-owned `rendererRef`. Passing `root: null` represents
pre-mount. `useRendererLifecycle()` and `useCanvasSize()` do not poll or wake for
unrelated frames. `useInvalidate()` requests one coalesced frame.
`useCanvasPick()` calls the root's exact picker and returns `undefined` before
mount or when no visible triangle is hit.
`useGltfAssetStatus(sourceOrAsset)` observes one exact asset without polling or
waking for unrelated frames. Its `streaming`, `ready`, and `degraded` states all
mean geometry is drawable; `status.textures` reports total, loading, ready, and
failed images as progressive materials arrive.
`usePrefilteredEnvironmentStatus(environment)` observes an exact offline
environment `src` and typed `version`. It reports `idle`, `loading`, `ready`, or
`error`; ready state includes the cubemap face size, mip count, and recorded
provenance. The scene remains drawable with Royal's studio environment while
the artifact loads or cannot be admitted to the GPU budget.
Scenes may also use `createCameraViewResource(...)`; committed camera changes
flow directly to the root without a React render or geometry rebuild.
`useOrbitCamera({ initial })` packages that resource with a stable controller;
place `<OrbitControls orbit={orbit} />` under the same `Canvas` to attach orbit,
pan, wheel, and pinch gestures. `useOrbitCameraView(orbit)` is opt-in UI
observation; rendering itself does not subscribe React to camera motion.
`scenePointerEvents` binds typed React handlers to unique scene `pickingId`
values. Handler changes update the event registry without rebuilding the scene;
pointer, imperative, and future XR inputs share the root's exact query.

Image-based lighting is explicit scene data and keeps its parser and transport
lazy:

```tsx
import { usePrefilteredEnvironmentStatus } from "@royal/react";
import { prefilteredEnvironment, scene } from "@royal/react/scene";

const environment = prefilteredEnvironment({
  src: "/lighting/studio.royal.ktx",
  version: "sha256-…",
  radianceScaleNits: 1,
});

function EnvironmentStatus() {
  const status = usePrefilteredEnvironmentStatus(environment);
  return <output>{status.state}</output>;
}

const renderScene = scene({ camera, environment, nodes });
// Render <EnvironmentStatus /> as a child of the Canvas using renderScene.
```

WebXR is isolated in `@royal/react/xr`, so ordinary React applications do not
load or probe XR code. Place the hook under `Canvas` and call `enter()` only
from a user gesture:

```tsx
import { useXrSession } from "@royal/react/xr";

function XrButton() {
  const xr = useXrSession({
    mode: "immersive-vr",
    session: { optionalFeatures: ["local-floor"] },
  });
  const live = xr.status === "active" || xr.status === "suspended";
  return (
    <button
      disabled={xr.status === "checking" || xr.status === "unavailable"}
      onClick={() => void (live ? xr.exit() : xr.enter())}
    >
      {live ? "Exit XR" : "Enter XR"}
    </button>
  );
}
```

The hook owns capability checking, one browser session, one session RAF chain,
and cleanup. `suspended` is a live hidden session, not a failure. An `exit()`
rejection restores that live state and retains its message in `error`.
