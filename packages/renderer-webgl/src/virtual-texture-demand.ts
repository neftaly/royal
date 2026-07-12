import { multiplyMat4 } from "./math/mat4";
import {
  VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW,
  normalizeVirtualTextureDemandUvRange,
  orientVirtualTextureDemandVRange,
  virtualTextureDemandPageDistance,
  type VirtualTextureDrawDemand,
  type VirtualTextureDrawDemandContext,
  type VirtualTextureDrawDemandModelSource,
  type VirtualTextureScreenFootprint,
} from "./virtual-texture-runtime";
import {
  derivedVirtualTextureMipCount,
  virtualTextureMipDimension,
  virtualTexturePageKey,
  virtualTexturePageUri,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
} from "./virtual-texturing";

export type VirtualTextureProjection =
  | { readonly kind: "indeterminate" }
  | { readonly kind: "not-visible" }
  | { readonly footprint: VirtualTextureScreenFootprint; readonly kind: "visible" };

export type VirtualTextureDemandSource = {
  readonly generated: boolean;
  readonly manifest: VirtualTextureManifestModel;
  readonly pageUrisByKey?: ReadonlyMap<string, string>;
};

export type VirtualTextureDrawDemandInput = VirtualTextureDemandSource & {
  readonly context?: VirtualTextureDrawDemandContext;
  readonly flipY: boolean;
  readonly limit?: number;
};

const demandLimit = (limit: number | undefined): number =>
  Number.isSafeInteger(limit) && limit !== undefined && limit >= 0
    ? limit
    : VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW;

export const virtualTextureDemandModelCount = (source: VirtualTextureDrawDemandModelSource): number => {
  switch (source.kind) {
    case "single":
      return 1;
    case "composed":
      return Math.min(source.localModels.length, source.rootModels.length);
  }
};

export const projectVirtualTextureScreenFootprint = (
  context: VirtualTextureDrawDemandContext,
  flipY: boolean,
): VirtualTextureProjection => {
  const [viewportWidth, viewportHeight] = context.viewportSize;
  const modelCount = virtualTextureDemandModelCount(context.modelSource);
  const vertexCount = Math.min(Math.floor(context.positions.length / 3), Math.floor(context.texCoords.length / 2));
  if (viewportWidth <= 0 || viewportHeight <= 0 || vertexCount === 0 || modelCount === 0) {
    return { kind: "indeterminate" };
  }

  let minNdcX = Number.POSITIVE_INFINITY;
  let maxNdcX = Number.NEGATIVE_INFINITY;
  let minNdcY = Number.POSITIVE_INFINITY;
  let maxNdcY = Number.NEGATIVE_INFINITY;
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  let positiveClipSamples = 0;
  let nonPositiveClipSamples = 0;
  const projectionView = multiplyMat4(context.projection, context.view);

  for (let modelIndex = 0; modelIndex < modelCount; modelIndex += 1) {
    const source = context.modelSource;
    const model = source.kind === "single"
      ? source.model
      : multiplyMat4(source.rootModels[modelIndex]!, source.localModels[modelIndex]!);
    const mvp = multiplyMat4(projectionView, model);
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const positionOffset = vertexIndex * 3;
      const x = context.positions[positionOffset]!;
      const y = context.positions[positionOffset + 1]!;
      const z = context.positions[positionOffset + 2]!;
      const clipX = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
      const clipY = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
      const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      if (!Number.isFinite(clipW) || clipW <= 0.000001) {
        nonPositiveClipSamples += 1;
        continue;
      }

      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;
      if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) continue;
      positiveClipSamples += 1;
      minNdcX = Math.min(minNdcX, ndcX);
      maxNdcX = Math.max(maxNdcX, ndcX);
      minNdcY = Math.min(minNdcY, ndcY);
      maxNdcY = Math.max(maxNdcY, ndcY);

      const texCoordOffset = vertexIndex * 2;
      const sourceU = context.texCoords[texCoordOffset]!;
      const sourceV = context.texCoords[texCoordOffset + 1]!;
      const coordinates = context.textureCoordinates;
      const u = coordinates === undefined
        ? sourceU
        : coordinates.row0[0] * sourceU + coordinates.row0[1] * sourceV + coordinates.row0[2];
      const v = coordinates === undefined
        ? sourceV
        : coordinates.row1[0] * sourceU + coordinates.row1[1] * sourceV + coordinates.row1[2];
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  }

  if (positiveClipSamples === 0) return { kind: "not-visible" };
  // A primitive can intersect the near plane even when some source vertices
  // are behind it. Vertex-cloud bounds cannot reconstruct the clipped UV
  // intersections safely, so fall back to bounded conservative demand.
  if (nonPositiveClipSamples > 0) return { kind: "indeterminate" };
  if (maxNdcX < -1 || minNdcX > 1 || maxNdcY < -1 || minNdcY > 1) return { kind: "not-visible" };
  if (!Number.isFinite(minU) || !Number.isFinite(maxU) || !Number.isFinite(minV) || !Number.isFinite(maxV)) {
    return { kind: "indeterminate" };
  }

  const minScreenX = Math.max(0, (Math.max(-1, minNdcX) * 0.5 + 0.5) * viewportWidth);
  const maxScreenX = Math.min(viewportWidth, (Math.min(1, maxNdcX) * 0.5 + 0.5) * viewportWidth);
  const minScreenY = Math.max(0, (Math.max(-1, minNdcY) * 0.5 + 0.5) * viewportHeight);
  const maxScreenY = Math.min(viewportHeight, (Math.min(1, maxNdcY) * 0.5 + 0.5) * viewportHeight);
  const normalizedU = normalizeVirtualTextureDemandUvRange(minU, maxU);
  const normalizedV = orientVirtualTextureDemandVRange(
    ...normalizeVirtualTextureDemandUvRange(minV, maxV),
    flipY,
  );
  return {
    footprint: {
      maxU: normalizedU[1],
      maxV: normalizedV[1],
      minU: normalizedU[0],
      minV: normalizedV[0],
      screenHeight: Math.max(1, maxScreenY - minScreenY),
      screenWidth: Math.max(1, maxScreenX - minScreenX),
    },
    kind: "visible",
  };
};

