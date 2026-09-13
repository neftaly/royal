# Explicit native previews for full raster textures

Status: private Royal loading metadata, not a registered glTF extension.

`EXT_texture_astc` alone remains a final texture alternative. Royal does not
infer preview intent from dimensions or fetch a higher-resolution PNG merely
because one is present. To declare ASTC as a temporary low-resolution preview,
keep the full raster source and add this metadata to the texture:

```json
{
  "images": [
    { "uri": "full.png", "mimeType": "image/png" },
    { "uri": "preview.ktx2", "mimeType": "image/ktx2" }
  ],
  "textures": [{
    "source": 0,
    "extensions": { "EXT_texture_astc": { "source": 1 } },
    "extras": { "royal": { "astcPreview": { "width": 512, "height": 512 } } }
  }],
  "extensionsUsed": ["EXT_texture_astc"]
}
```

The width and height MUST describe the full raster's intrinsic pixel dimensions,
using positive integers no greater than 16384. They are logical sampling
coordinates, not the dimensions of the ASTC upload. Required WebP or AVIF can
provide the full source instead of core PNG/JPEG. ASTC MUST remain optional;
this raster hint cannot accompany `GS_texture_svg`. Consumers unaware of the
metadata retain ordinary core/ASTC source selection. It does not standardize
progressive refinement outside Royal.
An ASTC-capable consumer that ignores the Royal metadata may therefore keep the
low-resolution ASTC as its final texture instead of refining to the full raster.

A required WebP authority needs no additional core PNG:

```json
{
  "images": [
    { "uri": "full.webp", "mimeType": "image/webp" },
    { "uri": "preview.ktx2", "mimeType": "image/ktx2" }
  ],
  "textures": [{
    "extensions": {
      "EXT_texture_webp": { "source": 0 },
      "EXT_texture_astc": { "source": 1 }
    },
    "extras": { "royal": { "astcPreview": { "width": 1024, "height": 1024 } } }
  }],
  "extensionsUsed": ["EXT_texture_webp", "EXT_texture_astc"],
  "extensionsRequired": ["EXT_texture_webp"]
}
```

Required AVIF uses the same shape with `EXT_texture_avif`, an AVIF image and
`image/avif`. Keep ASTC out of `extensionsRequired` so devices without ASTC can
use the full authority. These examples are texture declarations within a glTF
document; materials still reference the texture normally.

Representations MUST have equivalent framing, aspect, orientation, color and
alpha semantics. The producer supplies a low-resolution native preview and a
full-detail raster of the same artwork. A complete ASTC mip pyramid remains
required when the sampler uses mipmapped minification. No runtime encoder,
transcoder, additional material layer or mixed-format mip chain is involved.

## Loading and demand

Base-color uses load supported ASTC first. Read-ahead follows the same selection;
no full-raster transport begins until projected demand exceeds the actual native
preview resolution. This includes a 32px preview whose detail still fits within
one 128px coarse VT page. Demand retains its unclamped requested mip so page-tree
clamping cannot hide that need.

The native texture remains visible while the full raster loads. Once demanded
RGBA VT pages are ready, the existing publication path replaces the native
binding. Plain ASTC alternatives without the hint retain final-source behavior.
Unsupported ASTC, retained CPU alpha, failed preview loading and non-base-color
uses select the full raster through the ordinary loading path. A failed full
source preserves the native preview with one bounded diagnostic and no automatic
per-frame retry. Replacement must not publish stale work after disposal.

After fixing or replacing a failed asset, an application can replace its glTF
node with a new resource version, for example `gltf({ src: "model.glb", version: 2 })`.
The new identity can read and decode its authority again. Budget denial needs no
version change: it retries automatically when other sources release capacity.

Full-raster headers are checked against the declared dimensions before bitmap
decoding. PNG and WebP use their small fixed header prefixes; JPEG can extend its
header read up to 128 KiB, and AVIF uses the existing bounded container parser.
An unreadable or mismatched dimension header is a detail error. Browser decoding
remains the format authority, and the decoded result is checked against its
reservation and declared intrinsic dimensions.

## Performance expectations

The preview role defers full-raster transport and decoding until detail is
needed. It can improve time to the first visible texture without reducing the
total work required for full detail. The small preview is not a replacement for
the authoritative raster, and a later zoom can expose its decode/resize latency.

The [headless first-presentation measurements](../../research/vt-comparison/first-presentation-review.md)
demonstrate this tradeoff with local PNG and ASTC assets. Their plain-raster and
preview-detail paths use different bitmap size limits, so full-detail timings
are not equal-output decoder comparisons. High-quality fitting can be a
substantial part of the later cost; the
[matched resize probe](../../research/vt-comparison/bitmap-resize-review.md)
found no benefit from splitting PNG decode and resizing into separate bitmap
operations on the tested host. These results do not define a device-independent
latency guarantee.

## Memory and lifetime

SVG and raster previews share decoded preview state, page publication and
lifetime ownership. SVG retains its validated encoded document; raster detail
retains one fitted bitmap. Each raster read/decode uses the existing detail lane
and reserves its expected retained bitmap bytes before starting. Pending
reservations and resident bitmaps count against the existing 64 MiB automatic
source budget; shared decoded authority is counted once. Denial preserves the
preview and remains retryable when other sources release capacity.

Raster fitting uses a 64 MiB ordinary-storage ceiling, including its mip-chain
allowance. Very large rasters can therefore be fitted below intrinsic resolution,
while VT retains the original logical dimensions. Other retained automatic
sources can delay promotion. These are budget constraints, not a promise of
full-resolution residency for every visible image simultaneously.

For example, the current fitter reduces a 4096x4096 raster to 3547x3547 under
that storage ceiling. Its retained base bitmap occupies 50,324,836 bytes (about
48 MiB), plus the native preview's mip payload. The declared logical extent is
still 4096x4096. Two such independent authorities cannot be retained together
under the 64 MiB source budget; one can remain on its preview until capacity is
released. Shared decoded authorities are still charged only once.

The budget tracks retained bitmap storage and reservations. Browser codecs can
still allocate transient full-image decode memory, particularly for AVIF paths
that preserve alpha before resizing. PNG/JPEG/WebP/AVIF are not out-of-core formats;
use authored page trees when full-source browser decoding must be avoided.
Encoded full-raster bytes are not retained after decoding by the preview state.
Disposal aborts pending reads, closes completed or late bitmaps, and releases the
reservation. Context restoration and atlas migration reuse the existing owners.
