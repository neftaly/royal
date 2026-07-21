# Examples Benchmark

Local browser benchmarks and smoke tests require a hardware WebGL2 renderer.
They default to headless ANGLE/Vulkan, disable software rasterization, and fail
if Chromium reports SwiftShader, llvmpipe, lavapipe, or another software
renderer. `EXAMPLES_BENCH_GPU=hardware-headed` remains available when a visible
desktop Chromium window is preferable.

`benchmark-examples.mjs` builds a route-by-route browser report for the examples app.
It records browser load timing, DevTools navigation synchronization, renderer
readiness, frame pacing, heap growth, WebGL draw/upload counters,
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
`cameraInputHandlerP95Ms`, RAF context as `cameraDragRafP95Ms`, and hardware
timer-query duration for draw-producing RAF callbacks as `cameraDragGpuP95Ms`.
The timer query is active only during the drag sample. Use
`EXAMPLES_BENCH_ROUTE=gltf-helmet` or `gltf-instancing` with
`EXAMPLES_BENCH_CAMERA_DRAG=1 pnpm --filter @royal/examples-react bench:examples`
when you need renderer/glTF churn beside the same input metric. Do not add
route-specific fast paths to improve these numbers.

For a scenario selected by a route query, keep route filtering and scenario
selection separate. For example, profile the A Beautiful Game entry without
adding another example route:

```sh
EXAMPLES_BENCH_ROUTE=gltf-scenes \
EXAMPLES_BENCH_ROUTE_SEARCH='scene=a-beautiful-game' \
EXAMPLES_BENCH_CAMERA_DRAG=1 \
pnpm --filter @royal/examples-react bench:examples
```

For visual review of one selected hardware-rendered route, set
`EXAMPLES_BENCH_SCREENSHOT=/tmp/royal-route.png`. The harness captures the
settled first canvas after measurement and rejects a multi-route screenshot run.

For a one-frame, draw-by-draw GPU breakdown, add
`EXAMPLES_BENCH_GPU_DRAW_PROFILE=1` to a camera-drag run. The opt-in profile
records timer-query duration, element/vertex count, instance count, and stable
program/VAO identities for each draw, sorted slowest first under
`cameraDrag.frameStats.gpuDrawProfile.records`. Per-draw timer queries perturb
that profiled frame, so use it to locate expensive coverage or shader variants;
use the ordinary drag GPU p95 from a separate run for regression comparisons.
It profiles drag frame 1 by default; set the 1-based
`EXAMPLES_BENCH_GPU_DRAW_PROFILE_FRAME` to inspect a later camera view.
Ordinary timer summaries also retain the twelve slowest frame ordinals under
`gpuDurationMs.slowestSamples`, annotated with any shader links, buffer uploads,
texture storage/uploads, or mip generation submitted by the same RAF callback.

Focused virtual-texture near-plane stress:

```sh
EXAMPLES_BENCH_ROUTE=virtual-texture-stress \
EXAMPLES_BENCH_VT_CLOSE=1 \
EXAMPLES_BENCH_TRACE=1 \
pnpm --filter @royal/examples-react bench:examples
```

The harness prefers trusted wheel input until the map camera reaches 0.12 world
units. If a remote/headless browser accepts the DevTools command without
moving the React camera, it falls back to an equivalent DOM wheel event and
records `inputMode: "dom-fallback"` instead of producing a false benchmark
failure. It measures approach-frame pacing and WebGL/renderer deltas, waits for VT
requests to settle, captures the canvas, then records the normal steady-state
frame, heap, WebGL, trace, and renderer diagnostics. Override the target with
`EXAMPLES_BENCH_VT_CLOSE_DISTANCE`; the run fails instead of silently accepting
a camera that did not reach the requested distance. Reports retain the setup,
pre-frame, and post-frame renderer snapshots so newly added diagnostic fields
cannot disappear from the artifact merely because the summary has not learned
about them yet.

