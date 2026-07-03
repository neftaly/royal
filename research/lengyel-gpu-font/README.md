# Lengyel GPU Font Research

This is an isolated research/prototype record for Eric Lengyel's 2017 JCGT
paper, "GPU-Centered Font Rendering Directly from Glyph Outlines." It does not
change Royal's production renderer.

## Decision

Apply later, not now.

The method is relevant to Royal because it targets crisp text under arbitrary 3D
transforms by rendering glyph boxes in the GPU shader directly from quadratic
outline data. Royal already parses real font data and builds vector text, so the
source information is nearby. However, the current renderer path lowers text to
flattened outline meshes and draws those meshes through the normal unlit surface
program. A Lengyel path would require a separate text program, per-font curve and
band textures, glyph-quad geometry, and cache/resource lifetime policy.

This should be revisited when Royal needs high quality dynamic world-space text,
large zoom ranges, or lower CPU triangulation churn. It should not replace the
current mesh path until there is a text backend abstraction and a font asset
preprocessor/cache.

## Primary Sources

- Paper: Eric Lengyel, "GPU-Centered Font Rendering Directly from Glyph
  Outlines", JCGT 6(2), 2017:
  https://jcgt.org/published/0006/02/02/
- PDF used for algorithm details:
  https://jcgt.org/published/0006/02/02/paper.pdf
- The paper's supplemental index says `GlyphShader.glsl` contains the pixel
  shader, but this prototype does not copy that shader.
- OpenType `glyf` table reference:
  https://learn.microsoft.com/en-us/typography/opentype/spec/glyf
- TrueType fundamentals winding-rule reference:
  https://learn.microsoft.com/en-us/typography/opentype/spec/ttch01

## Method Summary

Lengyel renders each glyph as a bounding quad or clipped polygon. The fragment
shader receives the pixel position in em-square coordinates, finds the relevant
horizontal and vertical bands for the glyph, and accumulates coverage from the
quadratic Bezier curves in those bands.

The robustness trick is the paper's eight-class table for quadratic winding. For
a ray translated so the pixel center is the origin, the shader classifies only
whether each of `y1`, `y2`, and `y3` is positive. That gives a two-bit root
contribution code from the lookup table `0x2E74`. The shader still evaluates the
roots to test whether their `x` intersection is on the ray, but it does not make
precision-sensitive endpoint range decisions.

For speed, each glyph is preprocessed into:

- a curve texture holding quadratic control points;
- a band texture holding per-band curve lists;
- per-glyph parameters identifying the band table, band scale/offset, and
  maximum band indexes.

## Royal Pipeline Fit

Current relevant code:

- `packages/renderer-core/src/text/font.ts` parses font data with `opentype.js`
  and stores the parsed font in a `WeakMap`.
- `packages/renderer-core/src/text/shaping.ts` maps code points to font glyphs,
  applies simple kerning, and records `fontGlyphIndex`.
- `packages/renderer-core/src/text/layout.ts` places those shaped glyphs into
  lines.
- `packages/renderer-core/src/text/mesh.ts` reads glyph path commands, flattens
  quadratic and cubic commands to points, finds contour holes, and triangulates
  them with `earcut`.
- `packages/renderer-webgl/src/root.ts` calls `textMesh(node)`, uploads
  positions and glyph-local UVs, and draws text as an unlit triangle mesh.
- `packages/renderer-webgl/src/webgl/shaders.ts` has surface, virtual-texture,
  instanced-surface, and wireframe programs only. There is no text coverage
  shader or integer/half-float font-data texture path.

The main impedance mismatch is that Royal discards curve identity during
`textMesh(...)`. Lengyel's method needs explicit quadratic curves and band lists,
not flattened vertices. It also assumes TrueType quadratic outlines. Royal's
current `opentype.js` path can expose cubic commands too, and the existing mesh
path already handles cubic flattening. A production implementation would need a
fallback or conversion policy for non-TrueType/CFF-style outlines.

## Prototype

`winding.ts` implements:

- the `0x2E74` quadratic winding lookup table;
- class/shift-code helpers matching the paper's Table 1 and Equation 2;
- a small horizontal-ray winding evaluator for quadratic curves;
- a uniform band-table builder that produces positive and negative curve orders
  shaped like the paper's band preprocessing.

`winding.test.ts` covers:

- the eight table classes and root-contribution bits;
- simple nonzero-winding classification for a square outline;
- cancellation of a tangent endpoint case without a special endpoint branch;
- positive and negative sorting for a two-band table.

Run:

```sh
pnpm exec vitest run --config vite.config.ts research/lengyel-gpu-font/winding.test.ts
```

## Production Follow-Up

If this becomes a renderer feature, keep it behind a separate text backend:

1. Add a font preprocessing layer that expands glyph outlines to quadratic
   curves, preserving glyph and contour identity before flattening.
2. Generate curve and band data as renderer-owned texture resources.
3. Add a WebGL text program kind with glyph params, band params, curve texture,
   and band texture bindings.
4. Draw one quad or clipped polygon per visible glyph instead of the current
   triangulated glyph mesh.
5. Keep the current mesh text backend as a compatibility fallback for cubic
   outlines, unsupported WebGL texture formats, and small or rarely scaled text.
