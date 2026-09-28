# Nova zoom retention and CPU page reuse

Nova discarded nearly all VT owners when zooming into the board. The hardware
baseline went from 323 registered textures / 207 resident pages to one texture /
17 pages, despite using only about 15 MiB of a 256 MiB GPU budget. Returning to the
wide view regenerated 147 pages; the next round trip regenerated another 145.

## Behavior retained in this change

- Visibility gates new preparation, rather than destroying existing VT ownership.
  Offscreen pages and ordinary texture fallbacks remain available until space is
  needed or their scene/source ownership ends.
- Visible VT demand receives pool capacity first. Reusable pages can grow into
  spare capacity; competing pool migrations retain their scratch allowance.
  Fully compressed visible textures retain the required one-cell atlas scaffold,
  without competing for the uncompressed pages' slots.
- The shared GPU budget can reclaim cold ordinary textures before denying a new
  allocation. Cold VT page tables/atlases and native-source leases also yield to
  actual GPU/CPU pressure. No persistent allocation ceiling was increased.
- Slot replacement uses empty cells first, then cold detail, preserving useful
  root coverage until that space is also needed. The retained cache includes
  higher-detail pages; it is not limited to the lowest mip.
- A 16 MiB LRU retains already-generated CPU ImageData. It does not copy pixels,
  read back the GPU, or keep extra canvas/bitmap handles alive. Foreground page
  reloads and idle ASTC compression can both reuse it. The existing source-raster
  cache remains capped at 32 MiB. CPU and GPU memory share physical RAM on mobile,
  so this is bounded reuse, not a claim that CPU storage is free.

Game schemas, sync setup, texture assets, resolution selection, filtering, and
codec settings are unchanged. The separate ZIP experiment was removed; see
[the HTTP/3 comparison](http3-archive-comparison.md).

## Hardware observations

Same 1280×800 viewport, real Intel Iris Xe through ANGLE/Vulkan. The diagnostic
sends matching wheel deltas and waits for four unchanged 0.5-second samples after
readiness, so the times below include a deliberate ~2-second stability hold.

| Zoom-out | Previous behavior | GPU + CPU retention |
| --- | ---: | ---: |
| First return | 6.470 s / 146 uploads | 3.315 s / 10 uploads |
| Second return | 6.705 s / 144 uploads | 2.561 s / 0 uploads |

Page-request counts are slightly higher than uploads because changing views can
cancel work. The first retained return needs some newly requested detail; the
second return reuses existing GPU pages. Retained GPU bytes stay well below the 268,435,456-byte ceiling. CPU page
pixels stay below 16 MiB. All settled views report complete admitted detail.

Physical iPad, before the last background-cache/pool-pressure refinements:
initial detail at 27.311 s; after the first wide return, 481 pages remained
resident. The second zoom-in and zoom-out uploaded no pages. First wide-return
work included newly requested pages and took 14.823 s; the repeated return took
3.877 s including the stability hold. Trusted touch passed. A separate forced
context-loss run restored the scene and passed trusted touch, with bounded memory.
These are device validation observations, not a controlled claim about initial
load-time improvement from retention.

The final renderer pass on iPad reaches initial detail at 28.194 s and completes
forced context recovery at 51.662 s total. Subsequent zoom stages retain 358, 479,
479, and 524 pages; the resident set grows instead of being discarded. The second
wide return takes 3.123 s including the hold and adds 45 newly resident pages.
GPU bytes after that stage are 57,604,742 (about 55 MiB), and CPU cache hits reach
54. No page errors occur and trusted touch succeeds. Desktop final-stage CPU
cache hits reach 54 with no idle ASTC source rereads in that run.

Stable desktop scene crops compare against the previous renderer with zero
pixels above 8/255 at initial readiness and on the second close view. The wide
return is not bit-identical (mean RGB difference about 0.10/255, 888 pixels above
8/255 out of 829,440), including idle compression/history differences. Screenshots
were inspected; there are no missing surfaces or intentional quality reductions.

## Review and validation

