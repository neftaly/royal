import { describe, expect, it } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  createCompositeFramePlanWorkspace,
  planCompositeFrameInto,
} from "../../packages/renderer-webgl/src/surface/composite-frame-plan";

const standard = (
  overrides: Partial<Extract<CanonicalSurfaceMaterial, { kind: "standard" }>> = {},
): Extract<CanonicalSurfaceMaterial, { kind: "standard" }> => ({
  baseColor: [1, 1, 1, 1],
  emissiveFactor: [0, 0, 0],
  kind: "standard",
  metallicFactor: 0,
  normalScale: 1,
  occlusionStrength: 1,
  requiresTextureCoordinates: false,
  roughnessFactor: 1,
  ...overrides,
});

const capabilities = {
  hasFloatBlendTarget: true,
  hasFloatColorTarget: true,
};

describe("surface composite frame planning", () => {
  it("retains dense stereo visibility and maximum visible transmission roughness", () => {
    const output = createCompositeFramePlanWorkspace();
    const views = [
      {
        viewProjection: identityMat4(),
        viewport: { height: 80, width: 100, x: 0, y: 0 },
      },
      {
        viewProjection: identityMat4(),
        viewport: { height: 50, width: 200, x: 0, y: 0 },
      },
    ];
    planCompositeFrameInto([
      {
        material: standard({ roughnessFactor: 0.6, transmissionFactor: 1 }),
        worldBounds: { max: [0.5, 0.5, 0.5], min: [-0.5, -0.5, -0.5] },
      },
      {
        material: standard({ roughnessFactor: 0.9, transmissionFactor: 1 }),
        worldBounds: { max: [3, 0.5, 0.5], min: [2, -0.5, -0.5] },
      },
    ], views, [0, 1], false, false, capabilities, output);

    expect(output.transmissionRequested).toBe(true);
    expect(output.terminalPresentation).toBe(false);
    expect(output.compositeRequested).toBe(true);
    expect(output.sceneColorMaxRoughness).toBe(0.6);
    expect(output.visibilityStride).toBe(2);
    expect([...output.visibility.slice(0, 4)]).toEqual([1, 0, 1, 0]);
    expect({ height: output.height, width: output.width }).toEqual({ height: 80, width: 200 });
  });

  it("separates terminal presentation from transmission and resets an idle plan", () => {
    const output = createCompositeFramePlanWorkspace();
    const views = [{
      viewProjection: identityMat4(),
      viewport: { height: 720, width: 1280, x: 0, y: 0 },
    }];
    planCompositeFrameInto([], views, [], true, true, capabilities, output);
    expect(output.transmissionRequested).toBe(false);
    expect(output.terminalPresentation).toBe(true);
    expect(output.compositeRequested).toBe(true);
    expect({ height: output.height, width: output.width }).toEqual({
      height: 720,
      width: 1280,
    });

    planCompositeFrameInto([], views, [], true, false, capabilities, output);
    expect(output.transmissionRequested).toBe(false);
    expect(output.terminalPresentation).toBe(false);
    expect(output.compositeRequested).toBe(false);
    expect(output.sceneColorMaxRoughness).toBe(0);
    expect({ height: output.height, width: output.width }).toEqual({ height: 1, width: 1 });
  });
});
