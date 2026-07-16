import { boxGeometry, planeGeometry, type Geometry } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  directGeometryDeclaration,
  directGeometryKey,
  geometryArrayBucketKey,
  gltfGeometryDeclaration,
  normalizeGeometryDeclaration,
} from "../packages/renderer-webgl/src/geometry-recipes";
import { sameGeometryBytes } from "../packages/renderer-webgl/src/vertex-input/geometry-identity";
import { forEachFuzzCase } from "./fuzz";

describe("WebGL geometry recipes", () => {
  it("maps procedural faces from Royal's upper-left authored texture origin", () => {
    const plane = normalizeGeometryDeclaration(directGeometryDeclaration(planeGeometry([2, 1]), "surface"));
    const box = normalizeGeometryDeclaration(directGeometryDeclaration(boxGeometry([1, 2, 3]), "surface"));

    expect([...plane.texCoords0 ?? []]).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    expect([...box.texCoords0?.slice(0, 8) ?? []]).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
  });

  it("normalizes equal direct declarations to equal deterministic recipes", () => {
    forEachFuzzCase({ cases: 48, seed: 0x6e0_4ec1 }, ({ label, random }) => {
      const dimensions = [
        random.int(1, 100) / 10,
        random.int(1, 100) / 10,
        random.int(1, 100) / 10,
      ] as const;
      const geometry = random.boolean()
        ? boxGeometry(dimensions)
        : planeGeometry([dimensions[0], dimensions[1]]);
      const topology = random.boolean() ? "surface" : "wireframe";
      const first = normalizeGeometryDeclaration(directGeometryDeclaration(geometry, topology));
      const second = normalizeGeometryDeclaration(directGeometryDeclaration(geometry, topology));

      expect(first, label).not.toBe(second);
      expect(first.bucketKey, label).toBe(second.bucketKey);
      expect(first.bucketKey, label).toBe(directGeometryKey(geometry, topology));
      expect(sameGeometryBytes(first, second), label).toBe(true);
      expect(first.positions.length % 3, label).toBe(0);
      expect(first.indices?.every((index) => index < first.positions.length / 3), label).toBe(true);
      expect(first.mode, label).toBe(topology === "surface" ? "triangles" : "lines");
    });
  });

  it("keeps direct topology and dimensions in semantic identity", () => {
    const surface = normalizeGeometryDeclaration(directGeometryDeclaration(boxGeometry([1, 2, 3]), "surface"));
    const wireframe = normalizeGeometryDeclaration(directGeometryDeclaration(boxGeometry([1, 2, 3]), "wireframe"));
    const resized = normalizeGeometryDeclaration(directGeometryDeclaration(boxGeometry([1, 2, 4]), "surface"));

    expect(new Set([surface.bucketKey, wireframe.bucketKey, resized.bucketKey])).toHaveLength(3);
    expect(sameGeometryBytes(surface, wireframe)).toBe(false);
    expect(sameGeometryBytes(surface, resized)).toBe(false);
  });

  it("rejects malformed direct dimensions before manifest admission", () => {
    for (const geometry of [
      { kind: "box", size: [1, 2] },
      { kind: "box", size: [1, 2, Number.POSITIVE_INFINITY] },
      { kind: "plane", size: [1, 0] },
      { kind: "plane", size: [1, -1] },
    ]) {
      expect(() => directGeometryDeclaration(geometry as unknown as Geometry, "surface"))
        .toThrow(/invalid .* geometry size/i);
    }
  });

  it("normalizes glTF layouts without copying their prepared arrays", () => {
    const backing = new Float32Array([99, 0, 0, 0, 1, 0, 0, 0, 1, 99]);
    const positions = new Float32Array(backing.buffer, Float32Array.BYTES_PER_ELEMENT, 9);
    const indices = new Uint16Array([0, 1, 2]);
    const declaration = gltfGeometryDeclaration({ indices, mode: "triangles", positions });
    const first = normalizeGeometryDeclaration(declaration);
    const second = normalizeGeometryDeclaration(gltfGeometryDeclaration({
      indices: indices.slice(),
      mode: "triangles",
      positions: positions.slice(),
    }));

    expect(first.positions).toBe(positions);
    expect(first.indices).toBe(indices);
    expect(first.bucketKey).toBe(second.bucketKey);
    expect(sameGeometryBytes(first, second)).toBe(true);
    expect(geometryArrayBucketKey(positions)).not.toBe(geometryArrayBucketKey(backing));

    const changedPositions = positions.slice();
    changedPositions[0] = 7;
    expect(normalizeGeometryDeclaration(declaration).bucketKey).toBe(first.bucketKey);
    const mutated = normalizeGeometryDeclaration(gltfGeometryDeclaration({
      indices,
      mode: "triangles",
      positions: changedPositions,
    }));
    expect(mutated.bucketKey).not.toBe(first.bucketKey);
  });
});
