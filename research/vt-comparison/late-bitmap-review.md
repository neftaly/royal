# ASTC preview replacement during late raster completion

Date: 2026-09-13. Research-only pass. No production edits or commits.

The earlier lifecycle fixture covered ordinary SVG/PNG replacement and transport
cancellation. This audit covers marked ASTC previews with a full PNG or required
WebP authority. It exercises both ASTC LDR 6x6 and 8x8 on headless Intel Iris Xe
through ANGLE Vulkan.

The fixture wraps the real browser `createImageBitmap`, lets it decode the raster,
and holds the first returned bitmap before delivering it to Royal. It then:

1. Verifies the native preview rendered without a full-raster read at small demand.
2. Increases demand and waits for the full bitmap to reach the gate with a reservation.
3. Clears the scene and verifies that its reported VT ownership is released.
4. Reloads the same glTF and waits for its replacement full raster to render while
   the old bitmap is still held.
5. Releases the old bitmap and runs 60 further frames. The old bitmap must close
   exactly once; the replacement bitmap must remain open, blue and resident, with
   unchanged page-request count and automatic decoded bytes.
6. Clears the replacement and verifies that its bitmap also closes exactly once
   and its VT atlas/source ownership returns to zero.

## Results

All four cases pass. Each performs exactly `astc,raster,astc,raster` source reads.
Both browser bitmaps close once, and no frame/GL errors or failed pages occur.

| Case | Pending reported automatic decoded bytes | Final atlas bytes |
|---|---:|---:|
| PNG, ASTC 6x6 | 1,049,408 | 0 |
| WebP, ASTC 6x6 | 4,195,136 | 0 |
| PNG, ASTC 8x8 | 1,048,960 | 0 |
| WebP, ASTC 8x8 | 4,194,688 | 0 |

The pending totals include native preview storage as well as the planned full
bitmap. A held bitmap is deliberately outside normal delivery timing, so this is
an ownership/correctness test, not a memory-cap or speed benchmark. Aggregate GC
numbers in the host report include fixture construction and instrumentation and
are not used as performance evidence.

The existing decoder unit test already checks a bitmap arriving after source
closure. This adds the actual glTF worker, native upload, VT reservation, same-key
replacement and browser bitmap lifetime. It does not cover every codec, GPU, or
cancellation boundary.

## Adversarial review

The first review checked that the held object is a real decoded browser bitmap,
that replacement actually renders before the old bitmap is released, and that
closure counts remain exact through final cleanup. The second checked generation
isolation: late completion must neither close the replacement's bitmap nor change
its page requests or decoded-byte accounting. The browser decode queue retains a
running job's concurrency slot until its promise settles, including after abort;
this audit does not assume that `createImageBitmap` itself is cancellable.

The gate, fetch wrapper and `createImageBitmap` wrapper are restored in cleanup.
The two source-audit modes cannot be combined. Research TypeScript and Vite build
checks pass. All 24 [regular source-combination cases](late-bitmap-source-regression.json) also
pass, including supported/unsupported branches after adding the new fixture path.

[Four-case results](late-bitmap-results.json) record close counts, reads,
replacement residency and final ownership. The result note was clarified after
capture; measured fields were not changed. The tested renderer matches the
[lifecycle source hashes](lifecycle-sources.json).

```sh
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/source-combinations.html?late-bitmap=1' \
VT_BENCH_OUTPUT=research/vt-comparison/late-bitmap-results.json \
node research/vt-comparison/run-host.mjs
```
