# Stop malformed-coverage fallback at demand capacity

The non-finite UV fallback scanned every page in the coarsest authored mip even
after filling the demand workspace. Manifests may intentionally omit smaller
mips, so their coarsest level need not be a single page. A valid one-level
1024×1024 page layout caused 1,048,576 membership checks with capacity four.

The new regression failed on that exact count before the fix. An overflow exit
now stops after the fifth check, retaining the same four pages in the same order
and setting the same overflow flag. The production change adds three lines,
without allocations, state or format-specific branches.

Adversarial review checked that the exit happens only after a new page exceeds
capacity: duplicate pages do not set overflow and cannot incorrectly stop the
scan. Existing outer triangle, instance and surface loops already stop on
overflow. Normal one-page fallback remains unchanged. This guards CPU traversal;
it does not claim that the oversized test manifest fits a device's GPU limits.

The actual source helper was exposed through a Vite build for four alternating
warmed rounds. Median wall times, including workspace reset:

| Coarsest layout | Calls | Before | After |
| --- | ---: | ---: | ---: |
| 1×1 | 100,000 | 10.528 ms | 10.128 ms |
| 1024×1024, capacity four | 10 | 270.841 ms | 0.036 ms |

The large difference applies to deliberately overflowing malformed coverage,
not ordinary rendering. The tiny candidate time approaches measurement overhead;
the deterministic page-check reduction is stronger evidence than its exact
timing ratio. This benchmark does not measure GC or GPU time. The source change
adds no allocating expression.

Validation: 190 VT tests across 13 files, root types and lint, and 44 headless
Intel Iris Xe source-combination cases pass. The latter checks normal source
refinement; the unit regression checks the oversized malformed fallback.
Package and gzip outputs exceeded previous limits by 5 bytes and 2–3 bytes,
respectively; named allowances add 16 package bytes and 8 gzip bytes.

Artifacts: [regression and timing harness](compare-coarsest-overflow.mjs),
[timings and source hashes](coarsest-overflow-comparison.json),
[source patch](coarsest-overflow.patch),
[host-GPU results](coarsest-overflow-source-regression.json).
Changes remain uncommitted.

## Combined boundary-fix audit

After both the large-UV tile traversal fix and this overflow fix, the full
`pnpm test` command passes 1,275 tests across 149 files and the 65-case glTF lab
manifest check. The current demand source hash matches this report's comparison
artifact and the source embedded in the host-GPU build's source map.

Review of the capacity boundary confirms `addPage` checks existing membership
before capacity. Repeated coverage of an already full workspace therefore does
not itself set overflow; the new early return requires a genuinely additional
page. Workspace reset clears the overflow flag for a new pass. Existing tests
also cover repeated demand after truncation and restarting a discarded pass at
a coarser mip.

The authored runtime uses the `all` ancestor policy, while generated full mip
chains use `coarsest`. The new early return does not change that distinction or
the truncation policy. No additional production changes were needed for this
combined review.
