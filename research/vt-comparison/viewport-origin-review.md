# Ignore viewport origin in the VT demand cache key

Demand transforms geometry with the view-projection matrix and uses viewport
width and height for projected derivatives. Viewport x/y only place the result
on the framebuffer; the demand calculation does not read them. Tracking them
caused unnecessary full demand passes when an otherwise unchanged viewport moved.

The cache now stores 18 doubles per view instead of 20: the matrix and viewport
dimensions. This removes four runtime lines and 16 scratch bytes per view, with
no new state, allocation or policy. Matrix changes, either dimension and view
count/order still participate in invalidation.

The runtime regression first demonstrated repeated collection during origin-only
updates. After settling initial atlas admission, the candidate reuses demand for
those moves and still collects when width or height changes. Existing coverage
continues to check changed projection, disposal, reactivation and publication.
The actual comparison body also matches an independent serialized-input oracle
for 10,000 generated states, including zero/multiple views. In a separate 10,000
origin-only sequence, invalidations fall from 10,000 to the initial one.

Headless Intel Iris Xe profiles use 600 ordinary moving-camera frames, 16 SVG
identities and a 256 MiB budget. This workload changes the matrix, so it checks
ordinary-frame regression rather than measuring the origin-only optimization.
Both builds' runtime source-map hashes match the comparison artifact.

| Run | Before sampled bytes | After sampled bytes | Before median/p95 | After median/p95 |
| --- | ---: | ---: | --- | --- |
| Before then after | 13,657,532 | 14,619,908 | 0.6 / 0.9 ms | 0.6 / 0.9 ms |
| After then before | 15,758,084 | 14,943,620 | 0.6 / 0.9 ms | 0.5 / 0.9 ms |

The initial allocation increase did not repeat; average sampled bytes differ by
about 0.5%. All runs have ten GC events. Pause totals range 7.647–8.463 ms. No
general timing or GC benefit is claimed. Pixels match in the first pair, and
final VT state matches in both pairs. Source maps report no allocation at the
view-comparison method itself.

Adversarial review checked that origin is absent from demand calculations,
stride and offsets changed together, and count changes still force invalidation.
The full suite passes 1,282 tests across 149 files and the 65-case glTF manifest
check. Types, lint, packed consumers and existing bundle ceilings pass. No size
allowances were added.
The 44-case headless host-GPU source matrix also passes on the retained build.

Artifacts: [patch](viewport-origin.patch),
[oracle and hashes](viewport-origin-comparison.json),
[first before](viewport-origin-host-before.json), [first after](viewport-origin-host-after.json),
[repeat before](viewport-origin-host-before-repeat.json), [repeat after](viewport-origin-host-after-repeat.json),
[source matrix](viewport-origin-source-regression.json).
Everything remains uncommitted.

Follow-up view-transition regression: the runtime test now switches from one
view to no views, restores demand through only the second of two views, moves
that viewport's origin for ten updates without collecting demand again, hides
both views, then restores one view. Atlas growth and admission are allowed ten
updates before the origin check; a single unchanged update was insufficient to
identify settled admission. The subsequent ten updates all preserve the demand
collection count. No additional production change was needed. The full suite
passes 1,292 tests across 149 files plus the 65-case glTF manifest check; types
pass. These are correctness checks, not additional timing measurements.
