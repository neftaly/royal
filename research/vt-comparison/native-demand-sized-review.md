# Native atlas demand sizing: rejected shortcut

The capped-page GPU fixture retains only three native pages, but its fixed atlas
accounts for 33,546,240 bytes with ASTC 6×6 or 33,530,112 with ASTC 8×8. Those are
measured atlas allocations, not the smaller per-texture residency limits. The
memory tradeoff merits review, but initial visible demand is not an upper bound
on the future population of a shared pool.

A one-line candidate made native allocation use the existing demand-derived
slot target, just like RGBA allocation. It adds no production lines, but the
current resize path explicitly returns unchanged for compressed atlases.
Consequently, a pool allocated for one page cannot admit later textures when
its only slot is already protected. The candidate is **not retained**.
[Candidate patch](native-demand-sized-candidate.patch),
[source hashes](native-demand-sized-sources.json).

## Adversarial admission checks

Six runtime tests cover ETC2, ASTC 6×6, ASTC 8×8, BC1, BC3 and BC7. They first
make one one-page texture resident, then add four more compatible textures.
Every texture must receive a resident page in the same atlas. Removing the
original owner preserves the four neighbors, and another 100 updates cause no
extra reads, uploads or atlas allocations. Disposal releases all retained GPU
budget. The retained implementation passes; the candidate fails all six cases
because later textures remain at zero residency.

The candidate was applied only inside a try/finally experiment and the runtime
was restored byte-for-byte. The final runtime/growth/storage/residency suites
pass 243 tests and root typechecking passes. The added tests preserve late
admission as an explicit requirement for any future allocation redesign.

## Host-GPU follow-up

The colored ASTC replacement fixture now allocates the limited texture's pool
before its neighbor is known. All eight retained-policy cases pass, covering
6×6/8×8, byte/slot ceilings, both scene orders, subsequent eviction and context
restoration. Each finishes with three resident pages and ten uploads, with
correct red/blue replacement and unchanged green/yellow neighboring pages.
[GPU results](native-late-admission-gpu.json).

An isolated candidate build exercises the same fixture without changing the
production source. Its first ASTC 6×6 byte-limit case cannot settle after the
neighbor is introduced. These are concurrent correctness runs, not performance
measurements; the candidate stops at its first failing GPU case.

The [captured failure state](native-demand-sized-gpu-failure.json) reports a
9,216-byte atlas and one resident/uploaded page after 300 frames. The original
texture is resident, but the neighbor has zero resident pages despite status
`ready`, no failure and no pending work. This demonstrates blocked admission,
not a page decode still in progress. [Validation record](native-late-admission-validation.json).

## Decision

Keep the existing fixed native pool allocation for now. Simply reducing its
initial size would save memory by silently reducing coverage for later assets.
A smaller initial native allocation needs a growth/replacement policy that
preserves late admission, valid page-table mappings and root memory limits.
That is additional behavior, not a harmless reuse of the RGBA initial-size
calculation. This review does not implement native pool growth or claim that
the current reservation is optimal. No production changes or commits were made.
