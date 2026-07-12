import { describe, expect, it } from "vitest";
import type { LoadedGltfMaterial } from "../packages/renderer-webgl/src/gltf/prepared-asset";
import type { Mat4 } from "../packages/renderer-webgl/src/math/mat4";
import type { Bounds3 } from "../packages/renderer-webgl/src/math/picking";
import {
  appendPacketRootSource,
  createPacketResourceTables,
  packetResourceTablesSnapshot,
  readPacketBoundsInto,
  readPacketLocalModelInto,
  readPacketRootSourceInto,
  resetPacketResourceTablesForPlan,
  resolvePacketBounds,
  resolvePacketLocalModel,
  resolvePacketMaterial,
  resolvePacketRootSource,
  retainPacketBounds,
  retainPacketLocalModel,
  retainPacketMaterial,
} from "../packages/renderer-webgl/src/packet-resource-tables";
import { NO_RESOURCE_ID } from "../packages/renderer-webgl/src/resource-id";
import { forEachFuzzCase, SeededRandom } from "./fuzz";

const randomBounds = (random: SeededRandom): Bounds3 => {
  const min = [random.number(-100, 100), random.number(-100, 100), random.number(-100, 100)] as const;
  return {
    max: [
      min[0] + random.number(0, 100),
      min[1] + random.number(0, 100),
      min[2] + random.number(0, 100),
    ],
    min,
  };
};

const randomModel = (random: SeededRandom): Mat4 => Array.from(
  { length: 16 },
  () => random.number(-20, 20),
) as unknown as Mat4;

const randomMaterial = (random: SeededRandom): LoadedGltfMaterial => ({
  alphaMode: random.pick(["BLEND", "MASK", "OPAQUE"] as const),
  color: [random.number(0, 1), random.number(0, 1), random.number(0, 1), random.number(0, 1)],
  doubleSided: random.boolean(),
  metallicFactor: random.number(0, 1),
  roughnessFactor: random.number(0, 1),
});

const expectFloat64Values = (actual: ArrayLike<number>, expected: ArrayLike<number>): void => {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    expect(actual[index]).toBe(expected[index]);
  }
};

