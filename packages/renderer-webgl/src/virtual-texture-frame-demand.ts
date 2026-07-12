import {
  type VirtualTextureDemandSubmission,
} from "./virtual-texture-demand";
import { virtualTexturePageKey, type VirtualTexturePageId } from "./virtual-texturing";

const MAX_POOLED_RESOURCES = 64;
const MAX_POOLED_VIEWS = 256;
const MAX_POOLED_GROUPS = 512;

type MutableViewDemand = {
  readonly candidates: Map<string, VirtualTexturePageId>;
  preferTargetMip: boolean;
  readonly preferredGroups: Map<string, Map<string, VirtualTexturePageId>>;
};

type MutableResourceDemand<K> = {
  resource?: K;
  readonly views: Map<number, MutableViewDemand>;
};

export interface VirtualTextureFrameDemandWorkspace<K> {
  active: boolean;
  groupPoolIndex: number;
  readonly groupPool: Array<Map<string, VirtualTexturePageId>>;
  readonly preferenceCursors: Map<K, Map<number, number>>;
  resourcePoolIndex: number;
  readonly resourcePool: Array<MutableResourceDemand<K>>;
  readonly resources: Map<K, MutableResourceDemand<K>>;
  viewPoolIndex: number;
  readonly viewPool: MutableViewDemand[];
}

export interface VirtualTextureFrameDemandCommit<K> {
  readonly nextStartSubmission: number;
  readonly preferenceCursorUpdates: readonly {
    readonly next: number;
    readonly viewIndex: number;
  }[];
  readonly resource: K;
  readonly startSubmission: number;
  readonly submissions: readonly VirtualTextureDemandSubmission[];
}

export const createVirtualTextureFrameDemandWorkspace = <K>(): VirtualTextureFrameDemandWorkspace<K> => ({
  active: false,
  groupPool: [],
  groupPoolIndex: 0,
  preferenceCursors: new Map(),
  resourcePool: [],
  resourcePoolIndex: 0,
  resources: new Map(),
  viewPool: [],
  viewPoolIndex: 0,
});

export const beginVirtualTextureFrameDemand = <K>(workspace: VirtualTextureFrameDemandWorkspace<K>): void => {
  workspace.resources.clear();
  workspace.resourcePoolIndex = 0;
  workspace.viewPoolIndex = 0;
  workspace.groupPoolIndex = 0;
  workspace.active = true;
};

const addPages = (
  target: Map<string, VirtualTexturePageId>,
  pages: readonly VirtualTexturePageId[],
): void => {
  for (const page of pages) target.set(virtualTexturePageKey(page), page);
};

export const submitVirtualTextureFrameDemand = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  resource: K,
  viewIndex: number,
  submission: VirtualTextureDemandSubmission,
): void => {
  if (!workspace.active) throw new Error("Virtual texture frame-demand collection is not active");
  if (!Number.isSafeInteger(viewIndex) || viewIndex < 0) {
    throw new Error("Virtual texture demand view index must be a non-negative integer");
  }
  let resourceDemand = workspace.resources.get(resource);
  if (resourceDemand === undefined) {
    resourceDemand = workspace.resourcePool[workspace.resourcePoolIndex];
    if (resourceDemand === undefined) {
      resourceDemand = { resource, views: new Map() };
      workspace.resourcePool.push(resourceDemand);
    } else {
      resourceDemand.resource = resource;
      resourceDemand.views.clear();
    }
    workspace.resourcePoolIndex += 1;
    workspace.resources.set(resource, resourceDemand);
  }
  let viewDemand = resourceDemand.views.get(viewIndex);
  if (viewDemand === undefined) {
    viewDemand = workspace.viewPool[workspace.viewPoolIndex];
    if (viewDemand === undefined) {
      viewDemand = {
        candidates: new Map(),
        preferTargetMip: false,
        preferredGroups: new Map(),
      };
      workspace.viewPool.push(viewDemand);
    } else {
      viewDemand.candidates.clear();
      viewDemand.preferTargetMip = false;
      viewDemand.preferredGroups.clear();
    }
    workspace.viewPoolIndex += 1;
    resourceDemand.views.set(viewIndex, viewDemand);
  }
  addPages(viewDemand.candidates, submission.candidates);
  viewDemand.preferTargetMip ||= submission.preferTargetMip;
  if (!submission.preferTargetMip) return;
  const targetMip = submission.candidates.at(-1)?.mip;
  const preferred = submission.preferredCandidates;
  let signature = "";
  let preferredCount = 0;
  if (preferred !== undefined) {
    for (const page of preferred) {
      signature += `${preferredCount === 0 ? "" : "|"}${virtualTexturePageKey(page)}`;
      preferredCount += 1;
    }
  } else if (targetMip !== undefined) {
    for (const page of submission.candidates) {
      if (page.mip !== targetMip) continue;
      signature += `${preferredCount === 0 ? "" : "|"}${virtualTexturePageKey(page)}`;
      preferredCount += 1;
    }
  }
  if (preferredCount === 0) return;
  let group = viewDemand.preferredGroups.get(signature);
  if (group === undefined) {
    group = workspace.groupPool[workspace.groupPoolIndex];
    if (group === undefined) {
      group = new Map();
      workspace.groupPool.push(group);
    } else group.clear();
    workspace.groupPoolIndex += 1;
    viewDemand.preferredGroups.set(signature, group);
  }
  if (preferred !== undefined) addPages(group, preferred);
  else if (targetMip !== undefined) {
    for (const page of submission.candidates) {
      if (page.mip === targetMip) group.set(virtualTexturePageKey(page), page);
    }
  }
};

