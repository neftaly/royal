# Current VT worktree guide

This is a navigation guide to retained work and its evidence. Historical reports
keep their original baselines and limitations; their later follow-ups can
supersede early findings. The [final pre-commit review](precommit-review.md)
records the latest validation and the scene-replacement race fixed afterward.

## Proposal and source behavior

The user-owned proposal remains local and unchanged. Its requested
source-combination and explicit raster-preview behavior is documented below:

| Requirement | Current behavior and evidence |
| --- | --- |
| Optional ASTC with required SVG/WebP/AVIF without an extra core PNG | Source selection validates the required authority and preserves the native alternative. [glTF ASTC tests](../../tests/replacement/renderer-webgl-gltf-astc.test.ts), [44-case GPU source matrix](native-page-compaction-source-regression.json). |
| Preserve full SVG authority | Native preview can present first; SVG remains available for fallback and VT detail. Required SVG validation is preserved. [Texture specification](../../docs/specs/textures-and-virtual-texturing.md). |
| Explicit low-resolution ASTC role for raster sources | `textures[].extras.royal.astcPreview` supplies full-source dimensions. Ordinary ASTC alternatives remain final alternatives. [Metadata specification](../../docs/specs/raster-texture-previews.md), [raster-preview tests](../../tests/replacement/renderer-webgl-raster-preview.test.ts). |
| No invented SVG layer for raster input | Raster authority uses the explicit raster-preview path; the marker cannot accompany GS_texture_svg. |
| Unsupported ASTC | Portable source fallback remains capability-aware; unsupported authored native VT settles without downloading pages or allocating an atlas. [Runtime tests](../../tests/replacement/renderer-webgl-vt-runtime.test.ts). |

The raster preview marker is private Royal metadata, **not a registered glTF
standard**. Other consumers may retain ASTC as the final texture. Native page
formats are authored offline; no runtime encoding or transcoding was added.

## Latest retained runtime fixes

- [Three adversarial-review fixes](three-review-fixes.md): intrusive cancellation
  removes interior entries in constant time; ordinary texture fitting recovers
  budget after unsupported authored VT; coarse intermediate atlases resolve the
  reproduced migration stall. The delayed ASTC 6×6/8×8 cases reach all 336 pages
  before and after restoration. A 12,000-cancellation stalled-queue run retains
  about 729 KB of live JS heap, with less than 600 bytes of variation in its final
  six samples. This measures retained memory, not allocation churn.

- [Cancelled image-page decode](image-page-cancellation-review.md): close a
  bitmap that finishes after cancellation before starting any resize decode.
  Three cancellation cases avoid that obsolete work; three normal-path controls
  preserve resizing. Four production lines, with no frame-time or GC claim.

- [Independent manifest transport](manifest-transport-lane-review.md): an
  eight-job queue prevents slow manifests from occupying page-preparation slots.
  The gated native-source GPU reproduction now reaches full coverage and
  restores it; concurrency, progress and cancellation have regression coverage.
  Full-queue disposal also ignores late successful responses from transports
  that ignore abort; removing the guard produces eight obsolete notifications.
  Four failure-stage regressions verify prompt queue refill, stable failed
  versions and recovery on version change.
  A [scene-replacement regression](manifest-replacement-review.md) confirms
  ignored-abort transports retain the eight-job bound until settlement, skip
  obsolete queued scenes and cannot publish stale responses. Unsettled custom
  transports can still delay later manifest work.
  The [delayed-source GPU matrix](manifest-lane-gpu-matrix.json) passes both ASTC
  sizes and both held source classes; one case starts with coarsened coverage,
  so allocation-order effects on detail remain.

- [Changed table mip uploads](table-mips-measured-review.md): two additional
  runtime lines skip unchanged coarser levels during incremental publication.
  Corrected-baseline GPU runs show about 30% fewer table GL calls, with no proven
  total-byte, frame-time or GC improvement. Eviction rebuilds still publish all
  levels and two deliberately broken bounds/rebuild variants fail regression.
  [Direct coarse GPU readback](table-mips-coarse-review.md) also catches stale
  mappings that color-only rendering checks missed in a broken control.

