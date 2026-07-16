import { describe, expect, it } from "vitest";
import type { CpuGeometry } from "../packages/renderer-webgl/src/geometry-recipes";
import {
  createVertexInputArena,
  createVertexInputInstanceAllocation,
  disposeVertexInputArena,
  prepareVertexInputInstance,
  retainVertexInputGeometry,
  uploadVertexInputInstanceLane,
  vertexInputGeometry,
} from "../packages/renderer-webgl/src/vertex-input/arena";
import {
  clearGeometryDrawArenaContext,
  createGeometryDrawArena,
  drawGeometry,
  prepareGeometryInstancedDraw,
  submitGeometryInstancedDraw,
} from "../packages/renderer-webgl/src/webgl/geometry-draw-arena";
import { VERTEX_ATTRIBUTE } from "../packages/renderer-webgl/src/vertex-input/attribute-abi";

type Handle = { readonly kind: "buffer" | "vao"; readonly serial: number };
type DrawCall =
  | { readonly count: number; readonly first: number; readonly kind: "arrays"; readonly mode: number }
  | { readonly count: number; readonly kind: "elements"; readonly mode: number; readonly offset: number; readonly type: number }
  | { readonly count: number; readonly first: number; readonly instances: number; readonly kind: "arrays-instanced"; readonly mode: number }
  | { readonly count: number; readonly instances: number; readonly kind: "elements-instanced"; readonly mode: number; readonly offset: number; readonly type: number };

class FakeGl {
  readonly ARRAY_BUFFER = 0x8892;
  readonly ELEMENT_ARRAY_BUFFER = 0x8893;
  readonly FLOAT = 0x1406;
  readonly DYNAMIC_DRAW = 0x88e8;
  readonly STATIC_DRAW = 0x88e4;
  readonly UNSIGNED_BYTE = 0x1401;
  readonly UNSIGNED_INT = 0x1405;
  readonly UNSIGNED_SHORT = 0x1403;
  readonly LINE_LOOP = 0x0002;
  readonly LINE_STRIP = 0x0003;
  readonly LINES = 0x0001;
  readonly POINTS = 0x0000;
  readonly TRIANGLE_FAN = 0x0006;
  readonly TRIANGLE_STRIP = 0x0005;
  readonly TRIANGLES = 0x0004;
  readonly boundVertexArrays: Array<Handle | null> = [];
  readonly defaults: Array<{ readonly location: number; readonly values: readonly [number, number, number, number] }> = [];
  readonly draws: DrawCall[] = [];
  readonly events: string[] = [];
  #serial = 1;