describe("packet resource tables", () => {
  it("retains copied bounds and local models by identity with dense resource IDs", () => {
    forEachFuzzCase({ cases: 80, seed: 0x5441_424c }, ({ random }) => {
      const tables = createPacketResourceTables(random.int(1, 4));
      const expectedBounds: Bounds3[] = [];
      const expectedModels: { determinant: number; model: Mat4 }[] = [];

      const undefinedId = retainPacketBounds(tables, undefined);
      expect(retainPacketBounds(tables, undefined)).toBe(undefinedId);
      expect(resolvePacketBounds(tables, undefinedId)).toBeUndefined();

      const count = random.int(1, 48);
      for (let index = 0; index < count; index += 1) {
        const bounds = randomBounds(random);
        const model = randomModel(random);
        const determinant = random.number(-100, 100);
        const boundsId = retainPacketBounds(tables, bounds);
        const modelId = retainPacketLocalModel(tables, model, determinant);
        expect(boundsId).toBe(index + 1);
        expect(modelId).toBe(index);
        expect(retainPacketBounds(tables, bounds)).toBe(boundsId);
        expect(retainPacketLocalModel(tables, model, determinant + 1)).toBe(modelId);
        expectedBounds.push({ max: [...bounds.max], min: [...bounds.min] });
        expectedModels.push({ determinant, model: [...model] as Mat4 });

        (bounds.min as unknown as number[])[0] = 999_999;
        (model as unknown as number[])[0] = 999_999;
      }

      for (let index = 0; index < count; index += 1) {
        const bounds = resolvePacketBounds(tables, index + 1)!;
        const local = resolvePacketLocalModel(tables, index);
        expectFloat64Values(bounds.min, expectedBounds[index]!.min);
        expectFloat64Values(bounds.max, expectedBounds[index]!.max);
        expectFloat64Values(local.model, expectedModels[index]!.model);
        expect(local.determinant).toBe(expectedModels[index]!.determinant);
      }
    });
  });

  it("reads hot rows into caller-owned storage without rounding bounds inward", () => {
    const tables = createPacketResourceTables();
    const epsilon = Number.EPSILON;
    const boundsId = retainPacketBounds(tables, {
      max: [1 + epsilon, 2 + epsilon, 3 + epsilon],
      min: [-1 - epsilon, -2 - epsilon, -3 - epsilon],
    });
    const undefinedId = retainPacketBounds(tables, undefined);
    const model = [...randomModel(new SeededRandom(0x484f_5450))] as Mat4;
    (model as unknown as number[])[12] = 1000.123;
    const determinant = -7.251_234_567_89;
    const modelId = retainPacketLocalModel(tables, model, determinant);
    const rootId = appendPacketRootSource(tables, {
      kind: 3,
      outerIndex: 4,
      planOccurrenceIndex: 5,
    });
    const boundsOut = { max: [0, 0, 0] as [number, number, number], min: [0, 0, 0] as [number, number, number] };
    const absentOut = { max: [9, 9, 9] as [number, number, number], min: [8, 8, 8] as [number, number, number] };
    const modelOut = new Float64Array(16);
    const rootOut = { kind: 0, outerIndex: 0, planOccurrenceIndex: 0 };

    expect(readPacketBoundsInto(tables, boundsId, boundsOut)).toBe(true);
    expect(boundsOut).toEqual({
      max: [1 + epsilon, 2 + epsilon, 3 + epsilon],
      min: [-1 - epsilon, -2 - epsilon, -3 - epsilon],
    });
    expect(readPacketBoundsInto(tables, undefinedId, absentOut)).toBe(false);
    expect(absentOut).toEqual({ max: [9, 9, 9], min: [8, 8, 8] });
    expect(readPacketLocalModelInto(tables, modelId, modelOut)).toBe(determinant);
    expect(modelOut[12]).toBe(1000.123);
    expect(modelOut[12]).not.toBe(Math.fround(1000.123));
    expectFloat64Values(modelOut, model);
    expect(resolvePacketLocalModel(tables, modelId)).toEqual({ determinant, model: [...model] });
    readPacketRootSourceInto(tables, rootId, rootOut);
    expect(rootOut).toEqual({ kind: 3, outerIndex: 4, planOccurrenceIndex: 5 });
    expect(() => readPacketLocalModelInto(tables, modelId, new Float64Array(15))).toThrow(/16 numbers/);
  });

  it("retains material semantics by identity and appends unique numeric root sources", () => {
    forEachFuzzCase({ cases: 80, seed: 0x524f_4f54 }, ({ random }) => {
      const tables = createPacketResourceTables(random.int(1, 3));
      const count = random.int(1, 64);
      const materials: LoadedGltfMaterial[] = [];
      for (let index = 0; index < count; index += 1) {
        const material = randomMaterial(random);
        materials.push(material);
        expect(retainPacketMaterial(tables, material)).toBe(index);
        expect(retainPacketMaterial(tables, material)).toBe(index);
        expect(resolvePacketMaterial(tables, index)).toBe(material);

        const row = {
          kind: random.int(0, 8),
          outerIndex: random.int(0, 10_000),
          planOccurrenceIndex: random.int(0, 10_000),
        };
        expect(appendPacketRootSource(tables, row)).toBe(index);
        expect(resolvePacketRootSource(tables, index)).toEqual(row);
      }

      expect(packetResourceTablesSnapshot(tables).materials).toEqual(materials);
    });
  });

  it("returns detached resolver rows and a fully detached cold snapshot", () => {
    const tables = createPacketResourceTables();
    const bounds: Bounds3 = { max: [4, 5, 6], min: [1, 2, 3] };
    const model = randomModel(new SeededRandom(0x4445_5441));
    const material: LoadedGltfMaterial = {
      alphaMode: "OPAQUE",
      baseColorTexture: {
        coordinates: { row0: [1, 0, 0, 0], row1: [0, 1, 0, 0], set: 0 },
        sampler: { magFilter: "linear", minFilter: "linear" },
      },
      color: [0.1, 0.2, 0.3, 0.4],
      doubleSided: false,
    };
    const boundsId = retainPacketBounds(tables, bounds);
    const modelId = retainPacketLocalModel(tables, model, -2);
    const materialId = retainPacketMaterial(tables, material);
    appendPacketRootSource(tables, { kind: 2, outerIndex: 3, planOccurrenceIndex: 4 });

    const resolvedBounds = resolvePacketBounds(tables, boundsId)!;
    const resolvedModel = resolvePacketLocalModel(tables, modelId);
    (resolvedBounds.min as unknown as number[])[0] = 100;
    (resolvedModel.model as unknown as number[])[0] = 100;
    expect(resolvePacketBounds(tables, boundsId)!.min[0]).toBe(1);
    expect(resolvePacketLocalModel(tables, modelId).model[0]).not.toBe(100);

    const snapshot = packetResourceTablesSnapshot(tables);
    (snapshot.bounds[0]!.min as unknown as number[])[0] = 200;
    (snapshot.localModels[0]!.model as unknown as number[])[0] = 200;
    (snapshot.materials[0]!.color as unknown as number[])[0] = 200;
    (snapshot.materials[0]!.baseColorTexture!.sampler as { magFilter: string }).magFilter = "nearest";
    (snapshot.rootSources as PacketRootSourceMutation[])[0]!.kind = 200;
    expect(resolvePacketBounds(tables, boundsId)!.min[0]).toBe(1);
    expect(resolvePacketLocalModel(tables, modelId).model[0]).not.toBe(200);
    expect(resolvePacketMaterial(tables, materialId).color![0]).toBe(0.1);
    expect(resolvePacketMaterial(tables, materialId).baseColorTexture!.sampler!.magFilter).toBe("linear");
    expect(resolvePacketRootSource(tables, 0).kind).toBe(2);
  });

  it("resets at the plan boundary without shrinking warm capacities or retaining stale rows", () => {
    const tables = createPacketResourceTables(1);
    const bounds = randomBounds(new SeededRandom(0x504c_414e));
    const model = randomModel(new SeededRandom(0x4d4f_444c));
    const material = randomMaterial(new SeededRandom(0x4d41_544c));
    for (let index = 0; index < 40; index += 1) {
      retainPacketBounds(tables, index === 0 ? bounds : randomBounds(new SeededRandom(index)));
      retainPacketLocalModel(tables, index === 0 ? model : randomModel(new SeededRandom(index)), index);
      retainPacketMaterial(tables, index === 0 ? material : randomMaterial(new SeededRandom(index)));
      appendPacketRootSource(tables, { kind: 0, outerIndex: index, planOccurrenceIndex: index });
    }
    const warm = packetResourceTablesSnapshot(tables);

    resetPacketResourceTablesForPlan(tables);
    const reset = packetResourceTablesSnapshot(tables);
    expect(reset.bounds).toEqual([]);
    expect(reset.localModels).toEqual([]);
    expect(reset.materials).toEqual([]);
    expect(reset.rootSources).toEqual([]);
    expect(reset.planRevision).toBe(warm.planRevision + 1);
    expect(reset.boundsCapacity).toBe(warm.boundsCapacity);
    expect(reset.localModelCapacity).toBe(warm.localModelCapacity);
    expect(reset.materialCapacity).toBe(warm.materialCapacity);
    expect(reset.rootSourceCapacity).toBe(warm.rootSourceCapacity);
    expect(() => resolvePacketBounds(tables, 0)).toThrow(/populated row/);
    expect(() => resolvePacketLocalModel(tables, 0)).toThrow(/populated row/);
    expect(() => resolvePacketMaterial(tables, 0)).toThrow(/populated row/);
    expect(() => resolvePacketRootSource(tables, 0)).toThrow(/populated row/);

    expect(retainPacketBounds(tables, bounds)).toBe(0);
    expect(retainPacketLocalModel(tables, model, 1)).toBe(0);
    expect(retainPacketMaterial(tables, material)).toBe(0);
    expect(appendPacketRootSource(tables, { kind: 1, outerIndex: 2, planOccurrenceIndex: 3 })).toBe(0);
  });

  it("rejects sentinel, non-integer, sparse, and out-of-range IDs", () => {
    expect(() => createPacketResourceTables(0)).toThrow(/capacity/);
    const tables = createPacketResourceTables();
    expect(() => appendPacketRootSource(tables, {
      kind: NO_RESOURCE_ID,
      outerIndex: 0,
      planOccurrenceIndex: 0,
    })).toThrow(/kind/);
    expect(() => appendPacketRootSource(tables, {
      kind: 0,
      outerIndex: -1,
      planOccurrenceIndex: 0,
    })).toThrow(/outer index/);
    expect(() => appendPacketRootSource(tables, {
      kind: 0,
      outerIndex: 0,
      planOccurrenceIndex: 1.5,
    })).toThrow(/occurrence/);
    expect(packetResourceTablesSnapshot(tables).rootSources).toEqual([]);
    expect(() => resolvePacketBounds(tables, 0)).toThrow(/populated row/);
    expect(() => resolvePacketMaterial(tables, NO_RESOURCE_ID)).toThrow(/populated row/);
  });
});

type PacketRootSourceMutation = {
  kind: number;
  outerIndex: number;
  planOccurrenceIndex: number;
};
