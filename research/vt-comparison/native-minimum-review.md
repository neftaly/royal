# Rejected: omit unused committed-native minimum accounting

The candidate moved coarse-slot accounting into the initial pool-request branch.
Committed compressed atlases never consume those minimums: resizing returns
immediately for compressed storage. New native pools and image pools would
still receive their minimums. The change adds no lines or persistent state and
avoids two map operations per committed-native resource per update.

The extracted aggregation blocks produce identical requests and budget values
across 10,000 generated cases. These include missing/failed manifests, existing
and new pools, resource slot/byte limits, and a nonzero pending-source reserve.
The now-unused committed-native minimum-map entries intentionally differ and
are not part of the compared output. Review checked the remaining consumers:
image-pool shrink planning and initial request construction.

The initial short CPU measurements were noisy. A longer run uses 50,000 warm-up
calls and 250,000 measured calls per version, four alternating rounds. Median
process CPU milliseconds for one shared pool:

| Encoding | Resources | Before | Candidate |
| --- | --- | --- | --- |
| image | 1 | 198.38 | 183.66 |
| image | 16 | 384.23 | 411.53 |
| image | 128 | 1,918.48 | 1,881.05 |
| native | 1 | 133.72 | 129.93 |
| native | 16 | 439.07 | 367.78 |
| native | 128 | 2,144.19 | 1,741.10 |

Native aggregation improves at larger resource counts, but the image-16 median
regresses about 7%. Individual rounds still vary; these measurements do not
establish a full-frame slowdown or benefit. Decision: reject the candidate as
a general frame-cost optimization. It was not promoted to a GPU performance
comparison or assigned additional size allowance. No allocation/GC conclusion
is claimed from the process CPU measurements.

The production runtime was restored byte-for-byte. The archived patch records
the candidate; the browser build was never changed for this experiment.

Artifacts: [longer CPU/equivalence run](native-minimum-comparison.json),
[initial short run](native-minimum-comparison-initial.json),
[comparison script](compare-native-minimum.mjs), [patch](native-minimum.patch).
The script reads `/tmp/royal-vt-before-native-minimum.ts` and
`/tmp/royal-vt-native-minimum-candidate.ts`; reconstruct them with the archived
patch and verify the source hashes before rerunning with `node --expose-gc`.
Refresh, key construction, byte lookup and final allocation are stubbed equally;
this benchmark isolates aggregation and excludes rendering and async work.
Everything remains uncommitted.

After restoration, all 106 runtime/growth tests and root typechecking pass.
