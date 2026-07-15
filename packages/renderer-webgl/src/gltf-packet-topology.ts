import {
  appendFramePacket,
  appendFramePacketLodRequirement,
  createFramePacketCatalog,
  createFramePacketLodRequirements,
  FRAME_PACKET_RENDER_CLASS,
  FRAME_PACKET_SIDEDNESS,
  resetFramePacketCatalog,
  resetFramePacketLodRequirements,
  type FramePacketCatalog,
  type FramePacketLodRequirements,
  type FramePacketRenderClass,
} from "./frame-packets";
import type { LoadedGltfMaterial } from "./gltf/prepared-asset";
import type { Mat4 } from "./math/mat4";
import type { Bounds3 } from "./math/picking";
import {
  appendPacketRootSource,
  createPacketResourceTables,
  resetPacketResourceTablesForPlan,
  retainPacketBounds,
  retainPacketLocalModel,
  retainPacketMaterial,
  type PacketResourceTables,
} from "./packet-resource-tables";

export type GltfPacketNodeLod = {
  /** One selection ID per outer occurrence instance. */
  readonly selectionIds: readonly number[];
  readonly level: number;
};

export type GltfPacketMaterialAlternative = {
  readonly material: LoadedGltfMaterial;
  /** Defaults to this alternative's array index. */
  readonly level?: number;
};

/** Prepared semantic primitive data. It contains no React nodes or WebGL handles. */
export type GltfPacketPreparedPrimitive = {
  readonly geometryId: number;
  readonly localBounds: readonly (Bounds3 | undefined)[];
  readonly localModelDeterminants: readonly number[];
  readonly localModels: readonly Mat4[];
  readonly materialAlternatives: readonly GltfPacketMaterialAlternative[];
  /** One selection ID per outer/local pair, in outer-major order. */
  readonly materialLodSelectionIds?: readonly number[];
  readonly nodeLod?: GltfPacketNodeLod;
};

export type GltfPacketOccurrence = {
  readonly kind: "gltf" | "gltf-instances";
  /** Dense index in this topology's occurrence range tables. */
  readonly occurrenceIndex: number;
  readonly orderingSegment: number;
  /** Number of dynamic root instances. Zero emits no candidates. */
  readonly outerCount: number;
  /** Source node/occurrence index in the frame plan; it need not be dense here. */
  readonly planOccurrenceIndex: number;
  /** Undefined represents a loading occurrence; an empty array is a ready empty asset. */
  readonly primitives?: readonly GltfPacketPreparedPrimitive[];
  readonly hidden?: boolean;
};

export const GLTF_PACKET_ROOT_SOURCE_KIND = Object.freeze({
  gltf: 0,
  gltfInstances: 1,
} as const);

export const GLTF_PACKET_OCCURRENCE_STATUS = Object.freeze({
  loading: 0,
  ready: 1,
  failed: 2,
} as const);

export type GltfPacketTopology = {
  readonly catalog: FramePacketCatalog;
  occurrenceCapacity: number;
  occurrenceCount: number;
  occurrenceCounts: Uint32Array;
  occurrenceFirsts: Uint32Array;
  occurrenceHidden: Uint8Array;
  occurrenceKinds: Uint8Array;
  occurrenceOrderingSegments: Uint32Array;
  occurrenceOuterCounts: Uint32Array;
  occurrencePlanIndices: Uint32Array;
  occurrenceStatuses: Uint8Array;
  planRevision: number;
  readonly requirements: FramePacketLodRequirements;
  readonly resources: PacketResourceTables;
};

const positiveCapacity = (capacity: number): number => {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error("Royal glTF packet-topology capacity must be a positive safe integer");
  }
  return capacity;
};

export const createGltfPacketTopology = (capacity = 1): GltfPacketTopology => {
  const normalized = positiveCapacity(capacity);
  return {
    catalog: createFramePacketCatalog(normalized),
    occurrenceCapacity: normalized,
    occurrenceCount: 0,
    occurrenceCounts: new Uint32Array(normalized),
    occurrenceFirsts: new Uint32Array(normalized),
    occurrenceHidden: new Uint8Array(normalized),
    occurrenceKinds: new Uint8Array(normalized),
    occurrenceOrderingSegments: new Uint32Array(normalized),
    occurrenceOuterCounts: new Uint32Array(normalized),
    occurrencePlanIndices: new Uint32Array(normalized),
    occurrenceStatuses: new Uint8Array(normalized),
    planRevision: 0,
    requirements: createFramePacketLodRequirements(normalized),
    resources: createPacketResourceTables(normalized),
  };
};

