# RGBA first, ASTC during idle time

Initial feasibility investigation, 2026-09-14, after Royal 0.0.29 (`6d51503a`).
The sections below describe the pre-implementation findings. The subsequent
implementation and device results are recorded in [implementation](implementation/README.md).

The approach is technically possible: publish RGBA immediately, encode selected
stable content in a worker, upload a separate ASTC representation, and switch only
when it is complete. Its likely benefit is lower retained GPU memory and texture
bandwidth after settling. It does not make the initial RGBA upload cheaper.

## Physical-device probe

The existing Probability single-thread WASM SIMD encoder was run in a dedicated
worker at quality 0 (fastest), sRGB LDR, one mip level. The source was Royal's
Ghostscript tiger fallback PNG, resized to each test extent. These are complete
resized images, not crops of detailed VT pages; content affects encoding cost.
Each case ran three times. The first call includes cold encoder execution.
The loop recreated contexts; context setup is reported separately from encoding.
Encoding time includes copying RGBA into WASM memory but excludes worker startup,
context creation, result transfer, GPU upload, and image extraction.

| Extent | ASTC block | iPad encode median | Quest 2 encode median | RGBA bytes | ASTC bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| 132×132 | 6×6 | 66 ms | 29.8 ms | 69,696 | 7,744 |
| 132×132 | 8×8 | 64 ms | 60.8 ms | 69,696 | 4,624 |
| 512×512 | 6×6 | 121 ms | 169.9 ms | 1,048,576 | 118,336 |
| 512×512 | 8×8 | 180 ms | 237.7 ms | 1,048,576 | 65,536 |

The physical iPad was iPad7,6 / iPadOS 17.7.11 with Apple GPU; Quest 2 used
Adreno 650 in its ordinary browser, not immersive VR. Safari reported its desktop
user agent. Both exposed ASTC LDR and every compressed upload returned GL error 0.
This checks upload acceptance; the probe does not render or compare compressed
pixels, test seams, or establish sufficient quality for text, artwork or alpha.

Encoder WASM was 174 KiB uncompressed (exact bytes and SHA-256 are recorded in
[encoder-identity.json](encoder-identity.json)). Its linear memory grew from
4.75 MiB to about 5.81 MiB. That excludes JS arrays, decoded images, browser and
GPU allocations. Input extraction was usually 2–5 ms but reached 36.7 ms on the
first Quest read. RGBA upload submissions ranged from 0–1.1 ms and compressed
submissions from 0–0.1 ms, with coarse browser timing. Neither measures GPU completion.

Raw data: [iPad](ipad.json), [Quest](quest.json). rAF samples are only incidental
measurements on an otherwise idle probe page. Some iPad jobs have no observed
rAF callbacks. They do not prove interaction smoothness, true system idle time,
thermal cost, or application responsiveness under rendering load.

## Royal-specific costs

- WebGL exposes compressed uploads, not automatic ASTC encoding. Immutable
  RGBA storage cannot change its format. The old RGBA and new ASTC allocations
  must coexist until publication; neither can escape the shared byte budget.
- Royal currently binds one physical atlas per virtual texture. Its page table
  does not select between RGBA and ASTC pools per page. Gradual mixed residency
  needs additional pool selection/sampling support, or migration of a complete
  logical texture's resident set before an atomic switch.
- An unused RGBA slot still occupies its allocated texture. Memory falls only
  after an entire atlas is released or safely compacted. Replacing isolated pages
  can otherwise increase memory rather than reduce it.
- Page footprints must align with ASTC blocks. A 132px page fits 6×6 blocks;
  8×8 atlas cells need padding to 136px and adjusted UV/border handling. Standalone
  partial-block uploads accepted by this probe do not validate shared-atlas layout.
- Encoding needs CPU pixels. Prefer a bounded copy while rasterizing; reading
  back old GPU pages adds synchronization and traffic. Keeping every RGBA page
  on the CPU would undermine the memory goal.
- Worker execution keeps the synchronous encoder off the main thread but still
  consumes shared CPU and battery. Dispatch one bounded job at a time, yield
  between jobs, and stop dispatching when input or demanded refinement resumes.
  A synchronous WASM call cannot process a cancellation message mid-encode;
  reject obsolete results by source/context/demand generation.
- ASTC is lossy. Compressing after sharp RGBA presentation can visibly reduce
  quality; small text, alpha edges, linear/sRGB handling and independent-page
  seams need pixel and visual acceptance checks. The fastest preset is only a
  lower-cost feasibility point. CPU-alpha picking must retain its own authority.

## Assessment

Worth a small isolated prototype for stable, expensive textures when there is
headroom for migration. Keep demanded RGBA preparation first. Decide whether a
candidate actually frees a complete allocation before spending encoder time;
measure total retained bytes after retirement rather than counting encoded bytes
as an immediate saving. Reuse encoder contexts and scratch storage in a bounded
worker, and cache successful compressed results only within an explicit budget.

This is not ready for automatic production use. The missing evidence is pixel
quality, true mixed-pool or whole-texture migration, context-loss/cancellation
correctness, and foreground frame times plus energy under a real consumer load.
The measured tens of milliseconds per small image explain why encoding must not
be required before a zoomed page can display. Pre-encoded ASTC remains preferable
when content is already available at import/publish time.

## Sources and reproduction

- [Arm ASTC encoder](https://github.com/ARM-software/astc-encoder): profiles,
  compression presets and CPU implementation.
- [WebGL ASTC extension](https://registry.khronos.org/webgl/extensions/WEBGL_compressed_texture_astc/):
  formats, byte sizes and compressed upload constraints.
- [WebGL 2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/):
  immutable storage and compressed upload operations.
- Local contracts: [VT memory](../../docs/specs/resources-and-performance.md)
  and [native raster previews](../../docs/specs/raster-texture-previews.md).

To reproduce, serve `index.html`, `worker.js`, and the exact `encoder.wasm`
identified by the hash from one directory on Royal's example origin. The encoder
binary is supplied by Probability's asset pipeline and is not vendored here.
The fixture URL is absolute under `/fixtures/gltf-svg-texture/`. Read
`window.report` after `running` becomes false. These probe files are research
artifacts and are not linked into the renderer or examples build.
