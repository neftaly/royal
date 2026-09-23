# Ordinary SVG texture imports and inspected pixel identity

Date: 2026-09-23

Status: addressed in 0.0.35. The context below records the pre-fix behavior.
Ordinary SVG image loading and declared physical sizing at 12 pixels/mm now
follow the [image-source contract](../specs/assets-and-gltf.md#ordinary-image-sources).

## Consumer context

Probability's onboarding application and Play's Create tab share an artwork
preparation pipeline. Before this change, SVG artwork was rasterized at 12,000
pixels per metre (304.8 DPI), using the chosen physical dimensions, and stored
as WebP or AVIF. The requested product behavior is to retain SVG texture bytes
to reduce game storage and transfer size.

The user explicitly wants SVGs referenced as ordinary glTF image sources, even
though that is outside core glTF's image-format requirements. Restoring
`GS_texture_svg` or dynamic vector refinement is not part of the request.

The local Settlers export contains 280 SVG files, with 59 byte-identical unique
assets. The unique assets total 537,222 raw bytes or 123,412 bytes when each is
independently gzipped. These measurements exclude meshes and game documents;
no equivalent AVIF/WebP comparison has been measured.

Probability offers an optional experimental adult-content filter. Its NSFWJS
predicate classifies pixels supplied by Royal. The relevant question is whether
classification observes the same representation subsequently displayed.

## Current Royal behavior

Probability uses Royal 0.0.34. Dedicated SVG texture support and
`GS_texture_svg` were removed in 0.0.32. Required extension use fails preflight;
optional use falls back to the ordinary texture source.

The generic browser image decoder can still decode browser-supported SVGs when
provided an appropriately typed source. With inspection enabled, mutable or
vector-capable browser sources are frozen at their decoded/fitted dimensions
before classification and display. The predicate receives a reduction of those
frozen pixels, at most 256 pixels on the longest edge. Automatic pages derive
from the inspected source; changed sample pixels on subsequent decodes receive
separate inspection decisions.

Royal does not have a physical-resolution contract to rasterize SVGs at 304.8
DPI. That convention belongs to Probability's import preparation.

## Observed issue

An ordinary external glTF image can declare `mimeType: "image/svg+xml"`, yet
Royal's `readImage` in `static-material.ts` omits that MIME type from the asset
reference when no texture extension has selected an expected MIME type.

When an application provides the glTF resource reader, `readTextureBlob` in
`browser-decode.ts` receives bytes and constructs a Blob from the asset's type.
For Probability's opaque Automerge resource URLs, the declared SVG MIME type
has been lost and the Blob is untyped. Browser SVG decoding then fails.

Observed through Probability's literal root `pnpm dev` server: Create imports
the generated model document, its required texture fails, the renderer reports
`One or more required textures failed`, and the game remains in its loading
state. This was reproduced with a small red-circle SVG using ordinary
`texture.source`, no SVG extension, and an external Automerge image URI.

The generic browser decoding path therefore does not by itself establish that
ordinary SVG images work through the application-provided glTF resource reader.
This is a MIME propagation issue, not a demonstrated adult-filter bypass.

## Filtering significance

SVG byte identity alone does not establish rendered pixel identity.
Non-scaling strokes can change occlusion as the SVG viewport changes. Media
queries can select different content by viewport, resolution or environment.
Nested viewports, clipping, masks, filters and fine geometry affect detail
across rasterizations; declarative animation and resource-dependent rendering
introduce other differences between observations. Exact behavior depends on
the browser and embedding mode.

Camera zoom of a frozen bitmap does not reevaluate SVG features. Royal's
existing inspection path freezes browser images and fingerprints the inspected
pixels, addressing changes between decoded representations. A bounded
classifier sample can still miss fine detail, just as it can with raster
textures. That classifier limitation is separate from the MIME failure above.

## Evidence

- `CHANGELOG.md`, 0.0.32 SVG removal.
- `docs/specs/assets-and-gltf.md`, Raster image sources.
- `docs/specs/texture-inspection.md`, coverage and limits.
- `packages/renderer-webgl/src/gltf/static-material.ts`, `readImage`.
- `packages/renderer-webgl/src/texture/browser-decode.ts`, `textureBlobType`
  and `readTextureBlob`.
- `packages/renderer-webgl/src/texture/browser-image-element.ts`, browser
  intrinsic dimensions and fitted decoding.
- `packages/renderer-webgl/src/texture/inspection-sample.ts`,
  `freezeInspectionSource` and bounded samples.
- `packages/renderer-webgl/src/texture/inspection.ts`, retained inspected
  source and pixel-based decision caching.
- `tests/browser/texture-inspection.ts`, non-scaling-stroke and repeated-decode
  fixtures.

This document records context and observed behavior only; it does not prescribe
an implementation or fix.
