import { describe, expect, it } from "vitest";
import {
  appendReadyGltfPacketOccurrence,
  clearGltfPacketOccurrence,
  createGltfPacketTopology,
  GLTF_PACKET_OCCURRENCE_STATUS,
  GLTF_PACKET_ROOT_SOURCE_KIND,
  rebuildGltfPacketTopology,
  replaceReadyGltfPacketOccurrence,
  type GltfPacketOccurrence,
  type GltfPacketPreparedPrimitive,
} from "../packages/renderer-webgl/src/gltf-packet-topology";
import {
  FRAME_PACKET_RENDER_CLASS,
  FRAME_PACKET_SIDEDNESS,
  NO_FRAME_PACKET_ID,
} from "../packages/renderer-webgl/src/frame-packets";
import type { LoadedGltfMaterial } from "../packages/renderer-webgl/src/gltf/prepared-asset";
import type { Mat4 } from "../packages/renderer-webgl/src/math/mat4";
import {
  packetResourceTablesSnapshot,
  resolvePacketRootSource,
} from "../packages/renderer-webgl/src/packet-resource-tables";
import { forEachFuzzCase } from "./fuzz";

const identity = (): Mat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const material = (
  alphaMode: LoadedGltfMaterial["alphaMode"] = "OPAQUE",
  doubleSided = false,
  transmissionFactor = 0,
): LoadedGltfMaterial => ({
  alphaMode,
  doubleSided,
  ...(transmissionFactor === 0
    ? {}
    : {
      extensionFactors: { transmissionFactor } as NonNullable<
        LoadedGltfMaterial["extensionFactors"]
      >,
    }),
});

const primitive = (
  geometryId: number,
  materials: readonly LoadedGltfMaterial[],
  localCount = 1,
): GltfPacketPreparedPrimitive => ({
  geometryId,
  localBounds: Array.from({ length: localCount }, (_, index) => ({
    max: [index + 1, index + 2, index + 3],
    min: [index, index + 1, index + 2],
  })),
  localModelDeterminants: Array.from({ length: localCount }, (_, index) =>
    index % 2 === 0 ? 1 : -1),
  localModels: Array.from({ length: localCount }, identity),
  materialAlternatives: materials.map((entry, level) => ({ level, material: entry })),
});

const occurrence = (
  occurrenceIndex: number,
  orderingSegment: number,
  primitives: readonly GltfPacketPreparedPrimitive[] | undefined,
  outerCount = 1,
  planOccurrenceIndex = occurrenceIndex,
): GltfPacketOccurrence => ({
  kind: outerCount > 1 ? "gltf-instances" : "gltf",
  occurrenceIndex,
  orderingSegment,
  outerCount,
  planOccurrenceIndex,
  ...(primitives === undefined ? {} : { primitives }),
});