- [Flat authored keys](flat-asset-key-review.md): remove nested temporary arrays
  and sampler re-serialization while preserving tested identity classes. Three
  fewer production lines; about 37% lower isolated key CPU time, with no claimed
  end-to-end browser speedup. A [GPU identity follow-up](native-identity-gpu.json)
  checks alias sharing, typed identities, removal/re-add and restoration in both
  ASTC sizes and scene orders; an isolated version-merging control fails.
- [Authored residency ceilings](resident-limit-review.md): enforce byte/slot
  limits across view changes by replacing the texture's own unprotected pages.
  Existing atlas space can no longer let its cached residency exceed the limit.
  Eight host-GPU cases verify colored page replacement, neighbor preservation
  and context restoration; the control build reproduces the old overflow.
- [Empty failed atlas release](empty-failed-atlas-review.md): suppress entirely
  failed empty demand and release unused GPU storage while preserving neighbors,
  failure records, new-view recovery and version retries.
- [Native color-space failure containment](native-color-failure-review.md): reject
  incompatible native page storage during read completion instead of throwing
  during upload and repeatedly reading it.
- [Exact native page storage](native-page-compaction-review.md): copy only block
  bytes into queued page storage, freeing large container backing buffers. This
  adds read work and does not bound peak response-body allocation.

## Measurement interpretation

A [fresh mixed-source allocation profile and pool-request experiment](pool-request-loop-review.md)
finds demand-key Set additions dominant. Replacing `filter/map` request construction
with one loop passes correctness checks but shows no repeatable allocation or GC
benefit over four profiles. The candidate is archived and production restored.

The [failed ancestor review](failed-ancestor-review.md) verifies image and both
ASTC child pages can load after a coarse-page 404, without retries over 100 zoom
changes. The failed parent remains correctly counted as unresident. This is a
scheduling check, not proof of visual behavior when a coarse mip is missing.

A [wrapped-demand regression](periodic-demand-review.md) checks 192 whole-period
translations across independent repeat/mirror axes and signed scales. Demand
sets stay unchanged; a negative mirror-parity control fails. No production
change or timing claim follows from this check.

The [blocked growth cache review](blocked-growth-cache-review.md) verifies that
100 unchanged budget-blocked updates add no storage planning, texture allocations
or fetches, while a released claim permits full growth. Disabling the cache and
making it permanent each fail the regression. This is operation-count evidence,
not a timing or GC improvement; no production change was needed.

The [page-table mip experiment](table-mips-review.md) was initially set aside after
its baseline mixed-source GPU workload failed to settle; its corrected-baseline
follow-up is now retained. [Expanded diagnostics](mixed-stall-review.md) showed ordinary SVG
storage and the native atlas exhausting the global budget before automatic VT
promotion. The retained [up-front reservation](planned-reserve-review.md) resolves
the sixteen-source case at 64/128 MiB, including restoration, by reserving the
referenced VT allowance before ordinary fitting. The [review fixes](three-review-fixes.md)
release that allowance for unsupported sources and restore fitted raster detail. The [eight-case GPU matrix](planned-reserve-matrix.json)
now passes both ASTC sizes, both source orders and both budgets, including
context restoration.

The [page-table cycle review](page-table-cycles-review.md) adds 1,920 seeded
transitions checked against an independent nearest-ancestor oracle, including
eviction holes and empty-table reuse. Two stale-mapping mutations fail; the
retained implementation passes without a production change.

The [scheduler no-slot scan review](no-slot-scan-review.md) retains no shortcut:
all 37 unsuccessful slot searches observed across 183 runtime tests had only one
demanded page, so an early return would skip no work. Instrumented and restored
tests pass; these counters are not application performance measurements.

[Read-path measurements](native-page-read-review.md) separate isolated parsing,
fresh in-memory Response handling, sequential localhost HTTP and grouped HTTP
reads. None measures remote-network or GPU-upload latency. The runtime refills
available jobs rather than waiting for a whole group; regressions cover success
and failure refill. [Copy-expression trials](native-copy-review.md) and the
[early empty-demand skip](zero-demand-review.md) were not retained.