const orderedPreferredCandidates = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  resource: K,
  viewIndex: number,
  view: MutableViewDemand,
): readonly VirtualTexturePageId[] => {
  const groups = [...view.preferredGroups.values()].map((group) => [...group.values()]);
  if (groups.length === 0) return [];
  if (groups.length === 1) return groups[0]!;
  const resourceCursors = workspace.preferenceCursors.get(resource);
  const start = Math.max(0, resourceCursors?.get(viewIndex) ?? 0) % groups.length;
  const indices = groups.map(() => 0);
  const ordered: VirtualTexturePageId[] = [];
  let cursor = start;
  let exhausted = 0;
  while (exhausted < groups.length) {
    const group = groups[cursor]!;
    const index = indices[cursor]!;
    if (index >= group.length) exhausted += 1;
    else {
      ordered.push(group[index]!);
      indices[cursor] = index + 1;
      exhausted = 0;
    }
    cursor = (cursor + 1) % groups.length;
  }
  return ordered;
};

const releaseVirtualTextureFrameDemandPools = <K>(workspace: VirtualTextureFrameDemandWorkspace<K>): void => {
  workspace.resources.clear();
  for (let index = 0; index < workspace.resourcePoolIndex; index += 1) {
    const pooled = workspace.resourcePool[index];
    if (pooled === undefined) continue;
    delete pooled.resource;
    pooled.views.clear();
  }
  for (let index = 0; index < workspace.viewPoolIndex; index += 1) {
    const pooled = workspace.viewPool[index];
    if (pooled === undefined) continue;
    pooled.candidates.clear();
    pooled.preferredGroups.clear();
  }
  for (let index = 0; index < workspace.groupPoolIndex; index += 1) {
    workspace.groupPool[index]?.clear();
  }
  workspace.resourcePool.length = Math.min(workspace.resourcePool.length, MAX_POOLED_RESOURCES);
  workspace.viewPool.length = Math.min(workspace.viewPool.length, MAX_POOLED_VIEWS);
  workspace.groupPool.length = Math.min(workspace.groupPool.length, MAX_POOLED_GROUPS);
};

export const resetVirtualTextureFrameDemand = <K>(workspace: VirtualTextureFrameDemandWorkspace<K>): void => {
  workspace.active = false;
  releaseVirtualTextureFrameDemandPools(workspace);
};

export const finalizeVirtualTextureFrameDemand = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  commit: boolean,
  cursorFor: (resource: K) => number,
): readonly VirtualTextureFrameDemandCommit<K>[] => {
  if (!workspace.active) throw new Error("Virtual texture frame-demand collection is not active");
  workspace.active = false;
  const commits: VirtualTextureFrameDemandCommit<K>[] = [];
  if (!commit) {
    releaseVirtualTextureFrameDemandPools(workspace);
    return commits;
  }
  for (const resourceDemand of workspace.resources.values()) {
    const resource = resourceDemand.resource;
    if (resource === undefined) continue;
    const views = [...resourceDemand.views.entries()].sort(([left], [right]) => left - right);
    const submissions = views
      .map(([viewIndex, view]) => ({
        candidates: [...view.candidates.values()],
        preferTargetMip: view.preferTargetMip,
        ...(!view.preferTargetMip || view.preferredGroups.size === 0
          ? {}
          : { preferredCandidates: orderedPreferredCandidates(workspace, resource, viewIndex, view) }),
      }));
    const startSubmission = submissions.length <= 1
      ? 0
      : Math.max(0, cursorFor(resource)) % submissions.length;
    const preferenceCursorUpdates: Array<{ next: number; viewIndex: number }> = [];
    for (const [viewIndex, view] of views) {
      if (view.preferredGroups.size <= 1) continue;
      const resourceCursors = workspace.preferenceCursors.get(resource);
      const current = Math.max(0, resourceCursors?.get(viewIndex) ?? 0) % view.preferredGroups.size;
      preferenceCursorUpdates.push({ next: (current + 1) % view.preferredGroups.size, viewIndex });
    }
    commits.push({
      nextStartSubmission: submissions.length <= 1 ? 0 : (startSubmission + 1) % submissions.length,
      preferenceCursorUpdates,
      resource,
      startSubmission,
      submissions,
    });
  }
  releaseVirtualTextureFrameDemandPools(workspace);
  return commits;
};

export const advanceVirtualTextureFrameDemand = <K>(
  workspace: VirtualTextureFrameDemandWorkspace<K>,
  commit: VirtualTextureFrameDemandCommit<K>,
): void => {
  if (commit.preferenceCursorUpdates.length === 0) return;
  let resourceCursors = workspace.preferenceCursors.get(commit.resource);
  if (resourceCursors === undefined) {
    resourceCursors = new Map();
    workspace.preferenceCursors.set(commit.resource, resourceCursors);
  }
  for (const update of commit.preferenceCursorUpdates) {
    resourceCursors.set(update.viewIndex, update.next);
  }
};
