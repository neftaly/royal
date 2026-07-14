# Royal Direction

Date: 2026-07-11

Status: architectural contract for the current rewrite. Breaking changes are
expected while packages remain private and version `0.0.0`.

## Product

Royal is a React-first, demand-rendered WebGL2 renderer for attractive glTF
scenes containing many repeated, high-resolution assets. Probability supplies
the representative workload and target hardware, not Royal's application API.

The browser floor is Safari 17. Performance targets are A10-class hardware,
including iPad 6th generation, and Quest 2 WebXR. Royal's
core workload is hundreds or thousands of cards and game pieces, frequently
sharing geometry while using high-resolution raster or SVG artwork.

Royal must make these paths excellent:

- glTF 2.0 metallic-roughness PBR;
- SVG images referenced by glTF, including `GS_texture_svg`;
- automatic and explicit bulk instancing;
- automatic virtual texturing for assets that benefit from it;
- touch, pointer, and XR picking with stable logical identity;
- transparent canvases, correct color, and attractive image-based lighting;
- zero renderer work while an ordinary scene is settled.

Royal is not a canvas UI toolkit, text editor, scene ECS, physics engine,
application state model, public render graph, or cross-backend abstraction.

Royal world space has one fixed physical scale: one world unit is one metre.
This covers authored geometry, transforms, camera distances, light ranges,
picking, glTF, and XR. Scale vectors and directions are dimensionless;
angles are radians. Pixels, seconds/milliseconds, photometric units, texels,
normalized values, and bytes remain explicitly named non-world domains.
Physics and large-world adapters preserve this metre contract at their Royal
boundary even when their own storage uses sectors or higher precision.

Future 2D work is a compatibility constraint, not current product scope. The
renderer retains orthographic cameras, color-managed unlit primitives, generic
pick identity, instanced geometry, and explicit scene-linear/display-linear
pass domains. A future optional 2D/text package may prepare the same flat draw
data. Royal does not retain today's font, editor, form, layout, or UI-semantics
implementation, reserve JSX vocabulary, or add hot-path indirection for it.

Future particles are a second compatibility constraint. One coarse producer
must be able to emit high-count transient instance packets with billboard data,
additive/alpha state, explicit time demand, reusable dynamic storage, and
optional scene-depth input. React never owns individual particles. Emitters,
simulation graphs, collisions, global transparency sorting, and GPU simulation
are not current product scope.

PlanetSide-, Star Citizen-, and GTA-scale worlds are architectural stress
tests, not product scope. World/application state may use double precision or
sector-local coordinates; Royal submits camera-relative float transforms so GPU
precision does not define logical identity. Prepared assets and spatial cells
stream independently under byte/job budgets, and stable identity survives
unload/reload. Frame work begins from visible cells/ranges and bulk sources; it
must not scan every entity in the logical world. Networking, terrain systems,
vehicles, physics, weather, and gameplay remain outside Royal.

## Public Shape

`@royal/react` is the primary product API. React reconciles coarse immutable
scene intent; it never owns frame execution or per-frame bulk object data.

The intended friendly vocabulary is deliberately small:

- `Canvas`;
- one scene with a camera, environment/presentation options, and effects;
- glTF assets;
- bulk glTF instances;
- a small built-in mesh, geometry, material, and texture vocabulary;
- a minimal shader primitive escape hatch;
- camera/orbit controls;
- picking for renderable nodes and instances;
- explicit invalidation and imperative transform updates;
- WebXR through a separate lifecycle-oriented subpath.

There is one public scene description, not a public sequence of render passes.
HDR, transmission, picking, effects, tone mapping, and XR views compile into a
renderer-private pass graph.

Algorithms do not become JSX vocabulary. VT pages, meshlets, LOD selection,
batch keys, shader variants, texture units, render targets, codecs, and caches
remain private and observable through bounded diagnostics.

## Dependency Direction

Dependencies point inward and never form a service graph:

