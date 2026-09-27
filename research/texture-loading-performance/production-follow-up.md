# Removing repeated scene work during Nova loading

The initial 60.8-second result was an instrumented development run. A fresh,
cache-disabled production run on Intel Iris Xe ANGLE/Vulkan still reached its
first fully settled sample at 59.681 seconds (62.450 seconds including the
harness's stability window). It reported no page errors and 36.272 seconds of
main-thread long tasks. Development overhead was therefore not the explanation.

A production CPU profile (`production-cpu`) identified 9.128 seconds of self time
in draw submission, plus substantial scene reconstruction and depth-plan work.
Probability's scene-node projector already preserves unchanged nodes across
texture/interaction readiness publications, but Game wrapped those nodes in a
new scene on each publication. That invalidated Royal's retained scene plans.

The change in Probability's `apps/play/src/game/Game.tsx` preserves an empty
preview array and memoizes the scene using camera, projected nodes and preview
nodes. Camera, geometry and preview changes still replace the scene. Texture
publication retains Royal's existing incremental path. No renderer budgets,
texture quality, assets or load-completion criteria were reduced.

The first production comparison (`production-stable-scene`) reached first ready
at 19.896 seconds (22.458 including stability), with 2.204 seconds of long tasks.
Both runs had 325 resident images and 207 resident/demanded VT pages, with zero
page exceptions. The scene crop comparison covered 752,100 pixels; mean RGB
absolute difference was 0.00269/255 and six pixels differed by more than 8.
These are individual shared-host runs, not a statistical device benchmark.

Raw results/screenshots and the production CPU flame graph are under
`/tmp/royal-nova-profiles/`. Harness `ROYAL_PROFILE_MODE=timing` omits profiler,
timeline and GL/canvas wrappers; `cpu` captures CPU samples with the same light
probe. Both retain page-error/network checks and require all 324 automatic
candidates before accepting a settled renderer.

An earlier `dev-unprofiled` attempt hit a disposed-renderer error during a
reload and restarted loading. It is explicitly excluded from performance
comparisons. A fresh root `pnpm dev` smoke test is used for the final change.

The React-Compiler-compatible final hook first measured 15.751 seconds to ready,
2.891 seconds to the first image sample, and 1.305 seconds of long tasks. That
run exposed a small tracks-board difference. A constrained-atlas regression
then proved the underlying ordering bug: sizing the raster after admission
truncation can render early coarse detail from the seed and later detail from
an upgraded source. The new test fails against that previous policy.

Detail raster sizing now uses requested demand before temporary atlas admission;
the existing 16 MiB source and 32 MiB cache limits remain enforced. This may
prepare a larger CPU source than current GPU admission requires, but avoids
repeated decode upgrades and scheduling-dependent filtering as the atlas grows.
The root fallback remains cheap. Camera-dependent refinement remains supported.

The final instrumented upload/source check (`production-admission-fixed`) has
zero pixels differing by more than 8 in the scene crop (mean RGB difference
0.00185/255). The constrained-atlas test fails before the fix and passes after
it. All 210 VT/cache tests pass, plus Royal typecheck/lint, Probability
typecheck/lint and its three existing scene-projection tests.

## Final verification

The final unprofiled, cache-disabled hardware run (`production-verified`) reaches
first ready at **23.635 seconds**, versus **59.681 seconds** before this follow-up
(about 60% less time). First image sample is 5.021 seconds; long tasks total
2.463 seconds versus 36.272 seconds. It retains 325 images / 207 demanded and
resident pages, approximately 25.7 MiB accounted GPU storage, and zero errors.
The final screenshot has zero scene pixels over the 8/255 difference threshold
and mean absolute RGB difference 0.000782/255. Earlier intermediate runs were
16–20 seconds; the final reported number is the verified run, not the fastest.

The final literal root `pnpm dev` smoke run (`dev-admission-fixed`) also passes:
36.214 seconds to first ready, zero page exceptions, failed modules or dev-server
errors. Timing variation on this shared host remains material. These follow-up
timings are desktop hardware measurements, not new Quest/iPad measurements.

Remaining opportunities include reducing initial source decode work (authored
small previews or precomputed pages) and further draw submission batching. The
measured scene reconstruction waste is removed without changing those systems.
Changes remain uncommitted in Royal and Probability; Nova assets are unchanged.
