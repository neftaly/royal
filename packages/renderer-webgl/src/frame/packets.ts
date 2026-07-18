import { NO_RESOURCE_ID } from "../resource-id";

/** Sentinel stored for an absent optional packet resource ID. */
export const NO_FRAME_PACKET_ID = NO_RESOURCE_ID;

export const FRAME_PACKET_RENDER_CLASS = Object.freeze({
  opaque: 0,
  transmissive: 1,
  blended: 2,
  masked: 3,
} as const);

export type FramePacketRenderClass =
  typeof FRAME_PACKET_RENDER_CLASS[keyof typeof FRAME_PACKET_RENDER_CLASS];

export const FRAME_PACKET_SIDEDNESS = Object.freeze({
  doubleSided: 1 << 0,
  frontFaceCcw: 1 << 1,
} as const);

export interface FramePacketRow {
  readonly boundsId: number;
  readonly geometryId: number;
  readonly instanceCount: number;
  readonly instanceFirst: number;
  readonly instanceStreamId?: number;
  readonly localModelId: number;
  readonly lodRequirementCount: number;
  readonly lodRequirementFirst: number;
  readonly materialId: number;
  readonly orderingSegment: number;
  readonly renderClass: FramePacketRenderClass;
  readonly rootSourceId: number;
  readonly sidedness: number;
}

/** Private struct-of-arrays catalog. Rows contain only dense numeric references. */
export type FramePacketCatalog = {
  boundsIds: Uint32Array;
  capacity: number;
  count: number;
  geometryIds: Uint32Array;
  instanceCounts: Uint32Array;
  instanceFirsts: Uint32Array;
  instanceStreamIds: Uint32Array;
  localModelIds: Uint32Array;
  lodRequirementCounts: Uint32Array;
  lodRequirementFirsts: Uint32Array;
  materialIds: Uint32Array;
  orderingSegments: Uint32Array;
  renderClasses: Uint8Array;
  revision: number;
  rootSourceIds: Uint32Array;
  sidedness: Uint8Array;
};

/** Caller-owned dense predicates referenced by packet catalog row spans. */
export type FramePacketLodRequirements = {
  capacity: number;
  count: number;
  levels: Uint32Array;
  selectionIds: Uint32Array;
};

/** Dense indices in executor order. Resetting changes only count. */
export type SelectedFramePackets = {
  capacity: number;
  catalog: FramePacketCatalog;
  catalogRevision: number;
  count: number;
  nextViewIndex: number;
  openViewIndex: number;
  orderedPacketIndices: Uint32Array;
  viewCapacity: number;
  viewCount: number;
  viewCounts: Uint32Array;
  viewFirsts: Uint32Array;
  viewRangesActive: boolean;
};

export type SelectedFramePacketViewRange = {
  count: number;
  first: number;
};

const initialCapacity = (capacity: number, label: string): number => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`Royal ${label} capacity must be a positive integer`);
  }
  return capacity;
};

export const createFramePacketCatalog = (capacity = 1): FramePacketCatalog => {
  const normalized = initialCapacity(capacity, "frame-packet catalog");
  return {
    boundsIds: new Uint32Array(normalized),
    capacity: normalized,
    count: 0,
    geometryIds: new Uint32Array(normalized),
    instanceCounts: new Uint32Array(normalized),
    instanceFirsts: new Uint32Array(normalized),
    instanceStreamIds: new Uint32Array(normalized),
    localModelIds: new Uint32Array(normalized),
    lodRequirementCounts: new Uint32Array(normalized),
    lodRequirementFirsts: new Uint32Array(normalized),
    materialIds: new Uint32Array(normalized),
    orderingSegments: new Uint32Array(normalized),
    renderClasses: new Uint8Array(normalized),
    revision: 0,
    rootSourceIds: new Uint32Array(normalized),
    sidedness: new Uint8Array(normalized),
  };
};

export const createFramePacketLodRequirements = (capacity = 1): FramePacketLodRequirements => {
  const normalized = initialCapacity(capacity, "frame-packet LOD-requirement");
  return {
    capacity: normalized,
    count: 0,
    levels: new Uint32Array(normalized),
    selectionIds: new Uint32Array(normalized),
  };
};

