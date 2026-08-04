# Scene-to-frame pipeline

## Required stages

All visible and pickable content follows these conceptual stages:

```text
public descriptors / controller revisions
  -> validation and normalization
  -> prepared semantic assets (CPU, no GL handles)
  -> retained scene bindings and explicit deltas
  -> view-dependent selection and frame plan
  -> resource reconciliation on the GL lane
  -> resolved submission packets
  -> WebGL execution
```

Physical modules may combine adjacent stages when measured overhead warrants
it, but their contracts and ownership MUST remain separable and testable.

## Functional core, imperative shell

Validation, transforms, bounds, material lowering, LOD choice, visibility,
packet identity, resource requirements, picking math, and state-transition
meaning SHOULD be deterministic functions of explicit inputs.

The imperative shell owns browser APIs, clocks, observers, fetch/decode jobs,
mutable caches, arenas, and WebGL calls. Shell objects SHOULD orchestrate pure
decisions rather than duplicate them.

Functional core does not mean immutable allocation on every frame. Pure code
MAY write caller-owned scratch arrays or output structures when ownership is
explicit and tests show equivalent behavior. Hot functions SHOULD offer stable
storage or arenas instead of allocating transient object graphs.

The preferred implementation is the simplest one whose ownership and
performance meet the product target. A microbenchmark win does not justify
duplicated semantics, obscure mutation, or a second lifecycle. Pure decisions
SHOULD remain readable enough to compare directly with their specification and
reference/property tests.

## Preparation

Asset preparation validates untrusted input and produces canonical CPU data.
It MUST NOT create, retain, or delete WebGL handles. Codec-specific and
format-specific structures MUST be lowered before frame selection unless their
representation is explicitly required for deferred resource upload.

Prepared data is keyed by content/preparation identity, not mounted node
identity. It MAY outlive one scene claim within a bounded owner. Errors are
stable preparation outcomes, not partially initialized entries.

## Retained scene state

Scene commit computes one coherent transaction. It acquires new claims before
releasing obsolete claims where necessary to avoid visible holes for unchanged
content. It records explicit revisions/deltas for mutable controller channels.

The production path MUST be retained and incremental: camera motion does not
reparse assets or rebuild scene topology; one transform patch does not scan all
instances; one texture completion does not recompile unrelated assets.

Independent prepared glTF roots publish focused readiness and begin their
selected texture lifecycles immediately. Their structural scene/GPU changes
coalesce at the existing frame authority: every root which settles before one
canvas or XR frame enters one coherent scene transaction. This is not an
all-ready barrier; the first prepared root remains eligible at the next frame.
Imperative picking MUST flush a pending structural transaction before querying
the shared scene, and external frames MUST flush the same glTF and texture
publication paths rather than maintaining XR-specific state.

Render-object refs attach through one root-owned lifecycle, but their validated
transform state enters a GL-free retained-scene update. Cold lowering indexes
only ref-bearing nodes. One update mutates the affected model/normal matrices,
world and LOD bounds, picking inverses, handedness, and authored glTF lights;
the WebGL shell refreshes matching packets and uniforms without replacing the
scene or geometry storage. Declarative reconciliation and imperative mutation
MUST use this same path.

A slower pure full computation SHOULD exist where useful as a differential
oracle for fuzzing. It MUST NOT become a silent production fallback.

## Frame selection

Frame selection takes the committed canonical state, ordered render views,
resource readiness, capability/quality policy, and caller-owned scratch. It
MUST NOT fetch, decode, subscribe, compile arbitrary source formats, call GL,
or mutate application state.

Selection determines:

- conservative visibility and projected coverage;
- LOD across all active views;
- material/shader variants demanded by visible content;
- opaque, alpha-mask, transparent, transmission, wireframe, and picking work;
- resource declarations and legal fallbacks;
- stable logical identity carried into pick records.

Stereo selection MUST consider every view. A resource or LOD sufficient only
for the left eye is not sufficient for the frame.

## LOD behavior

Authored LOD levels lower to one canonical ordered set. Selection uses maximum
projected screen coverage across views and hysteresis around transitions.
`MSFT_lod` and `MSFT_screencoverage` are ingestion declarations; no
extension-specific executor path survives lowering.

Each mounted node occurrence owns its LOD identity and world-space selection
bounds. Reusing one prepared asset at multiple transforms MUST NOT merge those
bounds or force the mounts to select the same level. Canonical lowering scopes
the asset-local group key to its stable mount occurrence, then assigns one
dense scene-local numeric identity before retained hysteresis, visible
submission, and picking consume it. Asset-local identities and compound mount
strings do not survive into those retained paths.

If the ideal level is not drawable, Royal SHOULD select the closest drawable
level that preserves content. A positive authored terminal threshold MAY cull
the whole set below that coverage. LOD changes MUST NOT alter logical picking
identity. An admitted material LOD level becomes drawable only when its base
presentation is resident on the GPU, or when it has no base image. Pending and
failed preferred images therefore cannot replace a resident lower level;
ordinary materials outside a LOD set retain the neutral base-color fallback.

