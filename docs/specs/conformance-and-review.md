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
| Readonly validated descriptors | conforms | Renderer-core constructors copy normalized tuple/array inputs and materialize independent tuple defaults, expose TypeScript `readonly` contracts, reject every unknown own key (including symbols and non-enumerable keys), and avoid runtime freezing. React identity options, direct geometry validation, renderer options and XR options enforce the same own-key rule at their public boundaries. |
| React ordinary-tree ownership | conforms | `Canvas` owns one root and controls/hooks remain normal React children; cleanup and public API tests exist. React and imperative hosts share the self-documenting `pixelRatio` policy, invalid explicit ratios fail at the React boundary, and capability clamping remains distinct as `renderScale`. The packed-consumer fixture compiles the primary React composition, focused parent/child observation, glTF variants, instances, custom picking geometry, XR and the imperative escape hatch while rejecting scene-only and internal browser-port types from runtime entrypoints. |
| Open-source package shape | conforms | The repository and every publishable package ship the same canonical AGPL-3.0-only text, manifests declare that identifier and public access, and the packed-consumer check rejects a missing license or unexpected package-root file. The monorepo root and non-package applications remain `private` only as an npm publication guard; documentation describes the `0.0.1` release honestly as an open-source prerelease. |
| Demand rendering and clock ownership | conforms | Root invalidation, frame loop, external-clock and XR runtime owners have focused tests. At clean commit `46e6c9e2`, the schema-checked 120 Hz synthetic stereo oracle completed all 120 requested session-RAF samples with 8.8 ms frame p95, 0.60 ms renderer-callback p95 and 0.06 ms GPU p95. This proves host/stereo lifecycle and timing instrumentation only; it does not replace physical Quest evidence. |
| Context generation/lifecycle | conforms | Lifecycle owners, restoration integration, captured failures, and resource lifetime tests exercise loss/restore/disposal. |
| Retained scene/packet path | partial | Canonical retained tables/workspaces exist. Stable fixed state, program, bindings and VAO now compile into one draw packet shared by ordinary and multi-draw submission; framebuffer/viewport remain a per-view frame packet. Asset-local LOD groups lower to dense prepared IDs and then dense scene-local numeric occurrence IDs shared by visual and picking selection; array indexing builds their retained group table without compound mount strings. Geometry arena plans compare their retained structure directly instead of serializing a parallel identity graph, and instanced VAOs use a collision-free length-framed geometry/cohort key without temporary tuple serialization. Some other commit/topology construction still allocates readable cold arrays/maps; profile it before adding retained machinery. |
| Functional-core boundaries | partial | Many deterministic modules and property tests exist (`lod`, frame packets, resource governor, VT demand/model, picking math, XR transitions). Availability-aware LOD selection owns coverage and fallback in one GL-free core. A caller-retained composite-frame planner now owns dense stereo transmission visibility, maximum visible roughness, target extent and terminal-presentation demand, including the device-measured complex-opaque crossover, while the pure composite allocation plan owns reachable mip extent and exact target bytes; imperative owners supply resources and submit those choices. Canonical directional/point/spot lights, material factors, environment settings, presentation policy, the fixed texture-unit ABI, and lazy VT activation lower through deterministic cores; the root owns only the corresponding import/lifecycle effects. Conditional entrypoints preserve thin ordinary paths, leaving the WebGL owner responsible for retained lifetime, feature-aware invocation, and uniform/binding submission. Root and other surface orchestration still contain semantic decisions worth extracting when a concrete invariant can be tested. |
| Minimal single-owner GL state | conforms | Clear and draw intents enter pure retained transition cores; the root-local owner suppresses identical framebuffer, viewport, fixed-pipeline, mask, program, sampler/texture and VAO writes across draws/frames. Texture validity is tracked per unit so an untextured draw cannot revalidate a unit dirtied by an upload, while owned uploads/copies invalidate only the exact units they borrowed. Resource preparation invalidates only the state domains it borrows; external work invalidates the complete shadow. Canonical identity texture coordinates and identity environment rotation omit their corresponding uniforms and shader operations before program creation. |
| Texture image/sampler separation | conforms | Ordinary decoded storage is keyed independently of canonical sampler identity. Root-owned WebGL sampler objects are shared by sampler key and paired with shared image storage without duplicate uploads. |
| Canonical texture upload plan | conforms | Ordinary images lower to one decoded-source union with exact compressed/uncompressed budgeting. Ordinary and VT offline ETC2 share one validated KTX2 block parser, block-storage vocabulary, color-space rule and WebGL-format selector. The root enables `WEBGL_compressed_texture_etc` once per context generation and passes a Boolean into cold/worker preparation; direct and authored-VT compressed sources reject before invalid upload when absent. Experimental `GS_texture_etc2` adds only a cold, identity-bearing source marker for explicit glTF selection, then uses that same ordinary decode, budget, sampler, material, draw and picking path. Capability-aware ETC2/WebP/core preference fetches only one representation. VT pages deliberately retain a narrower independently scheduled transport record: a page is not a complete texture/mip chain, and forcing page identity/residency into the ordinary union would couple lifecycles without simplifying binding or drawing. glTF Basis and Meshopt remain honest non-claims rather than hidden transcoder branches. |
| Source formats absent from draw path | conforms | Prepared texture/material/geometry data and binding plans prevent PNG/SVG/KTX/glTF source parsing in the executor. |
| glTF required-extension honesty | conforms | Cold preflight validates the executable declaration graph before codec work: used and required names are unique, required names are used, executable payloads are declared, and required placements match the implementation ledger. Unsupported optional payloads are opaque fallback branches; supported payloads remain recursive. It rejects unknown required names, unavailable Draco, imaginary AVIF, unsupported quantization, and known names outside implemented placements. Experimental `GS_texture_etc2` is named as a vendor non-claim, validates texture placement and image MIME, selects ETC2 only after the WebGL capability is enabled, rejects unavailable required use, and otherwise chooses WebP/core without fetching alternates. The Royal optional-fallback lab oracle is magenta through PNG on a desktop NVIDIA context without ETC2 and retains exactly 16 compressed bytes as red ETC2 on physical Safari 17.14 with the extension. Official Khronos assets bind punctual lights, GPU instancing, unlit, emissive strength, IOR, specular, transmission and volume lowering; clearcoat and iridescence fixtures prove required failure, while optional clearcoat proves core fallback without discarding executable core transforms. The unchanged external Duck Draco variant proves worker preparation, lazy decoding, external-buffer resolution, texture loading, smooth-normal equivalence with the ordinary asset, and a matching exact-build browser visual. Authored-normal shader selection is explicit, so small legal node scales cannot accidentally switch to derivative face normals. The pinned external Sunglasses WebP+Draco variant proves required WebP selection, worker preparation and progressive texture publication while retaining optional iridescence as an honest core fallback; its exact-build hardware-browser run reached `ready` with 16/16 nodes, 8/8 primitives, 1/1 image loaded and no failures. `TextureTransformMultiTest` supplies the official base-color, emissive, normal, metallic-roughness and occlusion oracle, and one canonical affine-lowering matrix covers those plus specular, specular-color, transmission and thickness placements through the same path; exact-build hardware smoke and physical Safari 17.14 both pass the official transform asset. Exact-build browser interaction smoke covers material variants and LOD selection. |
| Core glTF vertex colors | conforms | Float and normalized unsigned byte/short VEC3/VEC4 `COLOR_0` lower to canonical RGBA, share ordinary/instanced GPU geometry, multiply base color before alpha, and participate in exact alpha-mask picking. Official BoxVertexColors and VertexColorTest fixtures plus normalization/failure properties are the oracles. |
| Core glTF derivative normal mapping | conforms | Normal-mapped primitives without authored tangents derive one scale-invariant cotangent frame from world-position and transformed-UV derivatives. The frame accounts for glTF's upper-left image V direction and OpenGL normal-map Y convention; the official NormalTangentTest now matches each real-geometry cell from the front instead of the flipped-Y failure oracle. |
| Core glTF alpha presentation | conforms | Opaque and surviving mask fragments write framebuffer alpha one even when factors, textures or vertex colors carry lower alpha; only blend variants preserve surface alpha. The mode is a compile-time fragment feature shared by lit/unlit and direct/composite paths. Khronos SpecularTest also compiles and renders through the current hardware-browser path after this split. |
| Core glTF accessor/topology normalization | conforms | Sparse accessors overlay a validated base or the specified implicit-zero base during preparation; ordinary packed accessors retain their zero-copy path. Float and normalized integer UVs share canonical floats, and vertex attributes enforce glTF's four-byte element alignment. Triangle strips and fans lower through one pure winding-preserving function to the renderer's triangle-list ABI. Lines and points remain explicit non-claims. |
| Core glTF buffer ownership | conforms | Single-buffer GLB and JSON glTF retain zero-copy source views. Multi-buffer JSON and hybrid GLB assets load through the injected resource port in parallel, validate each source independently, then pack once and rewrite buffer-view offsets into the same single-binary preparation ABI. Worker requests carry correlation IDs rather than imposing a global one-read bottleneck. |
| `MSFT_lod` semantics | conforms | Node/material chains, variants, thresholds, terminal cull, hysteresis, stereo selection and readiness fallback are tested. Repeated mounts of one prepared asset lower to independent dense numeric occurrence IDs and world bounds rather than coupling selection through an asset-global string. Lowest-first geometry publication is only a deferred load optimization. |
| `KHR_node_visibility` | deferred | Ratified but intentionally not in the allowlist. Static lowering is the only strong new extension candidate, below animation priority. |
| Basic glTF transform animation | deferred | No runtime/public API. The spec reserves pure sampling, explicit controller and canonical transform revisions; skins/morphs remain separate. |
| GS SVG extension | proposal | Behavior/security/fallback spec exists; prefix/schema/sample/implementation work is absent by design. Plain Royal SVG ingestion remains the current path. |
| Progressive glTF image lifecycle | conforms | Loading/streaming/ready/degraded states and per-image demand/publication are implemented and tested. Resource-only commits release decoded handoff storage without presenting, and maps hidden behind a coherent group upload avoid rebuilding an unchanged retained draw packet. Publication compares GPU binding identity as well as shader features, so a compatible packet cannot retain a replaced texture handle. Persistent GPU denial settles and releases the representation, rebuilds scene-wide texture claims, and remains a renderer resource diagnostic instead of falsely degrading a successfully decoded glTF image. |
| Final-fidelity browser evidence | conforms | Browser captures wait for glTF preparation, requested image outcomes and deferred GPU admission to settle instead of treating progressive `streaming` presentation as final fidelity. Two clean exact-build Sponza captures produced the same SHA-256 (`e04da8f277943a2179025d969245539caef6cc52dd8053f38a4ad6319c26fbdd`); progressive presentation remains allowed and is evaluated separately. |
| Neutral texture fallbacks | partial | Canonical material factors remain authored truth, while one pure presentation planner applies the same tint-preserving 50%-sRGB fallback to missing ordinary and virtual base-color representations. The coherent-map core consumes a compact residency mask rather than WebGL bindings: paced lighting and transmission groups remain atomic while pending, then successful maps publish after failed sibling slots settle to semantic-neutral omission. A lifecycle matrix proves factors remain unchanged and failed normal, occlusion, specular, specular-color and thickness slots cannot suppress ready base-color, emissive, metallic-roughness or transmission slots. Failed glTF images retain renderable geometry with the authored-tint fallback. Ongoing visual oracles must still ensure every material slot and VT transition avoids white/debug flashes before this becomes fully conformant. |
| VT demand/publication lifecycle | conforms | Pure demand/model/orchestration, transactional GPU arena, scheduling/admission/property tests and close-view stress cases provide broad evidence. Every resource's retained demand is resolved before shared-atlas admission, so protection and replacement are independent of resource insertion order. Shared-atlas slot selection is allocation-free, and replacement validation/upload precedes logical eviction so a rejected page cannot destroy the resident ancestor fallback. Bounded allocation-free perspective subdivision localizes fine demand across large two-triangle ground planes and shares the exact clipped near-plane path. A current desktop ground close-view run reached distance 0.1, grew residency from 3 to 11 pages through 24 page uploads, and measured 0.3 ms renderer CPU / 0.86 ms GPU p95 while dragging. At clean commit `525a2509`, physical Safari 17.14 at DPR 2 retained 10 pages with zero pending/failures and delivered 24/24 motion frames at 17 ms p95 (`2026-07-21T06-23-08-286Z-virtual-texture-stress.json`); physical Quest ground quality remains ongoing. |
| Exact picking geometry path | conforms | Mesh/glTF/instance proxies enter the same CPU geometry/query and do not allocate GPU resources. Actual glTF geometry now carries LOD, alpha-mask and double-sided raster intent into that query. |
| Alpha-mask pick equivalence | partial | CPU picking evaluates factor, selected/transformed UVs, wrap, base-level nearest/bilinear alpha and cutoff through bounded demand retained only for mask claims. Missing pixels mirror the opaque neutral fallback and proxies remain authoritative. Minified mip selection remains deliberately approximate until rays carry a footprint. |
| Transparent picking semantics | conforms | Blended materials deliberately use their triangle surface regardless of per-texel/factor alpha; only `MASK` materials attach the canonical alpha predicate. The canonical-lowering regression proves that an ordinary transparent surface retains neither mask texture data nor a mask sampler. Per-texel blended-alpha picking remains an explicit non-feature and is not required for replacement. |
| Optional WebGL capabilities | partial | HDR color-buffer, native texture compression, and exact-compatible multi-draw are selected outside draws. Opaque runs use retained plans; sufficiently large sets of coverage-independent standard draws may add one position-only, color-suppressed depth pass when multi-draw can amortize submission, while alpha mask/blend, transmission, lines, unlit work, and the no-extension fallback remain single-pass. Depth and color vertex programs declare the same clip position invariant: a physical Safari 17.14 counterexample showed severe self-occlusion when cross-program depth drift was left implementation-defined, while the restored pass with the invariant produced the same clean Sponza view as the no-prepass control. Transmission and alpha runs are scanned only after depth sorting and retain the resulting order. Successful shader setup performs one link-status synchronization instead of polling every stage; the shared compiler/linker shell owns diagnostics and shader cleanup for presentation, surface, and depth programs. Parallel shader compile was measured and rejected because background publication delayed usable presentation; harness-only timer queries remain opt-in diagnostics, while anisotropy and multiview remain measurement-gated and absent. |
| Resource admission/accounting | conforms | Root governor, typed leases, capacity wake, quarantine debt, VT/texture/target/geometry tests cover physical domains. Geometry arenas are byte-chunked and claimed lazily with their first admitted surface rather than reserved for the complete scene. Transmission targets admit only the scene-color mip prefix reachable by visible authored roughness; the Bistro viewport retained 144,192 fewer GPU bytes without changing its draw/copy path. Bounded image dimension readers let ordinary browser decode target the already-admitted fitted size. The public cold root snapshot reports exact resident ordinary-texture bytes plus the compressed byte/count subset, so source-encoding efficacy and budget pressure no longer have to be inferred from texture counts. Clean commit `dc8ab6c9` measures Sponza at 197,852,340 resident ordinary-texture bytes across 69 resources, 68 fitted and none GPU-compressed. The current normalized Bistro web tier likewise retains 171,422,400 uncompressed texture bytes across 110 demanded resources; physical Safari reaches 233,726,592 total persistent GPU bytes at its larger viewport. Root setup uses its validated option directly and VT atlas sizing reads the scalar available-capacity projection instead of allocating and feeding diagnostic snapshots back into control policy. Audit subsystem projections for overlap whenever new diagnostics are added. |
| Async preparation admission | conforms | One root-owned abort-safe authority bounds glTF asset pipelines, ordinary texture decode, VT transport/decode and prefiltered environments. A pure bounded-fair selector admits newly claimed scene/environment/visible-VT work ahead of an existing detail backlog while forcing one detail start after at most four foreground starts. FIFO order remains stable within each lane, active work is not preempted, queued cancellation cannot retain dead head entries, and public diagnostics expose both lane counts plus their total. Cross-domain transient-byte weighting is deliberately rejected: browser decode/worker scratch is not accurately knowable up front, while texture handoff, codec, VT, environment, persistent GPU and upload domains already own enforceable bounds. |
| Per-frame upload admission | conforms | Separate root-local byte governors defer ordinary-texture, canonical geometry/instance, and VT page/page-table transfers consistently across canvas and XR frames. Each progressive domain allows one oversize first transaction to prevent starvation; texture-only commits cannot consume geometry allowance. Intermediate geometry and texture batches commit without redrawing an unchanged scene, while first-usable, terminal, camera, scene and application presentations remain urgent. On the current Bistro web tier this cut startup draws from 3,185 to 1,110 and load-frame GPU p95 from 13.4 ms to 7.36 ms without changing the 110/110 terminal texture outcome. A later clean `d6dee369` run against the checksum-current fixture reached first usable in 494 ms, settled 110/110 images in 2.21 s and reached terminal readiness in 2.60 s on desktop; it does not replace the earlier controlled before/after comparison. The atomic environment profile has a hard 2,097,144-byte format ceiling. Render targets and GPU-to-GPU scene-color copies are capacity/bandwidth domains rather than client-source transfer. |
| Hot-path GC discipline | partial | Many retained typed workspaces and high-water capacities exist. Root/frame and focused asset observers share one mutation-safe retained listener owner; publication no longer allocates listener snapshot arrays. Canonical indices are validated before the GL shell and use one allocation-free rebasing pass during upload. Geometry arena preparation constructs each chunk entry once and avoids the former slice/map/JSON identity graph; semantically stable React XR option lists are retained without serializing on every render. The glTF sampler reader normalizes its closed numeric enum without constructing a lookup `Map` per texture. Retained transmission visibility is dense over actual candidates and eyes rather than sparse over every scene surface; its stereo classification, roughness demand and target extent reuse one per-root high-water workspace. Scene-local numeric LOD identities remove retained compound strings and let cold group indexing use dense arrays. Shared-atlas admission returns a retained-state slot integer rather than allocating a plan for each uploaded VT page. VT demand retains only a deduplication `Set` plus direct typed-array/count/overflow state; it does not store unused per-page indices or a wrapper record for one mutable bit. Fixed-unit texture composition writes into the draw packet's one retained binding array, so no-op texture publication neither allocates a discarded array nor retains a duplicate pointer. Light, material and scene-uniform lowering reuse owner-retained vec4 storage and create no per-material arrays or option objects. A 90-frame desktop Sponza trace measured ~0.2 ms renderer callback p95 and no GC pause signal. Exact commit `df631f9c` records 298 ms across 240 physical-Safari callbacks while 120 motion samples average 16.5 ms and reach 19 ms p95; the remaining tail is not evidence for a JS/GC rewrite. At exact commit `3514a897`, an uninstrumented 180-frame moving Virtual City profile measured 0.6 ms renderer-callback p95 and 6.96 ms GPU p95. Forced-GC controls retained about 111 KiB for that 198-submission scene versus 69 KiB for a one-draw cube; the 42 KiB difference was bounded across the complete run, while full GL-call interception raised callback p95 to 2.4 ms. This rejects both a frame-proportional leak diagnosis and allocation work inferred from instrumented overhead. Targeted allocations remain in VT demand and public snapshot paths. |
| Architecture fitness and TypeScript emission | conforms | A source-graph test rejects emitted-JavaScript import cycles, browser/framework authority in renderer-core, XR/VT/browser-preparation implementations entering the main static renderer graph, and enums, namespaces or decorators that would add TypeScript runtime helpers. Type-only edges are deliberately excluded from the runtime cycle graph. Root and package TypeScript configs include complete source directories rather than stale-prone filename manifests, so new ordinary, optional and example modules enter type/declaration checking automatically. |
| Lazy/tree-shaken optional code | partial | XR has a separate entrypoint; VT/SVG, environment transport, browser preparation and codecs are lazy. One pure VT activation decision distinguishes authored demand from opt-in automatic base-color demand and is reused by setup and stale-import guards; the root alone owns the dynamic import. Bundle checks and the static architecture-fitness graph protect current boundaries; continue attributing initial/reachable gzip before adding splits. The current audit rejected another split: glTF is baseline product behavior, picking must remain synchronous at the root API, and the remaining optional systems already sit behind dynamic imports or separate entrypoints. The measured pure glTF authoring fixture is now a separate budget: it adds about 1.1 kB gzip over the Royal React initial path without pulling codecs or workers into that path. Explicit authored-normal shader selection consumes about 170 deployed gzip bytes and raises its affected rounded ceilings by 100–200 bytes. The lit/unlit alpha correction consumed 68 deployed gzip bytes and raised its three affected ceilings by 100 bytes. Exact public glTF metadata added 37 bytes and raised only the total ceiling by 50; reachable transmission mip planning added 68 bytes and raised only that ceiling by a further 100. Ordered transparent batching plus thin/volume shader specialization consumed about 90 deployed gzip bytes across two measured slices and raised the total ceiling by 100. Resource-only geometry publication adds 103 deployed gzip bytes for the measured 65% Bistro startup-draw reduction; its affected ceilings rose by 10–140 rounded bytes. Bounded-fair foreground/detail preparation costs about 0.2–0.3 kB gzip in the always-reachable root and raises its four affected ceilings by 200 bytes; it adds no worker or lazy-chunk payload. Retained scene-uniform and composite-frame functional cores add about 0.3 kB gzip to the initial/deployed path; their four affected ceilings rose by 350 bytes, with no lazy or worker increase. Exact ordinary-texture byte/compression diagnostics add 27–44 gzip bytes across the three initial fixtures and raise only those rounded ceilings by 50 bytes; deployed, lazy and worker ceilings remain unchanged. |
| Safari 17/A10 and Quest 2 physical behavior | partial | Browser/Quest harnesses and telemetry exist. Examples embed a full revision, dirty flag, build timestamp and unique build ID in both a no-store server endpoint and every in-page report; the iPad harness rejects stale/mismatched builds and terminates boundedly after inspector failure. Current physical Safari 17.14 evidence covers close ground-plane VT at DPR 2 and the external Draco worker/texture lifecycle; the latter reached ready with zero image failures and completed 24/24 idle samples at 18 ms p95. Clean commit `525a2509` provides the exact-head VT proof and an earlier Sponza counterexample at 42 ms p95. Exact commit `df631f9c` then retains all 69 Sponza images without failures while its demand-loaded opaque depth pass brings full-DPR motion to a 16.5 ms average and 19 ms p95 over 120/120 samples, compared with the immediately preceding clean 30.3 / 38 ms path. After the complete pass shell moved behind that lazy boundary, exact commit `2d2eefee` remains consistent at 16.15 ms average / 20 ms p95 over 60/60 samples. Exact commit `1100f9b2` also exercises the opposite high-draw, compact-geometry case: Virtual City completes 60/60 full-DPR motion samples at 12.82 ms average / 14 ms p95 with no failures, so the retained pass is not merely trading the Sponza gain for a CPU-bound scene regression. Exact commit `ec7091b0` records the texture-heavy A Beautiful Game counterexample: first usable at 10.48 s, all 33 images settled at 14.64 s, 201.0 MB of uncompressed ordinary-texture storage and 249.6 MB total persistent GPU storage, with full-DPR motion at 27.03 ms average / 32 ms p95. Controlled dirty-build diagnostics rejected framebuffer blit, explicit mip-pyramid, no-mip, extension-off, and instance-count depth-admission changes as either insufficient or regressions; the remaining strong route is an offline compressed texture representation, not a hidden runtime quality reduction. The clean `dc8ab6c9` desktop comparison had already isolated the original Sponza issue to device fragment/bandwidth cost rather than JS or GC. The checksum-current normalized Bistro web tier still reaches `ready` with 110/110 images and no failures; exact commit `df631f9c` records first usable at 5.41 s, images settled at 22.19 s, and 20.25 ms average / 22 ms p95 over 60/60 full-DPR motion samples. Sponza now meets the 60 Hz mean target but not a sustained-p95 claim; Bistro and A Beautiful Game remain below the floor. Quest still needs a fresh controlled run, and no static spec can prove sustained 60/90/120 Hz or all visual oracles. |

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

The ledger above describes the active clean replacement branch. Legacy behavior
remains an oracle only and does not receive a parallel status column; any
comparison must name its exact revision and evidence. Strategy and review-policy
acceptance are not recorded as implementation `conforms` rows.

## Exit criteria for a future review

A review round is complete when it identifies the exact invariant, points to
code/tests or records the absence, revises contradictory specs, and classifies
the result as conforming, a concrete gap, deferred, or rejected. “Looks clean”
is not an exit criterion.
