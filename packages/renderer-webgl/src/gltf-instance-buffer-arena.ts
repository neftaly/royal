import type { Transform } from "@royal/renderer-core";
import {
  createVertexInputInstanceAllocation,
  prepareVertexInputInstance,
  releaseVertexInputInstanceAllocation,
  uploadVertexInputInstanceLane,
  type VertexInputArena,
  type VertexInputInstanceAllocation,
  type VertexInputInstanceLaneUploadStats,
  type VertexInputInstanceStaging,
} from "./vertex-input/arena";
import {
  areAllInstancesDirty,
  isInstanceDirty,
  type GltfInstanceChangeTracker,
} from "./gltf/instance-changes";
import type { Mat4 } from "./math/mat4";

export interface GltfInstanceBufferSource {
  readonly changes: Pick<
    GltfInstanceChangeTracker,
    "activePosition" | "activeRotation" | "activeScale"
  >;
  readonly framePoseVersion: number;
  readonly frameScaleVersion: number;
  readonly positions: Float32Array;
  readonly rotations: Float32Array;
  readonly scales: Float32Array;
}

export interface GltfInstanceBufferUploadCounters {
  localModelUploadBytes: number;
  localModelUploadCalls: number;
  rootPositionUploadBytes: number;
  rootPositionUploadCalls: number;
  rootRotationUploadBytes: number;
  rootRotationUploadCalls: number;
  rootScaleUploadBytes: number;
  rootScaleUploadCalls: number;
}

declare const gltfInstanceBufferArenaAuthority: unique symbol;

export interface GltfInstanceBufferArena {
  readonly [gltfInstanceBufferArenaAuthority]: "GltfInstanceBufferArena";
}

type GltfInstanceBufferResource = {
  readonly allocation: VertexInputInstanceAllocation;
  hasOrdinaryRoot: boolean;
  localSignature?: number[];
  instanceCount: number;
  packedLogicalIndices: Int32Array;
  packedSlotChanges: Uint8Array;
  readonly packedSources: Array<GltfInstanceBufferSource | undefined>;
  readonly poseVersions: Map<GltfInstanceBufferSource, number>;
  readonly scaleVersions: Map<GltfInstanceBufferSource, number>;
  readonly sourceCounts: Map<GltfInstanceBufferSource, number>;
};

type GltfInstanceBufferArenaState = {
  activeEpoch: number;
  activeEpochs: Uint32Array;
  activeIds: Uint32Array;
  activeCount: number;
  frameActive: boolean;
  liveIds: Uint32Array;
  liveCount: number;
  readonly resources: Map<number, GltfInstanceBufferResource>;
  readonly vertexInputs: VertexInputArena;
};

const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const gltfInstanceSignatureStride = (
  instanceCount: number,
  modelSignature: readonly number[],
): number | undefined => {
  if (instanceCount <= 0) return undefined;
  const stride = modelSignature.length / instanceCount;
  return Number.isInteger(stride) && stride > 0 ? stride : undefined;
};

const sameGltfModelSignatureRange = (
  left: readonly number[],
  right: readonly number[],
  start: number,
  length: number,
): boolean => {
  for (let index = 0; index < length; index += 1) {
    if (!Object.is(left[start + index], right[start + index])) return false;
  }
  return true;
};

const sameFloat32 = (current: number, next: number): boolean =>
  Object.is(current, Math.fround(next));

const sameRootVector = (
  staging: Float32Array,
  offset: number,
  vector: readonly number[],
): boolean =>
  sameFloat32(staging[offset]!, vector[0]!)
  && sameFloat32(staging[offset + 1]!, vector[1]!)
  && sameFloat32(staging[offset + 2]!, vector[2]!);

const sameRootScale = (
  staging: Float32Array,
  offset: number,
  transform: Transform,
): boolean =>
  sameFloat32(staging[offset]!, transform.scale[0])
  && sameFloat32(staging[offset + 1]!, transform.scale[1])
  && sameFloat32(staging[offset + 2]!, transform.scale[2]);

const copyGltfInstanceSignature = (
  target: number[] | undefined,
  source: readonly number[],
): number[] => {
  const next = target ?? [];
  next.length = source.length;
  for (let index = 0; index < source.length; index += 1) next[index] = source[index]!;
  return next;
};

