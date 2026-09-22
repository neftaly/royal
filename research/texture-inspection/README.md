# Texture inspection throughput, 2026-09-23

The Probability handoff identified a serialized classifier lane, scans of pending
cache entries on settlement, synchronous full-image reduction, and repeated
classification of equal samples under different asset IDs. These are addressed
in the current Royal source. Probability opts into concurrency 2 and uses its
existing two-worker NSFWJS WASM service. Its workspace already links Royal.

## Implementation and adversarial review

- **Admission and resource ownership:** a linked FIFO admits sampling and hashing,
  not just classifier callbacks. Queued cancellation unlinks one job. Active jobs
  retain their lane until their callback settles, even if it ignores abort. This
  avoids exceeding the limit or invalidating a still-borrowed image. Decoded
  inputs remain owned by their producers; this is not a global source-memory cap.
- **Cache lifecycle:** pending/shared work is separate from the 1024-entry completed
  LRU. A decision becomes evictable only after settlement and the final consumer
  releases it. Canceled entries cannot replace a newer retry. Both denials and
  bounded errors remain cached. A 4096-job test rejects pending-map scans and
  verifies eviction/recomputation.
- **Identity and API:** pixel dimensions and SHA-256 are the decision identity
  inside one policy owner. Asset aliases can share decisions; changed pixels,
  policy keys and roots cannot inherit an unrelated approval. Concurrency defaults
  to 1 and is validated from 1 through 4. React recreates its root on policy-key or
  concurrency changes, while callback identity alone remains stable.
- **Pixel semantics:** all authored mips, raw RGB, and black/white alpha composites
  remain inspected. Integer footprints use scalar accumulators with exactly the
  reference arithmetic/order. Odd footprints retain the generic weighted reducer.
  Tests compare both floating output and actual browser worker/local sample hashes.
- **Worker ownership:** large images use one lazy workerpool worker per sampler
  for WebGL upload/readback and reduction. Only owned bitmap/level copies transfer;
  display sources stay intact. Requests have a 15-second deadline covering queue
  time and worker registration. Abort/disposal terminates active work; later jobs
  recover on a replacement. Tests inject startup, clone, deserialization and silent
  worker failures, queued cancellation and late replies. The bundled workerpool
  patch fixes failure settlement and stale worker recovery. Other Royal workers
  are unchanged.
- **WebKit correctness:** standalone compressed mips upload as complete level-zero
  textures, with BC storage padding cropped to valid texels. This fixes the WebKit
  crash on an isolated ETC2 1x1 level-two upload. Both browsers pass the complete
  fixture, including authored native mip rejection and BC tails.
- **Limits:** image freezing, bitmap copies, compatibility-path GPU readback and
  HDR environment reduction can still incur main-thread work. Whole-image
  classification retains the accuracy limits in the specification. No physical
  iPad measurements were made.

## Measurements

Run the literal root `pnpm dev` in Probability, then:

```sh
node research/texture-inspection/benchmark.mjs http://localhost:3003
```

Use the actual printed Site port. The development-only script uses Probability's
installed Playwright and production classifier, imports Royal's current inspection
owner through Vite, and submits 16 distinct synthetic 256x256 samples. It then
repeats them under new asset IDs. No explicit imagery or detection-accuracy claim.

Three interleaved trials on this host, including hashing and canvas preparation:

| Per-root concurrency | Batch times (ms) | Median (ms) | Peak classifier calls |
| --- | --- | --- | --- |
| 1 | 930.5, 816.4, 851.2 | 851.2 | 1 |
| 2 | 521.2, 528.4, 564.2 | 528.4 | 2 |

The median fell 38% (1.61x throughput). Repeating all 16 samples under aliases took
18.8–20.3 ms with **zero additional inference calls**. Model initialization took
1231.5 ms. Raw output is in `throughput-chromium.json`; the script also writes
`/tmp/royal-inspection-benchmark.json`. These are local Chromium measurements,
not mobile guarantees or renderer scene-load timings.

For browser coverage and full-image sampling, start Royal's Vite server:

