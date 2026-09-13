# Reserve declared VT capacity before fitting ordinary textures

The retained [one-line change](planned-reserve.patch) adds the existing 75%
VT atlas allowance to planned non-ordinary storage when a scene declares
authored VT assets. Ordinary fallback textures are fitted from the remainder
after geometry, lighting and composite reservations. This makes the two planned
allowances fit the root budget before asynchronous uploads claim it, instead of
relying on the current free-memory balance.

This is deliberately conservative: ordinary texture storage in such scenes is
limited to at most the remaining quarter, even when the authored pool ultimately
uses less memory or is unsupported. It applies to all ordinary textures in the
scene, not only SVG fallbacks. Scenes without declared authored VT keep their
previous ordinary budget. The reservation is shared once per scene, not repeated
per authored texture. Removing authored VT restores the planning allowance;
this is not a claim that already-fitted textures are automatically enlarged.

The previously stalled sixteen-source mixed workload now reaches all 336
resident pages at both [64 MiB](planned-reserve-64.json) and
[128 MiB](planned-reserve-128.json) on headless Intel Vulkan. Both runs also
restore all 336 pages after real context loss, finish with 672 page uploads,
two pools, and no failed, pending or unresident pages. Automatic decoded
storage is 4 MiB. There are no GL errors and the center-pixel check passes.
The final screenshots are not byte-identical across the two budgets: 13,275
pixels differ, with maximum RGB differences 5/2/3. These runs do not establish
pixel equivalence or a speedup over the baseline, which never reached measured
frames.

The subsequent [eight-case matrix](planned-reserve-matrix.json) completes both
ASTC 6×6/8×8, both scene source orders, and both 64/128 MiB budgets. Every case
reaches 336 resident pages before context loss and again after restoration,
ending with 672 uploads, two pools, zero failed/pending/unresident pages and
4 MiB of automatic decoded storage. These are sequential headless Intel runs.
Scene order varies; arbitrary transport completion orders and other GPUs are
not covered by this matrix. No additional production change was needed.

Two budget regressions cover one and three authored assets, joint allowance
feasibility, removal and disposal. Both fail with the original planner and
pass after restoring the change. The existing full suite passes 1,464 tests
and 65 glTF manifest cases before these two tests were added; the five-test
budget file passes afterward. Root typechecking, lint, bundle-size and packed
consumer checks pass without increasing size ceilings.

The new computation runs during storage planning, adds no retained state, and
creates no objects. It does not add work to the frame loop. This structural
observation is not a measured whole-browser GC improvement. No commit was made.
