# Mixed-source VT promotion starvation

The [expanded diagnostic](mixed-stall-diagnostic.json) identifies why the
sixteen-source mixed benchmark cannot finish warm-up at a 128 MiB root budget.
All eight ordinary SVG texture snapshots report ready; all eight native ASTC
VT assets report ready with 21 resident pages each. There are no pending reads,
preparation jobs or failed pages. The missing 168 VT pages belong to automatic
promotion, rather than failed asset transport or decoding.

Ordinary fitted textures retain 100,663,232 bytes, almost the full 96 MiB
ordinary-texture allowance. The native atlas retains 33,542,496 bytes. Total
persistent GPU storage is 134,208,534 bytes against a 134,217,728-byte budget,
leaving only 9,194 bytes. An automatic page needs at least 69,696 bytes before
its page table. No automatic atlas can be admitted. The failure has also been
reproduced without the optional upload counter and without context restoration.

Ordinary storage planning in `surface-gpu-owner.ts` includes planned geometry,
lights and composite targets, but does not reserve the future automatic VT
pool in this workload. VT separately distributes its nominal pool allowance.
The global budget prevents over-allocation, but does not make these independent
plans jointly feasible.

A [two-line candidate](real-pool-budget-candidate.patch) caps VT pool shares by
current free memory plus retained atlas allocations, including migration
replacements. All 183 runtime tests pass, but the [GPU failure remains](real-pool-budget-failure.json):
ordinary textures can finish allocating after the native pool has been sized.
The same final budget exhaustion occurs. The candidate is not retained.

The next fix must coordinate anticipated ordinary storage with VT reservations
or safely revise storage after later claims arrive. Increasing the root budget
alone did not resolve this proportional-allocation conflict. This report does
not establish a render crash or failed SVG source: the asset snapshots are
ready, while automatic VT promotion remains unresident. No frame-time or GC
claim follows from runs that never reached the measurement window.

Runtime source is restored byte-for-byte and all 183 runtime tests pass after
restoration. Research typechecking and rebuilding pass; the after server again
serves current production source. Research diagnostics now include per-asset
snapshots and all resource budgets on timeout. No commit was made.
