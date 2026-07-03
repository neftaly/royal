# Royal

Royal is a WebGL2 renderer, with a react-[regl](https://github.com/regl-project/regl)-fiber renderer (should also work with solid etc). It targets Quest 2 XR and Safari 17 (iPad gen 6 A10+ 2018).

GLTF support is first-class. We try to support optional and draft features in a really [Metaverse Standards Forum-pilled](https://www.youtube.com/watch?v=Aj4kUpF9H0I) way.

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
