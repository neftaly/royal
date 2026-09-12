# Background renderer proposal: consumer review

Reviewed 2026-09-12 against Probability Play and onboarding, Royal's only current
consumers. The background-renderer proposal is closed as an unaccepted plan.
Its measurements did not justify implementing a worker root, another mesh API,
or the additional shader-readiness lifecycle introduced during its first review.

## Decisions

- Retain the pre-existing working-tree changes: origin-clean bitmap probes,
  128px SVG pages, host frame scheduling and
  per-pass material identity reuse. This comparison did not isolate or remeasure
  their individual benefits.
- The subsequent adversarial review also removed the pre-existing global
  ordinary-prewarm gate. A ready untextured preview was blocked by an unfinished
  future textured variant, even after that variant's scene was replaced.
  Regression tests cover both cases and reject synchronizing the unused
  program. Ordinary prewarming and selected-program link validation remain;
  only optional VT variants poll completion to trigger publication.
- Revert the review's additional on-demand shader readiness, transmission
  prewarming and geometry rollback/publication deferral. Tests proved their
  mechanics, but the actual consumer measurements did not justify the extra
  lifecycle. Existing optional VT and ordinary prewarm behavior remains.
- Do not add another asset transport. Both consumers already use
  `gltfResourceReader`; Play also uses the host frame clock.
- Do not implement the worker-owned root from this proposal. Play uses
  synchronous picking (`SelectionPreviewController`) and borrowed geometry
  (`ModelPreparation`), and both consumers use live renderer resources. A worker
  would need an explicit consumer/API migration or additional host-owned state,
  as well as SVG/DOM, ownership and recovery work. No measured prototype has
  established that tradeoff. This does not establish that a worker could never
  help.
- Do not ship the browser-only strip-upload experiment. It still had an 88ms
  individual 128-row call, before adding progressive publication/lifecycle code.
  Pixel equivalence was not tested because the responsiveness gate already
  failed. No upload implementation was changed.
- Reject staged cropped-bitmap uploads and canvas materialization after the
  follow-up below. The staged uploader and its tests were removed; the ordinary
  texture upload path is unchanged.

## What the actual consumer showed

Production builds of both apps used frozen Royal source snapshots in `/tmp`.
The before snapshot includes the local fixes at measurement time, including the
ordinary-prewarm gate subsequently removed after adversarial review; after adds only the
subsequently reverted shader expansion. Other concurrent edits were excluded
from the comparison. Source hashes and measurements are in [results.json](results.json).

The Intel Iris Xe Chromium/Vulkan configuration used by the original benchmark
does **not** expose `KHR_parallel_shader_compile`. Its first matched pair was:

| Measurement | Before | Shader expansion |
| --- | ---: | ---: |
| First consumer-reported frame | 4.189 s | 3.984 s |
| Import complete | 19.282 s | 19.474 s |
| Sum of long-task duration beyond 50ms | 714 ms | 725 ms |
| Sampled synchronous link-helper time | 330 ms | 317 ms |

Those profiles exercise the unchanged synchronous fallback. They cannot justify
parallel-readiness changes or be added together as predicted wall-clock savings.

Desktop Playwright WebKit does expose the extension. Three before/after pairs
completed without import errors, with completion times of 24.495/24.713,
26.120/24.981 and 30.984/33.262 seconds. The latter two pairs instrumented WebGL
calls; their total link-status call time across both documents was 1/6 and 6/4ms.
Shader checks were not the remaining blocking bottleneck in these runs.

Texture uploads were different: individual calls reached 100–231ms in those
instrumented runs. A source-attribution run identified large ordinary
ImageBitmaps, approximately 1,500–2,048 pixels across. Play's 132×132 canvas VT
page uploads had a maximum of 6ms in that attribution run. Reducing SVG detail,
changing VT page size again or replacing the SVG rasterizer would therefore
target the wrong observed cost.

