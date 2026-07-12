# FramePlan / ResourceArena / Executor Landings

Date: 2026-07-11

Status: implementation note for steps 4 and 5 of
[Royal Direction](./royal-direction.md#implementation-order).

## Outcome

Land this architecture in two reviewable changes. The first removes repeated
descriptor and material lifetime scans. The second replaces transient draw
planning and moves real WebGL submission ownership out of `root.ts`.

Do not add an `executor.ts` wrapper that calls methods or callbacks on the root.
Until the draw kernels and their state move, submission remains in `root.ts`.

Both landings are private. They add no React, Tarstate, backend abstraction, or
public packet API.

## Working Checkpoint: 2026-07-12

The repository is at a validated intermediate boundary. The arena-opacity,
vertex-input instance ownership, and retained packet-candidate slices are
checkpointed; the current slice makes those selected packets authoritative for
glTF draw collection.

- Landing 1 is active: retained `FramePlan` commits feed counted semantic
  changes into `ResourceArena`; async asset and image work is reconciled at an
  explicit shell boundary.
- `FrameViews` is retained flat storage for ordinary and XR views. The frame
  loop renders on demand and does not continuously redraw unchanged scenes.
- Geometry declarations have stable semantic resource IDs. `VertexInputArena`
  owns verified static-buffer deduplication, base and instanced VAOs, reverse
  instance edges, the complete three-stream instance-buffer family, context
  loss/restoration, and ordered teardown. Instance capacity growth, retained
  staging, partial uploads, failure recovery, and VAO-before-buffer deletion
  now share one authority. The duplicate root geometry cache, root buffer
  bookkeeping, and per-frame used-geometry sweep are deleted.
- `ResourceArena` and `VertexInputArena` are opaque, explicitly passed state
  tokens and sibling authorities. The semantic arena no longer imports, owns,
  or exposes WebGL state. Root diagnostics use narrow copied snapshots rather
  than mutable arena maps or rows. Both arenas use the same pure monotonic-ID
  boundary guard without public allocator mutation hooks.
- Shared-view LOD selection now runs as a retained node-then-material prepass:
  all visible views contribute, each dense group finalizes once, and packet
  submission consumes one frame-global level per group. `FramePackets` retain
  multi-predicate LOD requirements and concatenated per-view ranges. The root
  now builds a plan-scoped numeric glTF candidate catalog with retained bounds,
  material, local-model, and root-source tables; asynchronously ready or
  replaced assets patch only their reverse-mapped occurrence spans. Per-view
  numeric culling drives selected ranges, and those ranges now directly resolve
  late-bound prepared materials, roots, local matrices, lights, and sidedness
  into the established batching/submission backend. Publication failures fail
  closed so packet ranges and resolver state cannot describe mixed asset
  generations. The duplicate legacy collector is no longer used by the main
  frame path and has been deleted. A pure retained packet-submission workspace
  now drives the established GPU batch backend with packet-authoritative numeric
  rows, exact geometry/material batch identities, root/material/light
  provenance, dense view sequencing, and frame-global canonical runtime
  bindings. Per-view draw arrays, per-packet draw objects, copied packet
  matrices, and transient batch-input objects are deleted. Retained batch slots
  receive local matrices directly from packet tables and preserve exact warm
  upload signatures. The workspace owns no GL handles and imports no root or
  lifecycle code. A root-lifetime numeric batch registry and separate segment
  grouping authority now drive the live backend: exact four-lane identities,
  render-class provenance, frame touch unions, first-seen class/member order,
  bounded open-address hashing, and generation-stamped fail-closed results.
  Stable numeric IDs own retained batch objects and instance-buffer identity;
  the string batch-plan key/cache, grouping `Set`/`Map`, temporary class arrays,
  and their frame-end scan are deleted. The complete glTF instance-buffer
  family is extracted into a sibling arena: allocation rows, exact local/pose/
  scale signatures, partial uploads, activity epochs, failed-frame retention,
  successful-frame pruning, context restoration, and upload counters now share
  one authority. Root retains only transform subscriptions, batch signatures,
  program readiness, and surface policy.
  HDR color/depth/framebuffer and transmission-copy targets are likewise owned
  by an opaque surface render-target arena with atomic resize/copy publication,
  partial-creation recovery, and explicit active-versus-lost context teardown.
  HDR presentation and transmission shader/texture-unit policy remain in root.
  Shader programs and uniforms are now another complete GPU authority: an
  opaque program arena owns variant requests, bounded start/link work,
  parallel-compile polling, shader/program handles, active-program state, and
  per-program location/value caches. A sticky wake signal preserves root frame
  scheduling without an arena callback. Context release/drop, failed-link
  retry, HDR display-transform uniforms, and all surface uniform calls use this
  single authority; direct program/shader/uniform-cache ownership is deleted
  from root.
  Geometry submission is also isolated behind an opaque draw arena that borrows
  `VertexInputArena`: base/composite VAO selection, missing tangent/color
  defaults, exact draw-mode mapping, wireframe width ordering, and indexed or
  non-indexed single/instanced dispatch no longer live in root. The split
  instanced prepare/submit seam preserves root counter ordering without a
  callback or direct GL draw authority.
  Clustered Forward+ lighting now has its own opaque arena as well. The retained
  grid scratch and snapshots, single sequential grid/index/light texture
  triple, top-three unit policy, exact integer/float uploads, uniform binding,
  and active-versus-lost teardown are removed from root. Texture creation and
  allocation metadata publish transactionally: partial triples roll back, GPU
  capacities change only after successful allocation, and failed deletions
  remain owned for retry.
  IBL GPU ownership is extracted into a separate opaque arena. glTF specular
  cubemaps, the studio cubemap, the BRDF LUT, lazy publication, fixed/allocated
  texture-unit binding, and active-versus-lost teardown no longer live in root.
  `ResourceArena` remains the sole decoded-source lease and closing authority;
  the IBL arena borrows a narrow read-only source view and retains no images.
  Cubemap faces validate atomically before upload, replacements dirty the
  retained handle for a full reupload, staged GPU faults become bounded
  diagnostics so row leases finalize, and render-time retry remains fail-closed.
  The former IBL callback-context modules and their per-draw closure object are
  deleted.
- The imperative WebGL shell now establishes an explicit frame baseline and a
  complete unpack contract for ordinary, virtual-texture, and IBL uploads.
  Royal exclusively owns its WebGL2 context; no raw-GL callback fallback is
  implied.
- The current checkpoint passes 469 workspace tests, typecheck, build,
  package-import smoke, strict lint, and diff checking. The preceding checkpoint
  also passed a headless NVIDIA T500 ANGLE/Vulkan WebGL2 smoke.

Resume in this order:

1. Extract texture/virtual-texture binding ownership. Then move the surface draw
   kernel and compose it with the numeric packet, instance, target, program,
   geometry, clustered-light, and IBL arenas into the real callback-free
   executor. Move or delete remaining active-resource scans and pruning paths
   with their owning families.
2. Compile the private render DAG and add minimal typed `Primitive` and effect
   descriptors for custom PBR shaders and multipass postprocessing. Do not add
   raw GL callbacks or a public generic render graph.
3. Finish the paused hardware glTF-load/compatibility-lab hitch and long-task
   benchmark. Measure cold and warm Helmet loading, 4,096-instance p50/p95,
   capacity growth, and steady heap slope without adding unstable CI limits.
4. Recheck the visual oracles: Helmet, material variants, transparent output,
   SVG color accuracy, and representative Khronos material/compatibility cases.
   Then validate Safari 17 on iPad A10+ and Quest 2.
5. Keep animation and morphing deferred until a product use case exists; retain
   only the eventual minimal imperative control boundary in the architecture.
6. Keep occlusion, meshlets/impostors, particles, and large-world streaming as
   measured private research until packet/executor data identifies a concrete
   bottleneck. Outdoor mixed building/forest scenes remain design pressure, not
   immediate public API.

## Landing 1: Retained Plan And Semantic Resource Ownership

`render(scene)` commits when the scene reference changes. A commit compiles one
`FramePlan`, diffs its counted resource manifest, and updates subscriptions.
Demand frames, camera changes, instance changes, XR frames, uploads, and shader
completion execute the retained plan without recompiling it.

A new scene reference is an explicit commit even when structurally equal. Royal
does not deep-hash descriptors or support mutating a committed descriptor behind
its readonly contract.

### Boundaries

- `frame-plan.ts` is pure commit compilation and manifest diffing.
- `resource-arena.ts` owns the complete semantic lifetime family: prepared glTF
  requests and subscriptions, asset state generations, ordinary and virtual
  texture declarations, decoded/prepared sources, transitive asset dependency
  edges, and restore recipes.
- `root.ts` owns canvas/context lifecycle, clocks, invalidation coalescing, scene
  commit orchestration, view input, and diagnostics publication. WebGL draw
  submission remains here for this landing.

Use functions over explicit state records. One explicit wake-up signal from an
async preparation shell is acceptable; callbacks must not mutate renderer state
or submit GL. Async results enter a counted event queue and are applied at a
commit/frame boundary.

The intended private shape is equivalent to:

```text
compileFramePlan(scene, revision) -> FramePlan
diffResourceManifests(previous, next, scratch) -> ResourceDelta

createResourceArena()
applyResourceDelta(arena, delta)
applyPreparedAssetEvents(arena, events, deltaScratch)
dropGpuHandles(gl, arena, deleteObjects)
restoreResourceArena(gl, arena, contextGeneration)
disposeResourceArena(gl, arena)
```

`FramePlan` retains flat node references and kinds, ordering-segment and
occurrence indices, light-node indices, render-object refs, bulk-instance
sources, glTF occurrence-to-request rows, picking IDs, clear/tone/HDR inputs,
and a counted `ResourceManifest`. Use ordinary arrays for commit-only data.
Use structure-of-arrays storage only where a later hot loop consumes it.

The manifest contains counted scene edges:

- glTF request key plus source URI;
- direct ordinary and virtual texture declarations;
- render-object refs and bulk-instance sources.

One prepared glTF asset owns one transitive dependency manifest covering every
material variant and LOD that may become active. If a scene contains 100
occurrences of that asset, the scene has 100 request references but the prepared
asset owns one geometry/material/texture dependency edge set. Readiness or an
asset-plan revision applies only that asset's dependency delta; it never scans
scene occurrences or every ready asset.

Asset, texture, geometry, material, and program readiness is asynchronous. A
scene plan therefore stores asset request rows, not imaginary material or
geometry IDs. The arena assigns root-scoped monotonic resource IDs when semantic
rows become available. Manifest keys and diff output are deterministic; numeric
IDs are not promised to match across different root histories.

Occurrence identity is `(plan revision, occurrence index)` and is stable for the
life of a committed plan. `pickingId` remains the application's logical identity
across scene replacements. Do not invent descriptor hashing to imply stronger
identity.

### Camera And Mutable Inputs

The plan retains the camera source reference. A camera resource subscription is
changed only at scene commit. Its committed version is view input, not a plan
revision: a camera commit invalidates a frame, reads into root-owned matrix
scratch, and does not compile or touch resource manifests.

XR projection/view matrices override the scene camera for submission. The scene
camera may continue changing under the external XR clock without compiling the
plan. Picking reads the same latest committed camera state as ordinary rendering.

Render-object refs and bulk-instance subscriptions are also reconciled only at
scene commit. Transform and pose/scale notifications update their explicit
versioned state and invalidate; they do not walk the scene descriptor.

### Context Loss

Scene commits and semantic deltas still apply while the context is lost. Retain
the plan, prepared assets, decoded/prepared sources, virtual-texture metadata,
and resource declarations. Drop only generation-tagged GL handles. Restoration
recreates handles from the retained arena and executes the retained plan without
waiting for React or another application mutation.

### Landing 1 Deletion

This landing is complete only when it deletes:

- `TextureLease`, the texture lease epoch, `#reconcileGltfAssetLeases`,
  `#reconcileTextureLeases`, and the ready-material scan they use;
- per-render `#syncRenderObjectRefs` and `#syncGltfInstanceTransforms` active
  `Set` scans, replacing them with commit deltas;
- per-view scene-light collection and the `scene.nodes.some(...)` HDR scan;
- semantic glTF subscription, abort, texture declaration, and prepared-source
  ownership duplicated in `root.ts`.

The existing draw arrays, batch cache, geometry-use scan, and WebGL submission
body may remain only until Landing 2. Do not rename them and claim executor
decomposition.

## Landing 2: Retained Packets And A Real Executor

`frame-packets.ts` performs selection, culling, LOD choice, segmentation, and
batch membership into caller-owned retained-capacity storage. Buffers reset by
count. Adapt the measured model in
`research/visibility-packets/visibility-packet-bench.mjs`; do not create another
retained object graph.

`FrameViews` is flat caller-owned data: contiguous projection/view matrices,
integer viewports, framebuffer, and scissor policy. Ordinary rendering fills one
row. XR fills all eye rows. There are no projection/view closures or `map` /
`flatMap` allocations on the hot path.

Packets contain resource IDs, ordering segment, render class, sidedness bits,
instance first/count, root-source ID, and local-model ID. Material rows are
immutable semantic PBR data with feature/program keys and versioned texture-slot
IDs. Image completion updates a texture-slot row; it does not rebuild material
packets.

`executor.ts` receives explicit `{ gl, arena, plan, packets, views, counters }`.
It owns draw order and GL submission and borrows all persistent resources. Move
the actual mesh/glTF draw kernels, binding state, transmission copy, HDR
presentation, and postprocess order with it. Move geometry/VAO/program/texture,
instance-buffer, IBL, HDR, and clustered-light GL ownership into the arena as
complete families. Do not pass root methods or a callback bag into the executor.

### Ordering Guarantees

- A non-glTF node terminates the current automatic-instancing segment.
- Each segment/view submits opaque draws, takes at most one current-frame screen
  copy when transmission is present, then submits transmissive and blended draws.
- Pose/scale deltas and instance uploads are consumed once before all views.
- One-view and two-view submission use identical resource deltas and instance
  upload byte ranges; only draw submission scales with view count.
- Clearcoat, sheen, specular, iridescence, dispersion, SVG, virtual textures,
  material variants, LOD, and asset-local lights preserve current semantics.
- Picking may borrow retained occurrence/bounds tables, but packets retain no
  React nodes or GL handles.

### Landing 2 Deletion

This landing is complete only when it deletes:

- `SceneRenderView` callbacks and per-render ordinary/XR view objects;
- per-view `gltfDraws`, `batchInputs`, opaque/transmissive/blended arrays, and
  the `flushGltfDraws` closure;
- the string glTF batch-plan key, batch-plan cache, and refresh `Map` rebuild;
- `#usedGeometry`, frame-active glTF resource sets, active LOD scans, and all
  corresponding frame-end release-unused scans;
- the WebGL submission and resource-owner methods moved from `root.ts`.

## Counters And Acceptance

Publish maintained counters, not diagnostic snapshot scans:

- plan revision, compiles, and compile node visits;
- scene and prepared-asset acquire/release/update counts;
- asset-plan compiles and applied async events;
- execution frames and views;
- selected/submitted packet count, capacity, and capacity growth;
- instance upload ranges/bytes, shader skips, and context recreations.

Prefer differential fuzzing and measured performance over a large unit suite.

For Landing 1, fuzz randomized scene replacements and async asset completion /
release races. Assert acquire/release conservation, no negative references,
`A -> B -> A` balance, same-reference commit idempotence, deterministic plan
tables and deltas, and stale-generation completion safety.

For Landing 2, keep the current renderer as a temporary differential oracle
during development, then delete it. Fuzz ordering segments, representation and
material changes, visibility/LOD choices, one/two-view execution, and partial
instance updates. Existing no-shiver, variants/LOD, PBR, transmission,
dispersion, SVG/VT, picking, and context-loss coverage must remain green.

After warm-up, 100 to 1,000 camera-resource or XR frames over one unchanged
mixed scene must report:

- zero plan compiles and compile-node visits;
- zero scene/material lifetime visits and resource deltas;
- zero packet/map/array capacity growth;
- no sustained JS heap slope.

Measure commit p50/p95 separately from frame execution. On headless host GPU and
available Quest 2/iPad hardware, Helmet, the Khronos material lab, static instancing, and
animated instancing p50/p95 must not regress by more than 5%; the scan/allocation
work targeted by each landing should improve. A two-view XR run must upload the
same instance byte ranges as one view while draw calls scale with views.
