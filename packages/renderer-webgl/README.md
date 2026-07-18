# @royal/renderer-webgl

Royal's imperative WebGL2 renderer root. React applications normally use
`@royal/react`; this package is for hosts that already own an HTML canvas.

```ts
import {
  boxGeometry,
  mesh,
  perspectiveCamera,
  scene,
  unlitMaterial,
} from "@royal/renderer-core";
import { createRendererRoot } from "@royal/renderer-webgl";

const root = createRendererRoot(document.querySelector("canvas")!, {
  alpha: true,
  antialias: true,
});

root.setSize({
  cssWidth: 800,
  cssHeight: 450,
  devicePixelRatio: window.devicePixelRatio,
});
root.render(scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  clearColor: [0.03, 0.06, 0.12, 1],
  nodes: [mesh({
    geometry: boxGeometry(1),
    material: unlitMaterial({ color: [0.04, 0.32, 0.9, 1] }),
    pickingId: "hero",
  })],
}));

const hit = root.pick({ clientX: pointer.clientX, clientY: pointer.clientY });
console.log(hit?.target.pickingId, hit?.point);

root.dispose();
```

The root owns one WebGL2 context, its backing dimensions, frame scheduling,
context-loss recovery, and WebGL state. `alpha` and `antialias` default to
`true`; they are immutable because browsers fix context attributes at context
creation. Invalid values and unknown option fields fail synchronously.

`invalidate()` requests one coalesced frame. `flushInvalidated()` is available
to deliberate imperative hosts, while `acquireExternalClock()` transfers frame
authority to an external clock until its idempotent `release()`.

`getSnapshot()` and `subscribe()` expose the broad operational snapshot.
`getLifecycleSnapshot()` / `subscribeLifecycle()` and
`getSizeSnapshot()` / `subscribeSize()` are focused streams that do not wake for
unrelated frames.

`getGltfAssetSnapshot(asset)` and `subscribeGltfAsset(asset, listener)` expose
focused `idle` / `loading` / `ready` / `error` state for one exact source and
version. Loading and content errors stay on that asset lifecycle; they are not
reported as scheduled-frame failures.

The current vertical slice renders opaque solid unlit planes and boxes through
one canonical indexed-triangle path. Exact picking consumes those same retained
transforms and triangles; optional `pickingGeometry` replaces only CPU exact
intersection and never allocates a GPU buffer. A glTF picking proxy is available
while its asset is still loading and remains authoritative after visual geometry
arrives. Static `.glb` assets containing
triangle geometry and `KHR_materials_unlit` solid base-color factors demand-load
into that same path. Their float `NORMAL` and `TEXCOORD_0` streams lower into
optional canonical attributes for later material slices; preparation code loads
concurrently with the asset request.
Textures, standard materials, external `.gltf` resources, sparse/quantized
accessors, variants, deformation, animation, and glTF picking proxies still fail
explicitly rather than calling the legacy renderer. Optional capability and
WebXR subpaths return only with their working feature slices.
