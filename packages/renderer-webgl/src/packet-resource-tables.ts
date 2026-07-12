import type {
  LoadedGltfMaterial,
  LoadedGltfMaterialTextureSlot,
} from "./gltf/prepared-asset";
import type { Mat4, MutableMat4 } from "./math/mat4";
import type { Bounds3, MutableBounds3 } from "./math/picking";
import { MAX_RESOURCE_ID } from "./resource-id";

export interface PacketRootSourceRow {
  /** Kind is a private numeric discriminator owned by the packet compiler. */
  readonly kind: number;
  /** Index within the occurrence's outer source (for example, a primitive index). */
  readonly outerIndex: number;
  /** Source node index in the currently committed frame plan; it may be sparse among packet occurrences. */
  readonly planOccurrenceIndex: number;
}

export interface MutablePacketRootSourceRow {
  kind: number;
  outerIndex: number;
  planOccurrenceIndex: number;
}

export interface PacketLocalModelRow {
  readonly determinant: number;
  readonly model: Mat4;
}

export interface PacketResourceTablesSnapshot {
  readonly bounds: readonly (Bounds3 | undefined)[];
  readonly boundsCapacity: number;
  readonly localModelCapacity: number;
  readonly localModels: readonly PacketLocalModelRow[];
  readonly materialCapacity: number;
  readonly materials: readonly LoadedGltfMaterial[];
  readonly planRevision: number;
  readonly rootSourceCapacity: number;
  readonly rootSources: readonly PacketRootSourceRow[];
}

declare const packetResourceTablesAuthority: unique symbol;

/** Explicit authority token; only this module can inspect or mutate packet resource rows. */
export interface PacketResourceTables {
  readonly [packetResourceTablesAuthority]: "PacketResourceTables";
}

interface PacketResourceTablesState {
  boundsCapacity: number;
  boundsCount: number;
  boundsDefined: Uint8Array;
  boundsMaxima: Float64Array;
  boundsMinima: Float64Array;
  boundsIds: WeakMap<Bounds3, number>;
  localModelCapacity: number;
  localModelCount: number;
  localModelDeterminants: Float64Array;
  localModelIds: WeakMap<Mat4, number>;
  localModels: Float64Array;
  materialCapacity: number;
  materialCount: number;
  materialIds: WeakMap<LoadedGltfMaterial, number>;
  materials: (LoadedGltfMaterial | undefined)[];
  planRevision: number;
  rootSourceCapacity: number;
  rootSourceCount: number;
  rootSourceKinds: Uint32Array;
  rootSourceOuterIndices: Uint32Array;
  rootSourcePlanOccurrenceIndices: Uint32Array;
  undefinedBoundsId: number | undefined;
}

const initialCapacity = (capacity: number): number => {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_RESOURCE_ID + 1) {
    throw new Error("Royal packet resource-table capacity must be a positive resource-sized integer");
  }
  return capacity;
};

const grownFloat64 = (source: Float64Array, length: number): Float64Array => {
  const target = new Float64Array(length);
  target.set(source);
  return target;
};

const grownUint8 = (source: Uint8Array, length: number): Uint8Array => {
  const target = new Uint8Array(length);
  target.set(source);
  return target;
};

const grownUint32 = (source: Uint32Array, length: number): Uint32Array => {
  const target = new Uint32Array(length);
  target.set(source);
  return target;
};

const nextCapacity = (current: number, required: number): number => {
  const maximumRowCount = MAX_RESOURCE_ID + 1;
  if (required > maximumRowCount) {
    throw new Error("Royal packet resource-table ID space is exhausted");
  }
  let capacity = current;
  while (capacity < required) capacity = Math.min(maximumRowCount, capacity * 2);
  return capacity;
};

const nextId = (count: number, label: string): number => {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_RESOURCE_ID) {
    throw new Error(`Royal packet ${label} ID space is exhausted`);
  }
  return count;
};

const resourceIndex = (id: number, count: number, label: string): number => {
  if (!Number.isSafeInteger(id) || id < 0 || id >= count || id > MAX_RESOURCE_ID) {
    throw new Error(`Royal packet ${label} ID does not reference a populated row`);
  }
  return id;
};

const uint32ResourceValue = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RESOURCE_ID) {
    throw new Error(`Royal packet root-source ${label} must be an unsigned resource-sized integer`);
  }
  return value;
};

