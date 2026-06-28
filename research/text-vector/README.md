# Text Vector Research Prototype

This directory is an isolated research record for replacing the old synthetic
bar/rectangle text path with real font-outline vector text. Renderer-core now
has a real-font path for callers that pass a `TextFontFace`; the no-font path is
compatibility behavior and should not be treated as the desired renderer text
quality target.

## Prototype

Run the local benchmark:

```sh
node research/text-vector/real-font-vector-bench.mjs
```

Optional inputs:

```sh
node research/text-vector/real-font-vector-bench.mjs \
  --font /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf \
  --text "AV office Royal 123"
```

The script predates the production dependency choice. It prefers a local
Atkinson Hyperlegible font if it can find one, but it does not commit or copy any
font file. If Atkinson is not installed it falls back to common system fonts such
as Liberation Sans or DejaVu Sans. The research parser handles TrueType outlines
directly (`cmap`, `loca`, `glyf`, `hhea`, `hmtx`, and legacy `kern` format 0
where present), flattens quadratic curves, estimates triangle counts, and
compares against the renderer-core mesh when the built artifact is available.

The current implementation path is different and simpler to maintain:

- `opentype.js` parses font data passed through `createTextFontFace()`.
- `earcut` triangulates flattened outline contours and counters.
- `text({ font, text })`, `layoutText({ font, text })`, and `textMesh(...)`
  carry real font metrics and real outline mesh data.
- `text({ text })` without `font` still lowers through the synthetic ASCII path
  for compatibility.

## Findings To Record

- Outline parsing: the production path uses `opentype.js` instead of the
  research-only TrueType parser in this directory. Local/system TTF parsing was
  enough to validate the direction without adding committed font assets.
- Curve flattening: outlines flatten deterministically by tolerance. The
  benchmark reports raw contours, flattened vertices, and flatten tolerance.
- Triangulation: `earcut` is the chosen production triangulator for flattened
  contours and holes. The research benchmark still reports estimated triangles
  because it intentionally does not embed a triangulator.
- Kerning and proportional metrics: real font advances and kerning are available
  when callers pass a `TextFontFace`. Deeper shaping remains open: full GPOS/GSUB
  coverage, complex scripts, bidi, variable fonts, and color glyphs are not solved
  by the current real-font path.
- Vertex counts: real outlines cost more vertices than the synthetic rectangles,
  but geometry is cacheable per glyph/font/size/tolerance. Text edits mostly churn
  layout records, not cached glyph outlines.
- Crispness: real-font path text remains vector geometry and can be sharpened
  with normal MSAA/coverage strategy. It avoids the blocky 5x7 cell identity of
  the no-font compatibility path without introducing raster text.
- Dynamic churn: the benchmark reports per-frame glyph cache hits/misses and edit
  churn for short text mutations.

## Current Recommendation

The production outline pipeline exists. The remaining API work is to make the
no-font synthetic path explicitly compatibility-only and keep real-font examples
on `text({ font, text })`. Avoid renderer-core export churn here; API fencing is
owned separately.

The synthetic compatibility path should keep shrinking because it encodes font
policy in renderer-core:

- ASCII-only glyph support with unsupported-glyph substitution.
- Hand-written fake proportional metrics and kerning.
- Rectangle roles (`bar`, `stem`, `dot`, `fill`) that approximate letters instead
  of representing glyph outlines.
- Legacy 5x7 grid rectangles that duplicate and conflict with the real outline
  mesh path.

The superior direction remains:

1. Shape text with a real font source and real metrics.
2. Cache glyph outline geometry by font face, glyph id, size, and flattening
   tolerance.
3. Layout runs separately from glyph geometry so dynamic text edits reuse cached
   glyph meshes.
4. Triangulate flattened contours with `earcut`.
5. Keep raster text out unless there is a specific need for dense paragraph text,
   subpixel LCD text, emoji/color glyphs, or browser-font parity.

The next production step is not dependency selection; it is policy cleanup and
deeper shaping. Make the no-font synthetic renderer path compatibility-only,
then decide whether the real-font path needs a fuller shaping stack before
expanding language, script, ligature, variable-font, or color-glyph promises.
