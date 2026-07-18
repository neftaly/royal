# Clean implementation strategy

Status: accepted implementation decision

## Decision

Royal will implement these specifications in a new architecture rather than
incrementally reshape the current renderer. The current implementation is an
evidence source, not an architectural dependency.

The replacement MUST NOT call into a legacy renderer, preserve legacy owners
behind adapters, or ship a runtime switch between old and new paths. Small
proven leaf algorithms may be transplanted only through the review protocol
below. Public behavior, fixtures, device traces, and valid tests may survive;
the existing ownership graph does not.

This is not permission to redesign behavior casually. Consumer-facing behavior
comes from the specifications and the accepted public API review. Existing code
may reveal an omitted edge case, but it cannot silently override the spec.

## Approaches reviewed

### Incrementally refactor the current implementation

Advantage: the product remains continuously feature-complete and changes can be
small.

Rejected because the difficult parts are ownership and path structure. Moving
the present caches, arenas, state shadows, and orchestration behind new names
would preserve their coupling. Local cleanup cannot establish one GL owner or
one canonical lifecycle by accumulation without the old contracts shaping the
destination.

### Delete and rewrite in place on the main development line

Advantage: no duplicate implementation and no temptation to reuse old owners.

Rejected as the working method because it removes runnable comparison too
early. Long periods without coherent frames, browser tests, or package builds
encourage speculative design and make regressions difficult to localize. Git
history is not a convenient live visual or performance oracle.

### Keep permanent legacy and v2 runtime paths

Advantage: easy A/B comparison and gradual consumer migration.

Rejected. Royal has no external compatibility consumers. Two renderers would
double lifecycle, fallback, bundle, test, and debugging surface and would
inevitably diverge. No public `legacy`, `v2`, feature flag, or automatic fallback
is introduced.

### Replace one subsystem at a time inside the old root

Advantage: narrower changes and reuse of the working shell.

Rejected as the primary method. Root ownership, frame planning, resource
reconciliation, texture binding, and GL state cross subsystem boundaries. New
subsystems embedded in the old shell would be forced to speak old contracts and
could not prove the target architecture.

### Keep renderer-core and React, rewrite only WebGL

Advantage: backend replacement is isolated and the current descriptor/types
already avoid direct WebGL objects.

Rejected as a blanket constraint. The consumer API has no compatibility burden
and must be reviewed before it dictates canonical scene shapes. Keep a current
constructor, type, or React behavior only when it independently satisfies the
consumer and product specifications. The likely outcome may preserve many
names, but package survival is a review result rather than an input assumption.

### Extract a shared pure core from the old renderer first

Advantage: apparently reusable math, planning, validation, and state machines
could accelerate the replacement.

Rejected as a phase. Extraction starts from legacy dependency boundaries and
often preserves allocation, identity, or data-shape assumptions behind a pure
signature. Design each destination core from its invariant, then apply the leaf
transplant protocol to individual candidates.

### Reimplement every line without consulting current source

Advantage: strongest protection from accidental architectural inheritance.

Rejected as wasteful and less safe. It would discard hard-won format edge
cases, target-browser knowledge, independent codec integrations, and useful
oracles. Isolation comes from authority and dependency rules, not intentional
amnesia.

### Adopt or fork an established WebGL engine

Advantage: mature glTF loading, materials, WebXR, broad device workarounds, and
a large compatibility corpus.

Rejected as Royal's architecture and dependency base. General engines bring
scene/ECS ownership, mutable object graphs, renderer-specific materials,
loading managers, plugin paths, bundle surface, and fallback semantics that
conflict with Royal's pure descriptors, resource governance, demand rendering,
exact identities, VT, and single state owner. Deeply forking one would replace
a Royal rewrite with a larger upstream-coupling project.

Established engines remain valuable independent visual/reference oracles for a
behavior they actually support. Their public APIs, scene graphs, fallback
choices, render paths, and source structure are not architectural evidence for
Royal. Narrow independently maintained codecs or leaf utilities may be admitted
through the same transplant/dependency review as current Royal code.

### Make the replacement WebGPU-first, WASM-first, or worker-owned

Advantage: WebGPU compute/indirect facilities, WASM numeric throughput, or a
worker-owned canvas could enable different performance architectures.

