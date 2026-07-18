# Architecture pattern selection

Status: accepted design guidance

Royal uses a small vocabulary of patterns deliberately at different scales.
This document bridges product behavior and implementation structure. It is not
a catalogue of patterns every subsystem must contain.

## Selection questions

Before selecting a pattern, answer:

1. Is the problem a pure mapping, a retained incremental computation, or a
   temporal lifecycle with illegal transitions?
2. Who is the single writer and what may observe the result?
3. Can work complete asynchronously after its consumer, scene, or context is
   obsolete?
4. Does mutation require atomic publication or rollback?
5. What identity survives source, representation, allocation, and generation
   changes?
6. Is the path cold, per asset, per frame, per draw, per fragment, or per page?
7. What storage is caller-owned, owner-retained, borrowed, transferred, or
   copied?
8. What wakes deferred work and what terminates retries?
9. Which browser/GL effects must be serialized?
10. What independent oracle can prove the semantic core?

Choose the smallest pattern that makes the answers explicit. A named pattern is
not evidence that the design is correct.

## Cross-layer concern matrix

Every public feature, canonical record, mutable owner, and vertical slice is
reviewed across these concerns. “Handled elsewhere” names the actual owner and
contract; it is not an acceptable blank.

| Concern | Required question |
| --- | --- |
| Consumer task | What does the React or imperative consumer express or observe, and can the concept remain private? |
| Authority | Who is the single writer and which inputs are untrusted, borrowed, or externally owned? |
| Lifetime | What creates, retains, supersedes, cancels, restores, and disposes it? |
| Identity | Which logical, content, representation, allocation, and generation identities apply? |
| State | Is this a pure value, revisioned derived data, transaction, or real temporal state machine? |
| Pipeline | At which stage is variation validated, lowered, retained, selected, reconciled, or executed? |
| Mutation | Which assignments are necessary, and which mirrored/derived writes and invalidations can disappear? |
| Storage | What is immutable, retained, caller-owned, borrowed, transferred, copied, or GPU-resident? |
| Frequency | Is work per import, root, asset, revision, frame, view, draw, instance, page, texel, or fragment? |
| Async | What owns jobs, bounds concurrency, prevents reentrancy/stale publication, and wakes deferral? |
| CPU/GPU | Which side performs the work, and does moving it require bandwidth, synchronization, readback, or duplicate state? |
| WebGL | What complete state/resource intent is required, and how is optional capability selected/restored? |
| Precision | What units, coordinate/color domain, finite/range arithmetic, quantization, and deterministic ordering apply? |
| Failure | Is failure author, content, degradation, denial, interruption, scheduled, explicit-call, or XR lifecycle? |
| Security | Can bytes, SVG, extension data, URLs, diagnostics, or callbacks gain authority or unbounded work? |
| Optionality | What import, startup, bundle, cache, shader, memory, and hot-path cost exists when unused? |
| Observation | Which focused status is product behavior and which bounded diagnostic is cold operational evidence? |
| Oracle | Which unit/property/fuzz/format/visual/browser/device evidence can independently prove it? |
| Deletion | What old path, export, test, cache, alias, or feature becomes unnecessary when this lands? |

### Precision and deterministic behavior

Validate non-finite values and unsafe integer arithmetic at cold boundaries.
Offsets, byte lengths, counts, and resource totals use checked safe-integer
addition/multiplication before allocation or slicing. Hot paths may assume the
validated canonical contract but still handle degenerate projections without
unbounded work.

JavaScript numbers retain logical metre-scale values and CPU calculations where
their double precision is useful. GPU storage/shaders use the explicit WebGL2
physical representation; conversion occurs once at a prepared/upload boundary.
Do not advertise float64 asset semantics that the GPU path silently downcasts.

Stable ordering uses explicit semantic keys/tie-breakers, not incidental Map,
object, async completion, allocation, or sort-instability behavior. Epsilon and
clamping policy belongs to the individual geometric/color/material invariant;
there is no universal tolerance that silently changes unrelated semantics.

## Repository and package level

### Layered dependency direction

Use one-way dependencies:

```text
consumer adapters (React / imperative host)
  -> semantic renderer API and descriptors
  -> preparation / retained planning contracts
  -> WebGL backend ports and owners
```

