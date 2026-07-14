# Examples Benchmark

Local browser benchmarks and smoke tests require a hardware WebGL2 renderer.
They default to headless ANGLE/Vulkan, disable software rasterization, and fail
if Chromium reports SwiftShader, llvmpipe, lavapipe, or another software
renderer. `EXAMPLES_BENCH_GPU=hardware-headed` remains available when a visible
desktop Chromium window is preferable.

`benchmark-examples.mjs` builds a route-by-route browser report for the examples app.
It records load timing, frame pacing, heap growth, WebGL draw/upload counters,
low-overhead GL state counters (`useProgram`, `bindTexture`, `bindBuffer`,
`bindVertexArray`, and uniform calls), renderer glTF instancing deltas exposed
by the examples-only benchmark bridge, and instancing-focused summaries for
`/gltf-instancing` grid, seed, animation, local-model upload, and root-transform
upload cases. Every run also retains bounded, structured page-console, runtime
exception, and browser security/network diagnostics. Successful runs embed them
as `browserDiagnostics`; aborted runs write an adjacent `*.failure.json` with
the active route, page state, canvas dimensions, renderer snapshot, and diagnostics.

Quick host check:

```sh
pnpm --filter @royal/examples-react bench:examples:quick
```

Focused input latency check:

```sh
pnpm --filter @royal/examples-react bench:examples:input
```

This runs the existing route benchmark on `/cube` with scripted camera drag
enabled and reports pointermove-to-next-WebGL-draw latency as
`cameraDragDrawP95Ms`, direct synchronous handler self-time as
`cameraInputHandlerP95Ms`, plus RAF context as `cameraDragRafP95Ms`. Use
`EXAMPLES_BENCH_ROUTE=gltf-helmet` or `gltf-instancing` with
`EXAMPLES_BENCH_CAMERA_DRAG=1 pnpm --filter @royal/examples-react bench:examples`
when you need renderer/glTF churn beside the same input metric. Do not add
route-specific fast paths to improve these numbers.

Fuller host report:

```sh
EXAMPLES_BENCH_OUTPUT=research/examples-benchmark-host.json \
pnpm --filter @royal/examples-react bench:examples:full
```

Check a saved report:

```sh
pnpm --filter @royal/examples-react bench:examples:check research/examples-benchmark-host.json
```

When run through `pnpm --filter`, relative report paths resolve from the
directory where `pnpm` was invoked, so repo-root paths work as shown above.

For a focused flame-graph-compatible Chrome/Quest trace, add
`EXAMPLES_BENCH_TRACE=1`. The harness writes an adjacent `*.trace.json` that can
be opened in Chrome DevTools or Perfetto. Tracing is opt-in because it adds
measurement overhead: keep the untraced report as the performance baseline and
use the traced run to explain it. `EXAMPLES_BENCH_TRACE_OUTPUT` can override the
derived trace path. Raw traces are ignored by Git because they are large local
diagnostic artifacts; summarize durable findings beside the accepted report.

Quest 2 report through forwarded DevTools:

```sh
ROYAL_XR_PORT=4673 pnpm quest:browser reverse
QUEST_DEVTOOLS_PORT=9222 pnpm quest:browser forward
EXAMPLES_BENCH_BROWSER=cdp \
EXAMPLES_BENCH_DEBUG_PORT=9222 \
EXAMPLES_BENCH_FAKE_XR=0 \
EXAMPLES_BENCH_REAL_XR=1 \
EXAMPLES_BENCH_MODE=full \
EXAMPLES_BENCH_INSTANCING_SWEEP=full \
EXAMPLES_BENCH_OUTPUT=research/examples-benchmark-quest2.json \
pnpm --filter @royal/examples-react bench:examples
```

On Quest Browser 148 the standard `@chrome_devtools_remote` socket is still
used, but it exists only while the Browser process is active. If port 9222 is
empty, keep a normal page visible in the headset and diagnose before forwarding:

```sh
pnpm quest:browser sockets
QUEST_DEVTOOLS_PORT=9222 pnpm quest:browser forward
pnpm quest:browser tabs
```

`forward` now verifies both the abstract socket and `/json/list`; it no longer
reports success for a missing or inactive socket. Logcat is useful for Browser
process/crash diagnosis, but page `console` output and benchmark control travel
over CDP or the in-page benchmark bridge rather than Android logcat.
`EXAMPLES_BENCH_REAL_XR=1` uses a trusted CDP input event to press the example's
Enter XR control and samples the physical `XRSession` frame loop. Keep the
headset worn and the Browser foregrounded; a sleeping display is recorded as an
activation/RAF failure rather than mistaken for a zero-millisecond result.
Physical activation waits up to 20 seconds for Quest's immersive transition;
`EXAMPLES_BENCH_XR_PREPARE_TIMEOUT_MS` overrides that window.
A background immersive session can continue owning Quest's single XR slot while
Browser is foregrounded. The harness classifies that state as
`immersive-session-already-active` and rejects it as a new performance run;
test background suspend/resume separately from foreground frame pacing.

The default mode is `quick`: product routes, short frame windows, no instancing
fuzz rows, one manifest-selected glTF lab case, and no XR lab route. Use
`EXAMPLES_BENCH_MODE=full` for heavier product coverage, `labs` for explicit lab
routes such as `webxr-vr`, or `all` when you really want every route. Use
`EXAMPLES_BENCH_ROUTE=<id-or-prefix>` to narrow the run. For Quest runs, open or
keep any Quest Browser tab available before starting the benchmark. The script
retains the first page target, closes surplus page tabs (without touching
Browser/system targets), resets the retained tab through `about:blank`, and
navigates through uniquely tagged route URLs. This keeps old dev/HMR documents
and their replayed console history out of production runs.
`EXAMPLES_BENCH_FRAME_TIMEOUT_MS` bounds RAF warmup and sampling so a throttled
headset tab records a timeout row instead of hanging the run.
`EXAMPLES_BENCH_CDP_TIMEOUT_MS` bounds each DevTools command and defaults high
enough to cover the route-ready and frame-sampling windows.

