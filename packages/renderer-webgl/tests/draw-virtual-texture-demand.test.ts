import {
  mesh,
  planeGeometry,
  solidTexture,
  unlitMaterial,
  virtualTextureAsset,
} from "@royal/renderer-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drawMesh } from "../src/draw";
import { GeometryCache } from "../src/geometry-cache";
import type { RendererWebGlContext } from "../src/gl";
import { identity } from "../src/matrix";
import type { MeshProgram } from "../src/programs";

const materialBindingMocks = vi.hoisted(() => ({
  bindMaterialBaseColor: vi.fn(),
  lowerMaterialBaseColorBinding: vi.fn(),
}));

vi.mock("../src/material-texture-binding", () => ({
  bindMaterialBaseColor: materialBindingMocks.bindMaterialBaseColor,
  lowerMaterialBaseColorBinding: materialBindingMocks.lowerMaterialBaseColorBinding,
}));

type BindMaterialBaseColorOptions = {
  readonly virtualTextureDemand?: {
    readonly screenFootprintPx?: readonly [number, number] | undefined;
    readonly uvFootprint?: {
      readonly uMax: number;
      readonly uMin: number;
      readonly vMax: number;
      readonly vMin: number;
    } | undefined;
  } | undefined;
};

const uniform = (name: string): WebGLUniformLocation =>
  ({ name }) as unknown as WebGLUniformLocation;

const meshProgram = (): MeshProgram => ({
  attributes: {
    normal: 1,
    position: 0,
  },
  program: {} as WebGLProgram,
  uniforms: {
    baseColor: uniform("baseColor"),
    boxSize: uniform("boxSize"),
    color: uniform("color"),
    lightColor: uniform("lightColor"),
    lightDirection: uniform("lightDirection"),
    model: uniform("model"),
    unlit: uniform("unlit"),
    useBaseColorTexture: uniform("useBaseColorTexture"),
    useVirtualTexture: uniform("useVirtualTexture"),
    viewProjection: uniform("viewProjection"),
    virtualAtlas: uniform("virtualAtlas"),
    virtualBorderTexels: uniform("virtualBorderTexels"),
    virtualMip: uniform("virtualMip"),
    virtualPaddedPageSize: uniform("virtualPaddedPageSize"),
    virtualPageSize: uniform("virtualPageSize"),
    virtualPageTable: uniform("virtualPageTable"),
    virtualPageTableSize: uniform("virtualPageTableSize"),
    virtualPhysicalAtlasSize: uniform("virtualPhysicalAtlasSize"),
  },
});

const fakeGl = (): RendererWebGlContext => ({
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  FLOAT: 0x1406,
  STATIC_DRAW: 0x88E4,
  TRIANGLES: 0x0004,
  UNSIGNED_SHORT: 0x1403,
  bindBuffer() {},
  bufferData() {},
  createBuffer: () => ({} as WebGLBuffer),
  drawElements() {},
  enableVertexAttribArray() {},
  uniform1i() {},
  uniform3fv() {},
  uniform4fv() {},
  uniformMatrix4fv() {},
  useProgram() {},
  vertexAttribPointer() {},
} as unknown as RendererWebGlContext);

beforeEach(() => {
  materialBindingMocks.bindMaterialBaseColor.mockClear();
  materialBindingMocks.lowerMaterialBaseColorBinding.mockReset();
  materialBindingMocks.lowerMaterialBaseColorBinding.mockImplementation((baseColor) => ({
    fallbackColor: baseColor.fallback?.color ?? [0.5, 0.5, 0.5, 1],
    kind: "virtual-asset",
    source: baseColor,
  }));
});

describe("drawMesh virtual texture demand", () => {
  it("passes a clipped UV footprint for a partially visible plane", () => {
    const gl = fakeGl();

    drawMesh(
      gl,
      { mesh: meshProgram() },
      mesh({
        geometry: planeGeometry([4, 2]),
        material: unlitMaterial({
          texture: virtualTextureAsset({
            fallback: solidTexture({ color: [0.1, 0.2, 0.3, 1] }),
            manifestUri: "https://assets.example.test/plane.vt.json",
          }),
        }),
        transform: {
          position: [0.5, 0, 0],
          rotation: [0, 0, 0],
        },
      }),
      {
        directionalLight: undefined,
        geometryCache: new GeometryCache(gl),
        viewport: { height: 100, width: 200 },
        viewProjectionMatrix: identity(),
      },
    );

    const options = materialBindingMocks.bindMaterialBaseColor.mock.calls[0]?.[4] as
      | BindMaterialBaseColorOptions
      | undefined;
    const demand = options?.virtualTextureDemand;

    expect(demand?.screenFootprintPx).toEqual([200, 100]);
    expect(demand?.uvFootprint?.uMin).toBeGreaterThan(0);
    expect(demand?.uvFootprint?.uMax).toBeLessThan(1);
    expect(demand?.uvFootprint?.vMin).toBe(0);
    expect(demand?.uvFootprint?.vMax).toBe(1);
  });
});
