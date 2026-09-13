# First presentation versus full-raster refinement

The proposal's preview-first timing question now has a controlled local browser
measurement. The explicit preview role presents a 32px ASTC mip pyramid before
loading the 4096px PNG authority. A plain PNG texture loads its raster source
before first presentation. Both describe identical uniform red artwork.

Each fresh headless Intel Iris Xe browser discards one warm-up pair, then runs
four alternating preview/plain-PNG pairs per block size. Every case creates new
blob/glTF identities and a renderer root. Fixture encoding, WebGL context creation
and root construction precede the clock. Timing starts at scene submission and
ends at the first observed red center pixel; it includes requestAnimationFrame
quantization, worker/renderer work and diagnostic readback. It measures warm shared
code with new assets, not a cold browser startup or network download.

The initial view projects the texture small enough to retain the preview. The
benchmark then zooms in and separately waits for full-raster VT residency with
no failed, pending or unresident pages. Preview cases read only ASTC before first
presentation and exactly one PNG after zoom. Plain PNG cases read exactly one
PNG total. The two scenes intentionally become ready at different quality levels.

Median milliseconds across four rounds:

| Block size / source | First run: visible | Repeat: visible | First run: refinement | Repeat: refinement |
| --- | ---: | ---: | ---: | ---: |
| 6×6 preview | 31.50 | 26.10 | 273.80 | 283.60 |
| Full PNG (6×6 pair) | 168.10 | 166.90 | 39.70 | 34.15 |
| 8×8 preview | 21.70 | 23.80 | 280.80 | 277.55 |
| Full PNG (8×8 pair) | 167.00 | 165.65 | 38.35 | 30.55 |

The preview path improves first presentation here by deferring raster work. It
does not reduce total time to full detail in these runs. The plain PNG has
already completed its source decode when the separate refinement clock begins.
The follow-up [decode audit](first-presentation-decode-review.md) also finds
different bitmap dimensions: 4096² for plain PNG and 3547² for preview refinement.
The comparison therefore includes different resizing/storage policies; it does
not isolate decoder speed for equivalent full-resolution outputs.
Do not infer a 6×6/8×8 performance ranking from these few frame-quantized samples.

The uniform PNG is 332,289 encoded bytes; ASTC containers are 1,104 bytes (6×6)
and 656 bytes (8×8). Uniform artwork is not representative of photographic or
vector complexity, and blob transport has no network latency. These data do not
establish dataset-wide savings, image-quality equivalence for detailed artwork,
GPU execution times or mobile-device performance. Initial VT byte counters are
zero even for the ordinary PNG path, so they are not total decoded-memory data.

Adversarial review checked that the red pixel cannot be the black clear color,
that ASTC and PNG depict the same artwork, that initial reads are asserted before
zoom, and that refinement requires residency as well as a started PNG fetch.
Order alternates and the second run uses a fresh browser. Both runs pass all 16
recorded cases (plus discarded warm-up pairs). No renderer changes were made.

The research directory now has a reproducible type-check command:
`pnpm exec tsc -p research/vt-comparison/tsconfig.json`. It passes. Including the
whole directory exposed one existing unchecked counter increment in the bitmap
close instrumentation; an explicit non-null read preserves its initialized
counter behavior. The proposal document remains untouched.

To reproduce after building and serving the candidate on port 5186:

```sh
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/source-combinations.html?first-presentation=1' VT_BENCH_OUTPUT=research/vt-comparison/first-presentation-results.json node research/vt-comparison/run-host.mjs
```

Artifacts: [harness](first-presentation.ts), [first run](first-presentation-results.json),
[repeat](first-presentation-repeat.json), [source hashes](first-presentation-sources.json).
All changes remain uncommitted.
