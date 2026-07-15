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
  isPackedInstanceSlotDirty,
  type GltfInstanceChangeTracker,
} from "./gltf/instance-changes";
import type { Mat4 } from "./math/mat4";

export interface GltfInstanceBufferSource {
  readonly changes: Pick<GltfInstanceChangeTracker, "activePose" | "activeScale">;
  readonly framePoseVersion: number;
  readonly frameScaleVersion: number;
}

export interface GltfInstanceBufferUploadCounters {
  localModelUploadBytes: number;
  localModelUploadCalls: number;
  rootPoseUploadBytes: number;
  rootPoseUploadCalls: number;
  rootScaleUploadBytes: number;
  rootScaleUploadCalls: number;
}

declare const gltfInstanceBufferArenaAuthority: unique symbol;

export interface GltfInstanceBufferArena {
  readonly [gltfInstanceBufferArenaAuthority]: "GltfInstanceBufferArena";
}

type GltfInstanceVectorBufferState = {
  signature?: number[];
};

type GltfInstanceRootPoseBufferState = {
  positionSignature?: number[];
  rotationSignature?: number[];
};

type GltfInstanceBufferResource = {
  readonly allocation: VertexInputInstanceAllocation;
  localSignature?: number[];
  instanceCount: number;
  packedLogicalIndices: Int32Array;
  readonly packedSources: Array<GltfInstanceBufferSource | undefined>;
  readonly poseVersions: Map<GltfInstanceBufferSource, number>;
  readonly rootPose: GltfInstanceRootPoseBufferState;
  readonly rootScale: GltfInstanceVectorBufferState;
  readonly scaleVersions: Map<GltfInstanceBufferSource, number>;
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

const recordRootPoseUpload = (
  counters: GltfInstanceBufferUploadCounters,
  stats: VertexInputInstanceLaneUploadStats,
): void => {
  counters.rootPoseUploadCalls += stats.calls;
  counters.rootPoseUploadBytes += stats.bytes;
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
  rootPositionSignature: readonly number[],
  rootRotationSignature: readonly number[],
  rootScaleSignature: readonly number[],
): void => {
  validKey(key);
  const instanceCount = localModels.length;
  requireInstanceCount(rootTransforms.length, instanceCount, "root transform");
  requireInstanceCount(rootInstanceViews.length, instanceCount, "root source");
  requireInstanceCount(rootLogicalIndices.length, instanceCount, "root logical-index");
  for (let index = 0; index < instanceCount; index += 1) {
    if (localModels[index]!.length !== 16) {
      throw new Error(`glTF instance-buffer local model ${index} does not contain 16 elements`);
    }
    const logicalIndex = rootLogicalIndices[index]!;
    if (!Number.isInteger(logicalIndex) || logicalIndex < -1 || logicalIndex > 0x7fff_ffff) {
      throw new Error(`Invalid glTF instance-buffer logical index ${logicalIndex}`);
    }
    if (rootInstanceViews[index] !== undefined && logicalIndex < 0) {
      throw new Error("A glTF instance-buffer source requires a nonnegative logical index");
    }
  }
  requireSignature(localModelSignature.length, instanceCount, "local-model");
  requireSignature(rootPositionSignature.length, instanceCount, "root-position");
  requireSignature(rootRotationSignature.length, instanceCount, "root-rotation");
  requireSignature(rootScaleSignature.length, instanceCount, "root-scale");
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
    instanceCount: 0,
    packedLogicalIndices,
    packedSources: [],
    poseVersions: new Map(),
    rootPose: {},
    rootScale: {},
    scaleVersions: new Map(),
  };
  state.resources.set(key, resource);
  state.liveIds[state.liveCount] = key;
  state.liveCount += 1;
  return resource;
};

