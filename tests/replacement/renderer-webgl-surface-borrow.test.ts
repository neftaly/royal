import { BorrowedSurfaceSourceIndex } from "../../packages/renderer-webgl/src/surface/borrowed-surface-source-index";
import { describe, expect, it } from "vitest";
import { identityMat4, type Mat4 } from "../../packages/renderer-webgl/src/math/mat4";
import type { CanonicalEdgeSurface } from "../../packages/renderer-webgl/src/surface/edge-overlay-scene";
import type { CanonicalDrawSurface } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import {
  matchingBorrowedSurfaceSourceKind as scanSourceKind,
} from "./support/surface-borrow-reference";

const matchingBorrowedSurfaceSourceKind = (surface: CanonicalDrawSurface, requested: CanonicalEdgeSurface) => {
  const match = new BorrowedSurfaceSourceIndex().matches([surface], requested)[0];
  return match === undefined ? null : match.memberIndex < 0 ? "whole-surface" : "automatic-member";
};

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


describe("retained borrowed-source index", () => {
  const reference = (surfaces: readonly CanonicalDrawSurface[], request: CanonicalEdgeSurface) =>
    surfaces.flatMap((surface, surfaceIndex) => {
      const kind = scanSourceKind(surface, request);
      return kind === null ? [] : [{ kind, surfaceIndex }];
    });
  const indexed = (index: BorrowedSurfaceSourceIndex, surfaces: readonly CanonicalDrawSurface[], request: CanonicalEdgeSurface) =>
    index.matches(surfaces, request).map(({ memberIndex, surfaceIndex }) => ({
      kind: memberIndex < 0 ? "whole-surface" : "automatic-member", surfaceIndex,
    }));

  it("agrees with the scan across automatic, ordinary, coincident, displaced and colliding sources", () => {
    const surfaces: CanonicalDrawSurface[] = [];
    const requests: CanonicalEdgeSurface[] = [];
    for (let seed = 0; seed < 96; seed += 1) {
      const model = translated(seed % 13 / 10);
      const version = seed % 3 === 0 ? "v2" : "v1";
      const geometryKey = `primitive-${seed % 4}`;
      const sourceAsset = { ...asset, version, sceneIndex: seed % 2 };
      const geometry = { key: geometryKey } as CanonicalDrawSurface["geometry"];
      surfaces.push(drawSurface({ geometry, model, node: { kind: "gltf", asset: sourceAsset } }));
      surfaces.push(drawSurface({
        geometry,
        instances: {
          automaticSourceOccurrences: [
            { asset: sourceAsset, geometryKey, gltfOccurrence: seed },
            { asset: sourceAsset, geometryKey, gltfOccurrence: seed + 100 },
          ],
          count: 2, key: `cohort-${seed}`,
          localModels: new Float32Array([...model, ...translated(seed + 0.1)]),
        },
      }));
      requests.push(edgeSurface({ asset: sourceAsset, geometry, model: translated(-100), sourceModel: model }));
      requests.push(edgeSurface({ asset: sourceAsset, geometry, sourceModel: translated(seed + 0.1) }));
    }
    for (const index of [new BorrowedSurfaceSourceIndex(), new BorrowedSurfaceSourceIndex(() => 0)]) {
      for (const request of requests) expect(indexed(index, surfaces, request)).toEqual(reference(surfaces, request));
      expect(index.snapshot().builds).toBe(1);
    }
  });

  it("rebuilds changed provenance and releases obsolete candidates", () => {
    const surfaces = [drawSurface({ model: translated(1) })];
    const index = new BorrowedSurfaceSourceIndex();
    expect(indexed(index, surfaces, edgeSurface({ sourceModel: translated(1) }))).toHaveLength(1);
    surfaces[0] = drawSurface({ model: translated(2) });
    index.invalidate();
    expect(index.snapshot().candidates).toBe(0);
    expect(indexed(index, surfaces, edgeSurface({ sourceModel: translated(1) }))).toEqual([]);
    expect(indexed(index, surfaces, edgeSurface({ sourceModel: translated(2) }))).toHaveLength(1);
    index.invalidate();
    expect(indexed(index, [], edgeSurface())).toEqual([]);
  });

  it("keeps camera-sweep candidate comparisons linear across the outline capacity boundary", () => {
    const report: object[] = [];
    for (const count of [0, 1, 32, 128, 254, 255, 256, 269, 512]) {
      const surfaces = Array.from({ length: count }, (_, index) => drawSurface({ model: translated(index) }));
      const requests = surfaces.map((surface) => edgeSurface({ sourceModel: surface.model }));
      const index = new BorrowedSurfaceSourceIndex();
      for (let frame = 0; frame < 8; frame += 1) {
        for (const request of requests) expect(indexed(index, surfaces, request)).toEqual(reference(surfaces, request));
      }
      const snapshot = index.snapshot();
      expect(snapshot.builds).toBe(count === 0 ? 0 : 1);
      expect(snapshot.comparisons).toBeLessThanOrEqual(count * 8 * 2);
      report.push({ occurrences: count, frames: 8, scanComparisons: count * count * 8, indexedComparisons: snapshot.comparisons });
    }
    console.log("Outline source comparison counts", JSON.stringify(report));
  });
});
