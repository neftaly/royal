# Rejected lazy compressed-atlas tracking set

The frame budget pass constructs a compressed-atlas deduplication set even when
all textures use generated image pages. A candidate deferred construction until
the first compressed resource, adding one runtime source line and no persistent
state. It preserved deduplication and default reservation for compressed pools.

Matched headless Intel Iris Xe profiles covered 600 moving frames, 16 SVG
identities and a 256 MiB budget. Both source maps were checked against recorded
runtime hashes before profiling.

| Measurement | Before | Candidate |
| --- | ---: | ---: |
| Median / p95 submission | 0.6 / 0.9 ms | 0.6 / 0.9 ms |
| Total sampled allocation | 14,481,976 B | 14,292,572 B |
| Frame update sampled allocation | 1,606,624 B | 1,541,004 B |
| GC events / pause time | 10 / 8.080 ms | 10 / 7.307 ms |

Final VT state and pixels match exactly. The allocation difference is small and
sampled; these runs establish no timing or GC-count benefit. A separate candidate
run with two authored ASTC 8×8 textures also passes: one atlas, 42 resident pages,
no pending/failed/unresident pages, and 4,460,544 atlas bytes.

The candidate passes 88 runtime/growth tests, types and lint, but exceeds existing
package and gzip limits: package by 2 bytes, lazy gzip by 10, deployed gzip by 6,
and Royal-only main graph gzip by 8. The modest result does not justify further
size allowances or retained code growth. The candidate was reverted byte-for-byte
to the `before` source hash. No budgets changed.

The archived patch and `after` hash describe the rejected candidate, not the
current runtime. The restored runtime passes the 88 runtime/growth tests.

Artifacts: [patch](lazy-compressed.patch), [source hashes](lazy-compressed-sources.json),
[host before](lazy-compressed-host-before.json), [host candidate](lazy-compressed-host-after.json),
[mapped before profile](lazy-compressed-profile-before.json),
[mapped candidate profile](lazy-compressed-profile-after.json),
[candidate ASTC case](lazy-compressed-astc-regression.json).
Everything remains uncommitted.