```text
React adapter
  -> immutable product descriptors and versioned controllers
    -> pure asset/scene semantics + retained incremental maintenance
      -> selected flat draw and pass packets
        -> explicit WebGL2 executor and resource arena
```

Separate imperative ports surround the pure core:

```text
fetch/decode workers -> prepared assets -> retained tables/deltas -> packets
browser/XR clocks    -> camera selection + invalidation          -> WebGL
```

Rules:

- React descriptor, reconciler, and hook modules do not import WebGL, codecs,
  glTF schema, VT, or shader internals. One package composition root may select
  the WebGL implementation; backend injection is not part of the friendly API.
- Asset preparation does not create or retain GPU handles.
- Async code does not call GL. It completes jobs and explicitly invalidates.
- Frame planning does not fetch, decode, subscribe, or allocate GPU resources.
- The draw executor does not know React, scenes, assets, SVG, or glTF.
- Each mutable cache has one owner, `dispose()`, reset semantics, and a bounded
  diagnostic snapshot.
- External/XR GL use crosses one explicit state-reset boundary.
- Renderer core and the draw hot path do not depend on application/external
  stores. Small adapter-local stores such as camera controls are allowed when
  ownership and subscriptions are explicit.
- No ambient context stack, global registry, service locator, or hidden command
  inheritance may carry semantic state between layers.

Pure functions may write caller-owned scratch or output storage where measured
allocation cost justifies it. Functional core means explicit inputs and
deterministic meaning, not allocating immutable object graphs every frame.

## Scene And Presentation Ownership

Scene intent and presentation state have different lifetimes. An immutable
scene snapshot or prepared scene may outlive, detach from, or be presented by a
different Canvas root. The presentation root alone owns its canvas, exact
WebGL2 context, size, DPR, framebuffer policy, browser/XR clock, input adapter,
and viewport-derived matrices. Cameras remain scene descriptors; their resolved
aspect, viewports, and per-eye matrices are presentation data.

The React Canvas is the normal host seam, not an ambient engine singleton. Host
types above that seam do not expose WebGL handles, glTF parser objects, cache
entries, or prepared packet internals. Root creation, use, loss/restoration,
and destruction all occur on the browser lane that owns the context. Every GL
create, submit, restore, and delete operation crosses that one execution lane.

The presentation root is also the sole coalescing invalidation authority.
Descriptor and controller commits, asset completion (including cache hits),
Tarstate/app bridges, VT residency, resize, picking, effects, and `useFrame`
submit explicit render demand to the root; none owns a second RAF or schedules
GL work directly. The root merges all demand received before submission into at
most one ordinary frame and ignores generation-stale demand after disposal.

## Async Completion And Content Trust

Fetch, cache, decode, SVG, and codec work complete on a defined asynchronous
boundary, including cache hits; completion is never inline or reentrant into
React reconciliation or frame planning. Each request has a subscriber handle
separate from its content-keyed prepared entry. In-flight work is deduplicated,
bounded by byte/job/concurrency budgets, abortable, and tagged with the owning
root generation. A stale completion may populate an independently owned shared
asset cache within its budget, but cannot mutate, schedule, or retain a disposed
or superseded root.

Remote glTF, SVG, textures, buffers, and codecs are untrusted data, never
authority. Parsing and preparation enforce finite sizes, recursion and external
fetch limits, cancellation, required-feature validation, and SVG sanitization.
Content identity proves byte/preparation equivalence; it does not grant origin
authority. Callers receive stable logical IDs and bounded diagnostics, never GL
or cache handles.

## State Integration

Royal does not depend on Tarstate, Automerge, Zustand, or a Probability schema.
Application state projects into Royal through pure functions and immutable
snapshots or proven diffs.

Bulk transforms use versioned structure-of-arrays storage with explicit commit
or patch operations. A small imperative bridge may subscribe to an external
store, apply a projected diff, and invalidate. That bridge lives in the app or
an optional adapter package, never renderer core or the draw loop.

