# JPEG authority and metadata coverage

Date: 2026-09-13. Research-only change; no production edits or commits.

The source-combination fixture now includes core JPEG with optional ASTC, both as
an unmarked final alternative and as an explicitly marked preview. JPEG uses the
core `texture.source`, with `image/jpeg` on the image; no JPEG extension is added.
Browser canvas encoding creates blue JPEG bytes before renderer read tracking.
The fixture checks the returned MIME to catch an encoder silently returning PNG.

A second marked JPEG contains a 24 KiB APP15 segment immediately after its start
marker. Its frame header lies beyond the decoder's initial 16 KiB dimension read,
exercising the existing bounded 128 KiB retry. The segment's length includes its
two length bytes and excludes the marker. The original encoded image follows
unchanged. The browser accepts and decodes both JPEG variants.

All **44 source combinations** and **10 delayed-bitmap cases** pass in headless
Chromium on Intel Iris Xe through ANGLE Vulkan. These include ASTC LDR 6x6 and 8x8,
plus forced unsupported capability for the source-selection cases.

| JPEG role and capability | Renderer reads | Result |
|---|---|---|
| Unmarked, ASTC supported | ASTC only | Red native alternative stays final |
| Marked, ASTC supported | ASTC then JPEG | Red preview followed by blue detail |
| ASTC disabled | JPEG only | Blue full source renders directly |

Both marked JPEG variants at both block sizes grow their RGBA atlas from 69,696
to 627,264 bytes, shrink to 69,696 bytes, and restore after context loss without
additional source reads. JPEG authority center pixels are `[0,0,254,255]`.
Delayed bitmap checks render a replacement of the same glTF before delivering
the old decode. Both bitmaps close exactly once, final VT ownership is zero, and
the source reads are exactly two ASTC/JPEG pairs.

Review checked core source attachment, MIME, segment boundaries, and the header
read limits. A second pass checked that fixture construction precedes the source
read oracle and that the delayed-bitmap wrapper captures JPEG by the case's exact
MIME. The existing PNG, SVG, WebP and AVIF cases remain in the successful run.

Research TypeScript, Vite build and whitespace checks pass. Runtime source still
matches the [alias failure checkpoint](alias-failure-sources.json). The failure
mode matrix also includes JPEG now, but was not run in this pass. These are
correctness and ownership checks, not speed or GC benchmarks: fixture setup is
included in aggregate trace data. Solid-color baseline JPEG and opaque APP15
metadata do not establish support for every JPEG profile or EXIF orientation.

Evidence: [source results](jpeg-source-results.json),
[delayed bitmap results](jpeg-late-bitmap-results.json). Reproduce with the existing
candidate build and host runner using `source-combinations.html` and
`source-combinations.html?late-bitmap=1`.
