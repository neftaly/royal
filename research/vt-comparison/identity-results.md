# Source identity control for lifecycle retention

Date: 2026-09-13. Research-only pass; no production changes or commits.

The prior lifecycle runs released reported VT ownership but retained additional JS
heap. This control doubles each run to twelve windows (96 measured replacements)
and compares unique source URLs with a single reused source URL. Each window still
has six fully resident loads and two early replacements. One empty renderer root
remains alive at each forced-GC sample. Native local fetch is used, without the
delayed cancellation gate. SVG runs unique then reused; raster reverses the order.

All runs use headless Intel Iris Xe through ANGLE Vulkan. Across four runs there
are 288 resident loads and 96 early replacements. Every removal clears the checked
VT ownership counters, with no frame/GL errors and no failed pages. These local
fetch runs observe no aborts; controlled abort coverage remains in the earlier
[lifecycle report](lifecycle-results.md).

## Results

Live JS heap bytes after forced GC:

| Fixture | Baseline heap | After 48 replacements | After 96 replacements | Last 48 growth |
|---|---:|---:|---:|---:|
| [svg-unique](identity-svg-unique.json) | 2,558,424 | 3,273,120 | 3,406,128 | 133,008 |
| [svg-reuse](identity-svg-reuse.json) | 2,558,572 | 3,273,056 | 3,406,168 | 133,112 |
| [raster-reuse](identity-raster-reuse.json) | 2,300,608 | 2,936,136 | 3,049,420 | 113,284 |
| [raster-unique](identity-raster-unique.json) | 2,302,696 | 2,940,304 | 3,051,136 | 110,832 |

Unique and reused URL traces are nearly identical, especially for SVG. The late
increase is therefore not explained by keeping a new entry for every distinct
source URL in this fixture. This does not rule out other retained renderer state,
browser/engine warm-up or diagnostic effects. Reusing a URL also changes browser
cache identity, so it is a control for the combined workload, not an isolated test
of a particular renderer map.

There is still measurable growth in the last six windows. A heap snapshot comparison
is the next step: determine whether the increase consists of retained scene/source
objects, engine code/metadata, or unrelated state before changing production code.
No leak-free claim or frame-performance claim follows from these runs.

## Review and reproduction

The harness adds only `reuse=1`; geometry, material creation, root lifetime, load/
removal sequence and ownership assertions stay the same. A second review checked
that reuse does not accidentally retain a live texture: the scene is emptied and
VT resource/atlas counters must reach zero after every cycle in both variants.
TypeScript, Vite build and whitespace checks pass. Renderer code is unchanged from
[the lifecycle checkpoint](lifecycle-sources.json).

```sh
VT_RETENTION_WINDOWS=12 \
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/lifecycle.html?case=svg&reuse=1' \
VT_BENCH_OUTPUT=research/vt-comparison/identity-svg-reuse.json \
node research/vt-comparison/run-host.mjs
```

Omit `reuse=1` for unique identities and select `case=raster` for PNG. Full window
heaps, ownership snapshots and renderer identity are in the linked JSON reports.
