# GS_texture_svg

Status: Beta Garbo Succus vendor extension.

Royal treats this as a supported beta feature in the WebGL renderer: product
examples may use it, validation and regression tests cover the current
behavior, and assets should include a core raster fallback. The extension name
and exact fallback rules are not yet a stable ecosystem compatibility promise.
Royal normalizes only finite root image dimensions, then passes the SVG to the
browser's non-document image decoder. It does not parse or sanitize active
content and does not resolve nested external resources.

## Extension Name

`GS_texture_svg`

## Dependencies

glTF 2.0.

The referenced image data uses the `image/svg+xml` media type.

## Overview

`GS_texture_svg` adds an SVG image source to a glTF texture object.

The extension object is stored on `textures[i].extensions.GS_texture_svg` and
contains a required `source` property. The property indexes `images[]`, and the
referenced image MUST contain SVG data.

Implementations that support this extension MUST use the SVG source when the
extension is present on a texture. The SVG source has priority over
core `texture.source`.

`GS_texture_svg` is an optional extension by design. Assets MUST list it in
top-level `extensionsUsed` and MUST NOT list it in `extensionsRequired`.

Every texture that uses `extensions.GS_texture_svg` MUST provide exactly one
compatibility fallback through core `texture.source`. That fallback MUST be a
non-SVG image source. Additional texture-source fallbacks such as
`KHR_texture_basisu` or `EXT_texture_webp` MUST NOT be attached to the same
texture.

Implementations MUST NOT fall back to another source after selecting the SVG
source. SVG load, validation, or rasterization failure is an asset failure for
that implementation.

## Schema

The extension is added to texture objects.

```json
{
  "asset": {
    "version": "2.0"
  },
  "extensionsUsed": [
    "GS_texture_svg"
  ],
  "textures": [
    {
      "source": 0,
      "sampler": 0,
      "extensions": {
        "GS_texture_svg": {
          "source": 1
        }
      }
    }
  ],
  "images": [
    {
      "uri": "label-fallback.jpg",
      "mimeType": "image/jpeg"
    },
    {
      "uri": "label.svg",
      "mimeType": "image/svg+xml"
    }
  ]
}
```

### `texture.extensions.GS_texture_svg`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `source` | `integer` | Yes | Index of the `images[]` entry containing SVG data. |

No other extension properties are defined.

## Validation

- A glTF asset that uses `GS_texture_svg` MUST list it in `extensionsUsed`.
- A glTF asset that uses `GS_texture_svg` MUST NOT list it in
  `extensionsRequired`.
- Each texture object with `extensions.GS_texture_svg` MUST include a core
  `texture.source` fallback.
- The core fallback image MUST be a non-SVG image.
- Each texture object with `extensions.GS_texture_svg` MUST NOT include
  another texture-source fallback extension such as `KHR_texture_basisu` or
  `EXT_texture_webp`.
- `extensions.GS_texture_svg.source` MUST be a non-negative integer and MUST
  reference an existing `images[]` entry.
- The referenced image MUST provide either `uri` or `bufferView`.
- If the referenced image uses `bufferView`, `image.mimeType` MUST be
  `image/svg+xml`.
- If the referenced image uses a data URI, the data URI media type MUST be
  `image/svg+xml`.
- If the referenced image uses an external URI and `image.mimeType` is present,
  `image.mimeType` MUST be `image/svg+xml`.
- If the referenced image uses an external URI and `image.mimeType` is absent,
  the URI SHOULD end in `.svg`. Compressed `.svgz` is not part of this extension.

## Source Selection

For a texture with `GS_texture_svg`, an implementation that supports this
extension MUST select the SVG source. Implementations that do not support this
extension can ignore it and use the core `texture.source` fallback.

## SVG Processing

SVG textures are image sources, not geometry. Implementations MUST map the
rasterized SVG to the texture domain as a rectangle. Implementations MUST NOT
infer mesh, picking, or triangle geometry from SVG paths, polygons, or shapes.

The SVG MUST define a deterministic texture rectangle. A finite `viewBox` is
valid. If `viewBox` is absent, finite `width` and `height` attributes are
required. If neither a finite `viewBox` nor finite `width` and `height` are
available, implementations MUST reject the SVG image.

Dimensionless SVG can be conforming SVG, but it is not valid input for
`GS_texture_svg`.

Implementations MAY normalize an SVG that has a finite `viewBox` but no finite
`width` and `height` by adding image decode dimensions equal to the `viewBox`
width and height before rasterization.

## External SVG Resources

SVG image documents MAY reference other image resources using SVG mechanisms
such as `<image href="...">` and `xlink:href`.

Implementations MUST support relative references inside an SVG texture. Relative
references MUST resolve against the SVG image document URI. If the SVG texture is
provided by a glTF `bufferView` or data URI, relative references MUST resolve
against the parent glTF asset URI.

Implementations that transform SVG text before rasterization, such as adding
decode dimensions, MUST preserve that base URI. Injecting `xml:base` on the root
`<svg>` element or rewriting relative references to absolute references are both
valid strategies.

If the implementation's SVG rasterizer runs in a mode that disables external
references, the implementation MUST resolve supported SVG image references before
rasterization. Replacing referenced raster images with `data:` URLs or replacing
referenced SVG images with equivalent inline SVG content are valid strategies.

## Rasterization And LOD

The extension defines no author-controlled raster size or LOD properties.

Implementations SHOULD choose raster dimensions from runtime texture use,
sampler minification mode, device limits, projected screen density, and
implementation quality policy.

If the sampler uses mipmap filtering, implementations SHOULD provide a complete
mip chain. Implementations MAY rasterize individual mip levels from the SVG
source or rasterize a base level and downsample.

Implementations MAY cache multiple raster levels for the same SVG source and
sampler state. Implementations MAY cap raster dimensions to device limits and
SHOULD expose diagnostics when caps can affect visual quality.

## Security

SVG data MUST be treated as untrusted asset data.

Implementations MUST NOT allow script execution during SVG decode or
rasterization. Rewriting selected elements or attributes is not a sufficient
security boundary and implementations MUST NOT describe such rewriting as
sanitization. SVG bytes SHOULD be decoded as an image rather than inserted into
a document DOM.

SVG sources for this extension MUST be self-contained. Fragment references
within the same SVG are allowed; runtime fetching of relative or absolute
resources, `xml:base` processing, dependency cycles, and nested SVG resolution
are outside this extension. Authoring pipelines should flatten or embed those
resources and retain the core raster fallback for incompatible decoders.

Royal preserves source content other than finite root `width`/`height`
normalization and decodes a renderer-created Blob URL through `Image`. It does
not issue fetches for URLs found inside the SVG text.

## JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-04/schema",
  "title": "GS_texture_svg texture extension",
  "type": "object",
  "description": "Garbo Succus SVG texture source extension.",
  "allOf": [
    { "$ref": "glTFProperty.schema.json" }
  ],
  "properties": {
    "source": {
      "$ref": "glTFid.schema.json",
      "description": "The index of the image containing SVG data."
    },
    "extensions": {},
    "extras": {}
  },
  "required": [
    "source"
  ]
}
```
