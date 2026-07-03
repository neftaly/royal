# glTF Kitchen Sink SVG fixtures

These are local Royal examples-app benchmark fixtures. They are Khronos/glTF
conformance flavored in structure, but are not copied from Khronos sample assets.

`svg-material-grid.gltf` renders six textured quads with `GS_texture_svg`
base-color sources and embedded PNG fallback images. The SVGs are intentionally
small, deterministic stress assets:

- `khronos-grid.svg`: grid, axes, gradients, and marker shapes.
- `khronos-rings.svg`: repeated strokes and translucent rings.
- `khronos-mask.svg`: mask and gradient composition.
- `khronos-symbols.svg`: nested symbols and repeated uses.
- `khronos-text.svg`: text, strokes, and alignment.
- `khronos-filter.svg`: filter primitive coverage with a conservative shadow.

All files in this folder are generated test assets for the examples app.
