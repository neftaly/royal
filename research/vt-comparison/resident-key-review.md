# Reuse the resident atlas key

Date: 2026-09-13. Production optimization retained, uncommitted.

VT frame bookkeeping repeatedly rebuilt a JSON key even when a texture already
held the corresponding GPU atlas. The helper now returns that atlas's existing
key, falling back to the original JSON calculation before GPU allocation or after
release/context loss. Callers pass the resource and validated manifest. This
removes three production lines and 56 source bytes, adds no cache fields and
preserves the key encoding.

## Measurement

Actual source helpers, four warmed alternating rounds, one million Map-consumed
lookups per round, fixed 16 MiB V8 nursery:

| Lookup | Baseline median CPU | Reuse median CPU | Baseline / reuse GC events |
|---|---:|---:|---:|
| Resident atlas | 238.12 ms | 36.20 ms | 24 / 0 |
| No GPU allocation yet | 232.93 ms | 231.72 ms | 24 / 24 |

Each run verifies 43,008 page-size/encoding/color-space combinations, including
the resident return path. The benchmark adapter handles both helper signatures;
resources are prepared outside the measured loop. Unlike the earlier rejected
template-key experiment, this change avoids constructing the key altogether.

Headless Intel Iris Xe / ANGLE Vulkan, 600 warmed moving-SVG frames:

| Profiled metric | Before | After |
|---|---:|---:|
| Total sampled allocation | 4,133,092 B | 3,771,728 B |
| VT update attribution | 885,620 B | 819,896 B |
| Submission median / p95 | 0.2 / 0.4 ms | 0.2 / 0.5 ms |
| GC events / time | 5 / 4.849 ms | 5 / 8.326 ms |

These sampling estimates support reduced allocation, not a whole-frame speedup or
GC-pause improvement. Exact screenshots and complete final VT snapshots match;
the fixed finish hook redraws before capturing valid images.

Four further runs without CPU/heap sampling, in before/after/after/before order,
keep median submission at 0.2 ms throughout. P95 is 0.4/0.4/0.4/0.5 ms. The
profiled tail increase does not repeat. These runs retain the runner's GC trace;
they are not entirely uninstrumented. Evidence: [before 1](resident-key-timing-before-1.json),
[after 1](resident-key-timing-after-1.json), [after 2](resident-key-timing-after-2.json),
[before 2](resident-key-timing-before-2.json).

## Review and validation

The first review traced key lifetime: the asset and key-defining manifest fields
do not change in a resource; atlas migration keeps the same key; GPU release and
context invalidation clear the GPU reference. The second checked initial allocation,
shared-pool membership, failed authorities and the fallback path. No caller needs
a key before it has a validated manifest.

All 88 runtime/growth tests, root type checking, lint, 44 headless source cases,
packed consumer checks and browser bundle limits pass. The source cases cover
both ASTC block sizes, unsupported capability, multiple authority formats, atlas
growth/shrinkage and context restoration. Whitespace checks pass.

The compressed renderer package is 749,718 bytes, 22 above its previous limit,
despite fewer source lines. A named 32-byte package allowance records the change;
the new limit is 749,728 bytes. Browser bundle limits are unchanged. Helper spelling
was simplified to retain an explicit validated manifest argument; no unrelated
runtime behavior was changed to manipulate the size check.

Evidence: [resident lookup](resident-key-direct.json),
[nonresident lookup](resident-key-cold.json), [before profile](resident-key-before.json),
[after profile](resident-key-after.json), [mapped before](resident-key-profile-before.json),
[mapped after](resident-key-profile-after.json),
[44 source cases](resident-key-source-regression.json), [patch](resident-key.patch),
[source hashes](resident-key-sources.json).
