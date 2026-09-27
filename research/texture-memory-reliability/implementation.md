# Bounded texture working sets

Implemented on `main`, after `41bffaea`; intentionally uncommitted. The original
`texture-memory-proposal.md` is unchanged. See [adversarial-review.md](./adversarial-review.md)
for the correctness, complexity, functional-core, React DX and obsolete-path passes.

## Placement and allocation policy

GPU memory holds demanded VT pages and page tables, small safety fallbacks, and
ordinary storage for non-pageable uses. Reloadable base-color images outside all
active views release ordinary GPU storage, VT registration and demand workspaces.
Native compressed textures and shared non-base maps preserve ordinary ownership.

Ordinary storage, RGBA atlases and optional idle ASTC pages share one texture
envelope under the persistent GPU ceiling (256 MiB by default). Planned geometry,
lights, composite/volume targets, edge targets and retained presentation reduce
that envelope. The old root-wide 75% VT ceiling no longer governs scene allocation.
Demand-sized migration headroom is capped at one eighth of the remaining texture
allowance. Both old and new allocations are charged during replacement. Shrinking
can use physically free headroom when the steady-state allowance has fallen.
Safety fallbacks are at most 64 pixels per edge and collectively fit within an
eighth of steady texture capacity, subject to minimum texture size. Remaining
capacity is available for ordinary requirements and VT demand; it is not filled
merely to increase utilization.

CPU pixels live in a root-local 32 MiB LRU, including a reservation of up to
16 MiB for the single in-flight paging decode. Mip demand controls requested
decode size; coarse sources upgrade when finer pages need them. Four initial
ordinary preparations can run concurrently. Their CPU seed fits a 256px-square
mip-chain budget, avoiding an immediate second source read for adjacent detail. Initial pixels seed the cache through
evictable leases, and cache-ready coarse/detail pages receive scheduling priority.
The existing encoded-byte, decoded handoff, async-job and upload budgets remain
separate. GPU pages survive CPU eviction; reloading uses the configured source
reader and inspection policy without application caching or authored previews.

## Reliability and performance changes

- Transactional target/texture replacement retains the previous allocation when
  admission fails. Optional edge effects degrade instead of failing the frame.
- Closed-source tracking prevents late fallback resizing from uploading detached
  pixels. Source reacquisition, cache eviction and context restoration preserve
  ownership and bounded handoff accounting.
- Whole-slot admission avoids overcommitting atlases when images outnumber slots.
  Images without an admitted VT slot retain ordinary coverage. Returning to a view
  clears stale zero-slot limits and resumes paging.
- Pure visibility and authored-scene plans separate policy from browser owners.
  Texture completion no longer rescans all identities or restarts settled demand.
  Existing indexes replace per-completion linear catalogue searches. Context
  restoration prepares active images and batches aggregate notifications.
- React keeps focused asset hooks. glTF progress distinguishes deferred images;
  decode readiness does not imply GPU residency. Root presentation diagnostics
  distinguish preparation, refinement, ready, degraded and failed states. Capture
  waits for the active texture working set.
- Cache diagnostics expose queue, decode and page-render duration. Build handling
  removes an unavailable source-map reference embedded in a dependency worker.

## Verification

The final production changes pass 1,431 tests across 165 files, the 64-case glTF
manifest check, TypeScript, lint, the package build, package-import checks and the
packed consumer/standalone-codec smoke tests. Browser regression checks cover
texture transitions, glTF scenes, React lifecycle and WebXR ownership emulation.
These are local repeated adversarial passes, not independent reviewer sign-off.

`desktop-working-set.json` records the hardware Chromium pressure fixture. Every
case reached ready, including distant/return/rapid camera changes, resizing and
context restoration at both 64 MiB and 32 MiB GPU ceilings. The catalogue grows
from 324 to 3,240 distinct images while 324 remain visible. At 64 MiB, steady
renderer-accounted GPU claims are about 40.6 MiB for both catalogue sizes. At
32 MiB, observed settled claims span 20.6–24.5 MiB; some images use ordinary
fallback coverage instead of a VT slot. Resident ordinary texture count stays
324, and recorded CPU cache peak including reservations stays at or below 32 MiB.

`ipad-working-set.json` records physical Safari on **iPad7,6, iPadOS 17.7.11**,
The 3,240-image fixture reaches ready through camera changes and
context restoration, with approximately 40.6 MiB of retained GPU claims under
the 64 MiB ceiling and a 32 MiB CPU cache peak. A later explicitly authorized physical Quest 2 run passes the same workload at
32/64 MiB, including newly presented camera transitions and context restoration
(`quest-working-set.json`). No device boundary or safety setting was disabled.

`page-perf.json` records the final page-generation benchmark after the other
heavy browser checks finished. Four-page batch median/p95 are 0.9/1.2 ms; page-table
median/p95 are 1.0/1.6 ms, within the existing gates. The linear lookup invariant
passes: 21,845 logical pages × 128 motions = 2,796,160 lookups. Two earlier runs
overlapping other work exceeded timing gates, so these are host-sensitive checks,
not mobile performance claims.

