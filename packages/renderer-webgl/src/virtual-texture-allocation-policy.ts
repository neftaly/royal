import type { VirtualTextureManifestModel } from "./virtual-texturing";

export const VIRTUAL_TEXTURE_COLD_ALLOCATION_GRACE_FRAMES = 2;

/** Largest page-table write that admission must fit into one upload chunk. */
export const maximumVirtualTexturePageTableUploadBytes = (
  manifest: VirtualTextureManifestModel,
  generated: boolean,
): number => {
  const width = Math.ceil(manifest.width / manifest.pageSize);
  const height = Math.ceil(manifest.height / manifest.pageSize);
  if (generated || manifest.uriTemplate !== undefined) return width * height * 4;
  let maximum = 0;
  for (const page of manifest.pages) {
    const coverage = 2 ** page.mip;
    const x = page.x * coverage;
    const y = page.y * coverage;
    const updateWidth = Math.max(0, Math.min(width, x + coverage) - x);
    const updateHeight = Math.max(0, Math.min(height, y + coverage) - y);
    maximum = Math.max(maximum, updateWidth * updateHeight * 4);
  }
  return maximum;
};

export type VirtualTextureAllocationCandidate<State> = {
  readonly admissionTicket: number;
  readonly allocated: boolean;
  readonly demanded: boolean;
  readonly lastDemandFrame: number;
  readonly state: State;
};

export type VirtualTextureAllocationReclamation<State> = {
  readonly graceBlocked: boolean;
  readonly state?: State;
};

/** Selects the least-recently demanded reclaimable allocation without side effects. */
export const selectColdVirtualTextureAllocation = <State>(
  candidates: Iterable<VirtualTextureAllocationCandidate<State>>,
  frame: number,
  graceFrames = VIRTUAL_TEXTURE_COLD_ALLOCATION_GRACE_FRAMES,
): VirtualTextureAllocationReclamation<State> => {
  let graceBlocked = false;
  let oldest: VirtualTextureAllocationCandidate<State> | undefined;
  for (const candidate of candidates) {
    if (candidate.demanded || !candidate.allocated) continue;
    const demandAge = frame - candidate.lastDemandFrame;
    if (
      candidate.lastDemandFrame !== Number.NEGATIVE_INFINITY
      && demandAge <= graceFrames
    ) {
      graceBlocked = true;
      continue;
    }
    if (
      oldest === undefined
      || candidate.lastDemandFrame < oldest.lastDemandFrame
      || (
        candidate.lastDemandFrame === oldest.lastDemandFrame
        && candidate.admissionTicket < oldest.admissionTicket
      )
    ) oldest = candidate;
  }
  return oldest === undefined
    ? { graceBlocked }
    : { graceBlocked, state: oldest.state };
};
