# Pathfinder SVG Loading Prototype

Date: 2026-06-28

This directory is a research-only prototype for SVG-to-2D-path extraction. It
does not touch renderer packages, examples, public exports, package configs, or
the current React package rename worktree.

Run:

```sh
node --expose-gc research/pathfinder-svg/svg-path-prototype.mjs
```

Dump the normalized API output:

```sh
node research/pathfinder-svg/svg-path-prototype.mjs --dump --flatten --simplify collinear --packed
```

Use another SVG:

```sh
node --expose-gc research/pathfinder-svg/svg-path-prototype.mjs --svg /path/to/file.svg --iterations 500
```

## What Was Inspected

Upstream Pathfinder references:

- `https://github.com/servo/pathfinder`
- `https://github.com/servo/pathfinder/blob/main/svg/Cargo.toml`
- `https://github.com/servo/pathfinder/blob/main/svg/src/lib.rs`

Pathfinder 3 is a GPU rasterizer for fonts/vector graphics using OpenGL,
WebGL2, and Metal. Its README says it is incomplete and under heavy
development. The SVG support is a simple loader for rendering SVG workloads.

The current `pathfinder_svg` crate:

- Is named `pathfinder_svg`, version `0.5.0`.
- Depends on `usvg = "0.9"`.
- Also depends on `pathfinder_content`, `pathfinder_geometry`,
  `pathfinder_renderer`, and `pathfinder_simd`.
- Converts `usvg::PathSegment` values into Pathfinder `Segment`s and pushes
  them into a Pathfinder `Scene`.
- Expands strokes into filled outlines and maps paints/gradients for rendering.

That means Pathfinder is not the cleanest parser/extractor dependency for a
Royal SVG asset pipeline. The parser path is `usvg`/`resvg`; Pathfinder is
useful as renderer/reference code for segment conversion, stroke expansion, and
rendering behavior.

## Prototype API

The script exports:

```js
parseSvgToPaths(svg, options) -> { viewBox, paths, warnings, stats }
```

Options:

| Option | Purpose |
| --- | --- |
| `curveMode: "retain" \| "flatten"` | Keep cubic/quadratic curves or emit lines. |
| `flattenTolerance` | Curve flattening tolerance in SVG units. |
| `transformFlattening` | Apply element/group transforms to command coordinates. |
| `styleExtraction` | Include fill, stroke, stroke width, opacity, fill rule, joins, caps, dashes. |
| `simplify: "none" \| "dedupe" \| "collinear"` | Remove duplicate and optionally collinear line points. |
| `simplifyTolerance` | Geometric tolerance for simplification. |
| `quantize` | Round coordinates to a grid before packed output. |
| `packed` | Return transferable typed arrays instead of command object arrays. |

Normalized command shape:

```js
{ op: "M", x, y }
{ op: "L", x, y }
{ op: "Q", x1, y1, x, y }
{ op: "C", x1, y1, x2, y2, x, y }
{ op: "Z" }
```

Packed output shape:

```js
{
  paths: [{ id, commandOffset, commandCount, coordOffset, coordCount, ...style }],
  packed: {
    opcodes: Uint8Array,
    coords: Float32Array,
    pathRanges: Uint32Array
  }
}
```

Command codes are `M=0`, `L=1`, `Q=2`, `C=3`, `Z=4`. Coordinates are variable
length by command, which avoids padding and transfers cleanly to workers.

## Benchmark Coverage

The harness reports:

- Parse/extract time across repeated iterations.
- Output path count, command count, coordinate scalar count.
- Serialized JSON bytes.
- Packed typed-array bytes.
- Heap delta and per-iteration heap delta.
- Process resource usage.
- Flattening/simplification/packing stage timings.
- Worker round-trip transfer for typed-array output.

The bundled fixture is intentionally tiny and locally authored. It exercises:

- `viewBox`
- groups
- presentation styles
- path cubic curves
- rounded rect conversion
- polyline conversion
- nested transforms
- fill/stroke metadata

## Tiger Fixture

The Ghostscript tiger SVG was not vendored in this pass. The clear reference for
the later demo page is Wikimedia Commons:

- `https://commons.wikimedia.org/wiki/File:Ghostscript_Tiger.svg`
- Original file size listed there: 67 KB.
- Source listed there: derived from `tiger.eps` from GPL Ghostscript SVN.
- License listed there: GNU AGPL v3 or later.

That source and license are compatible with this AGPL repository, but the later
demo page should vendor it in a separate patch with an attribution comment or
sidecar note. This prototype uses `fixtures/tiny-scene.svg` to keep benchmark
noise and review scope small.

## Recommendation

Use modern `usvg`/`resvg` as the product SVG parser and normalizer. Build a
small Rust/WASM module around `usvg` that emits Royal's path representation and
optionally packed typed arrays.

Do not base the product extraction API on `pathfinder_svg` unless the goal
changes to rendering through Pathfinder. It pulls renderer/content dependencies,
uses an old `usvg`, expands into Pathfinder scene objects, and does not expose
the clean `{ viewBox, paths, warnings, stats }` shape Royal needs.

Keep Pathfinder in the research trail as:

- A reference for `usvg` path segment conversion.
- A reference for unsupported SVG feature warnings.
- A renderer comparison point if Royal later wants GPU SVG rasterization rather
  than path asset extraction.

## Non-Prototype Next Step

Use `WASM-SCAFFOLD.md` as the starting point for a small `usvg`-based WASM
crate. Land it separately from this research pass, with real dependency wiring,
fixtures including Ghostscript tiger, and renderer/demo integration only after
the asset output format is stable.
