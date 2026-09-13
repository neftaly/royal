# Authored page-key validation boundaries

Date: 2026-09-13. Test-only review; no runtime edits or commits.

The packed-key helper assumes valid non-negative integer coordinates. The
manifest parser enforces that assumption before calling it, then checks mip and
grid bounds before inserting a page into the sparse-entry Map. Adding equivalent
guards to the per-frame helper would duplicate this work.

The new manifest regressions cover:

- Negative, fractional, unsafe-integer, string, null and absent values for each
  of mip/x/y. All 18 malformed entries fail coordinate validation.
- Sparse x coordinates 65,535 and 65,536 alongside the next packed row. The
  string fallback remains distinct; removing it could alias the wide coordinate
  with the next row. A duplicate wide entry is still rejected.
- Sparse y coordinates 0, 256, 65,535 and 65,536. All four retain their own URIs.
  Row 256 produces a numeric key beyond 32 bits, preventing an unsafe bitwise
  coercion optimization from silently identifying it with row zero.

The wide/tall cases parse layout metadata only. They do not allocate GPU page
tables or establish support for textures beyond the device's dimension limits.

Review first traced validation order from authored JSON through key insertion.
The second pass checked both packed-field overflow and 32-bit coercion boundaries,
using URI resolution to verify that distinct authored entries remain distinct.
All 26 manifest/property tests, root type checking and whitespace checks pass.
No renderer branch, allocation or size allowance is added.

Evidence: [manifest regressions](../../tests/replacement/renderer-webgl-vt-manifest.test.ts),
[parser](../../packages/renderer-webgl/src/virtual-texture/manifest.ts).