[Failed-page heap measurements](native-failure-retention-review.md) reach a plateau
over the repeated camera path; snapshot growth is mainly engine code/metadata.
This does not establish a bound for arbitrary scene churn or visiting unlimited
new regions. [Padded page checks](native-page-compaction-review.md) include real
ASTC 6x6/8x8 rendering and context restoration with matching control images.

All GPU evidence here uses a **headless Intel host GPU**. Do not extend those
results to an untested physical iPad or Quest, or treat software-rendered results
as equivalent. Read each report's scope before reusing its timing numbers.

[Capped eviction retention](resident-eviction-review.md) exercises actual page
replacement with normal and padded ASTC pages. A 1,536-replacement run stabilizes
within a narrow live-heap range while backing storage remains constant; separate
snapshots attribute earlier growth primarily to V8 code. This covers a repeated
two-region path, not unlimited distinct regions or assets.
[Diagnostic overhead profiles](eviction-diagnostics-review.md) show why those
allocation totals are not production-only: removing measured-window snapshot
polling lowers sampled allocation with identical uploads, frame counts and final
state. The optional light mode keeps full warm-up and final correctness checks.

## Remaining limitations and scope decisions

- [Delayed source admission](source-arrival-gate-review.md) exposed native
  manifest transport occupying all root preparation slots while SVG page work
  waited; the independent manifest queue resolves that reproduction. Arrival timing can
  also change budget-driven detail; the reservation matrix is not a guarantee
  of identical detail under arbitrary completion order.
  [Staggered growth traces](staggered-growth-review.md) confirm a migration
  headroom limit: free memory fits only 126 replacement slots while the current
  atlas already has 135. The [coarse intermediate migration](three-review-fixes.md)
  now resolves that reproduction. It requires resident coarse roots and enough
  space for both migration stages; arbitrary impossible budgets remain bounded.
  A [coarsening oracle](coarsening-oracle-review.md) verifies the finest feasible
  complete-level choice in 256 scenarios. Partial refinement is a distinct
  quality policy, not an equivalent fix for unused capacity.

- Native atlas pools remain fixed after allocation. Reservation planning does
  not guarantee space for a new source class introduced later.
  [Demand-sized native allocation](native-demand-sized-review.md) was rejected:
  without native growth, it blocks later compatible textures from becoming resident.
- CPU demand remains conservative about occlusion. GPU feedback, anisotropy,
  prediction/prefetch, material stacks and packed/range transport remain deferred
  decisions in [the research comparison](README.md#decisions-on-the-other-researched-approaches).
- [Conflicting native color claims](native-color-sharing-review.md) document an
  invalid-binding order limitation; that broader source-owner redesign is deferred.
- Compaction fixes queued native backing storage, not transport's peak memory.

The continuing improvement goal remains active. These limitations are not claims
that the optional techniques were implemented, nor reasons to revisit rejected
micro-optimizations without new workload evidence.

## Recorded integration check

The [flat-key validation record](flat-asset-key-validation.json) captures 1,463
passing tests, 65 glTF manifest cases, typechecking, lint, package and bundle
checks, an identity oracle, mutation failures and eight ASTC GPU regression cases.

The [deferral integration record](capped-deferral-validation.json) captures 1,462
passing tests across 149 files, 65 glTF manifest cases, root typechecking and lint.
It includes later native admission, failed replacement upload and budget deferral
regressions. Production source hashes remain unchanged from the residency fix.

The [residency-ceiling validation record](resident-limit-validation.json) captures
1,438 passing tests across 149 files, 65 glTF manifest cases, both typechecks,
lint, packed-package and bundle checks, plus twelve failing mutation cases and
restored source hashes. [The review](resident-limit-review.md) records the measured
size allowances and performance/GC scope.

The [current-state validation record](current-state-validation.json) captures
1,417 passing tests across 149 files, 65 glTF manifest cases, lint success, and
source/log hashes. This is a recorded checkpoint; subsequent edits must be
validated on their own merits. The guide's local file links were checked.
