import {
  boxGeometry,
  createGltfInstanceTransforms,
  directionalLight,
  gltf,
  gltfInstances,
  mesh,
  perspectiveCamera,
  scene,
  standardMaterial,
  textureAsset,
  virtualTexture,
  type RenderNode,
  type RenderObjectRef,
  type RenderRoot,
} from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  compileFramePlan,
  createResourceManifestDiffScratch,
  diffResourceManifests,
  type CountedKeyDelta,
  type CountedReference,
  type CountedReferenceDelta,
  type FramePlan,
} from "../packages/renderer-webgl/src/frame/plan";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

const camera = perspectiveCamera({
  far: 1_000,
  fovY: Math.PI / 3,
  near: 0.1,
  position: [0, 0, 5],
  rotation: [0, 0, 0],
});
const geometry = boxGeometry(1);
const ordinaryTextures = Array.from({ length: 4 }, (_value, index) =>
  textureAsset({ contentKey: `image-${index}`, src: `/image-${index}.png`, version: index }));
const virtualTextures = Array.from({ length: 3 }, (_value, index) =>
  virtualTexture({ contentKey: `virtual-${index}`, manifestUri: `/virtual-${index}.json`, version: index }));
const refs: readonly RenderObjectRef[] = Array.from({ length: 4 }, () => ({ current: null }));
const bulkSources = Array.from({ length: 4 }, (_value, index) =>
  createGltfInstanceTransforms({ count: index + 1 }));

const randomScene = (random: SeededRandom): RenderRoot => {
  const nodes: RenderNode[] = [];
  const availableRefs = [...refs];
  const maybeRef = (): { readonly ref: RenderObjectRef } | Record<string, never> => {
    if (!random.boolean(0.7) || availableRefs.length === 0) return {};
    const ref = random.pick(availableRefs);
    availableRefs.splice(availableRefs.indexOf(ref), 1);
    return { ref };
  };
  for (let index = 0; index < random.int(0, 36); index += 1) {
    const choice = random.int(0, 6);
    if (choice === 0 || choice === 1) {
      const texture = choice === 0 ? random.pick(ordinaryTextures) : random.pick(virtualTextures);
      nodes.push(mesh({
        geometry,
        material: standardMaterial({ texture }),
        ...maybeRef(),
      }));
    } else if (choice === 2 || choice === 3) {
      const assetIndex = random.int(0, 5);
      nodes.push(gltf({
        src: `/model-${assetIndex}.gltf`,
        version: assetIndex % 2,
        ...maybeRef(),
      }));
    } else if (choice === 4) {
      const assetIndex = random.int(0, 5);
      nodes.push(gltfInstances({
        instances: random.pick(bulkSources),
        src: `/model-${assetIndex}.gltf`,
        version: assetIndex % 2,
      }));
    } else {
      nodes.push(directionalLight({ direction: [0, -1, 0] }));
    }
  }
  return scene({
    camera,
    clearColor: [random.float(), random.float(), random.float(), random.float()],
    exposureEv100: random.number(-4, 16),
    nodes,
    toneMapping: random.pick(["linear-clamp", "pbr-neutral"] as const),
  });
};

const expectReferenceCounts = <Resource>(
  rows: readonly Resource[],
  counted: readonly CountedReference<Resource>[],
): void => {
  const expected = new Map<Resource, number>();
  for (const resource of rows) expected.set(resource, (expected.get(resource) ?? 0) + 1);
  expect(counted.map(({ count, resource }) => [resource, count])).toEqual([...expected]);
};