Pure semantic packages do not import React, DOM, fetch, workers, WebXR, or
WebGL. The WebGL backend does not import application components. Optional XR and
codec entrypoints depend inward and remain lazy.

Enforce this with package export maps, import tests, and dependency-cycle
checks. Do not introduce a general dependency-injection container; constructors
and explicit option/port objects make authority visible.

### Ports at effect boundaries

Use narrow ports for browser time/scheduling, fetch/decode, codec workers,
canvas/context creation, WebXR, diagnostics sinks, and GL command execution when
tests or host ownership require substitution. A port describes capability, not
an arbitrary service locator.

Do not wrap every pure function in an interface. Do not add one-file ports for
stable language operations merely to satisfy an architectural style.

### Feature isolation

Optional codecs, XR, VT raster sources, IBL transport, and capability-specific
accelerations enter through explicit subpaths or demand-loaded modules. They
lower to shared canonical contracts and do not own alternative renderers.

Reject an ECS, public render graph, general plugin system, or backend-neutral
GPU abstraction. Royal is a renderer with a known WebGL2 backend and a fixed
product pipeline.

### Tree-shakable module graph

Tree shaking is designed in the dependency graph, not repaired by minification.
Public entrypoints export intentional task surfaces. Optional feature modules
are reachable only from their subpath, descriptor, asset declaration, or a
demand-time dynamic import. Shared semantic types and small pure contracts point
inward; feature implementations do not register themselves in a central mutable
registry at import time.

At module evaluation, Royal performs no capability probe, browser access,
worker construction, fetch, shader compilation, lookup-table generation, or
global cache mutation. `sideEffects: false` is a verified claim, not merely
package metadata.

Measure separately:

- initial reachable gzip for a minimal React primitive;
- initial and lazy reachable gzip for a minimal glTF scene;
- reachable bytes attributable to Basis/Draco/Meshopt, SVG/VT, IBL, advanced
  materials, and XR demand, including lazy chunks where a split is chosen;
- duplicated code across lazy chunks and chunk/runtime overhead.

Do not create a subpath or dynamic chunk for every small file. Split when it
removes meaningful initial/reachable work or establishes a valuable dependency
boundary. A barrel is acceptable for a deliberate public surface; internal
barrels MUST NOT make unrelated feature modules reachable or conceal cycles.
Closely coupled static-PBR shader/material code may remain together when a split
would duplicate code or add more scheduling/cache complexity than bytes saved.

### Decoupling by volatility and authority

Decouple when two concerns change for different reasons, own different effects,
or require independent replacement/testing. Strong boundaries include:

- consumer intent versus renderer execution;
- format/source data versus canonical semantics;
- content identity versus representation and allocation;
- pure selection versus resource/GL effects;
- physical ownership versus diagnostic projection;
- ordinary frame clock versus external XR clock authority;
- texture content/allocation versus sampling state;
- visible/picking inputs versus their shared geometry/identity semantics.

Do not decouple cohesive operations solely to reduce file length, produce more
interfaces, or make every dependency mockable. Prefer direct imports for stable
pure helpers and explicit constructor ports for volatile effects. A boundary
earns itself by removing a dependency direction, lifecycle, hot-path branch,
reachable chunk, or independent reason to change.

Composition occurs in a small package/root composition layer. It wires owners
and ports but does not become the place semantic decisions or feature-specific
fallbacks accumulate.

## Pipeline and subsystem level

### Staged compiler pipeline

Treat descriptor/asset processing as staged lowering:

```text
validate -> normalize -> prepare -> retain -> select -> reconcile -> execute
```

Each stage has an explicit input/output contract and erases variation it owns.
Stages may share a physical module when cohesive, but later stages MUST NOT
reach backward to parse formats, infer defaults, or recover source semantics.

This is compiler-like lowering, not a chain-of-responsibility fallback system.
Failures are classified outcomes; a stage does not silently ask an older path
to render instead.

### Canonical records plus specialized owners

Equivalent direct, glTF, repeated, instanced, LOD, canvas, XR, ordinary texture,
and VT inputs converge on canonical semantic records. Specialized owners remain
separate where lifecycles genuinely differ. Reuse records and transition
grammar, not one universal manager.