export const createSelectedFramePackets = (
  catalog: FramePacketCatalog,
  capacity = 1,
  viewCapacity = 1,
): SelectedFramePackets => {
  const normalized = initialCapacity(capacity, "selected frame-packet");
  const normalizedViewCapacity = initialCapacity(viewCapacity, "selected frame-packet view");
  return {
    capacity: normalized,
    catalog,
    catalogRevision: catalog.revision,
    count: 0,
    nextViewIndex: 0,
    openViewIndex: -1,
    orderedPacketIndices: new Uint32Array(normalized),
    viewCapacity: normalizedViewCapacity,
    viewCount: 0,
    viewCounts: new Uint32Array(normalizedViewCapacity),
    viewFirsts: new Uint32Array(normalizedViewCapacity),
    viewRangesActive: false,
  };
};

const nextCapacity = (current: number, required: number): number => {
  let capacity = current;
  while (capacity < required) capacity *= 2;
  return capacity;
};

const grownUint32 = (source: Uint32Array, capacity: number): Uint32Array => {
  const target = new Uint32Array(capacity);
  target.set(source);
  return target;
};

const grownUint8 = (source: Uint8Array, capacity: number): Uint8Array => {
  const target = new Uint8Array(capacity);
  target.set(source);
  return target;
};

const reserveCatalog = (catalog: FramePacketCatalog, required: number): void => {
  if (required <= catalog.capacity) return;
  const capacity = nextCapacity(catalog.capacity, required);
  catalog.boundsIds = grownUint32(catalog.boundsIds, capacity);
  catalog.geometryIds = grownUint32(catalog.geometryIds, capacity);
  catalog.instanceCounts = grownUint32(catalog.instanceCounts, capacity);
  catalog.instanceFirsts = grownUint32(catalog.instanceFirsts, capacity);
  catalog.instanceStreamIds = grownUint32(catalog.instanceStreamIds, capacity);
  catalog.localModelIds = grownUint32(catalog.localModelIds, capacity);
  catalog.lodRequirementCounts = grownUint32(catalog.lodRequirementCounts, capacity);
  catalog.lodRequirementFirsts = grownUint32(catalog.lodRequirementFirsts, capacity);
  catalog.materialIds = grownUint32(catalog.materialIds, capacity);
  catalog.orderingSegments = grownUint32(catalog.orderingSegments, capacity);
  catalog.renderClasses = grownUint8(catalog.renderClasses, capacity);
  catalog.rootSourceIds = grownUint32(catalog.rootSourceIds, capacity);
  catalog.sidedness = grownUint8(catalog.sidedness, capacity);
  catalog.capacity = capacity;
};

const reserveLodRequirements = (
  requirements: FramePacketLodRequirements,
  required: number,
): void => {
  if (required <= requirements.capacity) return;
  const capacity = nextCapacity(requirements.capacity, required);
  requirements.levels = grownUint32(requirements.levels, capacity);
  requirements.selectionIds = grownUint32(requirements.selectionIds, capacity);
  requirements.capacity = capacity;
};

const packetId = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= NO_FRAME_PACKET_ID) {
    throw new Error(`Royal frame-packet ${label} must be an unsigned 32-bit resource ID`);
  }
  return value;
};

const uint32 = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`Royal frame-packet ${label} must be an unsigned 32-bit integer`);
  }
  return value;
};

const positiveUint32 = (value: number, label: string): number => {
  const normalized = uint32(value, label);
  if (normalized === 0) throw new Error(`Royal frame-packet ${label} must be positive`);
  return normalized;
};

const renderClass = (value: number): FramePacketRenderClass => {
  if (value !== FRAME_PACKET_RENDER_CLASS.opaque
    && value !== FRAME_PACKET_RENDER_CLASS.transmissive
    && value !== FRAME_PACKET_RENDER_CLASS.blended
    && value !== FRAME_PACKET_RENDER_CLASS.masked) {
    throw new Error("Royal frame-packet render class is invalid");
  }
  return value;
};

const sidedness = (value: number): number => {
  const allowed = FRAME_PACKET_SIDEDNESS.doubleSided | FRAME_PACKET_SIDEDNESS.frontFaceCcw;
  if (!Number.isInteger(value) || value < 0 || value > allowed || (value & ~allowed) !== 0) {
    throw new Error("Royal frame-packet sidedness bits are invalid");
  }
  return value;
};

