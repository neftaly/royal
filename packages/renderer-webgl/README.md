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
  pixelRatio: window.devicePixelRatio,
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
Royal owns bounded, fair preparation scheduling across glTF, ordinary textures,
VT, and prefiltered environments. Newly claimed scene, environment, and
visible-VT work has bounded priority over detail work; FIFO order is preserved
within each lane and detail work cannot starve. Queued claims are cancellable.
`getSnapshot().resources.asyncPreparation` reports the current internal limit
plus active, total queued, foreground queued, and detail queued job counts.
These values diagnose renderer work; they are deliberately not creation policy.
Ordinary-texture uploads are likewise paced internally across submitted canvas
and XR frames. A larger individual texture is admitted alone so it cannot
starve. Deferred storage remains a ready asset with its neutral/current
representation and retries on the next frame.
`getSnapshot().resources.imageTextureUploads` reports admitted bytes, the
current internal budget, and unique deferrals for the latest submitted frame.

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
focused `idle` / `loading` / `streaming` / `ready` / `degraded` / `error` state
for one exact source, version, and selected document scene. `streaming`, `ready`, and `degraded` all mean geometry is usable and
include `nodeCount`, `primitiveCount`, `lightCount`, document-declared
`variantNames`, the resolved `sceneIndex`, lightweight document `scenes`,
`bounds`, and
`textures: { total, loading, ready, failed, fallback }`. `fallback` counts ready
logical textures whose preferred representation failed and whose declared
alternative won. Scene inventory does not fetch or prepare unselected scene
content. `streaming` has outstanding
images, `ready` has completed without image failures, and `degraded` remains
drawable after one or more image failures. Texture progress never stalls
geometry publication. Loading and content errors stay on that asset lifecycle;
they are not reported as scheduled-frame failures.

`visitGltfAssetGeometry(asset, visitor)` is an explicit cold path to the
highest-detail selected-scene triangles Royal already prepared. It returns
`undefined` while that exact asset identity is unavailable, or the visited
batch count once prepared. Each batch preserves shared geometry identity and
packs one or more column-major asset-space transforms, so instancing does not
become duplicated mesh data. The arrays are borrowed only for the callback;
copy values that an application deliberately retains. This path performs no
second source read or decode and does not publish geometry through status.

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

Offline asset tools may validate Royal's directly uploadable ETC2 profile
without creating WebGL or importing the renderer root:

```ts
import { inspectEtc2Ktx2 } from "@royal/renderer-webgl/ktx2";

const info = inspectEtc2Ktx2(encodedBytes);
console.log(info.colorSpace, info.width, info.height, info.storageBytes);
```

The repository command below attaches already-encoded KTX2 images to existing
core-fallback glTF textures. It accepts JSON `.gltf` and binary `.glb`, requires
the output to retain that container format, and preserves every non-JSON GLB
chunk byte-for-byte. Mappings use glTF texture indices, and KTX2 paths are
relative to the output document. It validates every input byte profile and the
linear/sRGB material-slot use before writing.

```sh
pnpm author:gltf-etc2 scene.gltf scene.etc2.gltf \
  0=textures/base-color.ktx2 3=textures/normal.ktx2
```

Large scenes can keep the mappings in a reviewable attachment file:

```json
[
  { "textureIndex": 0, "uri": "textures/base-color.ktx2" },
  { "textureIndex": 3, "uri": "textures/normal.ktx2" }
]
```

```sh
pnpm author:gltf-etc2 scene.glb scene.etc2.glb \
  --attachments=scene.etc2-attachments.json
```

This command does not encode source pixels. Encoding stays an offline pipeline
choice; Royal ships no runtime Basis/WASM transcoder. At runtime the root
enables `WEBGL_compressed_texture_etc` once. Optional `GS_texture_etc2` uses its
core fallback when unavailable, while required/direct compressed sources fail
explicitly instead of issuing an invalid upload.

Experimental `GS_texture_svg` prefers one bounded self-contained SVG source on
sRGB material slots. Optional use requires an ordinary core fallback; Royal
fetches it only after SVG transport, profile, or decode failure. Required use
may omit the core source and fails if SVG cannot publish. Both outcomes retain
one texture identity, sampler, material path and focused lifecycle. This is an
unregistered Royal vendor experiment, not a registered glTF compatibility
claim.

The dedicated `@royal/renderer-webgl/xr` entrypoint exposes
`createWebXrSessionRenderer(root, session, options)` for lower-level hosts. It
borrows the root's existing context, acquires exclusive external-clock
authority, and submits all ordered views as one frame transaction. LOD demand
uses maximum coverage across the views, upload admission remains root-wide, and
Royal re-establishes its GL state after browser runtime work. The session host
still owns `session.requestAnimationFrame`; React applications should use the
higher-level `@royal/react/xr` lifecycle instead.