Tarstate diagnostics, if added, are sampled bounded aggregates. Tarstate is
never Royal's renderer data model, cache owner, or per-object frame protocol.

## Prepared Data And GPU Reconciliation

```text
Asset IO/codecs
  -> PreparedAssetStore (content-keyed CPU data, no handles)
    -> retained scene tables + explicit versioned deltas
      -> selectFrame(camera/views, visibility, versions, scratch)
        -> FramePlan (resource declarations plus flat pass/draw packets)
          -> ResourceArena.reconcile(declarations)
          -> ResolvedFrame (explicit owned/borrowed handles)
            -> Executor.submit(resolved frame)
```

The prepared asset store alone owns decoded semantic asset data. The resource
arena alone creates, suballocates, restores, and deletes GPU resources. Frame
planning declares identity and requirements but never performs a cache miss.
The executor never creates resources, parses identity, or chooses an asset
fallback. Frame packets borrow resolved handles for one submission only.
`ResourceArena.reconcile` and `Executor.submit` are separate ownership stages
but execute serially on the same root-owned GL lane; neither may call GL from an
asset callback, worker, React reconciliation, or an independent scheduler.

Resource declarations are retained and versioned as the arena's reconstruction
recipe until superseded or the root is disposed; flat draw/pass packets remain
submission-scoped rather than a second retained scene. Context restoration
forces a fresh `selectFrame` against current canonical tables, reconciles the
retained/current declarations into the new context generation, and only then
submits. A settled root therefore restores without relying on a stale packet or
waiting for an unrelated application mutation.

Production maintenance is retained and incremental: descriptor, asset, and
bulk commits apply proven deltas to versioned canonical tables and regenerate
only affected packets or resource declarations. A camera frame selects and
culls those tables; it does not rebuild the scene. A pure full planner defines
the same semantics for fuzzing, differential checks, and diagnostics, but is
never a hidden production fallback.

Four identities remain distinct across every layer:

- logical identity belongs to authored objects and picking;
- content/preparation identity deduplicates equivalent CPU results;
- representation revision names capability-, quality-, and
  preparation-specific encodings of that content;
- GPU allocation identity belongs to one arena and context generation.

Source URLs, packed slots, allocator offsets, and object references do not
silently substitute for any other identity.

## Materials And Color

Royal is PBR-centric:

- glTF metallic-roughness is the baseline material model;
- base color, metallic-roughness, normal, occlusion, emissive, alpha modes,
  double-sided geometry, vertex colors, UV sets/transforms, and samplers are
  baseline fidelity;
- `KHR_materials_unlit` remains an internal glTF compatibility path for artwork
  whose authored colors must not be changed by lighting;
- there is no public standard/unlit/wireframe material taxonomy;
- Phong, Lambert, toon, and legacy material fallbacks are out of scope.

The working color domain is scene-linear HDR. Color textures and SVG decode as
sRGB; data textures remain linear. Tone mapping and output conversion happen
exactly once at the terminal presentation edge. Alpha and premultiplication are
specified at every texture/pass boundary.

The Damaged Helmet in the current Three.js glTF loader example is the minimum
visual oracle. Royal must match its material response under a comparable
authored HDR environment: highlight shape, roughness, normal detail, occlusion,
emissive response, color balance, and exposure.

Royal's modern glTF PBR profile includes clearcoat, sheen, specular, IOR,
transmission, volume/attenuation, iridescence, anisotropy, emissive strength,
dispersion, diffuse transmission, and unlit. They remain prepared glTF material
data rather than public Royal material families. Each feature must pass its
official Khronos asset oracle and device performance gates; expensive
screen-copy or multi-layer work is compiled only when demanded by a visible
material.

## Assets, SVG, And Virtual Texturing

