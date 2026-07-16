import type { VirtualTextureDemandSubmission } from "./demand";
import { virtualTexturePageKey, type VirtualTexturePageId } from "./model";

const MAX_POOLED_RESOURCES = 64;
const MAX_POOLED_VIEWS = 256;
// This bounds transient collection evidence, including the after-cursor and
// wrap windows. It does not allocate physical atlas slots or request pages.
export const VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_PAGES = 128;
export const VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCES = 64;
export const VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_VIEWS = 8;
export const VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_TOTAL_PAGES =
  VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCES * VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_PAGES;

type MutableViewDemand = {
  readonly candidates: Map<string, VirtualTexturePageId>;
  readonly candidateOutput: VirtualTexturePageId[];
  readonly cursor: { index: number; signature: string };
  cursorPresent: boolean;
  readonly cursorUpdate: MutablePreferenceCursorUpdate;
  readonly nonconvergentCandidates: Map<string, VirtualTexturePageId>;
  preferTargetMip: boolean;
  readonly preferredAfterCursor: Map<string, PreferredItem>;
  readonly preferredAfterOutput: PreferredItem[];
  readonly preferredOutput: VirtualTexturePageId[];
  readonly preferredWrap: Map<string, PreferredItem>;
  readonly preferredWrapOutput: PreferredItem[];
  readonly selectedKeys: Set<string>;
  readonly submission: {
    candidates: readonly VirtualTexturePageId[];
    preferTargetMip: boolean;
    preferredCandidates?: readonly VirtualTexturePageId[];
    viewportDominant?: true;
  };
  readonly uniqueKeys: Set<string>;
  viewportDominant: boolean;
};

type PreferredItem = {
  index: number;
  page: VirtualTexturePageId;
  signature: string;
};

type PreferredCursor = Pick<PreferredItem, "index" | "signature">;

type MutablePreferenceCursorUpdate = {
  next: PreferredCursor;
  viewIndex: number;
};

type MutableResourceDemand<K> = {
  capacity: number;
  commit?: MutableVirtualTextureFrameDemandCommit<K>;
  readonly nonconvergentCandidates: Map<string, VirtualTexturePageId>;
  readonly nonconvergentOutput: VirtualTexturePageId[];
  order: number;
  readonly orderedViewIndices: number[];
  readonly preferenceCursorUpdates: MutablePreferenceCursorUpdate[];
  resource?: K;
  readonly submissions: VirtualTextureDemandSubmission[];
  viewCursor: number;
  viewportDominant: boolean;
  readonly views: Map<number, MutableViewDemand>;
};

export interface VirtualTextureFrameDemandWorkspace<K> {
  active: boolean;
  readonly availableViews: MutableViewDemand[];
  readonly commits: VirtualTextureFrameDemandCommit<K>[];
  readonly orderedResources: MutableResourceDemand<K>[];
  readonly preferenceCursors: Map<K, Map<number, PreferredCursor>>;
  resourcePoolIndex: number;
  resourceCursor: number;
  readonly resourcePool: Array<MutableResourceDemand<K>>;
  readonly resources: Map<K, MutableResourceDemand<K>>;
  readonly viewCursors: Map<K, number>;
  viewPoolIndex: number;
  readonly viewPool: MutableViewDemand[];
}

export interface VirtualTextureFrameDemandCommit<K> {
  readonly nextStartSubmission: number;
  readonly nonconvergentCandidates: readonly VirtualTexturePageId[];
  readonly preferenceCursorUpdates: readonly {
    readonly next: PreferredCursor;
    readonly viewIndex: number;
  }[];
  readonly resource: K;
  readonly startSubmission: number;
  readonly submissions: readonly VirtualTextureDemandSubmission[];
  readonly resourceCursorUpdate?: number;
  readonly viewCursorUpdate?: number;
}

type MutableVirtualTextureFrameDemandCommit<K> = {
  -readonly [Key in keyof VirtualTextureFrameDemandCommit<K>]: VirtualTextureFrameDemandCommit<K>[Key];
};

const EMPTY_FRAME_DEMAND_COMMITS: readonly VirtualTextureFrameDemandCommit<never>[] = Object.freeze([]);

export const createVirtualTextureFrameDemandWorkspace = <K>(): VirtualTextureFrameDemandWorkspace<K> => ({
  active: false,
  availableViews: [],
  commits: [],
  orderedResources: [],
  preferenceCursors: new Map(),
  resourcePool: [],
  resourcePoolIndex: 0,
  resourceCursor: -1,
  resources: new Map(),
  viewCursors: new Map(),
  viewPool: [],
  viewPoolIndex: 0,
});

