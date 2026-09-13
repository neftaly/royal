# VT range demand: allocation and independent wrapping

Status: implemented, reviewed and validated, with measured tradeoffs below.
Changes remain uncommitted at the user's request.

This follow-up starts from the uncommitted raster-preview checkpoint described
in [raster-preview-results.md](raster-preview-results.md). The isolated allocation
profile attributed churn to floating-point UV bounds passed between range helpers.
The range calculation now reads UVs from existing screen scratch and converts
wrapped bounds directly into integer page coordinates within one function.
No new scratch or cache is allocated; 67 renderer source lines are removed.

Review also found a pre-existing correctness error: a full repeat on one axis
bypassed clamp, repeat-seam splitting and mirrored orientation on the other.
The new path saturates each repeating axis independently, then handles the other
axis normally. Each partial repeating axis crosses at most one seam, so tile
work remains bounded even when UVs span many repetitions.

Tests first reproduced wrong clamped rows on both axis orientations. Coverage
now includes positive/negative clamping, repeat seams, positive/negative mirrored
tiles, and 270 deterministic UV rectangles across all nine wrap combinations.
For each rectangle, demand must contain every page touched by 49 independently
wrapped sample points. Existing clipping, perspective, instancing, capacity and
runtime tests continue to exercise the shared demand path.

The [checkpoint-to-candidate patch](demand-range.patch) preserves this change
separately from the larger uncommitted feature. The comparison harness accepts
`VT_BASELINE_FILE` for a saved demand module and records source hashes; this
avoids creating a commit just to obtain a benchmark baseline.

## Adversarial review

The first pass traced mixed wrapping into the old whole-axis shortcut and added
failing tests before the fix. The second pass checked that the merged range
function reads screen scratch only after perspective subdivision has finished,
never overwrites clipping vertices, visits complete target mip levels, and exits
immediately on capacity overflow. Independent sampled wrapping checks guard
against missing pages without requiring the demand estimate to be exact.

Final validation of the implementation passes 1,245 tests across 149 files,
root type checking and lint, research harness type checking, packed entrypoint
and standalone codec consumers, and bundle ceilings. The combined raster-preview
and range changes add 67 net renderer lines relative to 56130d34.

## Headless host-GPU comparison

The saved checkpoint and candidate each run the same 18 cases sequentially on
Intel Iris Xe through ANGLE Vulkan, with no other benchmark/build jobs started
by this session concurrently. [Before](demand-range-before.json) and
[after](demand-range-after.json) include screenshots, transport and residency
snapshots. Both use 15 warm-up frames and 90 measured frames per case.

Default mip-linear submission median / p95, milliseconds:

| Scene | Checkpoint | Simplified range |
| --- | ---: | ---: |
| Zoom | 0.4 / 2.1 | 0.4 / 2.0 |
| Oblique | 0.4 / 0.6 | 0.4 / 0.7 |
| Hidden dense mesh | 7.8 / 14.1 | 7.0 / 9.2 |
| Dense mesh | 8.4 / 14.6 | 7.8 / 9.3 |
| Extreme overdraw | 11.7 / 19.2 | 11.5 / 20.2 |
| Raster | 0.3 / 0.5 | 0.3 / 0.5 |
| SVG | 0.4 / 1.5 | 0.4 / 1.4 |
| ASTC 6x6 | 0.3 / 0.4 | 0.3 / 0.4 |
| ASTC 8x8 | 0.2 / 0.4 | 0.3 / 0.4 |

Whole-run GC changes from 305 events / 130.81 ms to 45 events / 54.98 ms.
These totals include fixture setup and screenshot diagnostics; they do not imply
zero per-frame allocation. Post-GC JS heap is 3,455,376 versus 3,468,980 bytes;
backing storage is 401,990 versus 403,691 bytes. The optimization reduces churn,
not retained scene resources, and does not solve extreme overdraw.

[Pixel comparison](demand-range-pixels.json) finds 16 exact screenshot matches.
ASTC 6x6 and 8x8 with nearest-mip minification differ on 1,118 and 1,835 of 262,144
pixels respectively, by at most 3/255 in any RGB channel, with unchanged alpha.
Their final VT snapshots are identical. These small differences are reported
rather than treating the complete run as bit-exact.

## Isolated CPU comparison

[The final four-round comparison](demand-range-comparison.json) fixes the Node
nursery at 16 MiB, alternates version order and records process CPU time as well
as elapsed time and host load. Median of 20,000-triangle run medians / p95 values,
milliseconds:

| Geometry / ancestors | Checkpoint | Simplified range |
| --- | ---: | ---: |
| Grid / coarsest | 8.585 / 13.043 | 7.936 / 10.421 |
| Grid / all | 8.488 / 10.274 | 7.981 / 10.255 |
| Coincident / coarsest | 12.394 / 16.011 | 12.875 / 19.073 |
| Coincident / all | 12.465 / 16.441 | 12.776 / 17.117 |

Across the four grid reports, process CPU time falls from 11,304.7 to 10,074.5 ms
(10.9%), and GC drops from 173 events / 46.76 ms to 2 events / 0.76 ms.
Coincident reports rise from 14,878.3 to 15,572.0 ms CPU (4.7%), with zero GC in
both. Reports include fixture construction and warm-up; per-case timings do not
include fixture construction. Process CPU totals can exceed elapsed time because
runtime work can use multiple threads.

This is a measured tradeoff: substantially less grid allocation and CPU work,
a smaller implementation, and correct mixed wrapping, with a modest coincident
CPU regression. It is not a universal speedup. Further triangle-loop work should
address the coincident case without reintroducing boxed UV-bound arguments.

To reconstruct the exact checkpoint module from this candidate, reverse the
saved patch into a separate file, then pass it to the benchmark:

```sh
patch --reverse --output=/tmp/royal-vt-checkpoint-demand.ts packages/renderer-webgl/src/virtual-texture/demand.ts research/vt-comparison/demand-range.patch
VT_BASELINE_FILE=/tmp/royal-vt-checkpoint-demand.ts VT_DEMAND_OUTPUT=/tmp/royal-vt-demand-comparison.json node --min-semi-space-size=16 --max-semi-space-size=16 --expose-gc research/vt-comparison/compare-demand.mjs
```

The patch and stored source hashes identify this checkpoint even though no commit
was created. Later edits to demand may require applying the patch against its
matching candidate first. The browser builder also accepts `VT_BASELINE_FILE`
with `VT_BASELINE=1`, keeping the rest of the current renderer unchanged.
