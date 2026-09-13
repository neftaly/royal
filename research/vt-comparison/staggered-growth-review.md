# Staggered arrival and atlas migration headroom

The optional `stagger-source` research flag spaces released source reads by
50 ms times their copy index. Combined with the SVG source gate, it admits
SVGs gradually after native coverage is established. This is diagnostic input
scheduling, not a production transport change.

An isolated runtime build logs rejected growth plans. The [observed plan](staggered-growth-analysis.json)
has 168 desired image pages, a 240-slot target, and a current 135-slot atlas
occupying 9,408,960 bytes. Only 8,797,506 bytes are free. The planner can supply
a 126-slot replacement occupying 8,781,696 bytes, so it correctly rejects that
plan as growth. The per-pool allowance is 16,789,152 bytes, sufficient for the
11,708,928 bytes needed by 168 pages after replacement. It cannot provide the
simultaneous old and replacement allocations needed during copying.

This rules out merely reducing power-of-two growth rounding for this state:
even 136 slots need 9,478,656 bytes, exceeding the available memory. Releasing
the old budget claim before its storage is actually retired would falsify
accounting rather than solve the physical overlap. A future improvement needs
an explicit migration-headroom or temporary lower-detail strategy that
preserves usable coverage, and should account for fixed native atlas storage.

The [instrumented run](staggered-growth-observation.json) and an
[uninstrumented run](staggered-growth-current.json) both finish at 208 admitted
pages from 336 desired, with no pending, failed or unresident pages. Both use
42,951,456 atlas bytes and 2 MiB of automatic decoded storage. Resident totals
are 224 and 243 because additional cached pages remain; these totals must not
be confused with current admitted demand. Scheduling differences also affect
read/upload counts, so these runs do not establish performance equivalence.

Production source is unchanged. Research types and builds pass. Both runs use
headless Intel Vulkan at 64 MiB, sixteen mixed sources and ASTC8×8. The before
server contains the diagnostic override; the after server serves current
production source. No commit was made.
