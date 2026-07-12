# Virtual textures

Royal has two deliberately separate virtual-texture entry points. Use
`virtualTexture('/terrain.vt.json')` for authored data. To let the renderer
generate pages from ordinary large raster images, explicitly set
`generatedRasterVirtualTextures: true` in the React `Canvas.context` or
`createRendererRoot(..., { context: ... })`. The default is `false`; Royal does
not probe for a hidden `imageUri + '.vt.json'` sidecar.

## Authored manifest contract

The intended public format is the version 1 JSON shape below. Manifest-relative
page URIs are recommended.

```json
{
  "contractVersion": 1,
  "virtualSize": [4096, 2048],
  "pageSize": 256,
  "mipCount": 5,
  "colorSpace": "srgb",
  "physicalSlots": 32,
  "physicalByteBudget": 33554432,
  "pages": {
    "uriTemplate": "pages/m{mip}-{x}-{y}.png"
  }
}
```

`contractVersion` is required and must be `1`. The fields shown are top-level;
legacy nested `virtualTexture`, dimension, tile-size, budget, and keyed-entry
aliases are not part of the contract.

`virtualSize` is the mip-0 width and height in texels. `pageSize` is the usable
square page size. Border-bearing manifests are unsupported: omit
`borderTexels`, or set it to zero. Mip 0 is full resolution; mip `n` is the
image reduced by `2^n`. Page `(mip, x, y)` covers the page at column `x`, row
`y`, with `(0, 0)` at the top-left of that mip image. Edge pages may contain
less source data but are uploaded into a page-sized physical slot.

The canonical key is `{mip}/{x}/{y}`. A `pages.uriTemplate` may contain
`{mip}`, `{x}`, `{y}`, `{key}`, or `{page}`; `{page}` expands to
`m{mip}/{x}/{y}`. Instead of a template, `pages.entries` may explicitly list
objects with `mip`, `x`, `y`, and `uri`. File names are resource identities
only; they do not change coordinates or orientation.

## Orientation, sampling, and fallback

Ordinary `imageTexture`/`textureAsset` and `virtualTexture` refs all accept
`flipY`. The default is `true`, preserving Royal's image-compatible UV
orientation; set `flipY: false` when authored UVs and page rows already use the
same top-to-bottom convention. Sampler wrap and filtering are supplied on the
texture ref.

The convenience `imageTexture` constructor defaults to sRGB. The lower-level
`textureAsset` constructor is color-space neutral unless `colorSpace` is
specified, so set `linear` explicitly for data textures. Virtual textures used
as base color default to sRGB. An explicit texture-ref color space overrides
the manifest; otherwise the manifest declaration applies, followed by the sRGB
base-color default.

Explicit virtual textures request visible fine pages and retain resident parent
mips as fallback. Until a requested child is ready, sampling may therefore be
coarser but remains defined when a parent is resident. Missing pages, a failed
page decode, or insufficient residency do not synthesize an unrelated authored
asset. Automatically generated raster VT is more conservative: the ordinary,
sharp texture remains active until the exact visible generated pages are
resident.

## Memory, loading, and errors

`virtualTexturePhysicalByteBudget` is the global physical GPU byte budget for
all VT atlases and page tables owned by a root; it defaults to 64 MiB. Manifest
`physicalByteBudget` and `physicalSlots` are per-resource limits and cannot
expand the global budget. Residency is demand-driven and eviction may return a
sample to a resident parent mip.

Manifest fetch and parse, page fetch/decode, GPU admission, and upload happen
asynchronously. Rendering continues with available fallback data while work is
pending, and invalidation schedules later progress. Failures are reported in
renderer diagnostics and may leave the explicit VT unavailable; the React
facade does not currently expose a typed per-asset loading/error hook. Hosts
that need user-facing loading state should track their own manifest transport
and treat renderer diagnostics as diagnostics, not application state.