const recordLocalUpload = (
  counters: GltfInstanceBufferUploadCounters,
  stats: VertexInputInstanceLaneUploadStats,
): void => {
  counters.localModelUploadCalls += stats.calls;
  counters.localModelUploadBytes += stats.bytes;
};

const recordRootPositionUpload = (
  counters: GltfInstanceBufferUploadCounters,
  stats: VertexInputInstanceLaneUploadStats,
): void => {
  counters.rootPositionUploadCalls += stats.calls;
  counters.rootPositionUploadBytes += stats.bytes;
};

const recordRootRotationUpload = (
  counters: GltfInstanceBufferUploadCounters,
  stats: VertexInputInstanceLaneUploadStats,
): void => {
  counters.rootRotationUploadCalls += stats.calls;
  counters.rootRotationUploadBytes += stats.bytes;
};

const recordRootScaleUpload = (
  counters: GltfInstanceBufferUploadCounters,
  stats: VertexInputInstanceLaneUploadStats,
): void => {
  counters.rootScaleUploadCalls += stats.calls;
  counters.rootScaleUploadBytes += stats.bytes;
};

export const createGltfInstanceBufferArena = (
  vertexInputs: VertexInputArena,
): GltfInstanceBufferArena => ({
  activeCount: 0,
  activeEpoch: 0,
  activeEpochs: new Uint32Array(1),
  activeIds: new Uint32Array(1),
  frameActive: false,
  liveCount: 0,
  liveIds: new Uint32Array(1),
  resources: new Map(),
  vertexInputs,
} as unknown as GltfInstanceBufferArena);

export const beginGltfInstanceBufferArenaFrame = (arena: GltfInstanceBufferArena): void => {
  const state = arena as unknown as GltfInstanceBufferArenaState;
  state.activeEpoch = (state.activeEpoch + 1) >>> 0;
  if (state.activeEpoch === 0) {
    state.activeEpochs.fill(0);
    state.activeEpoch = 1;
  }
  state.activeCount = 0;
  state.frameActive = true;
};

const requireActiveFrame = (state: GltfInstanceBufferArenaState): void => {
  if (!state.frameActive) throw new Error("glTF instance-buffer arena frame is not active");
};

const validKey = (key: number): void => {
  if (!Number.isInteger(key) || key < 0 || key >= 0xffff_ffff) {
    throw new Error(`Invalid glTF instance-buffer key ${key}`);
  }
};

const requireInstanceCount = (actual: number, expected: number, label: string): void => {
  if (actual !== expected) {
    throw new Error(`glTF instance-buffer ${label} length ${actual} does not match instance count ${expected}`);
  }
};

const requireSignature = (length: number, instanceCount: number, label: string): void => {
  const valid = instanceCount === 0
    ? length === 0
    : length > 0 && length % instanceCount === 0;
  if (!valid) {
    throw new Error(
      `glTF instance-buffer ${label} signature length ${length} is invalid for instance count ${instanceCount}`,
    );
  }
};

const preflightBinding = (
  key: number,
  localModels: readonly Mat4[],
  localModelSignature: readonly number[],
  rootTransforms: readonly (Transform | undefined)[],
  rootInstanceViews: readonly (GltfInstanceBufferSource | undefined)[],
  rootLogicalIndices: readonly number[],
): void => {
  validKey(key);
  const instanceCount = localModels.length;
  requireInstanceCount(rootTransforms.length, instanceCount, "root transform");
  requireInstanceCount(rootInstanceViews.length, instanceCount, "root source");
  requireInstanceCount(rootLogicalIndices.length, instanceCount, "root logical-index");
  // Per-row matrices and logical indices come from validated packet resources
  // and uint32 frame selections assembled by the renderer-owned workspace.
  // Keep only constant-time parallel-lane checks at this hot publication edge.
  requireSignature(localModelSignature.length, instanceCount, "local-model");
};