export const virtualTextureDemandMipCount = (manifest: VirtualTextureManifestModel): number =>
  manifest.mipCount ?? derivedVirtualTextureMipCount(manifest.width, manifest.height, manifest.pageSize);

export const virtualTextureDemandPageGrid = (
  manifest: VirtualTextureManifestModel,
  mip: number,
): { readonly height: number; readonly width: number } => ({
  height: virtualTextureMipDimension(Math.ceil(manifest.height / manifest.pageSize), mip),
  width: virtualTextureMipDimension(Math.ceil(manifest.width / manifest.pageSize), mip),
});

export const virtualTextureTargetMip = (
  manifest: VirtualTextureManifestModel,
  footprint: VirtualTextureScreenFootprint,
): number => {
  const uvWidth = Math.max(1 / Math.max(1, manifest.width), footprint.maxU - footprint.minU);
  const uvHeight = Math.max(1 / Math.max(1, manifest.height), footprint.maxV - footprint.minV);
  const texelsPerScreenX = (uvWidth * manifest.width) / Math.max(1, footprint.screenWidth);
  const texelsPerScreenY = (uvHeight * manifest.height) / Math.max(1, footprint.screenHeight);
  const texelsPerScreenPixel = Math.max(1, texelsPerScreenX, texelsPerScreenY);
  const refinementBias = Math.max(footprint.screenWidth, footprint.screenHeight) >= 512 ? 1 : 0;
  return Math.min(
    virtualTextureDemandMipCount(manifest) - 1,
    Math.max(0, Math.floor(Math.log2(texelsPerScreenPixel)) - refinementBias),
  );
};

export const virtualTexturePagesForFootprint = (
  manifest: VirtualTextureManifestModel,
  mip: number,
  footprint: VirtualTextureScreenFootprint,
): readonly VirtualTexturePageId[] => {
  const grid = virtualTextureDemandPageGrid(manifest, mip);
  const minX = Math.max(0, Math.min(grid.width - 1, Math.floor(footprint.minU * grid.width)));
  const maxX = Math.max(minX, Math.min(grid.width - 1, Math.ceil(footprint.maxU * grid.width) - 1));
  const minY = Math.max(0, Math.min(grid.height - 1, Math.floor(footprint.minV * grid.height)));
  const maxY = Math.max(minY, Math.min(grid.height - 1, Math.ceil(footprint.maxV * grid.height) - 1));
  const centerX = (footprint.minU + footprint.maxU) * 0.5 * grid.width;
  const centerY = (footprint.minV + footprint.maxV) * 0.5 * grid.height;
  const pages: VirtualTexturePageId[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) pages.push({ mip, x, y });
  }
  return pages.sort((left, right) =>
    virtualTextureDemandPageDistance(left, centerX, centerY)
    - virtualTextureDemandPageDistance(right, centerX, centerY)
    || left.y - right.y
    || left.x - right.x);
};