glTF parsing, validation, accessors, transforms, material preparation, and
batch planning form a backend-neutral functional core. Draco, Meshopt, and
Basis/KTX2 adapters load only when declared by an asset and may execute in
workers. Unsupported required semantics fail explicitly.

SVG is a first-class glTF texture source, not a scene node or UI subsystem.
The SVG pipeline owns canonicalization, sanitization, finite dimensions,
relative/external resource resolution, cycle/depth limits, cancellation,
stable content identity, rasterization, sRGB/alpha behavior, and shared page
promises.

VT is automatic and renderer-private. It is selected once from an explicit
manifest or measured asset/footprint policy. Small textures remain ordinary.
Atlas, request, upload-byte, concurrency, and residency budgets derive from
queried capability/quality tiers. Runtime fallback chains do not repeatedly
probe alternative strategies during drawing.

The ordinary/virtual representation is sticky for one capability generation;
restoration may deliberately select a new representation revision. Every
virtual texture guarantees a coarse resident ancestor before dependent draws
sample it. Page-table publication, atlas reuse, and generation checks are
ordered so evicted or superseded slots can never be sampled as stale content.

## Instancing And Picking

Automatic pooling uses canonical asset/geometry/material content signatures,
not React child identity or source URL alone. Loader-provided content identity
is preferred over hashing full decoded geometry in the browser.

Bulk instance data has stable logical IDs separate from packed buffer slots.
Transform mutations upload only changed ranges. Static settled instance sets
perform no uploads or renderer frames.

Logical pick identity is owned at the product boundary: an explicit bulk
caller ID wins; otherwise a prepared authored asset occurrence supplies the
asset version, node path, and authored occurrence/index. Automatic pooling,
visibility selection, and packet planning must carry that identity unchanged.
The renderer may scope it to a mounted root or asset instance to prevent
collisions, but may never derive product identity from a packed instance slot,
batch index, draw order, planner position, allocator handle, or frame number.

`EXT_mesh_gpu_instancing` is an ingestion encoding only. Authored extension
instances, repeated scene occurrences, and explicit bulk instances normalize
to the same canonical records and enter one culler, batcher, and executor. No
extension-specific GPU buffer, shader, or draw path survives preparation.
Authored logical identity derives from asset occurrence, node path, authored
index, and asset version; explicit bulk instances accept stable caller IDs.
Packed slots are never public identity.

Picking and visible rendering share transform, culling, sidedness, alpha-mask,
material, and instance identity decisions. Transparent hit semantics must be
documented rather than implied. XR controller rays and touch/pointer selection
use the same product identity model.

## Visibility And Occlusion

Convention-scale scenes, outdoor FPS environments, and forests make a minimal
occlusion path early product infrastructure. Frustum culling and a spatial
hierarchy are the baseline pure selection stage. Opaque terrain, buildings,
rocks, and other reliable depth writers establish occlusion; WebGL2
`ANY_SAMPLES_PASSED_CONSERVATIVE` queries test coarse hierarchy nodes or batch
clusters with temporal coherence. Royal never queries each piece or tree and
never blocks on a result. Unavailable results keep clusters visible, recent
visibility decays with hysteresis, and camera discontinuities invalidate prior
evidence. Alpha-masked foliage is an occludee initially rather than forcing an
expensive foliage depth prepass.

Prepared glTF geometry and node transforms provide bounds by default. Optional
offline bounds manifests are accepted only when tied to verified asset content
and representation revisions and validated as finite, conservative data;
missing or unverified metadata never replaces glTF-derived bounds.

Occlusion, LOD, future meshlet ranges, and possible Hi-Z experiments consume
the same visibility inputs and emit conservative prepared ranges. They do not
change React descriptors or logical picking identity. Any GPU technique must
include its depth-prepass, query/readback, compaction, stereo, and false-positive
cost in target-device measurements. False-negative visibility is not allowed.

## Animation

The initial product supports explicit imperative transform animation through
versioned controllers and `useFrame`. Public glTF clip controllers, skeletal
animation, morph animation, and animation-pointer evaluation are not baseline
surface area.