const touchGltfInstanceBuffer = (state: GltfInstanceBufferArenaState, key: number): void => {
  if (state.activeEpochs.length <= key) {
    let capacity = state.activeEpochs.length;
    while (capacity <= key) capacity *= 2;
    const epochs = new Uint32Array(capacity);
    epochs.set(state.activeEpochs);
    state.activeEpochs = epochs;
  }
  if (state.activeEpochs[key] === state.activeEpoch) return;
  state.activeEpochs[key] = state.activeEpoch;
  if (state.activeIds.length <= state.activeCount) {
    const ids = new Uint32Array(state.activeIds.length * 2);
    ids.set(state.activeIds);
    state.activeIds = ids;
  }
  state.activeIds[state.activeCount] = key;
  state.activeCount += 1;
};

const gltfInstanceBufferResource = (
  state: GltfInstanceBufferArenaState,
  key: number,
): GltfInstanceBufferResource => {
  touchGltfInstanceBuffer(state, key);
  const existing = state.resources.get(key);
  if (existing !== undefined) return existing;
  if (state.liveIds.length <= state.liveCount) {
    const ids = new Uint32Array(state.liveIds.length * 2);
    ids.set(state.liveIds);
    state.liveIds = ids;
  }
  const packedLogicalIndices = new Int32Array();
  packedLogicalIndices.fill(-1);
  const resource: GltfInstanceBufferResource = {
    allocation: createVertexInputInstanceAllocation(state.vertexInputs),
    hasOrdinaryRoot: false,
    instanceCount: 0,
    packedLogicalIndices,
    packedSlotChanges: new Uint8Array(),
    packedSources: [],
    poseVersions: new Map(),
    scaleVersions: new Map(),
    sourceCounts: new Map(),
  };
  state.resources.set(key, resource);
  state.liveIds[state.liveCount] = key;
  state.liveCount += 1;
  return resource;
};

