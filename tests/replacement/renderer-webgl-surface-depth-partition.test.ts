import { orbitPerspectiveCamera } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import { identityMat4, viewMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { sortSurfacesBackToFront } from "../../packages/renderer-webgl/src/surface/surface-depth-order";
import {
  planSurfaceDepthPartition,
  sortSurfaceDepthPartitionInto,
} from "../../packages/renderer-webgl/src/surface/surface-depth-partition";
import type { WorldBounds } from "../../packages/renderer-webgl/src/surface/surface-visibility";
import { forEachFuzzCase } from "../fuzz";

const item = (id: number, min: WorldBounds["min"], max: WorldBounds["max"]) => ({
  id, depthOrder: 0, surface: { worldBounds: { min, max } },
});
type Surface = ReturnType<typeof item>;

// Independent slab-ray intersection oracle; it knows nothing about the partition.
const rayEntry = (bounds: WorldBounds, origin: readonly number[], direction: readonly number[]) => {
  let near = 0;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]!) < 1e-12) {
      if (origin[axis]! < bounds.min[axis]! || origin[axis]! > bounds.max[axis]!) return null;
      continue;
    }
    const first = (bounds.min[axis]! - origin[axis]!) / direction[axis]!;
    const second = (bounds.max[axis]! - origin[axis]!) / direction[axis]!;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
  }
  return far >= near ? near : null;
};

describe("separated transparent surface ordering", () => {
  it.each([0, 0.0001])("keeps the reported boxes above their mat with a %s metre gap", (gap) => {
    const mat = item(0, [-0.4205, 0, -0.297], [0.4205, 0.002, 0.297]);
    const cards = [-0.234, -0.100].map((z, index) => item(
      index + 1, [-0.4205, 0.002 + gap, z - 0.063], [-0.3325, 0.004 + gap, z + 0.063],
    ));
    const surfaces = [...cards, mat];
    const partition = planSurfaceDepthPartition(surfaces);
    for (const [pitch, yaw] of [[Math.PI / 2, 0], [0.6, 0], [0.6, Math.PI], [0.6, 0]]) {
      const camera = orbitPerspectiveCamera({ view: { pitch, yaw, distance: 0.8 } });
      const view = viewMat4(camera);
      if (pitch === 0.6 && yaw === 0) {
        const oldOrder = [...surfaces];
        sortSurfacesBackToFront(oldOrder, view);
        expect(oldOrder.at(-1)).toBe(mat); // This fixture actually exposes the old bug.
      }
      sortSurfaceDepthPartitionInto(surfaces, partition, view, camera.position, true);
      expect(surfaces[0]).toBe(mat);
      expect(new Set(surfaces)).toEqual(new Set([mat, ...cards]));
    }
  });

  it("matches ray visibility through unequal, offset layers for perspective and orthographic views", () => {
    forEachFuzzCase({ cases: 80, seed: 0x52_91_43_11 }, ({ random, label }) => {
      const surfaces: Surface[] = [item(0, [-1, -0.01, -1], [1, 0, 1])];
      for (let index = 1; index < 8; index += 1) {
        const x = random.number(-0.7, 0.7);
        const z = random.number(-0.7, 0.7);
        surfaces.push(item(index, [x - 0.1, index * 0.02, z - 0.15], [x + 0.1, index * 0.02 + 0.005, z + 0.15]));
      }
      // Exercise every partition axis, including eye positions between layers.
      const axis = random.int(0, 3) % 3;
      for (const surface of surfaces) {
        const { min, max } = surface.surface.worldBounds;
        surface.surface.worldBounds = {
          min: [min[axis]!, min[(axis + 1) % 3]!, min[(axis + 2) % 3]!],
          max: [max[axis]!, max[(axis + 1) % 3]!, max[(axis + 2) % 3]!],
        };
      }
      const partition = planSurfaceDepthPartition(surfaces);
      const camera = orbitPerspectiveCamera({
        view: { pitch: random.number(-1.5, 1.5), yaw: random.number(-Math.PI, Math.PI), distance: random.number(0.01, 3) },
      });
      const view = viewMat4(camera);
      for (const perspective of [true, false]) {
        sortSurfaceDepthPartitionInto(surfaces, partition, view, camera.position, perspective);
        for (const target of surfaces) {
          const point = target.surface.worldBounds.min.map((min, axis) =>
            (min + target.surface.worldBounds.max[axis]!) * 0.5);
          const origin = perspective ? camera.position : point.map((value, axis) => value + 3 * view[axis * 4 + 2]!);
          const direction = point.map((value, axis) => value - origin[axis]!);
          const hits = surfaces.flatMap((surface) => {
            const entry = rayEntry(surface.surface.worldBounds, origin, direction);
            return entry === null ? [] : [entry];
          });
          expect(hits, label).toEqual([...hits].sort((left, right) => right - left));
        }
      }
    });
  });

  it("uses eye position for perspective and direction for orthographic cameras", () => {
    const lower = item(0, [-1, -2, -1], [1, -1, 1]);
    const upper = item(1, [-1, 1, -1], [1, 2, 1]);
    const surfaces = [lower, upper];
    const partition = planSurfaceDepthPartition(surfaces);
    const camera = orbitPerspectiveCamera({ view: { pitch: 0.6, distance: 3 } });
    const view = viewMat4(camera);
    sortSurfaceDepthPartitionInto(surfaces, partition, view, [0, -3, 0], true);
    expect(surfaces).toEqual([upper, lower]);
    sortSurfaceDepthPartitionInto(surfaces, partition, view, [0, -3, 0], false);
    expect(surfaces).toEqual([lower, upper]);
  });

  it("retains stable centre ordering for intersecting bounds and coplanar faces", () => {
    const surfaces = [
      item(0, [-1, -1, -2], [1, 1, 1]),
      item(1, [-1, -1, -1], [1, 1, 2]),
      item(2, [-1, -1, -2], [1, 1, 1]),
    ];
    const partition = planSurfaceDepthPartition(surfaces);
    expect("surfaces" in partition).toBe(true);
    sortSurfaceDepthPartitionInto(surfaces, partition, identityMat4(), [0, 0, 3], true);
    expect(surfaces.map(({ id }) => id)).toEqual([0, 2, 1]);
    const coplanar = [item(0, [-1, 0, -1], [1, 0, 1]), item(1, [-1, 0, -1], [1, 0, 1])];
    expect(planSurfaceDepthPartition(coplanar)).toEqual({ count: 2, surfaces: coplanar });
  });

  it("writes only the blended suffix and handles empty or bounded fallback plans", () => {
    const opaque = item(0, [0, 0, -1], [0, 0, -1]);
    const near = item(1, [0, 0, -2], [0, 0, -2]);
    const far = item(2, [0, 0, -3], [0, 0, -3]);
    const output = [opaque, near, far];
    const view = identityMat4();
    sortSurfaceDepthPartitionInto(output, planSurfaceDepthPartition([near, far]), view, [0, 0, 0], true, 1);
    expect(output).toEqual([opaque, far, near]);
    expect(sortSurfaceDepthPartitionInto(output, planSurfaceDepthPartition([]), view, [0, 0, 0], true, 3)).toBe(3);
    expect(planSurfaceDepthPartition([near, far], 0)).toEqual({ count: 2, surfaces: [near, far] });
  });
});
