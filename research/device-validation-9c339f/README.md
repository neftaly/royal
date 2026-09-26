# Physical device validation — Royal 0.0.33

Tested 2026-09-23 NZST, autonomously over USB/LAN. Main build:
`9c339f99bb3c117a3aa9fccfe91758fef44787ec`, clean production build
`9c339f99bb3c-clean-mud4qg2z`. Every accepted example report was checked
against this identity. No renderer/application source was changed.

Devices: iPad7,6 / iPadOS 17.7.11 / Apple WebGL2; Quest 2 /
Oculus Browser 152.0.0.44.30 / Chromium 152 / Adreno 650.

## Result

The latest commit's compact GPU fallback behavior passed on both devices.
Five examples per device completed their requested 24 samples: helmet,
virtual-texture stress, texture materials, Sponza, and the nonimmersive WebXR
scene. Snapshots reported zero failed pages, GPU denied claims, image failures,
and context interruptions. Quest's collected browser diagnostics were empty;
the fresh Safari automation harness collected in-page warnings and renderer
snapshots, not a full inspector console trace. This is not an unconditional
performance or report-validator pass; see findings below.

### Direct regression oracle

`compact-fallback-probe.ts` imports the actual checked-out GPU owner and builds
as a separate diagnostic bundle, without modifying the production examples.
`ipad/compact-fallback.json` and `quest/compact-fallback.json` each contain four
passing cases: Canvas and ImageBitmap sources, with and without mipmaps.

Each case uploads a 2048×1024 image, compacts to 512×256, repeats reconciliation,
and restores the original dimensions. It checks exact storage accounting,
framebuffer completeness, zero WebGL error, stable texture identity on repeated
compaction, and identical red/green/blue/translucent-white pixel readbacks at
all four stages. ImageBitmap creation uses Royal's production decode options
(`premultiplyAlpha: none`, no orientation or color-space conversion).

Nonmipmapped storage: 8,388,608 → 524,288 → 8,388,608 bytes. Mipmapped:
11,184,812 → 699,052 → 11,184,812 bytes. This is a 16× texel reduction for this
fixture, not a claim about total application memory. Initial exploratory
ImageBitmap probes used the browser's default premultiplication and were
corrected to match the production decoder before acceptance.

The real texture-material example retained 1,398,100 ordinary GPU bytes on
both devices (the 512² mipmapped fallback). The helmet retained 90,876,580
bytes across five maps, exercising a compact base-color map alongside the
remaining full-size material maps. Pure shared-storage eligibility and decoded
source lifetime contracts are additionally covered by the focused unit tests.

### Refinement

The iPad VT stress probe's first zoom from distance 11 to 5.196 settled in
811 ms, with first page upload at 134 ms and a maximum observed frame gap of
25 ms. Eight cached returns/reversals completed in one observed frame each.
`ipad/vt-zoom.json` retains every sample.

The Quest close-view harness reached distance 0.1 in approximately 691 ms;
its transition p95 was 33.3 ms. Final admitted demand had no pending/unresident
pages or page failures. This differs from the iPad wheel workload and is not
a paired device speed comparison.

### Findings requiring follow-up

1. **Sponza camera latency is poor on both devices.** A separate monotonic-clock
   probe moved the camera through 60 one-pixel steps and required the renderer
   frame counter to advance for every sample:

   | Device | Median | p95 | Maximum |
   | --- | ---: | ---: | ---: |
   | iPad | 373 ms | 433 ms | 650 ms |
   | Quest 2 | 259.6 ms | 296.9 ms | 317.1 ms |

   These are synthetic input-to-observed-render-progress wall times, including
   VT work, not GPU execution times or display presentation latency. Both runs
   made progress on all 60 samples. They do not establish a regression caused
   by this commit: no parent-commit A/B run was performed.

2. **The in-page camera timing can under-report or become negative.**
   `sampleCameraDragFrames` in `BrowserBenchmarkReporter.tsx` subtracts a fresh
   `performance.now()` from the RAF callback's timestamp. Quest's 120-frame
   warm repeat reported −0.8 ms p95 despite 120 renderer frames. That report's
   timing is invalid. The iPad warm repeat reported 42 ms p95, but the same
   method omits work captured by the clock probe; it is not a reliable
   input-to-render latency measurement. Use `*/sponza-camera-clock.json` for
   the corrected samples. Original reports are preserved, not silently fixed.

3. **iPad Sponza does not always admit all desired VT detail.** The first idle
   capture had 23 admitted pages out of 583 desired; the warm repeat had 23/561.
   Pending and unresident *admitted* pages were zero, but this is not complete
   desired-detail refinement. Ordinary textures continued to render. Further
   camera motion admitted 561 pages and generated new outstanding work. Quest's
   separately saved settled view reached 488/488 and visible-detail fraction 1.
   Do not interpret the `*-settled.json` filenames as proof all desired detail
   was admitted.

4. **Two existing report gates reject current harness output.**
   `check-benchmark-report.mjs` expects removed manifest counters in the VT-close
   report and an XR GPU-duration object for the nonimmersive XR report. Helmet,
   texture-materials, and Sponza pass the checker with warnings. Static scenes
   can produce fewer renderer callbacks than RAF samples, and Quest does not
   expose the GPU timer extension. Exact output is in `quest-report-checks.log`.

## Scope and artifacts

- `summary.json`: initial-run metrics and renderer counters; heed timing caveats.
- `ipad/`, `quest/`: raw reports, direct texture results, clock samples, captures.
- `focused-unit-tests.log`: 85/85 tests across texture GPU owner, texture asset
  owner, surface texture planning, and VT presentation.
- `source.json`: exact clean production-build identity.
- `harness-attempts/`: stale Safari-target timeout and obsolete tiger-route
  attempt. The removed route is not an application regression. Fresh Safari
  automation and the current example routes replaced those attempts.

Safari PNGs are canvas captures. Initial Quest PNGs use the existing DevTools
screenshot path, which shows panel tiling/cropping; `quest/sponza-canvas.png`
is a direct canvas capture and is the useful Sponza visual reference.
The current WebXR scene uses its ordinary tiger fallback; this is not a
standalone generated-SVG VT acceptance run.

Quest initially showed “Finding position in room.” Automatic approval review
rejected pausing/force-stopping Guardian; neither action executed. The supported
“Continue without tracking” UI button allowed Browser to run. Guardian services
and settings were not changed. All Quest results are stationary browser-panel
results: no tracked immersive XR or physical controller/orientation testing.

## Reproduction

Build the examples (`pnpm --filter @royal/examples-react build`) and serve their
production output on port 5193, reachable at `192.168.0.224` for the saved iPad
runners. Forward Quest's port 5193 with ADB and its browser debugger to 9222.
The `run-ipad-*.py` runners require the installed pymobiledevice3 Python
interpreter, USB trust, and enabled Safari automation. The saved Quest camera
runner expects Sponza already loaded and settled.

Build `compact-fallback-probe.ts` using Vite library mode with `configFile:false`,
ES format, and filename `compact-fallback-probe`. Serve that bundle and a simple
HTML document importing it at `/compact-fallback-probe.html`, then run the saved
compact-probe drivers. Keep this supplemental bundle separate from production
source identity; it tests the same checked-out renderer code directly.
