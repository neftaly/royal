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

const defaultView = {
  distance: 5,
  pitch: 0.1,
  target: [0, 0, 0],
  yaw: 0.2,
} satisfies OrbitCameraView;

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
