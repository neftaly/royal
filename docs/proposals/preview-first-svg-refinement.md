# Preview-first SVG loading with bounded background refinement

Status: Royal PNG preview consumer implemented in the working tree (2026-09-08);
Probability's PNG producer implemented. Physical performance acceptance,
worker rasterization, occluded-stack demand, and Basis KTX2 remain follow-up work.
No application mode or opt-out.

## Outcome and ownership

Load a small complete representation first, make the game interactive, then
replace visible regions with sharp SVG-backed VT pages without monopolizing
the main thread or GPU. Automatic VT is always enabled; see
[the always-on proposal](always-on-automatic-virtual-texturing.md).

**Probability generates and caches preview bytes. Royal consumes them and owns
loading, residency, refinement, cancellation, and publication.** Royal must not
run an asset encoder every time a game opens. Probability must not add a second
renderer scheduler, per-page React updates, or a user-facing quality mode.

The target compressed preview is KTX2 through an agreed supported delivery
contract. First prove scheduling with a small PNG/WebP preview using the
existing SVG/raster relationship. Probability now generates this PNG tier;
Royal now implements preview-first SVG scheduling; Basis KTX2 remains unsupported.

To produce the current Settlers test package, start Probability's literal root
`pnpm dev`, then run from Probability (using its actual printed origin):

```sh
IMPORT_BENCH_EXPORT=/tmp/probability-settlers-svg-previews.zip \
  node research/benchmarks/import/import-bench.mjs \
  http://localhost:3007 ../settlers/dist/svg
```

The command imports locally, re-imports unchanged, and exports the resulting
self-contained package. The generated Settlers control contains 273 models,
412 SVG texture bindings, and 60 shared PNG previews (204,271 preview bytes;
902,641 bytes for the whole ZIP). All model image/buffer references were checked.
Existing pieces gain previews when their art is
re-imported. Generated glTF uses one texture with a portable core PNG source
and the retained vector source, for example:

```json
{
  "images": [
    { "uri": "art.svg", "mimeType": "image/svg+xml" },
    { "uri": "preview.png", "mimeType": "image/png" }
  ],
  "textures": [{ "source": 1, "extensions": { "GS_texture_svg": { "source": 0 } } }],
  "extensionsUsed": ["GS_texture_svg"]
}
```

## Evidence and current obstacles

Probability's current SVG importer retains vector artwork. Enabling automatic
VT restores vector-backed page requests on zoom without changing source sizes.
Its latest local-only 277-file Settlers import prepared 60 vector-backed
textures, but still spent substantial time in native browser/rendering work.
Canvas readiness did not imply all VT detail had settled.

Historical material-LOD controls in Probability's
`research/benchmarks/texture-delivery/README.md` found a 128 px WebP tier
increased uploads from 45 to 89 and final completion from 4.314 s to 5.689 s.
Both tiers competed before the preview was complete. These are older AVIF
controls, not a speed prediction for the current SVG game.

Current Royal boundaries to change:

- `gltf/static-texture-image-plan.ts` selects SVG first; raster is deferred
  failure recovery, not an initial representation.
- `texture/browser-decode.ts` finishes ordinary bitmap decoding before handing
  retained SVG source to automatic VT. Vector pages should not require a full
  ordinary SVG texture first.
- `resource/async-preparation-owner.ts` already owns foreground/detail lanes,
  concurrency, and cancellation. Extend it rather than adding another queue.
- `resource/frame-upload-budget.ts` bounds bytes but allows one oversized
  upload alone. A byte cap cannot guarantee an input-latency bound.
- `virtual-texture/automatic-page-source.ts` uses DOM-backed SVG rasterization.
  An async function or OffscreenCanvas alone does not move that work to a worker.

## Probability producer contract

1. During import, derive a small preview from the rasterization already needed
   to inspect the SVG, where possible. Preserve the authoritative SVG and exact
   viewport, alpha, orientation, and color interpretation. Do not replace the
   SVG with its preview or change physical geometry/size inference.
2. Test a 128 px longest edge first, preserving aspect ratio; compare 256 px for
   recognizability on boards. These are experimental candidates, not permanent
   application settings. Do not upscale already-small input unnecessarily.
3. Cache generation by source content, preparation policy, preview dimensions,
   color interpretation, and encoder version/settings. Deduplicate output bytes
   through existing Automerge FS aliases. Filenames remain source provenance,
   not texture identity; titles must not be discarded to manufacture matches.
4. Persist preview plus SVG in the model's resource graph. Re-import invalidates
   the preview when its source or recipe changes; duplicates still share it.
   Save/export must preserve both and remain self-contained. Published-package
   enrichment must update model/release hashes atomically and respect size caps.
5. Represent the preview as the portable raster source of the existing
   `GS_texture_svg` texture, with SVG optional when raster fallback is sufficient.
   No duplicate material layer or material-LOD hierarchy is needed for one
   texture's two representations. Keep genuine spatial LOD semantics separate.
