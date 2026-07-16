import { describe, expect, it } from "vitest";
import { GltfSharedViewLodRegistry } from "../packages/renderer-webgl/src/gltf/shared-view-lod-registry";
import type { LoadedGltfMaterial, LoadedGltfPrimitive } from "../packages/renderer-webgl/src/gltf/prepared-asset";
import type { LodLevelMembership, LodSet } from "../packages/renderer-webgl/src/lod";
import { forEachFuzzCase } from "./fuzz";

const materialLod = (thresholds: readonly number[]): LodSet<LoadedGltfMaterial> => ({
  levels: thresholds.map(() => ({}) as LoadedGltfMaterial),
  thresholds,
});

const nodeLod = (
  level: number,
  thresholds: readonly number[] = [0.2, 0],
): LodLevelMembership => ({
  group: "main",
  level,
  levelCount: thresholds.length,
  thresholds,
});

const nodePrimitive = (lod: LodLevelMembership): LoadedGltfPrimitive =>
  ({ nodeLod: lod }) as LoadedGltfPrimitive;

const observeMaterialFrame = (
  registry: GltfSharedViewLodRegistry,
  id: number,
  coverages: readonly number[],
): number | undefined => {
  registry.beginFrame();
  registry.touchMaterial(id);
  for (const coverage of coverages) registry.observeCoverage(id, coverage);
  registry.finalizeMaterials();
  return registry.selectedLevel("asset", "material");
};

describe("glTF shared-view LOD registry", () => {
  it("keeps stereo aggregation order-independent and retains hysteresis across frames", () => {
    const forward = new GltfSharedViewLodRegistry();
    const reverse = new GltfSharedViewLodRegistry();
    const lod = materialLod([0.2, 0]);
    const forwardId = forward.materialSelectionId("asset", "material", lod);
    const reverseId = reverse.materialSelectionId("asset", "material", lod);

    expect(observeMaterialFrame(forward, forwardId, [0.205, 0.05])).toBe(0);
    expect(observeMaterialFrame(reverse, reverseId, [0.05, 0.205])).toBe(0);
    // Demotion from retained LOD0 requires crossing the 15% hysteresis band.
    expect(observeMaterialFrame(forward, forwardId, [0.18, 0.1])).toBe(0);
    expect(observeMaterialFrame(reverse, reverseId, [0.1, 0.18])).toBe(0);
    expect(observeMaterialFrame(forward, forwardId, [0.16, 0.1])).toBe(1);
    expect(observeMaterialFrame(reverse, reverseId, [0.1, 0.16])).toBe(1);

    forEachFuzzCase({ cases: 128, seed: 0x51e7_e0 }, ({ random }) => {
      const views = Array.from({ length: random.int(1, 7) }, () => random.float());
      expect(observeMaterialFrame(forward, forwardId, views))
        .toBe(observeMaterialFrame(reverse, reverseId, [...views].reverse()));
    });
  });

  it("selects the finest visible lower node fallback without inventing LOD0 coverage", () => {
    const registry = new GltfSharedViewLodRegistry();
    const high = nodeLod(0);
    const low = nodeLod(1);
    const primitives = [nodePrimitive(high), nodePrimitive(low)];
    const id = registry.nodeSelectionId("asset", "node", high, primitives);
    expect(registry.nodeSelectionId("asset", "node", low, primitives)).toBe(id);

    registry.beginFrame();
    registry.touchNode(id);
    registry.observeNodeFallback(id, 1);
    registry.finalizeNodes();
    expect(registry.selectedLevel("asset", "node")).toBe(1);

    registry.beginFrame();
    registry.touchNode(id);
    registry.observeCoverage(id, 0.8);
    registry.finalizeNodes();
    expect(registry.selectedLevel("asset", "node")).toBe(0);

    registry.beginFrame();
    registry.touchNode(id);
    registry.finalizeNodes();
    expect(registry.selectedLevel("asset", "node"), "an invisible frame retains history").toBe(0);
    expect(registry.packetSelections.selectionEpochs[id]).not.toBe(registry.packetSelections.epoch);
  });

  it("bounds repeated asset replacement without reusing live topology IDs", () => {
    const registry = new GltfSharedViewLodRegistry();
    const lod = materialLod([0.4, 0.2, 0]);
    const selectionKeys = Array.from({ length: 12 }, (_, index) => `material:${index}`);
    let liveIds = selectionKeys.map((key) => registry.materialSelectionId("asset", key, lod));

    for (let generation = 0; generation < 256; generation += 1) {
      const replacement = registry.beginAssetReplacement("asset");
      const replacementLod = materialLod([0.4 + (generation % 32) / 1_000, 0.2, 0]);
      const pendingIds = selectionKeys.map((key) =>
        registry.materialSelectionId("asset", key, replacementLod));
      expect(pendingIds.some((id) => liveIds.includes(id)), "live packet IDs cannot be recycled early").toBe(false);
      registry.commitAssetReplacement(replacement);
      liveIds = pendingIds;
      expect(new Set(pendingIds).size).toBe(selectionKeys.length);
      expect(Math.max(...pendingIds)).toBeLessThan(selectionKeys.length * 2);
    }
  });

  it("rolls back a thrown publication without releasing IDs still used by the live topology", () => {
    const registry = new GltfSharedViewLodRegistry();
    const lod = materialLod([0.2, 0]);
    const liveId = registry.materialSelectionId("asset", "material", lod);
    const replacement = registry.beginAssetReplacement("asset");
    const pendingId = registry.materialSelectionId("asset", "material", lod);
    expect(pendingId).not.toBe(liveId);
    expect(() => registry.beginFrame()).toThrow(/during asset replacement/);
    try {
      throw new Error("simulated topology publication failure");
    } catch {
      registry.rollbackAssetReplacement(replacement);
    }
    expect(() => registry.commitAssetReplacement(replacement)).toThrow(/token is not active/);
    expect(registry.materialSelectionId("asset", "material", lod)).toBe(liveId);
    const retry = registry.beginAssetReplacement("asset");
    expect(registry.materialSelectionId("asset", "material", lod)).toBe(pendingId);
    registry.rollbackAssetReplacement(retry);
  });

  it("commits an empty replacement after a no-occurrence publication", () => {
    const registry = new GltfSharedViewLodRegistry();
    const lod = materialLod([0.2, 0]);
    const releasedId = registry.materialSelectionId("asset", "material", lod);
    const replacement = registry.beginAssetReplacement("asset");
    registry.commitAssetReplacement(replacement);
    expect(registry.selectedLevel("asset", "material")).toBeUndefined();
    expect(registry.materialSelectionId("asset", "replacement", lod)).toBe(releasedId);
  });

  it("resets IDs, retained selections, capacity, and epoch as one plan generation", () => {
    const registry = new GltfSharedViewLodRegistry();
    const lod = materialLod([0.2, 0]);
    const id = registry.materialSelectionId("asset", "material", lod);
    expect(observeMaterialFrame(registry, id, [0.8])).toBe(0);
    expect(registry.packetSelections.epoch).toBe(1);
    registry.beginFrame();
    expect(registry.packetSelections.epoch).toBe(2);

    registry.resetPlan();
    expect(registry.packetSelections.epoch).toBe(0);
    expect(registry.selectedLevel("asset", "material")).toBeUndefined();
    expect(registry.materialSelectionId("asset", "material", lod)).toBe(0);
  });
});
