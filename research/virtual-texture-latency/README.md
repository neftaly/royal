# Next virtual-texture performance work

Decision recorded 2026-09-14 after the cooperative ASTC acceptance tests.
The assessment below preceded implementation. See [implementation results](implementation.md)
for the retained changes, rejected experiment, device measurements, and validation.

Prioritize fresh-page latency and visible refinement. Current paired tests put
cold zoom-in at about 0.52 seconds on Quest and 1.22 seconds on iPad with ASTC;
cached returns complete in one observed frame. Further cache-retention work has
less immediate value for that interaction than improving the first appearance
of uncached detail. See [device evidence](../idle-astc/implementation/acceptance/README.md).
These measurements describe residency, not GPU presentation.

The code currently permits four active/ready page jobs and four page uploads per
frame, while automatic detail has a separate one-job gate. Reads are deferred
during atlas growth. Automatic SVG generation already shares cached 2×4-page
regions, so recommending basic region caching as a new feature would be wrong.
Automatic demand already skips most intermediate ancestors while keeping coarse
coverage and the mip needed for filtering. Those protections should remain.

## Literature and relevance

Van Waveren describes a staged page-update pipeline, priority-ordered work,
compressed caches, and publishing mappings only once page contents are ready.
He also discusses page-table update overhead. These support investigating
stage utilization and redundant work, but his console/native throughput numbers
are not targets for browser SVG rasterization. [Software Virtual Textures,
sections 4.5, 5, 6.2](https://www.mrelusive.com/publications/papers/Software-Virtual-Textures.pdf).

Neu evaluates page ordering by screen contribution and image quality, then
examines camera look-ahead. Prediction helps some motion but can waste the next
streaming opportunity when motion abruptly stops. Royal should preserve demand
priority and cancel speculative work on reversals. His ancestor-streaming work
also demonstrates the tradeoff between gradual refinement and time spent loading
intermediate levels. [Virtual Texturing, sections 4.2–4.3](https://arxiv.org/pdf/1005.3163).

Epic documents format-specific physical pools, LRU replacement and the reload
churn caused by oversubscription. Its optional residency mip bias trades detail
for stability under pressure. This supports keeping byte-based admission and
measuring a complete working set instead of expiring cached pages on a timer.
[Virtual Texture Memory Pools](https://dev.epicgames.com/documentation/en-us/unreal-engine/virtual-texture-memory-pools-in-unreal-engine?application_version=5.6).

Epic's GPU-derived visible-tile requests illustrate a route to avoiding occluded
work. That becomes attractive for complex scenes, but adding another rendering
and feedback stage is not justified by the current simple tiger workload.
[Streaming Virtual Texturing](https://dev.epicgames.com/documentation/en-us/unreal-engine/streaming-virtual-texturing-in-unreal-engine?application_version=5.6).

## Recommended order — engineering judgment

1. **Measure and shorten the foreground pipeline.** Record demand-to-queue,
   scheduler wait, source/raster time, bitmap handoff, upload admission, atlas
   migration and publication separately. Count when limits block useful work.
   Then test bounded overlap of ready raster work and byte/time-governed upload
   batches. Do not increase concurrency blindly or allow large synchronous SVG
   jobs to lengthen input frames. Test a small demand-scaled RGBA reserve after
   compression so every new view does not first need atlas growth; charge it to
   the same pool and surrender it under pressure. Reservation size is an
   experiment, not a proposed permanent number or a time-based eviction rule.
2. **Order refinement by visible benefit.** Retain coarse coverage, then rank
   missing pages by projected screen contribution and the gap between resident
   and requested detail, preserving resource fairness and useful cached-region
   locality. A pointer/focus weight may help zoom interactions, but center-only
   ordering should not starve peripheral content. Measure time until most visible
   pixels reach useful detail, alongside completion of the entire request set.
3. **Try bounded zoom prediction.** After improving the pipeline, use recent
   camera/LOD changes to prepare a small likely next set. Current demand wins;
   speculative pages get a strict byte/work cap and are cancelled on reversal.
   Demand generation can reuse the existing CPU path rather than introducing a
   feedback pass for this experiment. Rank it ahead of ASTC compression when the
   prediction is reliable. Require improved first-visit latency without extra
   demanded-page misses or frame-time regression on wrong guesses.
4. **Avoid redundant work in idle compression.** The encoder currently calls
   `source.read` again for an already resident page. Investigate a tiny bounded
   handoff/cache of recently produced pixels or cached source regions, discarded
   under pressure. Avoid a synchronous readback or added foreground copy merely
   to save background work. This targets CPU energy and time to reclaim memory,
   rather than claiming a direct cold-zoom improvement.

Defer a GPU-feedback rewrite, new page dimensions, larger universal pools, and
persistent disk caches until a representative workload shows that they solve a
measured bottleneck. Pre-generated compressed pages remain useful for static
content; they do not replace runtime SVG generation in arbitrary views.

Acceptance for subsequent changes should include repeated cold zoom, rapid
reversal, wrong prediction, post-compression fresh demand, several simultaneous
textures, and low GPU headroom on both devices. Compare visible-detail latency,
p95 frame gaps, work wasted on obsolete pages, and total CPU/GPU memory. Keep
only changes with a repeatable benefit and preserved foreground responsiveness.
