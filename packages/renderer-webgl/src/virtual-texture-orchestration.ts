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

export const createVirtualTextureRequestScheduler = (): VirtualTextureRequestSchedulerState => ({
  cursor: 0,
  frame: -1,
  grantsThisFrame: 0,
});

export const resetVirtualTextureRequestScheduler = createVirtualTextureRequestScheduler;

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
  grantedPageIndices: ReadonlySet<number>,
): number | undefined => {
  for (let index = 0; index < resource.pages.length; index += 1) {
    const page = resource.pages[index];
    if (
      page !== undefined
      && !grantedPageIndices.has(index)
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
    return {
      grants: [],
      scheduler: current,
    };
  }

  const simulatedInFlight = resources.map((resource) =>
    Math.max(0, resource.loadingPages) + Math.max(0, resource.pendingUploads));
  const grantedPageIndices = resources.map(() => new Set<number>());
  const grants: VirtualTextureRequestGrant[] = [];
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
    const pageIndex = requestablePageIndex(resource, grantedPageIndices[resourceIndex]!);
    if (pageIndex === undefined) {
      scansWithoutProgress += 1;
      continue;
    }
    const page = resource.pages[pageIndex];
    if (page === undefined) throw new Error("Virtual texture request page snapshot changed during planning");

    grantedPageIndices[resourceIndex]!.add(pageIndex);
    simulatedInFlight[resourceIndex] = (simulatedInFlight[resourceIndex] ?? 0) + 1;
    grants.push({ key: resource.key, page: page.page });
    grantsThisFrame += 1;
    scansWithoutProgress = 0;
  }

  const nextResourceKey = resources[cursor]?.key;
  return {
    grants,
    scheduler: {
      cursor,
      frame,
      grantsThisFrame,
      ...(nextResourceKey === undefined ? {} : { nextResourceKey }),
    },
  };
};

export type VirtualTexturePageRetryState =
  | { readonly attempts: number; readonly kind: "eligible" }
  | { readonly attempts: number; readonly delayMs: number; readonly kind: "scheduled" }
  | { readonly attempts: number; readonly kind: "terminal" };

export const createVirtualTexturePageRetryState = (): VirtualTexturePageRetryState => ({
  attempts: 0,
  kind: "eligible",
});

export const failVirtualTexturePageRetry = (
  state: VirtualTexturePageRetryState,
  options: { readonly baseDelayMs: number; readonly maxRetries: number },
): VirtualTexturePageRetryState => {
  if (state.kind === "terminal") return state;
  const maxRetries = Number.isSafeInteger(options.maxRetries) ? Math.max(0, options.maxRetries) : 0;
  if (state.attempts >= maxRetries) return { attempts: state.attempts, kind: "terminal" };
  const baseDelayMs = Number.isFinite(options.baseDelayMs) ? Math.max(0, options.baseDelayMs) : 0;
  return {
    attempts: state.attempts + 1,
    delayMs: baseDelayMs * (2 ** state.attempts),
    kind: "scheduled",
  };
};

export const elapseVirtualTexturePageRetry = (
  state: VirtualTexturePageRetryState,
): VirtualTexturePageRetryState => state.kind === "scheduled"
  ? { attempts: state.attempts, kind: "eligible" }
  : state;

export const terminateVirtualTexturePageRetry = (
  state: VirtualTexturePageRetryState,
): VirtualTexturePageRetryState => state.kind === "terminal"
  ? state
  : { attempts: state.attempts, kind: "terminal" };

export const resetVirtualTexturePageRetry = createVirtualTexturePageRetryState;
