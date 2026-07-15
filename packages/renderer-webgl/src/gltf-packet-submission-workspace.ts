import {
  FRAME_PACKET_RENDER_CLASS,
  FRAME_PACKET_SIDEDNESS,
  NO_FRAME_PACKET_ID,
  type FramePacketCatalog,
  type FramePacketRenderClass,
} from "./frame/packets";

const SUBMISSION_SIDEDNESS_MASK = FRAME_PACKET_SIDEDNESS.doubleSided
  | FRAME_PACKET_SIDEDNESS.frontFaceCcw;

export interface GltfPacketSubmissionRow {
  readonly geometryId: number;
  readonly geometryIdentityId: number;
  /** NO_FRAME_PACKET_ID denotes no asset-local light and requires lightScopeId 0. */
  readonly lightBindingId: number;
  readonly lightScopeId: number;
  readonly localModelId: number;
  readonly materialBindingId: number;
  readonly packetIndex: number;
  readonly renderClass: FramePacketRenderClass;
  readonly rootBindingId: number;
  readonly sidedness: number;
}

export interface MutableGltfPacketSubmissionRow {
  batchId: number;
  geometryId: number;
  geometryIdentityId: number;
  lightBindingId: number;
  lightScopeId: number;
  localModelId: number;
  materialBatchClassId: number;
  materialBindingId: number;
  packetIndex: number;
  renderClass: FramePacketRenderClass;
  rootBindingId: number;
  sidedness: number;
}

export interface GltfPacketSubmissionWorkspace<MaterialBinding, RootBinding, LightBinding> {
  capacity: number;
  batchIds: Uint32Array;
  catalog: FramePacketCatalog | undefined;
  catalogRevision: number;
  count: number;
  frameActive: boolean;
  geometryIds: Uint32Array;
  geometryIdentityIds: Float64Array;
  lightBindingCapacity: number;
  lightBindingCount: number;
  lightBindingIds: Uint32Array;
  lightBindingScopeIds: Float64Array;
  lightBindings: Array<LightBinding | undefined>;
  lightScopeIds: Float64Array;
  localModelIds: Uint32Array;
  materialBindingCapacity: number;
  materialBindingCount: number;
  materialBindingIds: Uint32Array;
  materialBindingBatchClassIds: Float64Array;
  materialBindingSourceIds: Uint32Array;
  materialBindings: Array<MaterialBinding | undefined>;
  materialBatchClassIds: Float64Array;
  nextViewIndex: number;
  orderingSegments: Uint32Array;
  packetIndices: Uint32Array;
  planRevision: number;
  renderClasses: Uint8Array;
  rootBindingCapacity: number;
  rootBindingCount: number;
  rootBindingIds: Uint32Array;
  rootBindingLightScopeIds: Float64Array;
  rootBindingOuterIndices: Uint32Array;
  rootBindingSourceIds: Uint32Array;
  rootBindings: Array<RootBinding | undefined>;
  segment: number;
  segmentRevision: number;
  sidedness: Uint8Array;
  viewIndex: number;
}

type WorkspaceState<MaterialBinding, RootBinding, LightBinding> =
  GltfPacketSubmissionWorkspace<MaterialBinding, RootBinding, LightBinding> & {
    lightBindingIdsByScope: Map<number, number>;
    materialBindingIdsBySource: Map<number, number>;
    rootBindingIdsBySource: Map<number, number>;
  };

const positiveCapacity = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Royal glTF packet submission ${label} capacity must be a positive safe integer`);
  }
  return value;
};

const uint32 = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`Royal glTF packet submission ${label} must be an unsigned 32-bit integer`);
  }
  return value;
};

const resourceId = (value: number, label: string): number => {
  const id = uint32(value, label);
  if (id === NO_FRAME_PACKET_ID) {
    throw new Error(`Royal glTF packet submission ${label} must be a resource ID`);
  }
  return id;
};

const safeId = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Royal glTF packet submission ${label} must be a nonnegative safe integer`);
  }
  return value;
};

