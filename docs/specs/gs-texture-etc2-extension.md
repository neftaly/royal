# `GS_texture_etc2` glTF extension

Status: implemented experimental vendor extension; prefix is not registered

Vendor prefix owner: Garbo Succus / future registered successor

## Decision

`GS_texture_etc2` lets a glTF texture prefer an offline-authored, directly
uploadable ETC2/EAC image while retaining either a core PNG/JPEG source or a
required lower-priority AVIF/WebP source for other glTF consumers. Target mobile
GPUs commonly expose ETC2, while
`KHR_texture_basisu` specifies Basis Universal payloads and therefore requires
a runtime transcoder. Royal deliberately ships no Basis or WASM transcoder.
WebGL exposes ETC2 through `WEBGL_compressed_texture_etc`, including on WebGL2;
the context owner MUST enable and retain that capability before selecting this
source.

The extension is an experimental Royal delivery contract, not a registered
glTF compatibility claim. It MUST NOT be emitted under the reserved `KHR` or
`EXT` prefixes, and Royal MUST NOT interpret raw ETC2 as
`KHR_texture_basisu`.

## Extension location and shape

The extension is attached to a glTF `texture` and contains one semantic field:

```json
{
  "extensionsUsed": ["GS_texture_etc2"],
  "textures": [
    {
      "sampler": 0,
      "source": 0,
      "extensions": {
        "GS_texture_etc2": { "source": 1 }
      }
    }
  ],
  "images": [
    { "uri": "albedo.png" },
    { "uri": "albedo.ktx2" }
  ]
}
```

Semantic shape:

```ts
interface GsTextureEtc2 {
  source: integer; // index into the root images array
}
```

`source` MUST be a non-negative in-range image index. Additional extension
properties are reserved for forward-compatible metadata and have no current
semantics. The referenced image MUST contain the exact KTX2 profile below. A
buffer-view image MUST declare `mimeType: "image/ktx2"`. A URI image MAY omit
`mimeType`; if present, it MUST equal `image/ktx2`. Selection explicitly marks
the source as ETC2, so opaque CDN URLs do not depend on suffix or HTTP
`Content-Type` sniffing.

The extension image inherits the parent texture's sampler and every material
texture-info property, including UV set and `KHR_texture_transform`. It is an
alternate representation of the core source, never a second material layer.

## Exact storage profile

Royal accepts only its existing direct ETC2 KTX2 subset:

- KTX2, two-dimensional, non-array, single-face;
- unsupercompressed `VK_FORMAT_ETC2_R8G8B8A8_UNORM_BLOCK` (151) or
  `VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK` (152);
- straight alpha, identity `rgba` swizzle, and upper-left `rd` orientation;
- valid, non-overlapping, exact-size ETC2/EAC level storage;
- a complete authored mip pyramid whenever the sampler uses mipmapping.

The KTX2 transfer function MUST match the material slot's requested linear or
sRGB interpretation. Royal may discard leading levels to meet an explicit
storage ceiling while retaining a complete suffix. It never transcodes,
resamples compressed blocks, generates compressed mipmaps, or expands RGB on
the CPU. Alpha-mask picking may decode only the EAC alpha channel into the
ordinary retained alpha plane.

This deliberately supports one portable GPU representation. Adding RGB-only,
R11/RG11, ASTC, BC, Basis, Zstandard, arrays, cubemaps, arbitrary swizzles, or
orientation repair requires a new reviewed contract; it is not format probing
inside this extension.

## Optional and required forms

With a valid parent `texture.source`, the extension SHOULD be listed only in
`extensionsUsed`. Royal enables and tests the context capability before cold
glTF preparation, then selects exactly one source: ETC2 when available, or the
ordinary lower-priority portable fallback when unavailable. No alternate is
fetched merely to make that choice. Once ETC2 is selected, a malformed,
missing, or failed resource is a texture failure; Royal does not start a second
fallback request after transport begins because doing so would duplicate
content identity, admission, cancellation, diagnostics, and memory policy.
Applications that need network retry may change the asset source/version
explicitly.

Without a parent `texture.source`, the document MUST either list
`GS_texture_etc2` in both `extensionsUsed` and `extensionsRequired`, or provide
a lower-priority `EXT_texture_avif` or `EXT_texture_webp` source which is itself
required. This keeps the document honest for a consumer which does not implement
the optional ETC2 extension without duplicating one image as both extension and
core source. A consumer missing any required fallback extension still fails the
asset normally. Royal rejects required ETC2 during cold preflight when the
context capability is absent, before texture transport. Royal otherwise accepts
the extension as required only at its documented texture placement and after
validating the payload through the ordinary cold texture reader.

