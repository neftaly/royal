# Raster Text Research Prototype

This directory evaluates canvas-backed raster text as a serious renderer path in
parallel with the existing real-outline text path. The prototype keeps the
authoring surface semantic: users still write
`text(...)`; renderer policy chooses whether a run is rasterized by browser
canvas, converted to real outlines, or selected automatically by capability and
content.

## Prototype

Run the Node-safe simulator:

```sh
node research/raster-text/raster-text-sim.mjs
```

The default report includes the dense-label scenarios plus one scenario per
Unicode fixture:

- `AV office 108%.` typed and edited through the canonical short-label path.
- A dense inspector/menu label set with counters and status edits.
- `fi ffi`, combining marks, emoji/ZWJ/flag text, mixed Arabic/Hebrew RTL text,
  CJK/Hangul text, and multiline monospace UI table text.

Useful knobs:

```sh
node research/raster-text/raster-text-sim.mjs \
  --text "AV office 108%." \
  --size 16 \
  --dpr 2 \
  --atlas 256 \
  --iterations 1000
```

The simulator does not need DOM canvas. It models the resource consequences of
canvas-raster text: bitmap dimensions, RGBA upload bytes, upload count, atlas
packing, edit churn, draw quad count, fixed-cell monospace metrics, UV rects,
and segmentation statistics. When `Intl.Segmenter` is available in Node, the
fixture report includes grapheme and word segmentation stats; otherwise it falls
back to code point and whitespace segmentation without adding a dependency. Its
metrics are approximate because Node cannot call
`CanvasRenderingContext2D.measureText()` without adding a canvas dependency. A
browser prototype should replace the width model with actual `measureText()`
and capture GPU upload timing around `texImage2D` / `texSubImage2D`.

## Strategies Compared

| Strategy | Correctness risk | Draw quads | Cache churn | Memory | Shaping data required |
| --- | --- | --- | --- | --- | --- |
| Whole-run texture | Low. Browser canvas owns shaping, bidi, fallback, emoji, and kerning for the full run. | 1 per visible run. | High for edits because any changed run is a new bitmap upload. | Can be high if many edit states or long labels remain cached. | Run bounds from `measureText`; no glyph ids or cluster maps required for drawing. |
| Glyph atlas | High for ligatures, combining marks, emoji ZWJ, Arabic joining, bidi, and kerning unless backed by a shaping engine. | Roughly one per code point or glyph, plus batching pressure. | Low once common glyphs are warm. | Predictable atlas pages, but entries are keyed by font, size, DPR, paint, and phase policy. | HarfBuzz/fontkit-class glyph ids, advances, offsets, GPOS/GSUB effects, and cluster-to-text mapping. |
| Cluster atlas | Medium only if clusters come from HarfBuzz/fontkit-class shaping; high if inferred from browser canvas or `Intl.Segmenter`. | One per shaped cluster; fewer than glyph atlas for ligatures and emoji sequences. | Low to medium; reusable clusters warm well, script-specific clusters churn more. | More entries than whole-run, fewer broken entries than glyph atlas for complex text. | Shaped cluster boundaries, visual order, advances, offsets, direction, and fallback font per cluster. |
| Monospace atlas | Low for restricted ASCII UI/debug/table text with hard diagnostics; reject broader Unicode or user text. | One per non-space cell unless spaces are skipped. | Very low for counters and fixed UI chrome. | Small fixed cell atlas per font, size, DPR, paint, and weight. | Fixed cell advance, line height, baseline, monospace font policy, and an allowlist proving no shaping-sensitive content. |

### 1. Whole-Run Texture

Render the entire shaped string/run into a canvas, upload it as one texture, and
draw one quad.

Best fit:

- Short labels that change rarely.
- Text that needs immediate browser shaping parity.
- Emoji, color glyphs, or CSS font fallback where canvas already knows how to
  draw the final visual result.

Costs:

- Every changed run is a new canvas draw and texture upload.
- Long or frequently edited strings re-upload unchanged glyph pixels.
- Caching many edit states can consume more memory than the visible text needs.
- Scaling above the captured size blurs unless the run is re-rasterized.

### 2. Glyph Atlas

Render reusable glyph-like entries into atlas pages, then draw positioned quads
for the text run.

Best fit:

- Repeated labels and dense glyph sets in simple scripts after shaping data is
  available.
- Stable font/size/DPR combinations where a warmed atlas avoids full-run
  re-uploads.