describe("pure retained glTF packet topology", () => {
  it("emits node then material predicates for every material LOD alternative", () => {
    const opaque = material();
    const blended = material("BLEND", true);
    const candidate = {
      ...primitive(17, [opaque, blended]),
      materialLodSelectionIds: [41],
      nodeLod: { level: 2, selectionIds: [23] },
    } satisfies GltfPacketPreparedPrimitive;
    const topology = createGltfPacketTopology();

    rebuildGltfPacketTopology(topology, 12, [occurrence(0, 7, [candidate])]);

    expect(topology.catalog.count).toBe(2);
    expect(Array.from(topology.catalog.geometryIds.subarray(0, 2))).toEqual([17, 17]);
    expect(Array.from(topology.catalog.materialIds.subarray(0, 2))).toEqual([0, 1]);
    expect(Array.from(topology.catalog.lodRequirementFirsts.subarray(0, 2))).toEqual([0, 2]);
    expect(Array.from(topology.catalog.lodRequirementCounts.subarray(0, 2))).toEqual([2, 2]);
    expect(Array.from(topology.requirements.selectionIds.subarray(0, 4))).toEqual([23, 41, 23, 41]);
    expect(Array.from(topology.requirements.levels.subarray(0, 4))).toEqual([2, 0, 2, 1]);
    expect(Array.from(topology.catalog.renderClasses.subarray(0, 2))).toEqual([
      FRAME_PACKET_RENDER_CLASS.opaque,
      FRAME_PACKET_RENDER_CLASS.blended,
    ]);
    expect(topology.catalog.sidedness[1]).toBe(
      FRAME_PACKET_SIDEDNESS.doubleSided | FRAME_PACKET_SIDEDNESS.frontFaceCcw,
    );
  });

  it("keeps primitive, outer, local, then material order and singleton physical-free rows", () => {
    const first = {
      ...primitive(101, [material(), material("OPAQUE", false, 0.5)], 2),
      materialLodSelectionIds: [10, 11, 12, 13],
    } satisfies GltfPacketPreparedPrimitive;
    const second = primitive(202, [material("BLEND")]);
    const topology = createGltfPacketTopology();

    rebuildGltfPacketTopology(topology, 12, [occurrence(0, 9, [first, second], 2, 47)]);

    expect(topology.catalog.count).toBe(10);
    expect(Array.from(topology.catalog.geometryIds.subarray(0, 10))).toEqual([
      101, 101, 101, 101, 101, 101, 101, 101, 202, 202,
    ]);
    expect(Array.from(topology.catalog.instanceFirsts.subarray(0, 10))).toEqual([
      0, 0, 0, 0, 1, 1, 1, 1, 0, 1,
    ]);
    expect(Array.from(topology.catalog.instanceCounts.subarray(0, 10))).toEqual(
      Array.from({ length: 10 }, () => 1),
    );
    expect(Array.from(topology.catalog.instanceStreamIds.subarray(0, 10))).toEqual(
      Array.from({ length: 10 }, () => NO_FRAME_PACKET_ID),
    );
    expect(Array.from(topology.catalog.orderingSegments.subarray(0, 10))).toEqual(
      Array.from({ length: 10 }, () => 9),
    );
    expect(Array.from(topology.catalog.renderClasses.subarray(0, 10))).toEqual([
      0, 1, 0, 1, 0, 1, 0, 1, 2, 2,
    ]);
    expect(Array.from(topology.catalog.sidedness.subarray(0, 8))).toEqual([
      FRAME_PACKET_SIDEDNESS.frontFaceCcw,
      FRAME_PACKET_SIDEDNESS.frontFaceCcw,
      0,
      0,
      FRAME_PACKET_SIDEDNESS.frontFaceCcw,
      FRAME_PACKET_SIDEDNESS.frontFaceCcw,
      0,
      0,
    ]);
    expect(resolvePacketRootSource(topology.resources, topology.catalog.rootSourceIds[0]!)).toEqual({
      kind: GLTF_PACKET_ROOT_SOURCE_KIND.gltfInstances,
      outerIndex: 0,
      planOccurrenceIndex: 47,
    });
    expect(resolvePacketRootSource(topology.resources, topology.catalog.rootSourceIds[4]!)).toEqual({
      kind: GLTF_PACKET_ROOT_SOURCE_KIND.gltfInstances,
      outerIndex: 1,
      planOccurrenceIndex: 47,
    });
    expect(topology.catalog.rootSourceIds[0]).toBe(topology.catalog.rootSourceIds[8]);
    expect(topology.catalog.rootSourceIds[4]).toBe(topology.catalog.rootSourceIds[9]);
  });

  it("retains hidden and loading empty ranges and appends async readiness without compaction", () => {
    const topology = createGltfPacketTopology();
    const visible0 = occurrence(0, 0, [primitive(1, [material()])]);
    const loading = occurrence(1, 1, undefined);
    const hidden = { ...occurrence(2, 2, [primitive(2, [material()])]), hidden: true };
    const visible3 = occurrence(3, 3, [primitive(3, [material()])]);
    rebuildGltfPacketTopology(topology, 12, [visible0, loading, hidden, visible3]);

    expect(Array.from(topology.occurrenceFirsts.subarray(0, 4))).toEqual([0, 1, 1, 1]);
    expect(Array.from(topology.occurrenceCounts.subarray(0, 4))).toEqual([1, 0, 0, 1]);
    const untouchedFirsts = Array.from(topology.occurrenceFirsts.subarray(0, 4));
    const untouchedCounts = Array.from(topology.occurrenceCounts.subarray(0, 4));

    appendReadyGltfPacketOccurrence(topology, 12, occurrence(1, 1, [primitive(4, [material()], 2)]));

    expect(topology.catalog.count).toBe(4);
    expect(topology.occurrenceFirsts[1]).toBe(2);
    expect(topology.occurrenceCounts[1]).toBe(2);
    for (const index of [0, 2, 3]) {
      expect(topology.occurrenceFirsts[index]).toBe(untouchedFirsts[index]);
      expect(topology.occurrenceCounts[index]).toBe(untouchedCounts[index]);
    }
    expect(Array.from(topology.catalog.geometryIds.subarray(0, 4))).toEqual([1, 3, 4, 4]);
    expect(() => appendReadyGltfPacketOccurrence(
      topology,
      12,
      occurrence(1, 1, [primitive(5, [material()])]),
    )).toThrow(/already ready/);
  });

  it("distinguishes ready-empty occurrences from loading occurrences", () => {
    const topology = createGltfPacketTopology();
    rebuildGltfPacketTopology(topology, 12, [
      occurrence(0, 0, undefined, 1, 30),
      occurrence(1, 1, [], 1, 90),
    ]);

    expect(Array.from(topology.occurrenceStatuses.subarray(0, 2))).toEqual([
      GLTF_PACKET_OCCURRENCE_STATUS.loading,
      GLTF_PACKET_OCCURRENCE_STATUS.ready,
    ]);
    expect(Array.from(topology.occurrenceCounts.subarray(0, 2))).toEqual([0, 0]);
    expect(() => appendReadyGltfPacketOccurrence(
      topology,
      12,
      occurrence(1, 1, [], 1, 90),
    )).toThrow(/already ready/);
    appendReadyGltfPacketOccurrence(topology, 12, occurrence(0, 0, [], 1, 30));
    expect(Array.from(topology.occurrenceStatuses.subarray(0, 2))).toEqual([
      GLTF_PACKET_OCCURRENCE_STATUS.ready,
      GLTF_PACKET_OCCURRENCE_STATUS.ready,
    ]);
    expect(() => appendReadyGltfPacketOccurrence(
      topology,
      12,
      occurrence(0, 0, [], 1, 30),
    )).toThrow(/already ready/);
  });

  it("rejects stale plans and descriptors that do not exactly match their loading slot", () => {
    const topology = createGltfPacketTopology();
    const loading = occurrence(0, 7, undefined, 2, 81);
    rebuildGltfPacketTopology(topology, 20, [loading]);
    const ready = occurrence(0, 7, [primitive(4, [material()])], 2, 81);

    expect(() => appendReadyGltfPacketOccurrence(topology, 19, ready)).toThrow(/stale plan/);
    for (const mismatch of [
      { ...ready, kind: "gltf" as const, outerCount: 1 },
      { ...ready, orderingSegment: 8 },
      { ...ready, outerCount: 3 },
      { ...ready, planOccurrenceIndex: 82 },
      { ...ready, hidden: true },
    ]) {
      expect(() => appendReadyGltfPacketOccurrence(topology, 20, mismatch)).toThrow(/does not match/);
    }
    expect(topology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.loading);
    expect(topology.catalog.count).toBe(0);
  });

  it("prevalidates malformed matrices before mutation and permits a corrected retry", () => {
    const topology = createGltfPacketTopology();
    rebuildGltfPacketTopology(topology, 5, [occurrence(0, 0, undefined)]);
    const malformed = {
      ...primitive(1, [material()]),
      localModels: [[1, 0, 0] as unknown as Mat4],
    } satisfies GltfPacketPreparedPrimitive;

    expect(() => appendReadyGltfPacketOccurrence(
      topology,
      5,
      occurrence(0, 0, [malformed]),
    )).toThrow(/16 elements/);
    expect(topology.catalog.count).toBe(0);
    expect(topology.requirements.count).toBe(0);
    expect(topology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.loading);

    appendReadyGltfPacketOccurrence(topology, 5, occurrence(0, 0, [primitive(1, [material()])]));
    expect(topology.occurrenceCounts[0]).toBe(1);
    expect(topology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.ready);
  });

  it("poisons post-validation failures and leaves their partial tail unreachable", () => {
    const topology = createGltfPacketTopology();
    rebuildGltfPacketTopology(topology, 5, [occurrence(0, 0, undefined)]);
    const badModel = identity() as unknown as Array<number | symbol>;
    badModel[15] = Symbol("invalid-float");
    const partiallyEmitting = {
      ...primitive(1, [material()], 2),
      localModels: [identity(), badModel as unknown as Mat4],
    } satisfies GltfPacketPreparedPrimitive;

    expect(() => appendReadyGltfPacketOccurrence(
      topology,
      5,
      occurrence(0, 0, [partiallyEmitting]),
    )).toThrow();
    expect(topology.catalog.count).toBe(1);
    expect(topology.occurrenceCounts[0]).toBe(0);
    expect(topology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.failed);
    expect(() => appendReadyGltfPacketOccurrence(
      topology,
      5,
      occurrence(0, 0, [primitive(1, [material()])]),
    )).toThrow(/previously failed/);
  });

  it("treats a zero local determinant as legacy counter-clockwise orientation", () => {
    const topology = createGltfPacketTopology();
    const zero = {
      ...primitive(1, [material()]),
      localModelDeterminants: [0],
    } satisfies GltfPacketPreparedPrimitive;
    rebuildGltfPacketTopology(topology, 1, [occurrence(0, 0, [zero])]);

    expect(topology.catalog.sidedness[0]).toBe(FRAME_PACKET_SIDEDNESS.frontFaceCcw);
  });

  it("atomically replaces a ready nonempty occurrence with changed packet rows", () => {
    const topology = createGltfPacketTopology();
    rebuildGltfPacketTopology(topology, 7, [occurrence(0, 3, [primitive(1, [material()])])]);
    const oldFirst = topology.occurrenceFirsts[0]!;

    replaceReadyGltfPacketOccurrence(
      topology,
      7,
      occurrence(0, 3, [primitive(9, [material("BLEND")], 2)]),
    );

    expect(oldFirst).toBe(0);
    expect(topology.occurrenceFirsts[0]).toBe(1);
    expect(topology.occurrenceCounts[0]).toBe(2);
    expect(Array.from(topology.catalog.geometryIds.subarray(0, 3))).toEqual([1, 9, 9]);
    expect(Array.from(topology.catalog.renderClasses.subarray(1, 3))).toEqual([
      FRAME_PACKET_RENDER_CLASS.blended,
      FRAME_PACKET_RENDER_CLASS.blended,
    ]);
    expect(topology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.ready);
  });

  it("replaces a ready-empty occurrence with a nonempty tail", () => {
    const topology = createGltfPacketTopology();
    rebuildGltfPacketTopology(topology, 7, [occurrence(0, 3, [])]);

    replaceReadyGltfPacketOccurrence(
      topology,
      7,
      occurrence(0, 3, [primitive(9, [material()])]),
    );

    expect(topology.occurrenceFirsts[0]).toBe(0);
    expect(topology.occurrenceCounts[0]).toBe(1);
    expect(topology.catalog.geometryIds[0]).toBe(9);
  });

  it("preserves the selected old range when replacement emission fails", () => {
    const topology = createGltfPacketTopology();
    rebuildGltfPacketTopology(topology, 7, [occurrence(0, 3, [primitive(1, [material()])])]);
    const oldFirst = topology.occurrenceFirsts[0]!;
    const oldCount = topology.occurrenceCounts[0]!;
    const badModel = identity() as unknown as Array<number | symbol>;
    badModel[15] = Symbol("invalid-replacement-float");
    const partiallyEmitting = {
      ...primitive(9, [material()], 2),
      localModels: [identity(), badModel as unknown as Mat4],
    } satisfies GltfPacketPreparedPrimitive;

    expect(() => replaceReadyGltfPacketOccurrence(
      topology,
      7,
      occurrence(0, 3, [partiallyEmitting]),
    )).toThrow();
    expect(topology.catalog.count).toBe(2);
    expect(topology.occurrenceFirsts[0]).toBe(oldFirst);
    expect(topology.occurrenceCounts[0]).toBe(oldCount);
    expect(topology.catalog.geometryIds[oldFirst]).toBe(1);
    expect(topology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.ready);

    replaceReadyGltfPacketOccurrence(
      topology,
      7,
      occurrence(0, 3, [primitive(10, [material()])]),
    );
    expect(topology.occurrenceFirsts[0]).toBe(2);
    expect(topology.occurrenceCounts[0]).toBe(1);
    expect(topology.catalog.geometryIds[2]).toBe(10);
  });

  it("clears a ready occurrence to an unreachable terminal failure", () => {
    const topology = createGltfPacketTopology();
    rebuildGltfPacketTopology(topology, 7, [occurrence(0, 3, [primitive(1, [material()])])]);

    clearGltfPacketOccurrence(topology, 7, 0);

    expect(topology.occurrenceCounts[0]).toBe(0);
    expect(topology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.failed);
    expect(() => clearGltfPacketOccurrence(topology, 7, 0)).toThrow(/currently be ready/);
  });

  it("resets and rebuilds deterministically while retaining warmed capacities", () => {
    forEachFuzzCase({ cases: 48, seed: 0x544f_504f }, ({ random }) => {
      const topology = createGltfPacketTopology(random.int(1, 4));
      const count = random.int(1, 16);
      const occurrences = Array.from({ length: count }, (_, index) => occurrence(
        index,
        random.int(0, 8),
        random.boolean()
          ? [primitive(random.int(0, 1_000), [material()], random.int(0, 4))]
          : undefined,
      ));
      rebuildGltfPacketTopology(topology, 12, occurrences);
      const expected = {
        counts: Array.from(topology.occurrenceCounts.subarray(0, count)),
        firsts: Array.from(topology.occurrenceFirsts.subarray(0, count)),
        geometries: Array.from(topology.catalog.geometryIds.subarray(0, topology.catalog.count)),
      };
      const catalogCapacity = topology.catalog.capacity;
      const occurrenceFirsts = topology.occurrenceFirsts;
      const resourceCapacity = packetResourceTablesSnapshot(topology.resources).rootSourceCapacity;

      rebuildGltfPacketTopology(topology, 12, occurrences);

      expect(Array.from(topology.occurrenceCounts.subarray(0, count))).toEqual(expected.counts);
      expect(Array.from(topology.occurrenceFirsts.subarray(0, count))).toEqual(expected.firsts);
      expect(Array.from(topology.catalog.geometryIds.subarray(0, topology.catalog.count))).toEqual(
        expected.geometries,
      );
      expect(topology.catalog.capacity).toBe(catalogCapacity);
      expect(topology.occurrenceFirsts).toBe(occurrenceFirsts);
      expect(packetResourceTablesSnapshot(topology.resources).rootSourceCapacity).toBe(resourceCapacity);
    });
  });
});