const nextRevision = (revision: number): number => {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Royal frame-packet catalog revision is exhausted");
  }
  return revision + 1;
};

/** Writes an existing row or appends exactly at `count`; sparse rows are rejected. */
export const writeFramePacket = (
  catalog: FramePacketCatalog,
  index: number,
  row: FramePacketRow,
): void => {
  if (!Number.isSafeInteger(index) || index < 0 || index > catalog.count) {
    throw new Error("Royal frame-packet writes must target an existing row or the next dense row");
  }
  const instanceFirst = uint32(row.instanceFirst, "instance first");
  const instanceCount = positiveUint32(row.instanceCount, "instance count");
  if (instanceFirst + instanceCount > 0x1_0000_0000) {
    throw new Error("Royal frame-packet instance range exceeds unsigned 32-bit storage");
  }
  const boundsId = packetId(row.boundsId, "bounds ID");
  const geometryId = packetId(row.geometryId, "geometry ID");
  const instanceStreamId = row.instanceStreamId === undefined
    ? NO_FRAME_PACKET_ID
    : packetId(row.instanceStreamId, "instance-stream ID");
  const localModelId = packetId(row.localModelId, "local-model ID");
  const lodRequirementFirst = uint32(row.lodRequirementFirst, "LOD-requirement first");
  const lodRequirementCount = uint32(row.lodRequirementCount, "LOD-requirement count");
  if (lodRequirementFirst + lodRequirementCount > 0x1_0000_0000) {
    throw new Error("Royal frame-packet LOD-requirement range exceeds unsigned 32-bit storage");
  }
  const materialId = packetId(row.materialId, "material ID");
  const orderingSegment = uint32(row.orderingSegment, "ordering segment");
  const normalizedRenderClass = renderClass(row.renderClass);
  const rootSourceId = packetId(row.rootSourceId, "root-source ID");
  const normalizedSidedness = sidedness(row.sidedness);

  if (index < catalog.count
    && catalog.boundsIds[index] === boundsId
    && catalog.geometryIds[index] === geometryId
    && catalog.instanceCounts[index] === instanceCount
    && catalog.instanceFirsts[index] === instanceFirst
    && catalog.instanceStreamIds[index] === instanceStreamId
    && catalog.localModelIds[index] === localModelId
    && catalog.lodRequirementCounts[index] === lodRequirementCount
    && catalog.lodRequirementFirsts[index] === lodRequirementFirst
    && catalog.materialIds[index] === materialId
    && catalog.orderingSegments[index] === orderingSegment
    && catalog.renderClasses[index] === normalizedRenderClass
    && catalog.rootSourceIds[index] === rootSourceId
    && catalog.sidedness[index] === normalizedSidedness) return;

  const revision = nextRevision(catalog.revision);

  reserveCatalog(catalog, index + 1);
  catalog.boundsIds[index] = boundsId;
  catalog.geometryIds[index] = geometryId;
  catalog.instanceCounts[index] = instanceCount;
  catalog.instanceFirsts[index] = instanceFirst;
  catalog.instanceStreamIds[index] = instanceStreamId;
  catalog.localModelIds[index] = localModelId;
  catalog.lodRequirementCounts[index] = lodRequirementCount;
  catalog.lodRequirementFirsts[index] = lodRequirementFirst;
  catalog.materialIds[index] = materialId;
  catalog.orderingSegments[index] = orderingSegment;
  catalog.renderClasses[index] = normalizedRenderClass;
  catalog.rootSourceIds[index] = rootSourceId;
  catalog.sidedness[index] = normalizedSidedness;
  if (index === catalog.count) catalog.count += 1;
  catalog.revision = revision;
};

/** Writes an existing predicate or appends exactly at `count`; sparse rows are rejected. */
export const writeFramePacketLodRequirement = (
  requirements: FramePacketLodRequirements,
  index: number,
  selectionId: number,
  level: number,
): void => {
  if (!Number.isSafeInteger(index) || index < 0 || index > requirements.count) {
    throw new Error("Royal frame-packet LOD-requirement writes must target an existing row or the next dense row");
  }
  const normalizedSelectionId = packetId(selectionId, "LOD selection ID");
  const normalizedLevel = packetId(level, "LOD level");
  reserveLodRequirements(requirements, index + 1);
  requirements.selectionIds[index] = normalizedSelectionId;
  requirements.levels[index] = normalizedLevel;
  if (index === requirements.count) requirements.count += 1;
};

