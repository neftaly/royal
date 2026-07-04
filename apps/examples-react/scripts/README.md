# Examples Benchmark

`benchmark-examples.mjs` builds a route-by-route browser report for the examples app.
It records load timing, frame pacing, heap growth, WebGL draw/upload counters,
low-overhead GL state counters (`useProgram`, `bindTexture`, `bindBuffer`,
`bindVertexArray`, and uniform calls), renderer glTF instancing deltas exposed
by the examples-only benchmark bridge, and instancing-focused summaries for
`/gltf-instancing` grid, seed, animation, local-model upload, and root-transform
upload cases.

Quick host check:

```sh
pnpm --filter @royal/examples-react bench:examples:quick
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

Quest 2 report through forwarded DevTools:

```sh
ROYAL_XR_PORT=4673 pnpm quest:browser reverse
QUEST_DEVTOOLS_PORT=9222 pnpm quest:browser forward
EXAMPLES_BENCH_BROWSER=cdp \
EXAMPLES_BENCH_DEBUG_PORT=9222 \
EXAMPLES_BENCH_FAKE_XR=0 \
EXAMPLES_BENCH_MODE=full \
EXAMPLES_BENCH_INSTANCING_SWEEP=full \
EXAMPLES_BENCH_OUTPUT=research/examples-benchmark-quest2.json \
pnpm --filter @royal/examples-react bench:examples
```

The default mode is `quick`: product routes, short frame windows, no instancing
fuzz rows, no `gltf-kitchen-sink-slow`, and no XR lab route. Use
`EXAMPLES_BENCH_MODE=full` for heavier product coverage, `labs` for explicit lab
routes such as `webxr-vr`, or `all` when you really want every route. Use
`EXAMPLES_BENCH_ROUTE=<id-or-prefix>` to narrow the run. For Quest runs, open or
keep any Quest Browser tab available before starting the benchmark; the script
navigates the first CDP page target through the selected routes.
`EXAMPLES_BENCH_FRAME_TIMEOUT_MS` bounds RAF warmup and sampling so a throttled
headset tab records a timeout row instead of hanging the run.
`EXAMPLES_BENCH_CDP_TIMEOUT_MS` bounds each DevTools command and defaults high
enough to cover the route-ready and frame-sampling windows.

iPad Safari through `ios_webkit_debug_proxy`:

```sh
pnpm --filter @royal/examples-react dev -- --host 0.0.0.0 --port 4673
ios_webkit_debug_proxy -u <ipad-udid>:9323-9323 -F
```

Keep Safari open and unlocked on the iPad with Safari Web Inspector enabled.
Then run a focused route benchmark from the host, replacing `<host-lan-ip>` with
the laptop LAN IP reachable by the iPad:

```sh
IPAD_BENCH_HOST=<host-lan-ip> \
pnpm --filter @royal/examples-react bench:ipad-safari -- --route=/gltf-instancing --frames=24 --warmup=8
```

Kitchen sink:

```sh
IPAD_BENCH_HOST=<host-lan-ip> \
pnpm --filter @royal/examples-react bench:ipad-safari -- --route=/gltf-kitchen-sink --frames=24 --warmup=8
```

The script drives the existing Safari tab over the WebKit inspector protocol,
navigates it to `?bench=auto`, waits for the in-page collector, and writes JSON
reports under `research/examples-benchmarks/ipad-safari/`. The collector runs
inside the real route so WebGL hooks install before the canvas initializes; it is
not a user-facing benchmark UI.

Browser instancing fuzz rows are opt-in with
`EXAMPLES_BENCH_INSTANCING_FUZZ=1`. Prefer fast property tests for structural
instancing invariants and keep browser fuzz rows as replayed perf probes.

## Review Notes

Fast fuzzers should keep deterministic replay rows next to the generator that
found or protects the edge case. Good next targets are:

- glTF material/texture normalization: fuzz optional extension source conflicts,
  image-key identity, missing image references, and cache-key reuse before adding
  more enumerated renderer scene regressions.
- Picking math: migrate the notched-bounds replay rows from
  `research/picking-fuzz` into a fast property test that checks ray/triangle
  agreement before broader WebGL picking smoke coverage.
- Text: fuzz layout metrics, keyboard/edit intents, texture cache keys, and
  atlas upload invalidation before adding more visual regression fixtures.

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

`bench:auto-vt-load` sets `EXAMPLES_GLTF_LOAD_FORCE_GENERATED_VT=1`, which
fails `.vt.json` sidecar requests through DevTools so the renderer exercises its
generated raster VT fallback. Clear that variable when measuring authored
sidecar manifests.

These are measurement reports, not CI thresholds. Prefer comparing saved JSON
reports across commits or devices.