export const createPacketResourceTables = (capacity = 1): PacketResourceTables => {
  const normalized = initialCapacity(capacity);
  return {
    boundsCapacity: normalized,
    boundsCount: 0,
    boundsDefined: new Uint8Array(normalized),
    boundsMaxima: new Float64Array(normalized * 3),
    boundsMinima: new Float64Array(normalized * 3),
    boundsIds: new WeakMap(),
    localModelCapacity: normalized,
    localModelCount: 0,
    localModelDeterminants: new Float64Array(normalized),
    localModelIds: new WeakMap(),
    localModels: new Float64Array(normalized * 16),
    materialCapacity: normalized,
    materialCount: 0,
    materialIds: new WeakMap(),
    materials: Array.from<LoadedGltfMaterial | undefined>({ length: normalized }),
    planRevision: 0,
    rootSourceCapacity: normalized,
    rootSourceCount: 0,
    rootSourceKinds: new Uint32Array(normalized),
    rootSourceOuterIndices: new Uint32Array(normalized),
    rootSourcePlanOccurrenceIndices: new Uint32Array(normalized),
    undefinedBoundsId: undefined,
  } as unknown as PacketResourceTables;
};

const reserveBounds = (state: PacketResourceTablesState, required: number): void => {
  if (required <= state.boundsCapacity) return;
  const capacity = nextCapacity(state.boundsCapacity, required);
  state.boundsDefined = grownUint8(state.boundsDefined, capacity);
  state.boundsMaxima = grownFloat64(state.boundsMaxima, capacity * 3);
  state.boundsMinima = grownFloat64(state.boundsMinima, capacity * 3);
  state.boundsCapacity = capacity;
};

const reserveLocalModels = (state: PacketResourceTablesState, required: number): void => {
  if (required <= state.localModelCapacity) return;
  const capacity = nextCapacity(state.localModelCapacity, required);
  state.localModelDeterminants = grownFloat64(state.localModelDeterminants, capacity);
  state.localModels = grownFloat64(state.localModels, capacity * 16);
  state.localModelCapacity = capacity;
};

const reserveMaterials = (state: PacketResourceTablesState, required: number): void => {
  if (required <= state.materialCapacity) return;
  const capacity = nextCapacity(state.materialCapacity, required);
  state.materials.length = capacity;
  state.materialCapacity = capacity;
};

const reserveRootSources = (state: PacketResourceTablesState, required: number): void => {
  if (required <= state.rootSourceCapacity) return;
  const capacity = nextCapacity(state.rootSourceCapacity, required);
  state.rootSourceKinds = grownUint32(state.rootSourceKinds, capacity);
  state.rootSourceOuterIndices = grownUint32(state.rootSourceOuterIndices, capacity);
  state.rootSourcePlanOccurrenceIndices = grownUint32(
    state.rootSourcePlanOccurrenceIndices,
    capacity,
  );
  state.rootSourceCapacity = capacity;
};

/** Retains one copied bounds row. Undefined is a canonical, explicitly represented row. */
export const retainPacketBounds = (
  tables: PacketResourceTables,
  bounds: Bounds3 | undefined,
): number => {
  const state = tables as unknown as PacketResourceTablesState;
  if (bounds === undefined && state.undefinedBoundsId !== undefined) return state.undefinedBoundsId;
  if (bounds !== undefined) {
    const retained = state.boundsIds.get(bounds);
    if (retained !== undefined) return retained;
  }
  const id = nextId(state.boundsCount, "bounds");
  reserveBounds(state, id + 1);
  if (bounds !== undefined) {
    const offset = id * 3;
    state.boundsMinima.set(bounds.min, offset);
    state.boundsMaxima.set(bounds.max, offset);
    state.boundsDefined[id] = 1;
    state.boundsIds.set(bounds, id);
  } else {
    state.boundsDefined[id] = 0;
    state.undefinedBoundsId = id;
  }
  state.boundsCount = id + 1;
  return id;
};

/** Retains one copied full-precision 16-number local-model row plus its determinant. */
export const retainPacketLocalModel = (
  tables: PacketResourceTables,
  model: Mat4,
  determinant: number,
): number => {
  const state = tables as unknown as PacketResourceTablesState;
  const retained = state.localModelIds.get(model);
  if (retained !== undefined) return retained;
  const id = nextId(state.localModelCount, "local-model");
  reserveLocalModels(state, id + 1);
  state.localModels.set(model, id * 16);
  state.localModelDeterminants[id] = determinant;
  state.localModelIds.set(model, id);
  state.localModelCount = id + 1;
  return id;
};

/**
 * Borrows immutable loaded-material semantics by prepared-asset object identity.
 * The prepared asset owns the row; packet tables neither clone nor mutate it.
 */
