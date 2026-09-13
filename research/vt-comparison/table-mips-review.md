# Page-table mip upload experiment

This historical pause is superseded by the [corrected-baseline evaluation](table-mips-measured-review.md),
which retains the candidate after resolving the reservation conflict.

The [two-line candidate](table-mips-candidate.patch) computes the highest mip
affected by incremental page additions and uploads only that mip and its
descendants. Full rebuilds still upload all table levels. No persistent state
or new arrays are needed; upload admission continues to conservatively charge
the complete table. The candidate is saved for further evaluation, not retained
in production.

The existing runtime batch test observed three GL calls instead of four for a
fine-page batch, as expected. The other 182 runtime tests passed unchanged.
Root and research typechecking passed. Before retaining the candidate, the GPU
comparison exposed a baseline mixed-source workload that does not settle.

The [baseline failure record](table-mips-baseline-failures.json) captures sixteen
mixed sources at 64 and 128 MiB budgets on headless Intel Vulkan. The 128 MiB
case also fails without requesting context restoration, isolating a stall in
initial loading. These runs never enter the measurement window and establish
no timing or GC benefit. The optional upload-counting wrapper records texture
unit 5 Uint8Array uploads. A fourth run without that wrapper also stalls during
initial loading at 128 MiB, so the wrapper is not required to reproduce it.

Runtime and test expectations are restored while this failure is investigated;
all 183 runtime tests pass after restoration.
The before build serves the original runtime; the after build still contains
the experimental candidate and must be rebuilt before testing current source.
No commit was made.
