import type { CpuGeometry } from "./geometry-recipes";
import { claimMonotonicId, MAX_RESOURCE_ID } from "./resource-id";
import {
  findVerifiedGeometry,
  GEOMETRY_BUCKET_COMPARISON_LIMIT,
  sameGeometryBytes,
} from "./webgl/geometry-identity";
import { VERTEX_ATTRIBUTE } from "./webgl/vertex-attribute-abi";

export interface VertexInputSemanticRow {
  readonly geometryId: number;
  readonly recipe: CpuGeometry;
}

interface VertexInputInstanceBuffers {
  readonly localModelBuffer: WebGLBuffer;
  readonly rootPoseBuffer: WebGLBuffer;
  readonly rootScaleBuffer: WebGLBuffer;
}

declare const vertexInputInstanceAuthority: unique symbol;

/** Opaque semantic allocation for the fixed glTF instance-attribute ABI. */
export interface VertexInputInstanceAllocation {
  readonly [vertexInputInstanceAuthority]: "VertexInputInstanceAllocation";
}

export type VertexInputInstanceLane = "localModels" | "rootPoses" | "rootScales";

export interface VertexInputInstanceStaging {
  /** True when preparation requires callers to repopulate every active lane element. */
  readonly forceFull: boolean;
  readonly localModels: Float32Array;
  /** Reusable packed [start, end) instance pairs, consumed one lane at a time. */
  readonly ranges: Int32Array;
  readonly rootPoses: Float32Array;
  readonly rootScales: Float32Array;
}

export interface VertexInputInstanceLaneUploadStats {
  readonly bytes: number;
  readonly calls: number;
}

export interface VertexInputGeometry {
  readonly arrayBuffer: WebGLBuffer;
  readonly colorBuffer?: WebGLBuffer;
  readonly drawCount: number;
  readonly indexBuffer?: WebGLBuffer;
  readonly indexType?: number;
  readonly mode: CpuGeometry["mode"];
  readonly normalBuffer?: WebGLBuffer;
  readonly source: CpuGeometry;
  /** Generation-local physical identity; never a semantic or frame-packet resource ID. */
  readonly staticIdentityId: number;
  readonly tangentBuffer?: WebGLBuffer;
  readonly texCoord0Buffer?: WebGLBuffer;
  readonly texCoord1Buffer?: WebGLBuffer;
  readonly vertexCount: number;
}

export interface VertexInputArenaSnapshot {
  readonly abandonedBufferCount: number;
  readonly abandonedVertexArrayCount: number;
  readonly baseVertexArrayCount: number;
  readonly compositeVertexArrayCount: number;
  readonly contextGeneration?: number;
  readonly instanceGeometryEdges: ReadonlyMap<number, ReadonlySet<number>>;
  readonly instanceAllocationCount: number;
  readonly instanceAllocationIds: ReadonlySet<number>;
  readonly identityBucketSizes: ReadonlyMap<string, number>;
  readonly pendingBufferDeleteCount: number;
  readonly pendingVertexArrayDeleteCount: number;
  readonly semanticGeometryIds: ReadonlySet<number>;
  readonly semanticGeometryCount: number;
  readonly staticGeometryCount: number;
}

type CompositeVertexArray = {
  readonly buffers: VertexInputInstanceBuffers;
  geometryReferenceCount: number;
  readonly vertexArray: WebGLVertexArrayObject;
};

type StaticGeometry = VertexInputGeometry & {
  baseVertexArray?: WebGLVertexArrayObject;
  readonly bucketKey: string;
  readonly compositeVertexArrays: Map<number, CompositeVertexArray>;
  readonly geometryIds: Set<number>;
  joinedIdentityBucket: boolean;
  /** Driver handles still owned while a fallible release is resumed. */
  pendingBufferDeletes?: Set<WebGLBuffer>;
};

type SemanticGeometry = {
  readonly geometryId: number;
  readonly instanceKeys: Set<number>;
  readonly recipe: CpuGeometry;
  staticGeometry?: StaticGeometry;
};

type InstanceAllocationToken = {
  readonly id: number;
};

type OwnedInstanceAllocation = {
  readonly allocation: InstanceAllocationToken;
  bufferCapacity: number;
  buffers?: VertexInputInstanceBuffers;
  /** Driver handles still owned while a fallible release is resumed. */
  pendingBufferDeletes?: Set<WebGLBuffer>;
  capacity: number;
  instanceCount: number;
  localModelsDirty: boolean;
  readonly localModelsStats: MutableInstanceLaneUploadStats;
  rootPosesDirty: boolean;
  readonly rootPosesStats: MutableInstanceLaneUploadStats;
  rootScalesDirty: boolean;
  readonly rootScalesStats: MutableInstanceLaneUploadStats;
  readonly staging: MutableInstanceStaging;
};

type MutableInstanceStaging = {
  forceFull: boolean;
  localModels: Float32Array;
  ranges: Int32Array;
  rootPoses: Float32Array;
  rootScales: Float32Array;
};

type MutableInstanceLaneUploadStats = {
  bytes: number;
  calls: number;
};

declare const vertexInputArenaAuthority: unique symbol;

/** Explicit authority token; only this module can inspect or mutate its state. */
export interface VertexInputArena {
  readonly [vertexInputArenaAuthority]: "VertexInputArena";
}

interface VertexInputArenaState {
  abandonedBufferCount: number;
  abandonedVertexArrayCount: number;
  contextDropped: boolean;
  contextGeneration?: number;
  readonly geometryBuckets: Map<string, StaticGeometry[]>;
  readonly instanceBuffers: Map<number, VertexInputInstanceBuffers>;
  readonly instanceGeometryIds: Map<number, Set<number>>;
  nextInstanceId: number;
  nextStaticIdentityId: number;
  readonly ownedInstances: Map<number, OwnedInstanceAllocation>;
  /** Handles created by a transaction which failed before it could publish them. */
  readonly pendingBufferDeletes: Set<WebGLBuffer>;
  readonly pendingVertexArrayDeletes: Set<WebGLVertexArrayObject>;
  readonly semantics: Map<number, SemanticGeometry>;
  readonly staticGeometries: Set<StaticGeometry>;
}