### Fixed private pass planning

Use a small private pass planner for opaque/mask, transmission, transparent,
wireframe, postprocess, and presentation consequences. It emits complete packet
intent. Do not implement a general render-graph framework or expose passes to
consumers. Transient-target lifetime may be planned explicitly without making
the graph public or dynamically programmable.

## Owner level

### Single writer, explicit observation

Every mutable domain has one writer. Other subsystems consume immutable views,
versioned records, events, or narrow query results. Two owners MUST NOT cache
and mutate the same semantic or GL state.

An owner declares:

- domain and mutable fields;
- identity and generation;
- acquisition and idempotent release;
- accepted commands/events;
- publication and observer semantics;
- retained/high-water storage;
- failure and retry/wake policy;
- reconstruction after context loss where relevant.

Imperative owners may be classes or closure-backed objects. Prefer composition
and private state; do not use inheritance hierarchies to share lifecycle.

### Claim and lease

Use explicit consumer claims for shared prepared content and explicit leases for
root/context-owned physical resources. Releasing one claim does not cancel work
still claimed elsewhere. Release is idempotent and allocation never crosses a
context generation.

Claims and leases are not public memory-management APIs. They are internal
ownership tokens with bounded diagnostic projection.

### Generation-tagged handles

Use opaque root-local numeric handles plus generation where hot paths need
compact identity. Public logical identity and content identity remain separate.
Never infer validity from object survival or a reused numeric slot alone.

## State-machine level

### When to use a state machine

Use an explicit finite state machine when the domain has temporal events,
illegal transitions, asynchronous completion/recovery, or externally observable
lifecycle. Expected domains include:

- root context lifecycle;
- render clock and external-clock ownership;
- XR capability, acquisition, and live-session lifecycle as separate machines;
- prepared asset and individual image settlement;
- ordinary texture and authored VT readiness;
- VT page request/decode/admission/publication;
- shader/program compilation readiness;
- pointer hover/down/click interaction state.

Do not use a state machine for a pure transform, GL state diff, resource
arithmetic, LOD formula, cache lookup, or fixed pipeline stage merely because it
contains conditionals.

### Reducer plus imperative effect owner

Represent a machine with a closed discriminated state union, a closed event
union, and a deterministic transition function. The transition returns the next
state plus bounded semantic effects where effects are needed. The imperative
owner executes browser/resource effects and feeds completion events back with
identity and generation.

Effects are a small domain-specific command set, not a general interpreter,
actor framework, or callback bag. In hot machines, write effects into
caller-owned storage rather than allocate arrays/closures per transition.

Update observable state atomically after a valid transition. Invalid events are
either programmer invariant failures or explicitly ignored stale-generation
events; do not blur the two.

### Compose machines instead of building one statechart

Root, context, asset, texture, XR, and page lifecycles have different authority
and cardinality. Keep them separate and coordinate through explicit events and
claims. Do not form one Cartesian product state or introduce a generic global
statechart library.

Shared helpers may validate exhaustive transitions, generation, or terminal
states, but domain names and legal events remain visible.

## Transaction and publication level

### Prepare then atomically publish

Use a transaction when readers must never observe a partial coherent revision:

- scene commit and prepared asset publication;
- resource allocation/upload before handle visibility;
- VT atlas upload plus page-table mapping;
- context restoration of the selected frame requirements;
- replacement of a texture/material representation.

Build and validate candidate state, reserve/acquire required ownership, publish
one new revision, then release superseded claims. Failure aborts or quarantines
side effects according to the owner; it does not leave half-published records.

Do not use transactions for every scalar camera or counter update. Versioned
channels and ordinary owner mutation are sufficient when one writer and one
commit boundary already define coherence.

### Reconstruction recipe

Retained semantic requirements act as recipes; GPU handles do not. Context
restoration re-reconciles current recipes into a new allocation generation and
selects a fresh frame. Do not serialize or retain stale command buffers as the
authority.

## Async and scheduling level

### Structured ownership and cancellation

Every async job belongs to a root/subsystem owner and one or more consumer
claims. Use `AbortSignal` where the underlying operation supports cancellation,
but still guard completion with identity/generation because cancellation may be
late or advisory.

