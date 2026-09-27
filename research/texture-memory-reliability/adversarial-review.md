# Review scope and findings

Review covers the full uncommitted texture-memory diff and its root, capture,
glTF-status and React observation callers. These are repeated local adversarial
passes, not independent reviewer sign-off. No subagents were used.

## Correctness and memory pressure

- Decoupled reloadable raster VT membership from permanent full-image leases.
- Kept one shared texture admission authority and charged old/new GPU objects
  during replacement. Shrinking can use real free migration capacity even after
  the steady-state envelope falls below existing residency.
- Made migration scratch and fallback sizes respond to the remaining texture
  allowance. Essential target plans reduce this allowance. Fallbacks use at most
  64px edges and one eighth of steady texture capacity, subject to the minimum
  representable texture size. Visible sources awaiting decode reserve coverage.
- Removed offscreen fallback, page-table and demand-workspace accumulation.
  Native/non-base material maps preserve their separate ordinary requirements.
- Removed fractional-slot overcommit when more logical images request coverage
  than the atlas can hold. Ordinary fallback remains available for omitted VT
  refinement. Fixed stale zero-slot admission on camera return.
- Covered source ownership during cache eviction, disposal, superseded decodes,
  late GPU resizing, scene replacement and context restoration. Closed bitmap
  metadata must never be uploaded as if its pixels were still alive.
- Cleared offscreen denial diagnostics and retained existing targets on failed
  replacement. Optional effects can degrade without failing the whole frame.

## Complexity and page generation

- Initial CPU seeds cover coarse and adjacent detail (256px-square storage
  budget), avoiding a second source read for common visible demand while GPU
  fallbacks remain at most 64px. The cache and preparation ceilings still apply.
- Coarse seeded pixels now receive the same cache-first scheduling as detail.
  Sequential catalogue-order misses previously evicted upcoming seeded images.
- Visibility policy is a pure scene plan plus a conservative union of views.
  Unchanged view matrices reuse the active set during refinement. Authored scene
  and transform changes invalidate it; texture publication does not.
- VT reuses a pure authored scene plan across decoded-binding publication.
  Publication no longer renormalizes every catalogue identity or restarts
  settled geometric demand. New resources still receive their own traversal.
- Texture publication uses the existing decoded-key index, replacing a linear
  catalogue search for every completion.
- Context restoration touches active preparations and batches aggregate progress
  notification. It previously combined per-image notification with catalogue
  readiness scans, producing quadratic recovery work. Focused asset subscribers
  still receive their own status changes.
- Raster diagnostics separate cache queue, source read/decode and page-render
  elapsed time. Existing read-to-upload timing and bounded upload budgets remain.

## Functional core, coupling and React DX

Visibility selection, authored VT scene planning, slot allocation and storage
fitting are pure policies. GPU/bitmap lifetime, asynchronous work and browser
calls stay in owners. Root wiring passes one active storage-key set to the
ordinary owner and optional VT runtime; React does not acquire a paging API or
an application cache requirement.

`ready` asset status continues to describe decode metadata rather than persistent
GPU ownership. Never-prepared offscreen images report `idle`; active-set changes
notify focused subscribers. glTF progress reports deferred images separately
from loading images without claiming the all-images timing milestone. Capture
readiness uses active view demand. Broad renderer diagnostics expose preparation,
refinement, ready, degraded and failed presentation.

## Obsolete paths and retained alternatives

The old root-wide raster-membership cap and fixed 75% root VT share no longer
control reloadable raster paging. The remaining 64 MiB constant is explicitly
named for leased sources: native-preview authority and runtimes supplied without
a reload adapter still need it. Native compressed textures, non-base maps,
context-generation cleanup and ordinary-source reacquisition are live paths,
not obsolete substitutes for the raster cache. They were retained and tested.

No general spatial index, geometry paging, encoded-asset disk cache or lossless
region decoder was added. Scene metadata and non-pageable resources still scale
with the document. The 10× workload tests bounded texture residency, not an
unqualified guarantee that any tenfold scene fits every device.

## Nova trace follow-up

A hardware-browser CPU trace of the full Nova release through Probability exposed
additional work that the synthetic page benchmark cannot detect:

- Texture identities were repeatedly serialized in scene/material reconciliation.
  Weak caches now compare all semantic fields, including nested sampler/ASTC
  recipes, and preserve mutation validation and typed version identity.
- Texture-only GPU packet replacement invalidated geometric depth partitions.
  A pure rebinding step preserves splits only for the same members and bounds;
  explicit transform invalidation still wins. Cold construction sorts each axis
  once, then partitions the ordered lists instead of sorting every subtree.
- Incremental publications could upload a larger seed before the next VT binding
  revision reduced it to safety coverage. Fallback selection now precedes that
  first incremental upload. A regression test asserts one 64px allocation.
- Single-sided VT demand previously included triangles culled by the draw packet.
  Demand now uses the same winding, snapshots live handedness, retains uncertain
  projections and unions stereo views. Tests cover reversed orientation, clipping,
  thin visible triangles and two-sided fallback. It does not infer that blended
  geometry is an opaque occluder.

The final suite passes 1,439 tests after the upload and source-quality regression
cases. The visual pass found that coarse-first detail used a smaller cached seed
than fine-first detail, altering filtering on the tracks board. Computing the
finest requested source mip once per fitted demand fixes that order dependency
without adding per-page demand scans. The root seed path and cache caps remain.
Physical Quest game and iPad working-set/context-restore checks also pass with
the new renderer. See the loading-performance report for final visual comparison
and trace evidence. Device runners reject old-frame/old-document ready snapshots.

## Repeated mobile stability review (2026-09-28)

Subsequent review/fix cycles found and fixed the following issues:

1. Safari could return a null texture allocation before delivering the context-loss
   event. Scheduled failures now enter context recovery when `isContextLost()` is
   true; the later event remains idempotent and presentation stays preparing.
2. Decode-count admission ignored original image dimensions. A 64 MiB estimated
   native-decode byte gate now serializes oversized/unknown sources while keeping
   small sources concurrent. It does not claim to cap native memory for one image.
3. On the physical iPad, kernel `memorystatus` killed `com.apple.WebKit.GPU` at
   307201 KiB, confirming its 300 MiB high-water limit. The 2D CPU-backing hint is
   unsupported there. Large fitted AVIF images now avoid a full-size ImageBitmap
   intermediate by using the image-element fit path. Byte admission and hints alone
   did not eliminate the failure; that failed experiment is retained in the report.
4. Browser pixel caches could survive a GPU-process exit with invalid contents.
   Restoration now clears those caches, aborts stale page reads, and reacquires
   browser-backed sources. Generation checks also reject decodes that finish after
   the context generation in which they began.
5. A clear could mark the GL shadow known without restoring stale draw-only state.
   This produced white translucent ground after otherwise successful recovery.
   Invalidation now resets blend, depth, cull, program, VAO and texture state;
   the clear-then-draw regression and physical pixel comparison cover the failure.
6. Cache misses reserved 16 MiB even for tiny requested sources, evicting useful
   pixels unnecessarily. Reservations now match the bounded request and validate
   actual output dimensions/bytes against that reservation.
7. Converting an existing generic GPU claim to texture ownership could bypass the
   texture envelope at unchanged size. Conversion now checks admission first.
8. Temporary fallback canvases retained backing pixels after upload or a failed
   draw. Success/failure cleanup now shrinks staging canvases immediately.

The final fresh read-through checked queue cancellation/fairness, reservation and
lease release, generation races, context event ordering, migration accounting,
working-set/stereo conservatism, depth-partition complexity and binding reuse.
It found no further actionable defect in the reviewed changes. Scene planning
remains a pure step; resource ownership remains in the imperative owners. The
Probability React change memoizes scene inputs and does not introduce renderer
resource lifetimes into React. Existing compressed/native and non-base-map paths
remain necessary alternatives, not dead code. No approximate occlusion threshold
was added: thin visible content is preserved.

Validation: 1,452 tests across 167 files, the 64-case glTF manifest check, typecheck,
lint and renderer/Probability production builds pass. Physical results and the
required literal-root development smoke check are recorded in
[the follow-up](../texture-loading-performance/mobile-stability-review.md).
`compare-canvases.py` checks restoration pixels separately from readiness/touch;
a `completed` device JSON alone does not certify visual recovery.
