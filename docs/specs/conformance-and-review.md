# Conformance and adversarial review

Last review: 2026-07-19

This ledger separates intended contracts from current implementation. It
prevents aspirational documentation and accidental architecture from being
treated as settled behavior.

Statuses:

- **conforms**: implementation and focused tests provide direct evidence;
- **partial**: the main semantics exist but a named contract gap remains;
- **gap**: implementation differs materially from the intended contract;
- **deferred**: intentionally absent and not current product work;
- **proposal**: design exists but has not been accepted as product behavior.

## Adversarial review passes

### 1. Scope and false-promise pass

Attack: interpret every aspirational sentence as a shipped feature.

Resolution: the specs contain decisions, and this ledger marks implementation
status. Public shader primitives, occlusion, meshlets, automatic mesh
generation, animation, and metadata APIs are not claimed. Accepted browser
image examples do not add formats to glTF.

### 2. Compatibility-alias pass

Attack: preserve pre-release aliases and accidental behavior “just in case.”

Resolution: no consumers justify aliases. Public descriptors use one field name,
reject unknown fields, and can break coherently before release. Format fallbacks
are interoperability behavior, not API compatibility layers.

### 3. Canonicalization amplification pass

Attack: make “one path” copy every asset into one texture/vertex layout.

Resolution: rejected. Canonical contracts permit small physical layout families
and borrow compatible source slices. Repacking requires a persistent measured
benefit. One physical texture format and one interleaved float vertex format are
explicitly rejected.

### 4. Hot-path leakage pass

Attack: find source formats, glTF extension names, React shapes, URLs, string
variants, browser events, and capability probing inside frame/draw behavior.

Resolution: each must stop at its cold normalization boundary. The desired hot
vocabulary is numeric revisions, canonical records, compact packets, prepared
upload/binding plans, and generation-safe handles. Current exceptions are
listed below.

### 5. Functional-core pass

Attack: identify semantic choices hidden inside mutable owner methods or WebGL
calls and “pure” functions that allocate uncontrolled graphs.

Resolution: validation, lowering, transitions, visibility/LOD, demand,
admission, packet identity, and picking meaning belong in deterministic cores.
Caller-owned scratch is permitted. The imperative shell alone owns browser,
async, cache, and GL effects. Simplicity wins over microbenchmark cleverness.

### 6. WebGL-state pass

Attack: count redundant baseline calls, competing state shadows, implicit draw
inheritance, frame-time GL queries, and external-XR leakage.

Resolution: packets provide complete intent; one root owner applies minimal
transitions; its shadow is only call suppression and becomes unknown after
external GL/context changes. Current distributed/baseline behavior is the most
important implementation gap.

### 7. CPU/GPU inversion pass

Attack: move work to the GPU without counting readback/synchronization, or keep
per-pixel work merely to save cold CPU preparation.

Resolution: WebGL2 limitations are explicit. GPU culling/transform feedback,
PBO staging, occlusion, multiview, and multi-draw are measurement-gated.
Fragment/pass features activate only for visible demand.

### 8. Memory and copy pass

Attack: double-count one allocation, retain both source and canonical copies,
hide transient peaks, or trade small CPU wins for large GPU waste.

Resolution: one physical owner, separate CPU/GPU/transient/upload domains,
overlap-labelled subsystem projections, admission before publication, and
borrow/transfer before copy. Sampler objects and semantic texture formats are
investigation targets because they may save real allocations.

### 9. JavaScript-engine and GC pass

Attack: optimize for V8 folklore, pool every object, or allocate maps/sets and
strings in per-object/per-draw loops.

Resolution: stable shapes, retained coherent workspaces, dense numeric storage
where natural, and cold detached TypeScript-readonly snapshots without runtime
freeze walks. Readability and ownership outrank microbenchmarks.
JavaScriptCore/Safari 17 and Quest Chromium are primary traces.

### 10. Async race and lifecycle pass

Attack: cache-hit reentrancy, stale completion after replacement/disposal,
shared-work cancellation, permanent retry loops, Strict Mode remounts, and
context generation reuse.

Resolution: asynchronous publication boundary, consumer claims distinct from
content entries, generation tags, idempotent cleanup, bounded wake conditions,
and reconstruction from current recipes. The existing lifecycle-heavy tests
provide broad evidence; new paths inherit the same review.

### 11. Failure/fallback pass

