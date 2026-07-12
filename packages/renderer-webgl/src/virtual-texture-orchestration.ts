import type { VirtualTexturePageId } from "./virtual-texturing";

export interface VirtualTextureRequestSchedulerState {
  readonly cursor: number;
  readonly frame: number;
  readonly grantsThisFrame: number;
  readonly nextResourceKey?: string;
}

export interface VirtualTextureRequestPageSnapshot {
  readonly claimed: boolean;
  readonly page: VirtualTexturePageId;
  readonly resident: boolean;
  readonly retryBlocked: boolean;
}

export interface VirtualTextureRequestResourceSnapshot {
  readonly allocated: boolean;
  readonly effectiveSlots: number;
  readonly enabled: boolean;
  readonly key: string;
  readonly loadingPages: number;
  readonly pages: readonly VirtualTextureRequestPageSnapshot[];
  readonly pendingUploads: number;
}

export interface VirtualTextureRequestGrant {
  readonly key: string;
  readonly page: VirtualTexturePageId;
}

export interface VirtualTextureRequestPlan {
  readonly grants: readonly VirtualTextureRequestGrant[];
  readonly scheduler: VirtualTextureRequestSchedulerState;
}

type MutableVirtualTextureRequestGrant = {
  key: string;
  page: VirtualTexturePageId;
};

export interface VirtualTextureRequestPlanningWorkspace {
  readonly grants: MutableVirtualTextureRequestGrant[];
  readonly nextPageIndices: number[];
  readonly plan: { grants: readonly VirtualTextureRequestGrant[]; scheduler: VirtualTextureRequestSchedulerState };
  readonly simulatedInFlight: number[];
}

export const createVirtualTextureRequestPlanningWorkspace = (): VirtualTextureRequestPlanningWorkspace => {
  const grants: MutableVirtualTextureRequestGrant[] = [];
  return {
    grants,
    nextPageIndices: [],
    plan: { grants, scheduler: createVirtualTextureRequestScheduler() },
    simulatedInFlight: [],
  };
};

export const createVirtualTextureRequestScheduler = (): VirtualTextureRequestSchedulerState => ({
  cursor: 0,
  frame: -1,
  grantsThisFrame: 0,
});

export const resetVirtualTextureRequestScheduler = createVirtualTextureRequestScheduler;

export const virtualTextureRequestBudgetAvailable = (
  scheduler: VirtualTextureRequestSchedulerState,
  frame: number,
  maxGrantsPerFrame: number,
): boolean => scheduler.frame !== frame
  || scheduler.grantsThisFrame < Math.max(0, Math.floor(maxGrantsPerFrame));

export const beginVirtualTextureRequestFrame = (
  scheduler: VirtualTextureRequestSchedulerState,
  frame: number,
): VirtualTextureRequestSchedulerState => {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("Virtual texture request frame must be non-negative");
  if (frame < scheduler.frame) throw new Error("Virtual texture request frames must be monotonic");
  return frame === scheduler.frame
    ? scheduler
    : {
      cursor: scheduler.cursor,
      frame,
      grantsThisFrame: 0,
      ...(scheduler.nextResourceKey === undefined
        ? {}
        : { nextResourceKey: scheduler.nextResourceKey }),
    };
};

const requestablePageIndex = (
  resource: VirtualTextureRequestResourceSnapshot,
  startIndex: number,
): number | undefined => {
  for (let index = startIndex; index < resource.pages.length; index += 1) {
    const page = resource.pages[index];
    if (
      page !== undefined
      && !page.claimed
      && !page.resident
      && !page.retryBlocked
    ) return index;
  }
  return undefined;
};

/**
 * Plans one frame's fair request grants without starting work. Grants are never
 * refunded: a failed start consumes the same per-frame CPU/network opportunity.
 */
