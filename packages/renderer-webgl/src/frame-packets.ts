import { MAX_RESOURCE_ID, NO_RESOURCE_ID } from "./resource-id";

/** Sentinel stored for an absent optional packet resource ID. */
export const NO_FRAME_PACKET_ID = NO_RESOURCE_ID;
export const MAX_FRAME_PACKET_RESOURCE_ID = MAX_RESOURCE_ID;

export const FRAME_PACKET_RENDER_CLASS = Object.freeze({
  opaque: 0,
  transmissive: 1,
  blended: 2,
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
  materialIds: Uint32Array;
  orderingSegments: Uint32Array;
  renderClasses: Uint8Array;
  revision: number;
  rootSourceIds: Uint32Array;
  sidedness: Uint8Array;
};

/** Dense indices in executor order. Resetting changes only count. */
export type SelectedFramePackets = {
  capacity: number;
  catalog: FramePacketCatalog;
  catalogRevision: number;
  count: number;
  orderedPacketIndices: Uint32Array;
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
    materialIds: new Uint32Array(normalized),
    orderingSegments: new Uint32Array(normalized),
    renderClasses: new Uint8Array(normalized),
    revision: 0,
    rootSourceIds: new Uint32Array(normalized),
    sidedness: new Uint8Array(normalized),
  };
};

export const createSelectedFramePackets = (
  catalog: FramePacketCatalog,
  capacity = 1,
): SelectedFramePackets => {
  const normalized = initialCapacity(capacity, "selected frame-packet");
  return {
    capacity: normalized,
    catalog,
    catalogRevision: catalog.revision,
    count: 0,
    orderedPacketIndices: new Uint32Array(normalized),
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
  catalog.materialIds = grownUint32(catalog.materialIds, capacity);
  catalog.orderingSegments = grownUint32(catalog.orderingSegments, capacity);
  catalog.renderClasses = grownUint8(catalog.renderClasses, capacity);
  catalog.rootSourceIds = grownUint32(catalog.rootSourceIds, capacity);
  catalog.sidedness = grownUint8(catalog.sidedness, capacity);
  catalog.capacity = capacity;
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
    && value !== FRAME_PACKET_RENDER_CLASS.blended) {
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
  catalog.materialIds[index] = materialId;
  catalog.orderingSegments[index] = orderingSegment;
  catalog.renderClasses[index] = normalizedRenderClass;
  catalog.rootSourceIds[index] = rootSourceId;
  catalog.sidedness[index] = normalizedSidedness;
  if (index === catalog.count) catalog.count += 1;
  catalog.revision = revision;
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
};