Rejected. Safari 17/A10-class and Quest 2 establish a WebGL2 main-thread/XR
context floor. A WebGPU renderer would not satisfy that floor. A WASM renderer
core would add binary/startup/interoperability weight without solving WebGL/XR
ownership and would complicate iPad delivery and debugging.

A worker-owned renderer is attractive in isolation, but Quest 2 does not provide
the OffscreenCanvas/WebXR path Royal requires. It would also create a distinct
DOM/event/XR transfer lifecycle. Workers remain optional lazy leaf executors for
demanded codecs or preparation only. Any codec WASM binary is format-demanded,
separately attributed, and absent from the initial renderer bundle; it is not a
Royal architecture layer.

### Delete feature breadth, then refactor what remains

Advantage: a smaller old renderer might be easier to understand and reshape
while retaining more working behavior.

Rejected as the primary route. The central root/state/resource/texture coupling
exists in the essential glTF, presentation, and lifecycle path, not only in rare
features. Deleting unsupported or unjustified behavior is still required, but
it does not substitute for the clean boundary.

### Isolated clean implementation with vertical evidence slices

Accepted. Develop the replacement on an isolated branch/worktree while the
current checkout remains available as a behavior and performance oracle. The
replacement branch targets the final package names and public entrypoints; it
does not publish a second renderer package. Each slice is coherent, runnable,
and explicitly rejects unsupported behavior until that behavior is implemented.

At integration, the repository contains only the new implementation. The old
source remains available through version control, not in production modules,
fallbacks, bundles, or tests.

## Authority order

When evidence disagrees, use this order:

1. safety, ownership, and lifecycle invariants in these specifications;
2. reviewed consumer behavior and public API contracts;
3. format specifications and official conformance assets;
4. accepted Royal visual fixtures and physical-device observations;
5. property and integration tests that assert behavior rather than structure;
6. current implementation behavior;
7. current implementation structure.

Items six and seven never override a deliberate specification decision. A
disagreement between items one through five is a specification gap and MUST be
resolved before copying behavior.

## What may survive

Retain or adapt these as evidence where they remain correct:

- package-consumer compilation tests and representative React examples;
- Khronos and Royal asset fixtures with explicit visual/behavioral oracles;
- target-device harnesses, traces, frame and resource telemetry;
- pure property/fuzz generators whose assertions express current specs;
- format validation cases, security fixtures, and cancellation/context-loss
  scenarios;
- independently maintained third-party codecs and their narrow adapters;
- stable public names only after the consumer-DX review accepts them.

Tests that assert module names, private call order, owner layout, cache shape,
or exact legacy GL traffic are not conformance evidence. Rewrite or remove them.

## Leaf transplant protocol

A block may be copied only when all of the following are true:

1. the destination interface is designed first from the specification;
2. the block is a bounded leaf, not an owner or orchestration layer;
3. inputs, outputs, mutation, allocation, and failure behavior are explicit;
4. it has no hidden browser, GL, cache, scheduling, or global authority;
5. focused tests or a reference oracle establish its semantics;
6. its source data shapes do not leak into the destination hot path;
7. copying it is simpler than rederiving it and reviewing the new form.

Likely candidates include finite arithmetic, matrix/projection math, accessor
bounds validation, codec bit interpretation, color transforms, and focused
shader formulae. They still require review for allocations, precision, target
browser behavior, and caller-owned storage.

Do not transplant the current root, surface executor, resource/texture/VT
arenas, schedulers, state caches, retained registries, or their shared mutable
records. Do not import a legacy module temporarily with a promise to remove it.

## Architectural skeleton

The replacement begins with these boundaries, before feature breadth:

```text
React / imperative consumer intent
  -> public validation and immutable semantic descriptors
  -> prepared assets and canonical scene transactions
  -> retained revisions and pure multi-view frame selection
  -> resource requirements and governed reconciliation
  -> resolved packets with complete state intent
  -> one WebGL state transition owner and executor
  -> bounded lifecycle/status/diagnostic observation
```

The functional cores do not own clocks, promises, browser objects, caches, or
GL handles. Imperative owners do not invent semantic fallback, identity, LOD,
picking, or visibility rules. Caller-owned scratch is part of a pure function's
contract where allocation-free operation matters.