const reserveOccurrences = (topology: GltfPacketTopology, required: number): void => {
  if (required <= topology.occurrenceCapacity) return;
  let capacity = topology.occurrenceCapacity;
  while (capacity < required) capacity *= 2;
  const firsts = new Uint32Array(capacity);
  const counts = new Uint32Array(capacity);
  const hidden = new Uint8Array(capacity);
  const kinds = new Uint8Array(capacity);
  const orderingSegments = new Uint32Array(capacity);
  const outerCounts = new Uint32Array(capacity);
  const planIndices = new Uint32Array(capacity);
  const statuses = new Uint8Array(capacity);
  firsts.set(topology.occurrenceFirsts);
  counts.set(topology.occurrenceCounts);
  hidden.set(topology.occurrenceHidden);
  kinds.set(topology.occurrenceKinds);
  orderingSegments.set(topology.occurrenceOrderingSegments);
  outerCounts.set(topology.occurrenceOuterCounts);
  planIndices.set(topology.occurrencePlanIndices);
  statuses.set(topology.occurrenceStatuses);
  topology.occurrenceCapacity = capacity;
  topology.occurrenceFirsts = firsts;
  topology.occurrenceCounts = counts;
  topology.occurrenceHidden = hidden;
  topology.occurrenceKinds = kinds;
  topology.occurrenceOrderingSegments = orderingSegments;
  topology.occurrenceOuterCounts = outerCounts;
  topology.occurrencePlanIndices = planIndices;
  topology.occurrenceStatuses = statuses;
};

const uint32 = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`Royal glTF packet-topology ${label} must be an unsigned 32-bit integer`);
  }
  return value;
};

const resourceId = (value: number, label: string): number => {
  const id = uint32(value, label);
  if (id === 0xffff_ffff) {
    throw new Error(`Royal glTF packet-topology ${label} must be a resource ID`);
  }
  return id;
};

const planRevision = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Royal glTF packet-topology plan revision must be a nonnegative safe integer");
  }
  return value;
};

const occurrenceKind = (kind: GltfPacketOccurrence["kind"]): number =>
  kind === "gltf"
    ? GLTF_PACKET_ROOT_SOURCE_KIND.gltf
    : GLTF_PACKET_ROOT_SOURCE_KIND.gltfInstances;

const validateOccurrence = (
  occurrence: GltfPacketOccurrence,
  expectedIndex: number,
): void => {
  if (occurrence.occurrenceIndex !== expectedIndex) {
    throw new Error("Royal glTF packet-topology occurrences must use dense topology order");
  }
  resourceId(occurrence.planOccurrenceIndex, "plan occurrence index");
  uint32(occurrence.orderingSegment, "ordering segment");
  const outerCount = uint32(occurrence.outerCount, "outer count");
  if (occurrence.kind === "gltf" && outerCount > 1) {
    throw new Error("Royal ordinary glTF packet occurrence supports at most one outer instance");
  }
  for (const primitive of occurrence.primitives ?? []) {
    resourceId(primitive.geometryId, "geometry ID");
    const localCount = primitive.localModels.length;
    if (primitive.localBounds.length !== localCount
      || primitive.localModelDeterminants.length !== localCount) {
      throw new Error("Royal glTF packet-topology primitive local arrays must have equal lengths");
    }
    for (const model of primitive.localModels) {
      if (model.length !== 16) {
        throw new Error("Royal glTF packet-topology local model must contain 16 elements");
      }
    }
    for (const determinant of primitive.localModelDeterminants) {
      if (!Number.isFinite(determinant)) {
        throw new Error("Royal glTF packet-topology local determinant must be finite");
      }
    }
    if (primitive.materialAlternatives.length === 0 && localCount > 0 && outerCount > 0) {
      throw new Error("Royal glTF packet-topology drawable primitive requires a material");
    }
    if (primitive.nodeLod !== undefined) {
      resourceId(primitive.nodeLod.level, "node LOD level");
      if (primitive.nodeLod.selectionIds.length !== outerCount) {
        throw new Error("Royal glTF packet-topology node LOD selections must align with outer instances");
      }
      for (const selectionId of primitive.nodeLod.selectionIds) {
        resourceId(selectionId, "node LOD selection ID");
      }
    }
    const isMaterialLod = primitive.materialAlternatives.length > 1;
    if (isMaterialLod
      && primitive.materialLodSelectionIds?.length !== outerCount * localCount) {
      throw new Error("Royal glTF packet-topology material LOD selections must align with outer/local pairs");
    }
    if (!isMaterialLod && primitive.materialLodSelectionIds !== undefined) {
      throw new Error("Royal glTF packet-topology single material cannot declare LOD selections");
    }
    for (const [alternativeIndex, alternative] of primitive.materialAlternatives.entries()) {
      resourceId(alternative.level ?? alternativeIndex, "material LOD level");
    }
    for (const selectionId of primitive.materialLodSelectionIds ?? []) {
      resourceId(selectionId, "material LOD selection ID");
    }
  }
};