export const createVertexInputArena = (): VertexInputArena => ({
  abandonedBufferCount: 0,
  abandonedVertexArrayCount: 0,
  contextDropped: false,
  geometryBuckets: new Map(),
  instanceBuffers: new Map(),
  instanceGeometryIds: new Map(),
  nextInstanceId: 1,
  nextStaticIdentityId: 1,
  ownedInstances: new Map(),
  pendingBufferDeletes: new Set(),
  pendingVertexArrayDeletes: new Set(),
  semantics: new Map(),
  staticGeometries: new Set(),
} as unknown as VertexInputArena);

const validSerial = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label} ${value}`);
};

const validGeometryId = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RESOURCE_ID) {
    throw new Error(`Invalid geometry ID ${value}; expected an unsigned 32-bit resource ID`);
  }
};

const instanceAllocation = (
  state: VertexInputArenaState,
  allocation: VertexInputInstanceAllocation,
): OwnedInstanceAllocation => {
  const token = allocation as unknown as InstanceAllocationToken;
  const resource = state.ownedInstances.get(token.id);
  if (resource === undefined || resource.allocation !== token) {
    throw new Error("Vertex-input instance allocation is not owned by this arena");
  }
  return resource;
};

export const createVertexInputInstanceAllocation = (
  arena: VertexInputArena,
): VertexInputInstanceAllocation => {
  const state = arena as unknown as VertexInputArenaState;
  const id = claimMonotonicId(
    state.nextInstanceId,
    MAX_RESOURCE_ID,
    "Vertex-input instance allocation",
  );
  const allocation: InstanceAllocationToken = { id };
  state.nextInstanceId = id + 1;
  state.ownedInstances.set(id, {
    allocation,
    bufferCapacity: 0,
    capacity: 0,
    instanceCount: 0,
    localModelsDirty: true,
    localModelsStats: { bytes: 0, calls: 0 },
    rootPosesDirty: true,
    rootPosesStats: { bytes: 0, calls: 0 },
    rootScalesDirty: true,
    rootScalesStats: { bytes: 0, calls: 0 },
    staging: {
      forceFull: true,
      localModels: new Float32Array(),
      ranges: new Int32Array(),
      rootPoses: new Float32Array(),
      rootScales: new Float32Array(),
    },
  });
  return allocation as unknown as VertexInputInstanceAllocation;
};

export const retainVertexInputGeometry = (
  arena: VertexInputArena,
  row: VertexInputSemanticRow,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  validGeometryId(row.geometryId);
  const current = state.semantics.get(row.geometryId);
  if (current !== undefined) {
    if (!sameGeometryBytes(current.recipe, row.recipe)) {
      throw new Error(`Vertex-input geometry ID ${row.geometryId} changed recipe bytes`);
    }
    return;
  }
  state.semantics.set(row.geometryId, {
    geometryId: row.geometryId,
    instanceKeys: new Set(),
    recipe: row.recipe,
  });
};

const createBuffer = (gl: WebGL2RenderingContext): WebGLBuffer => {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error("WebGL vertex buffer creation failed");
  return buffer;
};

const createVertexArray = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => {
  const vertexArray = gl.createVertexArray();
  if (vertexArray === null) throw new Error("WebGL vertex array creation failed");
  return vertexArray;
};

const NO_FAILURE: unique symbol = Symbol("vertex-input-no-failure");
type CapturedFailure = { readonly value: unknown };
type Failure = CapturedFailure | typeof NO_FAILURE;

const firstFailure = (failure: Failure, next: Failure): Failure =>
  failure === NO_FAILURE ? next : failure;

const captureFirstFailure = (failure: Failure, action: () => void): Failure => {
  try {
    action();
  } catch (error) {
    return firstFailure(failure, { value: error });
  }
  return failure;
};

const deletePendingBuffers = (
  gl: WebGL2RenderingContext,
  buffers: Set<WebGLBuffer>,
): Failure => {
  let failure: Failure = NO_FAILURE;
  for (const buffer of buffers) {
    failure = captureFirstFailure(failure, () => {
      gl.deleteBuffer(buffer);
      buffers.delete(buffer);
    });
  }
  return failure;
};

const deletePendingVertexArrays = (
  gl: WebGL2RenderingContext,
  vertexArrays: Set<WebGLVertexArrayObject>,
): Failure => {
  let failure: Failure = NO_FAILURE;
  for (const vertexArray of vertexArrays) {
    failure = captureFirstFailure(failure, () => {
      gl.deleteVertexArray(vertexArray);
      vertexArrays.delete(vertexArray);
    });
  }
  return failure;
};

const throwFailure = (failure: Failure): void => {
  if (failure !== NO_FAILURE) throw failure.value;
};

const unbindVertexInput = (gl: WebGL2RenderingContext): void => {
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
};

const uploadStaticGeometry = (
  state: VertexInputArenaState,
  gl: WebGL2RenderingContext,
  recipe: CpuGeometry,
  staticIdentityId: number,
): StaticGeometry => {
  const owned = new Set<WebGLBuffer>();
  const upload = (target: number, value: ArrayBufferView): WebGLBuffer => {
    const buffer = createBuffer(gl);
    owned.add(buffer);
    state.pendingBufferDeletes.add(buffer);
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, value, gl.STATIC_DRAW);
    return buffer;
  };
  try {
    gl.bindVertexArray(null);
    const arrayBuffer = upload(gl.ARRAY_BUFFER, recipe.positions);
    const normalBuffer = recipe.normals === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.normals);
    const tangentBuffer = recipe.tangents === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.tangents);
    const colorBuffer = recipe.colors === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.colors);
    const texCoord0Buffer = recipe.texCoords0 === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.texCoords0);
    const texCoord1Buffer = recipe.texCoords1 === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.texCoords1);
    const indexBuffer = recipe.indices === undefined
      ? undefined
      : upload(gl.ELEMENT_ARRAY_BUFFER, recipe.indices);
    const indexType = recipe.indices === undefined
      ? undefined
      : recipe.indices instanceof Uint32Array
        ? gl.UNSIGNED_INT
        : recipe.indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
    const geometry: StaticGeometry = {
      arrayBuffer,
      bucketKey: recipe.bucketKey,
      ...(colorBuffer === undefined ? {} : { colorBuffer }),
      compositeVertexArrays: new Map(),
      drawCount: recipe.indices?.length ?? recipe.positions.length / 3,
      geometryIds: new Set(),
      ...(indexBuffer === undefined ? {} : { indexBuffer }),
      ...(indexType === undefined ? {} : { indexType }),
      mode: recipe.mode,
      joinedIdentityBucket: false,
      ...(normalBuffer === undefined ? {} : { normalBuffer }),
      source: recipe,
      staticIdentityId,
      ...(tangentBuffer === undefined ? {} : { tangentBuffer }),
      ...(texCoord0Buffer === undefined ? {} : { texCoord0Buffer }),
      ...(texCoord1Buffer === undefined ? {} : { texCoord1Buffer }),
      vertexCount: recipe.positions.length / 3,
    };
    unbindVertexInput(gl);
    for (const buffer of owned) state.pendingBufferDeletes.delete(buffer);
    return geometry;
  } catch (error) {
    let failure: Failure = { value: error };
    const cleanupFailure = deletePendingBuffers(gl, state.pendingBufferDeletes);
    failure = firstFailure(failure, cleanupFailure);
    failure = captureFirstFailure(failure, () => unbindVertexInput(gl));
    throwFailure(failure);
    throw new Error("Unreachable vertex-input static upload cleanup");
  }
};

const forgetContextHandles = (state: VertexInputArenaState, dropped: boolean): void => {
  for (const semantic of state.semantics.values()) {
    semantic.instanceKeys.clear();
    delete semantic.staticGeometry;
  }
  state.geometryBuckets.clear();
  state.instanceBuffers.clear();
  state.instanceGeometryIds.clear();
  state.pendingBufferDeletes.clear();
  state.pendingVertexArrayDeletes.clear();
  for (const resource of state.ownedInstances.values()) {
    resource.bufferCapacity = 0;
    delete resource.buffers;
    delete resource.pendingBufferDeletes;
    resource.localModelsDirty = true;
    resource.rootPosesDirty = true;
    resource.rootScalesDirty = true;
    resource.staging.forceFull = true;
  }
  state.nextStaticIdentityId = 1;
  state.staticGeometries.clear();
  delete state.contextGeneration;
  state.contextDropped = dropped;
};

const accountAbandonedContextHandles = (state: VertexInputArenaState): void => {
  const buffers = new Set<WebGLBuffer>(state.pendingBufferDeletes);
  const vertexArrays = new Set<WebGLVertexArrayObject>(state.pendingVertexArrayDeletes);
  for (const geometry of state.staticGeometries) {
    if (geometry.pendingBufferDeletes !== undefined) {
      for (const buffer of geometry.pendingBufferDeletes) buffers.add(buffer);
    } else {
      buffers.add(geometry.arrayBuffer);
      if (geometry.normalBuffer !== undefined) buffers.add(geometry.normalBuffer);
      if (geometry.tangentBuffer !== undefined) buffers.add(geometry.tangentBuffer);
      if (geometry.colorBuffer !== undefined) buffers.add(geometry.colorBuffer);
      if (geometry.texCoord0Buffer !== undefined) buffers.add(geometry.texCoord0Buffer);
      if (geometry.texCoord1Buffer !== undefined) buffers.add(geometry.texCoord1Buffer);
      if (geometry.indexBuffer !== undefined) buffers.add(geometry.indexBuffer);
    }
    if (geometry.baseVertexArray !== undefined) vertexArrays.add(geometry.baseVertexArray);
    for (const composite of geometry.compositeVertexArrays.values()) {
      vertexArrays.add(composite.vertexArray);
    }
  }
  for (const resource of state.ownedInstances.values()) {
    if (resource.pendingBufferDeletes !== undefined) {
      for (const buffer of resource.pendingBufferDeletes) buffers.add(buffer);
    } else if (resource.buffers !== undefined) {
      buffers.add(resource.buffers.localModelBuffer);
      buffers.add(resource.buffers.rootPoseBuffer);
      buffers.add(resource.buffers.rootScaleBuffer);
    }
  }
  state.abandonedBufferCount += buffers.size;
  state.abandonedVertexArrayCount += vertexArrays.size;
};

const requireContextGeneration = (state: VertexInputArenaState, contextGeneration: number): void => {
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === undefined) {
    if (state.contextDropped) {
      throw new Error("Vertex-input context was dropped; restore it explicitly before resolving GPU handles");
    }
    state.contextGeneration = contextGeneration;
    return;
  }
  if (state.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${state.contextGeneration}, received ${contextGeneration}`,
    );
  }
};

