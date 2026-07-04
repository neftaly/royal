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
