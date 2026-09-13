# Large rectangular raster authorities

The real glTF source-combination fixture now accepts `large-raster=1&aspect=wide`
or `aspect=tall`. These create 8192×4096 or 4096×8192 PNG/JPEG authorities and
matching 32×16 or 16×32 ASTC preview mip pyramids. Both ASTC block sizes run
through the existing native-first, full-source refinement, atlas growth/shrink
and context-restoration sequence.

All eight rectangular cases pass on headless Intel Iris Xe. Each completes with
one decoded bitmap, exactly one ASTC and one raster read, and no pending, failed
or unresident pages. Fitted dimensions are 5017×2508 for landscape and 2508×5017
for portrait. The one-pixel rounding difference is allowed by the aspect check;
the square path retains its stricter equal-dimension assertion.

| ASTC block size | Retained source bytes after restoration |
| --- | ---: |
| 6×6 | 50,331,008 |
| 8×8 | 50,330,768 |

These totals include the fitted base bitmap and native mip payload and remain
below the 64 MiB automatic-source limit. All cases grow their atlas from 69,696
to 348,480 bytes, shrink back to 69,696, and restore at that size without another
source read or bitmap decode.

This uses diagnostic solid colors to distinguish preview and authority. It
checks dimensions, fitting, residency and ownership; it is not a detailed
spatial-cropping, photographic-quality or peak browser-memory proof. Encoding
the large fixture also occurs in the browser before renderer setup.

No production changes were needed. The research TypeScript project passes.
The optional aspect parameter requires the large-raster audit and rejects
unknown values, leaving other audit modes unchanged.

Artifacts: [landscape](rectangular-raster-wide.json),
[portrait](rectangular-raster-tall.json),
[original square regression](rectangular-square-regression.json).
Everything remains uncommitted.