export const retainPacketMaterial = (
  tables: PacketResourceTables,
  material: LoadedGltfMaterial,
): number => {
  const state = tables as unknown as PacketResourceTablesState;
  const retained = state.materialIds.get(material);
  if (retained !== undefined) return retained;
  const id = nextId(state.materialCount, "material");
  reserveMaterials(state, id + 1);
  state.materials[id] = material;
  state.materialIds.set(material, id);
  state.materialCount = id + 1;
  return id;
};

/** Appends a unique plan occurrence source without retaining a descriptor or GL handle. */
export const appendPacketRootSource = (
  tables: PacketResourceTables,
  row: PacketRootSourceRow,
): number => {
  const state = tables as unknown as PacketResourceTablesState;
  const kind = uint32ResourceValue(row.kind, "kind");
  const outerIndex = uint32ResourceValue(row.outerIndex, "outer index");
  const planOccurrenceIndex = uint32ResourceValue(
    row.planOccurrenceIndex,
    "plan occurrence index",
  );
  const id = nextId(state.rootSourceCount, "root-source");
  reserveRootSources(state, id + 1);
  state.rootSourceKinds[id] = kind;
  state.rootSourceOuterIndices[id] = outerIndex;
  state.rootSourcePlanOccurrenceIndices[id] = planOccurrenceIndex;
  state.rootSourceCount = id + 1;
  return id;
};

/** Allocation-free hot read into caller-owned bounds. False denotes the undefined row. */
export const readPacketBoundsInto = (
  tables: PacketResourceTables,
  id: number,
  out: MutableBounds3,
): boolean => {
  const state = tables as unknown as PacketResourceTablesState;
  const index = resourceIndex(id, state.boundsCount, "bounds");
  if (state.boundsDefined[index] === 0) return false;
  const offset = index * 3;
  out.max[0] = state.boundsMaxima[offset]!;
  out.max[1] = state.boundsMaxima[offset + 1]!;
  out.max[2] = state.boundsMaxima[offset + 2]!;
  out.min[0] = state.boundsMinima[offset]!;
  out.min[1] = state.boundsMinima[offset + 1]!;
  out.min[2] = state.boundsMinima[offset + 2]!;
  return true;
};

/** Diagnostic allocating resolver; hot paths should use `readPacketBoundsInto`. */
export const resolvePacketBounds = (
  tables: PacketResourceTables,
  id: number,
): Bounds3 | undefined => {
  const out: MutableBounds3 = { max: [0, 0, 0], min: [0, 0, 0] };
  return readPacketBoundsInto(tables, id, out) ? out : undefined;
};

/** Allocation-free hot read into a caller-owned full-precision target. Returns the determinant. */
export const readPacketLocalModelInto = (
  tables: PacketResourceTables,
  id: number,
  target: Float64Array | MutableMat4,
): number => {
  const state = tables as unknown as PacketResourceTablesState;
  const index = resourceIndex(id, state.localModelCount, "local-model");
  if (target.length < 16) {
    throw new Error("Royal packet local-model target must contain at least 16 numbers");
  }
  const offset = index * 16;
  for (let component = 0; component < 16; component += 1) {
    target[component] = state.localModels[offset + component]!;
  }
  return state.localModelDeterminants[index]!;
};

/** Diagnostic allocating resolver; hot paths should use `readPacketLocalModelInto`. */
export const resolvePacketLocalModel = (
  tables: PacketResourceTables,
  id: number,
): PacketLocalModelRow => {
  const model = new Float64Array(16);
  const determinant = readPacketLocalModelInto(tables, id, model);
  return {
    determinant,
    model: Array.from(model) as unknown as Mat4,
  };
};

/** Returns the borrowed immutable prepared-asset semantic identity. */
export const resolvePacketMaterial = (
  tables: PacketResourceTables,
  id: number,
): LoadedGltfMaterial => {
  const state = tables as unknown as PacketResourceTablesState;
  const index = resourceIndex(id, state.materialCount, "material");
  return state.materials[index]!;
};

/** Allocation-free hot read into a caller-owned numeric source row. */
export const readPacketRootSourceInto = (
  tables: PacketResourceTables,
  id: number,
  out: MutablePacketRootSourceRow,
): void => {
  const state = tables as unknown as PacketResourceTablesState;
  const index = resourceIndex(id, state.rootSourceCount, "root-source");
  out.kind = state.rootSourceKinds[index]!;
  out.outerIndex = state.rootSourceOuterIndices[index]!;
  out.planOccurrenceIndex = state.rootSourcePlanOccurrenceIndices[index]!;
};