const bindGltfInstanceRootVectorBuffer = (
  state: GltfInstanceBufferArenaState,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  allocation: VertexInputInstanceAllocation,
  staging: VertexInputInstanceStaging,
  rootTransforms: readonly (Transform | undefined)[],
  rootInstanceViews: readonly (GltfInstanceBufferSource | undefined)[],
  rootLogicalIndices: readonly number[],
  packedSlotChanges: Uint8Array,
  packedLayoutChanged: boolean,
  poseVersions: ReadonlyMap<GltfInstanceBufferSource, number>,
  previousInstanceCount: number,
  instanceCount: number,
  counters: GltfInstanceBufferUploadCounters,
  channel: "position" | "rotation",
  skipUnchangedSourceLane: boolean,
): void => {
  const fullUpload = staging.forceFull || previousInstanceCount !== instanceCount;
  if (!fullUpload && skipUnchangedSourceLane) return;
  const values = channel === "position" ? staging.rootPositions : staging.rootRotations;
  const lane = channel === "position" ? "rootPositions" : "rootRotations";
  const isPosition = channel === "position";
  const contiguousSource = rootInstanceViews[0];
  const contiguousValues = isPosition ? contiguousSource?.positions : contiguousSource?.rotations;
  const contiguousDirty = contiguousSource?.changes[isPosition ? "activePosition" : "activeRotation"];
  const contiguousVersionChanged = contiguousSource !== undefined
    && poseVersions.get(contiguousSource) !== contiguousSource.framePoseVersion;
  if (contiguousSource !== undefined
    && contiguousValues !== undefined
    && contiguousDirty !== undefined
    && rootTransforms.length * 3 === contiguousValues.length
    && (fullUpload || (contiguousVersionChanged
      && areAllInstancesDirty(contiguousDirty, contiguousValues.length / 3)))) {
    const firstLogicalIndex = rootLogicalIndices[0]!;
    let contiguous = firstLogicalIndex === 0;
    for (let index = 1; contiguous && index < rootTransforms.length; index += 1) {
      contiguous = rootInstanceViews[index] === contiguousSource
        && rootLogicalIndices[index] === firstLogicalIndex + index;
    }
    if (contiguous) {
      values.set(contiguousValues);
      staging.ranges[0] = 0;
      staging.ranges[1] = rootTransforms.length;
      const stats = uploadVertexInputInstanceLane(
        state.vertexInputs,
        gl,
        contextGeneration,
        allocation,
        lane,
        1,
      );
      if (isPosition) recordRootPositionUpload(counters, stats);
      else recordRootRotationUpload(counters, stats);
      return;
    }
  }
  let changedRangeCount = 0;
  let activeRangeStart = -1;
  let versionSource: GltfInstanceBufferSource | undefined;
  let sourceVersionChanged = false;
  let sourceDirty: GltfInstanceBufferSource["changes"]["activePosition"] | undefined;
  let sourceValues: Float32Array | undefined;

  for (let transformIndex = 0; transformIndex < rootTransforms.length; transformIndex += 1) {
    const sourceViews = rootInstanceViews[transformIndex];
    if (sourceViews !== versionSource) {
      versionSource = sourceViews;
      sourceVersionChanged = sourceViews !== undefined
        && poseVersions.get(sourceViews) !== sourceViews.framePoseVersion;
      sourceValues = isPosition ? sourceViews?.positions : sourceViews?.rotations;
      sourceDirty = sourceViews?.changes[isPosition ? "activePosition" : "activeRotation"];
    }
    const logicalIndex = rootLogicalIndices[transformIndex]!;
    const offset = transformIndex * 3;
    const changed = fullUpload
      || (sourceViews === undefined
        ? !sameRootVector(
            values,
            offset,
            (rootTransforms[transformIndex] ?? IDENTITY_TRANSFORM)[channel],
          )
        : (packedLayoutChanged && packedSlotChanges[transformIndex] !== 0)
          || (sourceVersionChanged && sourceDirty !== undefined
            && isInstanceDirty(sourceDirty, logicalIndex)));
    if (!changed) {
      if (activeRangeStart >= 0) {
        staging.ranges[changedRangeCount * 2] = activeRangeStart;
        staging.ranges[changedRangeCount * 2 + 1] = transformIndex;
        changedRangeCount += 1;
        activeRangeStart = -1;
      }
      continue;
    }
    if (sourceViews === undefined) {
      const vector = (rootTransforms[transformIndex] ?? IDENTITY_TRANSFORM)[channel];
      values[offset] = vector[0];
      values[offset + 1] = vector[1];
      values[offset + 2] = vector[2];
    } else if (sourceValues !== undefined) {
      const sourceOffset = logicalIndex * 3;
      values[offset] = sourceValues[sourceOffset]!;
      values[offset + 1] = sourceValues[sourceOffset + 1]!;
      values[offset + 2] = sourceValues[sourceOffset + 2]!;
    }
    if (activeRangeStart < 0) activeRangeStart = transformIndex;
  }
  if (activeRangeStart >= 0) {
    staging.ranges[changedRangeCount * 2] = activeRangeStart;
    staging.ranges[changedRangeCount * 2 + 1] = rootTransforms.length;
    changedRangeCount += 1;
  }
  if (fullUpload || changedRangeCount > 0) {
    const stats = uploadVertexInputInstanceLane(
      state.vertexInputs,
      gl,
      contextGeneration,
      allocation,
      lane,
      changedRangeCount,
    );
    if (isPosition) recordRootPositionUpload(counters, stats);
    else recordRootRotationUpload(counters, stats);
  }
};