const expectCompiledInvariants = (plan: FramePlan): void => {
  expect(plan.nodeKinds).toEqual(plan.nodes.map((node) => node.kind));
  expect(plan.occurrenceIndices).toEqual(plan.nodes.map((_node, index) => index));
  expect(plan.pickingIds).toEqual(plan.nodes.map((node) => "pickingId" in node ? node.pickingId : undefined));
  expect(plan.lightNodeIndices).toEqual(plan.nodes.flatMap((node, index) =>
    node.kind === "directional-light" || node.kind === "point-light" || node.kind === "spot-light"
      ? [index]
      : []));
  expect(plan.lightNodes).toEqual(plan.lightNodeIndices.map((index) => plan.nodes[index]));

  let segment = 0;
  const segments = plan.nodes.map((node) => {
    const result = segment;
    if (node.kind === "mesh") segment += 1;
    return result;
  });
  expect(plan.orderSegments).toEqual(segments);

  const gltfCounts = new Map<string, number>();
  for (const row of plan.gltfRequestRows) {
    gltfCounts.set(row.requestKey, (gltfCounts.get(row.requestKey) ?? 0) + 1);
  }
  expect(plan.manifest.gltfRequests.map(({ count, key }) => [key, count])).toEqual([...gltfCounts]);
  expect(plan.manifest.directGeometries.reduce((sum, entry) => sum + entry.count, 0))
    .toBe(plan.nodes.filter((node) => node.kind === "mesh").length);
  expect(new Set(plan.manifest.directGeometries.map((entry) => entry.key)).size)
    .toBe(plan.manifest.directGeometries.length);

  const ordinaryCounts = new Map<string, number>();
  const virtualCounts = new Map<string, number>();
  for (const row of plan.directTextureRows) {
    const counts = row.texture.kind === "asset" ? ordinaryCounts : virtualCounts;
    counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  }
  expect(plan.manifest.ordinaryTextures.map(({ count, key }) => [key, count])).toEqual([...ordinaryCounts]);
  expect(plan.manifest.virtualTextures.map(({ count, key }) => [key, count])).toEqual([...virtualCounts]);
  expectReferenceCounts(plan.renderObjectRefRows.map((row) => row.ref), plan.manifest.renderObjectRefs);
  expectReferenceCounts(plan.bulkInstanceRows.map((row) => row.source), plan.manifest.bulkInstances);
};

const keyCounts = <Entry extends { readonly count: number; readonly key: string }>(entries: readonly Entry[]) =>
  new Map(entries.map((entry) => [entry.key, entry.count]));

const referenceCounts = <Resource>(entries: readonly CountedReference<Resource>[]) =>
  new Map(entries.map((entry) => [entry.resource, entry.count]));

const expectKeyDelta = <Entry extends { readonly count: number; readonly key: string }>(
  previous: readonly Entry[],
  next: readonly Entry[],
  delta: readonly CountedKeyDelta<Entry>[],
): void => {
  const applied = keyCounts(previous);
  const nextCounts = keyCounts(next);
  for (const row of delta) {
    expect(row.previousCount).toBe(applied.get(row.key) ?? 0);
    expect(row.nextCount).toBe(nextCounts.get(row.key) ?? 0);
    expect(row.delta).toBe(row.nextCount - row.previousCount);
    expect(row.nextCount).toBeGreaterThanOrEqual(0);
    if (row.nextCount === 0) applied.delete(row.key);
    else applied.set(row.key, row.nextCount);
  }
  expect(applied).toEqual(nextCounts);
};

const expectReferenceDelta = <Resource>(
  previous: readonly CountedReference<Resource>[],
  next: readonly CountedReference<Resource>[],
  delta: readonly CountedReferenceDelta<Resource>[],
): void => {
  const applied = referenceCounts(previous);
  const nextCounts = referenceCounts(next);
  for (const row of delta) {
    expect(row.previousCount).toBe(applied.get(row.resource) ?? 0);
    expect(row.nextCount).toBe(nextCounts.get(row.resource) ?? 0);
    expect(row.delta).toBe(row.nextCount - row.previousCount);
    expect(row.nextCount).toBeGreaterThanOrEqual(0);
    if (row.nextCount === 0) applied.delete(row.resource);
    else applied.set(row.resource, row.nextCount);
  }
  expect(applied).toEqual(nextCounts);
};

