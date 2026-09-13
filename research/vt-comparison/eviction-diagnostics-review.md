# Eviction profile: separating diagnostic overhead

The eviction fixture's repeated snapshot and per-asset checks materially affect
allocation samples. An optional `light` mode now uses successful physical upload
counts to wait during measurement. Full snapshot, per-resource residency, pending
bytes and color checks still run during warm-up and at finish. The default mode
retains its checks after each replacement.

Both modes wrap `compressedTexSubImage2D` identically, forwarding its arguments
and incrementing a counter only after the call returns. The wrapper still adds
harness overhead. Light mode observes submission, not GPU completion; it waits
for the next animation-frame turn, and final checks verify logical publication
and rendered colors. A timeout reports the runtime snapshot. It does not silently
accept missing uploads or skip final correctness checks.

## Alternating headless host-GPU profiles

All runs use normal ASTC 8×8 pages, 32 warm-up replacements and 128 measured
replacements. Order is full, light, light-repeat, full-repeat, with separate
browser processes and no concurrent builds, tests or timing workloads.

| Run | Sampled allocation bytes | GC events | GC total ms |
| --- | ---: | ---: | ---: |
| [Full](eviction-diagnostics-full.json) | 4,885,368 | 6 | 5.600 |
| [Light](eviction-diagnostics-light.json) | 3,638,896 | 6 | 5.608 |
| [Light repeat](eviction-diagnostics-light-repeat.json) | 4,261,692 | 6 | 5.841 |
| [Full repeat](eviction-diagnostics-full-repeat.json) | 4,852,352 | 6 | 5.148 |

Every run reports 257 rendered frames between preparation and finish, 163 total
page reads/uploads including initial coverage and warm-up, two neighboring page
reads, three final resident pages, zero pending bytes and no live response bodies
in the tracked ring. Final VT snapshots and sampled colors are identical.

The paired light samples are about 12–26% lower. Texture-key allocation samples
fall from 230,056/328,568 bytes in full runs to 98,352/98,496 in light runs. This
supports diagnostic-call overhead as a contributor to the earlier key hotspot.
Visibility processing, matrices and VT updates remain prominent after reducing
that overhead. [Source-mapped allocation summary](eviction-diagnostics-allocation-summary.json).

These are allocation-sampling estimates, not exact counts or a renderer speedup.
GC counts do not improve. The fixture still includes fetch/WeakRef wrappers,
promises, transform updates, explicit invalidation and rAF; neither mode measures
production-only allocation. The default correctness mode remains useful, while
light mode provides a less intrusive starting point for subsequent profiling.

Research typechecking and the browser build pass. No production source changes
or commits were made. [Validation record](eviction-diagnostics-validation.json).
