# Selecting SVG raster region size

Decision, 2026-09-14: retain demand-aware shared source regions. Use 4×4 pages
when at least eight pages in that neighborhood are demanded; use the existing
2×4 shape for sparser demand. GPU pages remain 128px with their existing gutters.
The source raster cache remains 4 MiB across the root, including pending and
pinned entries. The automatic upload time allowance remains 2 ms.

## Literature considered

Taibo, Seoane, and Hernández describe RAM buffers spanning multiples of GPU
tiles and the throughput-versus-job-duration tradeoff for procedural generation.
They distinguish the generation/cache granularity from synchronous GPU updates.
This supports separate region and page sizes with bounded work, not a universal
numeric optimum. [Dynamic Virtual Textures, §3.3](https://videalab.udc.es/sites/default/files/publicaciones/WSCG_Dynamic_virtual_textures.pdf).

Igehy, Eldridge, and Proudfoot show that larger cache blocks reduce miss counts
but can fetch more unused texels at boundaries. Their hardware-cache experiments
are not browser SVG measurements; the relevant implication is to measure useful
coverage as well as per-job overhead. [Parallel Texture Caching, §5.1](https://graphics.stanford.edu/papers/parallel_texture/parallel_texture.pdf).

The resulting engineering choice balances setup cost per useful page against
rasterized area per useful page. A half-occupied 4×4 group has at most twice its
currently demanded tile area before gutters; this is a density safeguard, not a
guarantee that every rasterized texel is new or visible. Eight pages is our local
policy, not a threshold supplied by either paper. No device-specific branch or
speculative future view is used. Larger regions never change GPU allocation
granularity, eviction, source authority, or ASTC block dimensions.

## Experiments and final comparison

An initial six-pair comparison of fixed 2×4 and fixed 4×4 regions found a large
Quest full-refinement gain (paired median −132 ms), but inconclusive iPad results.
Review rejected unconditional widening because sparse demand could double
generated area with too few consumers. The final policy retains the smaller
shape in that case and reuses either shape if its pixels are already cached.

The final comparison ran 12 counterbalanced pairs per device (48 trials), with
fresh navigation per trial and the same cold zoom plus cached reversals. OFF is
fixed 2×4; ON is demand-aware 2×4/4×4. Both use the previously committed two-page
growth overlap and 2 ms upload allowance. Initial and final page counts match:
213 new pages per iPad cold zoom, 75 per Quest cold zoom. Cached reversals made
zero additional reads throughout.

| Metric | iPad OFF / ON median | Quest OFF / ON median |
| --- | ---: | ---: |
| Full refinement | 1158.5 / 1172.0 ms | 536.6 / 420.8 ms |
| 90% estimated detail | 902.5 / 932.0 ms | 352.8 / 266.2 ms |
| Per-run p95 frame gap | 24.5 / 23.0 ms | 21.5 / 22.6 ms |

Within-pair median full-refinement differences were **+14.5 ms on iPad** and
**−118.0 ms on Quest**. Descriptive 95% bootstrap intervals were −47.5 to +55.5 ms
and −138.7 to −97.9 ms respectively. Quest improved in all 12 pairs; iPad improved
in four. The result supports a Quest improvement, not universally faster SVG
refinement. Paired p95 differences were approximately 0 ms on iPad and +0.3 ms
on Quest, with both intervals spanning zero. Observations describe sampled
residency and animation-frame gaps, not GPU presentation or an input-latency
guarantee. Repeated pairs on one device are not independent hardware sessions.

A separate six-pair experiment increased the automatic upload allowance from
2 to 4 ms while using the final region policy. Paired full-refinement differences
were −28 ms on iPad and −10.6 ms on Quest, with both bootstrap intervals spanning
zero. That did not justify raising foreground work, so the allowance stays 2 ms.

A final idle smoke test returned to cached detail after 35 seconds with zero
new reads on both devices (19 ms on iPad, 6.6 ms on Quest). A subsequent deeper
zoom completed with 213 new pages in 1336 ms on iPad and 115 in 829.6 ms on
Quest. These single runs check continued progress after background compression;
they are not additional paired performance evidence.

## Review and reproducibility

Review covered sparse-demand overgeneration, exact border/edge mapping, root
cache admission and release, and transitions between wide and narrow rasters.
Tests verify that sparse views reuse a completed wide raster, and that later
dense views reuse a completed narrow raster before an unprepared wide one.
A cached miss performs no decode; pressure releases both shapes and source
disposal returns cache bytes to zero. Existing cancellation, shared-cache,
atlas, and ASTC ownership tests remain applicable.

Adversarial review reproduced two stale-plan cases: a completed wide region or
whole mip survived a sparse demand change, then cache eviction caused a later
read to regenerate the obsolete large shape. Regression tests failed at 514px
instead of at most 260px for a two-page region, and 256px instead of at most
132px for a single-page mip. Current demand now controls regeneration, while
completed historical rasters remain reusable. Both regressions pass. Runtime
tests also verify the reduced raster count and matching disposal count, with
the maximum generated dimension tightened to 516px.

Final validation: 1,554 tests across 157 files, the glTF fixture manifest,
type checking, lint, production build, packed-package consumer/import checks,
and bundle-size checks passed. The renderer package passes a 871,424-byte
ceiling with an explicit 512-byte allowance for this change; bundle ceilings
remain unchanged. A final review of cache selection, current-demand planning,
edge scaling, cancellation, and disposal found no further required fixes.

Raw reports are `measurements/royal-regions-*`, `royal-upload4-*`, and
`royal-dense-final-*`. Their summaries are alongside this report. Reproduce one
with `python3 research/virtual-texture-latency/summarize-pairs.py dense-final`
(or `regions` / `upload4`). The default still reproduces the earlier overlap
comparison. Each report records condition and pair number. During measurement,
temporary URL parameters selected the tested region width or upload allowance;
those branches were removed from production source before final validation.
The idle reports are `measurements/royal-dense-idle-*`. Raw JSON is compacted
without changing its values; all three paired summaries reproduce exactly.

## Follow-up cancellation review

Review of the shared-cache path found an existing cancellation inefficiency:
one page's `AbortError` discarded a successfully decoded raster after surviving
readers finished, forcing subsequent pages to decode it again. A regression
first failed because the cache no longer contained that raster. Page cancellation
now preserves it under the same LRU budget. Decode aborts, other consumer errors,
and explicit disposal still release storage; tests cover cancellation concurrent
with another reader and with disposal. This is a correctness/ownership check,
not new device timing evidence. The full suite passes 1,556 tests, type checking,
lint, rebuilt packed-package consumer checks, and production bundle checks.
The measured package needs a separate 128-byte cancellation allowance
(871,552-byte ceiling).
