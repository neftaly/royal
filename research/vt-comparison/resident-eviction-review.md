# Capped native eviction: retention and allocation review

Repeated capped ASTC replacement preserves the neighboring texture and does not
show accumulating decoded payload storage in these host-GPU runs. The longer
padded run reaches a narrow live-heap range after warm-up. No production change
was needed; this is evidence about the retained residency fix, not a new speed
optimization or a proof for arbitrary future workloads.

## Fixture and scope

The [fixture](resident-eviction.ts) keeps one scene and moves the limited texture
through its existing imperative transform handle. It switches between two
constant-color ASTC pages while a neighboring texture keeps two differently
colored pages in the same atlas. The limited texture must remain at one resident
page and the neighbor at two. Every replacement waits for upload completion,
zero pending bytes and zero unresident/failed pages. Finish checks the colors and
GL error state; cleanup verifies zero retained root GPU budget.

Each run warms up with 32 evictions, then performs 32 per window by default or
128 with `long`. Four fixture page buffers remain deliberately held. A fixed
32-entry WeakRef ring tracks only the latest response arrayBuffers, without
holding them strongly or accumulating a per-read history. It is inspected only
after runner-forced GC. The fetch wrapper, WeakRefs, promises, rAF and snapshot
checks add harness allocations. This does not measure production-only allocation
or remote-network latency.

## Six-window runs

Each run performs 192 measured evictions, 32 warm-up evictions and three initial
page reads: 227 page reads/uploads total. The neighbor is read only twice. All
four runs finish with zero live bodies in the tracked ring and the expected
three resident pages. Backing storage is constant across every forced-GC sample.

| Run | Initial live JS bytes | Final live JS bytes | Constant backing bytes |
| --- | ---: | ---: | ---: |
| [ASTC 6×6](resident-eviction-6x6.json) | 2,148,664 | 2,429,168 | 483,603 |
| [ASTC 8×8](resident-eviction-8x8.json) | 2,159,964 | 2,435,876 | 478,787 |
| [ASTC 6×6 padded](resident-eviction-6x6-padded.json) | 2,147,788 | 2,423,688 | 4,677,907 |
| [ASTC 8×8 padded](resident-eviction-8x8-padded.json) | 2,160,032 | 2,437,176 | 4,673,091 |

Padded pages include 1 MiB of valid trailing container data. The 4 MiB backing
increase comes from the four held fixture buffers, not accumulated response
bodies. This check does not bound peak transport allocation or show that the
compaction copy is necessary once a page has already been uploaded and released.

## Longer runs and heap attribution

The [384-eviction 6×6 run](resident-eviction-6x6-long.json) and
[384-eviction padded 8×8 snapshot run](resident-eviction-8x8-snapshots.json)
still show JavaScript heap growth. Snapshot analysis attributes 434,100 of the
462,940 added shallow/self bytes (93.8%) to V8 code nodes. ArrayBuffer, WebGLTexture
and canvas group counts are unchanged; no ordinary object group has a count or
size delta. Most remaining positive growth is internal native metadata.
[Heap summary with raw snapshot paths and hashes](resident-eviction-heap-summary.json).
These are shallow-size groups, not dominator retained-size estimates.

A further [1,536-eviction padded 8×8 run](resident-eviction-8x8-1536.json) performs
1,571 page reads/uploads including warm-up and initial coverage. The final six
forced-GC heap samples remain within 2,968 bytes; the final live heap is 2,724,936
bytes. Backing storage is constant at 4,673,152 bytes, all 32 tracked response
bodies are gone, the neighbor still has only two reads, and the final scene has
three resident pages. This supports warm-up followed by bounded retention on
this repeated two-region path. It does not establish a bound for visiting
unlimited distinct regions or assets, or for other browsers/devices.

Disposal reduces ArrayBuffer wrapper count from 69 to 38 and returns retained
root GPU budget to zero in the snapshot run. Fixture buffers and some browser
wrappers remain reachable from the module and runner; wrapper counts alone are
not evidence of retained GPU memory.

## Validation

A separate [128-replacement allocation profile](resident-eviction-8x8-profile.json)
uses normal ASTC 8×8 pages with no forced GC inside the measurement window. It
records six GC events totaling 5.630 ms and 4,098,080 sampled allocation bytes.
The largest attributed sites are matrix construction, visibility processing,
texture keys and runtime updates. The sample includes fixture validation and
snapshot calls, so these totals must not be attributed exclusively to page
decoding or interpreted as production frame costs. The run finishes with no
tracked response bodies alive. [Allocation summary](resident-eviction-allocation-summary.json).

The [diagnostic-overhead follow-up](eviction-diagnostics-review.md) compares full
snapshot polling with an optional physical-upload-count wait. It measures lower
allocation samples with equivalent final state, demonstrating that part of this
profile's allocation is fixture overhead rather than page-processing work.

All GPU runs use headless Chromium on the Intel host. Research typechecking and
the browser build pass; production source remains unchanged. Initial 32-per-window
source hashes are recorded [here](resident-eviction-initial-sources.json). Later
`long` runs add a reporting/configuration field without changing the default
window length. No commits were made.
[Validation record](resident-eviction-validation.json) covers eight GPU runs and
3,200 measured evictions, with unchanged production source hashes.