const bindGltfInstanceRootScaleBuffer = (
  state: GltfInstanceBufferArenaState,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  allocation: VertexInputInstanceAllocation,
  staging: VertexInputInstanceStaging,
  rootTransforms: readonly (Transform | undefined)[],
  rootInstanceViews: readonly (GltfInstanceBufferSource | undefined)[],
  rootLogicalIndices: readonly number[],
  packedSlotChanges: Uint8Array,
  packedLayoutChanged: boolean,
  scaleVersions: ReadonlyMap<GltfInstanceBufferSource, number>,
  previousInstanceCount: number,
  instanceCount: number,
  counters: GltfInstanceBufferUploadCounters,
  skipUnchangedSourceLane: boolean,
): void => {
  const fullUpload = staging.forceFull || previousInstanceCount !== instanceCount;
  if (!fullUpload && skipUnchangedSourceLane) return;
  let changedRangeCount = 0;
  let activeRangeStart = -1;
  let versionSource: GltfInstanceBufferSource | undefined;
  let sourceVersionChanged = false;
  let sourceScales: Float32Array | undefined;

  for (let transformIndex = 0; transformIndex < rootTransforms.length; transformIndex += 1) {
    const sourceViews = rootInstanceViews[transformIndex];
    if (sourceViews !== versionSource) {
      versionSource = sourceViews;
      sourceVersionChanged = sourceViews !== undefined
        && scaleVersions.get(sourceViews) !== sourceViews.frameScaleVersion;
      sourceScales = sourceViews?.scales;
    }
    const logicalIndex = rootLogicalIndices[transformIndex]!;
    const offset = transformIndex * 3;
    const changed = fullUpload
      || (sourceViews === undefined
        ? !sameRootScale(
            staging.rootScales,
            offset,
            rootTransforms[transformIndex] ?? IDENTITY_TRANSFORM,
          )
        : (packedLayoutChanged && packedSlotChanges[transformIndex] !== 0)
          || (sourceVersionChanged && isInstanceDirty(sourceViews.changes.activeScale, logicalIndex)));
    if (!changed) {
      if (activeRangeStart >= 0) {
        staging.ranges[changedRangeCount * 2] = activeRangeStart;
        staging.ranges[changedRangeCount * 2 + 1] = transformIndex;
        changedRangeCount += 1;
        activeRangeStart = -1;
      }
      continue;
    }
    if (sourceViews === undefined) {
      const scale = (rootTransforms[transformIndex] ?? IDENTITY_TRANSFORM).scale;
      staging.rootScales[offset] = scale[0];
      staging.rootScales[offset + 1] = scale[1];
      staging.rootScales[offset + 2] = scale[2];
    } else if (sourceScales !== undefined) {
      const sourceOffset = logicalIndex * 3;
      staging.rootScales[offset] = sourceScales[sourceOffset]!;
      staging.rootScales[offset + 1] = sourceScales[sourceOffset + 1]!;
      staging.rootScales[offset + 2] = sourceScales[sourceOffset + 2]!;
    }
    if (activeRangeStart < 0) activeRangeStart = transformIndex;
  }
  if (activeRangeStart >= 0) {
    staging.ranges[changedRangeCount * 2] = activeRangeStart;
    staging.ranges[changedRangeCount * 2 + 1] = rootTransforms.length;
    changedRangeCount += 1;
  }
  if (fullUpload || changedRangeCount > 0) {
    recordRootScaleUpload(counters, uploadVertexInputInstanceLane(
      state.vertexInputs,
      gl,
      contextGeneration,
      allocation,
      "rootScales",
      changedRangeCount,
    ));
  }
};

