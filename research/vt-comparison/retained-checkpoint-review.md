# Retained VT checkpoint

This archived checkpoint precedes the retained
[viewport-origin improvement](viewport-origin-review.md), which records its
own source hashes and the subsequent 1,282-test validation.

This checkpoint combines the accepted full-source/native-preview work with the
retained demand, scheduling and allocation changes. It includes shared raster
cancellation and ETC2 unsupported-device regressions. Everything is uncommitted;
no commit, push or deployment was performed.

`pnpm test` passes 1,280 tests across 149 files, followed by the 65-case glTF lab
manifest check. Root type checking, repository lint and the complete research
TypeScript project also pass. [The checkpoint record](retained-checkpoint.json)
contains SHA-256 hashes for all modified renderer sources and both size budgets.

Runtime and demand source-map contents in the served candidate build match the
working files. The runtime matches the pre-experiment hashes for both rejected
lazy compressed-set and admission-loop changes. It still includes the retained
idle scheduler scan improvement. Demand matches the validated derivative-fallback
checkpoint, including bounded tile traversal and coarsest overflow handling.

The opening README measurements describe the earlier September 12 follow-up;
their test counts and source-line totals are historical. Subsequent reports
record accepted and rejected work separately. A report's candidate results must
not be treated as proof that its candidate remains implemented.

Current authoring behavior is documented in
[raster preview metadata](../../docs/specs/raster-texture-previews.md) and
[textures and VT](../../docs/specs/textures-and-virtual-texturing.md).
Preview-first loading defers full-raster work, while generated pages remain RGBA
and native authored pages require device support. No runtime transcoding was
introduced. Physical mobile-device performance remains unmeasured.