export const beginVirtualTextureFrameDemand = <K>(workspace: VirtualTextureFrameDemandWorkspace<K>): void => {
  workspace.commits.length = 0;
  workspace.orderedResources.length = 0;
  workspace.resources.clear();
  workspace.resourcePoolIndex = 0;
  workspace.availableViews.length = 0;
  workspace.viewPoolIndex = 0;
  workspace.active = true;
};

const compareSignature = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const comparePreferredItems = (left: PreferredItem, right: PreferredItem): number =>
  compareSignature(left.signature, right.signature) || left.index - right.index;

const comparePreferredPosition = (
  signature: string,
  index: number,
  cursor: PreferredCursor,
): number => compareSignature(signature, cursor.signature) || index - cursor.index;

const reserveBoundedPreferredItem = (
  target: Map<string, PreferredItem>,
  key: string,
  signature: string,
  index: number,
  limit: number,
): boolean => {
  if (limit <= 0 || target.has(key)) return false;
  if (target.size < limit) return true;
  let greatest: readonly [string, PreferredItem] | undefined;
  for (const entry of target) {
    if (greatest === undefined || comparePreferredItems(entry[1], greatest[1]) > 0) greatest = entry;
  }
  const greatestItem = greatest![1];
  if (comparePreferredPosition(signature, index, greatestItem) >= 0) return false;
  target.delete(greatest![0]);
  return true;
};

const clearViewEvidence = (view: MutableViewDemand): void => {
  view.candidates.clear();
  view.nonconvergentCandidates.clear();
  view.preferTargetMip = false;
  view.preferredAfterCursor.clear();
  view.preferredWrap.clear();
  view.viewportDominant = false;
};

const clearView = (view: MutableViewDemand): void => {
  clearViewEvidence(view);
  view.candidateOutput.length = 0;
  view.cursorPresent = false;
  view.preferredAfterOutput.length = 0;
  view.preferredOutput.length = 0;
  view.preferredWrapOutput.length = 0;
  view.selectedKeys.clear();
  delete view.submission.preferredCandidates;
  delete view.submission.viewportDominant;
  view.uniqueKeys.clear();
};

const acquireView = <K>(workspace: VirtualTextureFrameDemandWorkspace<K>): MutableViewDemand => {
  const available = workspace.availableViews.pop();
  if (available !== undefined) return available;
  let view = workspace.viewPool[workspace.viewPoolIndex];
  if (view === undefined) {
    view = {
      candidates: new Map(),
      candidateOutput: [],
      cursor: { index: 0, signature: "" },
      cursorPresent: false,
      cursorUpdate: { next: { index: 0, signature: "" }, viewIndex: 0 },
      nonconvergentCandidates: new Map(),
      preferTargetMip: false,
      preferredAfterCursor: new Map(),
      preferredAfterOutput: [],
      preferredOutput: [],
      preferredWrap: new Map(),
      preferredWrapOutput: [],
      selectedKeys: new Set(),
      submission: { candidates: [], preferTargetMip: false },
      uniqueKeys: new Set(),
      viewportDominant: false,
    };
    workspace.viewPool.push(view);
  } else clearView(view);
  workspace.viewPoolIndex += 1;
  return view;
};

const releaseResourceViews = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  resource: MutableResourceDemand<K>,
): void => {
  for (const view of resource.views.values()) {
    clearView(view);
    workspace.availableViews.push(view);
  }
  resource.views.clear();
};

const evidenceLimits = <K>(
  resource: MutableResourceDemand<K>,
): { readonly candidates: number; readonly nonconvergent: number; readonly preferred: number } => {
  const { viewportDominant } = resource;
  const resourceEvidence = viewportDominant
    ? VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_PAGES
    : VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_PAGES / 2;
  const evidence = Math.floor(resourceEvidence / resource.views.size);
  // A viewport-dominant surface preserves a broad quality window. Ordinary
  // draws retain the established compact hierarchy and terminal evidence.
  const candidates = Math.min(
    resource.capacity,
    Math.max(1, Math.ceil(evidence / (viewportDominant ? 4 : 2))),
  );
  const nonconvergent = Math.min(
    resource.capacity,
    viewportDominant ? Math.floor(evidence / 16) : Math.floor((evidence - candidates) / 3),
  );
  return {
    candidates,
    nonconvergent,
    preferred: Math.min(
      resource.capacity,
      Math.floor((evidence - candidates - nonconvergent) / 2),
    ),
  };
};

