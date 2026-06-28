# Text Vector Research Prototype

This directory is an isolated research spike for replacing the current synthetic
bar/rectangle text path with real font-outline vector text. It does not change
renderer public APIs, examples, Blender tooling, or committed assets.

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

The script prefers a local Atkinson Hyperlegible font if it can find one, but it
does not commit or copy any font file. If Atkinson is not installed it falls back
to common system fonts such as Liberation Sans or DejaVu Sans. The parser handles
TrueType outlines directly (`cmap`, `loca`, `glyf`, `hhea`, `hmtx`, and legacy
`kern` format 0 where present), flattens quadratic curves, estimates triangle
counts, and compares against the current renderer-core mesh when the built
artifact is available.

## Findings To Record

- Outline parsing: local TTF outlines are enough for a real-font prototype without
  adding assets. OpenType CFF and GPOS shaping are outside this spike.
- Curve flattening: quadratic outlines flatten deterministically by tolerance.
  The benchmark reports raw contours, flattened vertices, and flatten tolerance.
- Triangulation: the prototype reports contour winding and a hole-aware
  requirement but only estimates triangles from flattened contours. Production
  should use a robust triangulator such as earcut/libtess/poly2tri rather than
  committing a fragile local tessellator.
- Kerning and proportional metrics: `hmtx` advances provide real proportional
  layout. Legacy `kern` pairs are read when available; modern GPOS kerning needs
  a shaping/parser dependency.
- Vertex counts: real outlines cost more vertices than the synthetic rectangles,
  but geometry is cacheable per glyph/font/size/tolerance. Text edits mostly churn
  layout records, not cached glyph outlines.
- Crispness: path text remains vector geometry and can be sharpened with normal
  MSAA/coverage strategy. It avoids the blocky 5x7 cell identity of the current
  synthetic path without introducing raster text.
- Dynamic churn: the benchmark reports per-frame glyph cache hits/misses and edit
  churn for short text mutations.

## API And Pruning Recommendation

Prune the inferior synthetic text path once a production outline pipeline exists.
The current synthetic path should remain only as a temporary compatibility
fallback because it encodes font policy in renderer-core:

- ASCII-only glyph support with unsupported-glyph substitution.
- Hand-written fake proportional metrics and kerning.
- Rectangle roles (`bar`, `stem`, `dot`, `fill`) that approximate letters instead
  of representing glyph outlines.
- Legacy 5x7 grid rectangles that duplicate and conflict with the newer contour
  mesh path.

The superior direction is a private renderer text asset pipeline:

1. Shape text with a real font source and real metrics.
2. Cache glyph outline geometry by font face, glyph id, size, and flattening
   tolerance.
3. Layout runs separately from glyph geometry so dynamic text edits reuse cached
   glyph meshes.
4. Triangulate flattened contours with a proven hole-aware library.
5. Keep raster text out unless there is a specific need for dense paragraph text,
   subpixel LCD text, emoji/color glyphs, or browser-font parity.

The next production step is to choose a font parser/shaper and triangulator
dependency. Without those dependencies, this directory should stay a research
prototype rather than growing into a public API.