const createOwnedInstanceBuffers = (
  state: VertexInputArenaState,
  gl: WebGL2RenderingContext,
  capacity: number,
): VertexInputInstanceBuffers => {
  const owned = new Set<WebGLBuffer>();
  const create = (floatsPerInstance: number): WebGLBuffer => {
    const buffer = createBuffer(gl);
    owned.add(buffer);
    state.pendingBufferDeletes.add(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      capacity * floatsPerInstance * Float32Array.BYTES_PER_ELEMENT,
      gl.DYNAMIC_DRAW,
    );
    return buffer;
  };
  try {
    const buffers = {
      localModelBuffer: create(16),
      rootPoseBuffer: create(6),
      rootScaleBuffer: create(3),
    };
    unbindVertexInput(gl);
    for (const buffer of owned) state.pendingBufferDeletes.delete(buffer);
    return buffers;
  } catch (error) {
    let failure: Failure = { value: error };
    const cleanupFailure = deletePendingBuffers(gl, state.pendingBufferDeletes);
    failure = firstFailure(failure, cleanupFailure);
    failure = captureFirstFailure(failure, () => unbindVertexInput(gl));
    throwFailure(failure);
    throw new Error("Vertex-input instance-buffer creation failed without an error");
  }
};

const resizeOwnedInstanceBuffers = (
  gl: WebGL2RenderingContext,
  buffers: VertexInputInstanceBuffers,
  capacity: number,
): void => {
  try {
    for (const [buffer, floatsPerInstance] of [
      [buffers.localModelBuffer, 16],
      [buffers.rootPoseBuffer, 6],
      [buffers.rootScaleBuffer, 3],
    ] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        capacity * floatsPerInstance * Float32Array.BYTES_PER_ELEMENT,
        gl.DYNAMIC_DRAW,
      );
    }
  } finally {
    unbindVertexInput(gl);
  }
};

