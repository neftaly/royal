# Native texture formats — 2026-09-12

Ship native KTX2 ETC2 RGBA, ASTC LDR 6x6/8x8, and BC1 RGBA/BC3/BC7 through
one parser and upload path. Keep automatic raster/SVG VT pages on RGBA. Do not
ship an encoder, transcoder, HDR profile, or per-device authoring selector.
An authored format must be supported by the device or the texture is omitted
with the existing neutral material fallback. VT formats can coexist in
separate compatible atlases.

ETC1S and UASTC are useful delivery formats but require runtime transcoding;
they are deliberately excluded by the requested scope. The official glTF
extension distinguishes ETC1S/BasisLZ and UASTC, and recommends different
choices for color and data textures. They are not directly uploadable WebGL
formats. [KHR_texture_basisu](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md),
[Basis transcoder documentation](https://github.com/BinomialLLC/basis_universal/wiki/How-to-Use-and-Configure-the-Transcoder).

| Native format | Block bytes / extent | 1024² base storage | Capability |
| --- | --- | ---: | --- |
| RGBA8 reference | 4 bytes / texel | 4,194,304 B | WebGL2 |
| ETC2 RGBA | 16 / 4x4 | 1,048,576 B | `WEBGL_compressed_texture_etc` |
| ASTC LDR 6x6 | 16 / 6x6 | 467,856 B | ASTC extension, LDR profile |
| ASTC LDR 8x8 | 16 / 8x8 | 262,144 B | ASTC extension, LDR profile |
| BC1 RGBA | 8 / 4x4 | 524,288 B | S3TC, separate extension for sRGB |
| BC3 RGBA | 16 / 4x4 | 1,048,576 B | S3TC, separate extension for sRGB |
| BC7 RGBA | 16 / 4x4 | 1,048,576 B | BPTC |

These are block-payload sizes, excluding mips and driver overhead. ASTC 6x6
saves about 55% versus ETC2 RGBA; 8x8 saves 75%. BC1 uses the RGBA variant
because WebGL explicitly warns that its RGB variant may produce transparency
on some implementations. BC formats require aligned base levels, including
rebased mip suffixes. [ASTC specification](https://registry.khronos.org/webgl/extensions/WEBGL_compressed_texture_astc/),
[S3TC specification](https://registry.khronos.org/webgl/extensions/WEBGL_compressed_texture_s3tc/),
[sRGB S3TC specification](https://registry.khronos.org/webgl/extensions/WEBGL_compressed_texture_s3tc_srgb/),
[BPTC specification](https://registry.khronos.org/webgl/extensions/EXT_texture_compression_bptc/).

The container profile remains unsupercompressed 2D, single-face, non-array,
straight-alpha, upper-left, identity-swizzled KTX2. It validates ranges,
block sizes, metadata, and mip compatibility without copying block payloads.
Compressed MASK textures requiring retained CPU alpha remain restricted to
ETC2/raster or an explicit picking proxy: no ASTC/BC software decoder is added.
[Royal texture contract](../../docs/specs/textures-and-virtual-texturing.md),
[KTX2 specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html).

Measurements use an Intel i7-1185G7 host for native encoding/Node and a connected
Chromium 152 browser exposing **SwiftShader**, not a physical GPU. `/dev/dri`
is absent in the workspace. Results do not establish mobile GPU throughput.

- [Encoding results](encoding-results.json): Arm astcenc 5.7.0, AVX2, sRGB LDR,
  one thread, one warm-up plus three measured runs. The repository's tiger
  raster (256², upsampled for the 1024² case) and Sponza PNG are resized to
  136² and 1024². PNG loading/process startup is excluded from the encoder's
  reported coding time and included in the separately reported wall time.
- [Browser results](browser-results.json): structural fixtures; warmed parser,
  upload submission, stable binding reuse, and block-aligned VT subimage tests.
  All six native formats upload successfully. Both ASTC footprints sample to
  the expected opaque-red pixels. These fixture timings are not image-quality
  or native-hardware throughput evidence.
- [Authored-image results](authored-results.json): real astcenc output, full
  1024² nearest-sampled draws, with one-pixel synchronous readback forcing
  completion. Upload submission is about 0.1 ms for ASTC versus 2.6–2.7 ms
  for RGBA, but draw/readback costs **42–53 ms for ASTC versus 8.9 ms for RGBA**
  on this software renderer. Lower upload cost alone is not evidence of faster
  rendering. Early `gl.finish`-only draw samples rounded to zero and were
  discarded as unsuitable evidence.
- [GC results](gc-results.json): Node 24.12, no-op driver, 100k warm-up calls,
  then one million cached binding calls per case. Supported and unsupported
  native binding paths trigger no measured GC events, allocate no payload
  buffers, and query capability once. Parsing creates short-lived metadata and
  typed-array views, so it still produces GC; it never duplicates the payload.
  Heap deltas and timing differences are noisy, not proof of zero allocation.

Fastest encoding took 13.5–42.7 ms per 136² page and 173.7–437.2 ms per 1024²
image. Medium quality reached 60–140.1 ms/page and 602.6–2192.6 ms/image.
That is already too expensive to assume cheap live page production, even in
native single-threaded code; no browser/WASM encoder performance is claimed.
Encoding off the render thread would still consume CPU and delay residency.
Arm exposes quality/speed choices and recommends sRGB encoding for color
content. [Arm encoding guidance](https://github.com/ARM-software/astc-encoder/blob/main/Docs/Encoding.md).

For offline ASTC assets, prefer 6x6 initially and evaluate 8x8 where lower
memory matters more than detail. In the two medium-quality image tests, 6x6
improved the measured linear-framebuffer RGBA PSNR by approximately 3.4–3.6 dB
versus 8x8. This is a narrow comparison, not a quality guarantee for normal
maps, text, or alpha edges. A physical ASTC-capable device benchmark is needed
before claiming a frame-rate benefit or changing the automatic VT default.

Reproduce from the repository root:

```sh
ASTCENC=/path/to/astcenc-avx2 python3 research/native-texture-formats/encode-benchmark.py
node --expose-gc research/native-texture-formats/gc-benchmark.mjs
pnpm exec vite --host 127.0.0.1 --port 5184
```

Open `/research/native-texture-formats/index.html`; run
`await runNativeTextureBenchmark()` and `await runAuthoredTextureBenchmark()`
in the console. The Python script requires Pillow and writes generated images
and `.astc` blocks only under ignored `node_modules/.cache/royal-native-bench`.
The encoder is an external benchmark tool, never a Royal dependency.

The bundle allowance records this feature explicitly: at most 512 additional
initial gzip bytes and 1024 additional lazy gzip bytes. The packed-package
allowance adds 6144 bytes for runtime code, declarations, and source maps.
[Measured bundle output](bundle-results.json) is retained alongside the timings. The final production-source diff is **161 net lines** (the parser was moved,
not duplicated). The renderer still has one compressed upload branch, one
native format table, and no new dependency.
The [review record](review.md) covers both adversarial passes and the regression
checks added for their findings.

## SVG preview follow-up

The published [EXT_texture_astc draft](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_texture_astc/README.md)
provides native ASTC alternatives to core PNG/JPEG. The earlier research missed
this draft. Royal now implements its unsupercompressed LDR 6x6/8x8 subset and
composes it with experimental `GS_texture_svg`: ASTC first when supported,
portable raster otherwise, vector pages when detail is needed. No new codec.

`svg-preview-browser-results.json` measures Chromium 152 / SwiftShader using
in-memory encoded bytes, 40 trials per case with 10 discarded warmups. Native
128px ASTC 6x6 and 8x8 preview preparation both measured 1.0 ms median; the
1024px PNG fitted to the preview budget measured 8.4–8.6 ms. ASTC trials made
40 ASTC reads, zero PNG reads and zero SVG reads. Simulated unsupported trials
made only 40 PNG reads. Retained upload payloads were 10,512 / 5,504 bytes for
ASTC versus 49,284 bytes for the fitted PNG (excluding generated GPU mips).
Sub-resolution upload timings of zero mean below the timer resolution, not
zero work. These results exclude network and GPU draw completion and do not
supersede the software-GPU draw caveat above.

`svg-preview-gc-results.json` adds native previews to the existing no-op-driver
GC workload. One million cached preview binds measured 43.0 ns/call versus
42.4 ns for plain ASTC, with zero observed GC, no ArrayBuffer growth, one
capability query and one upload. This tests ordinary cached GPU ownership, not
whole-frame allocation. Source planning/identity and decoding are cold work
and still allocate metadata; the preview field introduces no per-bind work.

Reproduce with the dev server and browser:
`(await import('/research/native-texture-formats/svg-preview-benchmark.ts')).runSvgPreviewBenchmark()`.
For GC: `node --expose-gc research/native-texture-formats/gc-benchmark.mjs research/native-texture-formats/svg-preview-gc-results.json`.

Two adversarial passes were performed by the implementing agent. The first
covered selection before fetch, retained-alpha selection, embedded transfer,
content identity, MIME/metadata and context loss; it also found and removed
unneeded VT allocation while native preview demand stays coarse. The second
covered native-to-vector publication, cancellation, failure retention, source
lifetimes and hot-path churn. It found the existing raster-error coarse-page
recovery would retry an unavailable vector source for native previews; native
failures now keep ordinary coverage without entering that raster-only recovery.
Tests exercise ordinary ASTC plus deferred vector
coverage, including the transition to an RGBA page atlas without decompression.

Final follow-up source growth is 67 net production lines, with no dependencies.
The compact `svg-preview-bundle-results.json` records 143,389 bytes initial,
128,623 lazy, 272,012 total and 23,413 worker gzip (worker is included in lazy).
Against the native-format commit this adds 111 initial and 839 lazy bytes.
The feature has an explicit 1,024-byte lazy/total and 384-byte worker allowance;
the initial bundle remains inside its existing cap. The renderer package is
742,617 bytes with an explicit 2,048-byte package/declaration allowance.

Validation: 1,206 tests in 148 files plus the glTF manifest check; typecheck,
renderer lint, full build, package imports, packed-consumer checks and size gates. Two full-suite
failures during follow-up were investigated: an assertion still expected the
old source-encoding diagnostic, and an existing VT timing test exceeded its
short deadline during a concurrent build. The assertion was updated and the
full suite passed with the build finished; no timeout was widened.