const bindGltfInstanceRootPoseBuffer = (
  state: GltfInstanceBufferArenaState,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  allocation: VertexInputInstanceAllocation,
  staging: VertexInputInstanceStaging,
  resource: GltfInstanceRootPoseBufferState,
  rootTransforms: readonly (Transform | undefined)[],
  rootInstanceViews: readonly (GltfInstanceBufferSource | undefined)[],
  rootLogicalIndices: readonly number[],
  packedSources: readonly (GltfInstanceBufferSource | undefined)[],
  packedLogicalIndices: Int32Array,
  poseVersions: ReadonlyMap<GltfInstanceBufferSource, number>,
  nextPositionSignature: readonly number[],
  nextRotationSignature: readonly number[],
  previousInstanceCount: number,
  instanceCount: number,
  counters: GltfInstanceBufferUploadCounters,
): void => {
  const previousPositionSignature = resource.positionSignature;
  const previousRotationSignature = resource.rotationSignature;
  const previousPositionStride = previousPositionSignature === undefined
    ? undefined
    : gltfInstanceSignatureStride(previousInstanceCount, previousPositionSignature);
  const previousRotationStride = previousRotationSignature === undefined
    ? undefined
    : gltfInstanceSignatureStride(previousInstanceCount, previousRotationSignature);
  const nextPositionStride = gltfInstanceSignatureStride(instanceCount, nextPositionSignature);
  const nextRotationStride = gltfInstanceSignatureStride(instanceCount, nextRotationSignature);
  const fullUpload = staging.forceFull
    || previousPositionSignature === undefined
    || previousRotationSignature === undefined
    || previousPositionStride === undefined
    || previousRotationStride === undefined
    || nextPositionStride === undefined
    || nextRotationStride === undefined
    || previousPositionStride !== nextPositionStride
    || previousRotationStride !== nextRotationStride
    || previousPositionSignature.length !== nextPositionSignature.length
    || previousRotationSignature.length !== nextRotationSignature.length
    || previousInstanceCount !== instanceCount;
  let changedRangeCount = 0;
  let activeRangeStart = -1;

  for (let transformIndex = 0; transformIndex < rootTransforms.length; transformIndex += 1) {
    const sourceViews = rootInstanceViews[transformIndex];
    const logicalIndex = rootLogicalIndices[transformIndex]!;
    const positionSignatureOffset = transformIndex * (nextPositionStride ?? 0);
    const rotationSignatureOffset = transformIndex * (nextRotationStride ?? 0);
    const changed = fullUpload
      || isPackedInstanceSlotDirty(
        sourceViews?.changes.activePose,
        logicalIndex,
        packedSources[transformIndex] === sourceViews,
        packedLogicalIndices[transformIndex]!,
        sourceViews !== undefined && poseVersions.get(sourceViews) !== sourceViews.framePoseVersion,
      )
      || previousPositionSignature === undefined
      || previousRotationSignature === undefined
      || nextPositionStride === undefined
      || nextRotationStride === undefined
      || !sameGltfModelSignatureRange(
        previousPositionSignature,
        nextPositionSignature,
        positionSignatureOffset,
        nextPositionStride,
      )
      || !sameGltfModelSignatureRange(
        previousRotationSignature,
        nextRotationSignature,
        rotationSignatureOffset,
        nextRotationStride,
      );
    if (!changed) {
      if (activeRangeStart >= 0) {
        staging.ranges[changedRangeCount * 2] = activeRangeStart;
        staging.ranges[changedRangeCount * 2 + 1] = transformIndex;
        changedRangeCount += 1;
        activeRangeStart = -1;
      }
      continue;
    }
    const transform = rootTransforms[transformIndex] ?? IDENTITY_TRANSFORM;
    const offset = transformIndex * 6;
    const position = transform.position;
    const rotation = transform.rotation;
    staging.rootPoses[offset] = position[0];
    staging.rootPoses[offset + 1] = position[1];
    staging.rootPoses[offset + 2] = position[2];
    staging.rootPoses[offset + 3] = rotation[0];
    staging.rootPoses[offset + 4] = rotation[1];
    staging.rootPoses[offset + 5] = rotation[2];
    if (activeRangeStart < 0) activeRangeStart = transformIndex;
  }
  if (activeRangeStart >= 0) {
    staging.ranges[changedRangeCount * 2] = activeRangeStart;
    staging.ranges[changedRangeCount * 2 + 1] = rootTransforms.length;
    changedRangeCount += 1;
  }
  if (fullUpload || changedRangeCount > 0) {
    recordRootPoseUpload(counters, uploadVertexInputInstanceLane(
      state.vertexInputs,
      gl,
      contextGeneration,
      allocation,
      "rootPoses",
      changedRangeCount,
    ));
    resource.positionSignature = copyGltfInstanceSignature(resource.positionSignature, nextPositionSignature);
    resource.rotationSignature = copyGltfInstanceSignature(resource.rotationSignature, nextRotationSignature);
  }
};