The focused VT browser smoke covers overview/focus presets, close and far zoom,
cache reactivation, camera pan, DPR-aware container resize, and a
landscape-to-portrait-to-landscape viewport cycle. Every transition must settle
with an available renderer and no pending VT work:

```sh
EXAMPLES_SMOKE_ROUTE=virtual-texture-stress \
pnpm --filter @royal/examples-react test:browser
```

The route deliberately visits enough distinct pages to upload more pages than
its 24 physical slots can retain. It also keeps a one-texel ordinary texture in
the same scene. The smoke requires fixed VT atlas bytes while slots are reused,
matching root-governor accounting, stable ordinary-texture residency, and zero
quarantined VT bytes throughout the camera, zoom, resize, and revisit sequence.

The same assertions can drive an already-open browser through a forwarded CDP
endpoint without launching Chromium or a preview server:

```sh
EXAMPLES_SMOKE_DEBUG_PORT=9222 \
EXAMPLES_SMOKE_BASE_URL=http://127.0.0.1:4674 \
EXAMPLES_SMOKE_ROUTE=virtual-texture-stress \
pnpm --filter @royal/examples-react test:browser:cdp
```

Set `EXAMPLES_SMOKE_DEBUG_HOST` when the endpoint is not local. Remote physical
browsers keep their native DPR. If they do not implement CDP device-metrics
overrides, the orientation subcheck reports that capability as unsupported
while the real CSS resize check still runs; it never treats an ignored override
as a successful orientation test. CDP commands have a 30-second default timeout,
overridable with `EXAMPLES_SMOKE_CDP_TIMEOUT_MS`, so a sleeping device cannot
stall the harness indefinitely.

Official GLB material cases can also gate their embedded browser-image decodes
after geometry becomes usable, capture the factor-only presentation, then
release every decode and require a stable visual refinement:

```sh
EXAMPLES_SMOKE_ROUTE=gltf-lab \
EXAMPLES_SMOKE_QUERY='case=SpecularTest' \
EXAMPLES_SMOKE_EMBEDDED_TEXTURE_GATE=1 \
pnpm --filter @royal/examples-react test:browser
```

The gate bypasses harness-owned screenshot decoding, so the before/after pixel
comparison measures Royal's texture publication rather than deadlocking its own
observer. `TransmissionThinwallTestGrid` covers the corresponding transmission
and thickness group.

The Ghostscript Tiger SVG route exposes the same React canvas in generated-VT
and ordinary-texture modes. Its focused smoke toggles the renderer option,
requires each distinct residency path to settle, captures the composited canvas
in both modes, then bounds mean RGB error below 1.5% and materially changed
pixels below 5%:

```sh
EXAMPLES_SMOKE_ROUTE=gltf-ghostscript-tiger-svg \
pnpm --filter @royal/examples-react test:browser
```

The same route can force the preferred extension SVG request to fail. The smoke
then requires the exact glTF asset to settle `ready`, report one fallback, and
render its ordinary core image rather than retaining a failed or duplicate
texture lifecycle:

```sh
EXAMPLES_SMOKE_ROUTE=gltf-ghostscript-tiger-svg \
EXAMPLES_SMOKE_SVG_FALLBACK=1 \
pnpm --filter @royal/examples-react test:browser
```

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

For V8/JavaScript-engine self-time, set `EXAMPLES_BENCH_CPU_PROFILE=1` or pass
an explicit `.cpuprofile` path. CPU-profile runs default
`EXAMPLES_BENCH_GL_COUNTERS=0`: the harness still observes draw completion and
camera latency and retains lightweight draw/submission counts, but does not
wrap every uniform, binding, and upload merely to count it. This avoids
attributing profiler allocation and self-time to the instrumentation itself.
Run a normal benchmark beside the profile for complete GL counters, or
explicitly set `EXAMPLES_BENCH_GL_COUNTERS=1` when that measurement overhead is
intentional. CPU-profile runs also omit forced heap
collections, which otherwise appear as renderer GC in the raw profile; their
heap block reports observed window growth instead of retained-after-GC growth.

