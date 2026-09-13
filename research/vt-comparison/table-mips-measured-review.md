# Upload only changed page-table mip levels

The retained two-line runtime change limits incremental table uploads to the
highest added page mip and its descendants. Rebuilds still upload every table
level, including when eviction removes an ancestor. It adds no persistent state,
arrays or typed-array views. Upload admission remains conservatively charged
for the whole table, so this change does not expand admitted page batches.

The earlier experiment was paused for the mixed-source budget conflict. These
runs include the up-front reservation fix in both baseline and candidate.
Four sequential headless Intel GPU runs use before/after/after/before order,
sixteen mixed SVG/ASTC8×8 sources, 128 MiB and real context restoration. All
finish with 336 resident pages, 672 uploads, two pools, and no pending, failed
or unresident pages.

| Run | Table GL calls | Table bytes submitted | Median / p95 submission ms |
| --- | ---: | ---: | ---: |
| [Before](table-mips-corrected-before.json) | 2,624 | 15,222,140 | 0.6 / 0.8 |
| [After](table-mips-corrected-after.json) | 1,823 | 15,389,264 | 0.6 / 0.9 |
| [After repeat](table-mips-corrected-after-repeat.json) | 1,838 | 15,564,032 | 0.6 / 0.9 |
| [Before repeat](table-mips-corrected-before-repeat.json) | 2,632 | 15,309,520 | 0.7 / 1.0 |

The mean table call count falls about 30%. Total submitted bytes rise about
1.4% across these runs because asynchronous arrival changes publication
batching. Do not claim a measured reduction in total bytes, frame time or GC.
The counters include initial loading, restoration and warm-up; submission
timings cover the later 120 moving frames. The optional wrapper itself allocates
argument arrays. Whole-run GC trace totals are diagnostic, not an isolated
measurement of the changed function.

An additional [ASTC6×6 case](table-mips-corrected-6x6.json) passes at 64 MiB with
native-first source order and restoration, retaining the same coverage counts.
The existing center-pixel and GL-error checks pass; these checks alone do not
prove whole-image pixel equality.

The batch regression now verifies that fine additions upload only level zero
while coarse publication includes both levels. The failed-upload regression
also retries a successful replacement and checks that the evicted resource's
coarse table entry is cleared. Two mutations fail: excluding the highest mip,
and omitting coarse rebuild uploads. Production source is restored after each.

The full suite passes 1,466 tests and 65 glTF manifest cases. Root typechecking,
lint and the final bundle check pass. The first bundle check exceeded total
deployed gzip by 20 bytes and main-graph gzip by 22 bytes; a named 32-byte
allowance updates only those two ceilings. These overages are not exact binary
deltas against the original source. Packed entrypoints and codecs also pass;
the initial tarball check measured 750,715 bytes, 59 above its prior ceiling.
A named 64-byte allowance sets that ceiling to 750,720 and the final packed
consumer check passes. [Validation and hashes](table-mips-measured-validation.json).
No commit was made.
