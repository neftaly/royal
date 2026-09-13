# Failed ancestor scheduling

Three new runtime regressions check an HTTP 404 at the coarsest authored page
while all four finest pages are healthy, using image, ASTC 6x6 and ASTC 8x8 page
storage. The parent is requested first, its failure allows child preparation to
proceed, and all four children become resident. One hundred alternating coarse
and fine viewport updates issue no additional reads: exactly five page reads
occur, including the failed parent. Disposal releases the GPU budget.

The first assertion incorrectly expected zero unresident pages. The snapshot
counts the failed parent as unresident while its four children are resident,
so the correct settled state is four resident, one failed, one unresident and
zero pending pages. This is not a hidden retry queue. The regression now asserts
that exact state after returning to the fine view.

A control that keeps waiting for a failed ancestor prevents child loading and
fails all three cases. Production is restored byte-for-byte afterward. The three
ancestor cases and seven manifest-scheduling tests pass, as does root TypeScript.
No production change was required.

This fake-GL check establishes scheduling progress, request counts and budget
release, not visual correctness while sampling a missing coarse mip. It does not
claim zero overall frame allocations or measure GPU throughput. No commit.

## GPU sampling follow-up

The production shader is tested separately with a missing coarse table entry
and resident constant-red fine pages. Eighteen headless Intel Iris Xe ANGLE
Vulkan cases cover RGBA, ASTC 6x6 and ASTC 8x8; mip blending on/off; and viewport
widths 512, 180 and 128 for fine, fractional and coarse LOD selection on a
256-pixel virtual texture. Every readback is opaque red within one byte, with no
GL error. The existing shader falls back to the base page table when a requested
coarse entry is missing; no production change is needed.

An isolated shader control disables that fallback. It fails at RGBA, mip blending
off, width 128 with `[55,55,55,255]` instead of red. The failure occurs before
later control cases run. It is recorded in `failed-parent-sampling-validation.json`
alongside the unchanged production shader hash. Passing results are in
`failed-parent-sampling-gpu.json`; the fixture is `failed-parent-sampling.ts`.

This closes the missing-coarse sampling gap for the controlled constant-color
case. It does not test detailed artwork, page seams or correctness of blend
weights between different colors. Runtime request behavior is covered separately
above, and these isolated GPU readbacks are not throughput or GC measurements.
Research TypeScript and whitespace checks pass; no production change or commit.

## Distinct-color mip blending

The fixture's `?blend` mode populates the coarse page with blue while keeping
fine pages red, using two vertically stacked atlas slots. Thirty cases cover
RGBA and both ASTC sizes, blending on/off and viewport widths 512, 224, 180, 144
and 128. Expected colors are computed independently from
`clamp(log2(256 / viewportWidth), 0, 1)`; non-blended cases select the lower mip.
All readbacks match within one byte. For blended RGBA, the three intermediate
results are `[206,0,49,255]`, `[125,0,130,255]` and `[43,0,212,255]`.

An isolated control forces the blend weight to zero. It fails at width 224 with
`[255,0,0,255]` instead of `[206,0,49,255]`. The original eighteen missing-parent
cases also pass after extending the fixture. Results are
`distinct-mip-blend-gpu.json` and `failed-parent-sampling-regression.json`;
`distinct-mip-blend-validation.json` records the control and source hash.

These checks establish blend weights for constant red/blue mip contents. They
still do not establish spatial filtering accuracy across detailed page borders
or scene-level derivative behavior under arbitrary perspective. No production
change, performance claim or commit.
