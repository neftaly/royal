import {
  createVertexInputInstanceAllocation,
  prepareVertexInputInstance,
  releaseVertexInputInstanceAllocation,
  uploadVertexInputInstanceLane,
  type VertexInputArena,
  type VertexInputInstanceAllocation,
  type VertexInputInstanceLaneUploadStats,
} from "./vertex-input/arena";
import {
  identityMat4,
  multiplyMat4Into,
  type Mat4,
  type MutableMat4,
} from "./math/mat4";

export interface GltfInstanceBufferUploadCounters {
  modelUploadBytes: number;
  modelUploadCalls: number;
}

declare const gltfInstanceBufferArenaAuthority: unique symbol;

export interface GltfInstanceBufferArena {
  readonly [gltfInstanceBufferArenaAuthority]: "GltfInstanceBufferArena";
}

type GltfInstanceBufferResource = {
  readonly allocation: VertexInputInstanceAllocation;
  instanceCount: number;
  localSignature?: number[];
  rootSnapshots: Float32Array;
};

type GltfInstanceBufferArenaState = {
  activeEpoch: number;
  activeEpochs: Uint32Array;
  activeIds: Uint32Array;
  activeCount: number;
  frameActive: boolean;
  liveIds: Uint32Array;
  liveCount: number;
  readonly modelWorkspace: MutableMat4;
  readonly resources: Map<number, GltfInstanceBufferResource>;
  readonly vertexInputs: VertexInputArena;
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

const sameRootSnapshot = (
  snapshots: Float32Array,
  offset: number,
  root: Mat4,
): boolean => {
  for (let component = 0; component < 16; component += 1) {
    if (!Object.is(snapshots[offset + component], Math.fround(root[component]!))) return false;
  }
  return true;
};

const copyRootSnapshot = (
  snapshots: Float32Array,
  offset: number,
  root: Mat4,
): void => {
  for (let component = 0; component < 16; component += 1) {
    snapshots[offset + component] = root[component]!;
  }
};

const recordModelUpload = (
  counters: GltfInstanceBufferUploadCounters,
  stats: VertexInputInstanceLaneUploadStats,
): void => {
  counters.modelUploadCalls += stats.calls;
  counters.modelUploadBytes += stats.bytes;
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
  modelWorkspace: identityMat4(),
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

const requireSignature = (length: number, instanceCount: number): void => {
  const valid = instanceCount === 0
    ? length === 0
    : length > 0 && length % instanceCount === 0;
  if (!valid) {
    throw new Error(
      `glTF instance-buffer local-model signature length ${length} is invalid for instance count ${instanceCount}`,
    );
  }
};

const preflightBinding = (
  key: number,
  localModels: readonly Mat4[],
  localModelSignature: readonly number[],
  rootModels: readonly Mat4[],
): void => {
  validKey(key);
  requireInstanceCount(rootModels.length, localModels.length, "root-model");
  requireSignature(localModelSignature.length, localModels.length);
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
  const resource: GltfInstanceBufferResource = {
    allocation: createVertexInputInstanceAllocation(state.vertexInputs),
    instanceCount: 0,
    rootSnapshots: new Float32Array(),
  };
  state.resources.set(key, resource);
  state.liveIds[state.liveCount] = key;
  state.liveCount += 1;
  return resource;
};

const growRootSnapshots = (
  resource: GltfInstanceBufferResource,
  instanceCount: number,
): void => {
  const required = instanceCount * 16;
  if (resource.rootSnapshots.length >= required) return;
  const snapshots = new Float32Array(required);
  snapshots.set(resource.rootSnapshots.subarray(0, resource.instanceCount * 16));
  resource.rootSnapshots = snapshots;
};

export const bindGltfInstanceBuffer = (
  arena: GltfInstanceBufferArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  key: number,
  localModels: readonly Mat4[],
  localModelSignature: readonly number[],
  localModelSignatureDirty: boolean,
  rootModels: readonly Mat4[],
  counters: GltfInstanceBufferUploadCounters,
): VertexInputInstanceAllocation => {
  const state = arena as unknown as GltfInstanceBufferArenaState;
  requireActiveFrame(state);
  preflightBinding(key, localModels, localModelSignature, rootModels);
  const instanceCount = localModels.length;
  const resource = gltfInstanceBufferResource(state, key);
  growRootSnapshots(resource, instanceCount);
  const staging = prepareVertexInputInstance(
    state.vertexInputs,
    gl,
    contextGeneration,
    resource.allocation,
    instanceCount,
  );
  const previousInstanceCount = resource.instanceCount;
  const previousSignature = resource.localSignature;
  const previousStride = previousSignature === undefined
    ? undefined
    : gltfInstanceSignatureStride(previousInstanceCount, previousSignature);
  const nextStride = gltfInstanceSignatureStride(instanceCount, localModelSignature);
  const signatureShapeChanged = previousSignature === undefined
    || previousStride === undefined
    || nextStride === undefined
    || previousStride !== nextStride
    || previousSignature.length !== localModelSignature.length
    || previousInstanceCount !== instanceCount;
  const fullUpload = staging.forceFull || signatureShapeChanged;
  let rangeCount = 0;
  let rangeStart = -1;
  for (let modelIndex = 0; modelIndex < instanceCount; modelIndex += 1) {
    const signatureOffset = modelIndex * (nextStride ?? 0);
    const localChanged = fullUpload
      || (localModelSignatureDirty && (
        previousSignature === undefined
        || nextStride === undefined
        || !sameGltfModelSignatureRange(
          previousSignature,
          localModelSignature,
          signatureOffset,
          nextStride,
        )
      ));
    const rootOffset = modelIndex * 16;
    const root = rootModels[modelIndex]!;
    const rootChanged = fullUpload || !sameRootSnapshot(resource.rootSnapshots, rootOffset, root);
    if (!localChanged && !rootChanged) {
      if (rangeStart >= 0) {
        staging.ranges[rangeCount * 2] = rangeStart;
        staging.ranges[rangeCount * 2 + 1] = modelIndex;
        rangeCount += 1;
        rangeStart = -1;
      }
      continue;
    }
    copyRootSnapshot(resource.rootSnapshots, rootOffset, root);
    multiplyMat4Into(state.modelWorkspace, root, localModels[modelIndex]!);
    staging.models.set(state.modelWorkspace, rootOffset);
    if (rangeStart < 0) rangeStart = modelIndex;
  }
  if (rangeStart >= 0) {
    staging.ranges[rangeCount * 2] = rangeStart;
    staging.ranges[rangeCount * 2 + 1] = instanceCount;
    rangeCount += 1;
  }
  if (fullUpload || rangeCount > 0) {
    recordModelUpload(counters, uploadVertexInputInstanceLane(
      state.vertexInputs,
      gl,
      contextGeneration,
      resource.allocation,
      "models",
      rangeCount,
    ));
  }
  if (signatureShapeChanged || localModelSignatureDirty) {
    resource.localSignature = copyGltfInstanceSignature(
      resource.localSignature,
      localModelSignature,
    );
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
