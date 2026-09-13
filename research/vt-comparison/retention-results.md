# Live-scene heap retention

Date: 2026-09-13. Renderer source is unchanged from the
[warmed profile checkpoint](steady-profile-sources.json). All changes remain uncommitted.

The earlier profiles showed roughly 335–405 KB of live JS heap growth over 600
frames. To check whether this continued, the host runner now accepts
`VT_RETENTION_WINDOWS=6`: prepare one scene, run six successive 600-frame windows,
and force GC before the first window and after each window. Tracing and CPU/heap
sampling are disabled. Scene snapshots, pixel reads, screenshots and disposal
happen only after the last heap sample. Timing buffers are reused between windows;
reported frame statistics describe the last window only.

All runs use headless Chromium on the Intel Iris Xe host GPU through ANGLE Vulkan.
The measured period totals 3,600 frames per fixture. It reuses a warmed camera path
and resident pages; it does not measure streaming, scene replacement, or disposal.

## Results

Live JS heap bytes after forced GC:

| Fixture | Baseline | Window 1 | Window 2 | Window 3 | Window 4 | Window 5 | Window 6 | Growth after window 3 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| [svg-fixed](retention-svg-fixed.json) | 2,324,736 | 2,549,072 | 2,550,328 | 2,568,124 | 2,568,124 | 2,568,124 | 2,569,536 | 1,412 |
| [svg-moving](retention-svg-moving.json) | 2,336,080 | 2,617,968 | 2,616,848 | 2,631,192 | 2,631,764 | 2,632,172 | 2,633,584 | 2,392 |
| [raster-moving](retention-raster-moving.json) | 2,154,308 | 2,443,456 | 2,442,336 | 2,456,764 | 2,458,048 | 2,458,188 | 2,459,600 | 2,836 |

Every run finishes with 21 resident pages, no new page requests, and zero pending,
unresident or failed pages. The early increase tapers off rather than repeating
at the initial rate. These fixtures therefore do not establish a steady per-frame
leak. They also do not prove that all VT lifetimes are leak-free: engine compilation,
CDP overhead and other browser state remain in the heap totals, and this is one
browser/GPU configuration with short, already-resident scenes.

The allocation profiles still identify recurring temporary allocations in pool
budget distribution and runtime update. Those remain worthwhile performance
candidates independently of retained heap size.

## Reproduction and review

Serve the current generated candidate build on port 5186, then run:

```sh
VT_RETENTION_WINDOWS=6 \
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/steady.html?case=svg&motion=move' \
VT_BENCH_OUTPUT=research/vt-comparison/retention-svg-moving.json \
node research/vt-comparison/run-host.mjs
```

Omit `motion=move` for the fixed SVG case; use `case=raster&motion=move` for raster.
The runner rejects retention mode with `VT_PROFILE` and requires a preparation
hook. Retention results have a separate `retention` field and do not report zero
GC events as though GC had been traced. Review checked that only one preparation
and cleanup occur, every measured window is awaited, and diagnostics occur after
the final forced-GC heap sample. Node syntax and whitespace checks pass. No
production code changed in this pass.
