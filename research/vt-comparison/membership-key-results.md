# Atlas membership scan and rejected key experiment

Date: 2026-09-13. Work remains uncommitted.

## Retained change

The per-atlas sharing pass now collects matching resources and checks whether their
limits need recomputing in one explicit scan. This removes the intermediate spread
array and the filter/some callbacks. Pool membership, ordering, the refit condition,
and the allocator are unchanged. The final change adds three production lines,
including a shorter fairness comment, and fits the unchanged package-size ceiling.

Review checked absent/failed manifests, inactive resources, later arrivals sharing
protected slots, demand revision changes, and active migrations. No cache or
cross-frame state was added. The second review checked that the membership key
calculation is pure, short-circuiting the dirty flag preserves the former `some`
behavior, and all resources are still collected even once the flag becomes true.
All 86 runtime/growth tests, root types, lint, bundle-size and packed consumer checks
pass. All 24 [final headless source cases](membership-final-regression.json) also
pass. The final executable code matches the membership-only benchmark; only a
comment and an inferred array type differ from its initial captured source.

Headless Intel Iris Xe / ANGLE Vulkan, 600 warmed moving-SVG frames:

| Profiled metric | Before | Membership scan |
|---|---:|---:|
| Submission median / p95 | 0.3 / 0.6 ms | 0.3 / 1.9 ms |
| Sampled runtime-update allocation | 1,049,268 B | 721,436 B |
| Total sampled allocation | 3,970,712 B | 3,444,584 B |
| GC events / time | 5 / 12.639 ms | 5 / 20.601 ms |

The initial tail regression prompted four further runs without tracing or sampling,
in before/after/after/before order. Medians were 0.3 ms in all runs; p95 was
0.5/0.6 ms for the baseline and 0.6/0.6 ms for the candidate. The large tail regression
did not repeat, but these results do not prove a frame-time improvement. The change
is retained for simpler traversal and fewer temporary allocations. Screenshots and
final VT state in the profiled pair match exactly.

Reports: [before](membership-before.json), [after](membership-after.json),
[source-mapped before](membership-profile-before.json),
[source-mapped after](membership-profile-after.json). Unprofiled repetitions:
[before 1](membership-timing-before-1.json), [after 1](membership-timing-after-1.json),
[after 2](membership-timing-after-2.json), [before 2](membership-timing-before-2.json).

## Rejected key experiment

The internal key uses JSON encoding of stored page size, native format and color
space. Replacing this with a delimited template string appeared attractive: the
fields are validated enums/numbers, and it removed the temporary array with four
fewer source lines. The experiment preserved 43,008 input mappings across 14,336
unique keys, passed 86 runtime/growth tests and 24 headless source cases, and produced
identical screenshots and final state. Whole-frame profiled median/p95 remained
0.3/0.5 ms; total sampled allocation differed by only about 2.4%, too small to isolate
confidently with this sampling setup.

A direct benchmark of the actual source helper changed the decision. It consumes
each generated key with a Map lookup, as the runtime does, rather than merely
reading string length. Four warmed alternating rounds of one million calls, with
fixed 16 MiB V8 nursery, produced:

| Key | Median CPU per round | GC events across four rounds |
|---|---:|---:|
| JSON | 281.01 ms | 24 |
| Template string | 291.26 ms | 36 |

The template key was slower and collected more often in this workload. It was
reverted; the final renderer retains the JSON key. String construction costs cannot
be inferred just from source-level array counts. An initial length-only pilot was
replaced with Map consumption before recording the final direct benchmark.

Evidence: [direct benchmark](atlas-key-comparison.json),
[profiled before](atlas-key-before.json), [profiled candidate](atlas-key-after.json),
[candidate source cases](atlas-key-regression.json), and [rejected patch](atlas-key.patch).
The key candidate is research evidence only, not the final production state.
The [membership patch](membership.patch) and [source hashes](membership-key-sources.json)
identify the retained change and experiment checkpoints.

## Diagnostic image correction (2026-09-13)

The old steady-fixture image/pixel comparisons do not establish visual equivalence:
a later audit found that finish-hook readback could occur after WebGL discarded
the drawing buffer. Identical black images were therefore an invalid visual oracle.
Timing, allocation profiles and VT state counters were captured separately and
remain the recorded measurements. The separate source-combination rendering gates
are unaffected. See [the diagnostic redraw review](diagnostic-redraw-review.md).
