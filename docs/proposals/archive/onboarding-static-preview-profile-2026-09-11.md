> Historical consumer measurements and proposed API directions, archived 2026-09-11. Capture readiness is now implemented in the Royal working tree; the current proposal lists remaining work. No VT opt-out has been accepted.

# Optional static glTF preview delivery for Probability onboarding

Status: proposal, 2026-09-11. This proposal adds no implementation or public option.
Inspected Royal checkout `cd59d051` plus its existing working-tree changes, and
Probability's linked Royal build. Do not interpret source observations as a
claim about a separately published release.

## Workload and measured problem

Probability `/onboarding` renders static top/bottom catalog-model images into a
detached WebGL2 canvas, encodes PNGs, and then uses ordinary DOM images. The scene
uses orthographic projection, two directional lights, prefiltered KTX1 ambient
lighting, opaque/PBR materials, alpha, antialiasing and fixed model transforms.
There is no live Royal renderer during scroll, hover, folder selection, ruler
measurement, or card/shadow drawing. Those are DOM/CSS and a separate shadow worker.

The model corpus in `probability/apps/site/public/onboarding-assets` contains
seven glTF documents: six dice and a pawn. Six require `EXT_texture_webp`; none
contain animations or skins. Keep core glTF and WebP support. Model textures and
lighting matter: dropping normals or lighting silently is not an acceptable
size optimization.

The production browser probe requests the first model after the initial page
sample, waits for a decoded image and two animation frames, then verifies painted
pixels. Observed first-model presentation was **5,806 ms after demand**, at
22,268 ms after navigation (demand was deliberately delayed until 16,462 ms).
The image was 60 × 60 pixels with 3,568 nontransparent pixels. This metric includes
queueing, downloads, renderer initialization, GPU preparation, PNG encoding,
image decoding and presentation; it is not just CPU time inside a draw call.
Both top and bottom glTF views also pass selection/ruler browser checks.

During that demand window, main-session transfer increased by about 2.23 MB.
Nearby models are prefetched, so this is a group-of-nearby-models cost, not an
isolated cost of one die. Resource timing includes a 250,454-byte model-rendering
chunk, a 61,812-byte VT runtime chunk, and 77,560-byte static-preparation-worker
resources. These are local encoded body sizes, not production Brotli sizes or
attributable savings. Worker-internal imports need separate capture for a full
network inventory. Measurements are individual local Chromium lab samples, not
field percentiles; CPU/network were unthrottled.

Probability already improved startup without changing Royal: models now load
within 600 px of the viewport, downloaded image blobs are reused, and rectangular
CSS shadows share nine-slice images. First-shadow sampling improved from 2.53 s
to 0.86 s; first-five-second main-page resource transfer fell from 2.70 MB to
1.43 MB. These do not establish that Royal's first-model rendering became faster.

## Can we turn off VT today?

Not through the current root options. `src/runtime/root-options.ts` allows alpha,
antialiasing and persistent GPU budget, and rejects unknown fields. The uncommitted
VT detail-scale and prefetch-margin options were removed after the 2D onboarding
migration left them without a consumer. The automatic-VT opt-out was deliberately removed in
0.0.23; see `always-on-automatic-virtual-texturing.md`. Do not restore a
stale `automaticVirtualTextures: false` call in Probability.

The expensive runtime is already a dynamic import from
`src/runtime/canvas-root.ts`. `virtualTextureRuntimeRequired` in
`src/virtual-texture/runtime-contract.ts` activates it for authored VT, eligible
rasters, SVG source or SVG previews. The measured model run actually requested
that chunk, so it is relevant here. `automatic-policy.ts` uses a minimum long
edge of 257 and a source-area threshold; small raster textures can stay ordinary.
The shared VT contracts and selection paths are still present in the renderer.

Disabling activation could avoid runtime work and its chunk for this workload,
but a runtime boolean alone does not prove a smaller entry bundle. Nor does it
remove the original texture download. The roughly 62 KB runtime body is much
smaller than the observed model/texture phase. Measure both before prioritizing
an API change.

## Proposal, in order