```sh
pnpm exec vite --host 127.0.0.1 --port 5190
node research/texture-inspection/sampling-benchmark.mjs http://127.0.0.1:5190
```

Single-run Chromium diagnostics, including GPU upload/readback:

| Raster | Original synchronous sample (ms) | Worker GPU sampling (ms) | Largest timer gap (ms) |
| --- | --- | --- | --- |
| 1024² | 67.7 | 79.4 | 4.1 |
| 2048² | 227.9 | 194.4 | 13.8 |
| 4096² | 796.8 | 599.2 | 70.5 |

Each row creates a fresh sampler, including worker startup. Earlier reduction-only
4096² sampling left a 400.7 ms timer gap. These spot checks are diagnostics, not a
cross-device speedup guarantee. WebKit passed the same fixture, but its latest
4096² spot check still had a 339 ms gap; bitmap handoff/driver behavior remains
browser-dependent. Run with `BROWSER=webkit` for comparison.

## Validation

Royal: 1336 unit/tooling tests, including 46 inspection tests.
Type checks, lint, package builds, Node entrypoint imports, bundle budgets and
packed-consumer checks exercise the library boundary. Chromium and WebKit each
pass all 17 browser fixture groups. The standalone worker probe is also available
at `research/texture-inspection/webkit-worker-probe.mjs`.

Probability testing uses the literal root `pnpm dev` in an isolated `nsfwjs2`
worktree after the shared checkout switched to main. All four final Chromium and
WebKit app smoke tests passed without page errors or failed script requests.
The WebKit regression checks
both checkerboard colors in rendered screenshots; its injected sampling-failure
case must fail that artwork criterion, then render the artwork after filtering is
disabled. This prevents gray fallback from satisfying a successful inspection.

Workerpool is bundled with its recovery patch so published consumers keep the
fixes. It is loaded only by optional inspection. The measured graph is 145.7 kB
gzip initial, 244.7 kB lazy, 125.2 kB worker assets and 390.4 kB deployed JS. Named
allowances add 20 kB for lazy/deployed code, 12 kB for workers and 80 KiB for the
package including source maps. No classifier/model dependency was added to Royal.

## HDR performance follow-up

Packed HDR decode now uses exact Float64 lookup tables (2048 red/green values,
1024 blue values). Faces up to 85 pixels use direct decoded/tone-mapped byte
lookups because they require no averaging. Larger faces retain the established
area integrator and addition order. The tables occupy 27 KiB and are shared by
all inspection calls in this module; no additional worker is created.

Local seven-trial median timings for all six faces, including contact-sheet
canvas creation (milliseconds):

| Browser | Face size | Original | Optimized |
| --- | --- | --- | --- |
| Chromium | 64 | 5.0 | 0.4 |
| Chromium | 128 | 23.8 | 11.8 |
| Chromium | 256 | 51.6 | 22.6 |
| WebKit | 64 | 9 | <1 |
| WebKit | 128 | 22 | 11 |
| WebKit | 256 | 47 | 13 |

Reproduce with `node research/texture-inspection/environment-benchmark.mjs`;
set `BROWSER=webkit` for WebKit. The final script warms each size three times
before recording seven trials. These are desktop measurements, not iPad claims.
A scalar integration experiment was removed after WebKit showed a substantial
JIT performance regression. The retained implementation improves both engines.

Adversarial checks compare every output byte against the original implementation
for 1, 32, 85, 128 and 256 pixel faces, covering all packed channel values,
subnormals/invalid exponents, fractional area footprints, reordered face indices,
nonzero buffer offsets, missing mip rejection and unchanged borrowed storage.
The full suite now contains 1336 tests.

## Final code review

The final review found and fixed a disposal race between lazy pool creation and
task submission. A regression disposes the owner in that exact microtask gap and
asserts that no worker starts and no deadline remains. The review also rechecked
shared decision borrowing, FIFO cancellation, native mip storage, worker transfer
ownership, exact HDR conversion, packaging of the workerpool patch and the app’s
paired-color failure assertions. No unresolved correctness finding remained.
