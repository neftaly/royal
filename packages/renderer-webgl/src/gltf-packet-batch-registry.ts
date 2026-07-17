import {
  FRAME_PACKET_RENDER_CLASS,
  FRAME_PACKET_SIDEDNESS,
  NO_FRAME_PACKET_ID,
  type FramePacketCatalog,
  type FramePacketRenderClass,
} from "./frame/packets";
import {
  assertGltfPacketSubmissionWorkspaceCurrent,
  type GltfPacketSubmissionWorkspace,
} from "./gltf-packet-submission-workspace";

const EMPTY_SLOT = NO_FRAME_PACKET_ID;
const MAX_POWER_OF_TWO_CAPACITY = 0x4000_0000;
const SIDEDNESS_MASK = FRAME_PACKET_SIDEDNESS.doubleSided | FRAME_PACKET_SIDEDNESS.frontFaceCcw;

export interface GltfPacketBatchTuple {
  readonly geometryIdentityId: number;
  readonly lightScopeId: number;
  readonly materialBatchClassId: number;
  readonly renderClass: FramePacketRenderClass;
  readonly sidedness: number;
}

export interface GltfPacketBatchRegistry {
  batchCapacity: number;
  batchGeometryIdentityIds: Float64Array;
  batchLightScopeIds: Float64Array;
  batchMaterialBatchClassIds: Float64Array;
  batchRenderClasses: Uint8Array;
  batchSidedness: Uint8Array;
  batchCount: number;
  batchTouchedEpochs: Uint32Array;
  frameEpoch: number;
  generation: number;
  packetBatchCatalog: FramePacketCatalog | undefined;
  packetBatchCatalogRevision: number;
  packetBatchIds: Uint32Array;
  slotBatchIds: Uint32Array;
  slotCapacity: number;
  slotMask: number;
  touchedBatchCapacity: number;
  touchedBatchCount: number;
  touchedBatchIds: Uint32Array;
}

export interface GltfPacketBatchSegmentGroups {
  activeBatchCapacity: number;
  activeBatchCount: number;
  activeBatchIds: Uint32Array;
  batchCapacity: number;
  batchCounts: Uint32Array;
  batchEpochs: Uint32Array;
  batchMemberFirsts: Uint32Array;
  batchWriteCursors: Uint32Array;
  blendedBatchCount: number;
  blendedBatchIds: Uint32Array;
  catalog: FramePacketCatalog | undefined;
  catalogRevision: number;
  epoch: number;
  memberCapacity: number;
  memberCount: number;
  memberIndices: Uint32Array;
  opaqueBatchCount: number;
  opaqueBatchIds: Uint32Array;
  /** Exact retained state order for the previous opaque batch set. */
  opaqueOrderCache: Uint32Array;
  opaqueOrderCount: number;
  opaqueOrderRegistryGeneration: number;
  /** Reused merge lane for opaque state ordering. */
  opaqueSortScratch: Uint32Array;
  planRevision: number;
  registry: GltfPacketBatchRegistry | undefined;
  registryFrameEpoch: number;
  registryGeneration: number;
  segmentRevision: number;
  transmissiveBatchCount: number;
  transmissiveBatchIds: Uint32Array;
  workspace: object | undefined;
  validationEpoch: number;
  validationSlotCapacity: number;
  validationSlotEpochs: Uint32Array;
  validationSlotGeometryIdentityIds: Float64Array;
  validationSlotLightScopeIds: Float64Array;
  validationSlotMaterialBatchClassIds: Float64Array;
  validationSlotRenderClasses: Uint8Array;
  validationSlotSidedness: Uint8Array;
}

