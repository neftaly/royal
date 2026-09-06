**Royal at half or quarter size — evaluation, 6 September 2026**

A roughly half-sized Play runtime is a credible engineering target if Royal separates general asset ingestion from rendering and makes unused capabilities removable. It is not a measured outcome yet. A quarter-sized runtime is a substantially different product: a small renderer for prepared tabletop assets, with general import and some material behaviour outside that runtime. Preserving all current Royal capabilities, arbitrary currently supported imports, exact visual results, and the existing device performance envelope at one quarter size is not supported by this evaluation.

For source maintenance, deleting half of Royal is harder than halving a download: optional packages and offline importers move code rather than eliminate it. For tarball size alone, removing bundled source maps already approaches the requested reduction without changing rendering.

User constraint added during this review: retain Draco support and prefer Verika's decoder where compatible. The current source imports `minidraco`; checking its identity/version and all other dependencies is a separate follow-up, deliberately excluded from this investigation. The codec-removal experiment below is attribution evidence, not a proposed loss.

This is an evaluation, not an implementation proposal already accepted by the user. No production code, Probability dependency, or release was changed. The build ablations deliberately remove functionality; they are size experiments, not validated replacement renderers.

**Measurements and denominators**

Royal source: `bcbac2d332521c36857b9b4d9b17ebad598813bb`, version 0.0.20. Probability checkout inspected: `e9af8ed`, including its current working files. Its Royal catalog still names 0.0.17. Compatibility analysis therefore examines current Play source rather than assuming it already consumes 0.0.20.

All byte figures below use decimal KB. The standard fixture is Royal's empty Canvas consumer, not a production build of all Probability. It includes a React/ReactDOM bootstrap. The glTF and XR fixtures provide additional coverage. Subtracting the React-only fixture is a useful incremental estimate, not exact attribution of compression across shared code.

| Metric | Current | Half target | Quarter target |
| --- | ---: | ---: | ---: |
| Initial fixture JS, gzip | 139,860 B | 69,930 B | 34,965 B |
| Incremental initial JS over React fixture | 80,552 B | 40,276 B | 20,138 B |
| All emitted fixture JS, gzip | 287,811 B | 143,906 B | 71,953 B |
| All emitted JS minus React fixture | 228,503 B | 114,252 B | 57,126 B |
| Production source physical lines, all three packages | 43,091 | about 21,546 | about 10,773 |
| Three published package tarballs combined | 846,256 B | 423,128 B | 211,564 B |

React-only initial JS is 59,308 B. A quarter of the inclusive initial figure would be smaller than that fixed React bootstrap. Do not set Royal's goal using that denominator while assuming React remains unchanged. I recommend the Royal-incremental metrics as the engineering targets, alongside actual Play route requests.

“All emitted JS” includes optional lazy code and worker assets; it is neither first-load network transfer nor resident memory. Initial code splitting alone cannot reduce that total. Source maps and declarations affect packages, not normal runtime JS delivery. Model bytes, decoded textures, GPU allocations, and retained CPU arrays are separate budgets again.

Source counts include comments, whitespace, shader files, and declarations under `packages/*/src`; they exclude tests, examples, generated dist, and dependencies. The previous refactor was primarily about ownership, not a source-size reduction.

**Where size lives**

| Production source area | Physical lines | Implication |
| --- | ---: | --- |
| WebGL surface rendering | 13,241 | Main draw, geometry, outlines, materials, picking, visibility, and publication machinery |
| WebGL glTF | 7,657 | Large cold-path opportunity; also needed for imported models and interaction geometry |
| WebGL virtual textures | 3,217 | Strong optional capability candidate, already mostly lazy |
| WebGL ordinary textures | 3,191 | Much is correctness, memory admission, decoding, and upload pacing |
| WebGL runtime | 2,770 | Root orchestration and retained presentation, not all dispensable abstraction |
| Remaining WebGL areas | 4,922 | GL state, resources, frame lifecycle, environment, XR, math |
| Renderer core | 4,113 | Descriptors, validation, identity, transforms, public contracts |
| React layer | 3,980 | Orbit 1,111; XR 795; interaction 740; observation 545; runtime 470; other 319 |

