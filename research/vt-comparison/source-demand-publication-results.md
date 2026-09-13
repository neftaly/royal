# Reuse unchanged source demand

Status: implemented, reviewed and validated. All changes remain uncommitted.

Camera/view changes used to rebuild and publish an SVG demand list even when the
same mip/x/y entries remained selected. That also rebuilt SVG grouping maps.
The runtime now retains the last published list and compares the current entries
before allocating a replacement. The comparison uses a loop without a new
callback or hash. It preserves ordering rather than assuming order is irrelevant.

A changed list is a fresh array of fresh page IDs; previously published lists are
never modified. An empty list is published once when demand disappears. Sources
without `setDemand`, including ordinary and preview rasters, return immediately.
Publication is recorded only after the callback completes. Source disposal clears
the runtime's retained list, and a replacement source starts with no publication.

This adds 17 renderer lines. The complete uncommitted renderer change is now
83 net lines relative to 56130d34. At most one list of 512 page IDs is retained
per source using demand callbacks, bounded by the existing workspace capacity.
SVG previews already retain their last demand list in the source wrapper, so the
runtime shares that array; direct SVG sources can retain more page-ID objects
than before. No additional pixels, bitmaps or encoded sources are retained.

## Adversarial review

The first pass checked validity and lifetime: count equality alone is insufficient,
so every mip and coordinate is compared. Reordered lists are republished. Pending
readers may retain old lists safely. Empty demand is forwarded to clear SVG groups,
and a replacement source receives initial demand even when its pages match a
previously disposed source. CPU source caches survive GPU context restoration,
so an unchanged list does not need to be sent again solely for restoration.

Tests verify unchanged projected demand under viewport-origin changes, different
coordinates at the same page count, preservation of a retained prior list,
offscreen demand and return, context invalidation, and source replacement. The
full suite passes 1,247 tests across 149 files, with root type checking and lint.

The second pass checks allocation and bounds: comparisons allocate no arrays or
closures; changed lists use the existing allocation path. The retained list is
bounded and freed with the resource. The source setter only changes when the
resource is created/opened, so its publication state cannot accidentally be reused
for a different source. SVG raster-cache eviction does not remove group identities,
and page reads can repopulate cache entries without a repeated demand callback.

[The patch](source-demand-publication.patch) and
[source hashes](source-demand-publication-sources.json) identify the uncommitted
runtime checkpoint. Use `VT_BASELINE_FILE` with
`VT_BASELINE_MODULE=packages/renderer-webgl/src/virtual-texture/runtime.ts` in the
browser builder, then run `source-combinations.html?demand-audit` headlessly.

## Headless allocation audit

[Before](source-demand-publication-before.json) and
[after](source-demand-publication-after.json) use the same 360-frame moving-camera
audit on headless Intel Iris Xe / ANGLE Vulkan, with matching production build
entrypoints and the runtime module alone overridden for the baseline.

| Authority | Arrays before → after | Page objects before → after |
| --- | ---: | ---: |
| SVG | 362 → 5 | 14,670 → 221 |
| PNG preview | 0 → 0 | 0 → 0 |
| Required WebP preview | 0 → 0 | 0 → 0 |

SVG page-list objects fall 98.5% in this camera path. This counts `Array.from`
page-ID outputs, not all renderer allocation. The SVG setter also skips grouping
map reconstruction when its list is unchanged. All three screenshots match
exactly, source reads are unchanged, and all cases finish with zero failed pages.
The changed lists still reach SVG when camera motion crosses a demand boundary.

Whole instrumented-run GC is 52 events / 31.07 ms before and 50 / 26.77 ms after.
The audit adds instrumentation and includes setup/diagnostics; these totals are
not an uninstrumented frame-time comparison or evidence of zero remaining churn.

Packed consumers/standalone codecs and bundle ceilings pass. The final
[24-case source regression matrix](source-demand-publication-regression.json)
also passes on the headless host GPU with zero failed pages. The saved patch
reconstructs the measured baseline runtime byte for byte.
