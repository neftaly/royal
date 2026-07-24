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
  return <output>{lifecycle.status}: {size?.cssWidth ?? 0} CSS px</output>;
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

Backing resolution defaults to the browser device pixel ratio. Set
`pixelRatio={1}` (or another positive finite value) to choose backing pixels per
CSS pixel explicitly. Updating `pixelRatio` resizes the retained renderer; it
does not recreate the canvas, root, or WebGL context.
`useCanvasSize().pixelRatio` reports the browser default or explicit override;
it is not mislabeled as the device's physical DPR when an override is active.

`rendererOptions` contains readonly `alpha` and `antialias` context requests,
both defaulting to `false`, plus immutable resource policy. Opt into alpha for
page compositing and antialias for browser multisampling. The default
`persistentGpuByteBudget` is 256 MiB. Royal owns bounded, fair preparation
scheduling and ordinary-texture upload pacing; those implementation policies
remain observable through diagnostics rather than becoming consumer tuning
knobs. A semantic option change replaces both the root and canvas. `rendererRef`
exposes the active lower-level root or `null` during the mount/replacement
lifecycle; a disposed root is never published for a newer canvas generation.
`automaticVirtualTexturing` defaults to `false`; opt in through
`rendererOptions={{ automaticVirtualTexturing: true }}` when large base-color
raster or SVG textures should use Royal's progressive VT representation. It is
a root policy rather than a material flag, and SVG remains vector-backed while
requested pages are rasterized.

Root-consuming hooks use one placement rule: call them under `Canvas`, or pass
`{ root }` from a parent-owned `rendererRef`. Passing `root: null` represents
pre-mount. `useRendererLifecycle()` and `useCanvasSize()` do not poll or wake for
unrelated frames. `useInvalidate()` requests one coalesced frame.
`useRendererSnapshot()` observes the broad root snapshot for diagnostics and
tooling; it updates for submitted frames and resource changes, so product UI
should prefer the focused lifecycle, size, and asset-status hooks. Spatial tools
which explicitly need already-prepared selected-scene triangles can use
`useVisitGltfAssetGeometry`; its typed arrays and packed transforms are borrowed
only for each callback, so copy only data the application intentionally retains.
Pass `gltfAssetClaims={[gltfAsset(...)]}` to `Canvas` when status or
spatial tools must prepare an asset before it joins the visible scene. This is a
complete lifetime claim, not a preload cache: removing its last visual and
non-visual owner releases it. Claims do not create surfaces, lights, picking,
GPU resources, or frames. They do prepare selected material images through the
ordinary bounded source lifecycle so an imminent visible handoff reuses the
same decoded sources without an application preloader. Prepared bounds remain a conservative AABB for framing and
broad phases; derive contact/support data from borrowed geometry rather than
treating bounds as a physics oracle.
`useCanvasPick()` calls the root's exact picker and returns `undefined` before
mount or when no visible triangle is hit.
`useGltfAssetStatus(sourceOrAsset)` observes one exact source, version, and
selected document scene without polling or waking for unrelated frames. Its
`streaming`, `ready`, and `degraded` states all
mean geometry is drawable; `status.textures` reports total, loading, ready,
failed, and preferred-source fallback images as progressive materials arrive.
Those drawable states also
report selected-scene `nodeCount`, `primitiveCount`, and `lightCount`, plus
the resolved `sceneIndex`, lightweight document `scenes`, and declared
`variantNames` for building scene/material-variant UI without parsing the
source twice. `status.timings` separates root-read admission/read duration,
preparation queue/work, external-resource span, direct first-drawable elapsed
time, and optional terminal image elapsed time. Optional `rootExtras` exposes
the uninterpreted, readonly JSON
value from that same root parse for application-owned schema validation. Its
reference is stable across texture-progress updates; Royal does not interpret
it or expose the rest of the parsed document. Scene inventory and extras do not
fetch or prepare unselected content.
Focused asset hooks accept either a minimal identity object or the complete
reference returned by the corresponding Royal constructor; presentation-only
fields on a complete reference do not broaden loading identity.
`usePrefilteredEnvironmentStatus(environment)` observes an exact offline
environment `src` and typed `version`. It reports `idle`, `loading`, `ready`, or
`error`; ready state includes the cubemap face size, mip count, and recorded
provenance. The scene remains drawable with Royal's studio environment while
the artifact loads or cannot be admitted to the GPU budget.
`useVirtualTextureAssetStatus(manifestUriOrAsset)` observes one exact authored
virtual-texture identity and its bounded page residency. The `Asset` name is
deliberate: automatic VT policy remains root diagnostics rather than a second
asset descriptor.
Scenes may also use `createCameraViewResource(...)`; committed camera changes
flow directly to the root without a React render or geometry rebuild.
Pure orbit view/camera helpers such as `orbitPerspectiveCamera` and
`fitOrbitCameraView` are exported from `@royal/react/scene`, alongside the
other scene-authoring functions.
`useOrbitCamera({ initial })` packages that resource as `orbit.camera` with a
stable controller; pass it directly to `scene({ camera: orbit.camera })`.
Place `<OrbitControls orbit={orbit} />` under the same `Canvas` to attach orbit,
pan, wheel, and pinch gestures. `useOrbitCameraView(orbit)` is opt-in UI
observation; rendering itself does not subscribe React to camera motion.
`scenePointerEvents` binds typed React handlers to unique scene `pickingId`
values. Handler changes update the event registry without rebuilding the scene;
pointer, imperative, and future XR inputs share the root's exact query.
Use `ScenePointerEvent` to annotate one callback or `ScenePointerEventHandlers`
for the handler object stored under an ID; these are scene events, not canvas
component props.

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
  return <output>{status.status}</output>;
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
    renderer: { preferredFrameRate: "highest" },
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
Inline sessions default to the `viewer` reference space. Immersive sessions
try `local-floor`, then `local`; pass `renderer.referenceSpacePreference` to
replace that ordered fallback explicitly. Pass
`renderer.preferredFrameRate: "highest"` (or a positive numeric preference) to
request an advertised session rate without making unsupported browsers fail.