const rebalanceEvidence = <K>(resource: MutableResourceDemand<K>): void => {
  const limits = evidenceLimits(resource);
  for (const view of resource.views.values()) {
    while (view.candidates.size > limits.candidates) {
      let lastKey: string | undefined;
      for (const key of view.candidates.keys()) lastKey = key;
      view.candidates.delete(lastKey!);
    }
    while (view.nonconvergentCandidates.size > limits.nonconvergent) {
      let lastKey: string | undefined;
      for (const key of view.nonconvergentCandidates.keys()) lastKey = key;
      view.nonconvergentCandidates.delete(lastKey!);
    }
    while (view.preferredAfterCursor.size > limits.preferred) {
      let greatest: readonly [string, PreferredItem] | undefined;
      for (const entry of view.preferredAfterCursor) {
        if (greatest === undefined || comparePreferredItems(entry[1], greatest[1]) > 0) greatest = entry;
      }
      view.preferredAfterCursor.delete(greatest![0]);
    }
    while (view.preferredWrap.size > limits.preferred) {
      let greatest: readonly [string, PreferredItem] | undefined;
      for (const entry of view.preferredWrap) {
        if (greatest === undefined || comparePreferredItems(entry[1], greatest[1]) > 0) greatest = entry;
      }
      view.preferredWrap.delete(greatest![0]);
    }
  }
};

const cyclicViewDistance = (viewIndex: number, cursor: number): number => {
  if (cursor < 0) return viewIndex + 1;
  return viewIndex > cursor
    ? viewIndex - cursor
    : Number.MAX_SAFE_INTEGER - cursor + viewIndex + 1;
};

const cyclicOrderDistance = cyclicViewDistance;

const retainedView = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  demand: MutableResourceDemand<K>,
  viewIndex: number,
): MutableViewDemand | undefined => {
  const current = demand.views.get(viewIndex);
  if (current !== undefined) return current;
  if (demand.views.size < VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_VIEWS) {
    const view = acquireView(workspace);
    demand.views.set(viewIndex, view);
    rebalanceEvidence(demand);
    return view;
  }
  let worstIndex: number | undefined;
  let worstView: MutableViewDemand | undefined;
  for (const [candidateIndex, candidateView] of demand.views) {
    if (
      worstIndex === undefined
      || cyclicViewDistance(candidateIndex, demand.viewCursor)
        > cyclicViewDistance(worstIndex, demand.viewCursor)
    ) {
      worstIndex = candidateIndex;
      worstView = candidateView;
    }
  }
  if (
    cyclicViewDistance(viewIndex, demand.viewCursor)
      >= cyclicViewDistance(worstIndex!, demand.viewCursor)
  ) return undefined;
  demand.views.delete(worstIndex!);
  clearView(worstView!);
  demand.views.set(viewIndex, worstView!);
  return worstView;
};