The review covers source-version/scene lifetime, context invalidation, bounded
ownership, cache eviction, late work, allocation accounting, and cross-pool
migration. New regression cases cover offscreen round trips, pressure reclamation,
CPU reuse after GPU loss, cache byte limits and LRU order, source lease pressure,
compressed-only coverage, and reuse by background compression. CPU page lookup is
O(1); cache removal visits only that owner's pages. Existing frame/job/upload and
GPU migration limits remain in force.

Final Royal suite: 1,467 tests across 168 files, plus the 64-case glTF manifest.
Typecheck, renderer lint, and renderer build pass. Probability's restored release
loader passes its four integration tests and the linked production build passes.

An earlier final verification attempt exhausted /tmp and was discarded. Obsolete
profiling browser directories were removed, and the harness now cleans up its
browser even if writing result.json fails. A separate early development smoke
logged proxy socket resets and is not counted as a clean development check.
The subsequent literal-root pnpm dev smoke completed with no page errors, failed
modules, Vite overlay, or server errors. Vite still reports dynamic-import analysis
warnings for worker runtime imports. An attempted annotation-preservation build
change did not remove those warnings or the dev helper injection, so it was
discarded. A fresh root-dev smoke after restoring the original worker build
configuration also passes (21.431 s to full detail, hardware Iris Xe, no page or
server errors). The production worker smoke on physical iPad also completed with no
page errors and successful trusted touch (30.669 s to full detail).
Quest was unavailable to ADB during this pass; no fresh Quest result is claimed.

Raw artifacts are under `/tmp/royal-nova-profiles/zoom-*`,
`/tmp/royal-nova-profiles/retention-complete-*`, and
`/tmp/royal-ipad-retention-complete.*`. Portable stage snapshots are in
`zoom-retention-summary.json`.

## Follow-up adversarial pass

No additional initial-loading quick win was established from the existing
profiles. Reviewed retention lifetime, cache keys, cancellation, source leases,
shared-budget callbacks, atlas migration, fallback priority, and CPU/GPU bounds.

Found and fixed a pressure-path regression: individually impossible geometry,
texture, or replacement allocations could evict cold ordinary textures before
being rejected. Admission now checks immutable ceilings before reclaiming cache.
Replacement admission also checks that the old and new allocations can coexist.
Four regression cases preserve cached handles, byte accounting, and denial counts;
the first three were also run against the pre-fix code and all reproduced eviction.
The follow-up inspection found no further renderer correctness issue in the
reviewed paths.

Validation for this incremental fix: 130 targeted tests covering ordinary texture
ownership, VT growth, runtime, and idle ASTC. Typecheck, lint, and renderer build
also pass. The earlier full-suite result remains recorded above; it was not rerun
for this admission-only fix.

The latest literal-root dev smoke renders Nova fully on hardware Iris Xe, with
no page errors or overlay (24.227 s to detail), but the server logs WebSocket proxy
ECONNRESET errors at browser shutdown. This is a failed dev smoke under Probability's
working agreement, despite successful rendering. An explicit Browser.close attempt
did not eliminate the resets and was discarded. This dev-worker/HMR teardown issue
remains unresolved; no clean final smoke or unconditional merge-ready claim is made.
Raw results: `/tmp/royal-nova-profiles/adversarial-retention-final-dev/result.json`,
server log `/tmp/royal-adversarial-final-dev-server.log`.

## WebSocket reset diagnosis

A follow-up isolation check reproduced the same Vite proxy ECONNRESET without
Nova or Royal worker code. On a fresh root `pnpm dev` server, the empty Play route
opened its Vite HMR WebSocket and initially closed without a reset. A second run
created eight synthetic module workers importing only `/play/@vite/client`, then
terminated them. No server error appeared during the idle interval; the proxy
reset was logged at Chromium shutdown (2026-09-28 04:25:53 UTC), five seconds after
worker termination. This establishes a development HMR/proxy teardown reproduction
independent of the renderer changes. The empty-route control used default Chromium
settings; it is a network isolation check, not a hardware performance measurement.

No application networking or worker lifecycle change is warranted by this result.
Error logging is not suppressed. The strict dev-smoke result above still includes
a server error, but the error is now diagnosed as development teardown noise;
it is not evidence of a Nova load failure or production connection instability.
Control artifacts: `/tmp/royal-ws-control.log`,
`/tmp/royal-ws-worker-control.log`, and `/tmp/royal-ws-investigation-server.log`.
