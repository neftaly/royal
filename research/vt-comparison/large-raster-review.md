# Large raster authority fitting

Date: 2026-09-13. Browser correctness and retained-memory evidence; no production
changes or commits.

The earlier source matrix stopped at 1024 pixels and did not exercise the
production storage fit for a large authoritative raster. The optional
`?large-raster=1` audit now uses actual 4096x4096 PNG and JPEG sources with 32x32
ASTC LDR previews, at both 6x6 and 8x8 block sizes.

All four cases pass on headless Intel Iris Xe through ANGLE Vulkan. The preview
appears before any full-source read. Increased demand reads the raster once and
decodes it to a **3547x3547** browser bitmap. The production storage fitter allows
an RGBA mip chain within 64 MiB; the retained base bitmap occupies 50,324,836 bytes
(about 48 MiB). The logical full-source declaration remains 4096x4096.

| ASTC preview | Retained bitmap + native mip payload |
|---|---:|
| 6x6 | 50,325,668 B |
| 8x8 | 50,325,220 B |

Both PNG and JPEG match these exact totals. Atlas storage grows from 69,696 to
627,264 bytes, shrinks to 69,696 bytes, and returns after context loss. Exactly one
browser bitmap is decoded per case, including restoration, and the source reads
remain ASTC/raster. Final authority pixels are blue: PNG `[0,0,255,255]`, JPEG
`[0,0,254,255]`. No failed pages or frame/GL errors occur.

Review checked that the instrumentation delegates to the real browser decoder and
records its returned bitmap dimensions without changing resize options. It filters
by the case's raster MIME, excluding ASTC and fixture preparation. A second pass
checked exact retained accounting against the bitmap extent plus all native mip
payloads, and reran all 44 ordinary source combinations successfully. Research
TypeScript, Vite build and whitespace checks pass.

This demonstrates retained source accounting and decode fitting, not a cap on peak
browser-process memory. Canvas fixture construction, encoded data, browser decoder
internals and transient resizing storage are outside the root's retained bitmap
budget. Aggregate GC trace data includes setup and is not a speed comparison.
This pass covers one large authority at a time; concurrent admission remains
covered separately by the existing runtime tests.

Evidence: [four large cases](large-raster-results.json),
[44 source regressions](large-raster-source-regression.json),
[source hashes](large-raster-sources.json). Use the candidate build and existing
headless runner with `source-combinations.html?large-raster=1`. The audit is
exclusive with demand, delayed-bitmap and failure modes.
