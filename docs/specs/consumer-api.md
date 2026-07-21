# Consumer API contract

Status: accepted pre-release API direction

## Consumer tasks first

Royal's primary consumer is a React application rendering glTF scenes. Public
API is evaluated by the shortest clear path for these tasks:

- render a scene in a CSS-sized canvas;
- load and progressively display glTF;
- orbit, fit, and imperatively update a camera;
- observe asset, texture, renderer, and canvas state without polling;
- select material variants;
- render and update many instances;
- identify and handle exact picked objects;
- opt into authored/automatic VT and XR;
- diagnose load, memory, and frame behavior without using diagnostics as app
  control state.

Backend architecture does not earn public vocabulary. A consumer should not
need to know frame packets, passes, WebGL state, texture units, cache entries,
worker jobs, or resource owners.

The canonical React XR composition is a control under the same `Canvas`:

```tsx
const xr = useXrSession({
  mode: "immersive-vr",
  session: { optionalFeatures: ["local-floor"] },
});

<button onClick={() => void xr.enter()} disabled={xr.status !== "available"}>
  Enter XR
</button>
```

`useXrSession` is exported only by `@royal/react/xr`. Its serializable lifecycle
snapshot uses one `status` authority; `enter`, `exit`, and
`refreshAvailability` are explicit controls. `suspended` retains a browser-
hidden live session, while `blocked` and `error` retain an actionable message.

## Entrypoints

The intended entrypoints are:

- `@royal/react`: `Canvas`, controls, hooks, status, events, and the imperative
  product root escape hatch;
- `@royal/react/scene`: pure scene constructors and their semantic types;
- `@royal/react/xr`: optional session lifecycle and XR integration;
- `@royal/renderer-core`: the same pure scene vocabulary for non-React hosts and
  renderer adapters;
- `@royal/renderer-webgl`: lower-level WebGL host integration;
- `@royal/renderer-webgl/ktx2`: side-effect-free offline validation and compact
  inspection of Royal's exact directly uploadable ETC2 KTX2 profile;
- narrow optional WebGL capability/XR subpaths where the host owns those
  browser APIs deliberately.

The main React entrypoint MUST NOT re-export the scene-constructor barrel.
Examples use the React entrypoint for runtime behavior and `/scene` for authored
renderer data so imports communicate ownership and tree-shaking boundaries.
Pure orbit view, fit, transform, and camera helpers follow the same `/scene`
rule; the main entrypoint exposes only controllers, controls, hooks, and the
view types those runtime APIs consume or return.

Importing an entrypoint performs no probing, worker creation, fetch, global
registration, or GL work. XR, VT rasterization, IBL transport, and codecs are
not initial main-entrypoint consequences.

## Primary composition

The canonical composition remains:

```tsx
const asset = gltf({ src: '/scene.glb' });
const orbit = useOrbitCamera({ initial: { distance: 4 } });
const renderScene = useMemo(() => scene({
  camera: orbit.camera,
  nodes: [asset],
}), [orbit.camera]);

return (
  <Canvas scene={renderScene}>
    <GltfOrbitCameraFit node={asset} orbit={orbit} />
    <OrbitControls orbit={orbit} />
  </Canvas>
);
```

`Canvas` renders an ordinary `<canvas>` and ordinary React children under the
same React tree. There is no renderable JSX scene reconciler. CSS owns layout;
Royal owns backing resolution. Native `width`/`height` props are excluded to
avoid conflicting authorities.

Backing resolution follows the browser device pixel ratio by default.
`pixelRatio={1}` (or another positive finite ratio) is the explicit React
policy override; changing it resizes the retained root without recreating the
canvas or WebGL context. `useCanvasSize().pixelRatio` reports the applied
request under either policy. This is display policy, not a renderer creation
option.

Native canvas props, `aria-*`, `role`, class/style, event handlers, refs, and
application `data-*` metadata pass through where they do not conflict with
Royal ownership. Royal does not invent an accessibility tree for arbitrary 3D
content; the application owns semantic controls, labels, descriptions, and
equivalent non-visual UI using ordinary React.