export const bindGltfInstanceBuffer = (
  arena: GltfInstanceBufferArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  key: number,
  localModels: readonly Mat4[],
  localModelSignature: readonly number[],
  localModelSignatureDirty: boolean,
  rootLayoutDirty: boolean,
  rootTransforms: readonly (Transform | undefined)[],
  rootInstanceViews: readonly (GltfInstanceBufferSource | undefined)[],
  rootLogicalIndices: readonly number[],
  counters: GltfInstanceBufferUploadCounters,
): VertexInputInstanceAllocation => {
  const state = arena as unknown as GltfInstanceBufferArenaState;
  requireActiveFrame(state);
  preflightBinding(
    key,
    localModels,
    localModelSignature,
    rootTransforms,
    rootInstanceViews,
    rootLogicalIndices,
  );
  const instanceCount = localModels.length;
  const resource = gltfInstanceBufferResource(state, key);
  let grownPackedLogicalIndices: Int32Array | undefined;
  let grownPackedSlotChanges: Uint8Array | undefined;
  if (resource.packedLogicalIndices.length < instanceCount) {
    grownPackedLogicalIndices = new Int32Array(instanceCount);
    grownPackedLogicalIndices.fill(-1);
    grownPackedLogicalIndices.set(resource.packedLogicalIndices);
    grownPackedSlotChanges = new Uint8Array(instanceCount);
  }
  const staging = prepareVertexInputInstance(
    state.vertexInputs,
    gl,
    contextGeneration,
    resource.allocation,
    instanceCount,
  );
  if (grownPackedLogicalIndices !== undefined) {
    resource.packedLogicalIndices = grownPackedLogicalIndices;
    resource.packedSlotChanges = grownPackedSlotChanges!;
  }
  const previousInstanceCount = resource.instanceCount;
  const previousLocalSignature = resource.localSignature;
  const previousLocalStride = previousLocalSignature === undefined
    ? undefined
    : gltfInstanceSignatureStride(previousInstanceCount, previousLocalSignature);
  const nextLocalStride = gltfInstanceSignatureStride(instanceCount, localModelSignature);
  const localFullUpload = staging.forceFull
    || previousLocalSignature === undefined
    || previousLocalStride === undefined
    || nextLocalStride === undefined
    || previousLocalStride !== nextLocalStride
    || previousLocalSignature.length !== localModelSignature.length
    || previousInstanceCount !== instanceCount;
  let localChangedRangeCount = 0;
  let activeLocalRangeStart = -1;

  if (localFullUpload || localModelSignatureDirty) {
    for (let modelIndex = 0; modelIndex < localModels.length; modelIndex += 1) {
      const signatureOffset = modelIndex * (nextLocalStride ?? 0);
      const changed = localFullUpload
        || previousLocalSignature === undefined
        || nextLocalStride === undefined
        || !sameGltfModelSignatureRange(
          previousLocalSignature,
          localModelSignature,
          signatureOffset,
          nextLocalStride,
        );
      if (!changed) continue;
      const model = localModels[modelIndex]!;
      const offset = modelIndex * 16;
      for (let elementIndex = 0; elementIndex < 16; elementIndex += 1) {
        staging.localModels[offset + elementIndex] = model[elementIndex]!;
      }
      if (activeLocalRangeStart < 0) activeLocalRangeStart = modelIndex;
      const nextChanged = modelIndex + 1 < localModels.length && (
        localFullUpload
        || previousLocalSignature === undefined
        || nextLocalStride === undefined
        || !sameGltfModelSignatureRange(
          previousLocalSignature,
          localModelSignature,
          (modelIndex + 1) * (nextLocalStride ?? 0),
          nextLocalStride ?? 0,
        )
      );
      if (!nextChanged) {
        staging.ranges[localChangedRangeCount * 2] = activeLocalRangeStart;
        staging.ranges[localChangedRangeCount * 2 + 1] = modelIndex + 1;
        localChangedRangeCount += 1;
        activeLocalRangeStart = -1;
      }
    }
    if (localFullUpload || localChangedRangeCount > 0) {
      recordLocalUpload(counters, uploadVertexInputInstanceLane(
        state.vertexInputs,
        gl,
        contextGeneration,
        resource.allocation,
        "localModels",
        localChangedRangeCount,
      ));
      resource.localSignature = copyGltfInstanceSignature(resource.localSignature, localModelSignature);
    }
  }
  let packedLayoutChanged = previousInstanceCount !== instanceCount;
  let hasOrdinaryRoot = resource.hasOrdinaryRoot;
  const packedSourceCount = Math.max(previousInstanceCount, instanceCount);
  if (rootLayoutDirty || packedLayoutChanged) {
    hasOrdinaryRoot = false;
    for (let index = 0; index < packedSourceCount; index += 1) {
      const previousSource = resource.packedSources[index];
      const nextSource = index < instanceCount ? rootInstanceViews[index] : undefined;
      const slotChanged = index < instanceCount && (
        previousSource !== nextSource
        || resource.packedLogicalIndices[index] !== rootLogicalIndices[index]
      );
      if (index < instanceCount) {
        resource.packedSlotChanges[index] = slotChanged ? 1 : 0;
        packedLayoutChanged ||= slotChanged;
        if (nextSource === undefined) hasOrdinaryRoot = true;
      }
    }
  }
  let positionDirty = false;
  let rotationDirty = false;
  let scaleDirty = false;
  if (!packedLayoutChanged && !hasOrdinaryRoot) {
    for (const source of resource.sourceCounts.keys()) {
      if (resource.poseVersions.get(source) !== source.framePoseVersion) {
        positionDirty ||= source.changes.activePosition.maxDirtyWord
          >= source.changes.activePosition.minDirtyWord;
        rotationDirty ||= source.changes.activeRotation.maxDirtyWord
          >= source.changes.activeRotation.minDirtyWord;
      }
      if (resource.scaleVersions.get(source) !== source.frameScaleVersion) {
        scaleDirty ||= source.changes.activeScale.maxDirtyWord
          >= source.changes.activeScale.minDirtyWord;
      }
    }
  }
  const canSkipRetainedLane = !packedLayoutChanged && !hasOrdinaryRoot;
  bindGltfInstanceRootVectorBuffer(
    state,
    gl,
    contextGeneration,
    resource.allocation,
    staging,
    rootTransforms,
    rootInstanceViews,
    rootLogicalIndices,
    resource.packedSlotChanges,
    packedLayoutChanged,
    resource.poseVersions,
    previousInstanceCount,
    instanceCount,
    counters,
    "position",
    canSkipRetainedLane && !positionDirty,
  );
  bindGltfInstanceRootVectorBuffer(
    state,
    gl,
    contextGeneration,
    resource.allocation,
    staging,
    rootTransforms,
    rootInstanceViews,
    rootLogicalIndices,
    resource.packedSlotChanges,
    packedLayoutChanged,
    resource.poseVersions,
    previousInstanceCount,
    instanceCount,
    counters,
    "rotation",
    canSkipRetainedLane && !rotationDirty,
  );
  bindGltfInstanceRootScaleBuffer(
    state,
    gl,
    contextGeneration,
    resource.allocation,
    staging,
    rootTransforms,
    rootInstanceViews,
    rootLogicalIndices,
    resource.packedSlotChanges,
    packedLayoutChanged,
    resource.scaleVersions,
    previousInstanceCount,
    instanceCount,
    counters,
    canSkipRetainedLane && !scaleDirty,
  );
  if (packedLayoutChanged) {
    for (let index = 0; index < packedSourceCount; index += 1) {
      const previousSource = resource.packedSources[index];
      const nextSource = index < instanceCount ? rootInstanceViews[index] : undefined;
      if (previousSource !== nextSource) {
        if (previousSource !== undefined) {
          const count = resource.sourceCounts.get(previousSource)! - 1;
          if (count === 0) {
            resource.sourceCounts.delete(previousSource);
            resource.poseVersions.delete(previousSource);
            resource.scaleVersions.delete(previousSource);
          } else {
            resource.sourceCounts.set(previousSource, count);
          }
        }
        if (nextSource !== undefined) {
          resource.sourceCounts.set(nextSource, (resource.sourceCounts.get(nextSource) ?? 0) + 1);
        }
      }
      if (index >= instanceCount) continue;
      resource.packedSources[index] = nextSource;
      resource.packedLogicalIndices[index] = rootLogicalIndices[index]!;
    }
    resource.packedSources.length = instanceCount;
    resource.hasOrdinaryRoot = hasOrdinaryRoot;
  }
  for (const sourceViews of resource.sourceCounts.keys()) {
    resource.poseVersions.set(sourceViews, sourceViews.framePoseVersion);
    resource.scaleVersions.set(sourceViews, sourceViews.frameScaleVersion);
  }
  resource.instanceCount = instanceCount;
  return resource.allocation;
};

