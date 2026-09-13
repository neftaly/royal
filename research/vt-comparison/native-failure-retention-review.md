# Failed native page retention measurements

Two sequential headless Intel host-GPU runs retain the same mixed scene through
six windows of 120 moving frames each (720 frames total per run). The native
pages have valid ASTC containers with incompatible linear storage. Resource
insertion order is reversed between runs. Preparation occurs once, with forced
GC before measurement and after each window; no allocation sampling or tracing
runs concurrently. The camera repeats the same path, so this measures revisiting
known demand, not accumulating previously unseen failed page keys.

| Order | Completed windows | Live JS bytes | Backing storage bytes |
| --- | ---: | ---: | ---: |
| svg-first | 0 | 2,730,164 | 672,130 |
| svg-first | 1 | 2,834,456 | 672,130 |
| svg-first | 2 | 2,844,900 | 672,130 |
| svg-first | 3 | 2,867,884 | 672,130 |
| svg-first | 4 | 2,947,336 | 672,130 |
| svg-first | 5 | 2,948,764 | 672,130 |
| svg-first | 6 | 2,950,440 | 672,130 |
| native-first | 0 | 2,734,404 | 672,130 |
| native-first | 1 | 2,837,316 | 672,130 |
| native-first | 2 | 2,848,900 | 672,130 |
| native-first | 3 | 2,871,856 | 672,130 |
| native-first | 4 | 2,945,748 | 672,130 |
| native-first | 5 | 2,947,176 | 672,130 |
| native-first | 6 | 2,948,788 | 672,130 |

Both runs retain ten failure records and ten healthy resident pages. Total page
requests remain 20 from preparation through completion, including ten failed
native reads. Pending pages and page bytes end at zero; backing storage remains
672,130 bytes in every sample. Healthy pixel and GL-error checks pass.

Live JS grows by 220,276 bytes in SVG-first and 214,384 bytes in native-first.
Growth across the last two windows is 3,104 and 3,040 bytes respectively. This
shows no repeated page transport or growing retained backing buffers in the
measured path, but does not establish zero JS retention or a long-run heap bound.
The cause of the small continuing JS growth has not been attributed. A longer
run and heap-retainer comparison would be needed before calling it warm-up or
a leak. These whole-renderer heap figures include harness/browser-visible state.

Evidence: [SVG-first](native-failure-retention-svg-first.json),
[native-first](native-failure-retention-native-first.json).
The production runtime hash matches the retained color-space fix. This pass
changes only evidence; no production changes or commits were made.

## Longer run and snapshot attribution

A [twelve-window run](native-failure-retention-long.json) extends the repeated
camera path to 1,440 frames. Live JS bytes by completed window, including the
initial sample, were:

`2727940, 2830872, 2842232, 2863916, 2939148, 2940576, 2942188, 2943552, 2938468, 2938580, 2939852, 2939852, 2939852`

The final three samples are identical at 2,939,852 bytes. Backing storage remains
constant, total page requests remain 20, failed reads remain ten, and pending
page bytes end at zero. This resolves the earlier six-window concern for the
measured repeated path; it does not prove a bound for arbitrary scene churn or
visiting new regions indefinitely.

A separate [instrumented run](native-failure-retention-snapshots.json) captures
before, after, and disposed snapshots over twelve windows. The
[summary](native-failure-heap-summary.json) finds 209,592 bytes of net shallow
snapshot growth, of which 196,160 bytes (93.6%) are V8 code and
metadata. Instruction streams, trusted byte arrays, and protected fixed arrays
are the largest increases. Snapshot self-size sums are not the same metric as
Runtime.getHeapUsage, so these values should not be subtracted across runs.

ArrayBuffer, WebGLTexture, ImageBitmap, Blob, and canvas groups have identical
counts and shallow sizes before and after while the scene is alive. The
[retainer inspection](native-failure-heap-retainers.json) finds two new plain
objects: a retained renderer binding record and an animation-callback token.
These are shortest non-weak paths, not dominator retained-size calculations.
They do not show an accumulating collection of failed pages. Disposing reduces
ArrayBuffer wrappers from 115 to 62; closed bitmap/texture wrappers may remain
referenced by fixture/module state and are not evidence of retained GPU storage.

Together, the plateau and predominance of engine code growth support warm-up
as the main explanation for this run. No production change is justified by this
evidence. Raw snapshots are retained under `/tmp/royal-vt-native-failure-retention`
with paths and SHA-256 hashes in the summary. The two existing analyzers now
accept optional output paths so this evidence does not overwrite lifecycle
reports. Node syntax checks and diff whitespace checks pass. Production hash
is unchanged and nothing was committed.