Use the synthetic stereo loop as a repeatable host lifecycle oracle before a
physical headset run:

```sh
EXAMPLES_BENCH_ROUTE=webxr-vr \
EXAMPLES_BENCH_FAKE_XR=1 \
EXAMPLES_BENCH_XR_HZ=90 \
pnpm --filter @royal/examples-react bench:examples
```

The fake layer exposes the same framebuffer-size, ordered-view, viewport, and
session-RAF contracts consumed by Royal. The command and saved-report checker
both fail if activation does not complete or the requested XR frames are not
sampled; ordinary window RAF timing is never accepted as substitute evidence.

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

Quest device telemetry is an optional, decoupled sidecar rather than part of
the accepted browser report. Wrap the same command when firmware, battery,
thermal, package-memory, or filtered Browser/Adreno/runtime log context is
needed:

```sh
EXAMPLES_BENCH_BROWSER=cdp \
EXAMPLES_BENCH_DEBUG_PORT=9222 \
EXAMPLES_BENCH_FAKE_XR=0 \
EXAMPLES_BENCH_REAL_XR=1 \
EXAMPLES_BENCH_MODE=labs \
EXAMPLES_BENCH_ROUTE=webxr-vr \
EXAMPLES_BENCH_OUTPUT=research/examples-benchmarks/quest2-webxr.json \
pnpm quest:telemetry record \
  --output research/examples-benchmarks/quest2-webxr.telemetry.json \
  -- pnpm --filter @royal/examples-react bench:examples
```

The wrapper records bounded snapshots before and after the command, then reads a
bounded filtered logcat window without clearing device logs. Thermal snapshots
retain the hottest sensor of each Android thermal type. It writes a versioned
`royal-quest-telemetry` JSON document even when individual ADB probes fail, and
returns the wrapped command's exit status. It imports no Royal package or
benchmark code, and it runs no ADB observer while the wrapped command is active.
The before/after probes still add time outside the command. Set `ANDROID_SERIAL`
or pass `--serial` when more than one ADB device is connected.

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
With `EXAMPLES_BENCH_TRACE=1`, real-XR tracing starts on the fresh debugger
attachment used for activation and measurement. Trace finalization is
best-effort: a driver/CDP timeout is retained under `report.trace.failure` and
does not discard otherwise complete route metrics.
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

Add `--cold-cache=true` to disable WebKit resource caching for the inspected
target. Use it for load-path evidence; omit it for steady-state frame samples.
Failure reports retain the last responsive renderer/resource progress sample,
so a later inspector stall does not erase where the load reached.
Add `--camera-drag=true` to make every measured frame follow one synthetic
one-pixel orbit step through the ordinary React pointer path. The resulting p95
is input-to-presenting-RAF latency, and renderer/GL deltas prove that the sample
drew rather than measuring an idle display clock.
Add `--capture-canvas=true` to retain a PNG of the final physical canvas beside
the JSON report. This is useful for texture-corruption and fidelity regressions:
the image is captured only after readiness, warmup, and measured motion complete.
Add `--capture-current-page=true` when investigating an already-visible issue.
Before navigation, the collector writes the existing URL, benchmark/renderer
state, query-stripped resource timing entries, console/runtime diagnostics, and
a canvas PNG when the canvas is origin-clean. Because WebGL may discard the
presented back buffer, the capture
explicitly draws the retained current scene once before reading pixels; it does
not navigate or reload. Capture failure is recorded without preventing the
requested fresh benchmark, so stale-build and current-build evidence remain
distinct.

Kitchen sink:

```sh
IPAD_BENCH_HOST=<host-lan-ip> \
pnpm --filter @royal/examples-react bench:ipad-safari -- --route='/gltf-lab?case=Box' --frames=24 --warmup=8
```

For a real orientation lifecycle check, start the route in either orientation,
run the command below, and rotate the unlocked iPad once when the script prints
its waiting message:

```sh
IPAD_BENCH_HOST=<host-lan-ip> \
pnpm --filter @royal/examples-react bench:ipad-safari -- \
  --route=/virtual-texture-stress --frames=24 --warmup=8 \
  --wait-for-orientation=true --orientation-timeout-ms=120000
```

This records both physical viewports in one report and requires the same
renderer root to advance a frame, resize its drawing buffer at the physical
DPR, remain available, and return VT demand to zero pending pages. It does not
substitute an emulated device-metrics override.

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

Context restoration is also exercised against real texture residency rather
than only an empty/simple scene. The focused VT routes require active atlas and
page-table resources to reconverge with no pending work, new failures or
overflows, or quarantined bytes after `WEBGL_lose_context` restoration:

```sh
EXAMPLES_SMOKE_CONTEXT_LOSS=1 EXAMPLES_SMOKE_ROUTE=virtual-texture-stress \
pnpm --filter @royal/examples-react test:browser

EXAMPLES_SMOKE_CONTEXT_LOSS=1 EXAMPLES_SMOKE_ROUTE=gltf-ghostscript-tiger-svg \
pnpm --filter @royal/examples-react test:browser
```

The focused Helmet smoke delays normal, metallic-roughness, occlusion, and
emissive images independently. Each fresh mount must remain presentable with
authored base color, then produce a composited refinement above a same-state
repeat-capture noise floor. Narrow one probe while diagnosing with
`EXAMPLES_SMOKE_TEXTURE_PROBE=normal|metallic-roughness|occlusion|emissive`.

Official material cases can be isolated without creating more example routes.
The glTF Lab fits the selected asset from prepared bounds, so wide grids remain
complete visual oracles rather than inheriting one fixed test camera:

```sh
EXAMPLES_SMOKE_ROUTE=gltf-lab \
EXAMPLES_SMOKE_QUERY='case=SpecularTest' \
pnpm --filter @royal/examples-react test:browser

EXAMPLES_SMOKE_ROUTE=gltf-lab \
EXAMPLES_SMOKE_QUERY='case=TransmissionThinwallTestGrid' \
pnpm --filter @royal/examples-react test:browser
```

The unfiltered browser smoke also opens the query-only React lifecycle probe.
It verifies StrictMode cleanup plus semantic renderer-option replacement, an
active `useFrame` clock stopping on unmount, disposal during a delayed VT
manifest request, and creation of a fresh usable root on remount. It also
checks lifecycle/glTF-status observer resubscription and scheduled-frame
failure delivery through an ErrorBoundary followed by a clean reset. Disposed
checkpoints must have no live governor leases, GPU allocations, or VT work. The
context-option checkpoint also requires a distinct connected canvas, a detached
old canvas, callback-ref cleanup before reattachment, and no stale coalesced
pointer move after replacement. The probe is code-split from the ordinary app
path and is not an example route or
package export.

For a focused rerun without visiting every example first:

```sh
EXAMPLES_SMOKE_REACT_LIFECYCLE=1 EXAMPLES_SMOKE_ROUTE=cube \
pnpm --filter @royal/examples-react test:browser
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

For a visual cold-load timeline, set `EXAMPLES_GLTF_LOAD_FILMSTRIP_DIR` to an
empty output directory. A separate CDP session captures viewport PNGs without
adding instrumentation to renderer code; `EXAMPLES_GLTF_LOAD_FILMSTRIP_INTERVAL_MS`
controls the requested cadence. Screenshot capture perturbs timing, so compare
performance with a separate ordinary run. Set `EXAMPLES_GLTF_LOAD_CPU_PROFILE`
to retain the navigation-through-settlement V8 profile instead.
Set `EXAMPLES_PROFILE_SOURCEMAPS=1` only for source attribution. It emits hidden
maps beside the production-shaped chunks without publishing map URLs to the
browser; keep a normal no-map run as the timing baseline because generating the
large maps can disturb a memory-constrained host before the benchmark starts.

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
