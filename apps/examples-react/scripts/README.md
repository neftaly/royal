# Examples Benchmark

`benchmark-examples.mjs` builds a route-by-route browser report for the examples app.
It records load timing, frame pacing, heap growth, WebGL draw/upload counters, and
instancing-focused summaries for `/gltf-instancing` grid, seed, and animation cases.

Quick host check:

```sh
EXAMPLES_BENCH_ROUTE=gltf-instancing \
EXAMPLES_BENCH_INSTANCING_SWEEP=quick \
EXAMPLES_BENCH_INSTANCING_CASES=1 \
EXAMPLES_BENCH_FRAMES=24 \
EXAMPLES_BENCH_WARMUP_FRAMES=8 \
pnpm --filter @royal/examples-react bench:examples
```

Fuller host report:

```sh
EXAMPLES_BENCH_INSTANCING_SWEEP=full \
EXAMPLES_BENCH_OUTPUT=research/examples-benchmark-host.json \
pnpm --filter @royal/examples-react bench:examples
```

Quest 2 report through forwarded DevTools:

```sh
ROYAL_XR_PORT=4673 pnpm quest:browser reverse
QUEST_DEVTOOLS_PORT=9222 pnpm quest:browser forward
EXAMPLES_BENCH_BROWSER=cdp \
EXAMPLES_BENCH_DEBUG_PORT=9222 \
EXAMPLES_BENCH_FAKE_XR=0 \
EXAMPLES_BENCH_INSTANCING_SWEEP=full \
EXAMPLES_BENCH_OUTPUT=research/examples-benchmark-quest2.json \
pnpm --filter @royal/examples-react bench:examples
```

Use `EXAMPLES_BENCH_ROUTE=<id-or-prefix>` to narrow the run. For Quest runs, open
or keep any Quest Browser tab available before starting the benchmark; the script
navigates the first CDP page target through the selected routes.

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
`analysis.slowestRoutesByP95`, `analysis.heaviestDrawRoutes`, and the instancing
per-1000-instance summaries. Components that move those counters independently
are good extraction candidates; components whose counters always move together
should stay behind one renderer-owned boundary until a benchmark row separates
them.

Focused checks:

```sh
ROYAL_FUZZ_CASES=64 pnpm exec vitest run tests/*property*.test.ts
node --check apps/examples-react/scripts/benchmark-examples.mjs
EXAMPLES_BENCH_ROUTE=gltf-instancing EXAMPLES_BENCH_INSTANCING_SWEEP=quick EXAMPLES_BENCH_FRAMES=24 EXAMPLES_BENCH_WARMUP_FRAMES=8 pnpm --filter @royal/examples-react bench:examples
```