- UI layers where text run bounds are needed for culling and hit testing anyway.

Costs:

- More draw quads than whole-run textures unless quads are batched.
- Atlas entries must be keyed by font family, loaded face, weight, style,
  variation settings, size, paint mode, DPR, antialiasing policy, and color or
  SDF/coverage mode.
- Browser canvas alone draws visual glyphs but does not expose glyph ids,
  GPOS/GSUB shaping records, or cluster maps. A robust glyph atlas needs a
  HarfBuzz/fontkit-class shaping layer or equivalent browser API, not only
  canvas.
- Code point atlases are not correct glyph atlases. They break on `fi`/`ffi`,
  combining marks, emoji ZWJ sequences, Arabic joining, bidi visual order, and
  fallback-font boundaries.

### 3. Cluster Atlas

Render shaped clusters into atlas pages, then draw positioned cluster quads.
Clusters can be a single glyph, a ligature such as `ffi`, a base-plus-combining
mark grapheme, an emoji ZWJ sequence, or a script-specific shaping cluster.

Best fit:

- Editable UI text and repeated labels after a HarfBuzz/fontkit-class shaping
  engine can provide real glyph ids, cluster boundaries, visual order, advances,
  and positions.
- Emoji and combining-mark sequences where a code point atlas would split a
  visible unit.
- Runs where reuse matters but whole-run uploads are too expensive.

Costs:

- Cluster inference with `Intl.Segmenter` is useful for fixture stats but is not
  enough for production shaping. It gives grapheme/word segmentation, not glyph
  ids, GPOS offsets, GSUB substitutions, visual bidi order, or fallback font
  identity.
- Complex scripts and general Unicode need conservative fallback to browser
  whole-run textures unless the renderer has complete shaping records.

### 4. Monospace Atlas

Render fixed-size cells into an atlas and place them on a monospace grid.

Best fit:

- ASCII-only tabular UI/debug text: counters, profiler rows, compact inspector
  values, and code-like HUD text.
- Stable UI fonts where a cell atlas can be warmed once per font/size/DPR/paint
  key.

Costs:

- It must be guarded by an allowlist with hard diagnostics. Reject proportional
  fonts, ligature candidates, combining marks, emoji, RTL/bidi content, CJK,
  arbitrary user text, and any text where shaping or variable advance is part of
  correctness. Disable font ligatures for already-allowed cell rendering.
- It should be a backend optimization, not a public API. Product code should
  still request semantic text.

## Monospace Glyph Atlas V1 Model

The monospace atlas path is a fixed-cell model, not a proportional glyph layout
model with different advances rounded to the same grid. A cache entry is scoped
to a resolved font face, weight/style/variation tuple, CSS size, DPR, paint
mode, antialias/phase policy, and fixed metrics:

```ts
type MonospaceAtlasKey = {
  family: string;
  loadedFaceId: string;
  weight: string;
  style: string;
  sizeCssPx: number;
  dpr: number;
  cellAdvanceCssPx: number;
  lineHeightCssPx: number;
  paintKey: string;
};
```

Each visible code point maps to a same-size cell bitmap. Spaces and tabs advance
the cursor but do not need uploaded ink quads. The atlas packs cells into page
slots with `pageId`, `slotId`, pixel `x/y/width/height`, normalized `uvRect`,
and baseline metadata. Draw records stay simple: `{ pageId, slotId, uvRect,
x, y, width: cellAdvance, height: lineHeight }`. Cursor math, selection boxes,
and hit testing use cell metrics, not texture alpha.

Fallback policy should be strict in v1. If content is outside the allowlist,
emit a hard diagnostic and use browser whole-run raster or the outline path
instead of silently corrupting layout.

## Browser Canvas Gateway

Primary browser implementation route:

1. Resolve fonts with CSS fonts or `FontFace`, then wait for `document.fonts`
   readiness before caching final metrics.
2. Use `OffscreenCanvas` when available for worker-side rasterization; fall back
   to an in-document `<canvas>` when not.
3. Set backing canvas dimensions in physical pixels: `ceil(cssPx * devicePixelRatio)`.
4. Draw with `ctx.font`, `ctx.textBaseline`, `ctx.direction`, `ctx.letterSpacing`
   if supported, and measured bounds from `measureText()`.
5. Upload whole-run canvases with `texImage2D` or atlas patches with
   `texSubImage2D`.