const materialRenderClass = (material: LoadedGltfMaterial): FramePacketRenderClass => {
  if (material.alphaMode === "BLEND") return FRAME_PACKET_RENDER_CLASS.blended;
  if ((material.extensionFactors?.transmissionFactor ?? 0) > 0) {
    return FRAME_PACKET_RENDER_CLASS.transmissive;
  }
  return FRAME_PACKET_RENDER_CLASS.opaque;
};

const appendReadyOccurrenceRows = (
  topology: GltfPacketTopology,
  occurrence: GltfPacketOccurrence,
): void => {
  if (occurrence.hidden === true || occurrence.primitives === undefined) return;
  const outerCount = occurrence.outerCount;
  const rootSourceIds = new Uint32Array(outerCount);
  if (occurrence.primitives.some((primitive) =>
    primitive.localModels.length > 0 && primitive.materialAlternatives.length > 0)) {
    for (let outerIndex = 0; outerIndex < outerCount; outerIndex += 1) {
      rootSourceIds[outerIndex] = appendPacketRootSource(topology.resources, {
        kind: occurrenceKind(occurrence.kind),
        outerIndex,
        planOccurrenceIndex: occurrence.planOccurrenceIndex,
      });
    }
  }
  for (const primitive of occurrence.primitives) {
    for (let outerIndex = 0; outerIndex < outerCount; outerIndex += 1) {
      const rootSourceId = rootSourceIds[outerIndex]!;
      for (let localIndex = 0; localIndex < primitive.localModels.length; localIndex += 1) {
        const boundsId = retainPacketBounds(topology.resources, primitive.localBounds[localIndex]);
        const localDeterminant = primitive.localModelDeterminants[localIndex]!;
        const localModelId = retainPacketLocalModel(
          topology.resources,
          primitive.localModels[localIndex]!,
          localDeterminant,
        );
        const materialSelectionId = primitive.materialLodSelectionIds?.[
          outerIndex * primitive.localModels.length + localIndex
        ];
        for (const [alternativeIndex, alternative] of primitive.materialAlternatives.entries()) {
          const lodRequirementFirst = topology.requirements.count;
          if (primitive.nodeLod !== undefined) {
            appendFramePacketLodRequirement(
              topology.requirements,
              primitive.nodeLod.selectionIds[outerIndex]!,
              primitive.nodeLod.level,
            );
          }
          if (materialSelectionId !== undefined) {
            appendFramePacketLodRequirement(
              topology.requirements,
              materialSelectionId,
              alternative.level ?? alternativeIndex,
            );
          }
          let sidedness = localDeterminant >= 0
            ? FRAME_PACKET_SIDEDNESS.frontFaceCcw
            : 0;
          if (alternative.material.doubleSided) sidedness |= FRAME_PACKET_SIDEDNESS.doubleSided;
          appendFramePacket(topology.catalog, {
            boundsId,
            geometryId: primitive.geometryId,
            instanceCount: 1,
            instanceFirst: outerIndex,
            localModelId,
            lodRequirementCount: topology.requirements.count - lodRequirementFirst,
            lodRequirementFirst,
            materialId: retainPacketMaterial(topology.resources, alternative.material),
            orderingSegment: occurrence.orderingSegment,
            renderClass: materialRenderClass(alternative.material),
            rootSourceId,
            sidedness,
          });
        }
      }
    }
  }
};

