# Coarse page-table GPU eviction review

The retained runtime passes a stronger GPU regression without a production
change. The capped replacement fixture now has an optional `?coarse` variant:
a 512×256 virtual texture with two table levels, and capacity-limited reads of
mip-1 pages. Fine logical pages inherit these coarse residents. ASTC 6×6/8×8,
byte/slot caps, both scene orders, late neighbor admission and context
restoration remain covered.

An initial color-only version passed even when an isolated control omitted
coarse rebuild uploads. Fine table entries could still supply the rendered
colors, so that version did not establish that the coarse GPU table was current.
The enhanced fixture retains the CPU mip-1 views observed at upload and reads
back each GPU table's mip-1 framebuffer attachment after every view transition.
It compares all eight bytes for each of the two tables and restores the previous
read framebuffer afterward. CPU views intentionally remain live as the runtime
rebuilds them; the independent CPU table oracle is tested separately.

All eight [enhanced cases](table-mips-coarse-readback.json) pass: 48 views,
144 color samples and 96 CPU/GPU coarse-table comparisons. Each case ends with
three residents and ten uploads, then survives 100 updates without extra page
reads or uploads. Disposal releases tracked GPU budget.

The broad [control](table-mips-coarse-readback-control.json) fails on a missing
initial coarse upload. A more focused [eviction control](table-mips-evicted-control.json)
preserves initial uploads, then omits coarse rebuilds only after a table held
resident mappings. It fails on actual stale GPU data: the left coarse cell
remains resident while the CPU table has cleared it and mapped the right cell.
Both controls stop in the first ASTC6×6 byte-cap case; later control cases are
not claimed. Neither control modifies production source.

Research typechecking and builds pass. All eight [original single-mip cases](table-mips-fine-eviction.json)
also pass with the extended fixture. This uses headless Intel Vulkan and adds
readback stalls and temporary diagnostic objects, so it is not a performance or
GC benchmark. [Validation hashes](table-mips-coarse-validation.json).
No commit was made.
