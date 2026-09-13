# Real-browser AVIF authority coverage

Date: 2026-09-13. Research-only pass; no renderer changes or commits.

The raster-preview gates explicitly include required AVIF, but previous AVIF tests
used a synthetic header and mocked bitmap decode. The source-combination fixture
now uses an actual 1024x1024 AVIF generated offline. AVIF models declare
`EXT_texture_avif` required, attach optional ASTC through `EXT_texture_astc`, and
omit the core `texture.source`. Marked variants declare the full raster extent in
`extras.royal.astcPreview`; unmarked variants retain final-alternative semantics.

## Results

All 32 source cases pass, including eight new AVIF combinations: marked/unmarked,
ASTC LDR 6x6/8x8, and supported/forced-unsupported capability. Six late-bitmap cases
also pass, extending the existing PNG/WebP check with AVIF for both block sizes.
All runs use headless Intel Iris Xe through ANGLE Vulkan.

| AVIF role and capability | Renderer source reads | Result |
|---|---|---|
| Unmarked, ASTC supported | ASTC only | Red native alternative remains final |
| Marked, ASTC supported | ASTC then AVIF | Red preview first; blue authority under demand |
| Either role, ASTC disabled | AVIF only | Full authority renders directly |

Both supported marked AVIF cases grow their RGBA atlas from 69,696 to 627,264 bytes,
shrink to 69,696 bytes, and restore after context loss with the same bitmap and no
additional source reads. AVIF center pixels are `[0,1,253,255]`, within the fixture's
existing blue tolerance. This is a role-selection oracle, not a visual fidelity
comparison with PNG or ASTC.

Late-bitmap cases remove the pending authority, reload the same glTF, and render
the replacement before delivering the old browser bitmap. Both old and replacement
bitmaps close exactly once, with final VT ownership zero and exactly two ASTC/AVIF
read pairs. No frame/GL errors or failed pages occur.

## Review and boundaries

Review checked the required extension and absence of core PNG, logical dimensions,
MIME, optional ASTC behavior and unmarked semantics. A second pass checked that
fixture construction does not contaminate the renderer read oracle: the fixed AVIF
file is loaded into a Blob URL before the renderer starts, just as PNG/WebP fixture
bytes are constructed beforehand. Only renderer reads of those source Blob URLs
count toward the transport assertions. Browser decode, production header validation,
VT rendering and context restoration are real; capability disabling and late bitmap
delivery are controlled test instrumentation.

The AVIF is a solid-color 8-bit fixture. This does not test all AVIF item structures,
alpha/HDR profiles, progressive transport or devices beyond the host. Aggregate GC
fields include fixture setup and are not used as performance evidence. Research
TypeScript, Vite build and whitespace checks pass. Production source hashes still
match [the lifecycle checkpoint](lifecycle-sources.json).

Evidence: [32 source cases](avif-source-results.json),
[six late-bitmap cases](avif-late-bitmap-results.json),
[offline AVIF fixture](fixtures/blue-1024.avif).

## Reproduction

The worktree fixture is 416 bytes, SHA-256
`9f6bd0b010a02f86a8fb1d877a2d0d33e4dfb7fd03046b306da62122ca641e8d`.
It was generated with ImageMagick 7.1.1-43 / libheif 1.19.8:

```sh
magick -size 1024x1024 xc:blue -define heic:lossless=true -quality 100 \
  research/vt-comparison/fixtures/blue-1024.avif
```

The fixture is retained in the worktree so running the checks does not require an
AVIF encoder. Encoder versions may produce different bytes when regenerating it.
This adds no runtime encoder/transcoder dependency. `build-client.mjs` copies the
fixture directory into both candidate and baseline builds. Run the existing
`source-combinations.html` and `source-combinations.html?late-bitmap=1` host commands
against the candidate build.