The synthetic fixture uses distinct small encoded SVGs and shared geometry.
It demonstrates bounded decoded/GPU residency for tenfold artwork identities,
not tenfold encoded-photo bytes, geometry or total browser-process RAM. Timings
were gathered under variable host load and are not controlled regression ratios.

## Reproduction

Build packages with `pnpm build`, then build the fixture:

```sh
node --input-type=module -e 'import {build} from "vite"; await build({configFile:false,base:"./",build:{outDir:"/tmp/royal-working-set-build",emptyOutDir:true,rollupOptions:{input:"scripts/texture-working-set.html"}}});'
python3 -m http.server 5195 --directory /tmp/royal-working-set-build
node research/texture-memory-reliability/check-working-set.mjs
```

The desktop runner needs hardware Chromium and free debugging port 9228.
`check-ipad.py` uses pymobiledevice3 WebInspector with a paired iPad and an
accessible fixture host; set `ROYAL_MEMORY_FIXTURE_URL` to the fixture URL for the local machine.

## Limits

These counters estimate renderer-controlled storage, not driver/browser physical
allocation. Mobile CPU/GPU allocations share physical RAM. Metadata, geometry,
non-pageable maps and encoded assets can still grow with the document. A huge
individual raster is fitted to the per-decode limit; lossless arbitrary-resolution
region decoding needs a separate adapter. This work removes the known texture
residency blockers but does not guarantee every tenfold scene fits or establish
a small frame-time regression on the available iPad / Quest 2.

`game-before.json` is the original pressure observation (still loading, backing
1905×2001): 249,681,748 ordinary GPU bytes, ten VT resources and 3,926 denied claims.
`game-after.json` is an **intermediate** implementation observation at backing
1024×716. Neither forms a controlled before/after timing comparison.

## Final game result

`game-final.json` is the hardware Chromium check before the additional Nova
profiling pass described in `../texture-loading-performance/report.md`. That
later report supersedes the loading and residency figures below. This check used Probability's
literal root `pnpm dev`, with `ROYAL_DEV_PATH` pointing at this checkout. The
provided synchronized game was read only; the existing port-3000 server was not
changed. At 1024×716 backing size, the game reaches `presentation: ready`, with
325 ordinary representations, 323 VT resources, all 628 demanded pages resident,
full estimated visible detail, zero denied claims and zero failed pages. Browser
page/console/module checks found no errors or Vite overlay. Vite logged dynamic
import-analysis warnings for intentional runtime-selected codec/worker modules.
The final hardware run had no development-server errors; an earlier software
browser teardown logged a WebSocket ECONNRESET before that run started.

| Renderer-accounted storage | Bytes | Approximate MiB |
| --- | ---: | ---: |
| Ordinary GPU textures | 8,311,876 | 7.9 |
| VT GPU storage including page tables | 71,479,036 | 68.2 |
| Total retained GPU claims | 79,826,438 | 76.1 |
| CPU raster cache | 33,514,716 | 32.0 |

VT accounts for about 89.5% of retained GPU claims. Foreground page generation
records 623 cache hits and five additional source reads. Enlarging only the
initial CPU seed from a 128px-square to a 256px-square storage budget avoided
immediate repeat reads for adjacent detail; GPU fallback size and CPU cache
ceiling did not increase. The game settled in about 94 seconds on this loaded
host. This is not a controlled comparison against the old renderer or a mobile
frame-time result. Optional idle ASTC work may continue after readiness.

To repeat the read-only game check, start the linked Probability root development
server, then run `node research/texture-memory-reliability/check-game.mjs`.
`ROYAL_GAME_URL` overrides its default port-3003 URL; debugging port 19385 must be
free.

## Additional physical-device checks

The working-set runner now requires a new renderer frame after camera changes or
resizing, preventing a previous frame’s ready snapshot from passing the test.
The full corrected sequence passes on physical Quest 2.

`quest-game.json` records the synchronized game ready on physical Quest 2 in
approximately 70 seconds: all 420 demanded pages resident, zero denied GPU claims
or failed pages, 44,084,562 retained GPU bytes, and a CPU cache peak below 32 MiB.
The browser viewport differs from desktop, so the page count and timing are not
direct performance comparisons.

The iPad7,6 passes the renderer fixture again. The full Probability game over the
LAN development URL fails before renderer creation with
`schema_tools.artifact_build_invalid` in game-schema artifact initialization
(`ipad-game.json`). This run used an insecure HTTP LAN origin; it does not
establish a renderer or general Safari compatibility failure.

`quest-xr.json` also records a real immersive WebXR enter/render/exit pass, with
more than 20 newly rendered immersive frames, zero page exceptions and zero
persistent GPU denials. The browser's localhost immersive permission was accepted
through its normal Allow control; no Guardian or tracking safeguard was disabled.
This is an immersive smoke test, not a sustained frame-time or thermal benchmark.