1. **Provide the requested per-root VT opt-out.** See the API proposal below.
   Preserve the arbitrary glTF input, including its textures and materials.
   Pre-rendered faces, edited model documents and resized texture variants are
   explicitly out of scope. If a future capture policy bounds GPU texture
   resolution, that must be an explicit renderer option with measured quality
   and memory behavior, not a rewrite of the demo assets.

2. **Expose capture readiness and stage timings.** A reusable `renderToImage` or
   equivalent optional capture helper should report asset start/ready, first
   usable frame, refinement complete and encoded image ready. Own cancellation,
   context disposal and encoding failure. Do not force consumers to poll a long
   list of internal queue/page counters. Keep first usable image distinct from
   final-quality capture so the app can explicitly choose its guarantee.

3. **Prototype a tree-shakeable static-capture entry point only if measured
   runtime savings justify it.** Prefer an additive optional module with an
   explicit bounded raster-texture policy over weakening the default automatic
   VT behavior. Reuse the same glTF/PBR/texture implementation. A capture profile
   may bound texture resolution to the target image, retain mipmaps and respect
   GPU budgets. Reject authored VT or unsupported SVG authority explicitly rather
   than silently losing source quality. Naming/API remains to be designed.

4. **Measure optional renderer boundaries.** Static capture has no need for
   picking, selection outlines, overlay/world-segment owners, orbit controls,
   XR, or DOM/React scene event plumbing. `canvas-root.ts` statically references
   `OverlayOwner`, whose module reaches edge/segment machinery: inspect whether
   that code is retained in the capture bundle and make it lazy or independently
   selectable if the savings are real. Keep normal rendering and context-loss
   recovery intact. Avoid another renderer fork or many independent feature flags.

## Features to omit, keep, or verify

| Capability | This workload | Action |
| --- | --- | --- |
| Automatic VT and SVG texture refinement | No zooming of the detached capture; current large rasters still activate VT | Per-root opt-out proposal; retain source assets and default behavior. |
| Picking/selection outlines/overlay segments | DOM handles all interactions and annotations | Candidate optional dependency boundary; quantify retained bytes first. |
| React Canvas hooks, orbit controls | Imperative root only | Audit tree shaking. `@royal/react` is side-effect-free; unused exports may already disappear. A direct WebGL import is not automatically a saving. |
| XR | Never used | Already a separate `./xr` export; no claimed saving without a detected request/import. |
| Draco/Meshopt codecs | Catalog glTF requires neither | Loaders already dynamic; do not count emitted-but-unrequested codec assets as startup bytes. Keep optional support for future arbitrary models. |
| KTX2/ETC2 | Catalog uses WebP, environment is KTX1 | Investigate why the small KTX2 helper is loaded; retain correctness for supported compressed sources. Do not confuse KTX1 ambient support with KTX2. |
| PBR normals, WebP, lighting, alpha, antialiasing | Required for current appearance | Keep. Compare screenshots before any approximation. |
| Animation/skinning | Absent from catalog | Do not add for this capture profile; confirm current implementation and bundle reachability before claiming removable code. |
| GPU budgets, cancellation, failure handling | Still necessary in capture | Keep. |

## Acceptance criteria

- Capture both faces of every catalog model; compare alpha, color, normal-map
  lighting and edge antialiasing at DPR 1 and 2. Include opaque/transparent and
  supported compressed-texture fixtures for the general renderer.
- Measure first usable model and final-quality image from the moment of demand,
  separately from page LCP. Report queue wait, download/decode, GPU preparation,
  render, encoding and DOM-image presentation where instrumentation permits.
- Compare cold and warm captures on desktop and a physical constrained device.
  Count main-thread and worker bytes, emitted JS and actually requested compressed
  JS separately; report memory alongside time and bytes.
- Verify no VT runtime request for a genuinely ordinary-raster capture, but retain
  the default renderer's SVG refinement, authored VT, budget and restoration tests.
- Fail unsupported capture inputs explicitly; never hang pending capture promises.
- No default-policy change or opt-out is accepted solely on the 62 KB chunk figure.