`scene` is a complete `readonly` intent snapshot, not a mutation command or
render-pass list. Constructors defensively copy caller-owned tuples/arrays but
do not pay for runtime freezing. Equal rebuilt descriptors have equal meaning;
callers are not required to preserve JavaScript object identity for semantic
correctness.

## Descriptors

Constructors use one options object except where a short source/size overload is
unambiguously the same operation. Input and normalized output retain the same
self-documenting field names:

- `src` for glTF and ordinary image bytes;
- `sceneIndex` for an exact zero-based glTF document scene, omitted for the document default;
- `manifestUri` for an authored VT manifest;
- `materialVariant` for an exact authored variant name;
- `pickingId` for logical interaction identity;
- `pickingGeometry` for an exact local-space triangle proxy;
- `version` when bytes behind one source identity change;
- `contentKey` only when the caller asserts decoded-content equivalence.
- `tint` for an optional scene-linear RGBA multiplier on a textured direct
  material; `color` remains the unambiguous solid-material form.

Unknown fields, invalid unions, non-finite values, invalid ranges, contradictory
options, and empty identity/source strings fail synchronously with the operation
and field named. There are no spelling aliases, positional Boolean flags,
runtime TypeScript enums, backend handles, or callbacks inside scene data.

Public authoring failures also follow ordinary JavaScript error classes:
`TypeError` means the supplied value has the wrong shape, scalar type,
finiteness, or closed-union choice; `RangeError` means a correctly shaped
finite numeric value, count, bound, or combination is outside the accepted
domain. Plain `Error` is reserved for invalid lifecycle operations such as
re-entrant resource commits, not descriptor validation.

Public types and editor documentation state units, color domain, default,
lifetime, identity, readiness, and invalidation behavior where relevant.

`triangleGeometry({ positions, indices?, normals?, textureCoordinates? })`
copies and validates caller-owned packed channels into one indexed triangle-list
descriptor. Positions are local-space XYZ metres. Indices default to sequential
triangle-soup order; normals and upper-left-origin UVs are optional unless the
chosen material needs them. The same descriptor is legal as visible mesh
geometry or `pickingGeometry`, so custom exact silhouettes do not create a
second geometry API.

## React versus imperative state

React owns coarse intent: which scene, asset source/version, variant, quality
policy, or controller exists. Versioned imperative resources own frequent
camera, render-object transform, and bulk-instance changes. Royal deliberately
does not own an application update loop; application scheduling supplies time,
while redraw occurs through an invalidating mutation or explicit `invalidate`
call.

Imperative resources have explicit staging/commit semantics, stable identity,
bounded subscriptions, and idempotent release where release is consumer-owned.
They do not require React state updates per frame.

## Observation

Every focused React observation hook follows one placement model:

```ts
interface RendererHookOptions {
  readonly root: RendererRoot | null;
}
```

Inside `Canvas`, omit options and use context. In a parent that receives
`Canvas.rendererRef`, pass `{ root }`. `null` represents the legitimate
pre-mount state. This applies consistently to canvas size, glTF status, texture
status, renderer lifecycle, renderer diagnostics, exact picking, and explicit
invalidation. `useCanvasElement` and `useCanvasRoot` are direct context accessors
and therefore remain intentionally Canvas-only.

`useRendererSnapshot()` is the broad React diagnostics subscription. It returns
`undefined` before mount, accepts the same optional `{ root }`, and may wake for
every submitted frame or resource change. It is deliberately unsuitable as a
replacement for focused product-status hooks.

The lower-level aggregate types are importable as `RendererContextSnapshot`
and `RendererResourceSnapshot`; consumers never need to name a private owner
module to type a stored diagnostic or selector. Inactive optional subsystems
still report the root's configured policy—for example VT reports the actual
upload budget and automatic-VT choice before its lazy runtime exists.

