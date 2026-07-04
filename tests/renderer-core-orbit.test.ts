import { describe, expect, it } from "vitest";
import {
  clampOrbitCameraView,
  orbitCameraBasis,
  orbitCameraTransform,
  orbitPerspectiveCamera,
  panOrbitCameraView,
  resolveOrbitCameraView,
  rotateOrbitCameraView,
  zoomOrbitCameraView,
  type OrbitCameraView,
} from "@royal/renderer-core";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

const defaultView = {
  distance: 5,
  pitch: 0.1,
  target: [0, 0, 0],
  yaw: 0.2,
} satisfies OrbitCameraView;

const finiteNumber = (random: SeededRandom, minInclusive: number, maxExclusive: number): number => {
  const value = random.number(minInclusive, maxExclusive);
  expect(Number.isFinite(value)).toBe(true);
  return value;
};

const randomTarget = (random: SeededRandom): OrbitCameraView["target"] => [
  finiteNumber(random, -100, 100),
  finiteNumber(random, -100, 100),
  finiteNumber(random, -100, 100),
];

const randomOrbitView = (random: SeededRandom): OrbitCameraView => ({
  distance: finiteNumber(random, 0.001, 100),
  pitch: finiteNumber(random, -Math.PI, Math.PI),
  target: randomTarget(random),
  yaw: finiteNumber(random, -Math.PI * 2, Math.PI * 2),
});

const expectVectorCloseTo = (
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
) => {
  expect(actual[0]).toBeCloseTo(expected[0]);
  expect(actual[1]).toBeCloseTo(expected[1]);
  expect(actual[2]).toBeCloseTo(expected[2]);
};

describe("renderer-core orbit camera API", () => {
  it("resolves sparse orbit views and camera descriptors without React state", () => {
    expect(resolveOrbitCameraView({
      distance: 5,
      pitch: 0,
    })).toEqual({
      distance: 5,
      pitch: 0,
      target: [0, 0, 0],
      yaw: 0,
    });

    expect(orbitCameraTransform({
      distance: 5,
      pitch: 0,
    })).toEqual({
      position: [0, 0, 5],
      rotation: [-0, -0, 0],
    });

    expect(orbitPerspectiveCamera({
      far: 10,
      fovY: Math.PI / 3,
      near: 0.1,
      view: defaultView,
    })).toEqual({
      ...orbitCameraTransform(defaultView),
      far: 10,
      fovY: Math.PI / 3,
      kind: "perspective-camera",
      near: 0.1,
    });
  });

  it("clamps orbit view limits as a pure transition", () => {
    expect(clampOrbitCameraView({
      distance: 20,
      pitch: -2,
      target: [1, 2, 3],
      yaw: 0.4,
    }, {
      maxDistance: 8,
      maxPitch: 0.5,
      minDistance: 2,
      minPitch: -0.5,
    })).toEqual({
      distance: 8,
      pitch: -0.5,
      target: [1, 2, 3],
      yaw: 0.4,
    });
  });

  it("rotates, zooms, and pans views without mutating the starting view", () => {
    const rotated = rotateOrbitCameraView(defaultView, 10, -5, 0.006);
    const zoomed = zoomOrbitCameraView(defaultView, -120, 0.0018);
    const panned = panOrbitCameraView({
      distance: 5,
      pitch: 0,
      target: [0, 0, 0],
      yaw: 0,
    }, 10, -20, 0.0016);

    expect(defaultView).toEqual({
      distance: 5,
      pitch: 0.1,
      target: [0, 0, 0],
      yaw: 0.2,
    });
    expect(rotated).toMatchObject({
      distance: defaultView.distance,
      target: defaultView.target,
    });
    expect(rotated.pitch).toBeCloseTo(defaultView.pitch - 5 * 0.006);
    expect(rotated.yaw).toBeCloseTo(defaultView.yaw + 10 * 0.006);
    expect(zoomed.distance).toBeLessThan(defaultView.distance);
    expect(panned.target[0]).toBeCloseTo(-0.08);
    expect(panned.target[1]).toBeCloseTo(-0.16);
    expect(panned.target[2]).toBeCloseTo(0);
  });

  it("preserves orbit transition invariants over finite random views and deltas", () => {
    forEachFuzzCase({ cases: 32, seed: 0x6f61_7262 }, ({ random }) => {
      const view = randomOrbitView(random);
      const originalView = {
        ...view,
        target: [...view.target],
      } satisfies OrbitCameraView;
      const distancePadding = finiteNumber(random, 0, 25);
      const pitchPadding = finiteNumber(random, 0, Math.PI);
      const minDistance = finiteNumber(random, 0.001, view.distance + distancePadding + 0.001);
      const maxDistance = finiteNumber(random, minDistance, minDistance + distancePadding + 0.001);
      const minPitch = finiteNumber(random, view.pitch - pitchPadding - 0.001, view.pitch + 0.001);
      const maxPitch = finiteNumber(random, minPitch, minPitch + pitchPadding + 0.001);
      const deltaX = finiteNumber(random, -500, 500);
      const deltaY = finiteNumber(random, -500, 500);
      const wheelDelta = finiteNumber(random, -240, 240);
      const rotateSpeed = finiteNumber(random, 0.0001, 0.02);
      const zoomSpeed = finiteNumber(random, -0.01, 0.01);
      const panSpeed = finiteNumber(random, 0.0001, 0.02);

      const clamped = clampOrbitCameraView(view, {
        maxDistance,
        maxPitch,
        minDistance,
        minPitch,
      });
      const rotated = rotateOrbitCameraView(view, deltaX, deltaY, rotateSpeed);
      const zoomed = zoomOrbitCameraView(view, wheelDelta, zoomSpeed);
      const panned = panOrbitCameraView(view, deltaX, deltaY, panSpeed);

      expect(clamped.distance).toBeGreaterThanOrEqual(minDistance);
      expect(clamped.distance).toBeLessThanOrEqual(maxDistance);
      expect(clamped.pitch).toBeGreaterThanOrEqual(minPitch);
      expect(clamped.pitch).toBeLessThanOrEqual(maxPitch);

      expect(rotated.distance).toBe(view.distance);
      expect(rotated.target).toEqual(view.target);

      expect(zoomed.pitch).toBe(view.pitch);
      expect(zoomed.yaw).toBe(view.yaw);
      expect(zoomed.target).toEqual(view.target);
      expect(zoomed.distance).toBeGreaterThan(0);

      expect(panned.distance).toBe(view.distance);
      expect(panned.pitch).toBe(view.pitch);
      expect(panned.yaw).toBe(view.yaw);

      expectVectorCloseTo(view.target, originalView.target);
      expect(view).toEqual(originalView);
    });
  });

  it("exposes the orbit basis used by pan transitions", () => {
    expect(orbitCameraBasis({
      distance: 5,
      pitch: 0,
      yaw: 0,
    })).toEqual({
      right: [1, 0, 0],
      up: [0, 1, -0],
    });
  });
});
