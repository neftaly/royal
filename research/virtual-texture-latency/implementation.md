# VT latency work — 2026-09-14

Final decision: retain two-page growth overlap for earlier uploads, following
the [12-pair comparison](#final-counterbalanced-comparison-and-review). Earlier
sections record the experiments that led to the final implementation.

Implemented four bounded improvements after the [literature assessment](README.md):

1. Stage counters and a shorter foreground pipeline: four active reads, eight
   active/ready automatic pages, and up to eight automatic uploads. Completed
   SVG raster reads can overlap cold detail work without starting another cold
   decode. Authored limits, byte reservations, and serial cold detail remain.
2. Automatic request ordering by estimated projected contribution and resident
   ancestor gap. Coverage prerequisites and resource fairness remain in force.
3. A small RGBA reserve during compressed-atlas compaction: a power of two no
   larger than one quarter of current demand, eight slots, or existing capacity.
   Competing pool pressure removes the reserve. It does not expire cached pages.
4. A maximum eight-page pixel handoff to idle ASTC. It takes ownership of already
   generated images and avoids another source read, without a foreground copy
   or GPU readback. Eligible visible pages still precede offscreen cached pages.

**Decision: do not implement zoom prediction in this change.** Requested-page
generation and admission remain material bottlenecks. Speculative work would
consume those same stages, with uncertain benefit on reversals. The literature
supports testing prediction when direction is reliable, not universally turning
it on. The measurements here justify improving actual demand first. GPU feedback,
disk caching, and a page-size change also remain outside this change.

## Device results

The tiger example was driven through wheel events on the connected iPad7,6
(iPadOS 17.7.11, Safari) and Quest 2 (Chromium). Fresh navigation preceded each
run. The iPad demanded 213 new pages and Quest 75 for the initial zoom. Each
condition below has three runs, with ranked runs before and after unranked runs
to check timing drift. The unranked condition disables only the request sort;
it keeps the pipeline, importance calculation, and other changes.

Median milliseconds:

| Device / condition | 50% estimated detail | 90% estimated detail | All demanded pages |
| --- | ---: | ---: | ---: |
| iPad, ranked first | 438 | 923 | 1163 |
| iPad, unranked | 625 | 1089 | 1240 |
| iPad, ranked repeat | 436 | 937 | 1167 |
| Quest, ranked first | 199 | 299 | 444 |
| Quest, unranked | 415 | 501 | 533 |
| Quest, ranked repeat | 228 | 326 | 471 |

These are **residency observations, not GPU presentation or image-quality
measurements**. The contribution estimate comes from projected triangle UV
bounds and does not resolve occlusion. The probe requires desired and admitted
page counts to match before recording detail thresholds; otherwise temporary
coarser admission during growth incorrectly looks complete. Raw reports retain
all samples and frame gaps. There is no universal frame-latency improvement
claim: median per-run maximum gaps varied from 32–57 ms on ranked iPad runs and
21–29 ms on ranked Quest runs. Runs were not randomized or thermally controlled.

An earlier single-run pipeline comparison improved full-demand completion from
1260 to 1160 ms on iPad and 475 to 455 ms on Quest. Treat this as diagnostic
evidence, not an independent repeated performance claim. The stage counters
showed almost no scheduler wait; source preparation and ready-page admission
were the useful targets. Summed per-page durations overlap and must not be
reported as elapsed time for the whole interaction.

### Rejected upload experiment

Starting a 2 ms timer before demand traversal, and allowing it to stop uploads
before the original four-page batch, made iPad completion worse: 1988 ms, with
13,701 ms of cumulative ready-page wait versus 2,875 ms in the instrumented
baseline. The retained implementation starts timing at the first upload and
only applies the time stop after four successful uploads. Byte admission can
still stop an earlier batch. The rejected measurements remain in
`measurements/royal-stage-first-*.json`.

### Idle compression, fresh detail, and memory

A separate final-source run waited 35 seconds after zooming out:

| Device | Cached return | New requests on return | Next deeper zoom | New pages |
| --- | ---: | ---: | ---: | ---: |
| iPad | 20 ms / one observed frame | 0 | 1311 ms | 213 |
| Quest | 6.8 ms / one observed frame | 0 | 754 ms | 115 |

The deeper zoom's maximum observed frame gap was 31 ms on iPad and 25 ms on
Quest. Both continued to publish fresh RGBA pages. At the idle return, iPad
retained 10,903,552 atlas bytes while compression was still progressing; Quest
retained 1,270,016 bytes after compressing its smaller working set. On Quest,
991,232 bytes were ASTC and 278,784 bytes were the four-slot warm RGBA reserve.
This validates operation and accounting; it does not isolate a speedup due to
the reserve.

Each device reused nine foreground images for idle encoding. The retained
handoff had drained to zero by the idle return and never exceeded 557,568 bytes.
The encoder still reread other pages (143 reads on iPad and 86 on Quest at that
observation). This bounded cache reduces some duplicate work; it does not
eliminate source rasterization or claim faster encoding itself.

## Review and validation

Review found that unusable encoding could leave the bounded image handoff
retained indefinitely. Failure and queue-exhaustion paths now release those
images. Tests verify exactly-once closure through compression/disposal and
worker-construction failure. Source-cache tests cover misses without decode and
reuse after a completed raster; demand tests cover contribution accumulation,
coarsening, and reset. Existing tests cover stale work, cancellation, coverage,
budgets, pool migration, multiple resources, and context recovery.

- Full suite: 1,542 tests across 157 files, plus the glTF lab manifest check.
- Type checking, lint, production builds, package import checks, and the packed
  consumer/size check passed. Packed entrypoints and standalone codecs executed.
- Bundle gate passed: 144.6 kB initial, 224.6 kB lazy, 113.1 kB worker assets,
  369.2 kB deployed JavaScript, all gzip as reported by the gate.
- The measured renderer tarball was 869,497 bytes before its final comment-only
  edit. A named 1,024-byte allowance raises the package ceiling to 869,632 bytes;
  the existing bundle ceilings were unchanged for this latency work.

The broader ASTC quality, paired enable/disable, built-worker, and context-loss
acceptance remains recorded in [the ASTC acceptance report](../idle-astc/implementation/acceptance/README.md).

## Reproduction data

`zoom-probe.js` runs in the example page after initial demand settles. It stores
results in `window.__royalZoomProbe`. `idle-probe.js` adds the actual 35-second
wait and deeper fresh demand. The ranking/stage raw reports used the earlier
label "after 35s idle" for a **one-second** wait; only `royal-idle-*.json` uses
35 seconds. That label has been corrected in the retained short probe.

`measurements/` contains the original numeric reports for ranked/unranked and
repeat runs, final idle runs, and the earlier pipeline experiments. Snapshots
record source revision/build identity, device user agent, canvas dimensions,
request counts, stage sums, memory, and frame-by-frame residency.


## Follow-up: atlas-copy overhead

A 2 MiB copy-batch experiment was rejected. In three runs per device, Quest's
median first request improved from 80 to 60 ms, but iPad full-demand completion
was 1253 ms versus 1167 ms in the preceding 1 MiB runs. This did not justify
raising the portable copy budget. The original 1 MiB and 64-page limits remain.

Instead, adjacent cells with contiguous source and destination positions now
share one GPU copy call, stopping at either atlas row boundary or a gap. This
copies the exact same texels under the same byte admission and validation
fences. In instrumented hardware runs, iPad's 30 migrated pages required nine
copy calls and Quest's 19 migrated pages required eight; the old implementation
used one call per page. Different resident sets reflect how far idle compression
had progressed when the probe began.

Three-run median full-demand times with coalescing were 1172 ms on iPad and
475 ms on Quest, compared with 1167/471 ms in preceding baseline runs. Median
90%-detail times were 927/326 ms versus 937/326 ms. These differences do not
establish an overall zoom-latency improvement. The retained benefit is fewer
GPU driver submissions at the same copy budget. Cached reversals still required
no additional page reads. No universal CPU-time or frame-time gain is claimed.

Differential copy tests expand each submitted rectangle back into cells and
compare the exact requested source/destination pairs across several atlas widths,
gaps, and reordered source lists. Growth tests check copied page area instead
of assuming one call per page. All **1,544 tests**, type checking, lint, packed
consumer verification, and bundle/package size gates pass. Bundle ceilings
remain unchanged. The renderer tarball measured
869,898 bytes; a named 512-byte package allowance raises its ceiling to 870,144
bytes. Data is in `royal-copy2m-*`, `royal-copyruns-*`, and
`royal-copycounts-*`; `copy-probe.js` records driver calls and page equivalents.


## Follow-up: prepare requested pages during atlas expansion

Automatic-only pools now prepare a bounded part of actual requested demand
against the reserved replacement atlas while migration is pending. Uploaded
pages and bindings remain unchanged until validation succeeds. Capacity fitting
uses the replacement's actual allocation and per-resource shares, including
manifest limits. Shrinks and mixed authored pools retain their old behavior.
Growth transitions force demand to be refitted, so cancellation and validation
failure discard pages that no longer fit the current atlas.

The first experiment allowed the ordinary eight-page queue to fill. Adversarial
review identified that stalled migration could then deny unrelated authored
reads, whose total-job gate is four. The retained implementation permits **two
active/ready pages across growing pools**, within the existing four-active,
eight-automatic-total, and 16 MiB byte ceilings. This both leaves queue capacity
for other pools and reduces overlap work on the iPad.

Three-run medians with overlap disabled and with the final two-page overlap:

| Device / condition | First request | First upload | 90% estimated detail | Complete demand | Maximum frame gap |
| --- | ---: | ---: | ---: | ---: | ---: |
| iPad, disabled | 90 ms | 119 ms | 874 ms | 1112 ms | 30 ms |
| iPad, two pages | 7 ms | 104 ms | 898 ms | 1141 ms | 27 ms |
| Quest, disabled | 81 ms | 120 ms | 349 ms | 502 ms | 25 ms |
| Quest, two pages | 31 ms | 89 ms | 308 ms | 473 ms | 31 ms |

First-upload observation improved on both devices, but full refinement was
mixed: iPad was 29 ms slower in this comparison. These short, sequential runs
are not a statistically controlled claim of universally faster completion.
Cached zoom reversals continued to settle without new reads. Request and upload
numbers are sampled at animation frames, and upload is not a GPU presentation
measurement. The earlier eight-page experiment is retained as `royal-overlap-*`;
comparison and final data are `royal-overlap-off-*` and `royal-overlap2-*`.

The additional adversarial review covers replacement capacity and resource
shares, absence of uploads before validation, demand refitting on growth
transitions, bounded retention, and queue space under a stalled GPU fence.
Regression tests exercise successful overlap, reversal, failed validation,
scene removal, context invalidation, exactly-once pixel closure, and continued
streaming in a second authored pool while automatic migration stalls.


Final validation: **1,550 tests across 157 files**, the glTF lab manifest check,
type checking, lint, packed-consumer builds/execution, and bundle/package gates
passed. The renderer tarball measured 870,603 bytes; a named 768-byte allowance
raises its ceiling to 870,912 bytes. Bundle ceilings remain unchanged (reported
144.6 kB initial and 369.4 kB total deployed JavaScript, gzip). Package and bundle
verification run sequentially because prepack rebuilds replace files consumed
by the bundle fixture.

The final 35-second idle checks also completed without errors. Cached return
required zero new reads and one observed frame: 18 ms on iPad and 15.8 ms on
Quest. The next deeper view generated 213/115 pages in 1390/810 ms, with maximum
observed frame gaps of 45/27 ms. Those single runs verify continued operation
through compression and fresh demand; they do not establish faster deep-zoom
completion. Reports are retained as `royal-overlap-idle-*`.


## Final counterbalanced comparison and review

**Retain the two-page overlap for earlier first uploads.** The longer test ran
12 enabled/disabled pairs on each device (48 trials). Pair order alternated
OFF/ON, ON/OFF, OFF/ON, and so on. Each trial navigated afresh, waited for initial
demand to settle, set its condition, and ran the same cold zoom and cached
reversal probe. Initial loading used the same behavior in both conditions.
The workload demanded exactly 213 new pages on iPad and 75 on Quest throughout.
All cached reversals used zero additional reads.

Results below use the median of within-pair ON-minus-OFF differences. This is
preferable to subtracting two unpaired medians when conditions drift between
pairs. Negative values favor overlap. Intervals are descriptive percentile
bootstrap intervals from 10,000 resamples of the 12 paired differences, not a
guarantee for other devices or independent hardware sessions.

| Device / measurement | Paired median difference | Bootstrap 95% interval | ON faster pairs |
| --- | ---: | ---: | ---: |
| iPad first upload | −19.5 ms | −56.0 to −11.5 ms | 11/12 |
| Quest first upload | −27.3 ms | −33.9 to −18.5 ms | 12/12 |
| iPad full refinement | −49.0 ms | −175.0 to +56.0 ms | 7/12 |
| Quest full refinement | −4.3 ms | −61.4 to +11.4 ms | 6/12 |
| iPad per-run p95 frame gap | −0.5 ms | −4.0 to +3.0 ms | 6/12 |
| Quest per-run p95 frame gap | +0.2 ms | −1.0 to +1.4 ms | 5/12 |

The first-upload result is consistent; full refinement and p95 frame-gap
comparisons are inconclusive. This does not establish absence of regressions
for other workloads. Median paired maximum frame-gap differences were −3.5 ms
on iPad and +2.5 ms on Quest, with intervals spanning zero. Upload and frame-gap
observations are sampled from animation frames and do not measure presentation.
The retained mechanism is small and bounded, with explicit tests for the
stall/cancellation risks; there is no platform-specific tuning branch.

Raw reports are `measurements/royal-paired-{device}-{trial}.json` and carry pair,
condition, sequence index, source identity, canvas dimensions, and snapshots.
Run `python3 research/virtual-texture-latency/summarize-pairs.py` to reproduce
`paired-summary.json`. During measurement only, `#preparationAtlas` returned the
current atlas when a temporary `globalThis.__royalDisableGrowthOverlap` flag was
true. The drivers set that flag immediately before `zoom-probe.js`; all other
code remained identical. **The flag and its branch were removed before final
validation and commit.** There is no production experimental switch.

The final adversarial pass also reproduced an optional-feature failure:
`getSupportedProfiles()` throwing during the foreground pixel handoff propagated
out of `update()` after a successful RGBA upload. Capability probing is now
caught locally, disables optional compression, records the diagnostic, releases
retained handoff images, and lets RGBA continue. The new test failed before the
fix and passes afterward, checking usable coverage, no worker startup, no
retained pixel cache, and exactly-once pixel closure.

Final commit checks passed: **1,551 tests**, glTF lab manifest validation, type
checking, lint, the complete production build, packed entrypoint/codec execution,
and bundle/package size gates. Existing size ceilings cover the capability-error
fix. The final review found no further issue requiring a code change.

Large measurement JSON files use compact formatting; all parsed values are
preserved. The prose tables and `paired-summary.json` provide the readable
review summary.