const positiveCapacity = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Royal glTF packet batch ${label} capacity must be a positive safe integer`);
  }
  return value;
};

const powerOfTwo = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POWER_OF_TWO_CAPACITY) {
    throw new Error("Royal glTF packet batch capacity exceeds the supported power-of-two range");
  }
  let capacity = 1;
  while (capacity < value) {
    if (capacity >= MAX_POWER_OF_TWO_CAPACITY) {
      throw new Error("Royal glTF packet batch capacity exceeds the supported power-of-two range");
    }
    capacity *= 2;
  }
  return capacity;
};

const safeId = (value: number, label: string, positive: boolean): number => {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new Error(`Royal glTF packet batch ${label} must be a ${positive ? "positive" : "nonnegative"} safe integer`);
  }
  return value;
};

const mix = (hash: number, value: number): number => {
  let next = hash ^ value;
  next = Math.imul(next ^ (next >>> 16), 0x7feb_352d);
  next = Math.imul(next ^ (next >>> 15), 0x846c_a68b);
  return (next ^ (next >>> 16)) >>> 0;
};

const mixSafeInteger = (hash: number, value: number): number =>
  mix(mix(hash, value >>> 0), Math.floor(value / 0x1_0000_0000) >>> 0);

/** Stable numeric tuple hash. Exact tuple comparison always resolves collisions. */
export const gltfPacketBatchTupleHash = (tuple: GltfPacketBatchTuple): number => {
  return batchTupleHash(
    tuple.geometryIdentityId,
    tuple.materialBatchClassId,
    tuple.lightScopeId,
    tuple.sidedness,
    tuple.renderClass,
  );
};

const batchTupleHash = (
  geometryIdentityId: number,
  materialBatchClassId: number,
  lightScopeId: number,
  sidedness: number,
  renderClass: number,
): number => {
  if (!Number.isSafeInteger(sidedness) || sidedness < 0 || (sidedness & ~SIDEDNESS_MASK) !== 0) {
    throw new Error("Royal glTF packet batch sidedness contains unknown bits");
  }
  if (renderClass !== FRAME_PACKET_RENDER_CLASS.opaque
    && renderClass !== FRAME_PACKET_RENDER_CLASS.transmissive
    && renderClass !== FRAME_PACKET_RENDER_CLASS.blended) {
    throw new Error("Royal glTF packet batch render class is invalid");
  }
  let hash = 0x811c_9dc5;
  hash = mixSafeInteger(hash, safeId(geometryIdentityId, "geometry identity ID", true));
  hash = mixSafeInteger(hash, safeId(materialBatchClassId, "material batch-class ID", true));
  hash = mixSafeInteger(hash, safeId(lightScopeId, "light-scope ID", false));
  return mix(hash, sidedness);
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

export const createGltfPacketBatchRegistry = (
  batchCapacity = 1,
  initialFrameEpoch = 0,
): GltfPacketBatchRegistry => {
  const batches = positiveCapacity(batchCapacity, "batch");
  if (!Number.isSafeInteger(initialFrameEpoch) || initialFrameEpoch < 0 || initialFrameEpoch > 0xffff_ffff) {
    throw new Error("Royal glTF packet batch initial frame epoch must be an unsigned 32-bit integer");
  }
  const slots = powerOfTwo(Math.max(2, batches * 2));
  return {
    batchCapacity: batches,
    batchGeometryIdentityIds: new Float64Array(batches),
    batchLightScopeIds: new Float64Array(batches),
    batchMaterialBatchClassIds: new Float64Array(batches),
    batchRenderClasses: new Uint8Array(batches),
    batchSidedness: new Uint8Array(batches),
    batchCount: 0,
    batchTouchedEpochs: new Uint32Array(batches),
    frameEpoch: initialFrameEpoch,
    generation: 1,
    packetBatchCatalog: undefined,
    packetBatchCatalogRevision: 0,
    packetBatchIds: new Uint32Array(1).fill(EMPTY_SLOT),
    slotBatchIds: new Uint32Array(slots).fill(EMPTY_SLOT),
    slotCapacity: slots,
    slotMask: slots - 1,
    touchedBatchCapacity: batches,
    touchedBatchCount: 0,
    touchedBatchIds: new Uint32Array(batches),
  };
};

export const createGltfPacketBatchSegmentGroups = (
  batchCapacity = 1,
  memberCapacity = 1,
  initialEpoch = 0,
): GltfPacketBatchSegmentGroups => {
  const batches = positiveCapacity(batchCapacity, "segment batch");
  const members = positiveCapacity(memberCapacity, "member");
  if (batches > MAX_POWER_OF_TWO_CAPACITY / 2) {
    throw new Error("Royal glTF packet batch segment capacity exceeds the supported hash range");
  }
  if (!Number.isSafeInteger(initialEpoch) || initialEpoch < 0 || initialEpoch > 0xffff_ffff) {
    throw new Error("Royal glTF packet batch initial epoch must be an unsigned 32-bit integer");
  }
  return {
    activeBatchCapacity: batches,
    activeBatchCount: 0,
    activeBatchIds: new Uint32Array(batches),
    batchCapacity: batches,
    batchCounts: new Uint32Array(batches),
    batchEpochs: new Uint32Array(batches),
    batchMemberFirsts: new Uint32Array(batches),
    batchWriteCursors: new Uint32Array(batches),
    blendedBatchCount: 0,
    blendedBatchIds: new Uint32Array(batches),
    catalog: undefined,
    catalogRevision: 0,
    epoch: initialEpoch,
    memberCapacity: members,
    memberCount: 0,
    memberIndices: new Uint32Array(members),
    opaqueBatchCount: 0,
    opaqueBatchIds: new Uint32Array(batches),
    opaqueOrderCache: new Uint32Array(batches),
    opaqueOrderCount: 0,
    opaqueOrderRegistryGeneration: 0,
    opaqueSortScratch: new Uint32Array(batches),
    planRevision: 0,
    registry: undefined,
    registryFrameEpoch: 0,
    registryGeneration: 0,
    segmentRevision: 0,
    transmissiveBatchCount: 0,
    transmissiveBatchIds: new Uint32Array(batches),
    workspace: undefined,
    validationEpoch: 0,
    validationSlotCapacity: powerOfTwo(Math.max(2, batches * 2)),
    validationSlotEpochs: new Uint32Array(powerOfTwo(Math.max(2, batches * 2))),
    validationSlotGeometryIdentityIds: new Float64Array(powerOfTwo(Math.max(2, batches * 2))),
    validationSlotLightScopeIds: new Float64Array(powerOfTwo(Math.max(2, batches * 2))),
    validationSlotMaterialBatchClassIds: new Float64Array(powerOfTwo(Math.max(2, batches * 2))),
    validationSlotRenderClasses: new Uint8Array(powerOfTwo(Math.max(2, batches * 2))),
    validationSlotSidedness: new Uint8Array(powerOfTwo(Math.max(2, batches * 2))),
  };
};

const reserveBatches = (registry: GltfPacketBatchRegistry, required: number): void => {
  if (required <= registry.batchCapacity) return;
  const capacity = powerOfTwo(required);
  registry.batchGeometryIdentityIds = grownFloat64(registry.batchGeometryIdentityIds, capacity);
  registry.batchLightScopeIds = grownFloat64(registry.batchLightScopeIds, capacity);
  registry.batchMaterialBatchClassIds = grownFloat64(registry.batchMaterialBatchClassIds, capacity);
  registry.batchRenderClasses = grownUint8(registry.batchRenderClasses, capacity);
  registry.batchSidedness = grownUint8(registry.batchSidedness, capacity);
  registry.batchTouchedEpochs = grownUint32(registry.batchTouchedEpochs, capacity);
  registry.batchCapacity = capacity;
};

const reserveTouched = (registry: GltfPacketBatchRegistry, required: number): void => {
  if (required <= registry.touchedBatchCapacity) return;
  const capacity = powerOfTwo(required);
  registry.touchedBatchIds = grownUint32(registry.touchedBatchIds, capacity);
  registry.touchedBatchCapacity = capacity;
};

const reserveGroupBatches = (groups: GltfPacketBatchSegmentGroups, required: number): void => {
  if (required <= groups.batchCapacity) return;
  const capacity = powerOfTwo(required);
  groups.batchCounts = grownUint32(groups.batchCounts, capacity);
  groups.batchEpochs = grownUint32(groups.batchEpochs, capacity);
  groups.batchMemberFirsts = grownUint32(groups.batchMemberFirsts, capacity);
  groups.batchWriteCursors = grownUint32(groups.batchWriteCursors, capacity);
  groups.batchCapacity = capacity;
};

const reserveActive = (groups: GltfPacketBatchSegmentGroups, required: number): void => {
  if (required <= groups.activeBatchCapacity) return;
  const capacity = powerOfTwo(required);
  groups.activeBatchIds = grownUint32(groups.activeBatchIds, capacity);
  groups.opaqueBatchIds = grownUint32(groups.opaqueBatchIds, capacity);
  groups.opaqueOrderCache = grownUint32(groups.opaqueOrderCache, capacity);
  groups.opaqueSortScratch = grownUint32(groups.opaqueSortScratch, capacity);
  groups.transmissiveBatchIds = grownUint32(groups.transmissiveBatchIds, capacity);
  groups.blendedBatchIds = grownUint32(groups.blendedBatchIds, capacity);
  groups.activeBatchCapacity = capacity;
};

const reserveMembers = (groups: GltfPacketBatchSegmentGroups, required: number): void => {
  if (required <= groups.memberCapacity) return;
  const capacity = powerOfTwo(required);
  groups.memberIndices = grownUint32(groups.memberIndices, capacity);
  groups.memberCapacity = capacity;
};

const reserveValidationSlots = (groups: GltfPacketBatchSegmentGroups, memberCount: number): void => {
  if (memberCount > MAX_POWER_OF_TWO_CAPACITY / 2) {
    throw new Error("Royal glTF packet batch validation capacity is exhausted");
  }
  const required = powerOfTwo(Math.max(2, memberCount * 2));
  if (required <= groups.validationSlotCapacity) return;
  const epochs = new Uint32Array(required);
  const geometryIdentityIds = new Float64Array(required);
  const lightScopeIds = new Float64Array(required);
  const materialBatchClassIds = new Float64Array(required);
  const renderClasses = new Uint8Array(required);
  const sidedness = new Uint8Array(required);
  groups.validationSlotEpochs = epochs;
  groups.validationSlotGeometryIdentityIds = geometryIdentityIds;
  groups.validationSlotLightScopeIds = lightScopeIds;
  groups.validationSlotMaterialBatchClassIds = materialBatchClassIds;
  groups.validationSlotRenderClasses = renderClasses;
  groups.validationSlotSidedness = sidedness;
  groups.validationSlotCapacity = required;
  groups.validationEpoch = 0;
};

const beginValidationEpoch = (groups: GltfPacketBatchSegmentGroups): number => {
  groups.validationEpoch = (groups.validationEpoch + 1) >>> 0;
  if (groups.validationEpoch === 0) {
    groups.validationSlotEpochs.fill(0);
    groups.validationEpoch = 1;
  }
  return groups.validationEpoch;
};

const sameIdentity = (
  registry: GltfPacketBatchRegistry,
  batchId: number,
  geometryIdentityId: number,
  materialBatchClassId: number,
  lightScopeId: number,
  sidedness: number,
): boolean =>
  registry.batchGeometryIdentityIds[batchId] === geometryIdentityId
  && registry.batchMaterialBatchClassIds[batchId] === materialBatchClassId
  && registry.batchLightScopeIds[batchId] === lightScopeId
  && registry.batchSidedness[batchId] === sidedness;

const findSlot = (
  registry: GltfPacketBatchRegistry,
  geometryIdentityId: number,
  materialBatchClassId: number,
  lightScopeId: number,
  sidedness: number,
  renderClass: number,
): number => {
  let slot = batchTupleHash(
    geometryIdentityId, materialBatchClassId, lightScopeId, sidedness, renderClass,
  ) & registry.slotMask;
  while (true) {
    const batchId = registry.slotBatchIds[slot]!;
    if (batchId === EMPTY_SLOT || sameIdentity(
      registry,
      batchId,
      geometryIdentityId,
      materialBatchClassId,
      lightScopeId,
      sidedness,
    )) return slot;
    slot = (slot + 1) & registry.slotMask;
  }
};

const rehash = (registry: GltfPacketBatchRegistry, capacity: number): void => {
  const nextCapacity = powerOfTwo(capacity);
  const nextMask = nextCapacity - 1;
  const nextSlots = new Uint32Array(nextCapacity).fill(EMPTY_SLOT);
  for (let batchId = 0; batchId < registry.batchCount; batchId += 1) {
    let slot = batchTupleHash(
      registry.batchGeometryIdentityIds[batchId]!,
      registry.batchMaterialBatchClassIds[batchId]!,
      registry.batchLightScopeIds[batchId]!,
      registry.batchSidedness[batchId]!,
      registry.batchRenderClasses[batchId]!,
    ) & nextMask;
    while (nextSlots[slot] !== EMPTY_SLOT) slot = (slot + 1) & nextMask;
    nextSlots[slot] = batchId;
  }
  registry.slotBatchIds = nextSlots;
  registry.slotCapacity = nextCapacity;
  registry.slotMask = nextMask;
};

const internBatch = (
  registry: GltfPacketBatchRegistry,
  geometryIdentityId: number,
  materialBatchClassId: number,
  lightScopeId: number,
  sidedness: number,
  renderClass: FramePacketRenderClass,
): number => {
  const slot = findSlot(
    registry, geometryIdentityId, materialBatchClassId, lightScopeId, sidedness, renderClass,
  );
  const existing = registry.slotBatchIds[slot]!;
  if (existing !== EMPTY_SLOT) {
    if (registry.batchRenderClasses[existing] !== renderClass) {
      throw new Error("Royal glTF packet batch identity has conflicting render classes");
    }
    return existing;
  }
  if (registry.batchCount >= EMPTY_SLOT) throw new Error("Royal glTF packet batch ID space is exhausted");
  const batchId = registry.batchCount;
  reserveBatches(registry, batchId + 1);
  registry.batchGeometryIdentityIds[batchId] = geometryIdentityId;
  registry.batchLightScopeIds[batchId] = lightScopeId;
  registry.batchMaterialBatchClassIds[batchId] = materialBatchClassId;
  registry.batchRenderClasses[batchId] = renderClass;
  registry.batchSidedness[batchId] = sidedness;
  registry.slotBatchIds[slot] = batchId;
  registry.batchCount += 1;
  return batchId;
};

const beginEpoch = (groups: GltfPacketBatchSegmentGroups): number => {
  groups.epoch = (groups.epoch + 1) >>> 0;
  if (groups.epoch === 0) {
    groups.batchEpochs.fill(0);
    groups.epoch = 1;
  }
  groups.activeBatchCount = 0;
  groups.opaqueBatchCount = 0;
  groups.transmissiveBatchCount = 0;
  groups.blendedBatchCount = 0;
  groups.memberCount = 0;
  return groups.epoch;
};

const preparePacketBatchIds = (
  registry: GltfPacketBatchRegistry,
  catalog: FramePacketCatalog,
): void => {
  if (registry.packetBatchCatalog === catalog
    && registry.packetBatchCatalogRevision === catalog.revision) return;
  if (registry.packetBatchIds.length < catalog.count) {
    registry.packetBatchIds = new Uint32Array(powerOfTwo(Math.max(1, catalog.count)));
  }
  registry.packetBatchIds.fill(EMPTY_SLOT);
  registry.packetBatchCatalog = catalog;
  registry.packetBatchCatalogRevision = catalog.revision;
};

const batchForPreparedPacket = (
  registry: GltfPacketBatchRegistry,
  packetIndex: number,
  geometryIdentityId: number,
  materialBatchClassId: number,
  lightScopeId: number,
  sidedness: number,
  renderClass: FramePacketRenderClass,
): number => {
  const cached = registry.packetBatchIds[packetIndex]!;
  if (cached !== EMPTY_SLOT
    && registry.batchRenderClasses[cached] === renderClass
    && sameIdentity(
      registry,
      cached,
      geometryIdentityId,
      materialBatchClassId,
      lightScopeId,
      sidedness,
    )) return cached;
  const batchId = internBatch(
    registry,
    geometryIdentityId,
    materialBatchClassId,
    lightScopeId,
    sidedness,
    renderClass,
  );
  registry.packetBatchIds[packetIndex] = batchId;
  return batchId;
};

const appendClassBatch = (
  groups: GltfPacketBatchSegmentGroups,
  renderClass: FramePacketRenderClass,
  batchId: number,
): void => {
  if (renderClass === FRAME_PACKET_RENDER_CLASS.opaque) {
    groups.opaqueBatchIds[groups.opaqueBatchCount] = batchId;
    groups.opaqueBatchCount += 1;
  } else if (renderClass === FRAME_PACKET_RENDER_CLASS.transmissive) {
    groups.transmissiveBatchIds[groups.transmissiveBatchCount] = batchId;
    groups.transmissiveBatchCount += 1;
  } else {
    groups.blendedBatchIds[groups.blendedBatchCount] = batchId;
    groups.blendedBatchCount += 1;
  }
};

const compareOpaqueBatchState = (
  registry: GltfPacketBatchRegistry,
  left: number,
  right: number,
): number => {
  const material = registry.batchMaterialBatchClassIds[left]! - registry.batchMaterialBatchClassIds[right]!;
  if (material !== 0) return material;
  const lights = registry.batchLightScopeIds[left]! - registry.batchLightScopeIds[right]!;
  if (lights !== 0) return lights;
  const sidedness = registry.batchSidedness[left]! - registry.batchSidedness[right]!;
  return sidedness !== 0 ? sidedness : left - right;
};

/** Allocation-free stable ordering for opaque batches, whose draw order has no compositing meaning. */
const orderOpaqueBatchesByState = (
  registry: GltfPacketBatchRegistry,
  groups: GltfPacketBatchSegmentGroups,
): void => {
  const count = groups.opaqueBatchCount;
  if (
    groups.opaqueOrderCount === count
    && groups.opaqueOrderRegistryGeneration === registry.generation
  ) {
    let current = true;
    for (let index = 0; current && index < count; index += 1) {
      current = groups.batchEpochs[groups.opaqueOrderCache[index]!] === groups.epoch;
    }
    if (current) {
      groups.opaqueBatchIds.set(groups.opaqueOrderCache.subarray(0, count), 0);
      return;
    }
  }
  if (count < 2) {
    groups.opaqueOrderCache.set(groups.opaqueBatchIds.subarray(0, count), 0);
    groups.opaqueOrderCount = count;
    groups.opaqueOrderRegistryGeneration = registry.generation;
    return;
  }
  let source = groups.opaqueBatchIds;
  let target = groups.opaqueSortScratch;
  for (let width = 1; width < count; width *= 2) {
    for (let first = 0; first < count; first += width * 2) {
      const middle = Math.min(first + width, count);
      const end = Math.min(first + width * 2, count);
      let left = first;
      let right = middle;
      let write = first;
      while (left < middle && right < end) {
        const leftBatch = source[left]!;
        const rightBatch = source[right]!;
        if (compareOpaqueBatchState(registry, leftBatch, rightBatch) <= 0) {
          target[write] = leftBatch;
          left += 1;
        } else {
          target[write] = rightBatch;
          right += 1;
        }
        write += 1;
      }
      while (left < middle) {
        target[write] = source[left]!;
        left += 1;
        write += 1;
      }
      while (right < end) {
        target[write] = source[right]!;
        right += 1;
        write += 1;
      }
    }
    const previous = source;
    source = target;
    target = previous;
  }
  if (source !== groups.opaqueBatchIds) {
    groups.opaqueBatchIds.set(source.subarray(0, count), 0);
  }
  groups.opaqueOrderCache.set(groups.opaqueBatchIds.subarray(0, count), 0);
  groups.opaqueOrderCount = count;
  groups.opaqueOrderRegistryGeneration = registry.generation;
};

const validateWorkspaceSegment = <M, R, L>(
  registry: GltfPacketBatchRegistry,
  groups: GltfPacketBatchSegmentGroups,
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  catalog: FramePacketCatalog,
): void => {
  for (let memberIndex = 0; memberIndex < workspace.count; memberIndex += 1) {
    const packetIndex = workspace.packetIndices[memberIndex]!;
    const renderClass = workspace.renderClasses[memberIndex]!;
    const sidedness = workspace.sidedness[memberIndex]!;
    batchTupleHash(
      workspace.geometryIdentityIds[memberIndex]!,
      workspace.materialBatchClassIds[memberIndex]!,
      workspace.lightScopeIds[memberIndex]!,
      sidedness,
      renderClass,
    );
    if (packetIndex >= catalog.count
      || workspace.orderingSegments[memberIndex] !== workspace.segment
      || renderClass !== catalog.renderClasses[packetIndex]
      || (sidedness & ~SIDEDNESS_MASK) !== 0
      || (sidedness & FRAME_PACKET_SIDEDNESS.doubleSided)
        !== (catalog.sidedness[packetIndex]! & FRAME_PACKET_SIDEDNESS.doubleSided)
      || (renderClass !== FRAME_PACKET_RENDER_CLASS.opaque
        && renderClass !== FRAME_PACKET_RENDER_CLASS.transmissive
        && renderClass !== FRAME_PACKET_RENDER_CLASS.blended)) {
      throw new Error("Royal glTF packet batch workspace row is invalid or stale");
    }
    const slot = findSlot(
      registry,
      workspace.geometryIdentityIds[memberIndex]!,
      workspace.materialBatchClassIds[memberIndex]!,
      workspace.lightScopeIds[memberIndex]!,
      sidedness,
      renderClass,
    );
    const batchId = registry.slotBatchIds[slot]!;
    if (batchId !== EMPTY_SLOT && registry.batchRenderClasses[batchId] !== renderClass) {
      throw new Error("Royal glTF packet batch identity has conflicting render classes");
    }
  }

  reserveValidationSlots(groups, workspace.count);
  const epoch = beginValidationEpoch(groups);
  const mask = groups.validationSlotCapacity - 1;
  for (let memberIndex = 0; memberIndex < workspace.count; memberIndex += 1) {
    const geometryIdentityId = workspace.geometryIdentityIds[memberIndex]!;
    const materialBatchClassId = workspace.materialBatchClassIds[memberIndex]!;
    const lightScopeId = workspace.lightScopeIds[memberIndex]!;
    const sidedness = workspace.sidedness[memberIndex]!;
    const renderClass = workspace.renderClasses[memberIndex]!;
    let slot = batchTupleHash(
      geometryIdentityId, materialBatchClassId, lightScopeId, sidedness, renderClass,
    ) & mask;
    while (groups.validationSlotEpochs[slot] === epoch) {
      if (groups.validationSlotGeometryIdentityIds[slot] === geometryIdentityId
        && groups.validationSlotMaterialBatchClassIds[slot] === materialBatchClassId
        && groups.validationSlotLightScopeIds[slot] === lightScopeId
        && groups.validationSlotSidedness[slot] === sidedness) {
        if (groups.validationSlotRenderClasses[slot] !== renderClass) {
          throw new Error("Royal glTF packet batch segment has conflicting render classes");
        }
        break;
      }
      slot = (slot + 1) & mask;
    }
    if (groups.validationSlotEpochs[slot] !== epoch) {
      groups.validationSlotEpochs[slot] = epoch;
      groups.validationSlotGeometryIdentityIds[slot] = geometryIdentityId;
      groups.validationSlotMaterialBatchClassIds[slot] = materialBatchClassId;
      groups.validationSlotLightScopeIds[slot] = lightScopeId;
      groups.validationSlotSidedness[slot] = sidedness;
      groups.validationSlotRenderClasses[slot] = renderClass;
    }
  }
};

export const beginGltfPacketBatchRegistryFrame = (registry: GltfPacketBatchRegistry): void => {
  registry.frameEpoch = (registry.frameEpoch + 1) >>> 0;
  if (registry.frameEpoch === 0) {
    registry.batchTouchedEpochs.fill(0);
    registry.frameEpoch = 1;
  }
  registry.touchedBatchCount = 0;
};

export const assertGltfPacketBatchSegmentGroupsCurrent = <M, R, L>(
  registry: GltfPacketBatchRegistry,
  groups: GltfPacketBatchSegmentGroups,
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
): void => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  if (groups.registry !== registry
    || groups.registryFrameEpoch !== registry.frameEpoch
    || groups.registryGeneration !== registry.generation
    || groups.workspace !== workspace
    || groups.segmentRevision !== workspace.segmentRevision
    || groups.memberCount !== workspace.count
    || groups.planRevision !== planRevision
    || groups.catalog !== catalog
    || groups.catalogRevision !== catalog.revision) {
    throw new Error("Royal glTF packet batch segment groups are stale");
  }
};

const requireActiveGrouping = <M, R, L>(
  registry: GltfPacketBatchRegistry,
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
): void => {
  assertGltfPacketSubmissionWorkspaceCurrent(workspace, planRevision, catalog);
  if (workspace.viewIndex < 0 || workspace.segment < 0) {
    throw new Error("Royal glTF packet batch grouping requires an active workspace segment");
  }
  if (registry.frameEpoch === 0) {
    throw new Error("Royal glTF packet batch registry requires an active frame");
  }
};

const groupCurrentGltfPacketSubmissionSegment = <M, R, L>(
  registry: GltfPacketBatchRegistry,
  groups: GltfPacketBatchSegmentGroups,
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
): void => {
  if (workspace.count > MAX_POWER_OF_TWO_CAPACITY / 2 - registry.batchCount) {
    throw new Error("Royal glTF packet batch registry capacity exceeds the supported hash range");
  }
  if (workspace.count > EMPTY_SLOT - registry.batchCount) {
    throw new Error("Royal glTF packet batch ID space is exhausted");
  }
  reserveBatches(registry, registry.batchCount + workspace.count);
  reserveTouched(registry, registry.touchedBatchCount + workspace.count);
  reserveGroupBatches(groups, registry.batchCount + workspace.count);
  reserveActive(groups, Math.max(1, workspace.count));
  reserveMembers(groups, Math.max(1, workspace.count));
  while ((registry.batchCount + workspace.count) * 2 > registry.slotCapacity) {
    rehash(registry, registry.slotCapacity * 2);
  }
  preparePacketBatchIds(registry, catalog);
  const epoch = beginEpoch(groups);
  let memberIndex = 0;
  while (memberIndex < workspace.count) {
    const packetIndex = workspace.packetIndices[memberIndex]!;
    const geometryIdentityId = workspace.geometryIdentityIds[memberIndex]!;
    const materialBatchClassId = workspace.materialBatchClassIds[memberIndex]!;
    const lightScopeId = workspace.lightScopeIds[memberIndex]!;
    const sidedness = workspace.sidedness[memberIndex]!;
    const renderClass = workspace.renderClasses[memberIndex]! as FramePacketRenderClass;
    let runEnd = memberIndex + 1;
    while (runEnd < workspace.count
      && workspace.packetIndices[runEnd] === packetIndex
      && workspace.geometryIdentityIds[runEnd] === geometryIdentityId
      && workspace.materialBatchClassIds[runEnd] === materialBatchClassId
      && workspace.lightScopeIds[runEnd] === lightScopeId
      && workspace.sidedness[runEnd] === sidedness
      && workspace.renderClasses[runEnd] === renderClass) {
      runEnd += 1;
    }
    const batchId = batchForPreparedPacket(
      registry,
      packetIndex,
      geometryIdentityId,
      materialBatchClassId,
      lightScopeId,
      sidedness,
      renderClass,
    );
    if (runEnd === memberIndex + 1) workspace.batchIds[memberIndex] = batchId;
    else workspace.batchIds.fill(batchId, memberIndex, runEnd);
    if (registry.batchTouchedEpochs[batchId] !== registry.frameEpoch) {
      registry.batchTouchedEpochs[batchId] = registry.frameEpoch;
      registry.touchedBatchIds[registry.touchedBatchCount] = batchId;
      registry.touchedBatchCount += 1;
    }
    if (groups.batchEpochs[batchId] !== epoch) {
      groups.batchEpochs[batchId] = epoch;
      groups.batchCounts[batchId] = 0;
      groups.activeBatchIds[groups.activeBatchCount] = batchId;
      groups.activeBatchCount += 1;
      appendClassBatch(groups, renderClass, batchId);
    }
    groups.batchCounts[batchId] = groups.batchCounts[batchId]! + runEnd - memberIndex;
    memberIndex = runEnd;
  }

  let memberFirst = 0;
  for (let activeIndex = 0; activeIndex < groups.activeBatchCount; activeIndex += 1) {
    const batchId = groups.activeBatchIds[activeIndex]!;
    groups.batchMemberFirsts[batchId] = memberFirst;
    groups.batchWriteCursors[batchId] = memberFirst;
    memberFirst += groups.batchCounts[batchId]!;
  }
  groups.memberCount = memberFirst;
  for (let memberIndex = 0; memberIndex < workspace.count; memberIndex += 1) {
    const batchId = workspace.batchIds[memberIndex]!;
    const cursor = groups.batchWriteCursors[batchId]!;
    groups.memberIndices[cursor] = memberIndex;
    groups.batchWriteCursors[batchId] = cursor + 1;
  }
  orderOpaqueBatchesByState(registry, groups);
  groups.catalog = catalog;
  groups.catalogRevision = catalog.revision;
  groups.planRevision = planRevision;
  groups.registry = registry;
  groups.registryFrameEpoch = registry.frameEpoch;
  groups.registryGeneration = registry.generation;
  groups.segmentRevision = workspace.segmentRevision;
  groups.workspace = workspace;
};

/** Validates externally assembled rows, then interns and groups their numeric batch tuples. */
export const groupGltfPacketSubmissionSegment = <M, R, L>(
  registry: GltfPacketBatchRegistry,
  groups: GltfPacketBatchSegmentGroups,
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
): void => {
  requireActiveGrouping(registry, workspace, planRevision, catalog);
  validateWorkspaceSegment(registry, groups, workspace, catalog);
  groupCurrentGltfPacketSubmissionSegment(registry, groups, workspace, planRevision, catalog);
};

/** Groups rows already assembled from their authoritative packet catalog and bindings. */
export const groupPreparedGltfPacketSubmissionSegment = <M, R, L>(
  registry: GltfPacketBatchRegistry,
  groups: GltfPacketBatchSegmentGroups,
  workspace: GltfPacketSubmissionWorkspace<M, R, L>,
  planRevision: number,
  catalog: FramePacketCatalog,
): void => {
  requireActiveGrouping(registry, workspace, planRevision, catalog);
  groupCurrentGltfPacketSubmissionSegment(registry, groups, workspace, planRevision, catalog);
};

/** Clears persistent tuple identity and active grouping state while retaining capacity. */
export const clearGltfPacketBatchRegistry = (registry: GltfPacketBatchRegistry): void => {
  if (registry.generation === Number.MAX_SAFE_INTEGER) {
    throw new Error("Royal glTF packet batch registry generation is exhausted");
  }
  registry.generation += 1;
  registry.slotBatchIds.fill(EMPTY_SLOT);
  registry.batchTouchedEpochs.fill(0);
  registry.batchCount = 0;
  registry.frameEpoch = 0;
  registry.packetBatchCatalog = undefined;
  registry.packetBatchCatalogRevision = 0;
  registry.packetBatchIds.fill(EMPTY_SLOT);
  registry.touchedBatchCount = 0;
};

export const clearGltfPacketBatchSegmentGroups = (groups: GltfPacketBatchSegmentGroups): void => {
  groups.batchEpochs.fill(0);
  groups.activeBatchCount = 0;
  groups.blendedBatchCount = 0;
  groups.epoch = 0;
  groups.memberCount = 0;
  groups.opaqueBatchCount = 0;
  groups.opaqueOrderCount = 0;
  groups.opaqueOrderRegistryGeneration = 0;
  groups.transmissiveBatchCount = 0;
  groups.catalog = undefined;
  groups.catalogRevision = 0;
  groups.planRevision = 0;
  groups.registry = undefined;
  groups.registryFrameEpoch = 0;
  groups.registryGeneration = 0;
  groups.segmentRevision = 0;
  groups.workspace = undefined;
};
