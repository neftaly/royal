# `GS_texture_svg` experimental glTF extension

Status: implemented Royal experiment; unregistered and not an ecosystem compatibility claim

Vendor prefix owner: Garbo Succus / future registered successor

## Purpose

`GS_texture_svg` allows a glTF texture to prefer an SVG image while retaining
an ordinary raster texture source as a standards-compatible fallback. It does
not make SVG a glTF scene node, geometry format, animation system, external
resource resolver, or virtual-texture format.

Until the prefix and extension are registered through the Khronos process,
assets MUST treat this as a private experimental extension. Royal MUST describe
it as an experimental Royal feature, not registered glTF compatibility.

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

When the extension is not listed in `extensionsRequired`, an aware consumer
SHOULD use the SVG source and MUST have a portable raster fallback. That
fallback may be the parent texture's valid core `source`, or a present
lower-priority ASTC, AVIF or WebP extension which is itself required. An
unaware consumer uses the core source or follows its ordinary
required-extension policy.

When the parent texture omits core `source` and supplies no required raster
extension fallback, the asset MUST list `GS_texture_svg` in both
`extensionsUsed` and `extensionsRequired`. An aware consumer that cannot use the
SVG MUST fail the texture/asset according to its required-extension policy; it
MUST NOT invent a raster fallback.

When every use has a portable fallback, the extension SHOULD appear only in
`extensionsUsed`. Listing it in `extensionsRequired` is allowed but deliberately
forfeits compatibility with unaware consumers; SVG failure is then an extension
failure rather than permission to settle on the fallback source.

The fallback and SVG images are alternate representations of one texture. They
inherit the parent texture's sampler, material-slot color interpretation, UV
set, and `KHR_texture_transform`. They MUST NOT be combined or loaded as two
independent material layers.

## Composing with native ASTC

The draft `EXT_texture_astc` extension can accompany `GS_texture_svg` on the
same texture. Keep PNG/JPEG in core `source` for portable optional use:

```json
{
  "extensionsUsed": ["GS_texture_svg", "EXT_texture_astc"],
  "images": [
    { "uri": "artwork.png" },
    { "uri": "artwork.svg", "mimeType": "image/svg+xml" },
    { "uri": "artwork-6x6.ktx2", "mimeType": "image/ktx2" }
  ],
  "textures": [{
    "source": 0,
    "extensions": {
      "GS_texture_svg": { "source": 1 },
      "EXT_texture_astc": { "source": 2 }
    }
  }]
}
```

Royal supports unsupercompressed ASTC LDR 6x6/8x8 KTX2 here. On supported
hardware, optional base-color SVG uses ASTC immediately without fetching PNG
or SVG. Unsupported hardware selects the portable raster before transport.
A native preview stays in its ordinary compressed GPU texture. Once demand
exceeds the coarsest vector level, SVG detail uses the existing RGBA VT pages;
publication switches only after vector coverage is ready. Small previews
reserve no VT atlas or page-table GPU storage. Vector failure leaves the native
preview visible, with a bounded diagnostic and no per-frame retry.

These are alternate representations, not mixed-format mips or simultaneous
material layers. SVG remains authoritative detail. `EXT_texture_astc` specifies
format selection; the preview schedule and SVG precedence are Royal's
experimental SVG contract, not an ecosystem-wide scheduling guarantee.

The [published ASTC draft](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_texture_astc/README.md)
requires ASTC-specific DFD metadata and a complete mip pyramid when using a
mipmapped sampler. Optional ASTC keeps core PNG/JPEG; required ASTC may omit it.
An unsupported required ASTC source settles as a texture error without fetching
the image or allocating compressed storage. These fetch savings apply to
external images; embedded images still travel with their GLB container.

## SVG content profile

