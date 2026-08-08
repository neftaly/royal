import { describe, expect, it } from "vitest";
import { identityMat4, type Mat4 } from "../../packages/renderer-webgl/src/math/mat4";
import type { CanonicalEdgeSurface } from "../../packages/renderer-webgl/src/surface/edge-overlay-scene";
import type { CanonicalDrawSurface } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import {
  matchingBorrowedSurfaceSourceKind,
} from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";

const asset = Object.freeze({ sceneIndex: 0, src: "/piece.glb", version: "v1" });

const drawSurface = (
  overrides: Partial<CanonicalDrawSurface> = {},
): CanonicalDrawSurface => ({
  geometry: { key: "geometry" },
  gltfOccurrence: 4,
  material: {},
  materialSource: {},
  model: identityMat4(),
  modelHandedness: 1,
  node: { asset, kind: "gltf" },
  normalTransform: identityMat4(),
  textureKeys: [],
  worldBounds: { max: [1, 1, 1], min: [-1, -1, -1] },
  ...overrides,
} as unknown as CanonicalDrawSurface);

const edgeSurface = (
  overrides: Partial<CanonicalEdgeSurface> = {},
): CanonicalEdgeSurface => ({
  asset,
  geometry: { key: "geometry" },
  model: identityMat4(),
  modelHandedness: 1,
  node: { asset, kind: "outlineGltf", material: {} },
  sourceModel: identityMat4(),
  worldBounds: { max: [1, 1, 1], min: [-1, -1, -1] },
  ...overrides,
} as unknown as CanonicalEdgeSurface);

const translated = (x: number): Mat4 => {
  const model = [...identityMat4()] as number[];
  model[12] = x;
  return model as unknown as Mat4;
};

describe("borrowed surface source equivalence", () => {
  it("treats coincident mounted occurrences as the same whole surface source", () => {
    expect(matchingBorrowedSurfaceSourceKind(
      drawSurface({ gltfOccurrence: 99 }),
      edgeSurface(),
    )).toBe("whole-surface");
  });

  it.each([
    ["asset", drawSurface({ node: { asset: { ...asset, version: "v2" }, kind: "gltf" } })],
    ["geometry", drawSurface({
      geometry: { key: "other" } as CanonicalDrawSurface["geometry"],
    })],
    ["transform", drawSurface({ model: translated(1) })],
    ["instance cohort", drawSurface({
      instances: { count: 1, key: "cohort", localModels: new Float32Array(16) },
    })],
  ])("rejects a different %s identity", (_label, surface) => {
    expect(matchingBorrowedSurfaceSourceKind(surface, edgeSurface())).toBeNull();
  });

  it("matches an automatic member using its float32 source transform", () => {
    const sourceModel = translated(0.1);
    const localModels = new Float32Array(sourceModel);
    const surface = drawSurface({
      instances: {
        automaticSourceOccurrences: [{ asset, geometryKey: "geometry", gltfOccurrence: 7 }],
        count: 1,
        key: "automatic",
        localModels,
      },
    });
    expect(matchingBorrowedSurfaceSourceKind(surface, edgeSurface({ sourceModel })))
      .toBe("automatic-member");
    expect(matchingBorrowedSurfaceSourceKind(
      surface,
      edgeSurface({ sourceModel: translated(0.2) }),
    )).toBeNull();
  });

  it.each([
    ["asset", { ...asset, sceneIndex: 1 }, "geometry"],
    ["version", { ...asset, version: "v2" }, "geometry"],
    ["geometry", asset, "other"],
  ])("rejects an automatic member with different %s provenance", (
    _label,
    sourceAsset,
    geometryKey,
  ) => {
    const surface = drawSurface({
      instances: {
        automaticSourceOccurrences: [{
          asset: sourceAsset,
          geometryKey,
          gltfOccurrence: 7,
        }],
        count: 1,
        key: "automatic",
        localModels: new Float32Array(identityMat4()),
      },
    });
    expect(matchingBorrowedSurfaceSourceKind(surface, edgeSurface())).toBeNull();
  });

  it("fails malformed automatic provenance before borrowing", () => {
    const surface = drawSurface({
      instances: {
        automaticSourceOccurrences: [],
        count: 1,
        key: "automatic",
        localModels: new Float32Array(16),
      },
    });
    expect(() => matchingBorrowedSurfaceSourceKind(surface, edgeSurface()))
      .toThrow("automatic instance sources diverged from their transform cohort");
  });
});
