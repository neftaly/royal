# Shared-atlas failure isolation regression

Date: 2026-09-13. Test-only pass; no production changes or commits.

The failed-authority fix releases an unused GPU resource. This regression checks
that releasing it cannot delete storage still used by another logical texture.

The runtime test combines a healthy authored RGBA VT source with a native preview
whose raster authority is pending. Both use compatible 132x132 stored pages and
must share exactly one atlas. Once the healthy source is resident, the test rejects
the preview's authority and advances frames. It runs in both scene insertion orders.

Both orders pass these assertions:

- The healthy source keeps the same resident page count and binding object.
- Neither its atlas texture nor its page-table texture is deleted.
- Exactly one additional texture deletion occurs: the failed resource's page table.
- Detail is loaded once; pending and unresident page counts return to zero.
- Removing the healthy source then releases the last atlas and returns the VT GPU
  budget to zero, even while the failed native-preview resource remains in the scene.

The first review checks shared ownership and removal order. The second checks GPU
handle identity, not structural equality: this test's fake GL represents handles as
empty objects, so a structural mock-argument matcher would conflate distinct handles.
The final assertions compare references explicitly.

All 88 runtime/growth tests and root type checking pass. Whitespace checks pass.
The [regression test](../../tests/replacement/renderer-webgl-vt-runtime.test.ts)
uses the real VT runtime and budget owner with fake GL and controlled page decoding.
It establishes ownership behavior, not actual shared-pool pixel rendering or GPU
performance. Existing host-GPU failure and restoration reports cover the native
preview's visible fallback separately. No package/bundle change is introduced.
