import {
  boxGeometry,
  mesh,
  wireframeMaterial,
} from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import { drawMesh } from "../src/draw";
import { GeometryCache } from "../src/geometry-cache";
import type { RendererWebGlContext } from "../src/gl";
import { identity } from "../src/matrix";
import type { MeshProgram, WireframeProgram } from "../src/programs";

type DrawArraysCall = {
  readonly count: number;
  readonly first: number;
  readonly mode: number;
};

type DrawElementsCall = {
  readonly count: number;
  readonly mode: number;
  readonly offset: number;
  readonly type: number;
};

type UniformCall = {
  readonly name: string;
  readonly value: number | readonly number[];
};

const uniform = (name: string): WebGLUniformLocation =>
  ({ name }) as unknown as WebGLUniformLocation;

const uniformName = (location: WebGLUniformLocation): string =>
  (location as unknown as { readonly name: string }).name;

const meshProgram = (): MeshProgram => ({
  attributes: {
    normal: 1,
    position: 0,
  },
  program: { name: "mesh" } as unknown as WebGLProgram,
  uniforms: {
    baseColor: uniform("baseColor"),
    boxSize: uniform("boxSize"),
    color: uniform("meshColor"),
    lightColor: uniform("lightColor"),
    lightDirection: uniform("lightDirection"),
    model: uniform("meshModel"),
    unlit: uniform("unlit"),
    useVirtualTexture: uniform("useVirtualTexture"),
    useBaseColorTexture: uniform("useBaseColorTexture"),
    viewProjection: uniform("meshViewProjection"),
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

const wireframeProgram = (): WireframeProgram => ({
  attributes: {
    position: 0,
  },
  program: { name: "wireframe" } as unknown as WebGLProgram,
  uniforms: {
    color: uniform("wireframeColor"),
    model: uniform("wireframeModel"),
    viewProjection: uniform("wireframeViewProjection"),
    width: uniform("wireframeWidth"),
  },
});

const fakeGl = (): {
  readonly drawArraysCalls: readonly DrawArraysCall[];
  readonly drawElementsCalls: readonly DrawElementsCall[];
  readonly gl: RendererWebGlContext;
  readonly indexBufferData: readonly (readonly number[])[];
  readonly lineWidths: readonly number[];
  readonly uniformCalls: readonly UniformCall[];
} => {
  const drawArraysCalls: DrawArraysCall[] = [];
  const drawElementsCalls: DrawElementsCall[] = [];
  const indexBufferData: (readonly number[])[] = [];
  const lineWidths: number[] = [];
  const uniformCalls: UniformCall[] = [];
  let boundTarget = 0;

  const gl = {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    LINES: 0x0001,
    STATIC_DRAW: 0x88E4,
    TRIANGLES: 0x0004,
    UNSIGNED_SHORT: 0x1403,
    bindBuffer(target: number) {
      boundTarget = target;
    },
    bufferData(_target: number, values: BufferSource) {
      if (boundTarget === gl.ELEMENT_ARRAY_BUFFER && values instanceof Uint16Array) {
        indexBufferData.push(Array.from(values));
      }
    },
    createBuffer: () => ({} as WebGLBuffer),
    drawArrays(mode: number, first: number, count: number) {
      drawArraysCalls.push({ count, first, mode });
    },
    drawElements(mode: number, count: number, type: number, offset: number) {
      drawElementsCalls.push({ count, mode, offset, type });
    },
    enableVertexAttribArray() {},
    lineWidth(width: number) {
      lineWidths.push(width);
    },
    uniform1f(location: WebGLUniformLocation, value: number) {
      uniformCalls.push({ name: uniformName(location), value });
    },
    uniform4fv(location: WebGLUniformLocation, value: Float32List) {
      uniformCalls.push({ name: uniformName(location), value: Array.from(value) });
    },
    uniformMatrix4fv() {},
    useProgram() {},
    vertexAttribPointer() {},
  } as unknown as RendererWebGlContext;

  return {
    drawArraysCalls,
    drawElementsCalls,
    gl,
    indexBufferData,
    lineWidths,
    uniformCalls,
  };
};

describe("drawMesh WebGL wireframe material", () => {
  it("renders box wireframes as line-only edge indices", () => {
    const { drawArraysCalls, drawElementsCalls, gl, indexBufferData, lineWidths, uniformCalls } =
      fakeGl();

    drawMesh(
      gl,
      { mesh: meshProgram(), wireframe: wireframeProgram() },
      mesh({
        geometry: boxGeometry({ size: [2, 2, 2] }),
        material: wireframeMaterial({
          color: [0.38, 0.85, 0.95, 1],
        }),
      }),
      {
        directionalLight: undefined,
        geometryCache: new GeometryCache(gl),
        viewProjectionMatrix: identity(),
      },
    );

    expect(drawArraysCalls).toEqual([]);
    expect(drawElementsCalls).toEqual([
      { count: 24, mode: gl.LINES, offset: 0, type: gl.UNSIGNED_SHORT },
    ]);
    expect(indexBufferData).toContainEqual([
      0, 1, 1, 2, 2, 3, 3, 0,
      4, 5, 5, 6, 6, 7, 7, 4,
      0, 5, 1, 4, 2, 7, 3, 6,
    ]);
    expect(indexBufferData).not.toContainEqual([
      0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
    ]);
    expect(lineWidths).toContain(1.25);
    expect(uniformCalls).toContainEqual({
      name: "wireframeColor",
      value: [0.38, 0.85, 0.95, 1],
    });
    expect(uniformCalls).toContainEqual({ name: "wireframeWidth", value: 1.25 });
  });
});
