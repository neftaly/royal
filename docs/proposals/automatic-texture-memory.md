# Automatic texture memory: remaining investigations

Status: targeted follow-ups, 2026-09-11. Direct-target refinement, bounded raster
reuse, RGBA atlas growth/shrinking, active-pool redistribution and shared-slot
admission shipped in 0.0.24. Current automatic SVG pages are 512px. These are no
longer implementation proposals; see [texture specifications](../specs/textures-and-virtual-texturing.md)
and [the release record](../../CHANGELOG.md).

## Remaining work and evidence gates

- **Default-budget calibration:** measure peak allocations, frame responsiveness,
  failures and context interruptions on physical A10 Safari, with single and
  multiple roots. The 256 MiB root budget is an allocation estimate, not detected
  free VRAM. Change the default only if those measurements justify it.
- **ETC2 pool resizing:** retain as research until a real compressed-texture
  workload demonstrates a capacity or memory problem. RGBA growth results alone
  do not establish the need or correctness of compressed-copy resizing.
- **Optional prefetch:** require a measured camera-motion benefit alongside peak
  memory and contention costs. Visible coverage and detail retain priority.

Do not reopen the shipped allocator or add application/device-specific policy
without a current failing workload. Preserve authoritative detail, ownership,
context restoration and GPU-budget accounting in any follow-up.

Historical designs and measurements are retained in the
[original memory investigation](archive/automatic-texture-memory-2026-09-08.md)
and [A10 findings](archive/vt-capacity-a10-findings.md). Their old working-tree
statuses and intermediate timings are not current acceptance results.
