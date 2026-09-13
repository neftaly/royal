# Idle-scan scheduler: contention and restoration regression

The retained scheduler optimization passes four additional headless host-GPU
cases: ASTC 6×6 and 8×8 previews, each with simultaneous large PNG requests in
both scene orders. Each case loses and restores its WebGL context while one
4096px source is waiting for the shared 64 MiB decoded-source budget.

The browser used Intel Iris Xe through ANGLE Vulkan. The built source-map runtime
matches the working source SHA-256 recorded as `after` in
[idle-scan-sources.json](idle-scan-sources.json).

| Preview | Retained bytes while waiting | Bytes after promotion |
| --- | ---: | ---: |
| ASTC 6×6 | 50,326,500 | 50,325,668 |
| ASTC 8×8 | 50,325,604 | 50,325,220 |

Both scene orders produce the same accounting. The first eligible source wins
in these runs; this observation is not an ordering guarantee. The other source
keeps its preview without starting a second full-raster fetch while capacity is
occupied. Restoration preserves the waiting snapshot except for one additional
page request and upload, and performs no additional source fetches.

Removing the winner lets the waiting source fetch and become resident without
changing its version. Each case has exactly four source reads: two previews and
two full rasters. Promotion ends with one resident page and no failed, pending
or unresident pages. Clearing the scene returns decoded-source bytes, resource
count, atlas bytes, pending pages and resident pages to zero. Final pixel checks
match the blue full raster.

This checks that avoiding redundant unsuccessful scans does not prevent work
from resuming after context restoration or memory release. It is a functional
regression run, not an isolated timing, GC or peak process-memory benchmark.
No production changes or budget increases were needed.

Results: [normal order](idle-scan-contention.json),
[reversed order](idle-scan-contention-reverse.json).
