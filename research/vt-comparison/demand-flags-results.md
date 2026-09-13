# Cached vertex clipping flags

Status: implemented, reviewed and validated. All changes remain uncommitted.

This follows the [range simplification](demand-range-results.md), targeting its
remaining coincident-triangle cost. The existing 256-entry transformed-vertex
cache now retains one byte per entry: six outside-plane bits and a non-finite
flag. Triangle classification combines those bytes instead of repeating eighteen
finite checks and eighteen plane checks for every triangle.

The change adds one fixed 256-byte typed array per demand workspace and removes
three renderer source lines. The combined raster-preview and demand improvements
now add 64 net renderer lines relative to 56130d34. It introduces no per-triangle
allocation, mesh-sized cache or persistent geometry identity.

## Correctness and adversarial review

Flags are computed with the transformed position and UVs on each cache miss.
The existing key reset per model/view also invalidates flag reuse. Cache collisions
update both transformed data and flags; each corner is copied and its flags merged
before the next corner can overwrite that slot. A non-finite corner still selects
coarse fallback before a finite outside-plane rejection, matching prior behavior.

Tests exercise cache collisions whose replacement vertices move outside the
frustum, all six rejection directions, changing views, malformed UVs, recovery
to valid UVs, near-plane clipping and instancing. Existing independent wrapping
and capacity tests exercise the unchanged range path. The cache never reuses
flags across model/view or UV transformations.

The second review checks storage and scheduling: flags are a fixed Uint8Array,
never cleared independently because invalid keys force recomputation. The flags
helper takes an existing array and integer offset and returns an integer mask;
there are no new floating-point argument chains or per-corner objects. Both
validity and clipping retain the same comparisons and boundary semantics.

## Alternating CPU comparison

[Raw results](demand-flags-comparison.json) compare against the saved uncommitted
range checkpoint. Four alternating rounds use a fixed 16 MiB Node nursery and
record CPU time, elapsed time, source hashes and host load.

Median across 20,000-triangle run medians / p95 values, milliseconds:

| Geometry / ancestors | Range checkpoint | Cached flags |
| --- | ---: | ---: |
| Grid / coarsest | 7.360 / 9.426 | 5.870 / 7.319 |
| Grid / all | 7.305 / 9.029 | 5.670 / 7.008 |
| Coincident / coarsest | 10.959 / 13.198 | 9.229 / 11.035 |
| Coincident / all | 10.954 / 12.880 | 9.152 / 11.064 |

Process CPU summed over grid reports falls from 8,421.9 to 6,656.1 ms (21.0%);
coincident reports fall from 12,413.7 to 10,737.9 ms (13.5%). Grid GC stays at two
events, totaling 0.95 versus 0.76 ms. Coincident GC is one event / 0.27 ms before
and zero after. These are demand-only comparisons, excluding GPU rendering,
transport, decoding and upload; CPU report totals include fixture setup/warm-up.

The [checkpoint patch](demand-flags.patch) can be reversed into a separate file
for `VT_BASELINE_FILE`. To reconstruct the older raster-preview checkpoint,
reverse this patch first, then `demand-range.patch`; stored hashes identify each
version without requiring commits.

## Headless host-GPU comparison

[Before](demand-flags-before.json) and [after](demand-flags-after.json) run the same
18 scenes sequentially on Intel Iris Xe / ANGLE Vulkan in headless Chromium.
Default mip-linear submission median / p95, milliseconds:

| Scene | Range checkpoint | Cached flags |
| --- | ---: | ---: |
| Zoom | 0.4 / 1.9 | 0.4 / 1.8 |
| Oblique | 0.3 / 0.5 | 0.4 / 0.6 |
| Hidden dense mesh | 5.9 / 9.9 | 5.0 / 5.6 |
| Dense mesh | 6.0 / 12.1 | 6.5 / 10.6 |
| Extreme overdraw | 9.2 / 10.5 | 8.2 / 10.3 |
| Raster | 0.2 / 0.4 | 0.3 / 0.4 |
| SVG | 0.4 / 1.3 | 0.4 / 1.4 |
| ASTC 6x6 | 0.3 / 0.4 | 0.2 / 0.4 |
| ASTC 8x8 | 0.2 / 0.4 | 0.2 / 0.4 |

The dense median is higher despite lower p95 and the faster isolated CPU result;
this run does not establish an improvement in every browser timing metric.
Whole-run GC changes from 46 events / 43.45 ms to 41 events / 41.32 ms. Post-GC
JS heap is 3,453,256 versus 3,474,324 bytes; backing storage is 401,697 versus
403,708 bytes. These totals include harness setup and diagnostics.

[Pixel comparison](demand-flags-pixels.json) finds 16 exact matches. ASTC 6x6 and
8x8 with nearest-mip minification differ on 1,371 and 1,255 pixels respectively,
by at most 4/255 per RGB channel; mean channel differences are about 0.003/255.
Their final VT snapshots are identical. No image normalization was applied.

The full suite passes 1,246 tests across 149 files, including the additional cache
classification and collision coverage, and root type checking and lint pass.

Packed entrypoint/standalone-codec consumer checks and bundle ceilings also pass.
The saved checkpoint patch reconstructs the measured baseline byte for byte.
