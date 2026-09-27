# Nova loading and memory follow-up

A subsequent production investigation removed repeated scene reconstruction in
Probability and reduced observed first-ready time from 59.7 to 23.6 seconds in the final verified run.
See [production follow-up](production-follow-up.md) for measurements and scope.

Full-resolution Nova was loaded through `/home/neftaly/dev/probability` using its
literal root `pnpm dev` with `ROYAL_DEV_PATH=/home/neftaly/dev/royal`. The existing
Nova server's `/compact/` URL serves the full release; no artwork, model layout,
Probability implementation or Nova implementation was changed.

## Measured result

| Metric | Before this profiling pass | Final, quality fix included |
| --- | ---: | ---: |
| Observed ready time | 101.3 s | 60.8 s |
| Renderer-accounted retained GPU storage | 76.4 MiB | 25.4 MiB |
| Demanded/resident VT pages | 624 / 624 | 207 / 207 |
| Texture storage allocations | 852 | 465 |
| Texture upload calls | 3,084 | 1,073 |
| Texture deletions | 197 | 15 |
| Same-source ordinary large-to-small uploads | 190 | 4 |
| Additional raster source reads | 4 | 3 |
| CPU raster-cache peak | <32 MiB | <32 MiB |
| GPU denials / failed pages | 0 / 0 | 0 / 0 |

The browser used Intel Iris Xe via ANGLE/Vulkan, 1280×800 at DPR 1, a fresh browser
profile and disabled HTTP cache. CDP captured a CPU profile, timeline, requests,
long tasks, bitmap lineage and texture uploads. These are instrumented development
runs on a shared host, not a controlled production timing benchmark: Vite startup,
asset publication order and host load vary. An intermediate final-policy run took
84 seconds. The resource-count reductions are stronger evidence than an exact
percentage speedup. Final observed long-task time fell from 77.5 to 34.4 seconds.

Raw recordings and interactive flame graphs are available locally:

- [Baseline flame graph](/tmp/royal-nova-profiles/baseline/flamegraph.html)
- [Final flame graph](/tmp/royal-nova-profiles/quality-fixed/flamegraph.html)
- [Baseline CPU profile](/tmp/royal-nova-profiles/baseline/cpu.cpuprofile)
- [Final CPU profile](/tmp/royal-nova-profiles/quality-fixed/cpu.cpuprofile)
- [Final timeline](/tmp/royal-nova-profiles/quality-fixed/trace.json.gz)

`comparison.json` retains compact before/after evidence. Raw recordings stay out
of the commit. `profile-nova.mjs`, `browser-probe.js` and `analyze-profile.mjs`
reproduce the capture and flame graphs. Start the dev server completely before
running them; `ROYAL_NOVA_URL` and `ROYAL_PROFILE_LABEL` override the defaults.

## Changes supported by the trace

Repeated source/storage-key serialization consumed about 8.4 seconds of sampled
CPU time in the baseline. Weak identity caches preserve field-level mutation,
nested ASTC/sampler changes and validation without rebuilding JSON strings on
ordinary hits. Automatic VT identity uses the same approach.

Transparent depth-partition construction and its repeated subtree sorts consumed
about 11.9 seconds. Texture binding publication now rebinds unchanged members and
bounds; geometry changes still invalidate the partition. Cold construction sorts
each axis once, then partitions those ordered lists. Existing ray-order fuzz tests
cover transparency correctness. The final recursive construction function's
sampled self time was about 1.1 seconds, with other sorting work much smaller.

Incremental texture publication previously uploaded a larger seed, then shrank it
once the next frame observed VT source availability. Fallback sizing now precedes
the first incremental upload. Four initial lazy-VT handoffs remain in the final
run; this is a large reduction, not a claim that every representation transition
has disappeared.

Single-sided demand now rejects only triangles the GPU itself culls. Winding
matches the draw packet, including retained handedness changes. Clipped geometry,
stereo union, double-sided draws, uncertain projections and thin triangles retain
conservative coverage. Ordinary safety coverage remains available for a flip;
newly visible detail uses the usual bounded refinement path. Hidden-face detail
no longer consumes page generation, atlas growth and upload work.

## Visual gate and the extra fix it found

Screenshot comparison caught a tracks-board filtering difference after changing
page scheduling. Disabling ASTC did not remove it; disabling just backface demand
rejection restored the baseline. Bitmap/page tracing then showed the cause:
coarse-first scheduling rendered two detail pages from a 359×183 seed before
reading a 391×200 source for the finer pages. The old ordering used 391×200 for
all ten detail pages. This was source-dependent filtering, not missing coverage.

All detail pages now request a source sufficient for the finest requested mip,
computed once when demand is fitted. The root fallback retains its fast seed
path. This keeps the source cache bounded, avoids intermediate size upgrades,
and removes the ordering-dependent difference. A regression test forces the
coarse-first case and asserts one source read and consistent detail dimensions.

The final screenshot comparison covers 752,100 scene pixels, excluding changing
player-name/UI content. Mean absolute RGB differences are below 0.003 on a 0–255
scale; one pixel differs by more than 8 in any channel. The tracks-board crop has
zero pixels above that threshold. This is strong evidence for this view, not an
exhaustive visual guarantee for every game, camera angle or device.

## Occlusion decision and remaining costs

No arbitrary 99%-covered or 1 mm cutoff was introduced. Nova's printed geometry
uses blended materials; overlapping bounds alone do not prove opaque occlusion.
General depth-occlusion queries or a software depth hierarchy would add another
visibility system and invalidation cost. This pass uses exact GPU backface rules,
existing frustum rejection and projected-demand priorities. Thin visible edges
continue to receive detail.

Many small pieces still require real draw submission and application work. The
final profile includes roughly 6.2 seconds in draw-view submission and 4.7 seconds
in React's development JSX machinery, plus development React instrumentation.
Probability already batches model publications per frame and memoizes individual
model preparation components. A new React cache or app-specific renderer API was
not added without evidence that it would preserve those lifetimes and help
production. Broader draw batching, geometry streaming and encoded-asset storage
remain separate work; the texture changes do not promise every 10× scene fits.

## Validation

A later [physical-device follow-up](mobile-follow-up.md) gets full Nova and
trusted touch selection working on the iPad over HTTPS. It records an intermittent
context-recovery cost and the current Quest tracking-dialog blocker.

The final full suite passes **1,439 tests in 166 files**, plus 64 glTF manifest
cases. Typecheck, lint, packed-consumer/codec checks and package imports pass.
The Probability root route has no page exceptions, failed modules or Vite error
overlay. Intentional runtime-selected worker imports still produce Vite analysis
warnings. An earlier failed Quest harness rerun logged a WebSocket proxy
`ECONNRESET` during navigation; it is not counted as a passing run. The successful
desktop capture and the later genuinely new-document Quest check have separate
validation windows.

The physical iPad7,6 fixture passes cold load, distant/return camera movement and
context restoration with the new demand policy, around 11–13 seconds per camera
settle and bounded GPU/cache storage. The full iPad
Probability game remains blocked before renderer creation by the previously
recorded artifact-initialization error over the insecure LAN development origin.
The final physical Quest game run completes in **42.6 seconds**, with all 172
demanded pages resident, 24.96 MiB retained GPU storage, cache peak below 32 MiB,
zero page failures and zero denied GPU claims (`quest-game-quality-fixed.json`).
Its viewport differs from desktop. The runner leaves the old hash route first
and requires the new document's navigation token before accepting readiness. The
prior immersive Quest enter/render/exit check is recorded in the memory report.
