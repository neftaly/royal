# Repeated VT source replacement and cancellation

Date: 2026-09-13. Research-only pass; production changes remain uncommitted.

The steady-scene heap check did not exercise source replacement. The new
`lifecycle.html` fixture retains one renderer root, repeatedly loads a texture from
a unique URL, then clears the scene. Each of six measurement windows includes six
fully resident textures and two early replacements. Four warm-up cycles precede
measurement. Forced GC occurs between windows, while the root is alive and empty.

Every removal must clear reported atlas bytes, resident/pending pages, automatic
resources and automatic decoded bytes. Frames are checked for renderer/GL errors.
An early replacement on the local server is not guaranteed to interrupt a read;
indeed the normal fixtures observed zero aborts. The `delay=1` control holds each
source fetch for 100 ms before forwarding it to native fetch. Early replacement
waits for that read gate to start, then clears the scene. Both delayed controls
observe twelve abort signals and finish without active gated reads.

This exercises cancellation before native fetch starts, not interruption of an
actual network body or a late browser bitmap decode. Unit tests cover late bitmap
closure separately. Fetch instrumentation ends at response headers. Root disposal
runs as cleanup after the final heap sample; this pass does not measure heap after
root disposal or repeated root creation. It covers ordinary raster and SVG sources;
marked ASTC preview replacement is a separate remaining lifetime check.

## Results

All four fixtures pass: 144 fully resident loads, 48 early replacements and 24
observed aborts across the measured windows. Each removal returns all checked VT
ownership counters to zero; every final snapshot has zero atlas pools and zero
failed/pending/resident pages. Headless Intel Iris Xe through ANGLE Vulkan only.

Live JS bytes after forced GC:

| Fixture | Observed aborts | Baseline | Window 1 | Window 2 | Window 3 | Window 4 | Window 5 | Window 6 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| [svg](lifecycle-svg.json) | 0 | 2,556,828 | 2,962,648 | 3,082,260 | 3,114,608 | 3,198,980 | 3,202,100 | 3,271,016 |
| [raster](lifecycle-raster.json) | 0 | 2,298,972 | 2,677,588 | 2,793,900 | 2,835,448 | 2,870,792 | 2,874,640 | 2,936,296 |
| [svg-delayed](lifecycle-svg-delayed.json) | 12 | 2,538,188 | 2,944,840 | 3,102,632 | 3,125,008 | 3,253,364 | 3,299,264 | 3,330,720 |
| [raster-delayed](lifecycle-raster-delayed.json) | 12 | 2,292,800 | 2,667,704 | 2,812,760 | 2,852,368 | 2,932,972 | 2,977,020 | 3,009,076 |

Heap growth slows after the first window but does not clearly plateau. These data
prove the checked ownership releases, not absence of JS retention. Further work
should compare unique versus reused source identities over longer runs and inspect
heap retainers if growth persists. Browser/engine warm-up and harness allocations
remain in these totals. Snapshots, frame waits, URL construction, gate timers and GL
checks are deliberate lifecycle test overhead; no frame-speed claim is made.

## Review and reproduction

Review checked that windows reuse the same root, source identities change, removal
waits for reported ownership release, delayed cases actually observe cancellation,
and native fetch and context resources are restored/disposed at cleanup. A second
pass corrected the generic runner's retention note: a prepared fixture may replace
its scene, and lifecycle diagnostics intentionally run inside the windows. The two
initial reports received this wording correction only; measured values were not
changed. TypeScript, Node syntax, Vite build and whitespace checks pass.

Serve the current generated build and run:

```sh
VT_RETENTION_WINDOWS=6 \
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/lifecycle.html?case=svg&delay=1' \
VT_BENCH_OUTPUT=research/vt-comparison/lifecycle-svg-delayed.json \
node research/vt-comparison/run-host.mjs
```

Use `case=raster` for PNG and omit `delay=1` for the local-fetch control.
[Production source hashes](lifecycle-sources.json) identify the tested checkpoint.
