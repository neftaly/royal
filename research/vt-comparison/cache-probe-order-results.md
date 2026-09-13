# Filter page eligibility before probing the SVG cache

Status: implemented, reviewed and validated. All changes remain uncommitted.

The cached-page scheduler used to construct a page ID and probe SVG cache coverage
before checking whether that page was already resident, loading, ready, failed or
blocked by an unpublished ancestor. The cache check now follows those eligibility
checks. This moves one line and adds no source lines, state or cache.

## Measured effect

[Before](cache-probe-order-before.json) and [after](cache-probe-order-after.json)
run the actual glTF/native-preview/full-source pipeline on headless Intel Iris Xe
through ANGLE Vulkan. The audit includes 360 moving-camera frames per source and
instruments decoded SVG cache `has` calls as well as page-list outputs.

| Authority | Decoded cache lookups before → after | Demand-list page objects |
| --- | ---: | ---: |
| SVG | 15,850 → 471 | 221 → 221 |
| PNG preview | 0 → 0 | 0 → 0 |
| Required WebP preview | 0 → 0 | 0 → 0 |

SVG decoded cache lookups fall 97.0%. The count is a lower bound on skipped
source-cache callbacks: a callback can reject an ungrouped page without reaching
the decoded cache. Filtering early also avoids constructing the temporary page
argument and, for region-backed pages, a region-key string. No new scratch or
retained object is introduced.

All three screenshots match exactly and all cases finish with zero failed pages.
The remaining lookups service eligible pages as camera demand changes. Demand-list
allocation remains at the previously measured level, and raster sources continue
to skip these callbacks entirely.

Whole instrumented-run GC is 50 events / 28.35 ms before versus 49 / 31.37 ms
after. That noisy aggregate does not establish a GC-time improvement. This result
establishes reduced cache work; it is not an uninstrumented frame-time comparison.

## Two review passes

The first pass verified semantics: both the cache lookup and preceding eligibility
checks are read-only. A resident coarse preview that still needs authoritative
pixels remains eligible through the existing exception. Failed/blocked/loading
pages would have been skipped after probing anyway. Cache `has` does not refresh
LRU order, reserve memory or prepare pixels, so moving it cannot change ownership.

The second pass checked scheduling and lifetime. Cached eligible work retains its
priority, preparation lane and ancestor gating; no job reservation moves across a
read. Tests verify that blocked/loading pages are not repeatedly probed and that
fully resident SVG pages receive no further probes, including both 512px and
1024px target fixtures. All 37 runtime tests, root/research type checks and renderer
lint pass. Audit instrumentation restores the cache method in `finally`.

[The checkpoint patch](cache-probe-order.patch) and
[source hashes](cache-probe-order-sources.json) identify the uncommitted baseline.
The browser builder overrides only the runtime module using `VT_BASELINE_FILE`
and `VT_BASELINE_MODULE`, with matching entrypoints. The full renderer worktree
remains at 83 net added source lines relative to 56130d34.

Bundle ceilings pass on the final build, and the saved patch reconstructs its
measured baseline byte for byte.
