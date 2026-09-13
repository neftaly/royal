# Raster preview demand callbacks

Status: implemented, reviewed and validated. All changes remain uncommitted.

Raster preview authority uses an ordinary bitmap page source. It does not consume
SVG demand lists or cache SVG rasterized pages. The shared preview wrapper used
to expose both callbacks anyway. The runtime therefore built a fresh page-ID
array on camera-demand changes and allocated temporary IDs while probing a cache
that always returned false.

The wrapper now exposes `setDemand` and `hasCachedPage` only for SVG authority.
Raster previews follow the same optional-callback fast paths as ordinary raster
sources. SVG keeps both callbacks and its deferred demand forwarding. This adds
two source lines; the combined uncommitted renderer changes add 66 net lines
relative to 56130d34.

## Headless host-GPU allocation audit

[Before](raster-demand-callbacks-before.json) and
[after](raster-demand-callbacks-after.json) use the actual glTF loader, ASTC preview,
full-source decoder and renderer on headless Intel Iris Xe / ANGLE Vulkan.
Each case completes authoritative refinement before 360 moving-camera updates.
Raster cases also exercise atlas resizing and context restoration first.

The audit instruments `Array.from` outputs whose elements are mip/x/y page IDs.
The runtime's demand-list construction is the matching producer in these fixtures.
Counts include asynchronous page work during the measured camera updates.

| Authority | Arrays before → after | Page objects before → after |
| --- | ---: | ---: |
| SVG | 362 → 362 | 14,670 → 14,670 |
| PNG preview | 361 → 0 | 7,521 → 0 |
| Required WebP preview | 362 → 0 | 14,658 → 0 |

All three final screenshots match exactly. Full-source reads remain ASTC then
SVG/raster exactly once, and all cases report zero failed pages. The removal also
avoids temporary objects passed to useless cached-page probes; those objects are
not included in the table. This is an allocation audit, not a frame-time speedup
claim. Instrumentation itself affects cost, and many unrelated allocations remain.
The whole instrumented run records 53 GC events / 32.86 ms before versus 52 /
31.23 ms after; those aggregate figures include setup and diagnostics.

## Review and reproducibility

First review checked callback semantics: raster sources have no page cache and
never consume the retained demand list, so skipping both callbacks preserves
page reads, publication and cancellation. The runtime already avoids callback
argument evaluation when an optional method is absent. SVG retains its previous
behavior, confirmed by identical demand-list counts and rendered pixels.

Second review checked lifetime and measurement: pending/loaded raster authority
uses the same wrapper contract; the change adds no array, cache or scheduler.
The audit restores `Array.from` in a `finally` block and runs in an isolated
headless profile. Its source reader and renderer are disposed normally.

[The patch](raster-demand-callbacks.patch) and
[source hashes](raster-demand-callbacks-sources.json) identify the saved
uncommitted checkpoint. The browser builder accepts `VT_BASELINE_FILE` plus
`VT_BASELINE_MODULE=packages/renderer-webgl/src/virtual-texture/automatic-page-source.ts`
to override this module alone, with identical entrypoints in both builds.
Run `source-combinations.html?demand-audit` through the existing headless runner.

Final validation passes 66 targeted preview/page-source/runtime tests, root and
research harness type checking, renderer lint, packed consumer/standalone-codec
checks and bundle ceilings. [All 24 source combinations](raster-demand-callbacks-regression.json)
also pass on the final headless host-GPU build with zero failed pages.
