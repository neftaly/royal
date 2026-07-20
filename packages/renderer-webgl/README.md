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
root.setScene(scene({
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
`false`; opt into either cost when the application needs canvas compositing or
browser multisampling. They are immutable because browsers fix context attributes at context
creation. Invalid values and unknown option fields fail synchronously.
`persistentGpuByteBudget` defaults to 256 MiB.
`maxConcurrentPreparationJobs` defaults to 8 and is one root-wide FIFO ceiling
shared by glTF asset pipelines, ordinary texture decode, virtual-texture
transport/decode, and prefiltered-environment preparation. It is neither a
worker count nor a preallocation. Queued claims are cancellable, and
`getSnapshot().resources.asyncPreparation` reports the immutable limit plus
active and queued job counts.
`ordinaryTextureUploadByteBudgetPerFrame` defaults to 4 MiB. It bounds newly transferred
ordinary-texture bytes per submitted canvas or XR frame; a larger individual
texture is admitted alone so it cannot starve. Deferred storage remains a ready
asset with its neutral/current representation and retries on the next frame.
`getSnapshot().resources.ordinaryTextureUploads` reports admitted bytes, the immutable
limit, and unique deferrals for the most recently submitted frame.

`automaticVirtualTexturing` defaults to `false`. Enabling it lets eligible
base-color raster images and SVG images move onto Royal's shared VT demand,
residency, and shader path after usable ancestor coverage exists. SVG pages are
rasterized from vector source on demand up to a 16,384-texel logical long edge;
the renderer does not retain a bitmap of that size. The option is immutable and
keeps VT/SVG implementation code behind the renderer's lazy VT boundary.

`setScene()` installs the complete scene intent and requests one coalesced
presentation frame; it does not synchronously draw. The scene owns clear color
so there is no competing root-level color override. `invalidate()` requests one
coalesced frame without replacing scene intent. `flushInvalidated()` is
available to deliberate imperative hosts. External frame-clock authority is
owned by dedicated integrations such as `@royal/renderer-webgl/xr`; it is not
part of the ordinary root API.
`createCameraViewResource(...)` may be used as the scene camera; committed
changes invalidate one frame and update retained camera storage without
re-lowering the scene or rebuilding GPU resources.

`getSnapshot()` and `subscribe()` expose the broad operational snapshot.
`getLifecycleSnapshot()` / `subscribeLifecycle()` and
`getSizeSnapshot()` / `subscribeSize()` are focused streams that do not wake for
unrelated frames.

`getGltfAssetSnapshot(asset)` and `subscribeGltfAsset(asset, listener)` expose
focused `idle` / `loading` / `ready` / `error` state for one exact source and
version. `streaming`, `ready`, and `degraded` all mean geometry is usable and
include `primitiveCount`, `bounds`, and
`textures: { total, loading, ready, failed }`. `streaming` has outstanding
images, `ready` has completed without image failures, and `degraded` remains
drawable after one or more image failures. Texture progress never stalls
geometry publication. Loading and content errors stay on that asset lifecycle;
they are not reported as scheduled-frame failures.

`getPrefilteredEnvironmentSnapshot(environment)` and
`subscribePrefilteredEnvironment(environment, listener)` expose the focused
`idle` / `loading` / `ready` / `error` lifecycle for one exact offline
environment source/version. Ready describes validated retained bytes; GPU
admission remains part of the root resource snapshot, and denial uses the
studio fallback instead of a partial cubemap.

Direct geometry and the accepted static glTF profile lower into the same
canonical indexed-triangle, material, texture, LOD, and picking paths. glTF
geometry becomes drawable before optional images finish; materials retain
neutral slot-specific fallbacks until their exact authored textures publish.
Exact picking consumes the retained scene geometry, while optional
`pickingGeometry` replaces only CPU intersection and never allocates a GPU
buffer. Unknown required glTF semantics fail instead of silently approximating
support. The repository's
[conformance ledger](../../docs/specs/conformance-and-review.md) is the
authoritative feature and limitation inventory.
The dedicated `@royal/renderer-webgl/xr` entrypoint exposes
`createWebXrSessionRenderer(root, session, options)` for lower-level hosts. It
borrows the root's existing context, acquires exclusive external-clock
authority, and submits all ordered views as one frame transaction. LOD demand
uses maximum coverage across the views, upload admission remains root-wide, and
Royal re-establishes its GL state after browser runtime work. The session host
still owns `session.requestAnimationFrame`; React applications should use the
higher-level `@royal/react/xr` lifecycle instead.