The largest initial rendered source modules are surface GPU ownership (58.9 KB), canvas root (48.2 KB), edge overlays (46.6 KB), GPU geometry ownership (31.0 KB), and scene lowering (24.2 KB). These are pre-final-minification rendered lengths, not gzip savings that can be added or reclaimed directly. The surface fragment shader is only 11.1 KB by this measure: replacing its BRDF alone cannot halve the library.

The standard fixture emits a 56.8 KB gzip preparation worker, a 27.0 KB Draco chunk, a 7.3 KB Meshopt decoder chunk, a 12.7 KB virtual-texture runtime chunk, and a 3.5 KB bounded-emission volume chunk. Parsing, decoding, and preparation are compiled in both main-thread and worker paths. This duplicated delivery is a stronger size lead than another pass at tiny math helpers.

**What Play actually needs**

| Behaviour | Evidence in Probability | Preserve for compatibility |
| --- | --- | --- |
| Generated pieces with PBR faces and normal-mapped edges | `apps/play/src/creation/generate-gltf.ts` | Metallic/roughness shading, normal maps, base-color textures, AVIF/WebP, alpha masks |
| Lighting and transparent tabletop | `game/scene-nodes.ts`, `game/play-surface-nodes.ts` | Two directional lights, rotated studio environment, color conversion, alpha blending |
| Selection and collaborator presence | `game/scene-nodes.ts`, `game/useGameOverlay.ts` | Geometry outlines, screen-space widths, overlapping participant partitioning, movement segments |
| Picking and touch manipulation | `game/SelectionPreviewController.tsx`, drag and camera controllers | Exact hit semantics and responsive CPU interaction; alpha masks must not become solid rectangles |
| Physical placement and stacking | `game/ModelPreparation.tsx` | Prepared triangle geometry, bounds, readiness states, and geometry visitation |
| History preview | `rollback/RollbackPreview.tsx` | Orthographic camera, additional root, overlays, correct resource lifecycle |
| Headset use | `workspace/WorkspaceMenu.tsx` | AR/VR session lifecycle, stereo views, external framebuffers |
| External and collaborative assets | `release/model-file-session.ts`, `assets/model-resources.ts` | Custom resource reader, cancellation/versioning, URLs and Automerge files |

Generated pieces explicitly use `EXT_texture_avif` / `EXT_texture_webp` as required extensions where appropriate. Removing those paths would break ordinary authored content, not just exotic imported models. SVG is also covered by the earlier Play smoke test and should remain in the compatibility corpus.

Play does not directly author Royal virtual textures, bounded emissive volumes, prefiltered environments, glTF LODs, transmission, or extended specular/IOR materials in the inspected scene code. That does not prove imported models avoid every such feature. The checked-in Duck GLB declares no extensions, but one fixture is not a representative import corpus.

Compatibility has three levels: preserving Play's TypeScript API, preserving existing generated games and interactions, and preserving every external model Royal currently accepts. Only the first two could reasonably be certified from a bounded Play corpus. The third needs the full importer, optional capability loading, or an import conversion path.

Unsupported required glTF extensions must fail clearly; silently ignoring them is not compatibility. Khronos defines required extensions as necessary for correct asset loading. See the [glTF specification](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc).

**Experiments actually run**

The controlled consumer ablations use Safari 17 output and gzip level 9, with sourcemaps disabled. Their baseline is 287,031 B rather than the standard 287,811 B because map-reference comments/build settings differ. Compare each variant to its own controlled baseline. Results are emitted-byte measurements only; no A10/Quest performance measurement was made.

| Experiment | Total emitted fixture gzip | Reduction from controlled baseline | Meaning |
| --- | ---: | ---: | --- |
| Baseline | 287,031 B | — | Full implementation |
| Remove Draco and Meshopt decoder implementations | 220,778 B | 66,253 B | Compressed assets needing those decoders cannot load |
| Also replace VT and bounded-emission implementations with failure stubs | 204,478 B | 82,553 B | More lost capabilities; retained integration code is still present |

Because Draco is to be retained, the decoder-removal savings cannot be budgeted as an accepted change. We instead need to investigate sharing decoder delivery, preserving optional loading, and converting assets without changing their meaning.