const markAllInstanceLanesDirty = (resource: OwnedInstanceAllocation): void => {
  resource.localModelsDirty = true;
  resource.rootPosesDirty = true;
  resource.rootScalesDirty = true;
  resource.staging.forceFull = true;
};

export const prepareVertexInputInstance = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  allocation: VertexInputInstanceAllocation,
  instanceCount: number,
): VertexInputInstanceStaging => {
  const state = arena as unknown as VertexInputArenaState;
  requireContextGeneration(state, contextGeneration);
  const resource = instanceAllocation(state, allocation);
  validSerial(instanceCount, "instance count");
  const countChanged = resource.instanceCount !== instanceCount;
  const grew = instanceCount > resource.capacity;
  if (grew || countChanged || resource.buffers === undefined) markAllInstanceLanesDirty(resource);
  if (grew) {
    const localModels = new Float32Array(instanceCount * 16);
    const rootPoses = new Float32Array(instanceCount * 6);
    const rootScales = new Float32Array(instanceCount * 3);
    const ranges = new Int32Array(instanceCount * 2);
    localModels.set(resource.staging.localModels.subarray(0, resource.instanceCount * 16));
    rootPoses.set(resource.staging.rootPoses.subarray(0, resource.instanceCount * 6));
    rootScales.set(resource.staging.rootScales.subarray(0, resource.instanceCount * 3));
    const previousBuffers = resource.buffers;
    if (previousBuffers === undefined) {
      resource.buffers = createOwnedInstanceBuffers(state, gl, instanceCount);
    } else {
      resizeOwnedInstanceBuffers(gl, previousBuffers, instanceCount);
    }
    resource.bufferCapacity = instanceCount;
    resource.capacity = instanceCount;
    resource.staging.localModels = localModels;
    resource.staging.rootPoses = rootPoses;
    resource.staging.rootScales = rootScales;
    resource.staging.ranges = ranges;
  } else if (resource.buffers === undefined) {
    resource.buffers = createOwnedInstanceBuffers(state, gl, resource.capacity);
    resource.bufferCapacity = resource.capacity;
  }
  resource.instanceCount = instanceCount;
  resource.staging.forceFull = resource.localModelsDirty
    || resource.rootPosesDirty
    || resource.rootScalesDirty;
  return resource.staging;
};

export const uploadVertexInputInstanceLane = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  allocation: VertexInputInstanceAllocation,
  lane: VertexInputInstanceLane,
  rangeCount: number,
): VertexInputInstanceLaneUploadStats => {
  const state = arena as unknown as VertexInputArenaState;
  requireContextGeneration(state, contextGeneration);
  const resource = instanceAllocation(state, allocation);
  validSerial(rangeCount, "instance upload range count");
  if (rangeCount * 2 > resource.staging.ranges.length) {
    throw new Error(`Invalid instance upload range count ${rangeCount}`);
  }
  let buffer: WebGLBuffer | undefined;
  let data: Float32Array;
  let stride: number;
  let forceFull: boolean;
  let stats: MutableInstanceLaneUploadStats;
  if (lane === "localModels") {
    buffer = resource.buffers?.localModelBuffer;
    data = resource.staging.localModels;
    stride = 16;
    forceFull = resource.localModelsDirty;
    stats = resource.localModelsStats;
  } else if (lane === "rootPoses") {
    buffer = resource.buffers?.rootPoseBuffer;
    data = resource.staging.rootPoses;
    stride = 6;
    forceFull = resource.rootPosesDirty;
    stats = resource.rootPosesStats;
  } else {
    buffer = resource.buffers?.rootScaleBuffer;
    data = resource.staging.rootScales;
    stride = 3;
    forceFull = resource.rootScalesDirty;
    stats = resource.rootScalesStats;
  }
  if (buffer === undefined) throw new Error("Vertex-input instance must be prepared before upload");
  const actualRangeCount = forceFull ? (resource.instanceCount === 0 ? 0 : 1) : rangeCount;
  let previousEnd = 0;
  for (let rangeIndex = 0; rangeIndex < actualRangeCount; rangeIndex += 1) {
    const start = forceFull ? 0 : resource.staging.ranges[rangeIndex * 2]!;
    const end = forceFull ? resource.instanceCount : resource.staging.ranges[rangeIndex * 2 + 1]!;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < previousEnd || start < 0 || end <= start || end > resource.instanceCount) {
      throw new Error(`Invalid ${lane} upload range [${start}, ${end})`);
    }
    previousEnd = end;
  }
  let bytes = 0;
  try {
    if (actualRangeCount > 0) gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (let rangeIndex = 0; rangeIndex < actualRangeCount; rangeIndex += 1) {
      const start = forceFull ? 0 : resource.staging.ranges[rangeIndex * 2]!;
      const end = forceFull ? resource.instanceCount : resource.staging.ranges[rangeIndex * 2 + 1]!;
      const sourceOffset = start * stride;
      const floatCount = (end - start) * stride;
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        sourceOffset * Float32Array.BYTES_PER_ELEMENT,
        data,
        sourceOffset,
        floatCount,
      );
      bytes += floatCount * Float32Array.BYTES_PER_ELEMENT;
    }
    if (lane === "localModels") resource.localModelsDirty = false;
    else if (lane === "rootPoses") resource.rootPosesDirty = false;
    else resource.rootScalesDirty = false;
    resource.staging.forceFull = resource.localModelsDirty
      || resource.rootPosesDirty
      || resource.rootScalesDirty;
    stats.bytes = bytes;
    stats.calls = actualRangeCount;
    return stats;
  } catch (error) {
    if (lane === "localModels") resource.localModelsDirty = true;
    else if (lane === "rootPoses") resource.rootPosesDirty = true;
    else resource.rootScalesDirty = true;
    resource.staging.forceFull = true;
    throw error;
  } finally {
    unbindVertexInput(gl);
  }
};