export const submitVirtualTextureFrameDemand = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  resource: K,
  resourceOrder: number,
  viewIndex: number,
  capacity: number,
  submission: VirtualTextureDemandSubmission,
  nonconvergentCandidates: readonly VirtualTexturePageId[] = [],
): void => {
  if (!workspace.active) throw new Error("Virtual texture frame-demand collection is not active");
  if (!Number.isSafeInteger(viewIndex) || viewIndex < 0) {
    throw new Error("Virtual texture demand view index must be a non-negative integer");
  }
  if (!Number.isSafeInteger(resourceOrder) || resourceOrder < 0) {
    throw new Error("Virtual texture frame-demand resource order must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error("Virtual texture frame-demand capacity must be a positive safe integer");
  }
  let resourceDemand = workspace.resources.get(resource);
  if (resourceDemand === undefined) {
    if (workspace.resources.size >= VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCES) {
      let worst: MutableResourceDemand<K> | undefined;
      for (const candidate of workspace.resources.values()) {
        if (
          worst === undefined
          || cyclicOrderDistance(candidate.order, workspace.resourceCursor)
            > cyclicOrderDistance(worst.order, workspace.resourceCursor)
        ) worst = candidate;
      }
      if (
        cyclicOrderDistance(resourceOrder, workspace.resourceCursor)
          >= cyclicOrderDistance(worst!.order, workspace.resourceCursor)
      ) return;
      workspace.resources.delete(worst!.resource!);
      releaseResourceViews(workspace, worst!);
      resourceDemand = worst;
    } else {
      resourceDemand = workspace.resourcePool[workspace.resourcePoolIndex];
      if (resourceDemand === undefined) {
        resourceDemand = {
          capacity,
          nonconvergentCandidates: new Map(),
          nonconvergentOutput: [],
          order: resourceOrder,
          orderedViewIndices: [],
          preferenceCursorUpdates: [],
          resource,
          submissions: [],
          viewCursor: workspace.viewCursors.get(resource) ?? -1,
          viewportDominant: false,
          views: new Map(),
        };
        workspace.resourcePool.push(resourceDemand);
      }
      workspace.resourcePoolIndex += 1;
    }
    const retainedResource = resourceDemand!;
    retainedResource.capacity = capacity;
    retainedResource.order = resourceOrder;
    retainedResource.resource = resource;
    retainedResource.viewCursor = workspace.viewCursors.get(resource) ?? -1;
    retainedResource.viewportDominant = false;
    retainedResource.views.clear();
    workspace.resources.set(resource, retainedResource);
    resourceDemand = retainedResource;
  } else if (resourceDemand.capacity !== capacity || resourceDemand.order !== resourceOrder) {
    throw new Error("Virtual texture frame-demand resource contract changed during collection");
  }
  const activeResource = resourceDemand!;
  const viewDemand = retainedView(workspace, activeResource, viewIndex);
  if (viewDemand === undefined) return;
  if (submission.viewportDominant === true && !viewDemand.viewportDominant) {
    viewDemand.viewportDominant = true;
    activeResource.viewportDominant = true;
    rebalanceEvidence(activeResource);
  }
  const limits = evidenceLimits(activeResource);
  for (const page of submission.candidates) {
    if (viewDemand.candidates.size >= limits.candidates) break;
    viewDemand.candidates.set(virtualTexturePageKey(page), page);
  }
  for (const page of nonconvergentCandidates) {
    if (viewDemand.nonconvergentCandidates.size >= limits.nonconvergent) break;
    viewDemand.nonconvergentCandidates.set(virtualTexturePageKey(page), page);
  }
  viewDemand.preferTargetMip ||= submission.preferTargetMip;
  if (!submission.preferTargetMip || limits.preferred === 0) return;
  const cursor = workspace.preferenceCursors.get(resource)?.get(viewIndex);
  const preferred = submission.preferredCandidates ?? submission.candidates;
  const targetMip = submission.preferredCandidates === undefined ? preferred.at(-1)?.mip : undefined;
  let signature = "";
  for (const page of preferred) {
    if (targetMip !== undefined && page.mip !== targetMip) continue;
    if (signature.length > 0) signature += "|";
    signature += virtualTexturePageKey(page);
  }
  let preferredIndex = 0;
  for (const page of preferred) {
    if (targetMip !== undefined && page.mip !== targetMip) continue;
    const index = preferredIndex;
    preferredIndex += 1;
    const key = `${signature}#${String(index).padStart(3, "0")}`;
    const retainWrap = reserveBoundedPreferredItem(
      viewDemand.preferredWrap,
      key,
      signature,
      index,
      limits.preferred,
    );
    const retainAfter = (cursor === undefined || comparePreferredPosition(signature, index, cursor) > 0)
      && reserveBoundedPreferredItem(
      viewDemand.preferredAfterCursor,
      key,
      signature,
      index,
      limits.preferred,
    );
    if (!retainWrap && !retainAfter) continue;
    const item = { index, page, signature };
    if (retainWrap) viewDemand.preferredWrap.set(key, item);
    if (retainAfter) viewDemand.preferredAfterCursor.set(key, item);
  }
};

const appendOrderedPreferredItems = (
  view: MutableViewDemand,
  items: readonly PreferredItem[],
  limit: number,
  capacity: number,
  selectedCount: number,
): number => {
  for (const item of items) {
    if (view.preferredOutput.length >= limit) break;
    const key = virtualTexturePageKey(item.page);
    if (view.uniqueKeys.has(key)) continue;
    view.uniqueKeys.add(key);
    view.preferredOutput.push(item.page);
    if (selectedCount < capacity && !view.selectedKeys.has(key)) {
      view.selectedKeys.add(key);
      selectedCount += 1;
      view.cursor.index = view.viewportDominant ? item.index : Number.MAX_SAFE_INTEGER;
      view.cursor.signature = item.signature;
      view.cursorPresent = true;
    }
  }
  return selectedCount;
};

const orderPreferredCandidates = (
  view: MutableViewDemand,
  capacity: number,
): void => {
  // The fallback candidate can itself be the first preferred page, so retain
  // `capacity` preferred entries to still expose `capacity - 1` distinct
  // refinements after global deduplication.
  const limit = Math.min(
    Math.max(0, capacity),
    Math.max(view.preferredAfterCursor.size, view.preferredWrap.size),
  );
  view.preferredAfterOutput.length = 0;
  for (const item of view.preferredAfterCursor.values()) view.preferredAfterOutput.push(item);
  view.preferredAfterOutput.sort(comparePreferredItems);
  view.preferredWrapOutput.length = 0;
  for (const item of view.preferredWrap.values()) view.preferredWrapOutput.push(item);
  view.preferredWrapOutput.sort(comparePreferredItems);
  view.preferredOutput.length = 0;
  view.uniqueKeys.clear();
  view.selectedKeys.clear();
  view.cursorPresent = false;
  const fallback = view.candidates.values().next().value;
  let selectedCount = 0;
  if (fallback !== undefined) {
    view.selectedKeys.add(virtualTexturePageKey(fallback));
    selectedCount = 1;
  }
  selectedCount = appendOrderedPreferredItems(
    view,
    view.preferredAfterOutput,
    limit,
    capacity,
    selectedCount,
  );
  appendOrderedPreferredItems(
    view,
    view.preferredWrapOutput,
    limit,
    capacity,
    selectedCount,
  );
};

const releasePools = <K>(workspace: VirtualTextureFrameDemandWorkspace<K>): void => {
  workspace.resources.clear();
  for (let index = 0; index < workspace.resourcePoolIndex; index += 1) {
    const pooled = workspace.resourcePool[index];
    if (pooled === undefined) continue;
    delete pooled.resource;
    pooled.views.clear();
  }
  for (let index = 0; index < workspace.viewPoolIndex; index += 1) {
    const pooled = workspace.viewPool[index];
    if (pooled !== undefined) clearViewEvidence(pooled);
  }
  workspace.resourcePool.length = Math.min(workspace.resourcePool.length, MAX_POOLED_RESOURCES);
  workspace.viewPool.length = Math.min(workspace.viewPool.length, MAX_POOLED_VIEWS);
  workspace.availableViews.length = 0;
};

export const resetVirtualTextureFrameDemand = <K>(workspace: VirtualTextureFrameDemandWorkspace<K>): void => {
  workspace.active = false;
  releasePools(workspace);
};

export const releaseVirtualTextureFrameDemandResource = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  resource: K,
): void => {
  workspace.resources.delete(resource);
  workspace.preferenceCursors.delete(resource);
  workspace.viewCursors.delete(resource);
  for (const pooled of workspace.resourcePool) {
    if (pooled.commit?.resource === resource) delete pooled.commit;
  }
};

