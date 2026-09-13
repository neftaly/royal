# Retained source and size cost

Relative to HEAD `56130d34`, the retained uncommitted renderer changes add 101
net textual source lines across 12 existing files. The count includes comments
and formatting. There are no untracked production renderer source files omitted
from the count. Research harnesses, measurements, documentation and tests are
outside it. Native ASTC/BC/ETC2 support already committed in HEAD is not counted
again as part of this delta.

The largest increases are in preview lifetime/runtime integration and browser
decoding, while demand simplification removes 56 net lines. These changes cover
explicit raster preview metadata, deferred authority loading, memory reservation,
failure cleanup and retained performance/correctness fixes. They are not merely
additional native-format enum entries. Rejected allocation experiments remain
only as research patches and reports.

The existing size ceilings relative to HEAD allow 192 additional gzip bytes in
the initial graph, 1,256 in lazy code, 256 in workers and 1,512 in total deployed
JavaScript. The renderer package ceiling allows 4,944 additional bytes. These
are ceiling differences, not measured artifact growth. Current packed consumers
and bundle checks pass those limits; this audit adds no allowances.

The audit also corrected one existing GPU validation diagnostic from
`Royal ETC2 KTX2 storage color space...` to `Royal KTX2 storage color space...`,
because the check handles ASTC and BC as well as ETC2. It changes no branches,
allocation behavior or source-line count. All 42 native-texture tests pass after
the message correction. The research browser build was refreshed afterward.

[The machine-readable snapshot](retained-code-cost.json) includes per-file counts
and all compared ceilings. The figure is an audit of this uncommitted checkpoint,
not a guarantee that future changes will preserve the same total. Everything
remains uncommitted.