export const restoreVertexInputArenaContext = (
  arena: VertexInputArena,
  contextGeneration: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === contextGeneration) return;
  if (state.contextGeneration !== undefined) {
    throw new Error(
      `Cannot restore vertex-input generation ${contextGeneration} while generation ${state.contextGeneration} is active`,
    );
  }
  state.contextDropped = false;
  state.contextGeneration = contextGeneration;
};

const resolveStaticGeometry = (
  state: VertexInputArenaState,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  semantic: SemanticGeometry,
): StaticGeometry => {
  requireContextGeneration(state, contextGeneration);
  if (semantic.staticGeometry !== undefined) return semantic.staticGeometry;
  const bucket = state.geometryBuckets.get(semantic.recipe.bucketKey);
  let resource = bucket === undefined
    ? undefined
    : findVerifiedGeometry(bucket, semantic.recipe, GEOMETRY_BUCKET_COMPARISON_LIMIT);
  if (resource === undefined) {
    const id = claimMonotonicId(
      state.nextStaticIdentityId,
      Number.MAX_SAFE_INTEGER,
      "Vertex-input static identity",
    );
    resource = uploadStaticGeometry(state, gl, semantic.recipe, id);
    state.nextStaticIdentityId = id + 1;
    state.staticGeometries.add(resource);
    if ((bucket?.length ?? 0) < GEOMETRY_BUCKET_COMPARISON_LIMIT) {
      resource.joinedIdentityBucket = true;
      if (bucket === undefined) state.geometryBuckets.set(semantic.recipe.bucketKey, [resource]);
      else bucket.push(resource);
    }
  }
  resource.geometryIds.add(semantic.geometryId);
  semantic.staticGeometry = resource;
  return resource;
};

export const vertexInputGeometry = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
): VertexInputGeometry => {
  const state = arena as unknown as VertexInputArenaState;
  const semantic = state.semantics.get(geometryId);
  if (semantic === undefined) throw new Error(`Vertex-input geometry ID ${geometryId} is not retained`);
  return resolveStaticGeometry(state, gl, contextGeneration, semantic);
};

const configureStaticAttributes = (gl: WebGL2RenderingContext, geometry: StaticGeometry): void => {
  gl.bindBuffer(gl.ARRAY_BUFFER, geometry.arrayBuffer);
  gl.enableVertexAttribArray(VERTEX_ATTRIBUTE.position);
  gl.vertexAttribPointer(VERTEX_ATTRIBUTE.position, 3, gl.FLOAT, false, 0, 0);
  for (const [location, buffer, size] of [
    [VERTEX_ATTRIBUTE.normal, geometry.normalBuffer, 3],
    [VERTEX_ATTRIBUTE.tangent, geometry.tangentBuffer, 4],
    [VERTEX_ATTRIBUTE.color, geometry.colorBuffer, 4],
    [VERTEX_ATTRIBUTE.texCoord0, geometry.texCoord0Buffer, 2],
    [VERTEX_ATTRIBUTE.texCoord1, geometry.texCoord1Buffer, 2],
  ] as const) {
    if (buffer === undefined) {
      gl.disableVertexAttribArray(location);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer ?? null);
};

export const vertexInputBaseVertexArray = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
): WebGLVertexArrayObject => {
  const state = arena as unknown as VertexInputArenaState;
  const semantic = state.semantics.get(geometryId);
  if (semantic === undefined) throw new Error(`Vertex-input geometry ID ${geometryId} is not retained`);
  const geometry = resolveStaticGeometry(state, gl, contextGeneration, semantic);
  if (geometry.baseVertexArray !== undefined) return geometry.baseVertexArray;
  const vertexArray = createVertexArray(gl);
  state.pendingVertexArrayDeletes.add(vertexArray);
  try {
    gl.bindVertexArray(vertexArray);
    configureStaticAttributes(gl, geometry);
    unbindVertexInput(gl);
    geometry.baseVertexArray = vertexArray;
    state.pendingVertexArrayDeletes.delete(vertexArray);
    return vertexArray;
  } catch (error) {
    let failure: Failure = { value: error };
    const cleanupFailure = deletePendingVertexArrays(gl, state.pendingVertexArrayDeletes);
    failure = firstFailure(failure, cleanupFailure);
    failure = captureFirstFailure(failure, () => unbindVertexInput(gl));
    throwFailure(failure);
    throw new Error("Vertex-input base VAO creation failed without an error");
  }
};

const sameInstanceBuffers = (left: VertexInputInstanceBuffers, right: VertexInputInstanceBuffers): boolean =>
  left.localModelBuffer === right.localModelBuffer
  && left.rootPoseBuffer === right.rootPoseBuffer
  && left.rootScaleBuffer === right.rootScaleBuffer;

