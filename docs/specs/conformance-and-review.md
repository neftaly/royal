# Conformance and adversarial review

Last review: 2026-07-21

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
| React ordinary-tree ownership | conforms | `Canvas` owns one root and controls/hooks remain normal React children; cleanup and public API tests exist. React and imperative hosts share the self-documenting `pixelRatio` policy, invalid explicit ratios fail at the React boundary, and capability clamping remains distinct as `renderScale`. The packed-consumer fixture compiles the primary React composition, focused parent/child observation, glTF variants, instances, custom picking geometry, XR and the imperative escape hatch while rejecting scene-only and internal browser-port types from runtime entrypoints. |
| Demand rendering and clock ownership | conforms | Root invalidation, frame loop, external-clock and XR runtime owners have focused tests. |
| Context generation/lifecycle | conforms | Lifecycle owners, restoration integration, captured failures, and resource lifetime tests exercise loss/restore/disposal. |
| Retained scene/packet path | partial | Canonical retained tables/workspaces exist. Stable fixed state, program, bindings and VAO now compile into one draw packet shared by ordinary and multi-draw submission; framebuffer/viewport remain a per-view frame packet. Some commit/topology construction still allocates arrays/maps and string identities. Profile before changing readable cold work. |
| Functional-core boundaries | partial | Many deterministic modules and property tests exist (`lod`, frame packets, resource governor, VT demand/model, picking math, XR transitions). Availability-aware LOD selection owns coverage and fallback in one GL-free core, while the pure composite plan owns reachable transmission mip extent and exact target bytes; imperative owners supply resources and submit those choices. Canonical directional/point/spot lights and base/emissive/F0/specular/transmission/attenuation material values now lower through deterministic allocation-free vec4 packers into caller-owned typed storage. Conditional entrypoints preserve the thin ordinary-material path, leaving the WebGL owner responsible for retained lifetime, feature-aware invocation, and uniform submission. Root and other surface orchestration still contain semantic decisions worth extracting when a concrete invariant can be tested. |
| Minimal single-owner GL state | conforms | Clear and draw intents enter pure retained transition cores; the root-local owner suppresses identical framebuffer, viewport, fixed-pipeline, mask, program, sampler/texture and VAO writes across draws/frames. Texture validity is tracked per unit so an untextured draw cannot revalidate a unit dirtied by an upload, while owned uploads/copies invalidate only the exact units they borrowed. Resource preparation invalidates only the state domains it borrows; external work invalidates the complete shadow. Canonical identity texture coordinates and identity environment rotation omit their corresponding uniforms and shader operations before program creation. |
| Texture image/sampler separation | conforms | Ordinary decoded storage is keyed independently of canonical sampler identity. Root-owned WebGL sampler objects are shared by sampler key and paired with shared image storage without duplicate uploads. |
| Canonical texture upload plan | partial | Ordinary images and ordinary/VT offline ETC2 share one validated KTX2 block parser and WebGL format authority; ordinary upload uses one decoded-source union and exact compressed budgeting. VT still has a purpose-specific paged upload contract, so storage-class normalization is not yet one universal boundary. glTF Basis and Meshopt remain honest non-claims rather than hidden transcoder branches. |
| Source formats absent from draw path | conforms | Prepared texture/material/geometry data and binding plans prevent PNG/SVG/KTX/glTF source parsing in the executor. |
| glTF required-extension honesty | conforms | Cold preflight validates the executable declaration graph before codec work: used and required names are unique, required names are used, executable payloads are declared, and required placements match the implementation ledger. Unsupported optional payloads are opaque fallback branches; supported payloads remain recursive. It rejects unknown required names, unavailable Draco, imaginary AVIF, unsupported quantization, and known names outside implemented placements. Official Khronos assets bind punctual lights, GPU instancing, unlit, emissive strength, IOR, specular, transmission and volume lowering; clearcoat and iridescence fixtures prove required failure, while optional clearcoat proves core fallback without discarding executable core transforms. The unchanged external Duck Draco variant proves worker preparation, lazy decoding, external-buffer resolution, texture loading, smooth-normal equivalence with the ordinary asset, and a matching exact-build browser visual. Authored-normal shader selection is explicit, so small legal node scales cannot accidentally switch to derivative face normals. The pinned external Sunglasses WebP+Draco variant proves required WebP selection, worker preparation and progressive texture publication while retaining optional iridescence as an honest core fallback; its exact-build hardware-browser run reached `ready` with 16/16 nodes, 8/8 primitives, 1/1 image loaded and no failures. `TextureTransformMultiTest` supplies the official base-color, emissive, normal, metallic-roughness and occlusion oracle, and one canonical affine-lowering matrix covers those plus specular, specular-color, transmission and thickness placements through the same path; exact-build hardware smoke and physical Safari 17.14 both pass the official transform asset. Exact-build browser interaction smoke covers material variants and LOD selection. |
| Core glTF vertex colors | conforms | Float and normalized unsigned byte/short VEC3/VEC4 `COLOR_0` lower to canonical RGBA, share ordinary/instanced GPU geometry, multiply base color before alpha, and participate in exact alpha-mask picking. Official BoxVertexColors and VertexColorTest fixtures plus normalization/failure properties are the oracles. |
| Core glTF derivative normal mapping | conforms | Normal-mapped primitives without authored tangents derive one scale-invariant cotangent frame from world-position and transformed-UV derivatives. The frame accounts for glTF's upper-left image V direction and OpenGL normal-map Y convention; the official NormalTangentTest now matches each real-geometry cell from the front instead of the flipped-Y failure oracle. |
| Core glTF alpha presentation | conforms | Opaque and surviving mask fragments write framebuffer alpha one even when factors, textures or vertex colors carry lower alpha; only blend variants preserve surface alpha. The mode is a compile-time fragment feature shared by lit/unlit and direct/composite paths. Khronos SpecularTest also compiles and renders through the current hardware-browser path after this split. |
| Core glTF accessor/topology normalization | conforms | Sparse accessors overlay a validated base or the specified implicit-zero base during preparation; ordinary packed accessors retain their zero-copy path. Float and normalized integer UVs share canonical floats, and vertex attributes enforce glTF's four-byte element alignment. Triangle strips and fans lower through one pure winding-preserving function to the renderer's triangle-list ABI. Lines and points remain explicit non-claims. |
| Core glTF buffer ownership | conforms | Single-buffer GLB and JSON glTF retain zero-copy source views. Multi-buffer JSON and hybrid GLB assets load through the injected resource port in parallel, validate each source independently, then pack once and rewrite buffer-view offsets into the same single-binary preparation ABI. Worker requests carry correlation IDs rather than imposing a global one-read bottleneck. |
| `MSFT_lod` semantics | conforms | Node/material chains, variants, thresholds, terminal cull, hysteresis, stereo selection and readiness fallback are tested. Lowest-first geometry publication is only a deferred load optimization. |
| `KHR_node_visibility` | deferred | Ratified but intentionally not in the allowlist. Static lowering is the only strong new extension candidate, below animation priority. |
| Basic glTF transform animation | deferred | No runtime/public API. The spec reserves pure sampling, explicit controller and canonical transform revisions; skins/morphs remain separate. |
| GS SVG extension | proposal | Behavior/security/fallback spec exists; prefix/schema/sample/implementation work is absent by design. Plain Royal SVG ingestion remains the current path. |
| Progressive glTF image lifecycle | conforms | Loading/streaming/ready/degraded states and per-image demand/publication are implemented and tested. Resource-only commits release decoded handoff storage without presenting, and maps hidden behind a coherent group upload avoid rebuilding an unchanged retained draw packet. Publication compares GPU binding identity as well as shader features, so a compatible packet cannot retain a replaced texture handle. Persistent GPU denial settles and releases the representation, rebuilds scene-wide texture claims, and remains a renderer resource diagnostic instead of falsely degrading a successfully decoded glTF image. |
| Final-fidelity browser evidence | conforms | Browser captures wait for glTF preparation, requested image outcomes and deferred GPU admission to settle instead of treating progressive `streaming` presentation as final fidelity. Two clean exact-build Sponza captures produced the same SHA-256 (`e04da8f277943a2179025d969245539caef6cc52dd8053f38a4ad6319c26fbdd`); progressive presentation remains allowed and is evaluated separately. |
| Neutral texture fallbacks | partial | Canonical material factors remain authored truth, while one pure presentation planner applies the same tint-preserving 50%-sRGB fallback to missing ordinary and virtual base-color representations. The coherent-map core consumes a compact residency mask rather than WebGL bindings: paced lighting and transmission groups remain atomic while pending, then successful maps publish after failed sibling slots settle to semantic-neutral omission. A lifecycle matrix proves factors remain unchanged and failed normal, occlusion, specular, specular-color and thickness slots cannot suppress ready base-color, emissive, metallic-roughness or transmission slots. Failed glTF images retain renderable geometry with the authored-tint fallback. Ongoing visual oracles must still ensure every material slot and VT transition avoids white/debug flashes before this becomes fully conformant. |
| VT demand/publication lifecycle | conforms | Pure demand/model/orchestration, transactional GPU arena, scheduling/admission/property tests and close-view stress cases provide broad evidence. Every resource's retained demand is resolved before shared-atlas admission, so protection and replacement are independent of resource insertion order. Bounded allocation-free perspective subdivision localizes fine demand across large two-triangle ground planes and shares the exact clipped near-plane path. A current desktop ground close-view run reached distance 0.1, grew residency from 3 to 11 pages through 24 page uploads, and measured 0.3 ms renderer CPU / 0.86 ms GPU p95 while dragging. Physical Safari 17.14 at DPR 2 retained 10 pages with zero pending/failures and delivered 24/24 motion frames at 17 ms p95; physical Quest ground quality remains ongoing. |
| Exact picking geometry path | conforms | Mesh/glTF/instance proxies enter the same CPU geometry/query and do not allocate GPU resources. Actual glTF geometry now carries LOD, alpha-mask and double-sided raster intent into that query. |
| Alpha-mask pick equivalence | partial | CPU picking evaluates factor, selected/transformed UVs, wrap, base-level nearest/bilinear alpha and cutoff through bounded demand retained only for mask claims. Missing pixels mirror the opaque neutral fallback and proxies remain authoritative. Minified mip selection remains deliberately approximate until rays carry a footprint. |
| Transparent per-texel picking | partial | Triangle-surface behavior is now explicitly documented; no false promise of per-texel blended alpha. |
| Optional WebGL capabilities | partial | HDR color-buffer, native texture compression, and exact-compatible multi-draw are selected outside draws. Opaque runs use retained plans; transmission and alpha runs are scanned only after depth sorting and retain the resulting order. Successful shader setup performs one link-status synchronization instead of polling every stage. Parallel shader compile was measured and rejected because background publication delayed usable presentation; harness-only timer queries remain opt-in diagnostics, while anisotropy and multiview remain measurement-gated and absent. |
| Resource admission/accounting | conforms | Root governor, typed leases, capacity wake, quarantine debt, VT/texture/target/geometry tests cover physical domains. Geometry arenas are byte-chunked and claimed lazily with their first admitted surface rather than reserved for the complete scene. Transmission targets admit only the scene-color mip prefix reachable by visible authored roughness; the Bistro viewport retained 144,192 fewer GPU bytes without changing its draw/copy path. Bounded image dimension readers let ordinary browser decode target the already-admitted fitted size. Audit subsystem projections for overlap whenever new diagnostics are added. |
| Async preparation admission | conforms | One root-owned abort-safe authority bounds glTF asset pipelines, ordinary texture decode, VT transport/decode and prefiltered environments. A pure bounded-fair selector admits newly claimed scene/environment/visible-VT work ahead of an existing detail backlog while forcing one detail start after at most four foreground starts. FIFO order remains stable within each lane, active work is not preempted, queued cancellation cannot retain dead head entries, and public diagnostics expose both lane counts plus their total. Cross-domain transient-byte weighting is deliberately rejected: browser decode/worker scratch is not accurately knowable up front, while texture handoff, codec, VT, environment, persistent GPU and upload domains already own enforceable bounds. |
| Per-frame upload admission | conforms | Separate root-local byte governors defer ordinary-texture, canonical geometry/instance, and VT page/page-table transfers consistently across canvas and XR frames. Each progressive domain allows one oversize first transaction to prevent starvation; texture-only commits cannot consume geometry allowance. Intermediate geometry and texture batches commit without redrawing an unchanged scene, while first-usable, terminal, camera, scene and application presentations remain urgent. On the current Bistro web tier this cut startup draws from 3,185 to 1,110 and load-frame GPU p95 from 13.4 ms to 7.36 ms without changing the 110/110 terminal texture outcome. The atomic environment profile has a hard 2,097,144-byte format ceiling. Render targets and GPU-to-GPU scene-color copies are capacity/bandwidth domains rather than client-source transfer. |
| Hot-path GC discipline | partial | Many retained typed workspaces and high-water capacities exist. Root/frame and focused asset observers share one mutation-safe retained listener owner; publication no longer allocates listener snapshot arrays. Canonical indices are validated before the GL shell and use one allocation-free rebasing pass during upload. The glTF sampler reader normalizes its closed numeric enum without constructing a lookup `Map` per texture. Retained transmission visibility is dense over actual candidates and eyes rather than sparse over every scene surface, while cold binary search avoids a candidate lookup table. Light and material uniform lowering reuse owner-retained vec4 storage and create no per-material arrays or option objects. A 90-frame Sponza trace measured ~0.2 ms renderer callback p95 and no GC pause signal, so broader readable hot code remains intact; targeted allocations remain in LOD identity, VT admission/demand, binding readiness and public snapshot paths. |
| Architecture fitness and TypeScript emission | conforms | A source-graph test rejects emitted-JavaScript import cycles, browser/framework authority in renderer-core, XR/VT/browser-preparation implementations entering the main static renderer graph, and enums, namespaces or decorators that would add TypeScript runtime helpers. Type-only edges are deliberately excluded from the runtime cycle graph. |
| Lazy/tree-shaken optional code | partial | XR has a separate entrypoint and several features/codecs are lazy. Bundle checks and the static architecture-fitness graph protect current boundaries; continue attributing initial/reachable gzip before adding splits. The measured pure glTF authoring fixture is now a separate budget: it adds about 1.1 kB gzip over the Royal React initial path without pulling codecs or workers into that path. Explicit authored-normal shader selection consumes about 170 deployed gzip bytes and raises its affected rounded ceilings by 100–200 bytes. The lit/unlit alpha correction consumed 68 deployed gzip bytes and raised its three affected ceilings by 100 bytes. Exact public glTF metadata added 37 bytes and raised only the total ceiling by 50; reachable transmission mip planning added 68 bytes and raised only that ceiling by a further 100. Ordered transparent batching plus thin/volume shader specialization consumed about 90 deployed gzip bytes across two measured slices and raised the total ceiling by 100. Resource-only geometry publication adds 103 deployed gzip bytes for the measured 65% Bistro startup-draw reduction; its affected ceilings rose by 10–140 rounded bytes. Bounded-fair foreground/detail preparation costs about 0.2–0.3 kB gzip in the always-reachable root and raises its four affected ceilings by 200 bytes; it adds no worker or lazy-chunk payload. |
| Safari 17/A10 and Quest 2 physical behavior | partial | Browser/Quest harnesses and telemetry exist. Examples embed a full revision, dirty flag, build timestamp and unique build ID in both a no-store server endpoint and every in-page report; the iPad harness rejects stale/mismatched builds and terminates boundedly after inspector failure. Current physical Safari 17.14 evidence covers close ground-plane VT at DPR 2 and the external Draco worker/texture lifecycle; the latter reached ready with zero image failures and completed 24/24 idle samples at 18 ms p95. Quest still needs a fresh controlled run, and no static spec can prove sustained 60/90/120 Hz or all visual oracles. |

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
