# Royal

Royal is a DOM-free renderer core with a thin React authoring layer for canvas
interface scenes. `@royal/react` exposes `<Canvas>` as the primary React API:
it owns the canvas element, renders one Royal scene, and lets React-only
controls live beside that scene.

`createRendererRoot(canvas)` is the lower-level host and testing escape hatch
for code that already owns a canvas and lowered renderer descriptors. App
examples and docs should start with `<Canvas>`.

Royal renderer APIs stop at renderer primitives. App-specific surface
descriptors, placement contracts, product panels, and event rows belong in
Patchpit/Opshop lab or example integration code, not in the product renderer
API.

glTF support is first-class. Optional and draft features should stay isolated
until they are useful through the public renderer and React APIs.

## SVG textures (experimental)

We also support `.svg` textures, with an experimental Garbo Succus GLTF extension.
This lets the renderer show perfect textures at any resolution.

Spec: [docs/GS_texture_svg.md](docs/GS_texture_svg.md)

Example: [apps/examples-react/src/examples/cases/GltfGhostscriptTigerSvg.tsx](apps/examples-react/src/examples/cases/GltfGhostscriptTigerSvg.tsx)

```json
{
  "extensionsUsed": ["GS_texture_svg"],
  "textures": [{
    "source": 0,
    "extensions": {
      "GS_texture_svg": { "source": 1 }
    }
  }],
  "images": [
    { "uri": "label-fallback.jpg", "mimeType": "image/jpeg" },
    { "uri": "label.svg", "mimeType": "image/svg+xml" }
  ]
}
```
