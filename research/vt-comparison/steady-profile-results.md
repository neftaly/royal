# Warmed VT CPU and allocation profiles

Date: 2026-09-13. Production checkpoint: [source hashes](steady-profile-sources.json).
This pass changes research tooling only. Production changes remain uncommitted.

## Measurement boundary

The new `steady.html` fixture loads and settles the scene, warms a complete camera
path, and returns to its initial pose before tracing starts. It then measures 600
frames with either a fixed camera plus explicit invalidation, or camera-resource
commits along the warmed path. No scene is rebuilt on every frame.

Snapshots, pixel reads, screenshots and cleanup occur after tracing/profiling
stops. The scene remains alive during both forced-GC heap measurements. The frame
loop uses one reusable rAF callback and timing calls, so harness overhead is not zero.
Fixed-camera results measure repeated rendering/invalidation, not idle power use.

All runs use headless Chromium on Intel Iris Xe through ANGLE Vulkan. They issue
zero new page requests during measurement and finish with zero pending, missing
or failed pages. Source-map attribution uses the exact generated build maps;
raw CPU and heap sampling profiles are retained alongside each JSON result.

## Results

| Fixture | Submission median / p95 | GC events / time | Estimated sampled allocations |
| --- | ---: | ---: | ---: |
| [SVG fixed camera](steady-svg-fixed.json) | 0.2 / 0.3 ms | 4 / 4.96 ms | 2.98 MB |
| [SVG moving camera](steady-svg-moving.json) | 0.2 / 0.4 ms | 5 / 5.09 ms | 4.20 MB |
| [Raster moving camera](steady-raster-moving.json) | 0.2 / 0.4 ms | 6 / 5.20 ms | 4.72 MB |

These are sampling-profile timings, useful for context rather than ranking small
performance differences. The 32 KiB allocation sampling interval produces
estimates, not exact bytes or object counts.

[Allocation attribution](steady-allocation-summary.json) assigns native allocation
frames to their nearest source-mapped JavaScript ancestor. The leading VT costs
are the runtime update loop, pool-budget allocation and atlas-budget calculations.
For fixed SVG, sampled pool-budget allocation is about 525 KB and runtime update
about 689 KB; for moving SVG these are about 951 KB and 787 KB. Other allocations
come from camera commits, visibility/matrix calculations, frame scheduling and
demand set maintenance.

The profile therefore justifies investigating pool-budget work even when camera
and page demand are stable. The current allocator creates a result map, filtered
pending arrays and callbacks; the runtime also rebuilds pool requests each frame.
A single-pool case may be simplified without changing multi-pool fairness. No
production allocator change was made during this profiling pass.

Post-GC JS heap rises by approximately 335–405 KB over these runs. Both heap
samples precede final snapshots and screenshots, with the scene alive. The
measurement still includes profiler/trace and engine warm-up effects; it does not
establish a leak. An unprofiled repeated-window check should distinguish settling
from sustained growth before making that claim. No new texture pages or decoded
source images were requested during the measured frames.

## Reproduction

```sh
VT_SOURCEMAP=1 node research/vt-comparison/build-client.mjs
VT_PROFILE=1 VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/steady.html?case=svg&motion=move' VT_BENCH_OUTPUT=/tmp/steady-svg.json node research/vt-comparison/run-host.mjs
```

Serve `node_modules/.cache/royal-vt-build-after` on the selected port. The runner
uses optional prepare/finish/cleanup hooks; older fixtures retain their existing
measurement boundary. `.cpuprofile` and `.heapprofile` files preserve raw samples.
`steady-allocation-summary.json` can be regenerated with
`summarize-steady-profile.mjs` and matching build maps.

The harness passes its TypeScript check and production Vite build. The runner's
syntax and all three prepare/measure/finish/cleanup runs pass. No additional
production test run was needed for this research-only change.

## Diagnostic image correction (2026-09-13)

The old steady-fixture image/pixel comparisons do not establish visual equivalence:
a later audit found that finish-hook readback could occur after WebGL discarded
the drawing buffer. Identical black images were therefore an invalid visual oracle.
Timing, allocation profiles and VT state counters were captured separately and
remain the recorded measurements. The separate source-combination rendering gates
are unaffected. See [the diagnostic redraw review](diagnostic-redraw-review.md).
