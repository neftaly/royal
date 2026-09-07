# Retained outline source lookup

Working-tree implementation, 2026-09-08, based on `5bb9ab6c`.

The world owner creates its source index only when geometry is first borrowed.
Geometry keys and transform hashes identify candidates; exact asset, selected
scene, version, cohort, and transform comparisons reject collisions. Automatic
members use float32 transforms. Candidates store indices, not GPU pointers, so
readiness, residency and LOD selection are still checked at borrow time.

Scene and source-transform publication invalidate the index. Camera sweeps,
texture publication and DPR changes do not rebuild it. Coincident candidate
buckets retain a linear worst case. No application IDs or descriptor deep
equality are introduced.

The old scan lives only in `tests/replacement/support/surface-borrow-reference.ts`
as an independent oracle. Differential tests include ordinary/automatic sources,
coincident and displaced occurrences, source changes, and forced hash collisions.
An eight-frame control covers 0, 1, 32, 128, 254, 255, 256, 269 and 512 ordinary
occurrences. The old surface-comparison count is `8*N*N`; the index remains
within `16*N` candidate comparisons and builds once for each nonempty scene.

## Native comparison

`probe.mjs` generates a public glTF fixture with two primitives and repeated
instances. It swaps only candidate discovery between the index and scan oracle,
then requires byte-identical native pixels at four camera positions. It fails
if the intended lookup interception was not reached or no visible orange outline
pixels were captured.

Run through the literal root `pnpm dev` server. Import the public renderer/core,
the current Vite generation of `borrowed-surface-source-index.ts`, the reference
matcher, and `runOutlineSourceProbe` from `probe.mjs`. Call it with occurrence
counts 255, 256, 269 and 512. Reload after edits to avoid mixed module generations.

All four counts passed with zero pixel differences and one index build. See
`native-269.json` and `native-capacity-boundaries.json`. These captures use
Chromium/SwiftShader. Timings include JavaScript instrumentation, driver work,
warm-up variance, and ordering effects; they are not hardware speedup evidence.
Readbacks are outside the measured `flushInvalidated` spans.

The probe also exposed an existing opaque-canvas copy failure. Retained
presentation now allocates RGB8 for an opaque default framebuffer and RGBA8 for
an alpha framebuffer, preserving the conservative four-byte allocation charge.

Hardware CPU/GPU timing, equivalent-descriptor replacement policy, and any GPU
submission changes remain separate investigations. This change preserves the
existing outline ID capacity, material ordering, quality and selected descendants.
