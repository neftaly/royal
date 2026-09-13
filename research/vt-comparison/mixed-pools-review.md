# Authored ASTC and automatic SVG pools together

Follow-up: [pending-source reservation](pending-reservation-review.md) resolves
the original mixed SVG/ASTC fixture; future source classes and native migration
remain outside that fix. The findings below record the earlier experiment.

The steady fixture now accepts `case=mixed&copies=4`, alternating two authored
ASTC 8×8 VT resources with two automatic SVG resources. `native-first` reverses
which representation is encountered first. Each identity uses a distinct URI
query. Both pools must allocate and all requested pages must settle before the
measurement phase. The white-center and WebGL-error checks remain active.

Headless Chromium on the Intel Iris Xe Vulkan host GPU:

| Budget | Resource order | Result |
| --- | --- | --- |
| 256 MiB | SVG first | 84 resident pages, two pools, no unresident/pending/failed pages |
| 256 MiB | ASTC first | 84 resident pages, two pools, no unresident/pending/failed pages |
| 16 MiB | SVG first | Fails to settle after 600 frames; one pool, 42 resident and 42 unresident pages |

The successful runs include 120 moving-camera frames after warm-up. This is a
correctness experiment, not a new before/after performance benchmark; do not
interpret the recorded submission timings as comparative evidence.

## Confirmed existing starvation

At 16 MiB the fixed native atlas occupies 12,577,280 bytes. The combined atlas
allowance is 12,582,912 bytes (75% of the root budget), leaving only 5,632 bytes
for the image pool, less than one 69,696-byte RGBA page. The native resources
have their 42 pages resident; the two SVG resources never allocate their pool.
There are no pending reads, failed pages or reported atlas growth failures.

Running exactly the same fixture against the runtime before pool finalization
produces identical VT counters. Thus this is an existing allocation-policy
limitation, not a regression from that optimization. Runtime hashes and the
failure states are archived in the comparison JSON.

This remains unresolved. The concrete follow-up is to reserve coarse coverage
for other visible pools before committing a fixed compressed atlas. Such a
change must preserve the combined atlas allowance, consider insertion order,
and distinguish resources present at allocation from those arriving later.
Compressed migration remains a separate issue. Manifest physicalSlots and
physicalByteBudget cap per-resource residency, not shared atlas allocation, so
lowering those fields would not repair this result.

No production code changed during this experiment. Research typechecking and
both 256 MiB host-GPU cases pass; the two 16 MiB executions intentionally expose
the failure. Do not summarize this as all mixed-pool cases passing.

Artifacts: [SVG-first success](mixed-pools-256-svg-first.json),
[ASTC-first success](mixed-pools-256-native-first.json),
[before/after failure states](mixed-pools-16-failure-comparison.json).
Reproduce with the existing build and headless host runner, using
`steady.html?case=mixed&motion=move&copies=4&budget=16&frames=120` or replacing
`budget=16` with `budget=256`; append `&native-first` for the reverse order.
Everything remains uncommitted.