No floating promise may publish directly into scene/frame state. Cache hits and
completions cross the same asynchronous publication boundary to avoid
reentrancy-dependent behavior.

### Bounded priority scheduler

Use one root-wide admission/priority scheduler for demanded heavy preparation,
with job implementations remaining specialized. Priority favors first drawable
geometry, visible material inputs, coarse VT coverage, and then refinement.
Concurrency follows transient bytes and resource budgets, not job count alone.

Do not adopt a generic actor system, unbounded task queue, one worker per asset,
or worker-owned renderer. Workers are lazy leaf executors for heavy independent
decode/preparation whose transfer cost pays.

### Explicit wake conditions

Deferred/retryable work records why it stopped and the event that can wake it:
capacity release, new demand, backoff expiry, capability/context generation,
content version, or explicit retry policy. Permanent validation/format failure
has no frame-time retry path.

## Data and storage level

### Immutable cold data, retained hot storage

Use immutable detached descriptors, prepared semantic assets, public snapshots,
and cold capability/policy records. Use owner-retained mutable arrays, typed
arrays, bitsets, maps, and workspaces for high-frequency selection/submission.

Functional core does not require allocating immutable graphs. A deterministic
function may write caller-owned output/scratch when ownership is explicit.

### Assignment and write discipline

Royal does not pursue “no assignment” as a source-style goal. Mutation is
appropriate when it is local, single-owned, bounded, and cheaper/clearer than
allocation. The relevant metric is unnecessary writes, duplicated authority,
invalidations, and resulting CPU/GC/upload work.

Preferred writes include:

- local loop variables and accumulator updates;
- pure functions writing documented caller-owned scratch/output;
- one owner updating its closed state after a validated transition;
- typed-array range changes followed by one explicit commit;
- monotonic counters and high-water values on cold diagnostic owners;
- state shadows updated only after the corresponding effect succeeds.

Avoid:

- storing a value that can be cheaply and reliably derived from the same owned
  revision;
- copying fields from one mutable object into another long-lived mirror;
- assigning defaults or normalized objects again during every frame/draw;
- resetting or rewriting full-capacity arrays when changing logical length is
  sufficient;
- unconditional uniform, buffer, texture, GL-state, observer, or React updates
  when the semantic revision did not change;
- spread/destructure/map/filter/tuple construction in proven high-cardinality
  loops where direct indexed writes are clearer;
- assignment through shared aliases whose writer cannot be identified;
- clever assignment elimination that recomputes expensive derived data or makes
  ownership obscure.

Use `const` for bindings that do not change and `let` for honest local mutation.
Do not replace readable assignments with chained expressions, recursion, or
allocation merely to appear functional. Functional core means deterministic
effects and explicit storage ownership, not immutable syntax everywhere.

### Revisions and derived state

Use explicit semantic revisions at coarse change boundaries. Derived retained
data records which input revisions it represents; unchanged revisions avoid
recomputation, publication, observer notification, GPU upload, and frame demand.

Prefer a small explicit dependency chain over a generic reactive graph. Scene,
transform, material, view, readiness, capability, and context revisions should
invalidate only dependent bounds, packets, bindings, or allocations. Storage
compaction has its own revision and MUST NOT change logical identity.

Do not increment a revision merely because a setter/commit was called. Compare
the owned semantic range where comparison is cheaper than downstream work, or
make the caller's commit contract explicitly assert change. Do not compare huge
buffers every frame to avoid a version increment; range commits exist for that
reason.

### AoS versus SoA

Use ordinary objects/arrays of records for small, sparse, heterogeneous, or
developer-facing state. Use structure-of-arrays typed storage for high-count
homogeneous transforms, bounds, instance changes, and GPU-bound numeric data
when traces or direct upload requirements justify it.

Do not convert every scene into an ECS or every cold record into numeric tables.
Do not add custom memory managers or broad object pools without measured GC or
fragmentation evidence.

### Borrow, transfer, then copy

Prefer validated borrowing for immutable compatible input, ownership transfer
for codec/worker output, and copying only for persistent layout/binding benefit
or isolation. Account peak bytes before a copy. Canonical semantics do not imply
one physical texture/vertex layout.