export const appendFramePacketLodRequirement = (
  requirements: FramePacketLodRequirements,
  selectionId: number,
  level: number,
): number => {
  const index = requirements.count;
  writeFramePacketLodRequirement(requirements, index, selectionId, level);
  return index;
};

export const resetFramePacketLodRequirements = (
  requirements: FramePacketLodRequirements,
): void => {
  requirements.count = 0;
};

/** Tests a packet's complete LOD predicate span without allocating or invoking callbacks. */
export const framePacketLodRequirementsMatch = (
  catalog: FramePacketCatalog,
  requirements: FramePacketLodRequirements,
  packetIndex: number,
  selectedLevels: Uint32Array,
  /** Per-selection observation/validity epoch; finalization alone is insufficient. */
  selectedLevelValidityEpochs: Uint32Array,
  selectedLevelValidityEpoch: number,
  noSelectedLevel = NO_FRAME_PACKET_ID,
): boolean => {
  if (!Number.isSafeInteger(packetIndex) || packetIndex < 0 || packetIndex >= catalog.count) {
    throw new Error("Royal frame-packet LOD match index must reference a populated catalog row");
  }
  const first = catalog.lodRequirementFirsts[packetIndex]!;
  const count = catalog.lodRequirementCounts[packetIndex]!;
  const end = first + count;
  if (end > requirements.count) {
    throw new Error("Royal frame-packet LOD-requirement span exceeds populated requirement rows");
  }
  // A packet without LOD predicates is independent of selection storage and
  // its frame epoch. This keeps the ordinary packet path out of the LOD shell.
  if (count === 0) return true;
  const normalizedSentinel = uint32(noSelectedLevel, "LOD selected-level sentinel");
  const normalizedEpoch = positiveUint32(selectedLevelValidityEpoch, "LOD selected-level validity epoch");
  for (let index = first; index < end; index += 1) {
    const selectionId = requirements.selectionIds[index]!;
    if (selectionId >= selectedLevels.length || selectionId >= selectedLevelValidityEpochs.length) {
      throw new Error("Royal frame-packet LOD selection ID exceeds selected-level storage");
    }
  }
  for (let index = first; index < end; index += 1) {
    const selectionId = requirements.selectionIds[index]!;
    if (selectedLevelValidityEpochs[selectionId] !== normalizedEpoch) return false;
    const selected = selectedLevels[selectionId]!;
    if (selected === normalizedSentinel || selected !== requirements.levels[index]) return false;
  }
  return true;
};

export const appendFramePacket = (
  catalog: FramePacketCatalog,
  row: FramePacketRow,
): number => {
  const index = catalog.count;
  writeFramePacket(catalog, index, row);
  return index;
};

export const resetFramePacketCatalog = (catalog: FramePacketCatalog): void => {
  if (catalog.count === 0) return;
  const revision = nextRevision(catalog.revision);
  catalog.count = 0;
  catalog.revision = revision;
};

export const assertSelectedFramePacketsCurrent = (
  selected: SelectedFramePackets,
  catalog: FramePacketCatalog,
): void => {
  if (selected.catalog !== catalog || selected.catalogRevision !== catalog.revision) {
    throw new Error("Royal selected frame packets are stale for the current catalog revision");
  }
};

export const beginSelectedFramePackets = (
  selected: SelectedFramePackets,
  catalog: FramePacketCatalog,
): void => {
  selected.count = 0;
  selected.catalog = catalog;
  selected.catalogRevision = catalog.revision;
  selected.nextViewIndex = 0;
  selected.openViewIndex = -1;
  selected.viewCount = 0;
  selected.viewRangesActive = false;
};

