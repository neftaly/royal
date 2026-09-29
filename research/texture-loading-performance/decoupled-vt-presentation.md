# VT preparation without redundant scene presentation

Nova spent a substantial part of loading redrawing an unchanged scene. VT demand
traversal, shader polling, atlas migration, and uploads previously advanced through
`drawViews`, which also redrew all admitted surfaces. The root now advances that
preparation independently and uses its existing 250 ms progressive-presentation
cadence. Camera/input changes still request immediate rendering; external XR
frames retain their existing drawing path. Settled detail is presented immediately.
Texture quality, pool limits, source formats, networking, and schemas are unchanged.

The same surface preparation implementation serves both paths. It returns before
the scene drawing passes when called by `prepareViews`. This avoids duplicating VT
demand or GPU resource ownership. The profiler also removes its installed document
scripts between runs, preventing observers and fetch wrappers from accumulating
on a reused physical-device tab. Temporary browser profiles now live alongside
the benchmark output instead of consuming the nearly full `/tmp` filesystem.

## Four investigated opportunities

1. **Repeated scene work:** retain this change. On Quest, sampled inclusive scene
   drawing CPU time fell from 6,145 ms to 2,374 ms. The original candidate drew
   72–74 frames in timing runs, compared with 190–201 for the baseline.
2. **Worker page generation:** page rasterization consumed about 1,305 ms total in
   the baseline Quest run. That is a limited upper bound before worker overhead;
   it is not evidence of a comparable wall-clock saving. No new worker path added.
3. **Atlas migrations:** measured CPU cost was comparatively small. Pool-frame
   counters and cumulative overlapping queue durations are not elapsed loading
   time. No pool-policy rewrite justified by this profile.
4. **Probability startup dependencies:** the serial package/release metadata
   requests took about 103 ms combined. The larger costs followed model and image
   preparation. No startup networking/schema changes added.

## Measurements

Baseline: Royal `0eb2e3b1`. Both production arms use the same isolated Probability
fixture, `d47b56e6de94424c61db4c8116341ee2eb3fd57a`, built with
`ROYAL_BENCH_PATH=/home/neftaly/dev/royal`. Nova assets come from the registry.
The normal mutable Probability development tree was not used for production
timing comparisons. Raw measurements and the machine-readable summary are kept
separate from CPU profiling runs.

| Hardware | Baseline readiness | Candidate readiness | Evidence |
| --- | ---: | ---: | --- |
| Quest 2 / Adreno 650 | 19.95, 19.43 s | 16.58, 16.16 s | Original candidate; reversed C/B/B/C order |
| Intel Iris Xe / Vulkan | 17.71 s | 14.46 s | Final candidate; one pair |
| Physical iPad / Safari | 29.89 s | 23.26 s | Final candidate; one pair |

Quest's original repeated comparison improves mean readiness by 3.31 s (16.8%).
Interaction readiness was 9.94/9.92 s before and 9.67/9.17 s afterward. The final
reviewed Quest build also completed at 17.62 s during a reliability run overlapping
the iPad recovery test; this is not an isolated timing comparison.

The desktop baseline and first iPad candidate ran concurrently on separate
devices, sharing the network. Treat those single pairs as indicative, not precise
effect-size estimates. The desktop candidate's interaction readiness was 9.11 s
versus 9.13 s before: this change primarily improves completion of visual detail.
Sampling is roughly 500 ms. The results do not meet the five-second goal.

Final initial residency matched each device's baseline: Quest 147 pages, desktop
207, and iPad 358, with admitted visible detail fraction 1. Desktop screenshots
were visually checked; the game region's mean absolute RGB differences were
0.058/0.064/0.085 on a 0–255 scale. This is not a claim of pixel-identical output.

## Adversarial review and validation

Review corrected an extra startup redraw and an unnecessary wait for the final
progressive timer. The settled check runs after resource publication flags are
refreshed, and outstanding asynchronous pages prevent premature urgent settlement.
The new tests verify no scene clear/draw during preparation, continued preparation
alongside surface publication, camera and timer responses, and immediate settled
presentation. Existing overlay, lifecycle, and external-frame coverage also passes.

- 1,491 tests across 170 files pass; all 64 glTF manifest cases pass.
- Typechecking, renderer lint, renderer build, and fixture build pass.
- Root `pnpm dev` Nova smoke passes after restarting against the rebuilt Royal: no
  page errors, failed module requests, or Vite overlay. The first shared-browser
  attempt hit resource exhaustion with `/tmp` nearly full; old benchmark artifacts
  were preserved on disk and a fresh hardware browser completed the check.
- Desktop and Quest repeated wheel-zoom cycles settle without page failures.
- Physical iPad forced context loss recovers to generation 2, followed by four
  synthetic wheel-zoom cycles and successful trusted touch selection. The wheel
  events are not a claim of a physical pinch-gesture test.
- All recorded hardware runs remain within the persistent GPU budget and report
  zero failed VT pages. Zoom settlement durations include stability polling and
  must not be reported as input latency.

See `decoupled-vt-presentation-summary.json` for results. Local raw CPU profiles,
source-mapped summaries, and flame graphs live under
`/tmp/royal-nova-profiles/four-quest-{baseline,candidate}-cpu/`.
