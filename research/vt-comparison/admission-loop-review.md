# Rejected single-loop admission request construction

A candidate replaced `resources.filter(...).map(...)` with a single loop and
`requests.push(...)`. It removed an intermediate array and two callbacks while
adding two runtime source lines. The actual extracted request-building blocks
produce identical ordered requests for 10,000 deterministic generated cases,
including absent demand, slot limits and byte limits.

Four alternating warmed CPU rounds measured these median CPU milliseconds for
100,000 calls. The workload marks every third resource inactive; the one-resource
case therefore builds an empty request list.

| Resources | Before | Candidate |
| --- | ---: | ---: |
| 1 | 9.60 | 9.87 |
| 16 | 20.88 | 27.58 |
| 128 | 130.63 | 200.81 |

The loop is slower in the isolated multi-resource workloads. A full headless
Intel Iris Xe comparison used 600 warmed moving frames, 16 SVG identities and
a 256 MiB budget to check whether the browser's complete method behaved better.

| Measurement | Before | Candidate |
| --- | ---: | ---: |
| Median / p95 submission | 0.6 / 0.9 ms | 0.6 / 1.0 ms |
| Frame update sampled allocation | 1,737,924 B | 2,655,436 B |
| Total sampled allocation | 14,215,088 B | 13,985,152 B |
| GC events / pause time | 10 / 8.259 ms | 10 / 7.194 ms |

Pixels and all final VT state match. Total sampled allocation and GC pause are
slightly lower, but the changed method's attributed allocation is higher and
there is no submission-time benefit. These small host differences alone do not
establish a general latency regression. Together with the isolated CPU result,
they do not justify retaining the extra code. No particular JIT mechanism is
claimed from these measurements.

The candidate was reverted byte-for-byte to the recorded `before` hash. The
archived patch and `after` hash describe the rejected experiment. No size budgets
changed. The candidate passed 89 runtime/growth tests and root type checking;
the restored runtime was checked with the same tests and the served browser
build was restored as well.

Artifacts: [comparison harness](compare-admission-loop.mjs),
[CPU/equivalence results and hashes](admission-loop-comparison.json),
[patch](admission-loop.patch), [host before](admission-loop-host-before.json),
[host candidate](admission-loop-host-after.json),
[mapped before profile](admission-loop-profile-before.json),
[mapped candidate profile](admission-loop-profile-after.json).
Everything remains uncommitted.