const configureInstanceAttributes = (gl: WebGL2RenderingContext, buffers: VertexInputInstanceBuffers): void => {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.localModelBuffer);
  for (let column = 0; column < 4; column += 1) {
    const location = VERTEX_ATTRIBUTE.instanceLocalModelFirstColumn + column;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 64, column * 16);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.rootPoseBuffer);
  gl.enableVertexAttribArray(VERTEX_ATTRIBUTE.instancePosition);
  gl.vertexAttribPointer(VERTEX_ATTRIBUTE.instancePosition, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribDivisor(VERTEX_ATTRIBUTE.instancePosition, 1);
  gl.enableVertexAttribArray(VERTEX_ATTRIBUTE.instanceRotation);
  gl.vertexAttribPointer(VERTEX_ATTRIBUTE.instanceRotation, 3, gl.FLOAT, false, 24, 12);
  gl.vertexAttribDivisor(VERTEX_ATTRIBUTE.instanceRotation, 1);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.rootScaleBuffer);
  gl.enableVertexAttribArray(VERTEX_ATTRIBUTE.instanceScale);
  gl.vertexAttribPointer(VERTEX_ATTRIBUTE.instanceScale, 3, gl.FLOAT, false, 12, 0);
  gl.vertexAttribDivisor(VERTEX_ATTRIBUTE.instanceScale, 1);
};

const vertexInputCompositeVertexArray = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
  instanceKey: number,
  buffers: VertexInputInstanceBuffers,
): WebGLVertexArrayObject => {
  const state = arena as unknown as VertexInputArenaState;
  validSerial(instanceKey, "instance key");
  const semantic = state.semantics.get(geometryId);
  if (semantic === undefined) throw new Error(`Vertex-input geometry ID ${geometryId} is not retained`);
  const geometry = resolveStaticGeometry(state, gl, contextGeneration, semantic);
  const retainedBuffers = state.instanceBuffers.get(instanceKey);
  if (retainedBuffers !== undefined && !sameInstanceBuffers(retainedBuffers, buffers)) {
    throw new Error(`Vertex-input instance key ${instanceKey} changed fixed ABI buffers`);
  }
  const cached = geometry.compositeVertexArrays.get(instanceKey);
  if (cached !== undefined) {
    if (!sameInstanceBuffers(cached.buffers, buffers)) {
      throw new Error(`Vertex-input instance key ${instanceKey} changed fixed ABI buffers`);
    }
    let ids = state.instanceGeometryIds.get(instanceKey);
    if (ids === undefined) {
      ids = new Set();
      state.instanceGeometryIds.set(instanceKey, ids);
    }
    if (!ids.has(geometryId)) {
      ids.add(geometryId);
      cached.geometryReferenceCount += 1;
    }
    semantic.instanceKeys.add(instanceKey);
    return cached.vertexArray;
  }
  const vertexArray = createVertexArray(gl);
  state.pendingVertexArrayDeletes.add(vertexArray);
  try {
    gl.bindVertexArray(vertexArray);
    configureStaticAttributes(gl, geometry);
    configureInstanceAttributes(gl, buffers);
    unbindVertexInput(gl);
    geometry.compositeVertexArrays.set(instanceKey, { buffers, geometryReferenceCount: 1, vertexArray });
    state.instanceBuffers.set(instanceKey, buffers);
    let ids = state.instanceGeometryIds.get(instanceKey);
    if (ids === undefined) {
      ids = new Set();
      state.instanceGeometryIds.set(instanceKey, ids);
    }
    ids.add(geometryId);
    semantic.instanceKeys.add(instanceKey);
    state.pendingVertexArrayDeletes.delete(vertexArray);
    return vertexArray;
  } catch (error) {
    let failure: Failure = { value: error };
    const cleanupFailure = deletePendingVertexArrays(gl, state.pendingVertexArrayDeletes);
    failure = firstFailure(failure, cleanupFailure);
    failure = captureFirstFailure(failure, () => unbindVertexInput(gl));
    throwFailure(failure);
    throw new Error("Vertex-input composite VAO creation failed without an error");
  }
};

/** Resolves a composite VAO using the three buffers owned by an opaque allocation. */
export const vertexInputCompositeVertexArrayForInstance = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
  allocation: VertexInputInstanceAllocation,
): WebGLVertexArrayObject => {
  const state = arena as unknown as VertexInputArenaState;
  const resource = instanceAllocation(state, allocation);
  if (resource.buffers === undefined
    || resource.localModelsDirty || resource.rootPosesDirty || resource.rootScalesDirty) {
    prepareVertexInputInstance(arena, gl, contextGeneration, allocation, resource.instanceCount);
    uploadVertexInputInstanceLane(arena, gl, contextGeneration, allocation, "localModels", 0);
    uploadVertexInputInstanceLane(arena, gl, contextGeneration, allocation, "rootPoses", 0);
    uploadVertexInputInstanceLane(arena, gl, contextGeneration, allocation, "rootScales", 0);
  } else {
    requireContextGeneration(state, contextGeneration);
  }
  if (resource.buffers === undefined) throw new Error("Vertex-input instance buffers were not created");
  return vertexInputCompositeVertexArray(
    arena,
    gl,
    contextGeneration,
    geometryId,
    resource.allocation.id,
    resource.buffers,
  );
};

const deleteStaticBuffers = (gl: WebGL2RenderingContext, geometry: StaticGeometry): void => {
  const buffers = geometry.pendingBufferDeletes ??= new Set<WebGLBuffer>([
      geometry.arrayBuffer,
      ...(geometry.normalBuffer === undefined ? [] : [geometry.normalBuffer]),
      ...(geometry.tangentBuffer === undefined ? [] : [geometry.tangentBuffer]),
      ...(geometry.colorBuffer === undefined ? [] : [geometry.colorBuffer]),
      ...(geometry.texCoord0Buffer === undefined ? [] : [geometry.texCoord0Buffer]),
      ...(geometry.texCoord1Buffer === undefined ? [] : [geometry.texCoord1Buffer]),
      ...(geometry.indexBuffer === undefined ? [] : [geometry.indexBuffer]),
    ]);
  throwFailure(deletePendingBuffers(gl, buffers));
  delete geometry.pendingBufferDeletes;
};

