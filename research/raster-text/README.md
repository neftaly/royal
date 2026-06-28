# Raster Text Research Prototype

This directory evaluates canvas-backed raster text as a serious renderer path in
parallel with SVG-as-canvas gateway work and the existing real-outline text
path. The prototype keeps the authoring surface semantic: users still write
`text(...)`; renderer policy chooses whether a run is rasterized by browser
canvas, converted to real outlines, or selected automatically by capability and
content.

## Prototype

Run the Node-safe simulator:

```sh
node research/raster-text/raster-text-sim.mjs
```

Useful knobs:

```sh
node research/raster-text/raster-text-sim.mjs \
  --text "AV office 108%." \
  --size 16 \
  --dpr 2 \
  --atlas 256 \
  --iterations 20000
```

The simulator does not need DOM canvas. It models the resource consequences of
canvas-raster text: bitmap dimensions, RGBA upload bytes, upload count, atlas
packing, edit churn, and draw quad count. Its metrics are approximate because
Node cannot call `CanvasRenderingContext2D.measureText()` without adding a
canvas dependency. A browser prototype should replace the width model with
actual `measureText()` and capture GPU upload timing around `texImage2D` /
`texSubImage2D`.

## Strategies Compared

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

### 2. Glyph/Cluster Atlas

Render glyphs, shaped clusters, or small reusable runs into atlas pages, then
draw positioned quads for the text run.

Best fit:

- Editable UI text, counters, repeated labels, and dense repeated glyph sets.
- Stable font/size/DPR combinations where a warmed atlas avoids full-run
  re-uploads.
- UI layers where text run bounds are needed for culling and hit testing anyway.

Costs:

- More draw quads than whole-run textures unless quads are batched.
- Atlas entries must be keyed by font family, loaded face, weight, style,
  variation settings, size, paint mode, DPR, antialiasing policy, and color or
  SDF/coverage mode.
- Browser canvas alone draws visual glyphs but does not expose full glyph ids,
  GPOS/GSUB shaping records, or cluster maps. A robust atlas path needs either
  browser-provided layout data, a shaping layer, or a conservative run-atlas
  fallback for complex scripts.

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
  text: "AV office 108%.",
  font,
  size: 16,
  renderer: "auto",
});
```

Renderer policy options:

- `"auto"`: default policy. Use outlines for geometric/example scenes and
  scalable labels; use raster-browser for dense UI text, color glyphs, native
  browser font fallback, or edit-heavy UI where atlas reuse wins.
- `"outline"`: force the existing real-outline path.
- `"raster-browser"`: force canvas-raster text when browser canvas and font
  readiness are available. In Node/server contexts this can emit layout records
  but should not claim visual parity unless a real canvas backend exists.

Do not expose atlas handles publicly in v1. Atlas sizing, page eviction, upload
budgeting, and glyph/run entry choice are backend policy. Public escape hatches
can come later if product code proves it needs low-level atlas control.

## Comparison With Real Outlines

The current `research/text-vector` path validates real font outlines and the
production direction uses `opentype.js` plus `earcut` for mesh generation.
Outlines remain stronger for renderer examples because they scale cleanly,
participate naturally in geometry transforms, and do not have DPR or bitmap
blur boundaries.

Raster text should be added for cases where browser behavior is the feature:
dense UI text, editable fields, emoji/color glyphs, CSS font fallback parity, or
native canvas text quality. It should not replace the outline path as the
general text primitive until the browser implementation proves atlas batching,
font invalidation, and cache eviction under real UI workloads.

## Current Recommendation

Default UI examples should stay on the real-outline path for now. Add
`raster-browser` as an experimental renderer route behind `text({ renderer:
"auto" | "outline" | "raster-browser" })`, with `auto` choosing raster only for
browser UI text workloads that benefit from canvas shaping or atlas reuse.

Whole-run textures are the lowest-risk first browser prototype. Glyph/cluster
atlas is the better long-term raster strategy for editing and repeated labels,
but it needs careful shaping and batching before it should be the default.
