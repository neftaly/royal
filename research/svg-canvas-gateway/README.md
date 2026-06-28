# SVG Canvas Gateway Research

Date: 2026-06-28

This is a self-contained prototype for using browser canvas as the gateway for
SVG rasterization/texture generation while keeping hit testing and dragging on
explicit geometry. It does not change public Royal APIs, package exports, root
configs, or app code.

Run the DOM-free geometry benchmark:

```sh
node research/svg-canvas-gateway/hit-region-bench.mjs
node research/svg-canvas-gateway/hit-region-bench.mjs --json
```

Open the browser demo directly:

```sh
xdg-open research/svg-canvas-gateway/demo.html
```

## Fixture

- `fixtures/star.svg`: authored star SVG used as the raster texture source.
- `fixtures/star-geometry.json`: matching star polygon used for geometry,
  hit testing, and drag acceptance.

The point of the split is intentional: the SVG can produce a rectangular canvas
texture, but the interactive region is the star polygon. A pointer in the
transparent/empty part of the texture rectangle must miss.

## Browser Texture Gateway

The browser-oriented pipeline in `gateway.mjs` is:

```txt
svg text or SVGElement
  -> Blob
  -> Blob URL or data URL
  -> ImageBitmap or HTMLImageElement
  -> canvas drawImage(...)
  -> ImageData / renderer texture upload source
```

`createSvgTextureSource` returns a canvas-backed texture source with
`renderToCanvas()` and `toImageData()`. A renderer adapter could consume that
canvas, `ImageBitmap`, or `ImageData` depending on the backend upload path.

## Geometry And Picking

`geometry.mjs` provides:

```js
createPathHitRegion({ contours, fillRule, boundaryMode })
simulateDragSequence({ hitRegion, startPointer, moves })
createGeometryDragController({ hitRegion, position, worldBounds })
```

The prototype treats boundary points as hits by default. Concave notches are
handled by polygon classification instead of AABB checks. Holes are represented
as additional contours with `role: "hole"`; future multi-contour assets should
keep texture contours, render order, fill rule, and hit policy explicit rather
than deriving interaction from the raster rectangle.

## API Sketch

Keep texture and geometry separate in the product API:

```js
const texture = createSvgTextureSource({
  id: 'gold-star',
  svg,
  width: 256,
  height: 256,
});

const hitRegion = createPathHitRegion({
  contours: starGeometry.contours,
  fillRule: 'nonzero',
});

const star = sprite({
  texture,
  geometry: starGeometry,
  hitRegion,
});
```

Recommended product shape:

- `CanvasTextureSource`: a browser/canvas-generated texture source abstraction
  with `{ id, kind, width, height, cacheKey, renderToCanvas, toImageData }`.
- `createSvgTextureSource`: SVG-specific producer for that source.
- `createRasterTextTextureSource`: canvas-raster text producer for the same
  source shape.
- `TextureCache`: keyed by source cache key, device scale, color mode, and
  renderer upload format.
- `PathHitRegion`: geometry-only interaction surface, independent of texture.
- `sprite({ texture, geometry, hitRegion })`: renderer object that composes the
  three contracts without making texture bounds interactive by default.

This same abstraction covers the new raster-font direction: canvas-generated
text and SVGs are both texture producers. Their hit regions should still come
from explicit geometry such as text layout boxes, glyph outlines, signed
distance masks, or product-defined selection regions.

## Benchmark Results

Measured with:

```sh
node research/svg-canvas-gateway/hit-region-bench.mjs --json
```

Result from this workspace:

```txt
fixture: fixture-star-five-point
correctness cases: 11
deterministic pointer fuzz: 200000 points, 104.722 ms, 1909812 points/sec
1px grid over geometry AABB: 40779 points, 41.366 ms, 985806 points/sec
false-positive prevention: 26812 of 40779 AABB grid points rejected (65.75%)
texture memory: 256 KiB for 256x256 RGBA8
```

The false-positive count is the useful signal: those points are inside the
texture rectangle/AABB but outside the star polygon, so rectangle-based picking
would incorrectly start hovers or drags there.

Memory note: the star geometry is a 10-point polygon plus small object overhead.
A 256x256 RGBA8 canvas texture is 262,144 bytes before renderer/backend copies,
so texture cache policy matters more than the hit-region geometry for this
class of asset.

## Recommendation

Use canvas as the browser rasterization bridge for authored SVGs and
canvas-raster text, then upload the resulting canvas/image data through the
renderer texture path. Do not use the raster bounds as the interactive shape.

Make explicit geometry mandatory for non-rectangular SVG sprites. If no
geometry is supplied, default to conservative rectangle picking only for assets
that opt into rectangular interaction.