6. Store explicit layout records for run bounds and glyph/cluster boxes; do not
   infer interaction bounds from texture pixels.

Canvas rasterization notes:

- For each atlas cell or whole run, create a scratch canvas sized in physical
  pixels and scale the 2D context by DPR before drawing CSS-pixel coordinates.
- Set `ctx.font` from the resolved CSS font shorthand, `ctx.textBaseline` to the
  renderer baseline policy, and `ctx.direction` from layout records. Measure
  with `measureText()` before allocating the upload rectangle.
- Use `OffscreenCanvas` in workers when available; keep a main-thread canvas
  fallback for browsers without worker 2D text support.
- For atlas updates, upload only the dirty cell rectangle with `texSubImage2D`;
  for whole-run textures, use `texImage2D` for new run allocations.
- This repo has `@fontsource/atkinson-hyperlegible` in
  `packages/renderer-core` under OFL-1.1, but not Atkinson Hyperlegible Mono. Do
  not vendor a new mono font in this research path. Use `ui-monospace`/system
  monospace for prototype metrics or add a separately licensed mono dependency
  in a scoped implementation patch.

Font loading and security policy:

- CSS font URLs need normal browser CORS approval when loaded cross-origin.
- A canvas that draws cross-origin image content can become tainted; font drawing
  is governed through CSS font loading, but keep renderer-owned canvas inputs
  restricted to trusted font sources and same-origin generated rasters.
- Cache keys must include the resolved font identity, not only the requested CSS
  family string, because fallback can change after a font loads.
- Invalidate raster caches when `devicePixelRatio`, font load state, font
  variation settings, text content, fill/stroke style, shadow/filter policy, or
  CSS font synthesis changes.

## Virtual Texturing Resource Model

Treat glyph atlases as VT page/cache resources. An atlas page is a resident GPU
texture page for one cache key, and each packed glyph/cell is a slot within that
page. Runtime records should track:

- `atlasKey`: resolved font, size, DPR, paint, strategy, and fixed-cell metrics
  for monospace.
- `pageId` and `slotId`: stable handles used by draw batches and cache eviction.
- `uvRect` and `pixelRect`: normalized draw coordinates plus dirty upload rects.
- `resident`: whether the page is on the GPU this frame.
- `lastUsedFrame`, `pinCount`, and `dirty`: inputs to eviction and upload
  scheduling.

Residency policy should prefer keeping pages for visible text and recently
edited UI. Under memory pressure, evict whole-run edit states first, then cold
proportional/cluster atlas pages, then cold monospace pages. Dirty atlas slots
should be queued as bounded `texSubImage2D` updates so text edits cannot consume
the whole frame upload budget. If a required slot is not resident, draw a
placeholder/fallback glyph cell or keep the previous frame's text until the page
arrives; do not expose missing atlas internals through the public text API.

## Geometry And Hit Testing Policy

Raster pixels are visual output, not the scene's source of truth.

- Layout stores text run bounds in CSS/world units.
- Atlas layout stores per-glyph or per-cluster boxes with advance, offset,
  ascent/descent, and texture UVs.
- Culling uses run bounds expanded for filter/shadow/padding, never alpha scans.
- Coarse hit testing uses run bounds or glyph/cluster boxes.
- Exact glyph-edge hit testing is optional and should only sample an alpha mask
  when a product interaction requires it, such as selecting visible ink rather
  than the text cell.

This keeps text interaction stable across DPR changes and cache invalidation.

## Rendering Limits

Raster text is not a drop-in replacement for outline text.

- DPR: atlas pages are per-DPR. Moving a window between displays needs cache
  migration or re-rasterization.
- Zoom: zooming above the captured CSS size blurs. Either re-rasterize at the new
  scale or hand the run to the outline path.
- Subpixel positioning: browser antialiasing is baked into the bitmap at the
  rasterized origin. Reusing a glyph at many fractional offsets can shimmer; snap
  glyph origins or keep separate phase buckets if necessary.
- Antialiasing: Canvas 2D exposes limited control over grayscale/LCD
  antialiasing. Expect differences between browsers and operating systems.
- Texture upload cost: full-run textures pay bytes proportional to the whole
  changed string; atlas textures pay bytes only for new entries but still need
  batching to avoid many draw calls.
- Resizing: UI that animates font size should prefer outlines or cache only a
  small set of raster sizes.

## API Sketch

Keep the public text API semantic:

