# Explicit raster previews — implementation plan

Status: implemented and validated. The required full-source composition fix is
committed in 56130d34; the raster follow-up implements the contract below. See
[raster-preview-results.md](raster-preview-results.md) for measurements and review.

## Authoring contract

Keep the full PNG/JPEG in core `texture.source`, or use a required WebP/AVIF
extension. Keep `EXT_texture_astc.source` pointing to its native representation.
Opt into progressive refinement using private Royal metadata:

```json
{
  "source": 0,
  "extensions": { "EXT_texture_astc": { "source": 1 } },
  "extras": { "royal": { "astcPreview": { "width": 512, "height": 512 } } }
}
```

The dimensions describe the full raster's intrinsic pixel extent. They let VT
plan demand before fetching or decoding that raster. Validate positive safe
integers and the supported dimension ceiling; verify against the actual full
source dimensions before bitmap decoding. Mismatches become bounded detail
errors, not silently stretched images. No GS_texture_svg is emitted for raster
input. The metadata is a private loading hint, not a registered extension or a
claim that glTF standardizes progressive refinement. Unaware consumers retain
ordinary core/ASTC selection. Absence of this hint preserves final-alternative
semantics. Required ASTC and SVG combinations should reject this raster-only
hint rather than produce ambiguous authority.

## Shared runtime path

Generalize decoded SVG preview state into one texture-preview state with a
lazy authority that is either encoded SVG or a decoded raster. Keep canonical
SVG extension semantics distinct; share lifetime, readiness, bounded failure,
page publication and context-restoration behavior. Keep actual preview upload
dimensions separate from full logical dimensions.

On unsupported ASTC hardware or for retained CPU alpha, use the full raster
through the existing ordinary path before any native transport. Preview failure
also recovers to the full raster. Successful native previews must remain visible
until demanded authoritative pages are ready.

Raster detail uses the existing browser decode queue's detail lane. Reserve its
estimated retained bitmap bytes against the root's automatic decoded-source
budget before starting transport/decode; include pending reservations, release
on failure/disposal, and avoid double charging shared decoded authorities.
Fit decoding to the existing storage ceiling if needed, while retaining original
logical dimensions. The encoded-header dimension reader can validate the
producer's declared extent before full bitmap decode. Browsers may still use
transient internal memory to decode PNG/WebP/AVIF; this does not make those
formats out of core.

Do not treat a small native preview as sufficient merely because demand resolves
to the page tree's coarsest mip: a 32-pixel preview can be smaller than a 128-pixel
coarse page. The promotion condition must account for actual preview coverage.
Budget denial keeps usable preview coverage and must remain retryable when
capacity becomes available; genuine detail failures get one bounded diagnostic
and no per-frame retry loop.

## Gates

- Actual 512x512 raster + 32x32 ASTC must first show the preview and later restore
  distinct full-raster detail; unmarked ASTC must remain the final representation.
- Both ASTC block sizes; unsupported capability; PNG and required WebP/AVIF;
  invalid metadata/index/MIME/dimensions; failed preview and failed detail.
- No full-source read before demand; constrained multi-source memory admission;
  cancellation while queued/loading; no stale completion after disposal.
- Shared leases and sampler identities; small/coarsest-only views; enlargement;
  atlas migration and context restoration.
- Headless host-GPU rendering and transport oracle, decoding/GC/memory measurements,
  two review passes, package checks. Do not commit an incomplete runtime path.