iPad Safari through `ios_webkit_debug_proxy`:

```sh
pnpm --dir apps/examples-react exec vite --config vite.config.ts --host 0.0.0.0 --port 4673
ios_webkit_debug_proxy -u <ipad-udid>:9323-9323 -F
```

Keep Safari open and unlocked on the iPad with Safari Web Inspector enabled.
Verify the proxy before running a benchmark; `/json` must contain a
`webSocketDebuggerUrl` rather than an empty page list:

```sh
curl -sS http://127.0.0.1:9323/json
```

Then run a focused route benchmark from the host, replacing `<host-lan-ip>` with
the laptop LAN IP reachable by the iPad:

```sh
IPAD_BENCH_HOST=<host-lan-ip> \
pnpm --filter @royal/examples-react bench:ipad-safari -- --route=/gltf-instancing --frames=24 --warmup=8
```

Kitchen sink:

```sh
IPAD_BENCH_HOST=<host-lan-ip> \
pnpm --filter @royal/examples-react bench:ipad-safari -- --route='/gltf-lab?case=Box' --frames=24 --warmup=8
```

The script drives the existing Safari tab over the WebKit inspector protocol,
navigates it to `?bench=auto`, waits for the in-page collector, and writes JSON
reports under `research/examples-benchmarks/ipad-safari/`. The collector runs
inside the real route so WebGL hooks install before the canvas initializes; it is
not a user-facing benchmark UI. Reports are rejected unless route readiness,
warmup, frame sampling, the final WebGL device summary, and the final renderer
snapshot are all present; a transient canvas is not accepted as device evidence.
The iPad collector also embeds WebKit console/runtime diagnostics and rejects
browser errors. Aborted or incomplete runs write a timestamped `*.failure.json`
beside the accepted reports, including the last page state and partial report.
For Safari flame charts, use a Safari Web Inspector recording; WebKit's inspector
transport does not expose Chrome's `Tracing` domain used by the Quest harness.

Browser instancing fuzz rows are opt-in with
`EXAMPLES_BENCH_INSTANCING_FUZZ=1`. Prefer fast property tests for structural
instancing invariants and keep browser fuzz rows as replayed perf probes.

## Review Notes

Fast fuzzers should keep deterministic replay rows next to the generator that
found or protects the edge case. glTF material/texture normalization is covered
by `tests/renderer-webgl-gltf-texture-validation.property.test.ts`; the notched
bounds replay and ray/triangle agreement are covered by
`tests/renderer-webgl-picking-math.test.ts`. Add new fuzz targets from observed
failures or measured coverage gaps rather than restoring enumerated scene
regressions. Text/UI rendering is outside Royal's renderer scope.

Use benchmark output as a decomposition guide by sorting routes through
`analysis.slowestRoutesByP95`, `analysis.heaviestDrawRoutes`,
`analysis.heaviestGlStateRoutes`, `analysis.heaviestUniformRoutes`, and the
instancing per-1000-instance and renderer glTF upload summaries. Components
that move those counters independently are good extraction candidates;
components whose counters always move together should stay behind one
renderer-owned boundary until a benchmark row separates them.

Focused checks:

```sh
ROYAL_FUZZ_CASES=64 pnpm exec vitest run tests/*property*.test.ts
node --check apps/examples-react/scripts/benchmark-examples.mjs
node --check apps/examples-react/scripts/check-benchmark-report.mjs
pnpm --filter @royal/examples-react bench:examples:instancing
```

## glTF Load Probe

`benchmark-gltf-load.mjs` is a narrow browser probe for textured glTF load
latency. It runs `/gltf-helmet`, records first WebGL draw, first usable
nonblank canvas draw, first texture upload, first usable frame after a texture
upload, fully loaded resource-stable time, VT manifest/page resource counts,
generated raster VT page prep counters/time from the renderer snapshot, texture
resource counts, texture allocation/upload calls, rough upload bytes, and CDP
heap growth before/after GC.

It also reports texture upload bytes per call and optional WebGL disjoint
timer-query samples under `metrics.renderFrame.gpuMs`. Timer-query output
includes support, pending, and disjoint counts; no CPU proxy is substituted
when GPU timing is unavailable. Renderer VT snapshots include atlas upload
chunk size and queue-to-upload average/max/by-mip wait timings.

```sh
EXAMPLES_GLTF_LOAD_OUTPUT=research/gltf-load-host.json \
pnpm --filter @royal/examples-react bench:gltf-load
```

Focused auto-VT load and hitch probe:

```sh
EXAMPLES_GLTF_LOAD_OUTPUT=research/auto-vt-load-host.json \
pnpm --filter @royal/examples-react bench:auto-vt-load
```

The auto-VT slice samples a bounded fixed RAF window after first usable draw
while VT pages may still be loading/uploading. It reports frame pacing, the
settle frame, GL texture-upload deltas, renderer VT counter deltas, max pending
VT pages, generated raster page request/rasterize counters, and optional
scripted camera drag:

```sh
EXAMPLES_GLTF_LOAD_VT_CAMERA_DRAG=1 \
EXAMPLES_GLTF_LOAD_VT_FRAMES=90 \
pnpm --filter @royal/examples-react bench:auto-vt-load
```

`bench:auto-vt-load` measures the examples app's explicit generated-raster VT
policy. It does not intercept requests or depend on authored manifests.

These are measurement reports, not CI thresholds. Prefer comparing saved JSON
reports across commits or devices.