const bindGltfInstanceRootScaleBuffer = (
  state: GltfInstanceBufferArenaState,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  allocation: VertexInputInstanceAllocation,
  staging: VertexInputInstanceStaging,
  resource: GltfInstanceVectorBufferState,
  rootTransforms: readonly (Transform | undefined)[],
  rootInstanceViews: readonly (GltfInstanceBufferSource | undefined)[],
  rootLogicalIndices: readonly number[],
  packedSources: readonly (GltfInstanceBufferSource | undefined)[],
  packedLogicalIndices: Int32Array,
  scaleVersions: ReadonlyMap<GltfInstanceBufferSource, number>,
  nextSignature: readonly number[],
  previousInstanceCount: number,
  instanceCount: number,
  counters: GltfInstanceBufferUploadCounters,
): void => {
  const previousSignature = resource.signature;
  const previousStride = previousSignature === undefined
    ? undefined
    : gltfInstanceSignatureStride(previousInstanceCount, previousSignature);
  const nextStride = gltfInstanceSignatureStride(instanceCount, nextSignature);
  const fullUpload = staging.forceFull
    || previousSignature === undefined
    || previousStride === undefined
    || nextStride === undefined
    || previousStride !== nextStride
    || previousSignature.length !== nextSignature.length
    || previousInstanceCount !== instanceCount;
  let changedRangeCount = 0;
  let activeRangeStart = -1;

  for (let transformIndex = 0; transformIndex < rootTransforms.length; transformIndex += 1) {
    const sourceViews = rootInstanceViews[transformIndex];
    const logicalIndex = rootLogicalIndices[transformIndex]!;
    const signatureOffset = transformIndex * (nextStride ?? 0);
    const changed = fullUpload
      || isPackedInstanceSlotDirty(
        sourceViews?.changes.activeScale,
        logicalIndex,
        packedSources[transformIndex] === sourceViews,
        packedLogicalIndices[transformIndex]!,
        sourceViews !== undefined && scaleVersions.get(sourceViews) !== sourceViews.frameScaleVersion,
      )
      || previousSignature === undefined
      || nextStride === undefined
      || !sameGltfModelSignatureRange(previousSignature, nextSignature, signatureOffset, nextStride);
    if (!changed) {
      if (activeRangeStart >= 0) {
        staging.ranges[changedRangeCount * 2] = activeRangeStart;
        staging.ranges[changedRangeCount * 2 + 1] = transformIndex;
        changedRangeCount += 1;
        activeRangeStart = -1;
      }
      continue;
    }
    const value = (rootTransforms[transformIndex] ?? IDENTITY_TRANSFORM).scale;
    const offset = transformIndex * 3;
    staging.rootScales[offset] = value[0];
    staging.rootScales[offset + 1] = value[1];
    staging.rootScales[offset + 2] = value[2];
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
    resource.signature = copyGltfInstanceSignature(resource.signature, nextSignature);
  }
};

export const bindGltfInstanceBuffer = (
  arena: GltfInstanceBufferArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  key: number,
  localModels: readonly Mat4[],
  localModelSignature: readonly number[],
  rootTransforms: readonly (Transform | undefined)[],
  rootInstanceViews: readonly (GltfInstanceBufferSource | undefined)[],
  rootLogicalIndices: readonly number[],
  rootPositionSignature: readonly number[],
  rootRotationSignature: readonly number[],
  rootScaleSignature: readonly number[],
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
    rootPositionSignature,
    rootRotationSignature,
    rootScaleSignature,
  );
  const instanceCount = localModels.length;
  const resource = gltfInstanceBufferResource(state, key);
  let grownPackedLogicalIndices: Int32Array | undefined;
  if (resource.packedLogicalIndices.length < instanceCount) {
    grownPackedLogicalIndices = new Int32Array(instanceCount);
    grownPackedLogicalIndices.fill(-1);
    grownPackedLogicalIndices.set(resource.packedLogicalIndices);
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
  bindGltfInstanceRootPoseBuffer(
    state,
    gl,
    contextGeneration,
    resource.allocation,
    staging,
    resource.rootPose,
    rootTransforms,
    rootInstanceViews,
    rootLogicalIndices,
    resource.packedSources,
    resource.packedLogicalIndices,
    resource.poseVersions,
    rootPositionSignature,
    rootRotationSignature,
    previousInstanceCount,
    instanceCount,
    counters,
  );
  bindGltfInstanceRootScaleBuffer(
    state,
    gl,
    contextGeneration,
    resource.allocation,
    staging,
    resource.rootScale,
    rootTransforms,
    rootInstanceViews,
    rootLogicalIndices,
    resource.packedSources,
    resource.packedLogicalIndices,
    resource.scaleVersions,
    rootScaleSignature,
    previousInstanceCount,
    instanceCount,
    counters,
  );
  for (let index = 0; index < instanceCount; index += 1) {
    const sourceViews = rootInstanceViews[index];
    resource.packedSources[index] = sourceViews;
    resource.packedLogicalIndices[index] = rootLogicalIndices[index]!;
    if (sourceViews !== undefined) {
      resource.poseVersions.set(sourceViews, sourceViews.framePoseVersion);
      resource.scaleVersions.set(sourceViews, sourceViews.frameScaleVersion);
    }
  }
  resource.packedSources.length = instanceCount;
  for (const sourceViews of resource.poseVersions.keys()) {
    if (!rootInstanceViews.includes(sourceViews)) resource.poseVersions.delete(sourceViews);
  }
  for (const sourceViews of resource.scaleVersions.keys()) {
    if (!rootInstanceViews.includes(sourceViews)) resource.scaleVersions.delete(sourceViews);
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
