# Native container retention gap

Update: the [compaction fix](native-page-compaction-review.md) now bounds returned
block storage and proves that original response buffers can be collected. The
following records the original finding.

The original diagnostic probe (now a [regression test](../../tests/replacement/renderer-webgl-vt-runtime.test.ts)) passes for all
six supported native formats, confirming the current behavior rather than the
desired final contract. Each fixture has a structurally valid one-mip 144×144
KTX2 container plus 1 MiB trailing data. The real browser-page-source function
accepts it and returns a block view retaining the entire Response body buffer.
Its block byteLength remains 5,184–20,736 bytes, but its backing buffer includes
all the additional 1 MiB. The fetch is mocked using a real Response; no GPU or
memory-profiler inference is required to observe the returned buffer size.

The native parser intentionally returns views into the supplied container. The
page adapter currently forwards those views unchanged. Runtime pending-page
reservations use virtualTexturePageBytes(manifest), which counts only compressed
blocks. Therefore atypically padded page containers can retain substantially
more queued CPU storage than the nominal pending-page reservation. Ordinary
headers already add a small difference; arbitrary trailing data amplifies it.
The fixed four-job limit still bounds object count, but not this byte discrepancy.

This is an unresolved accounting/retention limitation, not a fixed issue. The
probe is research-only and must not be treated as a regression requiring this
behavior to remain. The next step is to compare compact block copies against
retained views in the page adapter. Unconditional copying makes returned backing
storage exact but adds work to every page; conditional compaction preserves the
ordinary path but needs a clearly justified overhead bound. Rejecting arbitrary
container layouts risks unnecessary compatibility restrictions. Any compaction
only limits retained decoded storage: it cannot undo peak response-body memory
already allocated during Fetch.

All six diagnostic cases and research typechecking pass. Production files remain
unchanged and no commits were made.
