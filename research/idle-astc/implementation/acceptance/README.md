# Device acceptance and adversarial review

Completed 2026-09-14. Three alternating RGBA-control / ASTC pairs ran on each
connected device. The control disables only the ASTC extension before the app
loads; both modes otherwise run the same implementation and scene. This isolates
background compression from unrelated changes. Timings measure residency rather
than GPU presentation. Quest ran in its regular browser, not immersive XR.

| Median of three runs | iPad RGBA | iPad ASTC | Quest RGBA | Quest ASTC |
| --- | ---: | ---: | ---: | ---: |
| Cold zoom-in | 1256 ms | 1224 ms | 503 ms | 520 ms |
| Cached return after 35s | 34 ms | 16 ms | 6.3 ms | 5.9 ms |
| Additional detail during compression | already resident | already resident | 890 ms | 852 ms |

Every cached return completed in one observed frame without new page requests.
Cold medians were within about 3.3%; the pairs showed no repeatable foreground
regression. Individual frame gaps varied (maximum cold gaps: iPad 48/62 ms,
Quest 27/35 ms, RGBA/ASTC). These small samples do not establish statistical
significance or guarantee all-device timing. A separate larger iPad zoom requested
213 new pages during compression, settled in 1542 ms, and returned to the cached
view in 10 ms. Its subsequent idle return remained one frame with zero requests.

Files `ipad-1.json` through `ipad-6.json` and the equivalent Quest files contain
all paired runs; odd runs are RGBA control and even runs enable ASTC.
`ipad-new-detail.json` contains the larger iPad zoom. The probe source is
`zoom-probe.js`. To repeat the pairs, copy `astc-acceptance.html` into
`apps/examples-react`, run the example server, navigate to
`/astc-acceptance.html?mode=rgba` or `?mode=astc`, wait for initial residency,
and evaluate the probe script. Remove the temporary HTML afterward.

## GPU pixel comparisons

`astc-quality.html` uses the actual cooperative encoder worker and samples two
adjacent 132px atlas cells, including their two-pixel gutters, into a 256×128
output. Both RGBA and ASTC use sRGB storage and the same GPU sampling path.
Errors compare color composited against both black and white; alpha error is
also measured independently. This exposes transparent-edge errors instead of
ignoring alpha or hidden RGB. The seam metric covers four columns straddling
the logical page boundary. The quality harness is standalone and does not claim
to exercise every material shader. The integrated tiger and context-loss tests
exercise the renderer's mixed-residency path.

| Content | iPad PSNR | Quest PSNR | Largest mean absolute color error, 0–255 |
| --- | ---: | ---: | ---: |
| Gradient | 48.9 dB | 49.4 dB | 0.66 |
| Text at 8/12/18/26px | 36.9 dB | 37.5 dB | 1.12 |
| Transparent gradients / curved edges | 43.3 dB | 43.4 dB | 1.13 |
| Lines and shapes crossing the page boundary | 39.7 dB | 38.9 dB | 1.20 |
| Checkerboard | identical | identical | 0 |
| Tiger artwork | 32.7 dB | 32.7 dB | 2.63 |

All uploads/draws returned GL error zero. Mean alpha error was at most 1.524/255;
opaque inputs remained opaque. The boundary fixture averaged at most 0.70/255
error at the join. Individual edge pixels can have larger lossy errors. Visual
inspection of the saved RGBA/ASTC text and artwork retained readable glyphs and
coverage without missing pages or an introduced page-wide seam. This completes
the quality acceptance for the requested 6×6 mode; compression is not lossless.
Raw values are in `ipad-quality.json` and `quest-quality.json`; null PSNR denotes
zero error / infinite PSNR for the checkerboard. The PNG pairs are unmodified
GPU output. Copy the quality HTML into the example app to repeat; update its
worker `/@fs` path if the checkout lives elsewhere, then remove the HTML.

## Adversarial review fixes and recovery

Review reproduced five failed assertions covering worker construction rejection,
bitmap transfer failure, grant/cancel transport failure, and message decoding
failure. The implementation now closes untransferred bitmaps, settles outstanding
jobs even when cancellation cannot be posted, and routes message errors through
the normal failure cleanup. Regression tests fail before these fixes and pass
afterward. GPU-headroom denial was separately tested to back off without repeated
allocation attempts and resume after competing claims release their bytes.

The follow-up review checked mixed-format slot ownership, page-table inheritance,
compressed atlas growth and rollback, budget claims, stale startup generations,
source/context disposal, lazy packaging, and license inclusion. No remaining
blocking finding was identified. Temporary device harness files were removed
from the examples app and retained here only as reproduction artifacts.

Quest also underwent real WebGL context loss after ASTC migration. It recovered
from generation 1 to 2 with one interruption/recovery, all 21 desired pages
resident, no failed pages, and ASTC migration resumed. The raw lifecycle and
memory counters are in `quest-context-recovery.json`.

Final gates: 1,539 tests, typecheck, lint, production build, package imports,
packed consumer/codec checks, and bundle-size checks. The final changed chunk
references exceeded the initial gzip allowance by three bytes; an explicit
eight-byte reference allowance covers that variation. All encoder code and
WASM remain lazy.

The built distribution worker (with embedded WASM) also encoded a 132px page
on Quest successfully, producing exactly 7,744 bytes; see `quest-built-worker.json`.