```ts
text({
  text: "CPU  12%\nMEM  64%\nIO   08%",
  rendering: "raster",
  raster: {
    strategy: "monospace-atlas",
  },
  font: {
    family: "ui-monospace",
    size: 16,
    mode: "monospace",
  },
});
```

Renderer policy options:

- `rendering: "auto"`: default policy. Use outlines for geometric/example
  scenes and scalable labels; use raster-browser for dense UI text, color
  glyphs, native browser font fallback, or restricted monospace UI/debug/table
  runs where atlas reuse wins.
- `rendering: "outline"`: force the existing real-outline path.
- `rendering: "raster"` with `raster.strategy: "whole-run"`: force
  browser-shaped run textures.
- `rendering: "raster"` with `raster.strategy: "monospace-atlas"` and
  `font.mode: "monospace"`: request the restricted fixed-cell atlas policy.
  The renderer may still fall back to whole-run raster or outlines if the font
  or text fails the monospace allowlist.

Do not expose atlas handles publicly in v1. Atlas sizing, page eviction, page
ids, slot ids, upload budgeting, and glyph/run entry choice are backend policy.
Public escape hatches can come later if product code proves it needs low-level
atlas control.

## Comparison With Real Outlines

The current `research/text-vector` path validates real font outlines and the
production direction uses `opentype.js` plus `earcut` for mesh generation.
Outlines remain stronger for renderer examples because they scale cleanly,
participate naturally in geometry transforms, and do not have DPR or bitmap
blur boundaries.

Raster text should be added for cases where browser behavior is the feature:
dense UI text, editable fields, emoji/color glyphs, CSS font fallback parity, or
native canvas text quality. Browser whole-run raster text is the correctness
fallback for general Unicode. It should not replace the outline path as the
general text primitive until the browser implementation proves fallback policy,
font invalidation, and cache eviction under real UI workloads.

## Current Recommendation

Default UI examples should stay on the real-outline path for now. Add
`raster-browser` as an experimental renderer route behind `text({ renderer:
"auto" | "outline" | "raster-browser" })`, with `auto` choosing raster only for
browser UI text workloads that benefit from canvas shaping or native font
fallback.

V1 should support:

- Browser whole-run raster textures for short UI labels, editable fields where
  correctness matters more than upload churn, emoji/color glyphs, bidi,
  combining marks, CJK, arbitrary user text, and CSS font fallback parity.
- A restricted monospace atlas for ASCII UI/debug/table text only after an
  allowlist rejects ligature-sensitive text, combining marks, emoji, RTL/bidi
  content, CJK, proportional fonts, user text, and variable-advance cases with
  hard diagnostics. Disable ligatures for already-allowed cell rendering.
- Renderer-owned cache keys that include resolved font identity, size, DPR,
  paint, font load state, and invalidation policy.

Explicitly defer:

- General glyph atlas as a default text path.
- General cluster atlas for complex scripts.
- Public atlas handles or user-visible atlas policy.
- Removing outline text as the default for geometric/scalable examples.
- Adding HarfBuzz/fontkit-class shaping dependencies in this research patch.
  General glyph/cluster atlas work should evaluate that shaping layer in a
  separate patch, because browser canvas alone cannot expose glyph ids or
  clusters.

Tests that must pass before removing outline/default paths:

- Browser-backed `measureText()` parity for run bounds across loaded fonts,
  fallback fonts, DPR changes, and zoom-triggered rerasterization.
- Cache invalidation for font load completion, DPR migration, font variation,
  paint changes, text edits, and renderer policy changes.
- Whole-run rendering of the full fixture set: `AV office 108%.`, `fi ffi`,
  combining marks, emoji ZWJ/flag sequences, Arabic/Hebrew bidi, CJK/Hangul,
  and multiline monospace table text.
- Monospace atlas hard diagnostics for unsupported content and atlas batching
  under repeated supported table/debug workloads with bounded upload budgets and
  stable memory.
- Hit testing and culling use stored layout records, not texture alpha scans.

Tests that must fail or reject before removing outline/default paths:

- Glyph atlas requests for ligature, combining-mark, emoji ZWJ, Arabic joining,
  bidi, CJK fallback, or unknown-font content when no shaping records are
  available.
- Monospace atlas requests for non-ASCII, proportional, ligature-sensitive,
  combining, emoji, RTL/bidi, CJK, or arbitrary user text.
- Raster paths that would blur under scale/zoom when the renderer cannot
  rerasterize or hand back to outlines.