Focused status hooks return small discriminated unions and push changes without
polling. Every focused lifecycle uses the self-describing `status` discriminator;
`state` is reserved for internal state machines. Product decisions use focused
status:

- glTF: `idle`, `loading`, `streaming`, `ready`, `degraded`, `error`;
- ordinary texture: `idle`, `loading`, `ready`, `error`;
- prefiltered environment: `idle`, `loading`, `ready`, `error`;
- authored VT through `useVirtualTextureAssetStatus` additionally exposes
  `unsupported` and `pendingPages`;
- renderer lifecycle: `available`, `unavailable`, `failed`, `disposed`.

Focused status identity objects do not require scene-descriptor discriminator
fields. For example, `{ src, version }` and `{ manifestUri, version }` are
enough for ordinary-texture and authored-VT observation respectively. Passing
a complete valid descriptor variable remains supported.

Status-hook object inputs expose only fields that participate in their retained
identity. glTF status uses `src`/`version`/`sceneIndex`, prefiltered-environment
status uses `src`/`version`; ordinary
decoded-texture status uses `src`/`contentKey`/`version`. Passing a complete
scene descriptor remains structurally valid, but ignored presentation fields
such as bounds, sampler, color space, intensity, and rotation are not falsely
advertised as status identity.

`error` exists only in the corresponding failure state. Readiness definitions
match the asset and texture specifications. Ordinary-texture `ready` means
decode succeeded and reports the fitted dimensions; the bounded CPU handoff
may already have been released. GPU admission denial stays in root resource
diagnostics and does not rewrite successful decode status into a content error.
Root-wide diagnostics are cold, bounded operational observation and MUST NOT be
the only way to drive normal loading, variants, fitting, retries, or lifecycle UI.
Drawable glTF status includes selected-scene node, primitive, and punctual-light
counts, the actual resolved `sceneIndex`, the complete lightweight
`scenes: { index, name? }[]` document inventory, document-declared
material-variant names, and
`textures: { total, loading, ready, failed, fallback }`. `fallback` counts ready
logical textures whose preferred representation failed and whose declared
alternative won; it is not a second texture or an asset failure. Consumers do
not parse a second copy of the glTF merely to populate scene/variant controls or
summaries. Reporting the inventory does not prepare or fetch unselected scene
content.

Royal owns a bounded asynchronous preparation scheduler shared across glTF,
ordinary textures, authored VT, and prefiltered environments. Its limit and
lane policy are renderer implementation details rather than consumer creation
options. Broad renderer diagnostics expose
`resources.asyncPreparation: { activeJobs, jobLimit, queuedJobs,
queuedForegroundJobs, queuedDetailJobs }` for operational inspection. The two
queued lane counts sum to `queuedJobs`; they diagnose scheduling and are not
separate consumer lifecycles. Focused asset status remains the product
lifecycle.

Royal also owns the bounded ordinary-texture upload pacing policy. Broad
diagnostics expose
`resources.ordinaryTextureUploads: { admittedBytes, budgetBytes, deferredUploads }` for
the latest submitted frame. Deferral is renderer scheduling, not an asset
failure or a separate consumer lifecycle. Neither scheduler policy is a public
tuning knob; future implementations may change their strategy without breaking
consumer code.

`usePrefilteredEnvironmentStatus(environment)` observes the exact `src` and
typed `version` identity. `ready` means the artifact bytes have been fetched
and validated and reports its face size, mip count, and provenance. GPU budget
admission remains renderer diagnostics rather than a second asset lifecycle;
denial keeps the documented studio fallback visible.

Server rendering and pre-mount observation return stable unavailable/idle
snapshots rather than touching DOM/WebGL or throwing due solely to absence of a
mounted root. A hook used neither inside `Canvas` nor with `{ root }` throws an
actionable placement error.

## Picking and events

