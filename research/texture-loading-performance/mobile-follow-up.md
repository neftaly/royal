> Historical measurements below are superseded for stability by the
> [repeated review and final device checks](mobile-stability-review.md).

# Physical mobile follow-up

The available iPad is **iPad7,6 / iPadOS 17.7.11**.
All changes remain uncommitted. Nova release assets remain unchanged.

## iPad startup and autonomous testing

The previous `schema_tools.artifact_build_invalid` failure was reproduced with
its nested issue: `bundle_parse_failed`, `TypeError`. The LAN HTTP page had no
`crypto.subtle`. Serving the same production build over HTTPS enables Web Crypto
and loads the full game. No application cryptography fallback was introduced.

`serve-ipad.mjs` binds the Wi-Fi interface and rejects every source address except
the known iPad (192.168.0.80). Its temporary certificate lives under `/tmp`.
`check-ipad-game.py` opts into WebKit's automation-session certificate capability
only for the explicit local HTTPS test origin. It installs no device certificate
or permanent security setting. The capability is documented in
[WebKit's relay constants](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/inspector/remote/RemoteInspectorConstants.h).
An initial all-interface server request was rejected by automatic approval review;
the narrower source-restricted server was approved. Test servers are stopped
when the run is finished.

The test uses the current React fiber branch to read model readiness, records
context-loss events and renderer counters, captures the canvas after an explicit
render, and verifies a real Safari touch selects a picked piece. iPad automation
does not implement the desktop mouse command. Its touch release must omit
`pressedButton`; specifying `None` left the contact down. The final sequence
produced trusted pointerdown, touchstart, pointerup and touchend events.

## Measurements and remaining issue

`ipad-final.json` is the successful final render-and-touch check:

- First resident-image sample: 6.890 s.
- All 211 interaction models prepared: 19.132 s.
- Full detail: 57.378 s, followed by successful trusted touch selection.
- One graphics-context loss at 27.852 s, restored at 27.929 s. Rebuilding GPU
  contents subsequently repeated loading work.
- No captured page errors. GPU and raster-cache accounting remain within limits.

Runs without a context interruption settled around 42–43 seconds. A previous
successful full-game run also recovered a context loss and took approximately
62 seconds (that older harness starts timing after navigation). These timings
are not directly comparable to desktop: iPad renders 1536×1804 at DPR 2 and
requests 358 pages instead of the desktop's 207. Context loss remains intermittent;
this work does **not** claim it is fixed or that a speedup on Quest is measured.

A 5486×5486 AVIF expands to about 115 MiB before browser-native fitting, outside
the retained VT raster-cache accounting. AVIF and image-element resize canvases
now request CPU backing (`willReadFrequently`) to reduce transient GPU-backed
canvas pressure. This is a browser hint, not a hard bound on native decode memory.
Full-resolution native decode can still occur; authored previews or tiled sources
would address that upstream. The hint did not eliminate iPad context loss.

Before/after iPad canvas captures had mean absolute RGBA difference 0.000337/255,
with zero pixels differing by more than 8. There is no measured loading speedup
attributed to this hint (42.726 s before versus 43.036 s in a no-reset run).
Raw samples and failed harness iterations are retained in
`/tmp/royal-ipad-device-evidence`; screenshots are `/tmp/royal-ipad-*.png`.
JSON files with a `failure` are not counted as passing interaction tests.

## Quest 2 physical production follow-up

After explicit approval, “Continue without tracking” was selected. Quest Browser
then started normally. These are **stationary browser tests**, not an immersive
XR/controller test. The physical browser reports **Adreno (TM) 650**, Quest 2,
Oculus Browser 152; no SwiftShader or desktop emulation is involved.

- Initial production run: **33.845 s** to full detail.
- Repeat with cache disabled and no CPU profiler: **33.304 s** until all 211
  interaction models were ready, **33.818 s** to full detail.
- All 325 images and 147 requested pages were resident at readiness; the viewport
  was 1345×648 at DPR 1. No page errors, context interruptions, or failed pages.
- Trusted browser pointer-down/up selected the picked game piece successfully
  (`quest-interaction-latest.json`). This does not verify tracked controllers.

The earlier 42.610-second Quest result used development mode. It is not a
controlled before/after comparison with this production build. The latest
production optimization is now verified on the headset, but these runs do not
establish an additional speedup from the CPU-canvas hint.

The separate CPU-profile run reached first ready around 36 s and accumulated
11.858 s of main-thread long tasks. Samples include 4.219 s in `uniformMatrix4fv`,
1.465 s in `uniform4fv`, and 3.430 s of self time in surface draw submission.
Those are sampled CPU times, not additive estimates of recoverable loading time.
This points to draw batching and fewer repeated submissions as further work;
page rasterization itself accumulated only roughly 66 ms in the initial run.
A per-view uniform-cache experiment did not demonstrate savings in the tested
case and was removed. No speculative production optimization is retained.

The remote-device mode in `profile-nova.mjs` attaches to an existing CDP port,
preserves the real device viewport, and records current React model readiness.
Raw profile, screenshot, summary and CPU flame graph are under
`/tmp/royal-nova-profiles/quest-production-cpu/`; the separate timing run is under
`/tmp/royal-nova-profiles/quest-production-timing/`. Summary evidence is copied
into this directory as `quest-production-profile-summary.json` and
`quest-production-timing-summary.json`.

## Validation

25 browser texture-decoder tests, Royal typecheck/lint, and a clean Probability
literal-root `pnpm dev` smoke check pass. The dev route reports no page exceptions,
failed scripts or Vite errors. The final iPad check passes full-detail readiness,
budget/cache assertions, canvas capture and trusted touch selection. The remaining
mobile performance investigation is iPad context-loss pressure and Quest draw-submission cost.