describe("retained frame-plan properties", () => {
  it("rejects one imperative ref attached to multiple nodes", () => {
    const ref: RenderObjectRef = { current: null };
    const duplicateRefScene = scene({
      camera,
      nodes: [
        mesh({ geometry, material: standardMaterial({ texture: ordinaryTextures[0]! }), ref }),
        gltf({ ref, src: "/duplicate-ref.gltf" }),
      ],
    });
    expect(() => compileFramePlan(duplicateRefScene, 1)).toThrow(
      "A render-object ref may be attached to only one scene node",
    );
  });

  it("compiles deterministic tables and produces conservative reusable manifest deltas", () => {
    forEachFuzzCase({ cases: 64, seed: 0x4650_4c4e }, ({ random }) => {
      const sceneA = randomScene(random);
      const sceneB = randomScene(random);
      const planA = compileFramePlan(sceneA, 41);
      const planB = compileFramePlan(sceneB, 42);

      expect(compileFramePlan(sceneA, 41)).toEqual(planA);
      expectCompiledInvariants(planA);
      expectCompiledInvariants(planB);
      expect(planA.camera).toBe(sceneA.camera);
      expect(planA.clearColor).toBe(sceneA.clearColor);

      const scratch = createResourceManifestDiffScratch();
      const arrays = Object.values(scratch.delta);
      const forward = diffResourceManifests(planA.manifest, planB.manifest, scratch);
      const retainedRows = Object.values(forward).map((rows) => [...rows]);
      expectKeyDelta(planA.manifest.gltfRequests, planB.manifest.gltfRequests, forward.gltfRequests);
      expectKeyDelta(planA.manifest.directGeometries, planB.manifest.directGeometries, forward.directGeometries);
      expectKeyDelta(planA.manifest.ordinaryTextures, planB.manifest.ordinaryTextures, forward.ordinaryTextures);
      expectKeyDelta(planA.manifest.virtualTextures, planB.manifest.virtualTextures, forward.virtualTextures);
      expectReferenceDelta(planA.manifest.renderObjectRefs, planB.manifest.renderObjectRefs, forward.renderObjectRefs);
      expectReferenceDelta(planA.manifest.bulkInstances, planB.manifest.bulkInstances, forward.bulkInstances);

      const deterministic = diffResourceManifests(
        planA.manifest,
        planB.manifest,
        createResourceManifestDiffScratch(),
      );
      expect(deterministic).toEqual(forward);

      const reverse = diffResourceManifests(planB.manifest, planA.manifest, scratch);
      expectKeyDelta(planB.manifest.gltfRequests, planA.manifest.gltfRequests, reverse.gltfRequests);
      expectKeyDelta(planB.manifest.directGeometries, planA.manifest.directGeometries, reverse.directGeometries);
      expectKeyDelta(planB.manifest.ordinaryTextures, planA.manifest.ordinaryTextures, reverse.ordinaryTextures);
      expectKeyDelta(planB.manifest.virtualTextures, planA.manifest.virtualTextures, reverse.virtualTextures);
      expectReferenceDelta(planB.manifest.renderObjectRefs, planA.manifest.renderObjectRefs, reverse.renderObjectRefs);
      expectReferenceDelta(planB.manifest.bulkInstances, planA.manifest.bulkInstances, reverse.bulkInstances);

      const repeated = diffResourceManifests(planA.manifest, planB.manifest, scratch);
      for (const [arrayIndex, rows] of Object.values(repeated).entries()) {
        for (const [rowIndex, row] of rows.entries()) {
          expect(row).toBe(retainedRows[arrayIndex]?.[rowIndex]);
        }
      }
      const unchanged = diffResourceManifests(planA.manifest, planA.manifest, scratch);
      expect(Object.values(unchanged).every((rows) => rows.length === 0)).toBe(true);
      for (const [index, array] of Object.values(scratch.delta).entries()) {
        expect(array).toBe(arrays[index]);
      }
      const repeatedAfterEmpty = diffResourceManifests(planA.manifest, planB.manifest, scratch);
      for (const [arrayIndex, rows] of Object.values(repeatedAfterEmpty).entries()) {
        for (const [rowIndex, row] of rows.entries()) {
          expect(row).toBe(retainedRows[arrayIndex]?.[rowIndex]);
        }
      }
    });
  });
});
