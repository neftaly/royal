# `GS_texture_svg` glTF extension proposal

Status: design proposal; unregistered and not currently implemented by Royal

Vendor prefix owner: Garbo Succus / future registered successor

## Purpose

`GS_texture_svg` allows a glTF texture to prefer an SVG image while retaining
an ordinary raster texture source as a standards-compatible fallback. It does
not make SVG a glTF scene node, geometry format, animation system, external
resource resolver, or virtual-texture format.

Until the prefix and extension are registered through the Khronos process,
assets MUST treat this as a private experimental extension. Royal MUST NOT list
it as supported glTF compatibility in a release merely because this proposal
exists.

## Extension location and shape

The extension is attached to a glTF `texture` and contains exactly one field:

```json
{
  "textures": [
    {
      "source": 0,
      "extensions": {
        "GS_texture_svg": {
          "source": 1
        }
      }
    }
  ],
  "images": [
    {
      "uri": "label-fallback.png"
    },
    {
      "uri": "label.svg",
      "mimeType": "image/svg+xml"
    }
  ],
  "extensionsUsed": ["GS_texture_svg"]
}
```

Semantic shape:

```ts
interface GsTextureSvg {
  source: integer; // index into the root images array
}
```

`source` MUST be a non-negative in-range image index. The extension schema
SHOULD follow current glTF extension conventions for `extensions`, `extras`, and
forward-compatible additional properties; `source` is its only semantic field
in this version. Consumers ignore unknown optional properties rather than
treating a future compatible producer as malformed.

The referenced image MUST resolve to SVG bytes. A buffer-view image MUST declare
`mimeType: "image/svg+xml"`; a URI image MAY omit `mimeType`, but when present it
MUST equal `image/svg+xml`.

The extension expands the allowed MIME type of images referenced specifically
by `GS_texture_svg`. It does not make `image/svg+xml` a valid core image for
unaware consumers.

## Fallback and required-extension rules

When the parent texture has a valid core `source` and the extension is not
listed in `extensionsRequired`, an aware consumer SHOULD use the SVG source and
MUST use the core source if SVG decode, validation, or capability fails. An
unaware glTF consumer sees only the raster core source.

When the parent texture omits core `source`, the asset MUST list
`GS_texture_svg` in both `extensionsUsed` and `extensionsRequired`. An aware
consumer that cannot use the SVG MUST fail the texture/asset according to its
required-extension policy; it MUST NOT invent a raster fallback.

When every use has a core fallback, the extension SHOULD appear only in
`extensionsUsed`. Listing it in `extensionsRequired` is allowed but deliberately
forfeits compatibility with unaware consumers; SVG failure is then an extension
failure rather than permission to settle on the core source.

The fallback and SVG images are alternate representations of one texture. They
inherit the parent texture's sampler, material-slot color interpretation, UV
set, and `KHR_texture_transform`. They MUST NOT be combined or loaded as two
independent material layers.

## SVG content profile

The SVG MUST be self-contained. Scripts, event-handler behavior, navigation,
network subresources, external stylesheets/fonts, external `<use>` references,
and nested external raster/SVG images are outside this extension profile.
Producers MUST flatten or embed dependencies.

This profile is a producer/consumer interoperability rule, not a sanitizer.
Consumers MUST treat SVG as untrusted active-format input and choose an
execution boundary appropriate to their platform. A consumer MAY reject SVG it
cannot prove or decode as self-contained. It MUST NOT advertise a security
guarantee based on regex rewriting.

## Dimensions and viewport

The SVG root MUST define a finite non-empty intrinsic viewport through either
positive `width`/`height` or a valid positive `viewBox`. Percentage-only or
otherwise context-dependent intrinsic dimensions are invalid for this
extension. If both forms exist, ordinary SVG viewport/viewBox mapping applies.

Dimensions define aspect and logical sampling, not a mandatory raster
resolution. A consumer chooses raster resolution from projected coverage,
quality policy, hardware limits, and resource budgets. It MUST preserve the
complete SVG viewport; cropping or adding padding is not a legal decode fix.

## Color, alpha, and orientation

SVG paint is composited according to the consumer's SVG implementation, then
used with the same glTF material-slot color interpretation as the raster
fallback. Base-color/emissive uses undergo their normal sRGB-to-linear handling;
data-texture uses follow the same rules as an equivalent raster texture.

Transparent SVG regions remain transparent and reveal the underlying material
factor or scene according to normal glTF texture multiplication/blending. A
consumer MUST NOT replace transparency with black or white during decode.

SVG and raster fallback MUST have the same visible orientation under the parent
texture sampler and UV transform. The extension defines no flip field.
The producer is responsible for equivalent aspect, framing, alpha, and intended
content between representations; a consumer is not required to compare their
pixels before progressive replacement.

## Loading and errors

Consumers SHOULD begin with the core raster source when it becomes drawable
earlier, then replace it atomically with the SVG representation when ready.
This progressive behavior MUST preserve orientation, alpha, aspect, sampler,
and logical texture identity.

For an optional extension, SVG transport/decode/profile failure produces one
bounded diagnostic and settles on the core fallback. It MUST NOT retry every
frame. For a required extension, the same condition is a required texture
failure.

Resource budgets and cancellation apply independently to the two representation
jobs, but once SVG wins, an unclaimed decoded fallback SHOULD be releasable. A
late SVG completion from a stale asset generation MUST NOT replace current
content.

## Relationship to virtual texturing

`GS_texture_svg` selects source semantics only. It MUST NOT expose VT manifests,
page sizes, atlas policy, mip residency, or renderer capability decisions.

After ingestion, an implementation may represent the chosen SVG as an ordinary
raster texture or feed it through its ordinary automatic-VT policy. Both paths
must share the same SVG normalization, identity, color, alpha, orientation,
fallback, cancellation, and failure semantics. An authored Royal VT manifest is
not valid as `GS_texture_svg.source`.

## Relationship to plain SVG ingestion

Royal currently accepts an SVG URI in a core glTF image as a Royal-specific
ingestion convenience. That path is not standards-compatible because unaware
glTF consumers need not accept SVG as a core image.

If `GS_texture_svg` is implemented, both forms MUST lower to the same canonical
SVG source after validation. The extension form is preferred for distributable
assets because it can carry a raster fallback. Supporting the extension MUST
not create a second rasterizer, VT path, cache identity, or shader variant.

## Registration work

Before proposing registration, the extension needs:

- an assigned vendor prefix and public product/project association;
- JSON schema and generated schema tests;
- at least one fallback and one required sample asset;
- two independent consumer/producer experiments if requested by Khronos;
- documented security considerations and SVG profile;
- a decision on whether SVG data-texture use is permitted or should be
  restricted because browser color-management makes it non-portable.

Registration mechanics and naming may require changing `GS_texture_svg`. The
semantic contract should survive that rename.

## Open decisions

- Should the profile require explicit pixel or CSS absolute units on
  `width`/`height`, or is a positive `viewBox` alone sufficient?
- Should data-texture material slots be forbidden to avoid browser SVG color
  ambiguity?
- Should consumers be required to fetch the raster fallback first, or may they
  race representations under their own scheduling policy?
- Should a future extension define content-equivalence metadata, or should that
  remain an engine/asset-manifest concern outside glTF?