Royal does not generate mesh LODs in the browser. Automatic Royal LOD is an
offline authoring/preparation concern: it emits explicit levels and coverage
thresholds that enter this same authored selection path. The runtime MUST NOT
silently simplify, decimate, or omit dense geometry to meet a frame-rate goal.
Geometry compression changes transfer/decode cost, not the selected triangle
work; a dense scene that is GPU-bound after loading needs authored/offline LOD,
not a different compression claim.

## Resource reconciliation

The frame plan declares resource identity and requirements, not handles.
Reconciliation is the only stage that creates, uploads, restores, suballocates,
or deletes GPU resources. It executes serially on the root-owned GL lane and
obeys root-wide admission budgets.

Resource declarations act as reconstruction recipes for the current canonical
state. Resolved handles are borrowed for a submission and MUST NOT leak into
prepared assets, public snapshots, or later context generations.

An admission denial produces a specified fallback, deferral, or captured
failure. It MUST NOT leave half-published state.

## Execution

The executor consumes explicit resolved packets. It MUST NOT know React,
perform asset IO, parse glTF/SVG, select LOD, infer logical identity, create
resources on cache miss, or invent fallbacks.

Pipeline state and numeric binding locations SHOULD compile once per stable
variant. Submission SHOULD reuse arenas and perform no per-draw JavaScript
closure creation, object spreading, string construction, or unbounded array
growth.

Stable program, fixed-pipeline state, texture bindings, texture-unit mask, and
vertex array compile into one retained draw packet. The active framebuffer and
viewport form a separate per-view frame packet. Submission passes those two
records directly to the state owner; it does not reconstruct retained state by
assigning fields for every visible draw. Multi-draw compatibility compares the
same retained packet consumed by ordinary submission. It MAY combine a maximal
contiguous run in any pass only after that pass has established its required
order. The extension call MUST preserve that order and MUST be semantically
equivalent to submitting the same selected ranges individually.

External GL use, including XR runtime work, crosses one explicit Royal state
invalidation/restoration boundary so cached assumptions cannot leak between
owners.

## WebGL state boundary

Frame planning emits complete pipeline and binding intent. Packets MUST NOT rely
on undocumented state inherited from a previous draw or pass. Complete intent
does not require repeating GL calls: one root-owned imperative state owner
compares the next intent with its last applied state and performs only required
transitions.

The state owner covers program, vertex array, framebuffer, viewport/scissor,
depth/cull/blend/color masks, active textures/samplers, and other mutable
bindings used by Royal. Royal does not request, allocate, clear, or depend on a
stencil buffer. Feature subsystems MUST NOT keep competing shadows of the same
GL state. The owner MUST NOT call `getParameter` or otherwise query state during
ordinary submission.

The shadow is a call-suppression cache, not semantic state. It resets to unknown
on context generation changes and after external/XR GL use. When unknown, the
next complete intent establishes Royal's state explicitly. Owned resource
handles are generation-safe, so equality with a stale-generation handle is
impossible.

Texture-unit validity is tracked per unit. A draw that samples no textures—or
only a subset of the available units—MUST NOT validate other units after an
upload or pass has borrowed texture state. A later sampler therefore rebinds
its exact image even when an intervening untextured draw used no texture calls.
An owned upload or copy invalidates only the units it actually borrowed;
unknown external work invalidates the complete shadow.

State-transition meaning SHOULD have a pure, allocation-free decision layer or
reference model that can be differentially tested. The imperative layer alone
issues WebGL calls and updates the shadow only after each successful call.

Within ordering constraints, frame selection MAY group compatible draws to
reduce program, VAO, material, texture, blend, and target transitions. Opaque
and depth-writing transmission reordering MUST preserve depth correctness and
stable picking identity. Transparent and alpha-blended transmission ordering
wins over state minimization.

## No parallel semantic paths

Ordinary nodes, glTF occurrences, authored `EXT_mesh_gpu_instancing`, and
explicit bulk instances may have different preparation inputs, but equivalent
geometry/material/instance records MUST converge before selection and drawing.

Visible rendering and picking MUST share transforms, culling, sidedness,
logical identity, instance indexing, and exact geometry normalization. Optional
picking geometry replaces only the triangle source used for exact intersection;
it does not create a second interaction lifecycle or GPU rendering path.

The same collapse rule applies beyond textures:

- glTF primitive encodings lower to one prepared vertex/index ABI;
- authored, repeated, and explicit instances lower to one canonical instance
  record/change protocol;
- extension and Royal LOD declarations lower to one LOD set;
- pointer, imperative, and future XR rays lower to one picking query;
- ordinary and XR clocks submit through one frame-demand authority;
- all draws lower to a small packet ABI independent of source format.

Canonicalization SHOULD avoid a copy when validated source storage already
matches the ABI. “One path” means one semantic and executor contract, not
eagerly repacking every asset into an identical allocation.
