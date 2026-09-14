# Cooperative idle ASTC implementation

Implemented locally after Royal 0.0.29 on 2026-09-14.
Follow-up [paired device acceptance, pixel comparisons, and adversarial review](acceptance/README.md) are complete. New automatic sRGB pages
still become resident through the RGBA path. After foreground VT demand settles,
a lazy worker encodes one ASTC 6×6 block row per explicit grant. Demanded pages
are selected before other retained pages. Foreground page preparation stops
further grants and ASTC publication; an already running row finishes first.
This detects renderer work, not system-wide CPU availability.

A second atlas and page-table selector allow gradual mixed residency. Fenced
uploads keep RGBA authoritative until validation succeeds. Subsequent RGBA
compaction reclaims actual allocations without throwing away cached detail.
Both migration allocations are charged. Optional ASTC growth is cancelled when
foreground allocation work resumes. Context loss and failures retain the source
fallback. The current bounds are 512 compressed pages per resource and 8 MiB of
retained compressed blocks per root. The worker is released when candidates are
exhausted. Its roughly 6 MiB temporary WASM workspace is additional CPU memory.

## Device evidence

The Ghostscript tiger example was exercised with cold zoom-in, three rapid
out/in pairs, and a return after 35 seconds idle. The iPad rendered 1472×736 and
243 resident pages; Quest rendered 1152×576 and 96 pages. Quest measurements are
from its ordinary browser, not immersive XR. These are individual smoke runs,
not statistically controlled performance estimates. Timings measure demanded
page residency, not GPU presentation or perceived sharpness.

| Final run | iPad 7,6 / iPadOS 17.7.11 | Quest 2 / Adreno 650 |
| --- | ---: | ---: |
| Cold zoom-in | 1306 ms | 504 ms |
| Rapid zoom-in returns | 3–6 ms | 9–17 ms |
| Return after 35 seconds idle | 18 ms, one frame | 6 ms, one frame |
| New page requests on every cached return | 0 | 0 |
| GPU atlas bytes before compression (RGBA capacity) | 17,842,176 | 8,921,088 |
| GPU atlas bytes after 35 seconds idle | 10,903,552 | 1,060,928 |
| ASTC allocation included in that total | 1,982,464 | 991,232 |

The iPad was still partly compressed at 35 seconds. Quest's retained atlas
allocation fell about 88%. Padding, the retained coarse RGBA page, and temporary
migration storage mean the whole-cache ratio differs from the 9× per-page
payload reduction (69,696 RGBA bytes versus 7,744 ASTC bytes).

The preceding run recorded 1226/439 ms cold zoom-in and 16/7 ms idle returns
(iPad/Quest). Pre-feature probes recorded approximately 1232 ms iPad and
440–491 ms Quest cold zoom-in. The final cold readings are somewhat higher;
these limited runs do not establish zero CPU contention or an initial-load
speedup. The repeated cached returns demonstrate that migration does not force
page regeneration in this scenario.

Raw data: [iPad final](ipad-final.json), [Quest final](quest-final.json),
[preceding iPad](ipad.json), [preceding Quest](quest.json).
[zoom-probe.js](zoom-probe.js) contains the injected browser test; it requires
the example's benchmark snapshot hook and visible canvas.
[Quest screenshot](quest-compressed.png) shows the initial view after its pages
compressed. Visual inspection found the tiger rendered with intact coverage;
this is not a pixel-equivalence or broad content-quality test. ASTC is lossy.
Safari's automation screenshot command failed with InternalError; its residency
and timing reports completed successfully.

## Validation and distribution

Regression coverage includes actual RGBA allocation reclamation, mixed-format
zoom reversal, newly demanded RGBA admission, foreground pause, incremental ASTC
growth and cancellation, failed upload preservation, disposal, context loss,
and inherited page-table selectors. The worker test verifies one row per grant,
obsolete message rejection, and shared initialization across cancelled startup.

The full suite passes 1,539 tests after the follow-up review fixes. Typechecking, lint, production builds,
package imports, packed consumer/codec checks, and bundle-size checks pass.
The lazy ASTC worker including its embedded WASM adds about 89 KB gzip; the
complete lazy graph adds about 92 KB gzip, with an eight-byte initial allowance for changed chunk references. The WebGL tarball grows approximately 106 KB. Explicit size
allowances record these costs. Packaged third-party notices accompany Arm's
Apache-2.0 encoder; the canonical Royal license remains unchanged.
