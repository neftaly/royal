import {
  boxGeometry,
  mesh,
  solidTexture,
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
    useBaseColorTexture: uniform("useBaseColorTexture"),
    viewProjection: uniform("meshViewProjection"),
  },
});

const wireframeProgram = (): WireframeProgram => ({
  attributes: {
    barycentric: 2,
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
  readonly gl: RendererWebGlContext;
  readonly uniformCalls: readonly UniformCall[];
  readonly counts: {
    readonly drawElements: number;
  };
} => {
  let drawElements = 0;
  const drawArraysCalls: DrawArraysCall[] = [];
  const uniformCalls: UniformCall[] = [];

  const gl = {
    ARRAY_BUFFER: 0x8892,
    FLOAT: 0x1406,
    STATIC_DRAW: 0x88E4,
    TRIANGLES: 0x0004,
    bindBuffer() {},
    bufferData() {},
    createBuffer: () => ({} as WebGLBuffer),
    drawArrays(mode: number, first: number, count: number) {
      drawArraysCalls.push({ count, first, mode });
    },
    drawElements() {
      drawElements += 1;
    },
    enableVertexAttribArray() {},
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
    gl,
    uniformCalls,
    counts: {
      get drawElements() {
        return drawElements;
      },
    },
  };
};

describe("drawMesh WebGL wireframe material", () => {
  it("renders box wireframes through barycentric triangle draw arrays", () => {
    const { counts, drawArraysCalls, gl, uniformCalls } = fakeGl();

    drawMesh(
      gl,
      { mesh: meshProgram(), wireframe: wireframeProgram() },
      mesh({
        geometry: boxGeometry({ size: [2, 2, 2] }),
        material: wireframeMaterial({
          baseColor: solidTexture({ color: [0.38, 0.85, 0.95, 1] }),
        }),
      }),
      {
        directionalLight: undefined,
        geometryCache: new GeometryCache(gl),
        viewProjectionMatrix: identity(),
      },
    );

    expect(counts.drawElements).toBe(0);
    expect(drawArraysCalls).toEqual([{ count: 36, first: 0, mode: gl.TRIANGLES }]);
    expect(uniformCalls).toContainEqual({
      name: "wireframeColor",
      value: [0.38, 0.85, 0.95, 1],
    });
    expect(uniformCalls).toContainEqual({ name: "wireframeWidth", value: 1.25 });
  });
});