export const planVirtualTexturePageRequests = (
  scheduler: VirtualTextureRequestSchedulerState,
  frame: number,
  resources: readonly VirtualTextureRequestResourceSnapshot[],
  options: {
    readonly maxGrantsPerFrame: number;
    readonly maxInFlightPerResource: number;
  },
): VirtualTextureRequestPlan => planVirtualTexturePageRequestsInto(
  createVirtualTextureRequestPlanningWorkspace(),
  scheduler,
  frame,
  resources,
  options,
);

/** Allocation-reusing variant whose returned plan remains valid until the next call with the workspace. */
export const planVirtualTexturePageRequestsInto = (
  workspace: VirtualTextureRequestPlanningWorkspace,
  scheduler: VirtualTextureRequestSchedulerState,
  frame: number,
  resources: readonly VirtualTextureRequestResourceSnapshot[],
  options: {
    readonly maxGrantsPerFrame: number;
    readonly maxInFlightPerResource: number;
  },
): VirtualTextureRequestPlan => {
  const current = beginVirtualTextureRequestFrame(scheduler, frame);
  const hasEnabledResources = resources.some((resource) => resource.enabled);
  const maxGrants = Number.isSafeInteger(options.maxGrantsPerFrame)
    ? Math.max(0, options.maxGrantsPerFrame)
    : 0;
  const maxInFlight = Number.isSafeInteger(options.maxInFlightPerResource)
    ? Math.max(0, options.maxInFlightPerResource)
    : 0;
  if (!hasEnabledResources || current.grantsThisFrame >= maxGrants || maxInFlight === 0) {
    workspace.grants.length = 0;
    workspace.plan.scheduler = current;
    return workspace.plan;
  }

  const simulatedInFlight = workspace.simulatedInFlight;
  const nextPageIndices = workspace.nextPageIndices;
  simulatedInFlight.length = resources.length;
  nextPageIndices.length = resources.length;
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index]!;
    simulatedInFlight[index] = Math.max(0, resource.loadingPages) + Math.max(0, resource.pendingUploads);
    nextPageIndices[index] = 0;
  }
  const grants = workspace.grants;
  let grantCount = 0;
  const anchoredCursor = current.nextResourceKey === undefined
    ? -1
    : resources.findIndex((resource) => resource.key === current.nextResourceKey);
  let cursor = anchoredCursor >= 0 ? anchoredCursor : current.cursor % resources.length;
  let scansWithoutProgress = 0;
  let grantsThisFrame = current.grantsThisFrame;

  while (grantsThisFrame < maxGrants && scansWithoutProgress < resources.length) {
    const resourceIndex = cursor;
    const resource = resources[resourceIndex];
    cursor = (cursor + 1) % resources.length;
    if (resource === undefined || !resource.enabled || !resource.allocated) {
      scansWithoutProgress += 1;
      continue;
    }
    const resourceLimit = Math.min(Math.max(1, resource.effectiveSlots), maxInFlight);
    if ((simulatedInFlight[resourceIndex] ?? 0) >= resourceLimit) {
      scansWithoutProgress += 1;
      continue;
    }
    const pageIndex = requestablePageIndex(resource, nextPageIndices[resourceIndex] ?? 0);
    if (pageIndex === undefined) {
      scansWithoutProgress += 1;
      continue;
    }
    const page = resource.pages[pageIndex];
    if (page === undefined) throw new Error("Virtual texture request page snapshot changed during planning");

    nextPageIndices[resourceIndex] = pageIndex + 1;
    simulatedInFlight[resourceIndex] = (simulatedInFlight[resourceIndex] ?? 0) + 1;
    let grant = grants[grantCount];
    if (grant === undefined) {
      grant = { key: resource.key, page: page.page };
      grants.push(grant);
    } else {
      grant.key = resource.key;
      grant.page = page.page;
    }
    grantCount += 1;
    grantsThisFrame += 1;
    scansWithoutProgress = 0;
  }

  const nextResourceKey = resources[cursor]?.key;
  grants.length = grantCount;
  workspace.plan.scheduler = {
    cursor,
    frame,
    grantsThisFrame,
    ...(nextResourceKey === undefined ? {} : { nextResourceKey }),
  };
  return workspace.plan;
};