### Cache separation

Keep distinct:

- source/version/content preparation identity;
- capability/quality-specific representation revision;
- root/context-generation allocation identity;
- logical scene/picking identity.

Caches are bounded owners with explicit claims and release. Avoid process-global
mutable caches and strings/URLs in frame/draw lookup.

### Data-oriented hot paths without an ECS

Compile high-count work into compact numeric keys, bitsets, typed tables, and
closed packet kinds after validation. Keep public/cold objects descriptive and
immutable. The lowering boundary prevents JavaScript object shape, URL, glTF
extension, or React variation from entering draw/page loops.

This is selective data-oriented design, not a renderer-owned entity/component
world. Do not introduce generic component storage, archetypes, systems, or
query planners for application state Royal does not own.

## Frame and WebGL level

### Reference planner plus retained planner

Where incremental selection is complex, maintain a readable full/reference
planner for differential/property testing and a retained production planner
that updates only changed revisions. The reference path is not a runtime
fallback.

### Compact complete-intent packets

Frame selection emits a small closed packet ABI with numeric keys and complete
pipeline/binding intent. Packets do not inherit undocumented prior draw state or
contain source format/React/glTF extension objects.

This is not a public command buffer and not a generic bytecode VM. Add a packet
kind only when its pass/resource semantics cannot be represented by an existing
kind.

### Pure GL state diff plus one imperative owner

Model required WebGL transitions as a deterministic diff from last successfully
applied state to complete next intent. One owner issues GL calls and updates its
shadow only after successful effects. Context generation or external/XR GL use
invalidates the shadow to unknown.

Do not query GL during ordinary frames, establish a broad unconditional baseline
each frame, or let programs/textures/geometry/passes maintain competing shadows.

### Capability snapshot and strategy

Probe required/optional WebGL capability once per context generation. Choose a
representation/pipeline strategy during cold preparation and keep it sticky for
that generation. Frames consume numeric prepared strategy; they do not use
browser-name branches or repeatedly probe extensions.

## React level

### Pure descriptors plus external stores

Use ordinary React composition, immutable semantic descriptors, context for the
owned Canvas root, and `useSyncExternalStore`-compatible focused observation.
High-frequency state lives in explicit versioned resources/controllers, not
React state and not a custom reconciler.

Callbacks belong to React event registries keyed by stable renderer identity,
not inside scene descriptors. A parent may observe an explicit root using the
same options model as a Canvas child.

Do not use Suspense promises as the renderer asset lifecycle authority. Royal
renders progressively and exposes explicit status; applications may choose how
their UI uses Suspense independently.

## TypeScript and emitted-JavaScript level

Use TypeScript to make semantic states and ownership visible without relying on
runtime language machinery:

- closed discriminated unions and exhaustive `never` checks for public/status
  and lifecycle domains;
- literal strings instead of runtime `enum`, `const enum`, or namespace output;
- `readonly` public/cold contracts, with mutable storage exposed only through
  explicit controller/owner interfaces;
- `type` imports/exports where appropriate so type topology does not affect
  runtime reachability;
- `satisfies` at construction/test boundaries where it preserves useful
  inference while checking a contract;
- `unknown` plus validation for untrusted input, not `any` propagation;
- exact optional-property semantics: absent and present-`undefined` are not
  casually treated as different hidden states;
- composition rather than class inheritance, decorators, metadata reflection,
  or framework-generated containers.

Review emitted JavaScript and bundles for public/optional entrypoints. A type
abstraction is not free if it causes runtime helpers, eager imports, duplicated
code, or shape-polymorphic construction.

Keep frequently created owner/record shapes stable: initialize owned fields
consistently, avoid `delete`, do not change a field between unrelated types, and
avoid sparse arrays. Apply this only where shapes are retained or hot; do not
obscure cold code for speculative JIT behavior.

## Error and diagnostic level

### Expected result versus invariant failure

Use synchronous exceptions for invalid consumer authoring and explicit
imperative call failure. Use typed/closed internal outcomes for expected content,
capability, admission, and component failure. Capture scheduled failures in the
owning lifecycle/status path.

Do not use exceptions for successful hot-path branching or collapse every
failure to a generic result. Programmer invariant violations remain loud and
distinct from malformed untrusted content.

