# Device fixes after 9c339f99

Tested autonomously on the connected iPad7,6 (iPadOS 17.7.11) and Quest 2
(Oculus Browser 152, Adreno 650). Production build identity is in `source.json`:
`9c339f99bb3c-dirty-muf8dvap`. The dirty tree includes the renderer and in-page
benchmark fixes. Later edits affect only the external benchmark script,
report validation, tests, and documentation.

## Changes

- Exact virtual-texture triangle demand advances in chunks with a 4 ms CPU
  budget checked between chunks. Published demand remains intact during traversal.
  Camera movement cannot indefinitely restart and starve the current traversal.
- Capacity changes refit retained desired demand instead of rescanning geometry.
- Pending view work schedules presentation frames even while progressive resource
  publication is pending. This fixed an iPad cold-load stall reproduced during development.
- Intermediate atlas compaction schedules a follow-up frame, allowing restored detail
  after it frees memory.
- Benchmark latency uses callback-time `performance.now()` and includes synchronous
  input work. The in-page camera benchmark waits for renderer-frame progress.
- Report validation uses current VT counters, checks complete resident coverage,
  and requires XR GPU timing only when an immersive test is actually enabled.

## Physical-device results

The same 60-step Sponza camera probe measures elapsed time from before input to a
subsequent callback after renderer progress. Final runs wait for full texture
settlement both before and after each trial. Each trial passed all requested steps.

| Device | Baseline p95 | Fixed first p95 | Fixed repeat p95 | Fixed repeat max |
| --- | ---: | ---: | ---: | ---: |
| iPad | 433 ms | 57 ms | 54 ms | 65 ms |
| Quest 2 | 297 ms | 156 ms | 44 ms | 55 ms |

These are two sequential trials per device, not a statistical guarantee. The
Quest's first pass still has a longer tail (166 ms maximum). Baseline evidence is
in `../device-validation-9c339f/`; the old RAF-derived benchmark summaries are
not used for this comparison. Full per-step evidence and renderer snapshots are
in `ipad-final-{1,2}.json` and `quest-final-{1,2}.json`.

Both devices settle without user input: 561 desired/admitted pages on iPad, 488
on Quest; zero pending, unresident, or failed pages; visible detail fraction 1.
No demand traversal remains pending at settlement. GPU compaction/restoration
also passes all four source/mipmap cases on both devices, including exact byte
accounting and pixel readbacks. The supplemental compact probe is built directly
from the modified checkout; its embedded revision field identifies the base commit.

The retained `*-first.json` files record intermediate development runs and are
not final acceptance evidence. `quest-final.png` is a direct canvas capture.
Tests cover browser rendering; immersive headset behavior was not measured.

## Automated checks

- 1,318 tests pass across 156 files, plus the glTF manifest check.
- Typecheck, lint, production examples build, and bundle-size check pass.
- Regression coverage includes incremental/exact demand equivalence, immutable
  captured views, continued progress during camera motion, progressive-publication
  scheduling, post-compaction liveness, benchmark elapsed time, and report validation.

Saved runners use the same setup as the baseline README: production preview on
5193, Quest CDP on 9222 and ADB reverse, and USB Safari automation for iPad. Run
`run-quest-final.mjs` or `run-ipad-final.py` for camera checks. The compact probe
build instructions are in the baseline README; the local compact runners write
this directory's results. No user interaction was required.