The extension, draft `EXT_texture_avif`, and `EXT_texture_webp` may occur on one
texture. Royal's deterministic preference is ETC2, then AVIF, then WebP, then
the core source. Only the selected source enters preparation; alternates are
not fetched. Producers MUST author equivalent color, alpha, orientation, and
dimensions because Royal does not compare alternate pixels.

## Canonical lowering and ownership

Selection produces the same immutable cold texture recipe used by ordinary
images, with an internal ETC2 encoding marker. The context owner enables the
WebGL extension once per generation and passes a Boolean capability into cold
preparation; workers never probe GL. The marker participates in
decoded-content identity and controls only cold byte parsing. Successful decode
produces the existing canonical ETC2 level union; from that boundary onward it
uses the same:

- preparation scheduler and cancellation generation;
- persistent GPU budget and exact residency accounting;
- material binding, sampler, shader, draw, and picking paths;
- context-loss restoration and bounded diagnostics;
- release and stale-completion rules.

There is no extension branch in frame selection or WebGL submission. Importing
Royal still does not fetch, probe hardware, or load a codec. The KTX2 parser is
dynamically imported only when the selected cold source is decoded.

## Failure and security boundaries

Header, range, descriptor, orientation, swizzle, transfer-function, mip, and
storage validation completes before publication. Declared lengths use checked
safe-integer arithmetic and must remain within the fetched or buffer-view
bytes. Invalid data cannot reach `compressedTexSubImage2D`.

The parser does no decompression and the format cannot execute script or fetch
subresources. Normal fetch origin, cancellation, response-size, source-version,
and GPU-budget policies still apply. An HTTP MIME type does not override the
extension's validated byte profile.

## Resource trade-off

ETC2 RGBA occupies approximately one byte per texel per mip level instead of
four bytes for decoded RGBA8, generally reducing persistent texture storage and
sampling bandwidth by about four times for the same retained dimensions. It
also removes browser image decode and runtime transcoding work. Raw ETC2 may be
larger on the wire than AVIF/JPEG/WebP, so the producer chooses the delivery
tier and may use ordinary HTTP content encoding. Royal does not add a decoder
or a second compressed cache to improve transfer size.

The extension is justified by measured mobile scene evidence: current Sponza
and Bistro web assets finish texture decode but retain large uncompressed
ordinary texture sets and remain fragment/bandwidth constrained on physical
Safari. The claimed benefit remains provisional until equivalent ETC2 assets
are measured on physical Safari 17/A10+ and Quest 2.

## Rejected alternatives

- **Use `KHR_texture_basisu`:** interoperable, but its Basis payload requires
  the runtime transcoder Royal intentionally does not ship.
- **Put raw ETC2 behind `KHR_texture_basisu`:** violates that extension's
  payload rules and creates false compatibility.
- **Use `.ktx2` as an ordinary core glTF image:** direct Royal ingestion works,
  but core glTF consumers are not required to accept it and no fallback is
  expressed.
- **Use `extras`:** legal for private metadata, but source selection changes
  executable loading semantics and belongs in an extension.
- **Retry the core source after selected ETC2 failure:** increases network,
  state, memory, and failure ambiguity for a problem explicit source/version
  changes can solve.
- **Support several GPU formats:** creates format negotiation, more asset
  variants, parser/upload branches, testing combinations, and content identity
  ambiguity before one portable baseline is proven insufficient.

## Acceptance and registration gates

Before this extension is described as stable, Royal needs:

1. an offline encoder that emits valid ETC2 KTX2; Royal's checked-in attachment
   tool already validates and wires batches of pre-encoded images into JSON
   glTF or GLB without rewriting retained GLB payload chunks;
2. schema and sample assets for optional and required forms; the optional
   fallback oracle is checked in and exercised by the browser lab;
3. cold selection, malformed payload, wrong-placement, embedded-image,
   identity, alpha-picking, budget, cancellation, and restoration tests;
4. physical Safari 17/A10+ and Quest 2 load, residency, frame, and visual proof;
5. an assigned vendor prefix and public registry proposal, or a deliberate
   rename if Khronos assigns a different prefix.

Until those gates are complete, the implementation is experimental and assets
should retain a core source when interoperability matters.

The WebGL capability rule follows the Khronos
[`WEBGL_compressed_texture_etc` specification](https://registry.khronos.org/webgl/extensions/WEBGL_compressed_texture_etc/).
The distinction from Basis payloads follows the Khronos
[`KHR_texture_basisu` specification](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_basisu).