Attack: turn every failure grey, stall geometry for texture fidelity, flash
white/debug colors, retry validation every frame, or silently ignore required
semantics.

Resolution: explicit failure taxonomy, progressive geometry, semantic-neutral
per-slot fallbacks, stable component degradation, required extension/codec
failure, and focused product status distinct from cold diagnostics.

### 12. Security and authority pass

Attack: let glTF/SVG/extensions execute application authority, advertise regex
sanitization, recursively fetch unbounded dependencies, or leak remote payloads
through diagnostics.

Resolution: assets are untrusted data, SVG is self-contained and browser decode
is not called sanitization, interactivity/physics/audio graphs stay outside
Royal, and diagnostics are bounded. The GS proposal distinguishes profile rules
from a security guarantee.

### 13. glTF extension-honesty pass

Attack: treat a name in `supportedGltfExtensions` as proof of every placement,
field, required behavior, and quality strategy.

Resolution: support profiles must state syntax, validation, lowering, runtime,
fallback, required behavior, and oracle. `MSFT_lod` format semantics are broad;
lowest-LOD-first loading is a missing optional optimization. Static
`KHR_node_visibility` is the only strong new compatibility candidate, but is
lower priority than deferred animation.

### 14. GS SVG proposal pass

Attack: unaware-consumer failure, conflicting core/extension source authority,
MIME ambiguity, nested-resource execution, invalid intrinsic size, raster/SVG
orientation drift, VT coupling, and required-extension fallback contradiction.

Resolution: texture-level `{ source }` mirrors established image-format
extensions; optional core fallback and required failure are distinct; buffer
views require MIME; content is self-contained; viewport is finite; VT is a
post-ingestion representation; unknown optional extension properties remain
forward compatible. Data-texture color portability remains open.

### 15. React DX and identity pass

Attack: hidden reconciler, frame-rate React updates, callbacks in scene data,
`data-*` as renderer state, object-reference identity, and handlers that force
scene recompilation.

Resolution: ordinary React tree, pure coarse descriptors, versioned imperative
channels, separate picking handler map, stable logical IDs, and lower-level root
escape hatch. Creation options alone recreate Canvas roots.

### 16. Visible/picking equivalence pass

Attack: bounding boxes as exact hits, compacted instance indices, separate proxy
lifecycle, alpha-mask disagreement, or LOD changing identity.

Resolution: canonical transforms/geometry/instances and optional exact proxy
share one query. Alpha-mask factor, UV transform, wrap/filter and cutoff now use
retained demanded alpha in that query; minified GPU mip equivalence still needs
an explicit ray-footprint contract. Transparent per-texel alpha is an explicit
limitation.

### 17. Multi-view and XR pass

Attack: left-eye-only LOD/VT demand, ordinary and XR RAFs racing, runtime-owned
framebuffer deletion, background-session corruption, and cleanup after rejected
session end.

Resolution: one external-clock token, ordered multi-view frame transaction,
max coverage across views, separate capability/session state, suspended live
session semantics, and terminal cleanup. Multiview remains an optional executor
acceleration only.

### 18. Target-device capability pass

Attack: accidentally require an optional desktop extension or “fix” FPS through
resolution/example branches.

Resolution: Safari 17/A10 and Quest 2 are explicit floors. Optional capabilities
select sticky internal revisions with identical semantic fallback. Physical
resolution, refresh, browser, thermal, and camera conditions are recorded.

### 19. Bundle and lazy-boundary pass

Attack: optional codecs, XR, VT, SVG paging, IBL transport, or workers execute at
ordinary import/root creation.

Resolution: side-effect-free modules, dedicated XR entrypoint, demand-selected
lazy features, and bundle checks. Additional source splitting is accepted only
when reachable-byte and coupling wins exceed chunk overhead.

### 20. Testability and fuzzing pass

Attack: test implementation shape instead of behavior, duplicate large fixture
suites, let fuzzers lack assertions, or let physical visual tests have no oracle.

Resolution: pure transition/planner/reference models invite property and
differential tests; lifecycle/GL shells use focused contract tests; malformed
format families belong in fuzz/property boundaries; Khronos assets and physical
devices prove visual/capability behavior. Tests should be cleaned with the same
functional-core and iteration-speed discipline as source.

### 21. Clean-reimplementation pass

Attack: refactor legacy owners behind new names, keep two renderers, copy whole
subsystems, let old screenshots define correctness, defer performance until
parity, or keep old modules as an automatic fallback.