export const finalizeVirtualTextureFrameDemand = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  commit: boolean,
  cursorFor: (resource: K) => number,
): readonly VirtualTextureFrameDemandCommit<K>[] => {
  if (!workspace.active) throw new Error("Virtual texture frame-demand collection is not active");
  workspace.active = false;
  if (!commit) {
    releasePools(workspace);
    return EMPTY_FRAME_DEMAND_COMMITS;
  }
  if (workspace.resources.size === 0) {
    releasePools(workspace);
    return EMPTY_FRAME_DEMAND_COMMITS;
  }
  const commits = workspace.commits;
  const retainedResources = workspace.orderedResources;
  for (const resource of workspace.resources.values()) retainedResources.push(resource);
  retainedResources.sort((left, right) => (
    cyclicOrderDistance(left.order, workspace.resourceCursor)
    - cyclicOrderDistance(right.order, workspace.resourceCursor)
  ));
  const resourceCursorUpdate = retainedResources.at(-1)!.order;
  for (const resourceDemand of retainedResources) {
    const resource = resourceDemand.resource;
    if (resource === undefined) continue;
    const viewIndices = resourceDemand.orderedViewIndices;
    viewIndices.length = 0;
    for (const viewIndex of resourceDemand.views.keys()) viewIndices.push(viewIndex);
    viewIndices.sort((left, right) => left - right);
    const nonconvergentCandidates = resourceDemand.nonconvergentCandidates;
    nonconvergentCandidates.clear();
    for (const view of resourceDemand.views.values()) {
      for (const [key, page] of view.nonconvergentCandidates) nonconvergentCandidates.set(key, page);
    }
    const nonconvergentOutput = resourceDemand.nonconvergentOutput;
    nonconvergentOutput.length = 0;
    for (const page of nonconvergentCandidates.values()) nonconvergentOutput.push(page);
    const preferenceCursorUpdates = resourceDemand.preferenceCursorUpdates;
    preferenceCursorUpdates.length = 0;
    const submissions = resourceDemand.submissions;
    submissions.length = 0;
    for (const viewIndex of viewIndices) {
      const view = resourceDemand.views.get(viewIndex)!;
      orderPreferredCandidates(view, resourceDemand.capacity);
      if (view.cursorPresent) {
        view.cursorUpdate.next = view.cursor;
        view.cursorUpdate.viewIndex = viewIndex;
        preferenceCursorUpdates.push(view.cursorUpdate);
      }
      view.candidateOutput.length = 0;
      for (const page of view.candidates.values()) view.candidateOutput.push(page);
      view.submission.candidates = view.candidateOutput;
      view.submission.preferTargetMip = view.preferTargetMip;
      if (!view.preferTargetMip || view.preferredOutput.length === 0) {
        delete view.submission.preferredCandidates;
      } else view.submission.preferredCandidates = view.preferredOutput;
      if (view.viewportDominant) view.submission.viewportDominant = true;
      else delete view.submission.viewportDominant;
      submissions.push(view.submission);
    }
    const startSubmission = submissions.length <= 1
      ? 0
      : Math.max(0, cursorFor(resource)) % submissions.length;
    let lastCyclicViewIndex: number | undefined;
    let lastCyclicViewDistance = -1;
    for (const viewIndex of viewIndices) {
      const distance = cyclicViewDistance(viewIndex, resourceDemand.viewCursor);
      if (distance <= lastCyclicViewDistance) continue;
      lastCyclicViewDistance = distance;
      lastCyclicViewIndex = viewIndex;
    }
    let publication = resourceDemand.commit;
    if (publication === undefined) {
      publication = {
        nextStartSubmission: 0,
        nonconvergentCandidates: nonconvergentOutput,
        preferenceCursorUpdates,
        resource,
        resourceCursorUpdate,
        startSubmission: 0,
        submissions,
      };
      resourceDemand.commit = publication;
    }
    publication.nextStartSubmission = submissions.length <= 1
      ? 0
      : (startSubmission + 1) % submissions.length;
    publication.nonconvergentCandidates = nonconvergentOutput;
    publication.preferenceCursorUpdates = preferenceCursorUpdates;
    publication.resource = resource;
    publication.resourceCursorUpdate = resourceCursorUpdate;
    publication.startSubmission = startSubmission;
    publication.submissions = submissions;
    if (lastCyclicViewIndex === undefined) delete publication.viewCursorUpdate;
    else publication.viewCursorUpdate = lastCyclicViewIndex;
    commits.push(publication);
  }
  for (const resource of workspace.preferenceCursors.keys()) {
    if (!workspace.resources.has(resource)) workspace.preferenceCursors.delete(resource);
  }
  for (const resource of workspace.viewCursors.keys()) {
    if (!workspace.resources.has(resource)) workspace.viewCursors.delete(resource);
  }
  releasePools(workspace);
  return commits;
};

export const advanceVirtualTextureFrameDemand = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  commit: VirtualTextureFrameDemandCommit<K>,
): void => {
  if (commit.resourceCursorUpdate !== undefined) workspace.resourceCursor = commit.resourceCursorUpdate;
  if (commit.viewCursorUpdate !== undefined) {
    workspace.viewCursors.set(commit.resource, commit.viewCursorUpdate);
  }
  if (commit.preferenceCursorUpdates.length === 0) {
    workspace.preferenceCursors.delete(commit.resource);
    return;
  }
  let resourceCursors = workspace.preferenceCursors.get(commit.resource);
  if (resourceCursors === undefined) resourceCursors = new Map();
  else resourceCursors.clear();
  for (const update of commit.preferenceCursorUpdates) resourceCursors.set(update.viewIndex, update.next);
  workspace.preferenceCursors.set(commit.resource, resourceCursors);
};
