import { describe, expect, it } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  surfacesShareDepthPrepassState,
  surfacesShareMultiDrawState,
  type SurfaceDepthMultiDrawCandidate,
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
    drawPacket: {
      alphaBlend: false,
      colorWrite: true,
      cullBackFaces: true,
      depthTest: true,
      depthWrite: true,
      frontFace: 0x0901,
      program: PROGRAM,
      textureBindings: [{ sampler: SAMPLER, target: "2d", texture: TEXTURE }],
      textureUnits: 1,
      vertexArray: VERTEX_ARRAY,
    },
    geometry: { indexType: 0x1403 },
    instanceCount: 0,
    mode: 0x0004,
    surface: {
      materialSource: material,
      model: identityMat4(),
    },
    ...overrides,
  };
};

const depthCandidate = (
  overrides: Partial<SurfaceDepthMultiDrawCandidate> = {},
): SurfaceDepthMultiDrawCandidate => ({
  depthPacket: {
    ...candidate().drawPacket,
    colorWrite: false,
    textureBindings: [],
    textureUnits: 0,
  },
  geometry: { indexType: 0x1403 },
  instanceCount: 0,
  mode: 0x0004,
  surface: { model: identityMat4() },
  ...overrides,
});

describe("surface multi-draw compatibility core", () => {
  it("accepts adjacent draws whose complete retained state is interchangeable", () => {
    const left = candidate();
    const right = candidate({
      drawPacket: {
        ...left.drawPacket,
        textureBindings: [...left.drawPacket.textureBindings],
      },
      geometry: { ...left.geometry },
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
      surface: {
        ...left.surface,
        materialSource: standard(),
      },
    });

    expect(surfacesShareMultiDrawState(left, right)).toBe(false);
  });

  it("rejects every texture-unit binding difference", () => {
    const left = candidate();
    const otherTexture = candidate({
      drawPacket: {
        ...left.drawPacket,
        textureBindings: [{
          ...left.drawPacket.textureBindings[0]!, texture: {} as WebGLTexture,
        }],
      },
      surface: left.surface,
    });
    const otherSampler = candidate({
      drawPacket: {
        ...left.drawPacket,
        textureBindings: [{
          ...left.drawPacket.textureBindings[0]!, sampler: {} as WebGLSampler,
        }],
      },
      surface: left.surface,
    });
    const otherTarget = candidate({
      drawPacket: {
        ...left.drawPacket,
        textureBindings: [{ ...left.drawPacket.textureBindings[0]!, target: "cube" }],
      },
      surface: left.surface,
    });
    const otherCount = candidate({
      drawPacket: { ...left.drawPacket, textureBindings: [] },
      surface: left.surface,
    });
    const otherMask = candidate({
      drawPacket: { ...left.drawPacket, textureUnits: 3 },
      surface: left.surface,
    });

    expect(surfacesShareMultiDrawState(left, otherTexture)).toBe(false);
    expect(surfacesShareMultiDrawState(left, otherSampler)).toBe(false);
    expect(surfacesShareMultiDrawState(left, otherTarget)).toBe(false);
    expect(surfacesShareMultiDrawState(left, otherCount)).toBe(false);
    expect(surfacesShareMultiDrawState(left, otherMask)).toBe(false);
  });

  it("ignores bindings that neither packet samples", () => {
    const base = candidate();
    const left = candidate({
      drawPacket: {
        ...base.drawPacket,
        textureBindings: [base.drawPacket.textureBindings[0]!, {
          sampler: null,
          target: "2d",
          texture: null,
        }],
      },
      surface: base.surface,
    });
    const right = candidate({
      drawPacket: {
        ...left.drawPacket,
        textureBindings: [left.drawPacket.textureBindings[0]!, {
          sampler: {} as WebGLSampler,
          target: "2d",
          texture: {} as WebGLTexture,
        }],
      },
      surface: left.surface,
    });

    expect(surfacesShareMultiDrawState(left, right)).toBe(true);
  });

  it("rejects every fixed draw-state difference", () => {
    const left = candidate();
    const variants = [
      candidate({
        drawPacket: { ...left.drawPacket, program: {} as WebGLProgram },
        surface: left.surface,
      }),
      candidate({ mode: 0x0005, surface: left.surface }),
      candidate({
        drawPacket: { ...left.drawPacket, vertexArray: {} as WebGLVertexArrayObject },
        surface: left.surface,
      }),
      candidate({ geometry: { indexType: 0x1405 }, surface: left.surface }),
      candidate({
        drawPacket: { ...left.drawPacket, depthEqual: true },
        surface: left.surface,
      }),
      candidate({
        drawPacket: { ...left.drawPacket, frontFace: 0x0900 },
        surface: left.surface,
      }),
      candidate({ surface: {
        ...left.surface,
        model: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          1, 0, 0, 1,
        ],
      } }),
      candidate({
        drawPacket: { ...left.drawPacket, cullBackFaces: false },
        surface: left.surface,
      }),
    ];

    for (const right of variants) {
      expect(surfacesShareMultiDrawState(left, right)).toBe(false);
    }
  });

  it("rejects blended or instanced draws", () => {
    const left = candidate();
    expect(surfacesShareMultiDrawState(left, candidate({
      drawPacket: { ...left.drawPacket, alphaBlend: true },
      surface: left.surface,
    }))).toBe(false);
    expect(surfacesShareMultiDrawState(left, candidate({
      instanceCount: 2,
      surface: left.surface,
    }))).toBe(false);
  });
});

describe("surface depth-prepass multi-draw compatibility core", () => {
  it("combines exact position-only state across material boundaries", () => {
    const left = depthCandidate();
    const right = depthCandidate({
      depthPacket: { ...left.depthPacket! },
      surface: { model: [...left.surface.model] },
    });
    expect(surfacesShareDepthPrepassState(left, right)).toBe(true);
  });

  it("rejects absent, instanced, or transform-incompatible candidates", () => {
    const left = depthCandidate();
    expect(surfacesShareDepthPrepassState(left, depthCandidate({ depthPacket: null }))).toBe(false);
    expect(surfacesShareDepthPrepassState(left, depthCandidate({ instanceCount: 2 }))).toBe(false);
    expect(surfacesShareDepthPrepassState(left, depthCandidate({
      surface: { model: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        1, 0, 0, 1,
      ] },
    }))).toBe(false);
  });
});