  createBuffer = (): WebGLBuffer =>
    ({ kind: "buffer", serial: this.#serial++ } as unknown as WebGLBuffer);
  deleteBuffer = (_value: WebGLBuffer | null): void => {};
  bindBuffer = (_target: number, _value: WebGLBuffer | null): void => {};
  bufferData = (_target: number, _value: AllowSharedBufferSource | number, _usage: number): void => {};
  bufferSubData = (
    _target: number,
    _byteOffset: number,
    _data: AllowSharedBufferSource,
    _sourceOffset?: number,
    _length?: number,
  ): void => {};
  createVertexArray = (): WebGLVertexArrayObject =>
    ({ kind: "vao", serial: this.#serial++ } as unknown as WebGLVertexArrayObject);
  deleteVertexArray = (_value: WebGLVertexArrayObject | null): void => {};
  bindVertexArray = (value: WebGLVertexArrayObject | null): void => {
    this.boundVertexArrays.push(value as unknown as Handle | null);
    this.events.push("bindVertexArray");
  };
  enableVertexAttribArray = (_location: number): void => {};
  disableVertexAttribArray = (_location: number): void => {};
  vertexAttribPointer = (
    _location: number,
    _size: number,
    _type: number,
    _normalized: boolean,
    _stride: number,
    _offset: number,
  ): void => {};
  vertexAttribDivisor = (_location: number, _divisor: number): void => {};
  vertexAttrib4f = (location: number, x: number, y: number, z: number, w: number): void => {
    this.defaults.push({ location, values: [x, y, z, w] });
    this.events.push("vertexAttrib4f");
  };
  lineWidth = (_width: number): void => { this.events.push("lineWidth"); };
  drawArrays = (mode: number, first: number, count: number): void => {
    this.draws.push({ count, first, kind: "arrays", mode });
    this.events.push("drawArrays");
  };
  drawElements = (mode: number, count: number, type: number, offset: number): void => {
    this.draws.push({ count, kind: "elements", mode, offset, type });
    this.events.push("drawElements");
  };
  drawArraysInstanced = (mode: number, first: number, count: number, instances: number): void => {
    this.draws.push({ count, first, instances, kind: "arrays-instanced", mode });
    this.events.push("drawArraysInstanced");
  };
  drawElementsInstanced = (mode: number, count: number, type: number, offset: number, instances: number): void => {
    this.draws.push({ count, instances, kind: "elements-instanced", mode, offset, type });
    this.events.push("drawElementsInstanced");
  };
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;

const recipe = (bucketKey: string, mode: CpuGeometry["mode"], indexed: boolean): CpuGeometry => ({
  bucketKey,
  ...(indexed ? { indices: new Uint16Array([0, 1, 2]) } : {}),
  mode,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
});

describe("geometry draw arena", () => {
  it("draws base indexed geometry and caches missing-attribute defaults until context clear", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    retainVertexInputGeometry(vertexInputs, { geometryId: 1, recipe: recipe("indexed", "triangles", true) });
    const geometry = vertexInputGeometry(vertexInputs, context(gl), 7, 1);
    const arena = createGeometryDrawArena(context(gl), vertexInputs);

    gl.events.length = 0;
    drawGeometry(arena, 7, 1, geometry);
    drawGeometry(arena, 7, 1, geometry);

    expect(gl.boundVertexArrays.at(-1)).toEqual(expect.objectContaining({ kind: "vao" }));
    expect(gl.draws).toEqual([
      { count: 3, kind: "elements", mode: gl.TRIANGLES, offset: 0, type: gl.UNSIGNED_SHORT },
      { count: 3, kind: "elements", mode: gl.TRIANGLES, offset: 0, type: gl.UNSIGNED_SHORT },
    ]);
    expect(gl.defaults).toEqual([
      { location: VERTEX_ATTRIBUTE.tangent, values: [0, 0, 0, 0] },
      { location: VERTEX_ATTRIBUTE.color, values: [1, 1, 1, 1] },
    ]);
    expect(gl.events).not.toContain("lineWidth");

    clearGeometryDrawArenaContext(arena);
    drawGeometry(arena, 7, 1, geometry);
    expect(gl.defaults).toHaveLength(4);
    expect(gl.defaults.slice(2)).toEqual(gl.defaults.slice(0, 2));
    disposeVertexInputArena(vertexInputs, context(gl), 7);
  });

  it("binds composite input and selects indexed and non-indexed instanced calls", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    retainVertexInputGeometry(vertexInputs, { geometryId: 1, recipe: recipe("indexed", "triangles", true) });
    retainVertexInputGeometry(vertexInputs, { geometryId: 2, recipe: recipe("plain", "points", false) });
    const indexed = vertexInputGeometry(vertexInputs, context(gl), 3, 1);
    const plain = vertexInputGeometry(vertexInputs, context(gl), 3, 2);
    const allocation = createVertexInputInstanceAllocation(vertexInputs);
    prepareVertexInputInstance(vertexInputs, context(gl), 3, allocation, 5);
    uploadVertexInputInstanceLane(vertexInputs, context(gl), 3, allocation, "localModels", 0);
    uploadVertexInputInstanceLane(vertexInputs, context(gl), 3, allocation, "rootPositions", 0);
    uploadVertexInputInstanceLane(vertexInputs, context(gl), 3, allocation, "rootRotations", 0);
    uploadVertexInputInstanceLane(vertexInputs, context(gl), 3, allocation, "rootScales", 0);
    const arena = createGeometryDrawArena(context(gl), vertexInputs);

    drawGeometry(arena, 3, 1, indexed);
    const baseVertexArray = gl.boundVertexArrays.at(-1);
    prepareGeometryInstancedDraw(arena, 3, 1, indexed, allocation);
    submitGeometryInstancedDraw(arena, indexed, 5);
    const compositeVertexArray = gl.boundVertexArrays.at(-1);
    prepareGeometryInstancedDraw(arena, 3, 2, plain, allocation);
    submitGeometryInstancedDraw(arena, plain, 2);

    expect(compositeVertexArray).not.toBe(baseVertexArray);
    expect(gl.draws).toEqual([
      { count: 3, kind: "elements", mode: gl.TRIANGLES, offset: 0, type: gl.UNSIGNED_SHORT },
      { count: 3, instances: 5, kind: "elements-instanced", mode: gl.TRIANGLES, offset: 0, type: gl.UNSIGNED_SHORT },
      { count: 3, first: 0, instances: 2, kind: "arrays-instanced", mode: gl.POINTS },
    ]);
    disposeVertexInputArena(vertexInputs, context(gl), 3);
  });

  it("maps every geometry mode and skips defaults for supplied tangent and color buffers", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const modes = [
      ["line-loop", gl.LINE_LOOP],
      ["line-strip", gl.LINE_STRIP],
      ["lines", gl.LINES],
      ["points", gl.POINTS],
      ["triangle-fan", gl.TRIANGLE_FAN],
      ["triangle-strip", gl.TRIANGLE_STRIP],
      ["triangles", gl.TRIANGLES],
    ] as const satisfies readonly (readonly [CpuGeometry["mode"], number])[];
    const arena = createGeometryDrawArena(context(gl), vertexInputs);
    for (const [mode, expected] of modes) {
      const geometryId = modes.findIndex(([candidate]) => candidate === mode) + 1;
      retainVertexInputGeometry(vertexInputs, { geometryId, recipe: recipe(mode, mode, false) });
      const resolved = vertexInputGeometry(vertexInputs, context(gl), 11, geometryId);
      drawGeometry(arena, 11, geometryId, {
        ...resolved,
        colorBuffer: { kind: "buffer", serial: 10_000 } as unknown as WebGLBuffer,
        tangentBuffer: { kind: "buffer", serial: 10_001 } as unknown as WebGLBuffer,
      });
      expect(gl.draws.at(-1)).toEqual({ count: 3, first: 0, kind: "arrays", mode: expected });
    }
    expect(gl.defaults).toHaveLength(0);
    disposeVertexInputArena(vertexInputs, context(gl), 11);
  });
});
