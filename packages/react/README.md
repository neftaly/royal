# @royal/react

React adapter for Royal. It renders Royal scene descriptors into a canvas
without using the DOM as the scene model.

Examples and documentation should import React adapter APIs from `@royal/react`
and render graph primitives from `@royal/react/scene`.

## Example

`<Canvas>` is the primary React API. It owns the canvas element, requires one
pure Royal `scene` prop, and can host React-only control components such as
`<OrbitControls>`.

The WebGL renderer currently supports a practical glTF subset: `.gltf` and
`.glb` documents, external/data URI/GLB BIN buffers, bufferView images, node
hierarchies and transforms, mesh primitives with `POSITION`/`NORMAL`/selected
`TEXCOORD_n` accessors, sparse and strided accessors, normalized integer
attributes, `UNSIGNED_BYTE`/`UNSIGNED_SHORT`/`UNSIGNED_INT` indices, triangle
and line drawing, rigid node transforms, base color factor/texture/sampler data,
and selected required extensions. Assets requiring skeletal or morph
deformation fail explicitly until a prepared deformation runtime is added.
That supported required-extension set includes meshopt-compressed bufferViews
via `EXT_meshopt_compression` and KTX2/Basis base-color textures via
`KHR_texture_basisu` through an RGBA8 transcode path.
Required `KHR_animation_pointer` assets fail explicitly.

```tsx
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import {
  boxGeometry,
  directionalLight,
  gltf,
  gltfInstances,
  linearRgbaFromSrgb,
  mesh,
  scene,
  standardMaterial,
} from '@royal/react/scene';
import { useMemo } from 'react';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: linearRgbaFromSrgb([0.9, 0.2, 0.16, 1]) });
const helmetSrc = '/DamagedHelmet/DamagedHelmet.gltf';

export function App() {
  const orbit = useOrbitCamera({ initial: { distance: 5 } });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    nodes: [
      directionalLight({ direction: [1, -2, -1], color: [1, 1, 1, 1] }),
      mesh({ geometry: cube, material: red }),
      gltf({ src: helmetSrc, variant: 'display' }),
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

Public color fields use scene-linear `LinearRgba` tuples. Convert normalized
artist-authored sRGB values with `linearRgbaFromSrgb(...)`; image textures use
sRGB by default. Mesh and glTF transforms default omitted `position` and
`rotation` to `[0, 0, 0]` and omitted `scale` to `[1, 1, 1]`.

`useOrbitCamera({ initial: ... })` reads `initial` once. It returns a stable,
explicit `cameraResource`; orbit gestures stage pose values and commit them
directly to every renderer root using the scene, without a React render or scene
reconstruction. Use `orbit.getView()` for an imperative read, or
`useOrbitCameraView(orbit)` only when React UI must observe the view.

Camera resources expose writable `Float64Array` pose staging. Renderer roots
continue using the last committed view until `commit()` succeeds; an unchanged
commit is silent and preserves the version. Immutable `perspectiveCamera()` and
`orthographicCamera()` descriptors remain the simpler path for static or
Tarstate-derived scene snapshots.

The imperative `createRendererRoot(canvas)` path accepts the same pure scene
descriptors as `Canvas.scene`. It does not create or evaluate React elements.

### WebXR

`@royal/react/xr` provides an explicit session store and the renderer bridge;
it does not own an application's WebXR workflow. `createXrSessionStore()` keeps
serializable UI state separate from the live session object and exposes
semantic actions for availability, blocked acquisition, live-session lifecycle
transitions, and optional frame telemetry. A live session moves through
`starting`, `active` or `suspended`, and `ending`; `blocked` means no session was
acquired, with a closed `blockReason` that UI can inspect. The serializable
snapshot exposes only lifecycle data, while `selectXrSessionControlSnapshot()`
exposes the browser-owned session object. `createXrSessionRenderer()` owns the
Royal render layer and reference space until disposal.

The store's initial state accepts only `available` and `mode`, because a newly
created store cannot already own a browser session. Omit `available` to begin in
`checking`; pass it explicitly to begin in `available` or `unavailable`.

The application owns support detection, session request/end policy, the
animation-frame loop, and controller or input picking. Forward the session's
`visibilitychange` events through `setSessionVisibility()` so a hidden session
remains owned but is reported as `suspended`. Use `blockSession()` only when a
request failed before ownership, such as another immersive session already
being active. Frame snapshots are
opt-in telemetry: only connect `onFrameSnapshot` to `recordFrame` when UI or
diagnostics actually consume per-frame viewport data.

### Canvas renderer options

Pass renderer creation options through `Canvas.rendererOptions`, or through
`createRendererRoot(canvas, options)` when you own the canvas. These values are
fixed for an imperative root and are available as `root.options`. Changing them
on `<Canvas>` recreates its renderer root.

```tsx
<Canvas
  rendererOptions={{
    generatedImageVirtualTextures: true,
    generatedSvgVirtualTextureRasterDensity: 4,
  }}
  scene={renderScene}