export const releaseUnusedGltfInstanceBuffers = (
  arena: GltfInstanceBufferArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
): void => {
  const state = arena as unknown as GltfInstanceBufferArenaState;
  requireActiveFrame(state);
  for (let index = 0; index < state.liveCount; index += 1) {
    const key = state.liveIds[index]!;
    if (state.activeEpochs[key] === state.activeEpoch) continue;
    const resource = state.resources.get(key);
    if (resource === undefined) continue;
    releaseVertexInputInstanceAllocation(
      state.vertexInputs,
      gl,
      contextGeneration,
      resource.allocation,
    );
    state.resources.delete(key);
  }
  if (state.liveIds.length < state.activeCount) {
    let capacity = state.liveIds.length;
    while (capacity < state.activeCount) capacity *= 2;
    state.liveIds = new Uint32Array(capacity);
  }
  state.liveIds.set(state.activeIds.subarray(0, state.activeCount));
  state.liveCount = state.activeCount;
  state.frameActive = false;
};

/** Drops manager references immediately before disposal of its borrowed vertex-input arena. */
export const clearGltfInstanceBufferArena = (arena: GltfInstanceBufferArena): void => {
  const state = arena as unknown as GltfInstanceBufferArenaState;
  state.resources.clear();
  state.activeCount = 0;
  state.liveCount = 0;
  state.frameActive = false;
};