The combined cut is about 29% of the inclusive fixture or roughly 36% of Royal's incremental total. Initial fixture size moves from 139,825 B to 139,673 B: effectively unchanged. These large optional removals do not solve initial bundle size, and do not reach half of Royal's incremental total. They leave approximately another 31 KB to remove for a half-sized incremental runtime, or 88 KB for a quarter-sized runtime. Those are target gaps, not promised savings.

The codecs experiment replaces the Draco dependency call with an explicit failure and reports Meshopt unsupported. The second experiment also substitutes throwing VT/volume factories. It does not establish a production fallback policy, preserve compressed model support, or claim the leftover glue is minimal. Codec savings include both copies in the self-contained worker and main dependency graph; do not add the full worker size on top.

An ES-module worker format experiment apparently reduced the fixture by 35,629 B, but inspecting its import closure found a missing `draco-C2cDbTDq.js` asset. That omitted codec in turn imports the original worker filename, which the consumer had renamed. The apparent saving is invalid for a working release. It demonstrates that simply changing `worker.format` is insufficient: worker graphs need explicit packaging and URL ownership. A correct shared-module build may still save code, but that saving remains unmeasured. The current package consumer's self-contained worker requirement also needs a deliberate replacement test if this architecture changes.

Separately, a tar repack excluding all `.map` files produced approximately 42,303 B React, 41,107 B core, and 277,016 B WebGL, or 360,426 B combined (42.6% of current package bytes). This is an archive experiment using Python tar/gzip, not pnpm's exact release packing. A shipping change must remove dangling source-map comments or host matching maps separately. It loses bundled source debugging, not rendering behaviour, and provides no normal browser runtime-JS reduction.

**Candidate approaches, ordered by compatibility**

| Approach | What becomes simpler | What we lose or change | Device consequences and verdict |
| --- | --- | --- | --- |
| Separate source maps from runtime packages | Distribution only | Bundled debugging; host maps separately if needed | No frame-time benefit. Easy package-size win |
| Explicit optional capability modules | Core need not own VT, emission volumes, prefiltered environments, transmission composition until requested | Nothing if full behaviour loads on demand; restricted build rejects omitted features | Good isolation. Loading latency moves to first use; shared lifecycle stays in core |
| One compiled preparation/codec graph across workers and main | Stop distributing equivalent parser/decoder implementations twice | Ideally none; worker URL, CSP, MIME, cancellation, cache and fallback contracts change | Strong preservation-first spike. Module sharing saves transfer, not automatically execution memory across realms |
| Normalize assets at import/export into versioned prepared data | Runtime consumes validated typed geometry/material/image records, not arbitrary glTF structure | Runtime-only package stops directly accepting arbitrary glTF; compatibility importer runs separately | Best route toward half. Less repeated CPU work; cold import still costs time and storage |
| Flatten static transforms and consolidate compatible geometry during preparation | Fewer runtime scene variants and duplicate representations | Preserve authored object/primitive identity separately for picking, outlines, transforms, geometry visitors | Promising. Do not duplicate repeated mesh vertex buffers or destroy per-object selection |
| One bounded asset scheduler with typed stages | Share queue admission/cancel/publish mechanics | No intended semantic loss; migration can introduce stale results and accounting errors | Keep per-resource limits and atomic publication. Avoid a callback-heavy universal framework |
| Basic metallic/roughness plus unlit profile | Fewer material slots, shader branches, binding and composition policies | Transmission, volume attenuation, IOR/specular extensions, punctual-light breadth or other omitted supported features | Can suit generated pieces; external imports change. Keep normal maps, masks, color and studio lighting |
| Full-buffer loading of normalized small assets | Remove range demands and progressive geometry/LOD orchestration from the narrow runtime | Huge or distant models load later/consume more peak memory unless prepared/partitioned first | Useful only after asset bounds are contractual; 32 MB encoded-file limit is not a decoded/GPU memory bound |
| Single selected LOD in prepared data | Remove runtime node/material LOD combinations | Dynamic LOD/progressive refinement and their performance/quality choices | May worsen large-map performance. Compare near/far scenes before choosing |
| Simpler silhouettes or selection boxes | Replace the large edge mask/dilation implementation | Exact outlines, crease appearance, constant screen width, masked geometry, or overlapping participant semantics | High product cost. An inverted hull is not equivalent for thin, disconnected, concave, or alpha-masked pieces |
| Diffuse-only/baked material renderer | Replace much of standard PBR with a small shader set | Current normal/specular response and lighting appearance; view-dependent material effects cannot generally be baked exactly | Credible quarter-size direction only with explicit visual redesign and bounded assets |