/** Clears logical counts while retaining all allocated typed-array capacity. */
const resetGltfPacketTopologyForPlan = (topology: GltfPacketTopology): void => {
  resetFramePacketCatalog(topology.catalog);
  resetFramePacketLodRequirements(topology.requirements);
  resetPacketResourceTablesForPlan(topology.resources);
  topology.occurrenceCount = 0;
};

/** Recompiles a complete plan in occurrence order. Loading occurrences retain empty ranges. */
export const rebuildGltfPacketTopology = (
  topology: GltfPacketTopology,
  revision: number,
  occurrences: readonly GltfPacketOccurrence[],
): void => {
  const normalizedRevision = planRevision(revision);
  resetGltfPacketTopologyForPlan(topology);
  topology.planRevision = normalizedRevision;
  reserveOccurrences(topology, Math.max(1, occurrences.length));
  for (const occurrence of occurrences) {
    validateOccurrence(occurrence, topology.occurrenceCount);
    const first = topology.catalog.count;
    appendReadyOccurrenceRows(topology, occurrence);
    topology.occurrenceFirsts[topology.occurrenceCount] = first;
    topology.occurrenceCounts[topology.occurrenceCount] = topology.catalog.count - first;
    topology.occurrenceHidden[topology.occurrenceCount] = occurrence.hidden === true ? 1 : 0;
    topology.occurrenceKinds[topology.occurrenceCount] = occurrenceKind(occurrence.kind);
    topology.occurrenceOrderingSegments[topology.occurrenceCount] = occurrence.orderingSegment;
    topology.occurrenceOuterCounts[topology.occurrenceCount] = occurrence.outerCount;
    topology.occurrencePlanIndices[topology.occurrenceCount] = occurrence.planOccurrenceIndex;
    topology.occurrenceStatuses[topology.occurrenceCount] = occurrence.primitives === undefined
      ? GLTF_PACKET_OCCURRENCE_STATUS.loading
      : GLTF_PACKET_OCCURRENCE_STATUS.ready;
    topology.occurrenceCount += 1;
  }
};

/**
 * Fills an existing empty occurrence by appending a tail span. Existing ranges never move.
 * This is the async prepared-asset completion seam.
 */
export const appendReadyGltfPacketOccurrence = (
  topology: GltfPacketTopology,
  revision: number,
  occurrence: GltfPacketOccurrence,
): void => {
  if (planRevision(revision) !== topology.planRevision) {
    throw new Error("Royal glTF packet-topology async occurrence has a stale plan revision");
  }
  const index = occurrence.occurrenceIndex;
  if (!Number.isSafeInteger(index) || index < 0 || index >= topology.occurrenceCount) {
    throw new Error("Royal glTF packet-topology async occurrence must exist in the current plan");
  }
  if (topology.occurrenceStatuses[index] === GLTF_PACKET_OCCURRENCE_STATUS.failed) {
    throw new Error("Royal glTF packet-topology async occurrence previously failed; rebuild is required");
  }
  if (topology.occurrenceStatuses[index] !== GLTF_PACKET_OCCURRENCE_STATUS.loading) {
    throw new Error("Royal glTF packet-topology async occurrence is already ready");
  }
  if (topology.occurrenceKinds[index] !== occurrenceKind(occurrence.kind)
    || topology.occurrencePlanIndices[index] !== occurrence.planOccurrenceIndex
    || topology.occurrenceOrderingSegments[index] !== occurrence.orderingSegment
    || topology.occurrenceOuterCounts[index] !== occurrence.outerCount
    || topology.occurrenceHidden[index] !== (occurrence.hidden === true ? 1 : 0)) {
    throw new Error("Royal glTF packet-topology async occurrence does not match its loading slot");
  }
  validateOccurrence(occurrence, index);
  if (occurrence.primitives === undefined) {
    throw new Error("Royal glTF packet-topology async occurrence must be ready");
  }
  const first = topology.catalog.count;
  try {
    appendReadyOccurrenceRows(topology, occurrence);
    topology.occurrenceFirsts[index] = first;
    topology.occurrenceCounts[index] = topology.catalog.count - first;
    topology.occurrenceStatuses[index] = GLTF_PACKET_OCCURRENCE_STATUS.ready;
  } catch (error) {
    // Some resource or packet rows may have reached the physical tail. They are
    // intentionally unreachable because this slot retains an empty range, and
    // cannot be retried until a complete plan rebuild discards the failed tail.
    topology.occurrenceFirsts[index] = first;
    topology.occurrenceCounts[index] = 0;
    topology.occurrenceStatuses[index] = GLTF_PACKET_OCCURRENCE_STATUS.failed;
    throw error;
  }
};