Scene nodes declare `pickingId`; React callbacks live in
`Canvas.scenePointerEvents` under that ID. Handler changes do not rebuild the
scene. Duplicate handler-target IDs are rejected as ambiguous. Imperative
`pick`, React pointer events, and XR rays return the same stable target shapes.
The public callback vocabulary is `ScenePointerEvent`,
`ScenePointerEventHandler`, `ScenePointerEventHandlers`, and
`ScenePointerEventType`; package-brand prefixes and a misleading component
`Props` alias are not part of the API.

`pickingGeometry` changes only exact local-space triangle intersection. It does
not change visual geometry, allocate GPU geometry, or create a second identity,
event, loading, or lifecycle path.

`data-*` remains native DOM metadata/test selection on the canvas. It is not a
Royal scene protocol.

## glTF and textures

`gltf(src)` and `gltf({ src, ... })` are equivalent. `sceneIndex` selects one
zero-based document scene before mesh/Draco inventory and canonical lowering;
omission uses the document's declared default, or index zero when absent. A
normalized node exposes its exact asset reference so status observation does
not reconstruct version or scene identity from strings.

`imageTexture(src)` defaults to sRGB color interpretation and the ordinary image
sampler. `textureAsset` is the explicit form when `contentKey` is needed.
`virtualTexture(manifestUri)` names authored VT; automatic VT remains a renderer
creation policy, not a different material constructor.

Source selection, fallback, compression, SVG rasterization, and VT are not
different material APIs. Materials receive a texture reference with one visible
orientation and color/alpha contract.

## Lower-level root

`createRendererRoot(canvas, options)` accepts the same pure scene descriptors as
`Canvas`. It owns one canvas renderer lifetime and exposes render, invalidate,
pick, focused asset/texture observation, lifecycle/frame observation, bounded
diagnostics, snapshot, and idempotent dispose operations.

`root.setSize({ cssWidth, cssHeight, pixelRatio })` uses the same backing-pixel
policy name as React. `pixelRatio` is a requested ratio, not necessarily the
browser device pixel ratio; the resolved size reports both that request and any
additional capability-driven `renderScale`.

`resolveRendererRootOptions(options)` validates a creation policy and returns its
fully explicit immutable values. It is intended for host wrappers that need to
compare or report effective policy without reconstructing Royal's defaults.

Creation options are immutable for a root. In React, changing a creation option
replaces the root and canvas; changing `scene` does not. The replacement mount
publishes `null` rather than a stale disposed root until the new canvas-owned
root is live. Backend-only scheduling classes, GL handles, extension objects,
and internal resource policies are not product options.

## Consumer-DX adversarial review

### Convenient barrel becomes ambiguous

Attack: export every scene constructor from `@royal/react` so one import appears
shorter.

Resolution: reject. Separate runtime and scene imports make React ownership,
pure-data reuse, and reachable-code boundaries obvious.

### Context-only hooks trap parent UI

Attack: lifecycle or status UI outside `Canvas` needs bridges or polling.

Resolution: every focused observer accepts the same explicit-root option and
the same null pre-mount semantics.

### One generic status/diagnostics object

Attack: fewer hooks look simpler but force unrelated rerenders, large snapshots,
polling, and backend vocabulary into product UI.

Resolution: focused discriminated status is primary; root diagnostics remain
cold and operational.

### React owns per-frame renderer state

Attack: idiomatic React is misread as `setState` for every camera, instance, or
animation step.

Resolution: ordinary React owns composition while explicit versioned resources
own high-frequency state. No custom reconciler is required.

### Friendly overloads become aliases

Attack: accept `src`, `uri`, `url`, objects, positional flags, and deprecated
spellings to guess consumer intent.

Resolution: retain only a short overload that is exactly equivalent to the one
canonical options field. Correct misspellings directly before release.

### Public API mirrors glTF or WebGL internals

Attack: expose extension objects, texture units, passes, shader flags, buffers,
or cache identities for flexibility.

Resolution: lower format detail and keep backend consequences private. Add a
public concept only when a renderer consumer needs to express or observe it.
