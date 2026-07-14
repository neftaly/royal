# Virtual textures

Royal has two deliberately separate virtual-texture entry points. Use
`virtualTexture('/terrain.vt.json')` for authored data. To let the renderer
generate VTs for ordinary base-color image textures used by triangle geometry
with `TEXCOORD_0`, explicitly set
`generatedImageVirtualTextures: true` in React `Canvas.rendererOptions` or
`createRendererRoot(..., { generatedImageVirtualTextures: true })`. The default
is `false`; Royal does not probe for a hidden `imageUri + '.vt.json'` sidecar. SVG sources are not
subject to the raster size threshold; decoded raster sources qualify when their
longest dimension is at least 257 px. The ordinary texture remains active until
generated coverage is ready. Authored `virtualTexture(...)` resources are
unaffected.

The authored object form is
`virtualTexture({ manifestUri: '/terrain.vt.json', ...options })`. Image object
forms use `src`; authored VT objects use `manifestUri` so autocomplete states
that the URI must resolve to a manifest. Pre-release aliases are intentionally
not retained.

Generated SVG image VTs use that same path. Their close-zoom
detail is controlled by `generatedSvgVirtualTextureMaxDimension`, the logical
mip-0 resolution of the SVG's longest edge. It defaults to `16384`, accepts
integers from `256` through `16384`, and preserves aspect ratio. The resolution
changes texture detail only: it does not change the SVG's layout, world-space
size, or bounded physical page cache. Authored CSS and `viewBox` dimensions are
used for aspect and layout, not as a raster-resolution ceiling.

## Authored manifest contract

The intended public format is the version 2 JSON shape below. Manifest-relative
page URIs are recommended.

```json
{
  "contractVersion": 2,
  "virtualSize": [4096, 2048],
  "pageSize": 256,
  "borderTexels": 1,
  "mipCount": 5,
  "colorSpace": "srgb",
  "physicalSlots": 32,
  "physicalByteBudget": 33554432,
  "pages": {
    "uriTemplate": "pages/m{mip}-{x}-{y}.png"
  }
}
```

`contractVersion` is required and must be `2`. The fields shown are top-level;
legacy nested `virtualTexture`, dimension, tile-size, budget, and keyed-entry
aliases are not part of the contract.

`virtualSize` is the mip-0 width and height in texels. `pageSize` is the logical
square interior covered by a page; it does not include storage needed for
filtering. `borderTexels` is required and must be a positive integer. Every
decoded authored page must therefore be a square image whose stored extent is
`pageSize + 2 * borderTexels` texels. A 256-texel logical page with a one-texel
border is stored as 258 by 258 texels.

Mip 0 is full resolution; mip `n` is the image reduced by `2^n`. Page
`(mip, x, y)` covers the logical page at column `x`, row `y`, with `(0, 0)` at
the top-left of that mip image. The page interior starts at
`(borderTexels, borderTexels)` in its stored image. Authors must provide the
gutter texels: each stored image is the periodic crop of the complete mip over
the logical page plus its border. This also defines the unused tail and gutter
of partial edge pages. Royal validates the decoded stored dimensions and does
not synthesize missing gutters from an isolated authored page.

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
asset. An automatically generated image VT is more conservative: the ordinary,
sharp texture remains active until the exact visible generated pages are
resident.

## Memory, loading, and errors

VT atlases and page tables are governed as
`classes['virtual-texture'].persistentGpuBytes` in the root's
`resourceGovernorPolicy`. The class `softLimit` is a borrowing/diagnostic
threshold rather than a second allocator cap. Set its optional `hardLimit` for
an exact VT ceiling; otherwise VTs may borrow root GPU capacity not protected
by other classes' mandatory floors. The default policy therefore scales beyond
a fixed small atlas pool when a large terrain or many visible textures need it,
while preserving geometry, ordinary-texture, and render-target floors.

Manifest `physicalByteBudget` and `physicalSlots` remain per-resource quality
and footprint ceilings; they cannot expand the governor's effective VT
capacity. Each RGBA8 physical page consumes
`(pageSize + 2 * borderTexels)^2 * 4` texel bytes before atlas-grid padding;
page tables and atlas padding also count toward allocation. Residency is
demand-driven and eviction may return a sample to a resident parent mip.

In `diagnostics().virtualTexturing`, `activePages`/`activePagesByMip` count the
page-table mappings currently visible to shaders. `cachedPages` and
`cachedPagesByMip` count physically usable atlas pages, including active pages
and inactive pages retained for quick reuse; in-flight uploads do not count
until their texels are usable. All `physical*Bytes` counters are byte counts.
`physicalBudgetBytes` is the effective VT hard maximum derived from the
governor policy, allocated storage excludes quarantined storage, and both
remain charged against that maximum.

Manifest fetch and parse, page fetch/decode, GPU admission, and upload happen
asynchronously. Rendering continues with available fallback data while work is
pending, and invalidation schedules later progress. Failures are reported in
renderer diagnostics and may leave the explicit VT unavailable; the React
facade does not currently expose a typed per-asset loading/error hook. Hosts
that need user-facing loading state should track their own manifest transport
and treat renderer diagnostics as diagnostics, not application state.