A browser-only interception split large bitmap uploads into 128-row calls using
WebGL2's source rectangle overload and `UNPACK_SKIP_ROWS`. The import completed
without reported GL/import errors, but the worst individual strip still took
88ms in Play (54ms in onboarding). This does not meet the proposed removal of
renderer-attributable calls exceeding 50ms. The experiment kept all strips in
the original call stack; it measured indivisible strip cost, not a working
progressive uploader. The overload is specified by
[WebGL2](https://registry.khronos.org/webgl/specs/latest/2.0/).

These are local desktop observations. WebKit had no Long Tasks API, so its rAF
gaps are not interchangeable with long-task or actual input-latency measurements.
Host load varied, caches were not cleared at the driver level, and the consumer's
frame/completion markers were used unchanged. The runs are not physical iPad
measurements, a memory-ceiling test or a demonstrated overall speed improvement.

## Follow-up: ordinary image uploads

The second adversarial review checked the origin probe in real desktop WebKit
using same-origin and cross-origin SVG images drawn to canvases. The clean
canvas passed both pixel readback and probe transfer; the tainted canvas threw
`SecurityError` on readback and `DataCloneError` on probe transfer. Both source
images remained usable. Additional cache coverage suspends two asynchronous
consumers, rejects one, clears the cache, and verifies that storage stays pinned
until the remaining consumer completes. Neither check exposed another defect.
This is desktop WebKit validation, not a physical Safari 17 device result.

An isolated 2048×2048 translucent PNG fixture initially favored cropped
`ImageBitmap` uploads: the largest crop call took 4ms versus 69ms for the whole
bitmap, with exact framebuffer pixel equivalence. That justified testing a
production prototype, not shipping it. The prototype retained one destination
texture and one pending crop, spread approximately 1MiB crops across frames,
and published only after upload and mip generation completed.

The actual consumers rejected it. A final sequential comparison with no
concurrent builds completed at 25.250s for the unchanged uploader and 39.928s
for staged crops. First frames arrived at 9.560s and 10.917s. The worst Play
bitmap upload fell from 163ms to 115ms, still exceeding 50ms. Both runs completed
without reported errors. An earlier crop run took 60.316s with a 244ms upload;
that run overlapped a baseline build and is not a clean timing comparison.
These single-run observations establish no general speed ratio, but provide
no basis for retaining the added upload lifecycle.

Materializing through a canvas before creating another bitmap also failed its
isolated test: both original and materialized bitmaps took 54ms to upload.
Uploading raw `ImageData` took 1ms after 28ms of preparation, but changed
8,291,840 channel values by one level in the translucent fixture. It also adds
a full CPU pixel buffer and would require adapting the retained raster VT
source. It is not a demonstrated equivalent replacement.

Measurements are retained in [upload-results.json](upload-results.json).
The synthetic pixel comparison can be repeated with
`PROBABILITY_PATH=../probability node research/background-renderer-review/benchmark-upload-representations.mjs`.
It includes a GPU finish for total time and framebuffer readback for comparison;
its upload-call timings alone are not total GPU completion times. The rejected
staged production prototype was removed after testing, so the synthetic crop
mode reproduces only the isolated upload experiment, not its frame scheduling.

## Reproduction and further evidence

Build each consumer with `ROYAL_BENCH_PATH` pointing to a frozen Royal package
tree, using its Vite production config and separate output folders. Put both
outputs under a common directory containing `onboarding/` and `play/`. Run one
browser at a time from the Royal directory:

```sh
PROBABILITY_PATH=../probability REVIEW_BUILD=/tmp/royal-comparison \
  PREVIEW_MODE=play node research/background-renderer-review/benchmark-webkit.mjs
```

Set `ATTRIBUTE_UPLOADS=1` to attribute upload sources; also set `SPLIT_UPLOADS=1`
to reproduce the rejected interception experiment. The original Chromium harness is Probability's
`apps/onboarding/bench/background-models.mjs`; the comparison changed only its
build-output paths and profile filename. Its `HARDWARE=1 PROFILE=1` flags select
the profiled Vulkan configuration above.

Further work needs a reproducible consumer bottleneck and an intervention that
improves it without losing pixels, increasing memory or delaying useful output.
The tested ordinary-image staging approaches are rejected; a future proposal
needs a different intervention and fresh evidence. Worker-renderer, compressed-preview and
capture-specialization requests require the same evidence.
