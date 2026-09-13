# Stop repeated cached-page scans after idle visits

Date: 2026-09-13. Production optimization retained, uncommitted.

The page scheduler repeated a full cached-page scan before each unsuccessful
ordinary-resource visit. With N idle resources, that produces N² cached visits
even though no synchronous progress can have made a cached page ready.

The cached pass now requires the existing `idleVisits` counter to be zero. The
first scan still runs, and any successful cached or ordinary read resets the
counter, preserving cached-work priority after progress. No new state is added;
runtime line count and package/bundle allowances are unchanged.

## Scheduling review

The comparison script extracts both actual scheduler bodies. Across 10,000 seeded
queue states it preserves successful read order, cursor, pending slot count,
detail exclusivity, remaining queues and ordinary-visit count. Cached visits for
idle sets of 1/8/16/64 resources fall from 1/64/256/4096 to 1/8/16/64.

The first source review checked both counter-reset paths, job-slot limits, and
the absence of asynchronous completions within a scheduler call. The second
checked that `hasCachedPage`/`SvgRasterCache.has` only inspect cache membership;
skipping failed probes does not alter cache recency or create work. The queue
model is a synchronous scheduling check, not a substitute for real source tests.

## Host measurements

The fixture now supports independent SVG copies and an explicit GPU budget.
It uses 16 SVG textures over 600 warmed moving-camera frames on headless Intel
Iris Xe / ANGLE Vulkan. The default 64 MiB pilot had different stable atlas sizes
from loading history (14,845,248 versus 12,405,888 bytes), so it is retained as
supporting evidence rather than used as the matched capacity comparison.

With a 256 MiB benchmark budget, both versions have exactly the same final VT
snapshot: one 35,684,352-byte atlas, 336 desired/admitted/resident pages, and no
pending, unresident or failed pages. Captured pixels match exactly.

| Profiled metric | Before | After |
|---|---:|---:|
| Total sampled allocation | 14,645,496 B | 13,365,636 B |
| Submission median / p95 | 0.7 / 1.1 ms | 0.6 / 0.9 ms |
| GC events / time | 10 / 8.119 ms | 10 / 8.169 ms |

Sampled allocation falls about 9%; this does not demonstrate shorter GC pauses.
Four additional runs without CPU/heap sampling, in before/after/after/before order,
produce median submissions of 0.6/0.5/0.5/0.7 ms and p95 of 1.0/0.8/0.9/1.0 ms.
All retain the same atlas size and 336 resident pages. The runner still traces GC,
so these repetitions are not entirely uninstrumented. Results are host CPU
submission measurements, not a GPU-time or mobile-device guarantee.

All 88 runtime/growth tests, root type checking, lint, research TypeScript,
44 headless source cases, packed consumer checks and existing browser bundle
limits pass. The source cases retain lazy authority promotion, capability fallback,
atlas resizing and context restoration behavior. Whitespace checks pass.
The full root command passes all 1,270 tests and the glTF lab manifest check.

Evidence: [scheduler comparison](idle-scan-comparison.json),
[comparison script](compare-idle-scan.mjs), [64 MiB pilot before](idle-scan-before.json),
[pilot after](idle-scan-after.json), [matched before](idle-scan-fixed-before.json),
[matched after](idle-scan-fixed-after.json),
[mapped before](idle-scan-fixed-profile-before.json),
[mapped after](idle-scan-fixed-profile-after.json),
[timing before 1](idle-scan-timing-before-1.json),
[after 1](idle-scan-timing-after-1.json), [after 2](idle-scan-timing-after-2.json),
[before 2](idle-scan-timing-before-2.json), [source cases](idle-scan-source-regression.json),
[patch](idle-scan.patch), [source hashes](idle-scan-sources.json).