Assets requiring unsupported deformation fail clearly instead of rendering an
incorrect substitute. A future deformation runtime must consume prepared pose
data behind the same flat executor boundary; it must not add React frame work
or leak animation state into the GL device.

## Shaders And Effects

The private WebGL primitive follows regl's useful idea: declarative static
pipeline/resource descriptions compile into thin callable submissions over
explicit changing props. Reflection, numeric binding slots, VAOs, and fixed
state compile once. Submission is allocation-free and does not evaluate
arbitrary callbacks.

The friendly React shader escape hatch is a leaf `Primitive`; it cannot inject
passes, own frame scheduling, bypass color management, or reach renderer
caches.

`Primitive` bindings are typed by semantic role (for example transform,
camera, material value, texture, or instance stream), not exposed numeric
locations or ambient names. Its immutable pipeline cache key includes shader
modules, vertex layout, fixed state, binding schema, and render-domain
requirements while excluding changing uniform values.

Effects are immutable typed descriptors on the scene. The renderer compiles
them with its internal HDR/transmission/picking/XR dependencies into one DAG.
Effect nodes declare color encoding, alpha contract, inputs, output resolution,
history/time demand, and XR support. Intermediate targets come from one
transient pool. With no effects, there are no effect passes or effect targets.

The first effects work proves only the substrate: terminal tone mapping plus a
neutral identity/custom fullscreen pass. Bloom, temporal effects, SSAO, SSR,
and a public graph wait for target-device evidence.

## Scheduling And XR

Ordinary Canvas and XR have different clocks:

- ordinary scenes render only after descriptor/controller mutation, resize,
  async asset/upload completion, VT residency change, picking demand, or an
  effect-declared time/history dependency;
- a settled ordinary scene owns no RAF/timer and issues no GL calls;
- active `useFrame` subscribers explicitly request continuous ordinary frames;
- immersive XR uses the session RAF and is inherently continuous.

Every ordinary source above submits demand through the root's single
coalescer. Continuous `useFrame` is represented as renewed demand at that same
boundary, not a competing loop; removing the last continuous source lets the
root settle immediately after the already-demanded frame.

XR owns per-view camera/viewport data and borrows the runtime framebuffer. The
framebuffer is never deleted by Royal. Effects and owned HDR intermediates must
declare an XR path and may be disabled or resolution-scaled by the Quest quality
tier. Multiview is an optional optimization, not a required architecture.

XR acquisition and XR ownership are separate state domains. Support detection
produces `available` or `unavailable`; a failed request can produce `blocked`
with an inspectable reason without claiming a session. Once owned, a session
moves through `starting -> active <-> suspended -> ending`. `suspended` means
the owned session is browser-hidden, including the valid case where immersive
XR continues in the background while the 2D browser is foregrounded. It is not
an acquisition failure and must retain the live session handle.

The XR renderer uses the root's existing context rather than reacquiring one
from the canvas. Start failure, session `end`, context loss, and root disposal
all release the external clock exactly once, cancel pending callbacks, and
restore Royal-owned GL state around the borrowed framebuffer. No error path may
strand continuous rendering or delete runtime-owned framebuffer resources.
The public session runtime is the single owner of that renderer, the session
RAF, visibility/end listeners, and root-lifecycle observation; examples and
application components own only support detection and acquisition policy.

## WebGL Contract

Royal targets WebGL2 and GLSL ES 3.00 only. `EXT_color_buffer_float` is the sole
proposed required extension because it enables one RGBA16F HDR PBR/effects
pipeline and is supported by the declared Safari/Chromium floor. It becomes a
hard startup requirement only after physical iPad and Quest framebuffer/render
probes pass.

