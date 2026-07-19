# Interaction and XR

## Picking input and output

Canvas point picking accepts finite `clientX`/`clientY` CSS-pixel coordinates,
matching DOM pointer events. The renderer converts through the canvas client
rectangle, canvas framebuffer size, and current camera/view state. DPR, CSS
scaling, canvas offset, and transparent canvas presentation MUST NOT skew the
ray.

A successful result contains the original client coordinate, front-most world
hit point and ray distance in metres, and one stable target:

- mesh node;
- glTF node occurrence;
- explicit glTF bulk instance with stable `instanceIndex` and optional
  `instanceId`.

No hit returns `undefined`. Packed slots, draw order, packet index, or frame
number MUST NOT appear as logical identity.

## Shared visible/pick path

Picking and visible rendering MUST share canonical transforms, geometry
normalization, instance changes, LOD occurrence identity, culling decisions,
sidedness, and alpha-mask policy. Broad-phase structures may differ from frame
draw lists, but they consume the same retained records and revisions.

Optional `pickingGeometry` is an exact triangle proxy in the node's local
space. It replaces only the exact-intersection geometry. It MUST work before a
glTF asset prepares, MUST use the node/instance transform and identity from the
normal path, MUST NOT allocate a GPU resource, and MUST NOT create a parallel
event or lifecycle path. A proxy is authoritative geometry and does not
implicitly inherit a visual material's UV mask: no equivalence exists between
unrelated proxy and render UV topology.

When no proxy exists, pickable rendered triangle geometry defines the visual
outline. Royal MUST NOT use an asset bounding box as an exact hit merely because
geometry is still loading. A conservative bounds test is only a broad phase.

## Hit semantics

The nearest legal surface wins. Backface behavior matches visible sidedness.
Alpha-mask fragments below cutoff are not hits. Opaque geometry is hit regardless
of color alpha. Transparent/blended geometry currently uses its triangle
surface rather than per-texel alpha; this is a documented limitation and must
not vary by input device.

Exact mask picking interpolates the selected authored UV set barycentrically,
applies `KHR_texture_transform`, sampler wrap, base-color alpha factor, and
cutoff in the canonical CPU query. Missing or failed pixels follow the visible
opaque neutral fallback, so a progressively arriving mask may refine a hit.
Because a ray has no pixel derivatives, the current query samples retained base
alpha with the magnification filter rather than guessing a GPU minification
mip. Close/intermediate silhouettes are exact; minified mip silhouettes are a
documented approximation until the query accepts an explicit ray footprint.

LOD changes preserve the parent logical target. Instance indices refer to the
authored/caller instance channel, never a compacted visible index.

## React events

`Canvas.scenePointerEvents` maps stable `pickingId` values to handlers. Scene
descriptors carry identity but not React callbacks. This separation keeps pure
scene data reusable and prevents event closures from entering renderer caches.

React handlers use `onPointerEnter`, `onPointerLeave`, `onPointerMove`,
`onPointerDown`, `onPointerUp`, and `onClick`. Royal synthesizes enter/leave from
front-most target transitions and keeps pointer-down/click bookkeeping in the
canvas interaction owner. Handler updates MUST take effect without recompiling
the scene or changing pick identity.

`data-*` attributes are appropriate for DOM metadata and test selectors on the
canvas or surrounding UI. They are not Royal scene identity, material state, or
renderer configuration. Idiomatic React props and typed descriptors remain the
public API for renderer behavior.

## Picking cost

Pointer move MAY be coalesced to the next appropriate animation frame. Picking
MUST NOT render a color-ID framebuffer merely to answer CPU-exact geometry that
is already retained. Broad phase must bound exact triangle work. Scratch storage
SHOULD be retained and high-water bounded so repeated pointer movement does not
produce proportional garbage.

The imperative root `pick` and React pointer events call the same query. XR ray
picking, when exposed, MUST lower to that same canonical query/identity model
after constructing its ray; it MUST NOT invent controller-specific targets.

## XR lifecycle model

Capability and owned-session lifecycle are separate. Capability checking yields
`checking`, `available`, or `unavailable`. Acquisition may be `starting`,
`blocked`, or `error` without claiming an active session. A live session moves
through `active`, `suspended`, and `ending`.

`suspended` means a live owned session is browser-hidden. The valid case where
immersive XR remains alive in the background while a 2D browser is foregrounded
MUST retain its session identity and resources. It is not an acquisition error.

The public snapshot is serializable and excludes the browser session object.
The control snapshot separately owns that session. `status` is the lifecycle
authority; there is no duplicate `active` boolean.

## XR renderer ownership

The XR runtime owns exactly one session renderer, session RAF chain,
visibility/end listeners, root-lifecycle subscription, and terminal cleanup.
It uses the root's existing context and acquires the root's external clock; it
MUST NOT call `getContext` again.

Each XR frame obtains ordered views and runtime-owned framebuffer from WebXR and
submits one multi-view renderer transaction. Royal never deletes the runtime
framebuffer. Runtime callbacks are cancelled and external-clock ownership is
released exactly once on session end, explicit disposal, root failure/context
loss, or startup failure.

If `session.end()` rejects, an otherwise live renderer remains usable and the
state returns from `ending` to `active` or `suspended` with the error retained.
Immediate `dispose()` releases Royal resources even while the browser end
request remains unresolved.

## XR performance

XR uses the session RAF and is continuously rendered while active. It MUST NOT
also run the ordinary canvas RAF. Frame planning considers both eyes together;
resource upload and preparation budgets remain root-wide per submitted XR
frame.

Visibility changes, a foreground browser, headset removal, a downward-looking
stationary pose, and thermal throttling are real runtime conditions. They may
affect measured performance but MUST NOT corrupt lifecycle, accumulate queued
frames, or trigger unbounded VT demand.
