# Selection-outline camera performance: remaining work

Status: partially implemented. Retained source indexing landed in `a1b4961d`
and shipped in Royal 0.0.23. Camera-copy work followed in `cf6ebcf7`.
No new public API is proposed.

## Implemented behavior

`SurfaceGpuOwner.borrowPresentedGeometry` now uses `BorrowedSurfaceSourceIndex`
to find source candidates. It checks current readiness and LOD against those
candidates rather than scanning the entire world for each outlined surface.
Differential and native pixel checks covered the indexing change.

The original Probability Settlers observation involved 269 pieces in 14 root
groups. Its software-rendered 0.0.22 comparison predates these fixes and does
not establish a remaining bottleneck or a current speedup.

## Remaining investigations

1. Establish a fresh baseline on hardware-accelerated desktop and physical iPad
   Safari. Separate idle selection, camera motion with stable descriptors,
   equivalent overlay replacement, and actual transform/resource/LOD changes.
   Use a reproducible Royal fixture without private consumer documents.
2. Measure source lookup, canonical preparation, batch rebuilding and GPU mask
   and resolve costs separately. Compare unselected and selected scenes with
   matched paths and sample counts; report instrumentation overhead.
3. Investigate equivalent descriptor replacement only if preparation still costs
   materially more than stable reuse. Audit the consumer submission boundary
   before adding renderer caches or deep equality work.
4. Measure the 255-occurrence material-run boundary with 254, 255, 256 and 269
   outlined occurrences. Change GPU submission or ID representation only with
   evidence of a useful improvement and preserved pixels.

Preserve descendant outlines, source identity, conservative scissors, material
ordering, coincident occurrences, readiness/LOD transitions, context recovery,
XR and the existing no-outline path. Do not reduce quality or cache outline
pixels across camera changes. Hardware access and fresh measurements are still
required before selecting another optimization.

The [historical proposal and measurements](archive/selection-outline-camera-performance-2026-09-11.md)
retain the original design, adversarial cases and acceptance criteria. The
[overlay contract](../specs/rendering-and-presentation.md#always-visible-scene-overlays)
and [resource requirements](../specs/resources-and-performance.md) remain authoritative.