Before becoming required, physical probes validate RGBA16F completeness,
values above 1, linear sampling, precision, texture-unit and texture-dimension
limits, target memory, context loss, and the borrowed XR framebuffer after
`makeXRCompatible()`. Quality policy exposes bounded render scale/max DPR, HDR
target pixels/bytes, and an explicit HDR antialias strategy; canvas MSAA is not
assumed to antialias an offscreen single-sample HDR target.

Optional capability tiers may use anisotropic filtering, ASTC, parallel shader
compilation, timer queries, multiview, and multi-draw. ETC2/EAC is the portable
WebGL2 compressed-texture baseline. Optional extensions may improve quality or
performance but must not create alternate semantic renderers.

Context loss/restoration, abortable work, bounded decoding/upload concurrency,
GPU-memory budgets, decoded-source release, and explicit resource disposal are
baseline mobile lifecycle behavior.

Each root has an explicit lifecycle:

```text
active -> lost -> restoring -> active
   \----------------------------> disposed
```

Loss stops submission and invalidates GPU generations. Prepared CPU assets and
the latest versioned resource declarations may survive within budget.
Restoration recreates the arena, forces one current frame selection, and
reconciles its declarations before submission. Fetch/decode/upload jobs are
abortable and generation-tagged; dispose prevents stale completions from
mutating or invalidating the root.

WebGL2 exposes no explicit GPU heaps. Royal's private resource arena may provide
equivalent ownership and reuse through buffer slabs/rings, VT atlases, 2D
texture arrays, and lifetime-aliased transient render targets. Pure planning
emits logical resource requirements and ranges; only the WebGL shell chooses a
dedicated allocation or suballocation. Allocator handles and offsets never
become asset or React identity. Reuse is fence-safe, estimated GPU bytes are
accounted per owner, and context restoration can reconstruct every allocation.
Geometry suballocation remains benchmark-gated because WebGL2 offers neither
explicit memory placement nor portable indirect drawing.

## Performance Contract

Performance is compared against the retained pre-rewrite routes and then
against physical target devices. Host Vulkan is a continuous regression tool,
not a substitute for iPad or Quest evidence.

Required gates:

- ordinary idle: zero renderer frames and GL calls;
- a settled Helmet observation across 1,000 host clock ticks has zero GL calls
  and no net retained-heap growth after measurement warm-up;
- steady submission: no shell allocation or additional GC;
- unchanged render: no resource creation or upload;
- static instance mutation: upload only changed ranges;
- one committed update of 10,000 bulk transforms causes zero React renders,
  one coalesced invalidation, and one ordinary frame;
- draw/upload counts do not increase without a documented visual requirement;
- median CPU regression at most 5%; p95 at most 10% or 0.3 ms, whichever is
  stricter for real retained scenes;
- disabled effects add no pass, target, draw, copy, or retained allocation;
- no duplicate retained image, SVG source, decoded buffer, or GPU-resource
  ownership;
- uncompressed assets do not load codec chunks;
- bundle growth must be paid for by deleted shell or a measured target-device
  win.

Lifecycle gates unmount a root while Helmet/KTX2 preparation is in flight:
arena ownership reaches zero and late generation-tagged completions are no-ops.
Losing and restoring a settled deterministic scene must reproduce its reference
capture within the same documented image tolerance as a fresh context. Visual
parity requires Damaged Helmet under the shared authored HDR environment and
ACES presentation to reach SSIM >= 0.98 against the pinned Three.js oracle;
unsupported deformation must fail explicitly rather than render a substitute.

Retained evidence routes cover Damaged Helmet, ordinary SVG texture, automatic raster VT,
instancing, transparency, picking, context restoration, immersive stereo, and
the modern Khronos material-extension assets.
Fuzzing/property tests cover pure preparation, batch grouping, range diffs,
resource lifecycles, state transitions, and VT residency. Broad fake-GL tests
that assert obsolete call ordering are disposable.

Reference capture uses a one-shot owned target/readback API and does not require
`preserveDrawingBuffer`. A bounded lab diagnostics subpath reports readiness,
errors, resource/upload counts, shader completion, VT residency, and timing;
implementation cache schemas are not public product contracts.