### Stable bounded observation

Diagnostics use stable semantic keys, bounded occurrence aggregation, cold
snapshot materialization, and explicit timing/memory domains. They observe
owners but never control them.

## Per-owner design card

Before implementing a mutable owner, record a short design card:

```text
Purpose and non-responsibilities
Semantic core/reference oracle
Owned mutable state and single writer
State machine or other selected pattern, with reason
Identity, revision and generation
Commands/events and bounded effects
Claims, admission, publication and rollback
Retained/caller-owned storage and hot frequency
Wake, retry, failure and disposal
Observation and diagnostics
Target/browser evidence
```

The card belongs beside the subsystem contract or source map, not in a central
framework registry. If several owners have identical mechanics, review whether
a small helper is justified after their domain semantics are clear.

## Pattern-level adversarial review

### Pattern soup

Attack: every module gains ports, commands, repositories, reducers, factories,
and transactions because they sound architectural.

Resolution: select from the ten questions and state why a simpler function or
owner is insufficient. Remove patterns that do not expose a real invariant.

### One generic state-machine framework

Attack: shared mechanics erase domain state names, authority, and legal stale
behavior or add runtime/bundle cost.

Resolution: closed domain reducers and small test helpers; no generic runtime
framework until repetition and value are demonstrated across completed owners.

### Imperative shell becomes a god root

Attack: semantics are pure but every effect, cache, and lifecycle accumulates in
one orchestrator.

Resolution: one writer per domain, narrow ports between owners, and root limited
to composition and cross-domain transaction boundaries. A single GL state owner
does not imply one owner for all GPU resources.

### Effect lists become a renderer VM

Attack: reducer effects grow into generic opcodes, closures, and allocation-heavy
interpretation.

Resolution: bounded domain-specific effects only. Direct imperative orchestration
is preferable when no independent semantic transition needs testing.

### Transactions everywhere

Attack: simple updates allocate candidate graphs and rollback journals.

Resolution: transactions only protect multi-record/publication/resource
coherence. Use versioned single-writer mutation for ordinary scalar/range work.

### Functional style hides copies

Attack: immutable transforms and spread syntax multiply startup, frame, or peak
memory.

Resolution: explicit ownership, caller storage, borrow/transfer rules, and
allocation/resource traces at every vertical slice.

### Agent-friendly fragmentation

Attack: files are made tiny, interfaces multiply, and execution requires opening
dozens of wrappers.

Resolution: optimize for cohesive ownership and semantic locality, not line
count. Source maps explain boundaries; they do not replace readable code.

### State explosion

Attack: root, XR, asset, texture, and context states are combined to make one
“complete” model.

Resolution: orthogonal machines with explicit coordination and invariant tests.
Expose only the projection the consumer needs.

### Hot/cold mismatch

Attack: a clean cold abstraction is used per draw/page, or hot numeric storage
infects public/cold code.

Resolution: record frequency/cardinality in every design card and lower across
the boundary once.

### Type safety without runtime clarity

Attack: complex conditional/generic types, assertions, enums, or generated
helpers make editor types impressive while emitted ownership and state remain
unclear.

Resolution: inspect declarations and emitted code, prefer concrete domain
unions and named records, validate `unknown` once, and keep runtime shapes
obvious to JavaScriptCore, V8, SpiderMonkey, and human reviewers.

### False decoupling

Attack: interface count rises while the same owner, revision, and feature change
still crosses every module.

Resolution: review dependency direction, authority, reachable chunks, and
reasons to change. Collapse boundaries that only forward calls or rename the
same mutable record.

### Tree-shaken in theory, eager in practice

Attack: package metadata says side-effect-free but an entrypoint imports feature
registries, large constants, workers, shaders, or initialization code.

Resolution: packed minimal-consumer graphs, module-evaluation tests, reachable
gzip attribution, and browser startup traces are slice acceptance evidence.

### Assignment avoidance increases work

Attack: immutable copies, recomputation, closures, and object graphs replace
clear single-owner mutation.

Resolution: count writes, allocations, invalidations, uploads, retained bytes,
and readability together. Prefer the form with one authority and less total
work, not the form with fewer `=` tokens.
