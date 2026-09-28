# Decode known detail on source-cache misses

A missing source could be decoded at root-page resolution and decoded again for
already-known visible detail. The root read now accepts warm preview pixels when
available, but sizes a new decode for the finest known request. Detail page
filtering, mip selection, required filtering levels, and fallback coverage remain
unchanged. The CPU cache remains 32 MiB, with a 16 MiB per-source decode cap.
The decision happens when the serialized job runs, so a queued read whose preview
was evicted also decodes at the useful resolution.

Regression coverage includes warm previews, cold source misses, later detail
reuse, and partial GPU atlas admission. The VT and raster-cache suite passes
231 tests in 18 files; typecheck, renderer lint, and renderer build pass.

A pair of fresh-profile hardware Iris Xe root-dev Nova runs reaches the same
207 resident pages with complete admitted detail. Source-cache decodes fall from
4 to 3. Peak source-cache bytes are 33,553,920 before and 33,552,172 after, below
the unchanged 33,554,432-byte cap. These are source redecodes, not total image
network requests or all initial image decodes.

Full-detail time was 18.131 s before and 24.546 s after; source-cache decode time
was 1.914 s and 2.093 s. This pair does not demonstrate an end-to-end speedup and
must not be presented as one. It demonstrates elimination of redundant work in
a specific cold-source path, not removal of every visible loading transition.
The original incomplete baseline hit ENOSPC and is excluded. Profiling artifacts
were moved from tmpfs to disk with their original /tmp path preserved by symlink.

The changed renderer passed the literal-root pnpm dev smoke: no page errors,
Vite overlay, failed module, or dev-server errors were observed. No fresh physical
iPad/Quest run was made for this incremental change. Portable observations are in
`demand-sized-raster-summary.json`; raw runs are `/tmp/royal-nova-profiles/correct-raster-*`.

The page planner already omits intermediate mip levels except those required for
filtering. The separate ordinary-preview to VT-root to requested-detail publication
sequence still exists. Removing its visual transitions requires a publication
policy change and is not claimed by this source-cache fix.