## Deletion Ledger

Delete rather than preserve compatibility for:

- text shaping, fonts, editing, forms, HUD, UI semantics, menus, and focus;
- the public pass/render-graph API;
- unsupported or backend-specific geometry/material variants; the small built-in
  mesh, box/plane, standard/unlit/wireframe, and texture vocabulary remains the
  friendly path, while `Primitive` is an additive expert escape hatch;
- public animation/deformation controllers and their frame machinery;
- generic render-object mutation refs beyond stable picking identity;
- public VT internals, codec registries, glTF schema, shader features, GL
  resources, cache keys, and detailed diagnostics;
- `useFrameIndex`, `preserveDrawingBuffer`, public backend injection, and broad
  capability inventories;
- examples/tests/dependencies that exist only for deleted APIs;
- silent legacy or raw-backend fallbacks.

Keep picking, WebXR, SVG textures, VT, camera controls, environment/punctual
lighting, transparent output, context restoration, and orthographic cameras.

## Research Policy

Research is evidence, not scope. Compression, culling, codec, instancing, SVG,
VT, and physical-device results inform implementation. Meshlets, impostors,
Hi-Z, deferred rendering, WebGPU, and shader graphs remain private experiments
until target-device measurements demonstrate a bottleneck and a win.

In particular, WebGL2 has no portable mesh-shader/indirect pipeline. Meshlets
begin as an offline Meshoptimizer fixture plus a pure CPU visible-range
selector. They become renderer work only if ranged draws outperform whole-mesh
LOD/culling on both target classes. They never become JSX nodes.

Patchpit and Sneeze research may contribute adapter vocabulary for embedding,
streaming, trust, or lifecycle boundaries. Their `Context`, `Surface`, and
similar host terms do not become Royal public types; Royal keeps its scene and
Canvas product contract and maps such concepts at integration adapters.

## Implementation Order

1. Preserve retained visual/performance baselines.
2. Remove text/UI/editor code and eager codec loading.
3. Contract the public React/core surface and delete obsolete examples/tests.
4. Preserve the landed retained frame-plan, semantic-resource, and GPU-arena
   ownership boundaries.
5. Continue only the ownership-deleting slices listed in the repository
   [TODO](../TODO.md).
6. Replace the public pass graph with the private compiled DAG.
7. Add the minimal Primitive/effect escape hatches.
8. Validate physical iPad and Quest quality, lifecycle, and performance.

Every abstraction must delete coupling or measured hot-path work. Moving code,
adding interfaces, or creating packages without changing ownership does not
count as decomposition.

## Examples And Visual Oracles

Khronos glTF Sample Assets are the source of truth for glTF feature behavior.
The examples application uses one data-driven rig with:

- a manifest of model/variant URLs and the features each case exercises;
- shared camera fitting, orbit controls, authored HDR environment, exposure,
  tone mapping, transparent-background policy, loading, and error display;
- dynamic model/example modules so the initial application does not import the
  complete corpus;
- deterministic capture size, camera, environment, and presentation settings;
- reference-image comparison plus renderer/load/performance diagnostics;
- explicit ordinary, compressed, SVG, VT, instanced, and XR stress profiles.

The full corpus inventories optional features from the Khronos extension
registry, Sample Assets, Asset Generator, and compatibility suites. Every case
is classified as `supported-oracle`, `normalized-ingestion`,
`parsed-unsupported`, `intentional-out-of-scope`, `known-limitation`, or
`expected-required-failure`. Corpus membership does not imply support. Unknown
optional semantics are diagnosed; unsupported required semantics fail
precisely. The inventory includes deformation/animation even while the initial
runtime deliberately does not implement it.

Main navigation contains only a few representative product stories. The broad
Khronos matrix is a compatibility lab, not a set of hand-authored examples or a
reason to expose extension-specific JSX.