The source tree SHOULD make this map obvious without opening a root file. Each
top-level subsystem has a short responsibility/index document, public/internal
entrypoints are explicit, and files are named for their owned concept rather
than generic `utils`, `manager`, or `helpers`. This codebase DX is subordinate
to consumer behavior and MUST NOT create abstractions that leak publicly.

## Vertical slices

Every slice ends in a runnable consumer path and records unsupported behavior
honestly. These are acceptance milestones, not minimum change sizes: split them
into smaller coherent changes, but do not combine milestones merely to report
more feature progress. The order is architectural rather than a promise of
release dates.

### 0. Consumer contract

Settle the React-first task vocabulary, lower-level escape hatch, descriptors,
status unions, errors, units, identity, tree-shaken entrypoints, and package
consumer tests. Remove aliases and backend-shaped public types before internal
code makes them expensive to change.

### 1. Root and frame spine

Implement root creation/disposal, context generation/loss, demand coalescing,
external-clock authority, ordered views, complete frame intent, the resource GL
lane, and one GL state owner. A clear-only canvas and synthetic multi-view frame
must already survive resize, disposal, loss/restoration, and stale callbacks.

### 2. One canonical visible and pickable surface

Render the same simple triangle/box through direct scene construction and a
minimal glTF asset after both lower into one canonical geometry/material path.
Add transforms, conservative bounds, exact picking, opaque depth, presentation,
and stable identity together. This proves that rendering and picking do not
start as parallel systems.

### 3. Progressive asset and resource lifecycle

Add external/GLB buffers, validated accessors, geometry upload, atomic prepared
scene publication, cancellation, admission, status, and reconstruction recipes.
Exercise slow, failed, shared, replaced, and context-lost loads before broad
format support.

### 4. Ordinary textures and baseline PBR

Establish the canonical texture upload contract, orientation, color/alpha,
samplers, neutral fallbacks, progressive image publication, core
metallic-roughness, lights, and environment behavior. Prove Safari/A10 and Quest
memory/upload behavior before adding extra material features.

### 5. Instances, LOD, and variants

Add one instance protocol, maximum coverage across views, authored LOD,
and material variants. Repeated nodes, GPU-authored instances, and explicit
bulk instances lower into the same retained changes and picking identity.

### 6. XR integration

Add session clock/lifecycle, runtime framebuffers, and real WebXR views against
the synthetic multi-view behavior established by the frame spine. XR plugs into
the existing frame transaction; it does not fork scene preparation, resource
selection, or execution.

### 7. Virtual texturing

Build VT against the already-proven texture, view, resource, fallback, and
state contracts. Implement authored and automatic sources through one demand
and publication model. Do not port the current VT owners as a starting point.

### 8. Static fidelity breadth

Add the reviewed static material/format extension profile incrementally. Each
extension lowers away during preparation and has an official or fixed Royal
oracle. Transmission gets a stable opaque source, depth-aware screen-space
refraction, roughness mip selection, and environment fallback; no path tracer or
second renderer is introduced.

### 9. Optimization and release proof

Only after representative paths exist, specialize shaders, add optional WebGL
accelerations, adjust physical layouts, split lazy chunks, or transplant
additional leaf algorithms. Optimization remains within the same semantic
packets and lifecycle. Complete physical/browser, bundle, memory, security, and
failure evidence before replacing the current release line.

## Slice acceptance gate

A slice is complete only when it has:

- one idiomatic consumer example using public entrypoints;
- compile-time API coverage and self-documenting public types;
- deterministic core tests plus property/fuzz tests where the input space is
  combinatorial;
- lifecycle/failure tests for every new imperative owner;
- browser visual or pixel evidence for rendering semantics;
- CPU, GPU, allocation, memory, upload, and reachable-gzip observations
  proportional to the slice;
- a module-graph check proving unused optional features neither evaluate nor
  enter the initial/reachable chunk;
- a write/revision audit for hot owners: no mirrored mutable authority,
  unconditional broad reset, or downstream invalidation without semantic
  change;
- Safari 17/A10-class and Quest 2 evidence when the slice touches a physical
  capability or hot path;
- no dependency on a legacy implementation module;
- an updated conformance ledger marking proof, limitation, or remaining gap.

Passing old tests is insufficient, and temporary duplicated semantic paths do
not satisfy the gate.

## Adversarial rewrite review

### The spec is incomplete

Attack: clean code faithfully implements an underspecified behavior and later
requires another rewrite.

