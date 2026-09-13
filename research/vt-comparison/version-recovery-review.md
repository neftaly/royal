# Explicit version recovery after authority failure

Date: 2026-09-13. Research-only pass; no production changes or commits.

A full-source failure must stay bounded for its existing identity while allowing an
application-requested replacement to recover. This audit uses the public glTF
`version` field without changing the source URL or creating a new renderer root.

The fixture first fails the full raster, verifies the red ASTC preview across 180
demand-changing frames, restores the WebGL context, and verifies another 180 frames
without a retry or VT allocation. It then makes the source available, replaces the
node with `gltf({ src, version: 1 })`, and waits for the blue full authority.

## Results

All twelve cases pass on headless Intel Iris Xe through ANGLE Vulkan: HTTP 404 and
invalid-content failures, PNG/required WebP/required AVIF, ASTC LDR 6x6 and 8x8.

- Before recovery, complete VT snapshots match across context restoration: zero
  atlas storage and one recorded authority failure.
- Explicit version replacement performs exactly one additional ASTC/raster read
  pair. Total renderer reads are `astc,raster,astc,raster`.
- The recovered texture has one automatic resource and one resident VT page, with
  zero failed, pending or unresident pages.
- PNG/WebP render `[0,0,255,255]`; AVIF renders `[0,1,253,255]` within the existing
  fixture tolerance.
- No frame or GL errors occur. The failed source's state does not poison the new
  texture identity.

Reports: [transport recovery](version-recovery-transport.json),
[invalid-content recovery](version-recovery-invalid.json). `beforeRestore` and
`afterRestore` describe the failed version; `recovered` and `final` describe version
1. `recoveryFrames` is a local fixture observation, not a latency guarantee or
performance comparison.

## Review and scope

The importer propagates the glTF resource version into external texture references.
Review checked that the test actually changes that public version, keeps the URL
unchanged, and does not reset the root or clear the old failure by direct mutation.
The source-serving test wrapper changes only whether it returns failed or valid
content. A second pass checks exact reads, recovered resource count and failure
counters, in addition to visible color. Research TypeScript, Vite build and
whitespace checks pass. Production source remains at the
[authority-failure checkpoint](authority-failure-sources.json).

This validates Royal's versioned identity behavior with local Blob sources. It does
not test remote HTTP cache freshness, deployment propagation or recovery without
an explicit identity change. The old identity deliberately does not auto-retry.

```sh
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/source-combinations.html?failure=transport&recover=1' \
VT_BENCH_OUTPUT=research/vt-comparison/version-recovery-transport.json \
node research/vt-comparison/run-host.mjs
```

Use `failure=invalid` for invalid image content. `recover=1` requires a failure
mode; ordinary failure and success checks retain their existing behavior.
