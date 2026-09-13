# Rejected pool-request loop experiment

A fresh 600-frame moving mixed-source profile identifies demand-key Set additions
as the largest sampled allocation stack. Matching build maps resolve the leading
5,691,260-byte sample stack through demand collection and wrapped page insertion;
`current-mixed-allocation-paths.json` records the stack. Pool sharing, iteration
and request construction are smaller contributors. These are sampling estimates,
not exact allocation counts or retained sizes.

No reusable retained key-set implementation was found in the renderer. Replacing
Set with a custom table would add state and code beyond a simple optimization.
The bounded experiment instead replaced pool request `filter(...).map(...)` with
one loop and `push`, removing an intermediate array and callbacks at a net cost
of two production lines. Membership, request order, limits and allocator inputs
remain unchanged. Runtime/growth tests (249) and TypeScript pass for the candidate.

Four sequential headless Intel Iris Xe ANGLE Vulkan profiles use sixteen mixed
SVG/ASTC 8x8 sources, 64 MiB, context restoration and 600 moving frames:

| Build | Sampled allocation bytes | GC events / ms | Submission median / p95 ms |
| --- | ---: | ---: | ---: |
| Before | 16,583,156 | 7 / 9.277 | 0.6 / 1.0 |
| Candidate | 15,473,780 | 7 / 10.354 | 0.7 / 1.1 |
| Candidate repeat | 16,235,308 | 7 / 11.045 | 0.7 / 1.1 |
| Before repeat | 14,119,836 | 7 / 9.904 | 0.7 / 1.1 |

All runs finish with 336 resident pages, 672 uploads after restoration, and no
pending, failed or unresident pages. Sampling/tracing adds overhead; submission
times are not GPU times. Baseline allocation variation exceeds the apparent first
pair improvement, and the candidate's values overlap it. No repeatable allocation,
GC-event or submission improvement is established. This does not prove a regression
either, but does not justify retaining extra code for the requested GC work.

The candidate is rejected and runtime restored byte-for-byte, followed by the 249
runtime/growth tests and rebuilding the current research client. No budget ceilings
changed. The patch is archived as `pool-request-loop-candidate.patch`, with hashes
and artifact names in `pool-request-loop-comparison.json`. Each profile stores its
mapped entries captured against its own build; do not remap older raw profiles
against newly rebuilt source maps. No commit was made.
