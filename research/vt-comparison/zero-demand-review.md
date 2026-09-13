# Early zero-demand allocation skip: not retained

The candidate moves the existing zero-count/no-atlas continue ahead of three
allocation-map writes, adding no lines or state. Empty absent pools no longer
insert zero map entries. The resize scan already ignores zero entries, while
live pools still require bookkeeping even with no current demand.

The [extracted aggregation comparison](compare-zero-demand.mjs) produces identical
pool requests and available budgets over 10,000 deterministic resource sets,
including zero demand, absent manifests, failures and native/image pools. This
oracle compares allocation requests, not byte-for-byte map contents: removing
unused zero entries is the intended difference. It is not a full runtime proof.

Isolated Node CPU screening, 16 resources sharing a pool, medians of four
alternating rounds of 50,000 aggregation calls after 10,000 warm-up calls:

| Existing atlas | Empty resources | Before ms | Candidate ms | Change |
| --- | ---: | ---: | ---: | ---: |
| False | 0% | 71.05 | 72.28 | +1.7% |
| False | 50% | 65.82 | 54.61 | -17.0% |
| False | 100% | 77.65 | 35.40 | -54.4% |
| True | 0% | 70.96 | 69.60 | -1.9% |
| True | 50% | 77.51 | 76.69 | -1.1% |
| True | 100% | 72.96 | 78.80 | +8.0% |

Absent-pool empty demand improves, but existing idle-pool aggregation is about
8% slower in this screen. Other cases are mixed/small. Do not trade a speculative
failed-source benefit for this mixed result; keep the current production order.
No browser speed regression is claimed from these Node timings. No candidate
runtime was installed and no browser/size validation was undertaken for it.
The current source remains byte-identical to the archived baseline.

[Measurements and source hashes](zero-demand-comparison.json),
[candidate patch](zero-demand.patch). This experiment records a rejected direction,
not a remaining implementation task. No commits were made.
