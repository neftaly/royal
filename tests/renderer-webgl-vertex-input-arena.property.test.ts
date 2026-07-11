import { describe, expect, it } from "vitest";
import type { CpuGeometry } from "../packages/renderer-webgl/src/geometry-recipes";
import {
  createVertexInputArena,
  disposeVertexInputArena,
  dropVertexInputArenaContext,
  releaseLostVertexInputGeometry,
  releaseVertexInputContextHandles,
  releaseVertexInputGeometry,
  releaseVertexInputInstance,
  restoreVertexInputArenaContext,
  retainVertexInputGeometry,
  vertexInputArenaSnapshot,
  vertexInputBaseVertexArray,
  vertexInputCompositeVertexArray,
  vertexInputGeometry,
} from "../packages/renderer-webgl/src/vertex-input-arena";
import { forEachFuzzCase } from "./fuzz";

type Handle = { readonly kind: "buffer" | "vao"; readonly serial: number };

class FakeGl {
  readonly ARRAY_BUFFER = 0x8892;
  readonly ELEMENT_ARRAY_BUFFER = 0x8893;
  readonly FLOAT = 0x1406;
  readonly STATIC_DRAW = 0x88e4;
  readonly UNSIGNED_BYTE = 0x1401;
  readonly UNSIGNED_INT = 0x1405;
  readonly UNSIGNED_SHORT = 0x1403;
  readonly deletedBuffers: Handle[] = [];
  readonly deletedVertexArrays: Handle[] = [];
  readonly events: string[] = [];
  readonly uploads: Array<{ readonly buffer: Handle; readonly bytes: Uint8Array }> = [];
  #arrayBuffer: Handle | null = null;
  #serial = 1;