Resolution: implement the specs on an isolated branch/worktree using coherent
vertical slices and no legacy runtime dependency. Existing behavior is the
lowest evidence authority. Only reviewed leaf algorithms may be transplanted
into destination-first interfaces. Each slice must pass consumer, lifecycle,
browser, resource, and conformance gates before breadth continues.

### 22. Pattern and write-discipline pass

Attack: pattern soup, a universal state-machine framework, false decoupling,
eager feature registries, a god imperative root, mirrored derived state,
unconditional assignments/invalidations, or immutable allocation used merely
to avoid local mutation.

Resolution: select the smallest pattern from domain properties. Use closed
domain reducers only for real temporal lifecycles, one writer per mutable
domain, transactional publication only for coherence, revisioned derived data,
single-owner caller storage in hot paths, import-time-pure optional modules, and
measured tree-shaking. Count total writes, allocations, invalidations, uploads,
ownership, and clarity—not assignment tokens.

## Current conformance ledger

| Area | Status | Evidence and next architectural action |
| --- | --- | --- |
| Readonly validated descriptors | conforms | Renderer-core constructors copy normalized tuple/array inputs, expose TypeScript `readonly` contracts, reject unknown fields, and avoid runtime freezing. |
| React ordinary-tree ownership | conforms | `Canvas` owns one root and controls/hooks remain normal React children; cleanup and public API tests exist. |
| Demand rendering and clock ownership | conforms | Root invalidation, frame loop, external-clock and XR runtime owners have focused tests. |
| Context generation/lifecycle | conforms | Lifecycle owners, restoration integration, captured failures, and resource lifetime tests exercise loss/restore/disposal. |
| Retained scene/packet path | partial | Canonical retained tables/workspaces exist, but some commit/topology construction still allocates arrays/maps and string identities. Profile before changing readable cold work. |
| Functional-core boundaries | partial | Many pure modules and property tests exist (`lod`, frame packets, resource governor, VT demand/model, picking math, XR transitions); root and surface orchestration still contain semantic decisions worth extracting. |
| Minimal single-owner GL state | conforms | Clear and draw intents enter pure retained transition cores; the root-local owner suppresses identical framebuffer, viewport, fixed-pipeline, mask, program, sampler/texture and VAO writes across draws/frames. Resource preparation invalidates only the state domains it borrows; external work invalidates the complete shadow. |
| Texture image/sampler separation | conforms | Ordinary decoded storage is keyed independently of canonical sampler identity. Root-owned WebGL sampler objects are shared by sampler key and paired with shared image storage without duplicate uploads. |
| Canonical texture upload plan | partial | Ordinary images and ordinary/VT offline ETC2 share one validated KTX2 block parser and WebGL format authority; ordinary upload uses one decoded-source union and exact compressed budgeting. VT still has a purpose-specific paged upload contract, so storage-class normalization is not yet one universal boundary. glTF Basis and Meshopt remain honest non-claims rather than hidden transcoder branches. |
| Source formats absent from draw path | conforms | Prepared texture/material/geometry data and binding plans prevent PNG/SVG/KTX/glTF source parsing in the executor. |
| glTF required-extension honesty | partial | An executable ledger now rejects unknown/duplicate names, unavailable Draco, imaginary AVIF, unsupported quantization, and known names used outside implemented object placements. Official clearcoat, iridescence, and transformed-clearcoat fixtures now prove required failure while optional clearcoat proves valid core fallback; the lab cannot label unsupported visible semantics as supported. Remaining accepted profiles still need official per-extension conformance oracles before this becomes fully conformant. |
| Core glTF vertex colors | conforms | Float and normalized unsigned byte/short VEC3/VEC4 `COLOR_0` lower to canonical RGBA, share ordinary/instanced GPU geometry, multiply base color before alpha, and participate in exact alpha-mask picking. Official BoxVertexColors and VertexColorTest fixtures plus normalization/failure properties are the oracles. |
| Core glTF accessor/topology normalization | conforms | Sparse accessors overlay a validated base or the specified implicit-zero base during preparation; ordinary packed accessors retain their zero-copy path. Triangle strips and fans lower through one pure winding-preserving function to the renderer's triangle-list ABI. Lines and points remain explicit non-claims. |
| `MSFT_lod` semantics | conforms | Node/material chains, variants, thresholds, terminal cull, hysteresis, stereo selection and readiness fallback are tested. Lowest-first geometry publication is only a deferred load optimization. |
| `KHR_node_visibility` | deferred | Ratified but intentionally not in the allowlist. Static lowering is the only strong new extension candidate, below animation priority. |
| Basic glTF transform animation | deferred | No runtime/public API. The spec reserves pure sampling, explicit controller and canonical transform revisions; skins/morphs remain separate. |
| GS SVG extension | proposal | Behavior/security/fallback spec exists; prefix/schema/sample/implementation work is absent by design. Plain Royal SVG ingestion remains the current path. |
| Progressive glTF image lifecycle | conforms | Loading/streaming/ready/degraded states and per-image demand/publication are implemented and tested. |
| Neutral texture fallbacks | partial | Stable neutral/error texture contracts exist; ongoing visual oracles must ensure every material slot and VT transition avoids white/debug flashes. |
| VT demand/publication lifecycle | conforms | Pure demand/model/orchestration, transactional GPU arena, scheduling/admission/property tests and close-view stress cases provide broad evidence. Physical Safari/Quest quality remains ongoing. |
| Exact picking geometry path | conforms | Mesh/glTF/instance proxies enter the same CPU geometry/query and do not allocate GPU resources. Actual glTF geometry now carries LOD, alpha-mask and double-sided raster intent into that query. |
| Alpha-mask pick equivalence | partial | CPU picking evaluates factor, selected/transformed UVs, wrap, base-level nearest/bilinear alpha and cutoff through bounded demand retained only for mask claims. Missing pixels mirror the opaque neutral fallback and proxies remain authoritative. Minified mip selection remains deliberately approximate until rays carry a footprint. |
| Transparent per-texel picking | partial | Triangle-surface behavior is now explicitly documented; no false promise of per-texel blended alpha. |
| Optional WebGL capabilities | partial | Parallel shader compile, HDR color-buffer, native texture compression and compatible opaque multi-draw are selected outside draws. Harness-only timer queries remain opt-in diagnostics; anisotropy and multiview remain measurement-gated and absent. |
| Resource admission/accounting | conforms | Root governor, typed leases, capacity wake, quarantine debt, VT/texture/target/geometry tests cover physical domains. Audit subsystem projections for overlap whenever new diagnostics are added. |
| Async preparation admission | partial | One root-owned abort-safe FIFO now bounds glTF asset pipelines, ordinary texture decode, VT transport/decode and prefiltered environments with public diagnostics. Visibility priority and transient-byte-weighted admission remain later refinements. |
| Per-frame upload admission | partial | One root-owned byte governor now defers ordinary-texture transfer consistently across canvas and XR frames without changing asset readiness or persistent-budget failure. Geometry, VT and render-target traffic still need to join or explicitly justify separate bounded domains. |
| Hot-path GC discipline | partial | Many retained typed workspaces and high-water capacities exist; targeted allocations remain in LOD identity, VT admission/demand, binding readiness and snapshot paths. Trace first and preserve clarity. |
| Lazy/tree-shaken optional code | partial | XR has a separate entrypoint and several features/codecs are lazy. Bundle checks exist; continue attributing initial/reachable gzip before adding splits. |
| Safari 17/A10 and Quest 2 physical behavior | partial | Browser/Quest harnesses and telemetry exist, but no static spec can prove sustained 60/90/120 Hz or all visual oracles. Continue controlled physical runs. |

## Accepted architecture work order

Implementation follows the [clean implementation strategy](implementation-strategy.md):
consumer contract, root/frame/state spine, one canonical visible/pickable
surface, progressive asset/resources, ordinary textures/PBR,
instances/LOD/variants, XR, VT, then static fidelity breadth and optimization.
Existing source is not incrementally converted into these boundaries.

Within those slices, the first architecture proof remains one functional WebGL
state-transition core and imperative owner. Sampler objects and physical texture
storage choices remain measurement decisions after the canonical texture
contract exists. Optional glTF features and animation stay below the accepted
static feature profile.

Until replacement execution begins, the ledger above describes the current
renderer only. The replacement branch MUST add a distinct replacement status
and evidence column rather than overwrite or ambiguously reuse legacy evidence.
Strategy and review-policy acceptance are not recorded as implementation
`conforms` rows.

## Exit criteria for a future review

A review round is complete when it identifies the exact invariant, points to
code/tests or records the absence, revises contradictory specs, and classifies
the result as conforming, a concrete gap, deferred, or rejected. “Looks clean”
is not an exit criterion.