const removeStaticGeometry = (
  state: VertexInputArenaState,
  gl: WebGL2RenderingContext,
  geometry: StaticGeometry,
): void => {
  let failure: Failure = NO_FAILURE;
  for (const [instanceKey, composite] of geometry.compositeVertexArrays) {
    if (composite.geometryReferenceCount !== 0) continue;
    failure = captureFirstFailure(failure, () => {
      gl.deleteVertexArray(composite.vertexArray);
      geometry.compositeVertexArrays.delete(instanceKey);
    });
  }
  if (geometry.compositeVertexArrays.size !== 0) {
    throwFailure(failure);
    throw new Error("Cannot remove vertex-input static geometry with live composite references");
  }
  if (geometry.baseVertexArray !== undefined) {
    failure = captureFirstFailure(failure, () => {
      gl.deleteVertexArray(geometry.baseVertexArray!);
      delete geometry.baseVertexArray;
    });
  }
  if (geometry.baseVertexArray !== undefined) throwFailure(failure);
  failure = captureFirstFailure(failure, () => deleteStaticBuffers(gl, geometry));
  throwFailure(failure);
  const bucket = geometry.joinedIdentityBucket ? state.geometryBuckets.get(geometry.bucketKey) : undefined;
  if (bucket !== undefined) {
    const index = bucket.indexOf(geometry);
    if (index >= 0) bucket.splice(index, 1);
    if (bucket.length === 0) state.geometryBuckets.delete(geometry.bucketKey);
  }
  state.staticGeometries.delete(geometry);
};

const releaseVertexInputInstance = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  instanceKey: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === undefined) return;
  if (state.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${state.contextGeneration}, received ${contextGeneration}`,
    );
  }
  const ids = state.instanceGeometryIds.get(instanceKey);
  if (ids === undefined) return;
  const geometries = new Set<StaticGeometry>();
  for (const id of ids) {
    const semantic = state.semantics.get(id);
    const geometry = semantic?.staticGeometry;
    if (geometry !== undefined) geometries.add(geometry);
  }
  let failure: Failure = NO_FAILURE;
  for (const geometry of geometries) {
    const composite = geometry.compositeVertexArrays.get(instanceKey);
    if (composite === undefined) continue;
    failure = captureFirstFailure(failure, () => {
      gl.deleteVertexArray(composite.vertexArray);
      geometry.compositeVertexArrays.delete(instanceKey);
    });
  }
  failure = captureFirstFailure(failure, () => unbindVertexInput(gl));
  throwFailure(failure);
  for (const id of ids) state.semantics.get(id)?.instanceKeys.delete(instanceKey);
  state.instanceGeometryIds.delete(instanceKey);
  state.instanceBuffers.delete(instanceKey);
};

const deleteOwnedInstanceBuffers = (
  gl: WebGL2RenderingContext,
  resource: OwnedInstanceAllocation,
): void => {
  if (resource.buffers === undefined && resource.pendingBufferDeletes === undefined) return;
  const buffers = resource.pendingBufferDeletes ??= new Set<WebGLBuffer>([
    resource.buffers!.localModelBuffer,
    resource.buffers!.rootPoseBuffer,
    resource.buffers!.rootScaleBuffer,
  ]);
  throwFailure(deletePendingBuffers(gl, buffers));
  delete resource.pendingBufferDeletes;
  resource.bufferCapacity = 0;
  delete resource.buffers;
};

export const releaseVertexInputInstanceAllocation = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  allocation: VertexInputInstanceAllocation,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  const resource = instanceAllocation(state, allocation);
  requireContextGeneration(state, contextGeneration);
  releaseVertexInputInstance(arena, gl, contextGeneration, resource.allocation.id);
  deleteOwnedInstanceBuffers(gl, resource);
  state.ownedInstances.delete(resource.allocation.id);
  unbindVertexInput(gl);
};

export const releaseLostVertexInputInstanceAllocation = (
  arena: VertexInputArena,
  allocation: VertexInputInstanceAllocation,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  const resource = instanceAllocation(state, allocation);
  if (state.contextGeneration !== undefined) {
    throw new Error("GL-free instance release requires a dropped vertex-input context");
  }
  state.ownedInstances.delete(resource.allocation.id);
};

export const releaseVertexInputGeometry = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  const semantic = state.semantics.get(geometryId);
  if (semantic === undefined) return;
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === undefined) {
    throw new Error("Lost-context geometry release must use releaseLostVertexInputGeometry");
  }
  if (state.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${state.contextGeneration}, received ${contextGeneration}`,
    );
  }
  const geometry = semantic.staticGeometry;
  if (geometry !== undefined) {
    geometry.geometryIds.delete(geometryId);
    for (const instanceKey of semantic.instanceKeys) {
      const ids = state.instanceGeometryIds.get(instanceKey);
      if (ids?.delete(geometryId)) {
        if (ids.size === 0) {
          state.instanceGeometryIds.delete(instanceKey);
          state.instanceBuffers.delete(instanceKey);
        }
        const composite = geometry.compositeVertexArrays.get(instanceKey);
        if (composite !== undefined) {
          composite.geometryReferenceCount -= 1;
          if (composite.geometryReferenceCount < 0) {
            throw new Error(`Vertex-input composite ${instanceKey} has negative semantic references`);
          }
        }
      }
      // This edge's semantic mutation is complete even when the subsequent
      // driver deletion fails. A retry must not decrement the reference again.
      semantic.instanceKeys.delete(instanceKey);
    }
    let releaseFailure: Failure = NO_FAILURE;
    for (const [instanceKey, composite] of geometry.compositeVertexArrays) {
      if (composite.geometryReferenceCount !== 0) continue;
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        gl.deleteVertexArray(composite.vertexArray);
        geometry.compositeVertexArrays.delete(instanceKey);
      });
    }
    throwFailure(releaseFailure);
    if (geometry.geometryIds.size === 0) removeStaticGeometry(state, gl, geometry);
    state.semantics.delete(geometryId);
    unbindVertexInput(gl);
    return;
  }
  state.semantics.delete(geometryId);
};