/**
 * Appends a structurally updated ready occurrence and atomically publishes its
 * replacement range. The previous range remains selected if emission fails;
 * any partial replacement tail is intentionally unreachable and may be skipped
 * by a later retry.
 */
export const replaceReadyGltfPacketOccurrence = (
  topology: GltfPacketTopology,
  revision: number,
  occurrence: GltfPacketOccurrence,
): void => {
  if (planRevision(revision) !== topology.planRevision) {
    throw new Error("Royal glTF packet-topology replacement has a stale plan revision");
  }
  const index = occurrence.occurrenceIndex;
  if (!Number.isSafeInteger(index) || index < 0 || index >= topology.occurrenceCount) {
    throw new Error("Royal glTF packet-topology replacement occurrence must exist in the current plan");
  }
  if (topology.occurrenceStatuses[index] !== GLTF_PACKET_OCCURRENCE_STATUS.ready) {
    throw new Error("Royal glTF packet-topology replacement occurrence must currently be ready");
  }
  if (topology.occurrenceKinds[index] !== occurrenceKind(occurrence.kind)
    || topology.occurrencePlanIndices[index] !== occurrence.planOccurrenceIndex
    || topology.occurrenceOrderingSegments[index] !== occurrence.orderingSegment
    || topology.occurrenceOuterCounts[index] !== occurrence.outerCount
    || topology.occurrenceHidden[index] !== (occurrence.hidden === true ? 1 : 0)) {
    throw new Error("Royal glTF packet-topology replacement does not match its current slot");
  }
  validateOccurrence(occurrence, index);
  if (occurrence.primitives === undefined) {
    throw new Error("Royal glTF packet-topology replacement occurrence must be ready");
  }
  const first = topology.catalog.count;
  appendReadyOccurrenceRows(topology, occurrence);
  topology.occurrenceFirsts[index] = first;
  topology.occurrenceCounts[index] = topology.catalog.count - first;
};

/** Makes a ready occurrence unreachable after a terminal prepared-asset error. */
export const clearGltfPacketOccurrence = (
  topology: GltfPacketTopology,
  revision: number,
  occurrenceIndex: number,
): void => {
  if (planRevision(revision) !== topology.planRevision) {
    throw new Error("Royal glTF packet-topology clear has a stale plan revision");
  }
  if (!Number.isSafeInteger(occurrenceIndex)
    || occurrenceIndex < 0
    || occurrenceIndex >= topology.occurrenceCount) {
    throw new Error("Royal glTF packet-topology clear occurrence must exist in the current plan");
  }
  if (topology.occurrenceStatuses[occurrenceIndex] !== GLTF_PACKET_OCCURRENCE_STATUS.ready) {
    throw new Error("Royal glTF packet-topology clear occurrence must currently be ready");
  }
  topology.occurrenceFirsts[occurrenceIndex] = topology.catalog.count;
  topology.occurrenceCounts[occurrenceIndex] = 0;
  topology.occurrenceStatuses[occurrenceIndex] = GLTF_PACKET_OCCURRENCE_STATUS.failed;
};
