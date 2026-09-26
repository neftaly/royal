# Adversarial review fixes

The review's three reproductions now pass:

- Per-frame transform updates no longer discard unfinished demand. Traversals
  snapshot model transforms, bounds, and active instance matrices and publish
  complete results before scanning newer revisions.
- Work accounting spans surfaces, instances (including culled instances), and
  triangles. Small meshes cannot bypass every yield point.
- Close-view settlement and report validation include `pendingDemandResources`.
  Published coverage from an older view cannot alone certify convergence.

A second review found the same starvation mechanism in per-frame scene
replacement. Retained texture resources now finish their captured work across
scene replacement too; removed resources are still disposed. A regression test
covers this independently of transform invalidation. Follow-up inspection found
no further blocking issues in the changed paths. The CPU budget is cooperative,
checked between chunks, not a hard real-time deadline.

## Validation

The full suite passed 1,325 tests across 156 files plus the glTF manifest check.
A subsequent additional instanced-transform snapshot case passed with all nine
scheduling tests (1,326 distinct tests checked in total). Typecheck, lint,
production examples build, bundle-size check, and diff whitespace checks pass.
The first full run hit two timeouts while builds and checks ran concurrently;
the unchanged suite passed when rerun without those competing jobs.

The attached iPad7,6 / iPadOS 17.7.11 ran the saved 60-step Sponza camera probe
against production build `9c339f99bb3c-dirty-muh4sbf5` (`source.json`). Both runs
passed, with p95 63 ms and 59 ms, maximum 64 ms and 60 ms. Before and after each
trial the driver waits for current demand and all admitted pages to settle.
Raw samples and settled renderer snapshots are in `ipad-final-{1,2}.json`.

The Quest was absent from `adb devices`, so this revision was not retested on it.
Earlier Quest results remain in `../device-fixes-9c339f/` and apply to the earlier
build only. Immersive XR was not tested. No user interaction was required.