/** Diagnostic allocating resolver; hot paths should use `readPacketRootSourceInto`. */
export const resolvePacketRootSource = (
  tables: PacketResourceTables,
  id: number,
): PacketRootSourceRow => {
  const out: MutablePacketRootSourceRow = { kind: 0, outerIndex: 0, planOccurrenceIndex: 0 };
  readPacketRootSourceInto(tables, id, out);
  return out;
};

/** Begins a full plan rebuild while retaining warm typed-array capacities. */
export const resetPacketResourceTablesForPlan = (tables: PacketResourceTables): void => {
  const state = tables as unknown as PacketResourceTablesState;
  state.boundsCount = 0;
  state.boundsIds = new WeakMap();
  state.localModelCount = 0;
  state.localModelIds = new WeakMap();
  for (let index = 0; index < state.materialCount; index += 1) state.materials[index] = undefined;
  state.materialCount = 0;
  state.materialIds = new WeakMap();
  state.rootSourceCount = 0;
  state.undefinedBoundsId = undefined;
  if (state.planRevision === Number.MAX_SAFE_INTEGER) {
    throw new Error("Royal packet resource-table plan revision is exhausted");
  }
  state.planRevision += 1;
};

const copyMaterial = (material: LoadedGltfMaterial): LoadedGltfMaterial => {
  const copySlot = (slot: LoadedGltfMaterialTextureSlot): LoadedGltfMaterialTextureSlot => ({
    ...slot,
    coordinates: {
      row0: [...slot.coordinates.row0],
      row1: [...slot.coordinates.row1],
      set: slot.coordinates.set,
    },
    ...(slot.sampler === undefined ? {} : { sampler: { ...slot.sampler } }),
  });
  return {
    ...material,
    ...(material.baseColorTexture === undefined
      ? {}
      : { baseColorTexture: copySlot(material.baseColorTexture) }),
    ...(material.color === undefined ? {} : { color: [...material.color] }),
    ...(material.emissive === undefined ? {} : { emissive: [...material.emissive] }),
    ...(material.emissiveTexture === undefined
      ? {}
      : { emissiveTexture: copySlot(material.emissiveTexture) }),
    ...(material.extensionFactors === undefined
      ? {}
      : {
        extensionFactors: {
          ...material.extensionFactors,
          attenuationColor: [...material.extensionFactors.attenuationColor],
          diffuseTransmissionColorFactor: [
            ...material.extensionFactors.diffuseTransmissionColorFactor,
          ],
          sheenColorFactor: [...material.extensionFactors.sheenColorFactor],
          specularColorFactor: [...material.extensionFactors.specularColorFactor],
        },
      }),
    ...(material.extensionTextures === undefined
      ? {}
      : {
        extensionTextures: Object.fromEntries(
          Object.entries(material.extensionTextures).map(([key, slot]) => [key, copySlot(slot)]),
        ),
      }),
    ...(material.metallicRoughnessTexture === undefined
      ? {}
      : { metallicRoughnessTexture: copySlot(material.metallicRoughnessTexture) }),
    ...(material.normalTexture === undefined
      ? {}
      : { normalTexture: copySlot(material.normalTexture) }),
    ...(material.occlusionTexture === undefined
      ? {}
      : { occlusionTexture: copySlot(material.occlusionTexture) }),
  } as LoadedGltfMaterial;
};

/** Cold diagnostic view. Every container and mutable semantic row is detached. */
export const packetResourceTablesSnapshot = (
  tables: PacketResourceTables,
): PacketResourceTablesSnapshot => {
  const state = tables as unknown as PacketResourceTablesState;
  return {
    bounds: Array.from(
      { length: state.boundsCount },
      (_, id) => resolvePacketBounds(tables, id),
    ),
    boundsCapacity: state.boundsCapacity,
    localModelCapacity: state.localModelCapacity,
    localModels: Array.from(
      { length: state.localModelCount },
      (_, id) => resolvePacketLocalModel(tables, id),
    ),
    materialCapacity: state.materialCapacity,
    materials: Array.from(
      { length: state.materialCount },
      (_, id) => copyMaterial(resolvePacketMaterial(tables, id)),
    ),
    planRevision: state.planRevision,
    rootSourceCapacity: state.rootSourceCapacity,
    rootSources: Array.from(
      { length: state.rootSourceCount },
      (_, id) => resolvePacketRootSource(tables, id),
    ),
  };
};
