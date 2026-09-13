# Steady benchmark diagnostic redraw

Date: 2026-09-13. Research harness correction; no renderer changes or commits.

A fresh allocation audit exposed a broken visual oracle. The steady fixture
read the default WebGL drawing buffer in its finish hook, after profiling stopped
and forced GC completed. The browser had discarded that buffer. All three initial
captures were black, despite resident VT pages and successful rendering updates.

The finish hook now invalidates and flushes once before reading pixels and taking
its screenshot. This runs after CPU/heap sampling, tracing and final heap usage
measurement. It does not add work to the measured 600 frames or enable persistent
drawing buffers. A white-center assertion now rejects a discarded/blank capture
for these fixed fixtures instead of silently saving it.

## Evidence and correction

Initial captures are retained in `current-{svg,raster,astc}-profile.json` and their
image directories. After redraw, SVG and PNG centers are `[255,255,255,255]` and
authored ASTC is `[254,254,254,255]`. The SVG screenshot visibly contains the colored
pattern and text. All three runs retain exactly the same before/final VT snapshot:
21 resident pages, no pending/unresident/failed pages and no additional page reads.

Earlier steady-fixture screenshot equality claims cannot establish visual
equivalence. Corrections were added to the pool-budget, stable-atlas, membership/key
and steady-profile reports. Their timing/allocation measurements and VT state
counters are separate evidence; these are not retracted. The source-combination
fixture flushes immediately before readback and is unaffected by this defect.

## Current allocation evidence

Headless Intel Iris Xe / ANGLE Vulkan, 600 warmed moving-camera frames:

| Fixture | Sampled allocation | VT update attribution | Submission median / p95 |
|---|---:|---:|---:|
| SVG | 3,870,312 B | 655,820 B | 0.3 / 0.5 ms |
| PNG | 3,935,632 B | 918,272 B | 0.2 / 0.4 ms |
| Authored ASTC 8x8 | 3,869,944 B | 983,716 B | 0.2 / 0.4 ms |

Each run recorded five GC events. These are sampled attribution estimates and
instrumented CPU submission times, not GPU times or a format speed ranking.
VT update bookkeeping remains a useful next target across all three formats.
The current code constructs pool requests and computes sharing each frame, even
when no page work is pending. Any simplification still needs a matched benchmark;
this pass does not change production allocation behavior.

Review checked runner hook ordering and that the redraw remains after final heap
measurement. A second pass checked actual screenshot content and exact VT state,
then added the white-center assertion. Research TypeScript, Vite build and
whitespace checks pass. Separate short runs validate the final assertion for all
three fixtures. The raw profiles precede only that added assertion; it executes
after profiling and changes no measured code.

Evidence: [allocation summary](diagnostic-redraw-allocation-summary.json),
[SVG](diagnostic-redraw-svg.json), [PNG](diagnostic-redraw-raster.json),
[ASTC](diagnostic-redraw-astc.json), [source hashes](diagnostic-redraw-sources.json).
Final assertion checks: [SVG](diagnostic-redraw-check-svg.json),
[PNG](diagnostic-redraw-check-raster.json), [ASTC](diagnostic-redraw-check-astc.json).