export const releaseLostVertexInputGeometry = (
  arena: VertexInputArena,
  geometryId: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  validGeometryId(geometryId);
  if (state.contextGeneration !== undefined) {
    throw new Error("GL-free geometry release requires a dropped vertex-input context");
  }
  state.semantics.delete(geometryId);
};

const releaseContextHandles = (
  state: VertexInputArenaState,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
): void => {
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === undefined) return;
  if (state.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${state.contextGeneration}, received ${contextGeneration}`,
    );
  }
  // Global ordering is deliberate: no static buffer is deleted while any VAO
  // owned by this arena can still retain it as ELEMENT_ARRAY_BUFFER state.
  // Every successful driver deletion is committed independently so a retry
  // never repeats it and multiple failures do not hide later progress.
  let failure: Failure = NO_FAILURE;
  for (const geometry of state.staticGeometries) {
    for (const [instanceKey, composite] of geometry.compositeVertexArrays) {
      failure = captureFirstFailure(failure, () => {
        gl.deleteVertexArray(composite.vertexArray);
        geometry.compositeVertexArrays.delete(instanceKey);
      });
    }
    if (geometry.baseVertexArray !== undefined) {
      failure = captureFirstFailure(failure, () => {
        gl.deleteVertexArray(geometry.baseVertexArray!);
        delete geometry.baseVertexArray;
      });
    }
  }
  const pendingVertexArrayFailure = deletePendingVertexArrays(gl, state.pendingVertexArrayDeletes);
  failure = firstFailure(failure, pendingVertexArrayFailure);
  failure = captureFirstFailure(failure, () => unbindVertexInput(gl));
  const hasVertexArrays = state.pendingVertexArrayDeletes.size !== 0
    || [...state.staticGeometries].some((geometry) =>
      geometry.baseVertexArray !== undefined || geometry.compositeVertexArrays.size !== 0);
  if (hasVertexArrays) {
    throwFailure(failure);
    throw new Error("Vertex-input context still owns vertex arrays after release");
  }
  for (const geometry of state.staticGeometries) {
    failure = captureFirstFailure(failure, () => deleteStaticBuffers(gl, geometry));
  }
  for (const resource of state.ownedInstances.values()) {
    failure = captureFirstFailure(failure, () => deleteOwnedInstanceBuffers(gl, resource));
  }
  const pendingBufferFailure = deletePendingBuffers(gl, state.pendingBufferDeletes);
  failure = firstFailure(failure, pendingBufferFailure);
  failure = captureFirstFailure(failure, () => unbindVertexInput(gl));
  throwFailure(failure);
  forgetContextHandles(state, false);
};

export const releaseVertexInputContextHandles = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  releaseContextHandles(state, gl, contextGeneration);
};

export const dropVertexInputArenaContext = (arena: VertexInputArena): void => {
  const state = arena as unknown as VertexInputArenaState;
  accountAbandonedContextHandles(state);
  forgetContextHandles(state, true);
};

export const disposeVertexInputArena = (
  arena: VertexInputArena,
  gl?: WebGL2RenderingContext,
  contextGeneration?: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  if ((gl === undefined) !== (contextGeneration === undefined)) {
    throw new Error("Vertex-input disposal requires both gl and contextGeneration, or neither");
  }
  if (gl !== undefined && contextGeneration !== undefined) {
    releaseContextHandles(state, gl, contextGeneration);
  } else {
    if (state.contextGeneration !== undefined) {
      throw new Error("Active vertex-input disposal requires gl and contextGeneration");
    }
    accountAbandonedContextHandles(state);
    forgetContextHandles(state, true);
  }
  state.semantics.clear();
  state.ownedInstances.clear();
};

export const vertexInputArenaSnapshot = (arena: VertexInputArena): VertexInputArenaSnapshot => {
  const state = arena as unknown as VertexInputArenaState;
  let bases = 0;
  let composites = 0;
  let pendingBufferDeletes = state.pendingBufferDeletes.size;
  for (const geometry of state.staticGeometries) {
    if (geometry.baseVertexArray !== undefined) bases += 1;
    composites += geometry.compositeVertexArrays.size;
    pendingBufferDeletes += geometry.pendingBufferDeletes?.size ?? 0;
  }
  for (const resource of state.ownedInstances.values()) {
    pendingBufferDeletes += resource.pendingBufferDeletes?.size ?? 0;
  }
  return {
    abandonedBufferCount: state.abandonedBufferCount,
    abandonedVertexArrayCount: state.abandonedVertexArrayCount,
    baseVertexArrayCount: bases,
    compositeVertexArrayCount: composites,
    ...(state.contextGeneration === undefined ? {} : { contextGeneration: state.contextGeneration }),
    identityBucketSizes: new Map(
      [...state.geometryBuckets].map(([key, geometries]) => [key, geometries.length]),
    ),
    instanceGeometryEdges: new Map(
      [...state.instanceGeometryIds].map(([key, ids]) => [key, new Set(ids)]),
    ),
    instanceAllocationCount: state.ownedInstances.size,
    instanceAllocationIds: new Set(state.ownedInstances.keys()),
    pendingBufferDeleteCount: pendingBufferDeletes,
    pendingVertexArrayDeleteCount: state.pendingVertexArrayDeletes.size,
    semanticGeometryCount: state.semantics.size,
    semanticGeometryIds: new Set(state.semantics.keys()),
    staticGeometryCount: state.staticGeometries.size,
  };
};