const revision = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Royal glTF packet submission ${label} revision must be a positive safe integer`);
  }
  return value;
};

const nextCapacity = (current: number, required: number): number => {
  let capacity = current;
  while (capacity < required) capacity *= 2;
  return capacity;
};

const grownUint8 = (source: Uint8Array, capacity: number): Uint8Array => {
  const target = new Uint8Array(capacity);
  target.set(source);
  return target;
};

const grownUint32 = (source: Uint32Array, capacity: number): Uint32Array => {
  const target = new Uint32Array(capacity);
  target.set(source);
  return target;
};

const grownFloat64 = (source: Float64Array, capacity: number): Float64Array => {
  const target = new Float64Array(capacity);
  target.set(source);
  return target;
};

export const createGltfPacketSubmissionWorkspace = <MaterialBinding, RootBinding, LightBinding>(
  capacity = 1,
  bindingCapacity = 1,
): GltfPacketSubmissionWorkspace<MaterialBinding, RootBinding, LightBinding> => {
  const rows = positiveCapacity(capacity, "row");
  const bindings = positiveCapacity(bindingCapacity, "binding");
  return {
    batchIds: new Uint32Array(rows).fill(NO_FRAME_PACKET_ID),
    capacity: rows,
    catalog: undefined,
    catalogRevision: 0,
    count: 0,
    frameActive: false,
    geometryIds: new Uint32Array(rows),
    geometryIdentityIds: new Float64Array(rows),
    lightBindingCapacity: bindings,
    lightBindingCount: 0,
    lightBindingIds: new Uint32Array(rows),
    lightBindingIdsByScope: new Map(),
    lightBindingScopeIds: new Float64Array(bindings),
    lightBindings: Array.from<LightBinding | undefined>({ length: bindings }),
    lightScopeIds: new Float64Array(rows),
    localModelIds: new Uint32Array(rows),
    materialBindingCapacity: bindings,
    materialBindingCount: 0,
    materialBindingIds: new Uint32Array(rows),
    materialBindingBatchClassIds: new Float64Array(bindings),
    materialBindingIdsBySource: new Map(),
    materialBindingSourceIds: new Uint32Array(bindings),
    materialBindings: Array.from<MaterialBinding | undefined>({ length: bindings }),
    materialBatchClassIds: new Float64Array(rows),
    nextViewIndex: 0,
    orderingSegments: new Uint32Array(rows),
    packetIndices: new Uint32Array(rows),
    planRevision: 0,
    renderClasses: new Uint8Array(rows),
    rootBindingCapacity: bindings,
    rootBindingCount: 0,
    rootBindingIds: new Uint32Array(rows),
    rootBindingIdsBySource: new Map(),
    rootBindingLightScopeIds: new Float64Array(bindings),
    rootBindingOuterIndices: new Uint32Array(bindings),
    rootBindingSourceIds: new Uint32Array(bindings),
    rootBindings: Array.from<RootBinding | undefined>({ length: bindings }),
    segment: -1,
    segmentRevision: 0,
    sidedness: new Uint8Array(rows),
    viewIndex: -1,
  } as WorkspaceState<MaterialBinding, RootBinding, LightBinding>;
};

export const assertGltfPacketSubmissionWorkspaceCurrent = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
): void => {
  const normalizedPlanRevision = revision(planRevision, "plan");
  if (!workspace.frameActive
    || workspace.planRevision !== normalizedPlanRevision
    || workspace.catalog !== catalog
    || workspace.catalogRevision !== catalog.revision) {
    throw new Error("Royal glTF packet submission workspace is stale");
  }
};

const clearBindings = <M, R, L>(workspace: WorkspaceState<M, R, L>): void => {
  for (let index = 0; index < workspace.materialBindingCount; index += 1) {
    workspace.materialBindings[index] = undefined;
  }
  for (let index = 0; index < workspace.rootBindingCount; index += 1) {
    workspace.rootBindings[index] = undefined;
  }
  for (let index = 0; index < workspace.lightBindingCount; index += 1) {
    workspace.lightBindings[index] = undefined;
  }
  workspace.materialBindingCount = 0;
  workspace.rootBindingCount = 0;
  workspace.lightBindingCount = 0;
  workspace.materialBindingIdsBySource.clear();
  workspace.rootBindingIdsBySource.clear();
  workspace.lightBindingIdsByScope.clear();
};

const advanceSegmentRevision = <M, R, L>(workspace: GltfPacketSubmissionWorkspace<M, R, L>): void => {
  if (workspace.segmentRevision === Number.MAX_SAFE_INTEGER) {
    throw new Error("Royal glTF packet submission segment revision is exhausted");
  }
  workspace.segmentRevision += 1;
};

/** Releases live semantic bindings and invalidates the workspace while retaining numeric capacity. */
export const clearGltfPacketSubmissionWorkspace = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
): void => {
  const state = workspace as WorkspaceState<M, R, L>;
  clearBindings(state);
  state.catalog = undefined;
  state.catalogRevision = 0;
  state.count = 0;
  state.frameActive = false;
  state.nextViewIndex = 0;
  state.planRevision = 0;
  state.segment = -1;
  state.segmentRevision = 0;
  state.viewIndex = -1;
};

export const resetGltfPacketSubmissionWorkspaceForFrame = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
): void => {
  const state = workspace as WorkspaceState<M, R, L>;
  state.planRevision = revision(planRevision, "plan");
  state.catalog = catalog;
  state.catalogRevision = catalog.revision;
  state.count = 0;
  state.frameActive = true;
  state.nextViewIndex = 0;
  state.viewIndex = -1;
  state.segment = -1;
  advanceSegmentRevision(state);
  clearBindings(state);
};

export const resetGltfPacketSubmissionWorkspaceForView = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  viewIndex: number,
): void => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  const normalizedViewIndex = uint32(viewIndex, "view index");
  if (normalizedViewIndex !== workspace.nextViewIndex) {
    throw new Error("Royal glTF packet submission views must be reset in dense order");
  }
  workspace.viewIndex = normalizedViewIndex;
  workspace.nextViewIndex += 1;
  workspace.segment = -1;
  workspace.count = 0;
  advanceSegmentRevision(workspace);
};

export const resetGltfPacketSubmissionWorkspaceForSegment = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  orderingSegment: number,
): void => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  if (workspace.viewIndex < 0) {
    throw new Error("Royal glTF packet submission segment requires an active view");
  }
  workspace.segment = uint32(orderingSegment, "ordering segment");
  workspace.count = 0;
  advanceSegmentRevision(workspace);
};

const activeView = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
): WorkspaceState<M, R, L> => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  if (workspace.viewIndex < 0) {
    throw new Error("Royal glTF packet submission binding requires an active view");
  }
  return workspace as WorkspaceState<M, R, L>;
};

const definedBinding = <T>(value: T, label: string): T => {
  if (value === undefined || value === null) {
    throw new Error(`Royal glTF packet submission ${label} binding must be defined`);
  }
  return value;
};

export const retainGltfPacketSubmissionMaterialBinding = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  materialSourceId: number,
  materialBatchClassId: number,
  binding: M,
): number => {
  const state = activeView(workspace, planRevision, catalog);
  const sourceId = resourceId(materialSourceId, "material source ID");
  const batchClassId = safeId(materialBatchClassId, "material batch-class ID");
  if (batchClassId === 0) {
    throw new Error("Royal glTF packet submission material batch-class ID must be positive");
  }
  const value = definedBinding(binding, "material");
  const existing = state.materialBindingIdsBySource.get(sourceId);
  if (existing !== undefined) {
    if (state.materialBindingBatchClassIds[existing] !== batchClassId) {
      throw new Error("Royal glTF packet submission material source has conflicting frame bindings");
    }
    return existing;
  }
  const id = resourceId(state.materialBindingCount, "material binding ID");
  const count = id + 1;
  if (count > state.materialBindingCapacity) {
    const capacity = nextCapacity(state.materialBindingCapacity, count);
    state.materialBindings.length = capacity;
    state.materialBindingBatchClassIds = grownFloat64(state.materialBindingBatchClassIds, capacity);
    state.materialBindingSourceIds = grownUint32(state.materialBindingSourceIds, capacity);
    state.materialBindingCapacity = capacity;
  }
  state.materialBindings[id] = value;
  state.materialBindingBatchClassIds[id] = batchClassId;
  state.materialBindingSourceIds[id] = sourceId;
  state.materialBindingIdsBySource.set(sourceId, id);
  state.materialBindingCount = count;
  return id;
};

export const retainGltfPacketSubmissionRootBinding = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  rootSourceId: number,
  outerIndex: number,
  lightScopeId: number,
  binding: R,
): number => {
  const state = activeView(workspace, planRevision, catalog);
  const sourceId = resourceId(rootSourceId, "root source ID");
  const normalizedOuterIndex = uint32(outerIndex, "root outer index");
  const normalizedLightScopeId = safeId(lightScopeId, "root light-scope ID");
  const value = definedBinding(binding, "root");
  const existing = state.rootBindingIdsBySource.get(sourceId);
  if (existing !== undefined) {
    if (state.rootBindingOuterIndices[existing] !== normalizedOuterIndex
      || state.rootBindingLightScopeIds[existing] !== normalizedLightScopeId) {
      throw new Error("Royal glTF packet submission root source has conflicting frame bindings");
    }
    return existing;
  }
  const id = resourceId(state.rootBindingCount, "root binding ID");
  const count = id + 1;
  if (count > state.rootBindingCapacity) {
    const capacity = nextCapacity(state.rootBindingCapacity, count);
    state.rootBindings.length = capacity;
    state.rootBindingLightScopeIds = grownFloat64(state.rootBindingLightScopeIds, capacity);
    state.rootBindingOuterIndices = grownUint32(state.rootBindingOuterIndices, capacity);
    state.rootBindingSourceIds = grownUint32(state.rootBindingSourceIds, capacity);
    state.rootBindingCapacity = capacity;
  }
  state.rootBindings[id] = value;
  state.rootBindingLightScopeIds[id] = normalizedLightScopeId;
  state.rootBindingOuterIndices[id] = normalizedOuterIndex;
  state.rootBindingSourceIds[id] = sourceId;
  state.rootBindingIdsBySource.set(sourceId, id);
  state.rootBindingCount = count;
  return id;
};

export const retainGltfPacketSubmissionLightBinding = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  lightScopeId: number,
  binding: L,
): number => {
  const state = activeView(workspace, planRevision, catalog);
  const scopeId = safeId(lightScopeId, "light-scope ID");
  if (scopeId === 0) throw new Error("Royal glTF packet submission light-scope ID must be positive");
  const value = definedBinding(binding, "light");
  const existing = state.lightBindingIdsByScope.get(scopeId);
  if (existing !== undefined) {
    return existing;
  }
  const id = resourceId(state.lightBindingCount, "light binding ID");
  const count = id + 1;
  if (count > state.lightBindingCapacity) {
    const capacity = nextCapacity(state.lightBindingCapacity, count);
    state.lightBindings.length = capacity;
    state.lightBindingScopeIds = grownFloat64(state.lightBindingScopeIds, capacity);
    state.lightBindingCapacity = capacity;
  }
  state.lightBindings[id] = value;
  state.lightBindingScopeIds[id] = scopeId;
  state.lightBindingIdsByScope.set(scopeId, id);
  state.lightBindingCount = count;
  return id;
};

const reserveRows = <M, R, L>(workspace: GltfPacketSubmissionWorkspace<M, R, L>, required: number): void => {
  if (required <= workspace.capacity) return;
  const capacity = nextCapacity(workspace.capacity, required);
  const batchIds = new Uint32Array(capacity);
  batchIds.fill(NO_FRAME_PACKET_ID);
  batchIds.set(workspace.batchIds);
  workspace.batchIds = batchIds;
  workspace.geometryIds = grownUint32(workspace.geometryIds, capacity);
  workspace.geometryIdentityIds = grownFloat64(workspace.geometryIdentityIds, capacity);
  workspace.lightBindingIds = grownUint32(workspace.lightBindingIds, capacity);
  workspace.lightScopeIds = grownFloat64(workspace.lightScopeIds, capacity);
  workspace.localModelIds = grownUint32(workspace.localModelIds, capacity);
  workspace.materialBatchClassIds = grownFloat64(workspace.materialBatchClassIds, capacity);
  workspace.materialBindingIds = grownUint32(workspace.materialBindingIds, capacity);
  workspace.orderingSegments = grownUint32(workspace.orderingSegments, capacity);
  workspace.packetIndices = grownUint32(workspace.packetIndices, capacity);
  workspace.renderClasses = grownUint8(workspace.renderClasses, capacity);
  workspace.rootBindingIds = grownUint32(workspace.rootBindingIds, capacity);
  workspace.sidedness = grownUint8(workspace.sidedness, capacity);
  workspace.capacity = capacity;
};

const bindingId = (value: number, count: number, label: string): number => {
  const id = resourceId(value, `${label} binding ID`);
  if (id >= count) throw new Error(`Royal glTF packet submission ${label} binding ID is not retained`);
  return id;
};

const renderClass = (value: number): FramePacketRenderClass => {
  if (value !== FRAME_PACKET_RENDER_CLASS.opaque
    && value !== FRAME_PACKET_RENDER_CLASS.transmissive
    && value !== FRAME_PACKET_RENDER_CLASS.blended) {
    throw new Error("Royal glTF packet submission render class is invalid");
  }
  return value;
};

export const appendGltfPacketSubmission = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  row: GltfPacketSubmissionRow,
): number => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  if (workspace.viewIndex < 0 || workspace.segment < 0) {
    throw new Error("Royal glTF packet submission append requires an active view and segment");
  }
  const packetIndex = resourceId(row.packetIndex, "packet index");
  if (packetIndex >= catalog.count) {
    throw new Error("Royal glTF packet submission packet index is outside the catalog");
  }
  const geometryId = resourceId(row.geometryId, "geometry ID");
  const geometryIdentityId = safeId(row.geometryIdentityId, "geometry identity ID");
  if (geometryIdentityId === 0) {
    throw new Error("Royal glTF packet submission geometry identity ID must be positive");
  }
  const localModelId = resourceId(row.localModelId, "local-model ID");
  const materialBindingId = bindingId(row.materialBindingId, workspace.materialBindingCount, "material");
  const rootBindingId = bindingId(row.rootBindingId, workspace.rootBindingCount, "root");
  const lightBindingId = row.lightBindingId === NO_FRAME_PACKET_ID
    ? NO_FRAME_PACKET_ID
    : bindingId(row.lightBindingId, workspace.lightBindingCount, "light");
  const normalizedRenderClass = renderClass(row.renderClass);
  const normalizedSidedness = uint32(row.sidedness, "sidedness");
  if ((normalizedSidedness & ~SUBMISSION_SIDEDNESS_MASK) !== 0) {
    throw new Error("Royal glTF packet submission sidedness contains unknown bits");
  }
  const lightScopeId = safeId(row.lightScopeId, "light-scope ID");
  if ((lightBindingId === NO_FRAME_PACKET_ID) !== (lightScopeId === 0)) {
    throw new Error(
      "Royal glTF packet submission absent light requires scope 0 and an explicit light requires a nonzero scope",
    );
  }
  if (geometryId !== catalog.geometryIds[packetIndex]
    || localModelId !== catalog.localModelIds[packetIndex]
    || normalizedRenderClass !== catalog.renderClasses[packetIndex]
    || workspace.segment !== catalog.orderingSegments[packetIndex]
    || workspace.materialBindingSourceIds[materialBindingId] !== catalog.materialIds[packetIndex]
    || workspace.rootBindingSourceIds[rootBindingId] !== catalog.rootSourceIds[packetIndex]
    || workspace.rootBindingOuterIndices[rootBindingId] !== catalog.instanceFirsts[packetIndex]
    || workspace.rootBindingLightScopeIds[rootBindingId] !== lightScopeId
    || (normalizedSidedness & FRAME_PACKET_SIDEDNESS.doubleSided)
      !== (catalog.sidedness[packetIndex]! & FRAME_PACKET_SIDEDNESS.doubleSided)
    || (lightBindingId !== NO_FRAME_PACKET_ID
      && workspace.lightBindingScopeIds[lightBindingId] !== lightScopeId)) {
    throw new Error("Royal glTF packet submission row diverged from its authoritative frame packet");
  }
  const materialBatchClassId = workspace.materialBindingBatchClassIds[materialBindingId]!;

  const index = workspace.count;
  reserveRows(workspace, index + 1);
  workspace.batchIds[index] = NO_FRAME_PACKET_ID;
  workspace.geometryIds[index] = geometryId;
  workspace.geometryIdentityIds[index] = geometryIdentityId;
  workspace.lightBindingIds[index] = lightBindingId;
  workspace.lightScopeIds[index] = lightScopeId;
  workspace.localModelIds[index] = localModelId;
  workspace.materialBatchClassIds[index] = materialBatchClassId;
  workspace.materialBindingIds[index] = materialBindingId;
  workspace.orderingSegments[index] = workspace.segment;
  workspace.packetIndices[index] = packetIndex;
  workspace.renderClasses[index] = normalizedRenderClass;
  workspace.rootBindingIds[index] = rootBindingId;
  workspace.sidedness[index] = normalizedSidedness;
  workspace.count = index + 1;
  advanceSegmentRevision(workspace);
  return index;
};

const submissionIndex = <M, R, L>(workspace: GltfPacketSubmissionWorkspace<M, R, L>, index: number): number => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= workspace.count) {
    throw new Error("Royal glTF packet submission index is outside the active segment");
  }
  return index;
};

export const readGltfPacketSubmissionInto = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  index: number,
  out: MutableGltfPacketSubmissionRow,
): void => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  const row = submissionIndex(workspace, index);
  out.batchId = workspace.batchIds[row]!;
  out.geometryId = workspace.geometryIds[row]!;
  out.geometryIdentityId = workspace.geometryIdentityIds[row]!;
  out.lightBindingId = workspace.lightBindingIds[row]!;
  out.lightScopeId = workspace.lightScopeIds[row]!;
  out.localModelId = workspace.localModelIds[row]!;
  out.materialBatchClassId = workspace.materialBatchClassIds[row]!;
  out.materialBindingId = workspace.materialBindingIds[row]!;
  out.packetIndex = workspace.packetIndices[row]!;
  out.renderClass = workspace.renderClasses[row]! as FramePacketRenderClass;
  out.rootBindingId = workspace.rootBindingIds[row]!;
  out.sidedness = workspace.sidedness[row]!;
};

export const writeGltfPacketSubmissionBatchId = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  index: number,
  batchId: number,
): void => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  workspace.batchIds[submissionIndex(workspace, index)] = resourceId(batchId, "batch ID");
};

const resolveBinding = <T>(values: readonly (T | undefined)[], count: number, id: number, label: string): T => {
  const index = bindingId(id, count, label);
  return values[index]!;
};

export const resolveGltfPacketSubmissionMaterialBinding = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  id: number,
): M => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  return resolveBinding(workspace.materialBindings, workspace.materialBindingCount, id, "material");
};

export const resolveGltfPacketSubmissionRootBinding = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  id: number,
): R => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  return resolveBinding(workspace.rootBindings, workspace.rootBindingCount, id, "root");
};

export const resolveGltfPacketSubmissionLightBinding = <M, R, L>(
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
  id: number,
): L => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  return resolveBinding(workspace.lightBindings, workspace.lightBindingCount, id, "light");
};