export const isVirtualTextureDemandPageAvailable = (
  source: VirtualTextureDemandSource,
  page: VirtualTexturePageId,
): boolean => source.generated || virtualTexturePageUri(source.manifest, page, source.pageUrisByKey) !== undefined;

/** Coarse-first bounded fallback; generated/template address spaces are produced only until limit. */
export const planVirtualTextureBootstrapDemand = (
  source: VirtualTextureDemandSource,
  limit = VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW,
): readonly VirtualTexturePageId[] => {
  const boundedLimit = demandLimit(limit);
  if (boundedLimit === 0) return [];
  const candidates = new Map<string, VirtualTexturePageId>();
  const add = (page: VirtualTexturePageId): boolean => {
    if (!isVirtualTextureDemandPageAvailable(source, page)) return false;
    candidates.set(virtualTexturePageKey(page), page);
    return candidates.size >= boundedLimit;
  };

  if (source.manifest.uriTemplate !== undefined || source.generated) {
    for (let mip = virtualTextureDemandMipCount(source.manifest) - 1; mip >= 0; mip -= 1) {
      const grid = virtualTextureDemandPageGrid(source.manifest, mip);
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) {
          if (add({ mip, x, y })) return [...candidates.values()];
        }
      }
    }
    return [...candidates.values()];
  }

  const explicit = [...source.manifest.pages].sort((left, right) =>
    right.mip - left.mip || left.y - right.y || left.x - right.x);
  for (const page of explicit) {
    if (add(page)) break;
  }
  return [...candidates.values()];
};

export const planVirtualTextureCoarseToFineDemand = (
  source: VirtualTextureDemandSource,
  targetMip: number,
  footprint: VirtualTextureScreenFootprint,
  targetMipPages?: readonly VirtualTexturePageId[],
  limit = VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW,
): readonly VirtualTexturePageId[] => {
  const boundedLimit = demandLimit(limit);
  const candidates: VirtualTexturePageId[] = [];
  for (let mip = virtualTextureDemandMipCount(source.manifest) - 1; mip >= targetMip; mip -= 1) {
    const pages = mip === targetMip && targetMipPages !== undefined
      ? targetMipPages
      : virtualTexturePagesForFootprint(source.manifest, mip, footprint);
    for (const page of pages) {
      if (!isVirtualTextureDemandPageAvailable(source, page)) continue;
      candidates.push(page);
      if (candidates.length >= boundedLimit) return candidates;
    }
  }
  return candidates;
};

export const planVirtualTextureDrawDemand = (input: VirtualTextureDrawDemandInput): VirtualTextureDrawDemand => {
  const limit = demandLimit(input.limit);
  if (input.context === undefined) {
    return { demandCandidates: planVirtualTextureBootstrapDemand(input, limit) };
  }
  const projection = projectVirtualTextureScreenFootprint(input.context, input.flipY);
  if (projection.kind === "not-visible") return { coverageCandidates: [], demandCandidates: [] };
  if (projection.kind === "indeterminate") {
    const fallback = planVirtualTextureBootstrapDemand(input, limit);
    // Bootstrap is safe for explicit VT progress, but it does not prove exact
    // visible coverage. Auto-VT callers must retain their ordinary texture
    // fallback until projection produces a determinate footprint.
    return { coverageCandidates: [], demandCandidates: fallback };
  }
  const targetMip = virtualTextureTargetMip(input.manifest, projection.footprint);
  const coverageCandidates = virtualTexturePagesForFootprint(input.manifest, targetMip, projection.footprint)
    .filter((page) => isVirtualTextureDemandPageAvailable(input, page));
  return {
    coverageCandidates,
    demandCandidates: planVirtualTextureCoarseToFineDemand(
      input,
      targetMip,
      projection.footprint,
      coverageCandidates,
      limit,
    ),
  };
};

