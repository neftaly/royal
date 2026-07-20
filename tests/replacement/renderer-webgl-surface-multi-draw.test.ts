import { describe, expect, it } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  surfacesShareMultiDrawState,
  type SurfaceMultiDrawCandidate,
} from "../../packages/renderer-webgl/src/surface/surface-multi-draw";

const standard = (
  overrides: Partial<Extract<CanonicalSurfaceMaterial, { kind: "standard" }>> = {},
): CanonicalSurfaceMaterial => ({
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

const PROGRAM = {} as WebGLProgram;
const VERTEX_ARRAY = {} as WebGLVertexArrayObject;
const TEXTURE = {} as WebGLTexture;
const SAMPLER = {} as WebGLSampler;

const candidate = (
  overrides: Partial<SurfaceMultiDrawCandidate> = {},
): SurfaceMultiDrawCandidate => {
  const material = standard();
  return {
    bindings: [{ sampler: SAMPLER, target: "2d", texture: TEXTURE }],
    geometry: { indexType: 0x1403 },
    instanceCount: 0,
    mode: 0x0004,
    program: { program: PROGRAM },
    surface: {
      material,
      materialSource: material,
      model: identityMat4(),
      modelHandedness: 1,
    },
    textureUnits: 1,
    vertexArray: VERTEX_ARRAY,
    ...overrides,
  };
};

describe("surface multi-draw compatibility core", () => {
  it("accepts adjacent draws whose complete retained state is interchangeable", () => {
    const left = candidate();
    const right = candidate({
      bindings: [...left.bindings],
      geometry: { ...left.geometry },
      program: { ...left.program },
      surface: {
        ...left.surface,
        model: [...left.surface.model],
      },
    });

    expect(surfacesShareMultiDrawState(left, right)).toBe(true);
  });

  it("rejects semantically equal but distinctly authored materials", () => {
    const left = candidate();
    const right = candidate({
      bindings: left.bindings,
      surface: {
        ...left.surface,
        material: standard(),
        materialSource: standard(),
      },
    });

    expect(surfacesShareMultiDrawState(left, right)).toBe(false);
  });

  it("rejects every texture-unit binding difference", () => {
    const left = candidate();
    const otherTexture = candidate({
      bindings: [{ ...left.bindings[0]!, texture: {} as WebGLTexture }],
      surface: left.surface,
    });
    const otherSampler = candidate({
      bindings: [{ ...left.bindings[0]!, sampler: {} as WebGLSampler }],
      surface: left.surface,
    });
    const otherTarget = candidate({
      bindings: [{ ...left.bindings[0]!, target: "cube" }],
      surface: left.surface,
    });
    const otherCount = candidate({ bindings: [], surface: left.surface });
    const otherMask = candidate({ textureUnits: 3, surface: left.surface });

    expect(surfacesShareMultiDrawState(left, otherTexture)).toBe(false);
    expect(surfacesShareMultiDrawState(left, otherSampler)).toBe(false);
    expect(surfacesShareMultiDrawState(left, otherTarget)).toBe(false);
    expect(surfacesShareMultiDrawState(left, otherCount)).toBe(false);
    expect(surfacesShareMultiDrawState(left, otherMask)).toBe(false);
  });

  it("rejects every fixed draw-state difference", () => {
    const left = candidate();
    const variants = [
      candidate({ program: { program: {} as WebGLProgram }, surface: left.surface }),
      candidate({ mode: 0x0005, surface: left.surface }),
      candidate({ vertexArray: {} as WebGLVertexArrayObject, surface: left.surface }),
      candidate({ geometry: { indexType: 0x1405 }, surface: left.surface }),
      candidate({ surface: { ...left.surface, modelHandedness: -1 } }),
      candidate({ surface: {
        ...left.surface,
        model: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          1, 0, 0, 1,
        ],
      } }),
      candidate({ surface: { ...left.surface, material: standard({ doubleSided: true }) } }),
    ];

    for (const right of variants) {
      expect(surfacesShareMultiDrawState(left, right)).toBe(false);
    }
  });

  it("rejects blended or instanced draws", () => {
    const left = candidate();
    expect(surfacesShareMultiDrawState(left, candidate({
      surface: { ...left.surface, material: standard({ alphaBlend: true }) },
    }))).toBe(false);
    expect(surfacesShareMultiDrawState(left, candidate({
      instanceCount: 2,
      surface: left.surface,
    }))).toBe(false);
  });
});