Reproducer in Probability: `apps/onboarding/scripts/profile-startup.mjs`, plus
`e2e/onboarding.models.spec.ts` and `e2e/onboarding.loading.spec.ts`. Related Royal
sources: `src/runtime/root-options.ts`, `src/runtime/canvas-root.ts`,
`src/runtime/overlay-owner.ts`, `src/virtual-texture/runtime-contract.ts`,
`src/virtual-texture/automatic-policy.ts`, and `src/gltf/codec-loader.ts` under
`packages/renderer-webgl`.

## Requested VT opt-out (proposal only)

The consumer explicitly requests a per-root VT opt-out. Suggested API for review:
`createRendererRoot(canvas, { virtualTextures: false })`, defaulting to true.
When false, skip VT runtime activation and use ordinary raster textures; reject
authored VT inputs explicitly. Root-option validation, React root recreation keys,
and default-policy regression tests must cover it. Verify SVG quality limitations
are explicit. This would avoid the requested runtime chunk for static raster
captures, not necessarily remove shared VT glue from the entry bundle.

At the user's clarification this remains a proposal: the experimental option and
its tests were removed, and onboarding does not pass an unsupported flag.

## Latest consumer measurement

Probability now omits glTF contact shadows and requests the selected top face
before nearby previews. A fixed Classic die top-face probe observed 2,781 ms from
demand to decoded/presented image: queue 0.3 ms, setup 52.2 ms, preparation 446.1 ms,
encoding/readback 774.1 ms. The remaining elapsed time includes lazy module loading,
main-thread scheduling, image decode and presentation. Output was 60 × 60 with
3,568 painted pixels. Earlier probes could follow changing DOM ordering, so do not
quote a like-for-like speedup ratio against them.

Worker PNG encoding was tested in the consumer but did not yield a reliable
end-to-end improvement; the experiment was removed. The retained optimizations
are selected-face priority and no model contact shadows. Royal remains unchanged;
VT opt-out and faster live capture remain proposals. Pre-rendering
and modifying the glTF documents or their textures are explicitly excluded.


## Arbitrary-model constraint and texture investigation

Do not tailor the demo assets to the renderer. The six dice normal maps are
1,960–2,048 pixels on their long edge and total 1,926,208 encoded WebP bytes.
Their preview-color textures are already about 128 pixels wide/high. Resizing or
substituting assets is excluded by the consumer; preserve normals and material
appearance. These source-byte costs are not avoided by a runtime VT switch.

Royal already traverses `MSFT_lod` material chains in
`gltf/static-image-demand.ts` and supports projected-coverage selection in
`surface/lod-selection.ts`. The die's authored thresholds are `[0, 0]`, and its
capture fills the orthographic view. Do not propose implementing LOD support that
already exists, or change the authored thresholds to force a lower-quality demo.
The consumer currently waits for preparation/refinement to finish before capture;
a public first-usable versus final-quality capture contract remains justified.


## Capture-path experiment and remaining API gap

A further local cold production sample of the unmodified Classic die presented
in 2,577 ms; its first async `canvas.toBlob` callback took 667 ms. A temporary
browser-injected synchronous `toDataURL` experiment, limited to canvases no larger
than 256 × 256, presented in 8,860 ms and blocked for 1,170 ms during the first
readback/encode. Preparation time also varied; these samples are not a controlled
speed ratio or field percentile. The experiment is not retained in Probability.
Together with the prior worker experiment, it does not justify changing encoders.

Current measurements combine final draw, GPU readback and PNG encoding. A
supported capture helper should report those separately and avoid holding up
unrelated page work. A renderer-owned asynchronous readback path is a candidate
for measurement, not an established speedup. No public image-capture/readback
helper or pixel-pack-buffer readback path was found in the inspected renderer
source. Existing `fenceSync`/`clientWaitSync` use in `virtual-texture/runtime.ts`
is for replacement validation, not a public capture facility. Reuse supported
readiness/resource ownership rather than expose private GL state to consumers.
Keep original model inputs, final material quality, alpha and context-loss/error
handling intact. No Royal implementation is authorized by this document.