The SVG MUST be self-contained. Scripts, event-handler behavior, navigation,
network subresources, external stylesheets/fonts, external `<use>` references,
DTD declarations, `xml:base` URI rewriting, timed animation/discard behavior,
and nested raster/SVG images are outside this version of the extension profile.
Producers MUST flatten those dependencies into ordinary SVG graphics.

Royal bounds the encoded SVG representation at 16 MiB before parsing. This is
an implementation admission ceiling, not a format recommendation or permission
to construct an unbounded decoded DOM.

This profile is a producer/consumer interoperability rule, not a sanitizer.
Consumers MUST treat SVG as untrusted input and choose an image-decoding
boundary appropriate to their platform. Royal's web implementation requires
the browser's SVG secure-static image processing mode: script, interaction,
animation, navigation, and external resource fetches cannot execute through the
texture decode. DOM parsing is used only for bounded structural validation and
viewport extraction; it is not a sanitizer. The decoded result must also pass
an origin-clean canvas readback probe before it can become VT page input. A
consumer MAY reject SVG it cannot process through an equivalent boundary. It
MUST NOT advertise a security guarantee based on regex rewriting. See the
[SVG 2 processing modes](https://www.w3.org/TR/SVG2/conform.html#processing-modes)
and [secure-static embedded-image rule](https://svgwg.org/svg2-draft/embedded.html).

## Dimensions and viewport

The SVG root MUST define a finite non-empty intrinsic viewport through either
positive unitless/`px` `width` and `height`, or a valid positive `viewBox`.
A `viewBox` alone is sufficient and its width/height become the logical texture
aspect and dimensions; it does not force that raster resolution. Percentage-only
or otherwise context-dependent intrinsic dimensions are invalid for this
extension. If both forms exist, ordinary SVG viewport/viewBox mapping applies.

Dimensions define aspect and logical sampling, not a mandatory raster
resolution. A consumer chooses raster resolution from projected coverage,
quality policy, hardware limits, and resource budgets. It MUST preserve the
complete SVG viewport; cropping or adding padding is not a legal decode fix.

## Color, alpha, and orientation

SVG paint is composited according to the consumer's SVG implementation, then
used with the same glTF material-slot color interpretation as the raster
fallback. Version 1 permits only sRGB color-texture uses: base color, emissive,
and other future slots explicitly defined as color data. A texture selected by
a linear/data slot such as normal, occlusion, metallic-roughness, transmission,
or thickness is invalid for this extension. This deliberate restriction avoids
claiming portable numeric texels from browser SVG paint and keeps the first
implementation out of material-data authoring policy.

Transparent SVG regions remain transparent and reveal the underlying material
factor or scene according to normal glTF texture multiplication/blending. A
consumer MUST NOT replace transparency with black or white during decode.

SVG and raster fallback MUST have the same visible orientation under the parent
texture sampler and UV transform. The extension defines no flip field.
The producer is responsible for equivalent aspect, framing, alpha, and intended
content between representations; a consumer is not required to compare their
pixels before progressive replacement.

## Loading and errors

The SVG is the preferred representation. Consumers MAY fetch the raster and SVG
in parallel, publish an already-available raster first, or attempt SVG first and
request the raster only if SVG fails. They MUST NOT be required to spend network,
decode, or retained-memory budget on both representations merely to implement
the extension. If a consumer progressively replaces a published raster with
SVG, the replacement is atomic and preserves orientation, alpha, aspect,
sampler, and logical texture identity.

Royal loads the selected raster first for optional base-color SVG textures.
The raster is fitted to a bounded preview, then retained as the coarsest VT
page while demanded SVG regions refine in the detail lane. Early external-image
discovery and material preparation MUST use the same logical recipe. The SVG
is read and validated lazily once per decoded source, without first decoding a
full SVG bitmap. Required SVG and non-base-color uses keep preferred-first
behavior; they MUST NOT silently settle on a preview that cannot refine.

The selected raster preference is supported ASTC LDR, AVIF, WebP, then core.
ASTC selection happens before read-ahead and transport. Retained CPU alpha
requires a raster alternative and therefore skips optional ASTC before fetching.
A failed
preview falls back to authoritative SVG decoding. A failed optional detail read
keeps preview coverage and records one bounded failure without per-frame retries.

For an optional extension, SVG transport/decode/profile failure produces one
bounded diagnostic and settles on the selected fallback. It MUST NOT retry
every frame. For a required extension, the same condition is a required texture
failure.

Resource budgets and cancellation apply to whichever representation jobs a
consumer actually starts. Once one representation wins, an unclaimed decoded
alternate MUST be releasable. A late completion from a stale asset generation
MUST NOT replace current content.

## Relationship to virtual texturing

`GS_texture_svg` selects source semantics only. It MUST NOT expose VT manifests,
page sizes, atlas policy, mip residency, or renderer capability decisions.

After ingestion, an implementation may represent the chosen SVG as an ordinary
raster texture or feed it through its always-enabled automatic-VT policy. Both paths
must share the same SVG normalization, identity, color, alpha, orientation,
fallback, cancellation, and failure semantics. An authored Royal VT manifest is
not valid as `GS_texture_svg.source`.

## Relationship to plain SVG ingestion

Royal also accepts an SVG URI in a core glTF image as a Royal-specific
ingestion convenience. That path is not standards-compatible because unaware
glTF consumers need not accept SVG as a core image.

Both forms lower to the same canonical SVG source after validation. The
extension form is preferred for distributable assets because it can carry a
raster fallback. The extension does not create a second rasterizer, VT path,
cache identity, sampler, material path, or shader variant.

## Registration work

Before proposing registration, the extension needs:

- an assigned vendor prefix and public product/project association;
- JSON schema and generated schema tests;
- at least one fallback and one required sample asset;
- two independent consumer/producer experiments if requested by Khronos;
- documented security considerations and SVG profile;
- evidence that secure-static decoding, fallback, orientation, transparency,
  and close-view vector paging agree in the target browsers.

Registration mechanics and naming may require changing `GS_texture_svg`. The
semantic contract should survive that rename.

## Reviewed decisions and implementation gate

- Positive `viewBox` alone is sufficient; unitless/`px` intrinsic sizes remain
  the only accepted alternative.
- Version 1 is restricted to sRGB color slots. Data-texture use can be proposed
  later only with cross-browser numeric-pixel oracles.
- Fallback scheduling is consumer policy. Royal chooses preferred-first rather
  than unconditional duplicate work.
- Pixel/content equivalence metadata remains an authoring or asset-manifest
  concern outside glTF. The extension declares alternate intent, not a checksum
  proof of visual equivalence.

Royal implements one canonical source recipe per representation use, shared
by early discovery and material preparation. Optional base-color textures use
a raster preview plus lazy validated SVG detail; required and emissive uses
retain the direct SVG path. The ordinary and VT owners share decoded leases,
source cancellation, samplers, and material bindings. Preview leases remain
bounded and survive context restoration until their final claim is released.

Unit tests cover preview-first decode, delayed/shared vector reads, failed preview
recovery, cancellation, optional and required lowering, MIME/placement/data-slot
rejection, preferred success without fallback fetch, preferred failure with one
fallback fetch, worker transfer, identity, and status diagnostics. Historical exact-build
hardware-browser oracles cover the original Ghostscript Tiger SVG, a required
data-URI SVG, and a forced SVG transport failure that reaches `ready` through
the raster fallback with one reported fallback. The current preview path has Chromium software-WebGL probes for held SVG
reads, pixel-identical failure fallback, disposal, and restoration; new physical
latency evidence is still required. Remaining registration gates are the assigned vendor prefix, published JSON schema, independent consumer or
producer evidence, and target-device close-view/orientation proof. Until those
exist, `GS_texture_svg` remains an explicitly experimental Royal extension.