/>
```

The imperative root separates its two observational models:

- `root.snapshot()` returns the current frame, normalized creation `options`,
  and a backend-neutral `lifecycle` with `state`, `generation`,
  `interruptions`, and `recoveries`.
- `root.diagnostics()` returns bounded messages and operational counters. It
  does not repeat root state or retain the submitted scene graph.

- `alpha` and `antialias` both default to `true` and are requests made when the
  WebGL context is created.
- `generatedImageVirtualTextures` defaults to `false`. Enable it to generate
  VTs for ordinary base-color image textures used by triangle geometry with
  `TEXCOORD_0`. SVG sources are not subject to the raster size threshold;
  decoded raster sources qualify when their longest dimension is at least 257
  px. The ordinary texture remains active until generated coverage is ready.
  Authored `virtualTexture(...)` resources are unaffected.
- `generatedSvgVirtualTextureRasterDensity` is the number of logical virtual
  texels per authored SVG CSS pixel. It defaults to `4`, accepts values greater
  than zero through `16`, and only has an effect when generated virtual textures
  are enabled. It controls close-zoom texture detail without changing layout or
  world size, preserves aspect ratio, and caps the generated longest side at
  16384 logical texels. SVG `viewBox` coordinates are not treated as raster
  pixels.
- VT atlases and page tables participate in `resourceGovernorPolicy` as
  `classes['virtual-texture'].persistentGpuBytes`. Its `softLimit` marks
  borrowing for diagnostics, while optional `hardLimit` sets an exact class
  ceiling. With no hard limit, VTs may borrow root GPU capacity not protected
  by another class's mandatory floor. Manifest `physicalByteBudget` and
  `physicalSlots` remain per-texture quality and footprint ceilings.

Use `virtualTexture('/terrain.vt.json')` from `@royal/react/scene` for an
authored manifest. The string and the object form
`virtualTexture({ manifestUri: '/terrain.vt.json' })` are equivalent. See the
[manifest, orientation, and fallback contract](../../docs/virtual-textures.md).

The main `@royal/react` JSX runtime is ordinary React. Royal does not create a
second React root, so outer Context, ErrorBoundary, and Suspense semantics stay
normal. Read app state in React, pass immutable snapshots to pure scene
builders, and keep imperative frame work in control children.

React commits render the latest descriptor graph immediately. Use
`useInvalidate()` inside `<Canvas>` only for changes React did not commit, such
as external store mutations, imperative animation state, or host integration
events. Royal render-object refs already invalidate the current canvas when
their transform changes. `useFrame()` supplies animation timing but does not
redraw by itself: a React state commit, a render-object mutation, or an explicit
`useInvalidate()` call requests the next render. Multiple invalidations before
that render are coalesced.

glTF material variants from `KHR_materials_variants` can be selected with
`gltf({ src, variant })`. Pass a variant name, or pass a zero-based variant
index when an asset has unnamed variants.

`useGltfAssetStatus(src)` observes an asset retained by the surrounding Canvas
and returns a status discriminated by `state`. It is frame-driven and does not
poll renderer diagnostics. Pass the normalized `node.asset` instead of a string
when using an explicit asset `version`.

Both asset and renderer lifecycle results are discriminated unions: `error` is
required only when `state === 'error'` for an asset or `state === 'failed'` for
the renderer. Both hooks use React's external-store snapshot contract and
return stable `idle`/`unavailable` snapshots during server rendering and before
the Canvas root exists. `useRendererLifecycle()` observes the surrounding
Canvas without polling and returns its availability, generation, interruption,
and recovery counters. This makes status UI exhaustive and keeps recovery
details out of the imperative root path:

```tsx
import { useRendererLifecycle } from '@royal/react';

function RendererStatus() {
  const lifecycle = useRendererLifecycle();
  return <output>{lifecycle.state === 'failed' ? lifecycle.error : lifecycle.state}</output>;
}
```

Interactive nodes provide an explicit `pickingId`; React handlers live in the
separate `Canvas.scenePointerEvents` map under that ID. The ID is the logical gesture
identity, so handler-only changes do not resubmit the scene and pointer-down/up
and hover stay coherent across immutable scene replacement.

```tsx
<Canvas
  scene={renderScene}
  scenePointerEvents={{
    helmet: { onClick: ({ hit }) => select(hit.target) },
  }}
/>
```

For many copies of one asset, create one stable transform resource and render
one `gltfInstances(...)` node instead of thousands of individual nodes.
The position, rotation, and scale arrays use three consecutive numbers per
instance. Positions are metres, rotations are radians, and scales are
dimensionless multipliers. Mutate them outside React render, then commit the
channel once:

```tsx
import { createGltfInstanceTransforms } from '@royal/react/scene';

const instances = useMemo(() => createGltfInstanceTransforms({
  count: 4096,
  positions,
  rotations,
  scales,
}), []);

const renderScene = useMemo(() => scene({
  camera,
  nodes: [gltfInstances({ src: '/cube.gltf', instances })],
}), [camera, instances]);

function InstanceAnimation() {
  useFrame(({ elapsedSeconds }) => {
    for (let index = 0; index < instances.count; index += 1) {
      instances.rotations[index * 3 + 1] = elapsedSeconds;
    }
    instances.commitPose();
  });
  return null;
}

return <Canvas scene={renderScene}><InstanceAnimation /></Canvas>;
```

`commitPose(start, count)` and `commitScale(start, count)` identify the exact
logical rows changed. Royal coalesces adjacent packed uploads independently in
every attached renderer root; commits never render React objects per instance.
Pose values must be finite and scales must be finite and non-negative. Optional
unique `logicalIds` remain stable picking identity when culling repacks GPU
slots. Canvas coalesces commit invalidations at the end of the active frame.

## Workflows

From the repository root:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:package-consumer
pnpm --filter @royal/examples-react test:browser
```