  createBuffer = (): WebGLBuffer => ({ kind: "buffer", serial: this.#serial++ } as unknown as WebGLBuffer);
  deleteBuffer = (value: WebGLBuffer | null): void => {
    if (value === null) return;
    const handle = value as unknown as Handle;
    this.deletedBuffers.push(handle);
    this.events.push(`buffer:${handle.serial}`);
  };
  bindBuffer = (target: number, value: WebGLBuffer | null): void => {
    if (target === this.ARRAY_BUFFER) this.#arrayBuffer = value as unknown as Handle | null;
  };
  bufferData = (_target: number, value: AllowSharedBufferSource, _usage: number): void => {
    const view = value as ArrayBufferView;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
    this.uploads.push({ buffer: this.#arrayBuffer!, bytes });
  };
  createVertexArray = (): WebGLVertexArrayObject =>
    ({ kind: "vao", serial: this.#serial++ } as unknown as WebGLVertexArrayObject);
  deleteVertexArray = (value: WebGLVertexArrayObject | null): void => {
    if (value === null) return;
    const handle = value as unknown as Handle;
    this.deletedVertexArrays.push(handle);
    this.events.push(`vao:${handle.serial}`);
  };
  bindVertexArray = (_value: WebGLVertexArrayObject | null): void => {};
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
}

const glContext = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;

const recipe = (bucketKey: string, positions: readonly number[], indexed = true): CpuGeometry => ({
  bucketKey,
  ...(indexed ? { indices: new Uint16Array([0, 1, 2]) } : {}),
  mode: "triangles",
  normals: new Float32Array(positions.length),
  positions: new Float32Array(positions),
});

const instanceBuffers = (gl: FakeGl) => ({
  localModelBuffer: gl.createBuffer(),
  rootPoseBuffer: gl.createBuffer(),
  rootScaleBuffer: gl.createBuffer(),
});

describe("vertex-input arena", () => {
  it("keeps stable semantic IDs and byte-verifies forced selector collisions", () => {
    forEachFuzzCase({ cases: 48, seed: 0x71a0_5eed }, ({ label, random }) => {
      const gl = new FakeGl();
      const arena = createVertexInputArena();
      const values = random.array(9, () => random.int(-20, 21));
      const first = recipe("forced-collision", values);
      const equalCopy = recipe("forced-collision", values);
      const changed = [...values];
      changed[random.int(0, changed.length)]! += 1;
      const collision = recipe("forced-collision", changed);
      retainVertexInputGeometry(arena, { geometryId: 41, recipe: first });
      retainVertexInputGeometry(arena, { geometryId: 41, recipe: equalCopy });
      retainVertexInputGeometry(arena, { geometryId: 42, recipe: equalCopy });
      retainVertexInputGeometry(arena, { geometryId: 43, recipe: collision });

      const a = vertexInputGeometry(arena, glContext(gl), 7, 41);
      const b = vertexInputGeometry(arena, glContext(gl), 7, 42);
      const c = vertexInputGeometry(arena, glContext(gl), 7, 43);
      expect(a, label).toBe(b);
      expect(a.arrayBuffer, label).toBe(b.arrayBuffer);
      expect(a.staticIdentityId, label).toBe(b.staticIdentityId);
      expect(c.arrayBuffer, label).not.toBe(a.arrayBuffer);
      expect(c.staticIdentityId, label).not.toBe(a.staticIdentityId);
      expect(vertexInputGeometry(arena, glContext(gl), 7, 41).arrayBuffer, label).toBe(a.arrayBuffer);
      expect(vertexInputArenaSnapshot(arena).staticGeometryCount, label).toBe(2);
    });
  });

  it("maintains reverse instance edges through 2 -> 1 -> 2 and deletes VAOs first", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    retainVertexInputGeometry(arena, { geometryId: 1, recipe: recipe("a", [0, 0, 0, 1, 0, 0, 0, 1, 0]) });
    retainVertexInputGeometry(arena, { geometryId: 2, recipe: recipe("b", [0, 0, 1, 1, 0, 1, 0, 1, 1]) });
    const buffers = instanceBuffers(gl);
    vertexInputBaseVertexArray(arena, context, 1, 1);
    vertexInputCompositeVertexArray(arena, context, 1, 1, 9, buffers);
    vertexInputCompositeVertexArray(arena, context, 1, 2, 9, buffers);
    expect(vertexInputArenaSnapshot(arena).instanceGeometryEdges.get(9)).toEqual(new Set([1, 2]));

    releaseVertexInputGeometry(arena, context, 1, 1);
    expect(vertexInputArenaSnapshot(arena).instanceGeometryEdges.get(9)).toEqual(new Set([2]));
    retainVertexInputGeometry(arena, { geometryId: 3, recipe: recipe("a", [0, 0, 0, 1, 0, 0, 0, 1, 0]) });
    vertexInputCompositeVertexArray(arena, context, 1, 3, 9, buffers);
    expect(vertexInputArenaSnapshot(arena).instanceGeometryEdges.get(9)).toEqual(new Set([2, 3]));

    releaseVertexInputInstance(arena, context, 1, 9);
    expect(vertexInputArenaSnapshot(arena).instanceGeometryEdges.has(9)).toBe(false);
    vertexInputCompositeVertexArray(arena, context, 1, 3, 10, buffers);
    vertexInputCompositeVertexArray(arena, context, 1, 2, 10, buffers);
    gl.events.length = 0;
    releaseVertexInputContextHandles(arena, context, 1);
    const firstBuffer = gl.events.findIndex((event) => event.startsWith("buffer:"));
    let lastVao = -1;
    for (let index = gl.events.length - 1; index >= 0; index -= 1) {
      if (gl.events[index]!.startsWith("vao:")) {
        lastVao = index;
        break;
      }
    }
    expect(lastVao).toBeGreaterThanOrEqual(0);
    expect(firstBuffer).toBeGreaterThan(lastVao);
    expect(vertexInputArenaSnapshot(arena).semanticGeometryCount).toBe(2);
    expect(vertexInputArenaSnapshot(arena).staticGeometryCount).toBe(0);
  });

  it("drops a lost context GL-free and lazily restores fresh handles", () => {
    const firstGl = new FakeGl();
    const secondGl = new FakeGl();
    const arena = createVertexInputArena();
    retainVertexInputGeometry(arena, {
      geometryId: 5,
      recipe: recipe("restore", [0, 0, 0, 2, 0, 0, 0, 2, 0]),
    });
    retainVertexInputGeometry(arena, {
      geometryId: 6,
      recipe: recipe("restore-second", [0, 0, 1, 2, 0, 1, 0, 2, 1]),
    });
    const first = vertexInputGeometry(arena, glContext(firstGl), 1, 5);
    vertexInputCompositeVertexArray(arena, glContext(firstGl), 1, 5, 3, instanceBuffers(firstGl));
    const liveSnapshot = vertexInputArenaSnapshot(arena);
    expect(() => vertexInputGeometry(arena, glContext(firstGl), 2, 5)).toThrow(/generation mismatch/);
    expect(() => releaseVertexInputGeometry(arena, glContext(firstGl), 2, 5)).toThrow(/generation mismatch/);
    expect(() => releaseVertexInputInstance(arena, glContext(firstGl), 2, 3)).toThrow(/generation mismatch/);
    expect(() => restoreVertexInputArenaContext(arena, 2)).toThrow(/while generation 1 is active/);
    expect(() => disposeVertexInputArena(arena, glContext(firstGl))).toThrow(/requires both/);
    expect(vertexInputArenaSnapshot(arena)).toEqual(liveSnapshot);
    expect(firstGl.deletedBuffers).toHaveLength(0);
    expect(firstGl.deletedVertexArrays).toHaveLength(0);

    dropVertexInputArenaContext(arena);
    expect(firstGl.deletedBuffers).toHaveLength(0);
    expect(firstGl.deletedVertexArrays).toHaveLength(0);
    releaseLostVertexInputGeometry(arena, 5);
    expect(firstGl.deletedBuffers).toHaveLength(0);
    expect(firstGl.deletedVertexArrays).toHaveLength(0);
    expect(vertexInputArenaSnapshot(arena).semanticGeometryCount).toBe(1);

    expect(() => vertexInputGeometry(arena, glContext(secondGl), 2, 6)).toThrow(/restore it explicitly/);
    expect(secondGl.uploads).toHaveLength(0);
    restoreVertexInputArenaContext(arena, 2);
    expect(secondGl.uploads).toHaveLength(0);
    const restored = vertexInputGeometry(arena, glContext(secondGl), 2, 6);
    expect(restored.arrayBuffer).not.toBe(first.arrayBuffer);
    expect(secondGl.uploads.length).toBeGreaterThan(0);
    disposeVertexInputArena(arena, glContext(secondGl), 2);
    expect(vertexInputArenaSnapshot(arena).semanticGeometryCount).toBe(0);
    expect(secondGl.deletedBuffers.length).toBeGreaterThan(0);
  });

  it("caps adversarial identity buckets and leaves overflow resources unique", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    for (let id = 1; id <= 10; id += 1) {
      retainVertexInputGeometry(arena, {
        geometryId: id,
        recipe: recipe("hostile-shared-key", [0, 0, id, 1, 0, id, 0, 1, id], false),
      });
      vertexInputGeometry(arena, context, 1, id);
    }
    expect(arena.geometryBuckets.get("hostile-shared-key")).toHaveLength(8);
    expect(vertexInputArenaSnapshot(arena).staticGeometryCount).toBe(10);

    retainVertexInputGeometry(arena, {
      geometryId: 11,
      recipe: recipe("hostile-shared-key", [0, 0, 10, 1, 0, 10, 0, 1, 10], false),
    });
    expect(vertexInputGeometry(arena, context, 1, 11).arrayBuffer).not.toBe(
      vertexInputGeometry(arena, context, 1, 10).arrayBuffer,
    );
  });

  it("releases shared composite VAOs by physical semantic users without global scans", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    const shared = recipe("shared", [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const buffers = instanceBuffers(gl);
    for (let id = 1; id <= 32; id += 1) {
      retainVertexInputGeometry(arena, { geometryId: id, recipe: recipe("shared", [...shared.positions]) });
      vertexInputCompositeVertexArray(arena, context, 1, id, 77, buffers);
    }
    expect(vertexInputArenaSnapshot(arena).staticGeometryCount).toBe(1);
    expect(vertexInputArenaSnapshot(arena).compositeVertexArrayCount).toBe(1);
    for (let id = 1; id < 32; id += 1) releaseVertexInputGeometry(arena, context, 1, id);
    expect(gl.deletedVertexArrays).toHaveLength(0);
    expect(vertexInputArenaSnapshot(arena).compositeVertexArrayCount).toBe(1);
    releaseVertexInputGeometry(arena, context, 1, 32);
    expect(gl.deletedVertexArrays).toHaveLength(1);
    expect(vertexInputArenaSnapshot(arena).staticGeometryCount).toBe(0);
  });

  it("bounds generation-local static identity allocation transactionally", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    arena.nextStaticIdentityId = Number.MAX_SAFE_INTEGER;
    retainVertexInputGeometry(arena, { geometryId: 1, recipe: recipe("last", [0, 0, 0]) });
    expect(vertexInputGeometry(arena, context, 1, 1).staticIdentityId).toBe(Number.MAX_SAFE_INTEGER);
    retainVertexInputGeometry(arena, { geometryId: 2, recipe: recipe("exhausted", [1, 0, 0]) });
    const uploads = gl.uploads.length;
    expect(() => vertexInputGeometry(arena, context, 1, 2)).toThrow(/ID space is exhausted/);
    expect(gl.uploads).toHaveLength(uploads);
    expect(vertexInputArenaSnapshot(arena).staticGeometryCount).toBe(1);
  });
});
