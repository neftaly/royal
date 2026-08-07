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
  renderer: {
    depthRange: { far: 20, near: 0.01 },
    preferredFrameRate: "highest",
  },
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
`renderer.preferredFrameRate` accepts `"highest"` or a positive number and is a
best-effort preference: unsupported browsers retain their selected rate rather
than failing session acquisition. `renderer.depthRange` is the explicit
positive clipping interval forwarded to the browser-owned XR projection.

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
    <GltfOrbitCameraFit clipping="track-bounds" node={asset} orbit={orbit} />
    <OrbitControls orbit={orbit} />
  </Canvas>
);
```

`Canvas` renders an ordinary `<canvas>` and ordinary React children under the
same React tree. There is no renderable JSX scene reconciler. CSS owns layout;
Royal owns backing resolution. Native `width`/`height` props are excluded to
avoid conflicting authorities.

Tracked orbit clipping is driven only by the transformed bounds passed through
the fit component. It tightens after camera movement, retains the orbit's
authored `near` as a minimum, and is replaced by an explicit
`orbit.setProjection(...)` call. The renderer does not scan currently drawn
surfaces to invent camera policy.

Backing resolution follows the browser device pixel ratio by default.
`pixelRatio={1}` (or another positive finite ratio) is the explicit React
policy override; changing it resizes the retained root without recreating the
canvas or WebGL context. `useCanvasSize().pixelRatio` reports the requested
ratio under either policy. This is display policy, not a renderer creation
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
  material or every selected glTF base color; `color` remains the unambiguous
  solid-material form.

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

## Borrowed prepared glTF geometry

`RendererRoot.visitGltfAssetGeometry(asset, visitor)` is the cold spatial-tool
boundary for a glTF claimed by either the scene or the explicit non-visual
asset claim. The React equivalent is `useVisitGltfAssetGeometry()`. It returns
`undefined` until the exact source/version/scene identity is prepared,
otherwise the number of batches visited (including zero for an empty selected
scene).

Each callback receives one shared indexed-position geometry identity and one or
more packed column-major asset-space transforms. Royal visits only the
highest-detail geometry of an authored node LOD set, so spatial consumers do
not accidentally union overlapping visual levels. Instancing remains a packed
batch instead of becoming copied per-occurrence geometry.

Geometry channels and transforms are borrowed and valid only during that
callback. A consumer which retains, merges, simplifies, or indexes them must
copy the required values and owns that result. Calling the visitor performs no
source read or codec decode, and consumers which never call it receive no
geometry publication in ordinary status.

Prepared `bounds` are a conservative asset-space AABB for framing, coarse
layout, and broad phases. They are not contact, collision, resting, or support
geometry. Consumers which need those semantics derive an owned fit-for-purpose
representation through the borrowed geometry visitor.

Focused status identity objects do not require scene-descriptor discriminator
fields. For example, `{ src, version }` and `{ manifestUri, version }` are
enough for ordinary-texture and authored-VT observation respectively. Passing
a complete valid descriptor variable remains supported.

Status-hook inputs explicitly accept either their minimal retained identity or
the complete reference returned by the matching constructor. This makes
`useGltfAssetStatus(model.asset)` and the equivalent texture/environment forms
editor-visible rather than relying on structural excess-property rules. glTF
status keys only `src`/`version`/`sceneIndex`, prefiltered-environment status
keys `src`/`version`, and ordinary decoded-texture status keys
`src`/`contentKey`/`version`; accepted presentation fields such as bounds,
intensity, rotation, color space, and sampler do not silently become loading
identity. Authored VT is the exception where color space and sampler are
representation identity.

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
material-variant names, optional uninterpreted `rootExtras`, and
`textures: { total, loading, ready, failed, fallback }`. `fallback` counts ready
logical textures whose preferred representation failed and whose declared
alternative won; it is not a second texture or an asset failure. Consumers do
not parse a second copy of the glTF merely to populate scene/variant controls or
application metadata. `rootExtras` is the JSON value from the same canonical
root parse, scoped to the exact source/version/selected-scene identity and
reference-stable while texture progress changes. It is absent when unauthored,
readonly by contract, copied once at the public ownership boundary, and never
interpreted by Royal. Consumers own schema validation and MUST NOT treat it as
mutable renderer state. Reporting the inventory or extras does not prepare or
fetch unselected scene content.

Royal owns a bounded asynchronous CPU-preparation scheduler shared across
glTF, authored VT, and prefiltered environments. External image-texture
transport, bitmap decode, and decoded handoff use a separate bounded source
lifecycle, so network wait cannot occupy a glTF worker slot. These limits and
policies are renderer implementation details rather than consumer creation
options. Broad renderer diagnostics expose
`resources.asyncPreparation: { activeJobs, jobLimit, queuedJobs,
queuedForegroundJobs, queuedDetailJobs }` for operational inspection. The two
queued lane counts sum to `queuedJobs`; they diagnose scheduling and are not
separate consumer lifecycles. `resources.imageTexturePreparation` distinguishes
active source preparations from retained handoff reservations without calling
both browser phases decodes. When the built-in browser pipeline has ready
sources, its optional `browserStageTimings` reports the retained source count
and summed transport-wait, transport, decode-wait, and decode durations.
Its optional `encodedSourceReads` reports active/queued encoded transport,
completed staged blobs, and the exact source/byte authorities independently of
decode and GPU handoff. Custom decoders may omit both built-in projections.
Focused ready texture status carries the corresponding claim-to-ready and
preparation attribution for one source. Custom decoders may omit these timing
fields. Focused asset status remains the product lifecycle.

Royal also owns the bounded ordinary-texture upload pacing policy. Broad
diagnostics expose
`resources.imageTextureUploads: { admittedBytes, budgetBytes, deferredUploads }` for
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

## Contact surfaces

Filled `mesh`, `gltf`, and `gltfInstances` nodes accept
`surfaceDepth: "contact"` when their visual triangles are intentionally
authored directly on opaque support geometry. This is a semantic presentation
choice, not a numeric z-index or transform adjustment. It leaves bounds,
picking, sorting, alpha, and source identity unchanged and does not define an
order among multiple contact nodes. Wireframes reject the option.

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

## Render-object refs

`mesh({ ref })` and `gltf({ ref })` publish the same backend-neutral
`RenderObjectHandle` contract re-exported by React. `position`, `rotation`,
`scale`, and `setTransform()` update one attached object's retained transform
and request a frame without rebuilding or republishing the scene descriptor.
Exact picking observes the same transform immediately.

Every public Euler tuple uses the matrix semantics of Three.js's default
`Euler(x, y, z, "XYZ")`. Cameras, environments, render objects, direct meshes,
glTF root transforms, and Royal-owned Euler instance streams share that one
convention. Authored glTF node quaternions and explicit matrices remain glTF
transforms; there is no Euler-order field or compatibility mode.

Refs may be object or callback refs. Attachments sharing one ref share one
handle and notify every attached renderer root; removing one attachment does
not clear the ref while another remains. A later declarative `transform`
becomes authoritative and synchronizes the existing handle. Final detach and
root disposal publish `null`. This is a local transform escape hatch, not an
animation loop, drag protocol, scene graph, physics API, or application-state
owner.

## glTF and textures

`gltfAsset(src)` creates a validated source/version/scene loading identity
without creating a scene node. `gltf(src)` and `gltf({ src, ... })` create a
visible node with that same asset identity. `sceneIndex` selects one
zero-based document scene before mesh/Draco inventory and canonical lowering;
omission uses the document's declared default, or index zero when absent. A
normalized node exposes its exact asset reference so status observation does
not reconstruct version or scene identity from strings.

`Canvas.gltfAssetClaims` is the complete declarative render-ready preload
claim; the imperative equivalent is
`RendererRoot.setGltfAssetClaims(assets)`. Claimed assets use the ordinary
bounded preparation, custom transport, cancellation, deduplication, focused
status, borrowed geometry, and material-image paths. They create no surfaces,
GPU geometry or textures, lights, picking targets, transform work, or
presentation frame. Geometry and metadata publish progressively while selected
material images prepare under the ordinary bounded texture lifecycle. This
lets an imminent visible handoff reuse decoded sources without a second loader
or consumer URL protocol. Moving the same identity between the claim and scene
does not read or prepare it again. `Canvas` bridges both handoff directions; imperative callers
can commit both sides atomically with
`RendererRoot.setScene(scene, gltfAssetClaims)`. When using separate setters,
install the incoming visual or non-visual owner before removing the outgoing
one. Observation alone never creates a claim.

`materialVariant` selects one authored `KHR_materials_variants` name. `tint`
is a presentation multiplier applied after base/variant/LOD selection; it does
not rewrite the glTF, change asset identity, duplicate prepared geometry or
textures, or create an application-owned material cache. Equal tint values over
one prepared material share Royal's canonical material identity.

`imageTexture(src)` defaults to sRGB color interpretation and the ordinary image
sampler. `textureAsset` is the explicit form when `contentKey` is needed.
`virtualTexture(manifestUri)` names authored VT; automatic VT remains a renderer
creation policy, not a different material constructor.

Source selection, fallback, compression, SVG rasterization, and VT are not
different material APIs. Materials receive a texture reference with one visible
orientation and color/alpha contract.

## Lower-level root

`createRendererRoot(canvas, options, dependencies)` accepts the same pure scene
descriptors as `Canvas`. It owns one canvas renderer lifetime and exposes
render, non-visual glTF claims, invalidate, pick, focused asset/texture
observation, lifecycle/frame observation, bounded diagnostics, snapshot, and
idempotent dispose operations.

The optional stable dependency `gltfResourceReader(resource, signal)` reads
complete bytes for glTF root documents, referenced buffers, and external
images. `resource.kind` distinguishes `root`, `buffer`, and `image`; `uri` is
the supplied root `src` for `root` and the root-resolved URI for referenced
buffers/images. `version` is the root asset's declared byte revision. Equal
URI/version identities within one renderer root
MUST produce equal bytes. Royal, rather than the callback, owns in-flight claim
deduplication, bounded retention, last-claim cancellation, decode reuse, and
error publication. This is the supported path for authenticated, verified, or
application-cached bytes and does not require Blob URLs. A custom reader returns
complete bytes whose view becomes Royal-owned and may be transferred to a
worker. A host that retains its source storage returns an owned copy; a host
that hands off an unretained view preserves the zero-copy path. HTTP range
negotiation remains an optimization of Royal's default fetch transport, not a
second public storage protocol.

`root.setSize({ cssWidth, cssHeight, pixelRatio })` uses the same backing-pixel
policy name as React. `pixelRatio` is a requested ratio, not necessarily the
browser device pixel ratio; the resolved size reports both that request and any
additional capability-driven `renderScale`.

`resolveRendererRootOptions(options)` validates a creation policy and returns its
fully explicit immutable values. It is intended for host wrappers that need to
compare or report effective policy without reconstructing Royal's defaults.

Creation options and dependencies are immutable for a root. In React,
`Canvas` accepts the reader directly as `gltfResourceReader`; changing its
identity replaces the root, while changing `scene` does not. Applications
SHOULD retain one stable function for the intended root lifetime. Changing a
creation option also replaces the root and canvas. The replacement mount
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