export const selectVirtualTextureWorkingSet = (
  candidates: readonly VirtualTexturePageId[],
  capacity: number,
  preferTargetMip = false,
): readonly VirtualTexturePageId[] => {
  const boundedCapacity = Number.isSafeInteger(capacity) ? Math.max(0, capacity) : 0;
  const targetMip = candidates.at(-1)?.mip;
  const targetCandidates = targetMip === undefined
    ? []
    : candidates.filter((page) => page.mip === targetMip);
  if (!preferTargetMip) return candidates.slice(0, Math.min(1, boundedCapacity));
  if (targetCandidates.length === candidates.length) return targetCandidates.slice(0, boundedCapacity);
  if (boundedCapacity <= 1) return candidates.slice(0, boundedCapacity);
  return candidates.length === 0
    ? []
    : [candidates[0]!, ...targetCandidates.slice(0, boundedCapacity - 1)];
};

export interface VirtualTextureDemandSubmission {
  readonly candidates: readonly VirtualTexturePageId[];
  readonly preferTargetMip: boolean;
}

const commonCoarsePage = (
  queues: readonly (readonly VirtualTexturePageId[])[],
): VirtualTexturePageId | undefined => {
  if (queues.length < 2) return undefined;
  const remainingKeys = queues.slice(1).map((queue) => new Set(queue.map(virtualTexturePageKey)));
  let common: VirtualTexturePageId | undefined;
  for (const page of queues[0]!) {
    const key = virtualTexturePageKey(page);
    if (!remainingKeys.every((keys) => keys.has(key))) continue;
    if (common === undefined || page.mip > common.mip) common = page;
  }
  return common;
};

/**
 * Selects one frame's shared VT working set across ordered draw/view demands.
 * A common coarsest fallback is reserved first, then each submission receives
 * target-biased pages in stable round-robin order with global deduplication.
 */
export const selectVirtualTextureFrameWorkingSet = (
  submissions: readonly VirtualTextureDemandSubmission[],
  capacity: number,
  startSubmission = 0,
): readonly VirtualTexturePageId[] => {
  const boundedCapacity = Number.isSafeInteger(capacity) ? Math.max(0, capacity) : 0;
  if (boundedCapacity === 0 || submissions.length === 0) return [];
  if (submissions.length === 1) {
    const submission = submissions[0]!;
    return selectVirtualTextureWorkingSet(
      submission.candidates,
      boundedCapacity,
      submission.preferTargetMip,
    );
  }

  const queues = submissions
    .map((submission, submissionIndex) => ({
      queue: selectVirtualTextureWorkingSet(
        submission.candidates,
        boundedCapacity,
        submission.preferTargetMip,
      ),
      submissionIndex,
    }))
    .filter((entry) => entry.queue.length > 0);
  if (queues.length === 0) return [];
  if (queues.length === 1) return queues[0]!.queue.slice(0, boundedCapacity);

  const selected: VirtualTexturePageId[] = [];
  const selectedKeys = new Set<string>();
  const add = (page: VirtualTexturePageId): boolean => {
    const key = virtualTexturePageKey(page);
    if (selectedKeys.has(key)) return false;
    selectedKeys.add(key);
    selected.push(page);
    return true;
  };
  const common = commonCoarsePage(queues.map((entry) => entry.queue));
  if (common !== undefined) add(common);
  if (selected.length >= boundedCapacity) return selected;

  const indices = queues.map(() => 0);
  const normalizedStart = Number.isSafeInteger(startSubmission)
    ? Math.max(0, startSubmission) % submissions.length
    : 0;
  const anchoredCursor = queues.findIndex((entry) => entry.submissionIndex >= normalizedStart);
  let cursor = anchoredCursor < 0 ? 0 : anchoredCursor;
  let scansWithoutAddition = 0;
  while (selected.length < boundedCapacity && scansWithoutAddition < queues.length) {
    const queueIndex = cursor;
    const queue = queues[queueIndex]!.queue;
    cursor = (cursor + 1) % queues.length;
    let added = false;
    while (indices[queueIndex]! < queue.length) {
      const page = queue[indices[queueIndex]!]!;
      indices[queueIndex] = indices[queueIndex]! + 1;
      if (add(page)) {
        added = true;
        break;
      }
    }
    scansWithoutAddition = added ? 0 : scansWithoutAddition + 1;
  }
  return selected;
};