A smaller runtime should still have a cold preparation stage producing compact draw data and a retained hot drawing stage. Pure functions are useful for transformation, planning, and admission decisions. Rebuilding immutable object graphs, sorting everything, or republishing buffers every frame to reduce ownership code would undermine the device goal.

With Draco retained, 114 KB is a stretch target requiring measured reductions in both the hot core and duplicated preparation; this review does not demonstrate that it is achievable. A 57 KB complete runtime including the present roughly 27 KB standalone Draco chunk would leave only about 30 KB for everything else, before considering Meshopt or XR. That makes the quarter-sized complete feature set particularly implausible. An optional importer can preserve compatibility but must still be counted if it ships with the product.

The biggest maintenance opportunity is reducing the number of representations and supported state combinations, not merely replacing classes with functions. Prefer canonical asset data once, an object/instance table, material records, and retained draw batches. Keep object identity and resource ownership explicit. Removing glTF vocabulary from the frame path is valuable; moving the same seven thousand parser lines to another package does not reduce total repository LOC.

**What I would keep even in a small renderer**

Keep shared geometry and automatic instancing, coarse visibility, retained static uploads, targeted transform updates, bounded decode/upload queues, cancellation and stale-result protection, GPU admission, context restoration, and demand-driven rendering. Keep alpha-aware CPU picking and prepared geometry visitation. Keep native multisampling and output/color behaviour until a deliberate visual decision changes them. Keep XR session/view mechanics for Quest; the separate XR fixture is only about 6.6 KB gzip, so sacrificing headset support is a poor trade for the requested target.

Do not replace the ordinary upload queue with “upload everything when ready,” remove workers for large imports, replace CPU picking with synchronous GPU readback, or turn every scene edit into a full geometry rebuild merely to delete lines. These choices can make downloads smaller while making interaction or memory pressure much worse.

Also avoid a universal shader doing every feature under runtime branches just to reduce program-management code. Whether it wins depends on uniform/compile overhead versus fragment work. Royal's historical measurements already show that visually equivalent simplifications can regress A10.

**A10 and Quest 2 evidence**

The existing benchmark archive is more useful than assuming shorter code runs faster. In the documented A10 outline experiment, an arithmetic-only partition pattern reached 72–74 ms p95 versus 63–64 ms for the solid control and was rejected. Royal retained a shared 8 KiB integer pattern texture instead. Removing that texture is a concrete example of an attractive simplification that did not meet device goals. See `research/examples-benchmarks/README.md`, the August 1–2 partition passes.

Older Quest two-view partition runs show about 14.6–14.7 ms p95 with roughly 2 ms callbacks; those runs explicitly do not establish immersive comfort. The separate exact-build Quest report includes a real immersive session but documents that its p95 is only accepted as 60 Hz proof, not sustained 90/120 Hz. None of this certifies the proposed smaller runtime or current Play at those rates.

