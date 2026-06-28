# SVG Path Backend Slots

Date: 2026-06-28

This prototype treats SVG loading as a backend adapter plus shared output
stages. A backend should emit a neutral scene:

```ts
{
  viewBox: { x: number, y: number, width: number, height: number },
  items: [
    {
      id?: string,
      source: "path" | "rect" | "circle" | "ellipse" | "line" | "polyline" | "polygon",
      transform: [number, number, number, number, number, number],
      style: Record<string, string>,
      commands: RoyalPathCommand[]
    }
  ],
  warnings: SvgWarning[]
}
```

The shared pipeline owns transform flattening, style projection, curve
flattening, simplification, quantization, packing, and stats. That keeps the
product API independent from any one parser or renderer.

## Slots

| Backend | Harness status | Intended use |
| --- | --- | --- |
| `custom-js` | Runnable now | Dependency-free baseline for API shape, tiny fixtures, stage metrics, and worker transfer tests. |
| `usvg-wasm` | Planned | Preferred production parser/normalizer once Rust/WASM tooling is available locally. |
| `pathfinder-svg` | Evaluation slot | Renderer/reference comparison only unless Royal decides to use Pathfinder scenes directly. |
| `lyon` | Evaluation slot | Geometry, flattening, and stroke expansion candidate behind the same normalized command API. |
| `canvaskit` | Evaluation slot | Skia/CanvasKit extraction or validation path if a vendored runtime is acceptable. |
| `browser-dom` | Evaluation slot | Browser-native comparison backend for DOMParser/SVGGeometryElement support and compatibility checks. |

Run available slots:

```sh
node research/pathfinder-svg/svg-path-prototype.mjs --list-backends
```

Run the current backend:

```sh
node --expose-gc research/pathfinder-svg/svg-path-prototype.mjs --backend custom-js --bench
```

## Adapter Contract

Backend adapters should avoid product policy. They should report source features
and warnings, then let shared stages decide:

- whether transforms are flattened into coordinates
- whether curves are retained or flattened
- simplification tolerance and mode
- quantization grid
- JSON object output versus packed typed arrays

This is the boundary to keep when adding `usvg-wasm` or comparison adapters.
