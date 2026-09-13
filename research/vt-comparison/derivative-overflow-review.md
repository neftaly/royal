# Preserve fallback demand for indeterminate derivatives

Finite transformed UVs can overflow intermediate derivative arithmetic. An
`Infinity - Infinity` result then makes the footprint and selected mip `NaN`.
The triangle previously emitted no demand in that case, contrary to the stated
coarsest-mip overflow policy.

The regression uses positive and negative finite UV scales and checks each
triangle separately. Testing the complete plane initially hid the failure,
because the other triangle still emitted fallback demand. Both parameterized
tests failed with zero demand for an isolated triangle before the fix.

The mip expression now explicitly maps a NaN footprint to the coarsest mip.
Finite footprints, zero footprints and infinite footprints retain their prior
behavior. This adds no source lines, cache or scratch state. It conservatively
preserves demand; it does not promise accurate GPU sampling of extreme UVs that
exceed shader precision.

Second review checked that a NaN sample cannot poison the triangle's mip range,
that ordinary samples still contribute their finer levels, and that perspective
subdivision retains its existing depth bound. The finest-footprint scratch is
only updated by a smaller numeric footprint, so this fallback does not turn
indeterminate arithmetic into a false fine-resolution preview request.

Four alternating isolated CPU rounds initially showed coincident geometry
2220.16→2212.37 ms and grid geometry 1395.89→1456.77 ms. A repeat measured
2251.49→2218.38 ms and 1418.41→1418.55 ms, respectively. The initial grid slowdown
did not repeat. Isolated allocation sampling was mixed: coincident geometry
4,827,656→23,772,520 sampled bytes, grid 34,190,344→17,000,248. These observations
prompted a full browser comparison rather than a claim of allocation neutrality.

The headless Intel Iris Xe comparison uses 600 warmed moving frames, 16 SVG
identities and a 256 MiB atlas budget. Both builds' source maps match the recorded
demand source hashes.

| Measurement | Before | After |
| --- | ---: | ---: |
| Median / p95 submission | 0.6 / 0.9 ms | 0.6 / 0.9 ms |
| Total sampled allocation | 14,841,716 B | 13,792,732 B |
| GC events / total pause | 10 / 7.809 ms | 10 / 7.229 ms |
| Resident pages | 336 | 336 |
| Atlas bytes | 35,684,352 | 35,684,352 |

All final VT state matches. These runs do not establish a speed or GC benefit;
they found no material regression in this browser workload.

Validation passes 1,277 tests across 149 files, the 65-case glTF manifest check,
root types and lint, 44 host-GPU source cases, packed consumers and bundle checks.
The package exceeded its previous limit by 21 bytes and lazy/deployed gzip by
9/5 bytes. Named allowances add 32 package bytes and 16 gzip bytes. All changes
remain uncommitted.

Artifacts: [patch](derivative-overflow.patch),
[CPU comparison and hashes](derivative-overflow-comparison.json),
[CPU repeat](derivative-overflow-repeat.json),
[isolated allocation profile](derivative-overflow-profile.json),
[host before](derivative-overflow-host-before.json),
[host after](derivative-overflow-host-after.json),
[mapped before profile](derivative-overflow-host-profile-before.json),
[mapped after profile](derivative-overflow-host-profile-after.json),
[source matrix](derivative-overflow-source-regression.json).
