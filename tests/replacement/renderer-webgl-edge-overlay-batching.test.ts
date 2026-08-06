import { describe, expect, it } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import type {
  CanonicalEdgeOverlayScene,
  CanonicalEdgeSurface,
} from "../../packages/renderer-webgl/src/surface/edge-overlay-scene";
import { planEdgeMaskBatches } from "../../packages/renderer-webgl/src/surface/edge-overlay-owner";
import type { BorrowedSurfaceGeometryMatch } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";

const geometryA = {};
const geometryB = {};

const surface = (
  minX: number,
  maxX: number,
  modelHandedness: 1 | -1 = 1,
): CanonicalEdgeSurface => ({
  model: identityMat4(),
  modelHandedness,
  worldBounds: { max: [maxX, 1, 1], min: [minX, -1, -1] },
} as unknown as CanonicalEdgeSurface);

const ready = (
  geometryIdentity: object,
  identity = {},
  instanceCount = 0,
): BorrowedSurfaceGeometryMatch => ({
  resource: {
    geometry: {
      identity: geometryIdentity,
      indexBuffer: {} as WebGLBuffer,
      indexCount: 3,
      indexOffset: 0,
      indexType: 0x1401,
      key: "geometry",
      vertexBuffer: {} as WebGLBuffer,
    },
    identity,
    instanceCount,
    vertexArray: {} as WebGLVertexArrayObject,
  },
  status: "ready",
} as BorrowedSurfaceGeometryMatch);

const fixture = (
  secondOrder: readonly [object, object] = [geometryA, geometryB],
  secondBounds: readonly [number, number] = [3, 5],
  secondHandedness: 1 | -1 = 1,
) => {
  const geometries = [geometryA, geometryB, ...secondOrder];
  const surfaces = [
    surface(-5, -3),
    surface(-5, -3),
    surface(secondBounds[0], secondBounds[1], secondHandedness),
    surface(secondBounds[0], secondBounds[1], secondHandedness),
  ];
  const matches = geometries.map((geometry) => ready(geometry));
  const run = {
    occurrences: [
      { objectId: 1, surfaceIndices: [0, 1] },
      { objectId: 2, surfaceIndices: [2, 3] },
    ],
  } as unknown as CanonicalEdgeOverlayScene["runs"][number];
  const scene = { surfaces } as unknown as CanonicalEdgeOverlayScene;
  return { matches, run, scene };
};

const makePrimitiveModelsNonuniform = (scene: CanonicalEdgeOverlayScene): void => {
  for (const index of [1, 3]) {
    const model = scene.surfaces[index]!.model as unknown as number[];
    model[13] = 0.25;
  }
};

describe("edge-mask batch planning", () => {
  it("combines equal primitive sequences occurrence-major across borrowed arenas", () => {
    const { matches, run, scene } = fixture();
    const plan = planEdgeMaskBatches(scene, run, matches);

    expect(plan.pending).toBe(false);
    expect(plan.batches.map((batch) => batch.draws.map((draw) => draw.objectId)))
      .toEqual([[1, 2]]);
    expect(plan.batches[0]!.combinedDraws?.map(
      (draw) => draw.resource.geometry.identity,
    )).toEqual([geometryA, geometryB]);
    expect(plan.batches[0]!.fallbackDraws.map((draw) => draw.objectId))
      .toEqual([1, 1, 2, 2]);
  });

  it("retains authored order when primitive models cannot combine", () => {
    const { matches, run, scene } = fixture();
    makePrimitiveModelsNonuniform(scene);

    expect(planEdgeMaskBatches(scene, run, matches).batches.map(
      (batch) => batch.draws.map((draw) => draw.objectId),
    )).toEqual([[1], [1], [2], [2]]);
  });

  it("does not reorder different primitive sequences or handedness", () => {
    for (const { order, handedness } of [
      { handedness: 1 as const, order: [geometryB, geometryA] as const },
      { handedness: -1 as const, order: [geometryA, geometryB] as const },
    ]) {
      const { matches, run, scene } = fixture(order, [3, 5], handedness);
      expect(planEdgeMaskBatches(scene, run, matches).batches.every(
        (batch) => batch.draws.length === 1,
      )).toBe(true);
    }
  });

  it("keeps ready work and reports a pending sibling", () => {
    const { matches, run, scene } = fixture();
    matches[2] = { status: "pending" };
    const plan = planEdgeMaskBatches(scene, run, matches);

    expect(plan.pending).toBe(true);
    expect(plan.batches.flatMap((batch) => batch.draws.map((draw) => draw.objectId)))
      .toEqual([1, 1, 2]);
  });
});