Resolution: begin each slice with examples, failure cases, and evidence mapping.
If current behavior reveals a missing decision, update and review the spec
before code. “Match old Royal” is not an acceptable requirement.

### The old renderer becomes a hidden oracle

Attack: screenshots and tests canonize accidental flips, fallbacks, timing, or
color bugs.

Resolution: classify every oracle by authority. Use format specifications,
known source images, analytic values, and independent reference renderers where
possible. Differential output is evidence of a difference, not proof that old
Royal is correct.

### Leaf copying recreates coupling

Attack: a useful function pulls its types, cache, allocator, and owner with it.

Resolution: destination interface first, leaf-only transplant, no legacy
imports, and a review that counts retained dependencies and mutation. Rewrite a
candidate when its smallest useful boundary is not actually small.

### Vertical slices create temporary duplicate paths

Attack: direct geometry and glTF, canvas and XR, or ordinary and VT each acquire
separate executors while waiting for later consolidation.

Resolution: the first slice defines the canonical records and packet ABI.
Later inputs must lower into them immediately. A temporary source adapter is
allowed; a temporary renderer/executor/fallback path is not.

### Feature parity becomes endless

Attack: uncommon extensions delay the architecture indefinitely.

Resolution: implement the settled first-class static profile in explicit
priority order. Unsupported required semantics fail. Deferred and out-of-scope
features do not count against replacement completion.

Replacement completeness is the first-class behavior in the product, asset,
texture, rendering, interaction, lifecycle, and performance specifications—not
every export, test, diagnostic counter, or code path present in the old tree.

### Performance arrives too late

Attack: beautifully separated code allocates or submits too much, and the
problem is structural by the time profiling starts.

Resolution: every slice records frame allocations, GL transitions, upload and
memory peaks, and device traces. Optimize ownership and data flow early; defer
only representation micro-choices and optional acceleration.

### Functional core becomes allocation-heavy abstraction

Attack: purity is implemented as immutable graphs and copies on every frame.

Resolution: pure semantics may write explicit caller-owned storage. Compare a
readable reference model with the retained production form using differential
tests. Purity means controlled effects, not mandatory allocation.

### The isolated branch diverges for too long

Attack: current assets/tests evolve while the replacement silently falls
behind.

Resolution: regularly import spec, fixture, and consumer-contract changes, keep
slices small, and record parity in the shared conformance ledger. Do not merge
old implementation changes merely because they are recent.

### Tests are removed until the rewrite appears green

Attack: implementation-shaped tests are correctly deleted, but behavior gaps
become invisible or are represented by untracked skips.

Resolution: every removed test is classified as obsolete structure, duplicate
evidence, or a behavior claim moved into the conformance ledger. Unsupported
first-class behavior remains an explicit failing gate or declared incomplete
slice; it is never hidden by a broad exclusion pattern.

### Agent-oriented structure becomes documentation ceremony

Attack: context maps become stale or the implementation is split into dozens
of indirection files solely to reduce prompt size.

Resolution: documentation names real owners and is checked during boundary
changes. Prefer cohesive files and explicit interfaces; no arbitrary LOC limit.
Agent comprehension is evidence for architecture clarity, not a reason for
abstraction by itself.

### The final swap retains legacy debt

Attack: unused old modules, flags, tests, and package exports survive “for
safety.”

Resolution: final integration includes a deletion review. No old runtime
module is reachable, no compatibility flag is public, bundle attribution shows
one renderer, and tests refer only to current contracts and fixtures.

### Parallel agents invent different architectures

Attack: independently reasonable slices introduce competing canonical records,
owners, status vocabularies, or temporary execution paths.

Resolution: the pipeline and current slice contracts are shared authority.
Parallel work is limited to bounded leaf modules or evidence that depends on
those contracts. Any change to an owner boundary, packet ABI, canonical record,
or public type is integrated serially with its spec update before dependent
work continues.

## Rejected shortcuts

- mechanically translate old classes into functions;
- wrap every old owner in a “functional” facade;
- keep the old renderer as an automatic failure fallback;
- copy whole directories and clean them later;
- preserve public APIs only because tests import them;
- defer all performance and device work until feature parity;
- call a large snapshot suite a specification;
- add a generic engine/ECS, render graph, or backend abstraction to make the
  rewrite appear future-proof.
