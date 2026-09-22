# Workerpool migration and tuning

Branch `workerpool` is one commit above `e55f6d80`, prepared in
`/tmp/royal-workerpool` for eventual landing on main. Main and its working tree
were not edited. The original uncommitted texture-inspection snapshot was not
copied; the subsequent committed inspection work is now the branch's base.

## Runtime coverage

| Work | Ownership and policy |
| --- | --- |
| Static glTF preparation | Lazy root-owned pool bounded by `workerLimit`; tiny self-contained GLBs stay local; five-second idle retirement |
| Draco decoding | At most two reusable workers per preparation worker; dedicated lightweight entrypoint; largest-first byte balancing |
| Idle ASTC | One worker per encoder, reused across pages; exactly one six-pixel block row per granted RPC |
| Texture inspection | Main's bounded workerpool and recovery policy, using the shared worker runtime |

All production worker creation, task RPC, result/error routing, and termination
use workerpool. A transferred `MessagePort` handles glTF resource-reader
callbacks while preparation occupies its worker. Both ends close on completion,
failure, cancellation, and disposal. Root admission scheduling and GPU residency
remain workload policy. Archived research experiments are not production paths.

Draco starts parallel decoding at 512 KiB compressed input for a cold pool and
64 KiB for a retained pool, with at least two tasks and half that threshold in
each balanced bucket. Smaller or heavily imbalanced batches decode serially in
the preparation worker. Source slices are copied before transfer. Failed batches
retire their pool; parent cancellation/disposal also retires nested workers.
These thresholds are conservative heuristics from the measurements below.

A shared worker-only runtime avoids repeatedly embedding workerpool's host pool
and default worker in every worker bundle. Its consumer-resolved URL is passed
through worker startup and inherited by nested workers. Packed-consumer checks
verify that runtime and the dedicated Draco entrypoint are shipped.

Removed manual worker slots, request/result unions, ASTC job IDs and cancellation
messages, worker factories, and the unused one-shot preparation wrapper.
Changed production files total 596 lines versus 777 on the new main base
(181 fewer lines); benchmark reports and regression tests are counted separately.

## Dependency fixes

Workerpool is pinned to 10.0.3. The pnpm patch retains main's fixes for failed
sends, message deserialization failures, error-settlement ordering, and replacing
failed idle workers. It additionally settles and removes a queued task when
worker construction throws, preventing a ghost request on the next asset.
Both source and browser distribution are patched. Royal bundles these fixes so
consumers do not need to install the pnpm patch. Reassess it on dependency updates.

## Review and verification

Repeated adversarial passes covered transport settlement, startup failure,
resource ownership, active cancellation, disposal, queue recovery, worker reuse,
imbalanced Draco batches, runtime URL propagation, declarations, and packaging.
Findings were fixed and reviewed again. The final pass found no further issues
within that scope.

Validation on the rebased branch:

- 157 test files, 1,345 tests, plus the glTF lab manifest check.
- Typecheck, lint, and all package/application builds.
- Packed-consumer and standalone-codec smoke, package imports, bundle budgets.
- Real Chromium and WebKit workers: bounded bursts, resource reads, transferred
  buffers, cancellation/recovery, ASTC WASM and row grants, Draco WASM, retained
  pools, inspection reduction, and cleanup.
- Chromium additionally checks nested worker identities and teardown through CDP;
  WebKit has no equivalent nested-target instrumentation in this harness.

## Measurements

The side-by-side baseline is the original migration (`59e85b47`), before tuning.
Both variants decode the same Duck fixture in the same browser run. Cold medians
use three fresh roots; warm medians use nine repeated loads.

| Browser / Draco primitives | Cold before → after | Warm before → after |
| --- | --- | --- |
| Chromium / 2 | 80.9 → 64.8 ms | 53.8 → 10.3 ms |
| Chromium / 52 | 161.6 → 152.5 ms | 124.4 → 58.8 ms |
| WebKit / 2 | 62 → 57 ms | 39 → 12 ms |
| WebKit / 52 | 161 → 164 ms | 130 → 70 ms |

Increasing idle retirement from one to five seconds reduced three spaced loads
from three workers to one. Subsequent loads took 1–2 ms instead of 18–26 ms in
these runs. The tradeoff is retaining idle worker/codec memory four seconds
longer. Explicit disposal still terminates promptly.

Chromium's 1 MiB workerpool transfer roundtrip measured approximately 0.1 ms,
versus 1.4 ms when cloning input. Values near zero are timer-resolution limited,
not evidence of zero overhead. These are machine-local workload measurements,
not renderer FPS or cross-device guarantees. WebKit's large cold case slightly
regressed; the repeat-load benefit is more consistent than cold-load timing.

The shared bootstrap reduced duplicated runtime bytes. Final deployed JS is
approximately 393.3 kB gzip, including 125.3 kB worker assets; initial JS is
145.7 kB. Relative to main's existing budgets, this branch allows an additional
4 KiB lazy/total JS and 64 bytes initial JS; no additional worker or packed-package
allowance is needed.

Detailed results: [Chromium](browser-results.json),
[WebKit](browser-results-webkit.json), and the
[original migration run](browser-before-tuning.json).

## Reproduction

After installing dependencies and building, install Playwright in a separate
tooling directory if needed, then run:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROMIUM_PATH=/usr/bin/chromium-browser \
node scripts/workerpool-browser-check.mjs

BROWSER_ENGINE=webkit \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
node scripts/workerpool-browser-check.mjs
```

For before/after comparison, also set `WORKERPOOL_BASELINE_DIST` to the built
`packages/renderer-webgl/dist` directory from `59e85b47`. Without that optional
baseline the remaining lifecycle, correctness, and tuning checks still run.
The script serves this checkout (and optional baseline) on an ephemeral loopback
port, launches an isolated browser, writes JSON, and closes browser and server.
