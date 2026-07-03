import { describe, expect, it } from "vitest";
import { projectedSphereScreenBounds, type Projection, type ScreenBounds } from "./bounds";

const viewport = { width: 800, height: 600 } as const;

const perspective: Projection = {
  kind: "perspective",
  aspect: viewport.width / viewport.height,
  fovY: Math.PI / 2,
  near: 0.1,
};

const expectBoundsClose = (actual: ScreenBounds | undefined, expected: ScreenBounds): void => {
  expect(actual).toBeDefined();
  expect(actual!.minX).toBeCloseTo(expected.minX);
  expect(actual!.minY).toBeCloseTo(expected.minY);
  expect(actual!.maxX).toBeCloseTo(expected.maxX);
  expect(actual!.maxY).toBeCloseTo(expected.maxY);
};

describe("projectedSphereScreenBounds", () => {
  it("bounds a perspective sphere fully in front of the near plane", () => {
    const bounds = projectedSphereScreenBounds(
      { center: [0, 0, -5], radius: 1 },
      perspective,
      viewport,
    );

    expectBoundsClose(bounds, {
      minX: 338.76275643042055,
      minY: 238.76275643042055,
      maxX: 461.23724356957945,
      maxY: 361.23724356957945,
    });
  });

  it("can clamp a partially off-screen perspective bound to the viewport", () => {
    const unclamped = projectedSphereScreenBounds(
      { center: [8, 0, -5], radius: 1 },
      perspective,
      viewport,
    );
    const clamped = projectedSphereScreenBounds(
      { center: [8, 0, -5], radius: 1 },
      perspective,
      viewport,
      { clampToViewport: true },
    );

    expect(unclamped).toBeDefined();
    expect(unclamped!.maxX).toBeGreaterThan(viewport.width);
    expectBoundsClose(clamped, {
      minX: 782.7396060044144,
      minY: 238.76275643042055,
      maxX: 800,
      maxY: 361.23724356957945,
    });
  });

  it("returns undefined for a perspective sphere behind the near plane", () => {
    expect(projectedSphereScreenBounds(
      { center: [0, 0, 0.25], radius: 0.1 },
      perspective,
      viewport,
    )).toBeUndefined();
  });

  it("returns a conservative clipped bound for a sphere intersecting the near plane", () => {
    expectBoundsClose(projectedSphereScreenBounds(
      { center: [0, 0, -0.4], radius: 0.35 },
      perspective,
      viewport,
    ), {
      minX: 0,
      minY: 0,
      maxX: 800,
      maxY: 600,
    });
  });

  it("bounds an orthographic sphere", () => {
    const orthographic: Projection = {
      kind: "orthographic",
      left: -4,
      right: 4,
      bottom: -3,
      top: 3,
      near: -10,
      far: 10,
    };

    expectBoundsClose(projectedSphereScreenBounds(
      { center: [1, -0.5, 2], radius: 0.75 },
      orthographic,
      viewport,
    ), {
      minX: 425,
      minY: 275,
      maxX: 575,
      maxY: 425,
    });
  });

  it("rejects invalid radii", () => {
    expect(projectedSphereScreenBounds(
      { center: [0, 0, -5], radius: 0 },
      perspective,
      viewport,
    )).toBeUndefined();
    expect(projectedSphereScreenBounds(
      { center: [0, 0, -5], radius: Number.NaN },
      perspective,
      viewport,
    )).toBeUndefined();
  });
});