/** Begins dense packet emission for all views. Views must then be opened in index order. */
export const beginSelectedFramePacketViews = (
  selected: SelectedFramePackets,
  catalog: FramePacketCatalog,
  viewCount: number,
): void => {
  if (!Number.isSafeInteger(viewCount) || viewCount < 0 || viewCount > 0xffff_ffff) {
    throw new Error("Royal selected frame-packet view count must be an unsigned 32-bit integer");
  }
  if (viewCount > selected.viewCapacity) {
    const capacity = nextCapacity(selected.viewCapacity, viewCount);
    selected.viewFirsts = grownUint32(selected.viewFirsts, capacity);
    selected.viewCounts = grownUint32(selected.viewCounts, capacity);
    selected.viewCapacity = capacity;
  }
  selected.count = 0;
  selected.catalog = catalog;
  selected.catalogRevision = catalog.revision;
  selected.nextViewIndex = 0;
  selected.openViewIndex = -1;
  selected.viewCount = viewCount;
  selected.viewRangesActive = true;
};

/** Opens the next view range. Empty ranges are valid. */
export const beginSelectedFramePacketView = (
  selected: SelectedFramePackets,
  catalog: FramePacketCatalog,
  viewIndex: number,
): void => {
  assertSelectedFramePacketsCurrent(selected, catalog);
  if (selected.openViewIndex !== -1) {
    throw new Error("Royal selected frame-packet view must be ended before another begins");
  }
  if (!Number.isSafeInteger(viewIndex)
    || viewIndex < 0
    || viewIndex >= selected.viewCount
    || viewIndex !== selected.nextViewIndex) {
    throw new Error("Royal selected frame-packet views must begin once in dense index order");
  }
  selected.viewFirsts[viewIndex] = selected.count;
  selected.viewCounts[viewIndex] = 0;
  selected.openViewIndex = viewIndex;
};

/** Closes the current view range without allocating or moving packet indices. */
export const endSelectedFramePacketView = (
  selected: SelectedFramePackets,
  catalog: FramePacketCatalog,
  viewIndex: number,
): void => {
  assertSelectedFramePacketsCurrent(selected, catalog);
  if (!Number.isSafeInteger(viewIndex)
    || viewIndex < 0
    || viewIndex >= selected.viewCount
    || selected.openViewIndex === -1
    || selected.openViewIndex !== viewIndex) {
    throw new Error("Royal selected frame-packet view end must match the open view");
  }
  selected.viewCounts[viewIndex] = selected.count - selected.viewFirsts[viewIndex]!;
  selected.nextViewIndex = viewIndex + 1;
  selected.openViewIndex = -1;
};

/** Copies one completed view range into caller-owned scratch. */
export const selectedFramePacketViewRange = (
  selected: SelectedFramePackets,
  catalog: FramePacketCatalog,
  viewIndex: number,
  range: SelectedFramePacketViewRange,
): void => {
  assertSelectedFramePacketsCurrent(selected, catalog);
  if (!Number.isSafeInteger(viewIndex) || viewIndex < 0 || viewIndex >= selected.nextViewIndex) {
    throw new Error("Royal selected frame-packet view range must reference a completed view");
  }
  range.first = selected.viewFirsts[viewIndex]!;
  range.count = selected.viewCounts[viewIndex]!;
};

export const appendSelectedFramePacket = (
  selected: SelectedFramePackets,
  catalog: FramePacketCatalog,
  packetIndex: number,
): void => {
  assertSelectedFramePacketsCurrent(selected, catalog);
  if (!Number.isSafeInteger(packetIndex) || packetIndex < 0 || packetIndex >= catalog.count) {
    throw new Error("Royal selected frame-packet index must reference a populated catalog row");
  }
  if (selected.viewRangesActive && selected.openViewIndex === -1) {
    throw new Error("Royal selected frame packets for views require an open view");
  }
  const required = selected.count + 1;
  if (required > selected.capacity) {
    const capacity = nextCapacity(selected.capacity, required);
    selected.orderedPacketIndices = grownUint32(selected.orderedPacketIndices, capacity);
    selected.capacity = capacity;
  }
  selected.orderedPacketIndices[selected.count] = packetIndex;
  selected.count = required;
};

export const resetSelectedFramePackets = (selected: SelectedFramePackets): void => {
  selected.count = 0;
  selected.nextViewIndex = 0;
  selected.openViewIndex = -1;
  selected.viewCount = 0;
  selected.viewRangesActive = false;
};