6. PNG is an immediately expressible core fallback; WebP uses its existing
   extension rules. Raw ETC2 KTX2 is not `KHR_texture_basisu`. Do not revive the
   removed `GS_texture_etc2` extension or invent a private core-image convention.
   Once Royal's standards-based KTX2 path is supported, Probability can generate
   that preview with bounded worker/offline encoding and reuse the same cache.

Probability now implements the PNG producer with a 128 px longest edge, no
upscaling, full-viewport UVs and content-addressed preview aliases. It stores one
preview per generated texture, not one per mesh or UV island; no separate atlas
packing or multi-resolution authoring ladder is added. Dense UV atlases can use
a 256 px research control later. Preparation is cached within an import pass;
stored output bytes deduplicate across passes. There is no persistent decoded
image cache. First-time SVG import
still needs inspection, polygon generation, and durable saving; preview-first
opening is not a substitute for optimizing those stages or fixing sync delays.

## Royal consumer behaviour

One logical texture progresses from no coverage to coarse coverage to demanded
detail. Retain preview coverage anywhere finer pages are absent or evicted.

- Prioritize visible geometry and missing coarse coverage. Refine already
  covered visible regions next; speculative/offscreen work comes last. Covered
  cards in stacks must not compete with visible artwork for expensive detail.
- Admit heavy refinement conservatively, initially one rasterization job at a
  time, while retaining foreground capacity. Reuse existing queues and budgets.
  Avoid a global wait-for-every-asset barrier: one bad preview cannot block the
  rest of the visible game. If SVG detail is ready first, publish it without
  waiting for an unnecessary preview.
- Validate/admit SVG separately from full bitmap decoding, retaining existing
  secure-static, external-resource, size, and origin-clean restrictions. Create
  the vector page source directly after its necessary validation.
- Move compatible preparation into workers. Capability-test the actual SVG
  backend on target browsers; unsupported DOM operations cannot simply be
  relocated. Keep remaining main-thread work in bounded units. If one complex
  SVG raster job still exceeds the latency target, that backend needs a
  worker-capable replacement or stronger admission bounds; idle scheduling is
  not proof of non-blocking execution.
- Upload small pages within byte and measured frame-time admission limits.
  Account for atlas allocation and mip work, not just copying pixels. Defer more
  work when recent frame cost is high. A budget cannot interrupt an individual
  driver call, so indivisible work must also be small enough on target devices.
- Bound decoded-but-not-uploaded bytes. Stop starting decode work when that
  queue fills; close discarded ImageBitmaps and release source/job ownership.
- Reprioritize when the camera changes. Cancel obsolete queued work and discard
  stale completions by source generation. Do not cancel a shared job still
  needed by another visible claim. Keep visible refinement making bounded
  progress during continuous movement; only speculative work may starve.
- Publish a sharper region only when its pixels and page-table mapping are
  GPU-ready. Preserve UVs, framing, alpha, sampler, and material identity. Do not
  rebuild geometry or React scene nodes for texture-page readiness.
- On optional detail failure, retain usable preview coverage and emit one
  bounded diagnostic. Required-extension failures must still obey the required
  contract. On context restoration, restore coarse coverage first. Release
  preview allocations only when replacement coverage can survive eviction;
  never remove the only fallback just because one visible area is sharp.

## Implementation and acceptance

1. Add deterministic fake-job tests for foreground admission, bounded pending
   bytes, cancellation, shared ownership, source replacement, and failure.
2. Implement the Royal source/publication path and a minimal PNG/WebP producer
   fixture. Prove earlier complete previews before adding a codec dependency.
3. Use Probability's implemented preview generation in normal import/export to
   verify real source sharing, UVs, alpha, and subset re-imports end to end.
4. Compare supported KTX2 previews under the same scheduler; adopt only with
   measured end-to-end benefit, including encode/transcode and transfer costs.

Measure frozen production builds on desktop and a physical mobile GPU: first
geometry, complete visible preview, frame-time distribution and input delay
while panning/zooming, first sharp detail, final requested-detail settlement,
wire bytes, and peak CPU/GPU memory. Compare refinement against preview-only
interaction as well as direct SVG loading. Shell LCP or canvas busy state alone
is not the success metric. Never claim an absolute zero-hitch guarantee from
headless or byte-budget tests.

Exercise current Settlers cards, round counters, the translucent ruler and large
mat; also complex SVGs, rapid camera reversals, deep stacks, duplicate filenames,
subset re-import during refinement, failures in either representation, exhausted
budgets, background tabs, context loss, and cold versus cached reopening.

Ship when preview completeness improves and refinement stays within the agreed
device frame/input budget without unbounded memory or visible blanking. Keep
final-detail time separate: delaying refinement is allowed to protect input,
but permanently starving visible detail is not.
