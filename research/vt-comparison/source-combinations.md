# Required full sources with optional ASTC

Optional ASTC alongside required full sources is implemented; see the
[current source-behavior guide](CURRENT.md#proposal-and-source-behavior).
Optional ASTC can accompany a core source or a supported required SVG, WebP or
AVIF source. Required SVG retains the ASTC representation instead of dropping
it. No redundant PNG is needed for those required-source combinations.

Required SVG is a distinct loading recipe: supported ASTC is read first, then
the authoritative SVG is read and its bounded profile validated before load
completion. This avoids a full SVG bitmap decode, but does **not** avoid the
required SVG transfer before first presentation. Failure or cancellation releases
the held preview. Unsupported/failed ASTC uses SVG directly. Optional SVG keeps
its existing lazy preview-first schedule. Non-base-color required SVG remains
direct-source. See the [contract](../../docs/specs/gs-texture-svg-extension.md).

PNG/WebP/AVIF alternatives keep ordinary ASTC semantics: ASTC is the final
representation on supported devices. Explicit low-resolution raster previews
are a separate follow-up and are not implemented by this change.

## Verification and review

- Full suite: 1,222 tests across 148 files before the final instancing guard;
  the affected glTF/instancing suite then passed all 24 tests, including the new
  embedded required/optional recipe separation test.
- Type checking and renderer lint passed. Packed consumer entrypoints and
  standalone codec imports passed. Bundle and package sizes are checked.
- The [headless host-GPU oracle](source-combinations-results.json) uses real glTF
  worker preparation, source loading, ordinary textures and automatic VT. It
  runs 16 cases: SVG, WebP, PNG and PNG+SVG, each with ASTC 6x6/8x8 and both actual
  ASTC support and forced-unsupported capability on the same Intel Iris Xe GPU.
  Every case produced the expected pixel, source-read sequence and zero VT page
  failures. ASTC fixtures contain complete mip pyramids; samplers remain mipmapped.
  AVIF selection/MIME/index validation is unit-tested, not claimed as browser-tested
  by this harness.
- Source representations deliberately differ: native ASTC is red, full SVG and
  raster sources are blue. SVG finishes blue; supported plain raster alternatives
  remain red. This catches accidentally treating all ASTC alternatives as previews.
- First review checked index/MIME validation, required-source failure behavior,
  unsupported capabilities and cancellation while holding a native preview.
- Second review found and fixed embedded instancing equality: required/optional
  preview roles and ASTC alternatives must participate in identity and equality.
  No new frame-loop allocation, codec or runtime encoding was introduced.

The package tarball measured 744,917 bytes. Its ceiling receives a 512-byte
allowance. Affected initial bundle ceilings receive 64 bytes and lazy/total
ceilings 128 bytes; worker and glTF authoring-delta ceilings are unchanged.
These small explicit allowances cover the validated-source lifecycle and
instancing guard; benchmark files and screenshots are not shipped.

Reproduce after `node research/vt-comparison/build-client.mjs` and serving the
candidate directory on port 5186:

```sh
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/source-combinations.html' VT_BENCH_OUTPUT=research/vt-comparison/source-combinations-results.json node research/vt-comparison/run-host.mjs
```

The runner always launches headlessly. This is a correctness/transport oracle,
not an end-to-end loading-speed comparison or a mobile performance claim.