Demand-driven rendering and low allocation churn should remain: WebKit specifically recommends avoiding unchanged canvas draws, reducing JavaScript object churn, and returning to idle. That supports keeping retained scheduling rather than a smaller always-running redraw loop. See [WebKit's power guidance](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/).

For each candidate, compare the same pixels, viewport, DPR, scene, assets, and thermal conditions. Measure cold/warm time to first correct frame, drag latency, long tasks, p50/p95/p99 CPU/GPU/frame timing, missed frames, draw/state calls, uploads, CPU/GPU memory, idle work, and sustained thermal behaviour. Use physical A10 Safari and actual Quest immersive stereo; desktop SwiftShader and browser-panel timing cannot establish this requirement.

Use 16.7 ms at 60 Hz, 13.9 ms at 72 Hz, and 11.1 ms at 90 Hz as frame-interval reference points, with submission headroom and missed-frame measurements rather than equating a callback measurement to full frame time. Where the current stress scene already misses a target, record that fact and compare regressions separately from achieving the target.

**Routes to the requested targets**

| Route | Target, not a forecast | Compatibility position |
| --- | --- | --- |
| Smaller distribution | Around half the package download | Already supported by archive experiment; runtime unchanged |
| Preserve all current Royal semantics | Reduce duplicate delivery and initial mandatory dependencies first | No measured evidence for a 50–75% total reduction; shared-worker packaging needs a proper implementation |
| Small Play runtime plus full lazy importer | Approximately 110–120 KB incremental total, aiming for the 114 KB half threshold | Keep generated-game appearance, interactions, and XR; arbitrary imports go through a compatible separate stage |
| Prepared tabletop renderer | Approximately 55–60 KB incremental total, aiming for the 57 KB quarter threshold | Likely requires constrained assets, fewer material behaviours, simpler loading, and potentially simplified outlines/lighting; feasibility unproven |
| Half or quarter source LOC across the whole system | About 21.5k / 10.8k production lines | Requires deleting supported combinations and responsibilities; moving importer/plugins elsewhere does not count |

The normal Play route can become smaller while preserving a full importer available only when needed. But if that importer remains in the application's deployment, its bytes still count toward total deployed code. If it moves to a service or authoring application, account for the new dependency, offline behaviour, conversion cache, failure handling, and maintenance. A quarter-sized *runtime* does not imply a quarter-sized complete product.

**Recommended work sequence**

1. Freeze a Play compatibility corpus before removing anything: generated front/back pieces, AVIF/WebP/SVG, masked cutouts, normal-mapped edges, multi-material imports, compressed models, multiple participants selecting the same objects, large stacks, history previews, and real XR. Inventory extension/material/texture/geometry features across user-accessible imports, not only fixtures. Preserve geometry-derived placement and model status behaviour.
2. Add a Play-specific size fixture with its actual runtime imports and representative loading paths; measure requested bytes as well as emitted bytes. Keep React, model assets, maps, and runtime overhead separated. The existing empty Canvas fixture shows that much of the main graph is mandatory, but is not a full Play measurement.
3. First preservation spike: publish the preparation/codec module graph once with correct main and worker URLs, keeping the worker path for expensive work. Test complete packed-consumer dependency closure, including compressed assets in nested workers. Reject the current one-line ES-worker experiment as broken.
4. Second preservation spike: explicit optional capability construction so no-use scenes avoid capability ownership code. Start with VT, bounded emissive volumes, and prefiltered-environment support; retain current defaults for the full build. Measure initial and total independently.
5. Biggest architectural spike: a versioned prepared-asset boundary and a Play-compatible renderer entry. Reuse the existing loader to generate prepared records first; do not replace both sides simultaneously. Preserve texture identity, alpha masks, object mapping, content hashes, custom readers, and cancellation. A compatible cold importer can remain available lazily.
6. Run physical A10/Quest comparisons before simplifying the hot path. If those steps cannot meet roughly 114 KB, choose explicit material/loading restrictions based on the corpus. Treat 57 KB as a separate renderer profile requiring a new product decision, not a promise from continued refactoring.

This order makes losses concrete before committing to them. My recommendation is to pursue the half-sized runtime with the current Play appearance and interaction contract, and keep the quarter-sized option as a separately specified constrained profile. I would not remove batching, memory controls, normal maps, accurate picking, or collaborative outlines to hit a byte target.

**Evidence and reproduction**

`baseline.json` is the fresh `pnpm report:bundle-size` report. `ablation-results.json` contains the two controlled failure-stub builds. `worker-experiment-results.json` records the ES-worker experiment, including its invalid apparent saving; it must not be cited as a compatible optimization.

`ablation.mjs` and `worker-experiment.mjs` are local research harnesses. They use explicit `/home/neftaly/dev/royal` and `/tmp/royal-size-experiments` paths and the installed toolchain. Run from this checkout with a temporary `node_modules` symlink in the experiment directory pointing to Royal's `packages/renderer-webgl/node_modules`. They write only experiment build output and use existing package dist for unchanged dependencies. The worker harness disables sourcemaps because the current source-map normalization assumes the self-contained worker layout. These scripts are not CI tests or release tooling.

No new browser smoke or hardware run was performed: there is no candidate implementation to certify. The preceding release's five passing Play scenarios and two unresolved scenarios remain background evidence only. Production code remains unchanged; research files are uncommitted.
