import { describe, expect, it } from "vitest";
import type { CpuGeometry } from "../packages/renderer-webgl/src/geometry-recipes";
import {
  createVertexInputInstanceAllocation,
  createVertexInputArena,
  disposeVertexInputArena,
  dropVertexInputArenaContext,
  prepareVertexInputInstance,
  releaseLostVertexInputGeometry,
  releaseLostVertexInputInstanceAllocation,
  releaseVertexInputContextHandles,
  releaseVertexInputGeometry,
  releaseVertexInputInstanceAllocation,
  restoreVertexInputArenaContext,
  retainVertexInputGeometry,
  vertexInputArenaSnapshot,
  vertexInputBaseVertexArray,
  vertexInputCompositeVertexArrayForInstance,
  vertexInputGeometry,
  uploadVertexInputInstanceLane,
} from "../packages/renderer-webgl/src/vertex-input-arena";
import { forEachFuzzCase } from "./fuzz";

type Handle = { readonly kind: "buffer" | "vao"; readonly serial: number };

class FakeGl {
  readonly ARRAY_BUFFER = 0x8892;
  readonly ELEMENT_ARRAY_BUFFER = 0x8893;
  readonly FLOAT = 0x1406;
  readonly DYNAMIC_DRAW = 0x88e8;
  readonly STATIC_DRAW = 0x88e4;
  readonly UNSIGNED_BYTE = 0x1401;
  readonly UNSIGNED_INT = 0x1405;
  readonly UNSIGNED_SHORT = 0x1403;
  readonly deletedBuffers: Handle[] = [];
  readonly deletedVertexArrays: Handle[] = [];
  readonly events: string[] = [];
  readonly uploads: Array<{ readonly buffer: Handle; readonly bytes: Uint8Array }> = [];
  readonly allocations: Array<{ readonly buffer: Handle; readonly bytes: number }> = [];
  readonly subUploads: Array<{
    readonly buffer: Handle;
    readonly byteOffset: number;
    readonly floatCount: number;
    readonly sourceOffset: number;
  }> = [];
  bufferDataFailureAt?: number;
  bufferSubDataFailureAt?: number;
  createBufferFailureAt?: number;
  #arrayBuffer: Handle | null = null;
  #createBufferCalls = 0;
  #bufferDataCalls = 0;
  #bufferSubDataCalls = 0;
  #serial = 1;

  createBuffer = (): WebGLBuffer | null => {
    this.#createBufferCalls += 1;
    if (this.#createBufferCalls === this.createBufferFailureAt) return null;
    return { kind: "buffer", serial: this.#serial++ } as unknown as WebGLBuffer;
  };
  deleteBuffer = (value: WebGLBuffer | null): void => {
    if (value === null) return;
    const handle = value as unknown as Handle;
    this.deletedBuffers.push(handle);
    this.events.push(`buffer:${handle.serial}`);
  };
  bindBuffer = (target: number, value: WebGLBuffer | null): void => {
    if (target === this.ARRAY_BUFFER) this.#arrayBuffer = value as unknown as Handle | null;
  };
  bufferData = (_target: number, value: AllowSharedBufferSource | number, _usage: number): void => {
    this.#bufferDataCalls += 1;
    if (this.#bufferDataCalls === this.bufferDataFailureAt) throw new Error("bufferData failed");
    if (typeof value === "number") {
      this.allocations.push({ buffer: this.#arrayBuffer!, bytes: value });
      return;
    }
    const view = value as ArrayBufferView;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
    this.uploads.push({ buffer: this.#arrayBuffer!, bytes });
  };
  bufferSubData = (
    _target: number,
    byteOffset: number,
    _data: AllowSharedBufferSource,
    sourceOffset = 0,
    length?: number,
  ): void => {
    this.#bufferSubDataCalls += 1;
    if (this.#bufferSubDataCalls === this.bufferSubDataFailureAt) throw new Error("bufferSubData failed");
    this.subUploads.push({
      buffer: this.#arrayBuffer!,
      byteOffset,
      floatCount: length ?? 0,
      sourceOffset,
    });
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
  get arrayBufferBinding(): Handle | null {
    return this.#arrayBuffer;
  }
}

const glContext = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;

const recipe = (bucketKey: string, positions: readonly number[], indexed = true): CpuGeometry => ({
  bucketKey,
  ...(indexed ? { indices: new Uint16Array([0, 1, 2]) } : {}),
  mode: "triangles",
  normals: new Float32Array(positions.length),
  positions: new Float32Array(positions),
});

const preparedInstanceAllocation = (
  arena: ReturnType<typeof createVertexInputArena>,
  gl: FakeGl,
  generation: number,
) => {
  const allocation = createVertexInputInstanceAllocation(arena);
  prepareVertexInputInstance(arena, glContext(gl), generation, allocation, 1);
  uploadVertexInputInstanceLane(arena, glContext(gl), generation, allocation, "localModels", 0);
  uploadVertexInputInstanceLane(arena, glContext(gl), generation, allocation, "rootPoses", 0);
  uploadVertexInputInstanceLane(arena, glContext(gl), generation, allocation, "rootScales", 0);
  return allocation;
};

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
    const allocation = preparedInstanceAllocation(arena, gl, 1);
    const instanceId = [...vertexInputArenaSnapshot(arena).instanceAllocationIds][0]!;
    vertexInputBaseVertexArray(arena, context, 1, 1);
    vertexInputCompositeVertexArrayForInstance(arena, context, 1, 1, allocation);
    vertexInputCompositeVertexArrayForInstance(arena, context, 1, 2, allocation);
    expect(vertexInputArenaSnapshot(arena).instanceGeometryEdges.get(instanceId)).toEqual(new Set([1, 2]));

    releaseVertexInputGeometry(arena, context, 1, 1);
    expect(vertexInputArenaSnapshot(arena).instanceGeometryEdges.get(instanceId)).toEqual(new Set([2]));
    retainVertexInputGeometry(arena, { geometryId: 3, recipe: recipe("a", [0, 0, 0, 1, 0, 0, 0, 1, 0]) });
    vertexInputCompositeVertexArrayForInstance(arena, context, 1, 3, allocation);
    expect(vertexInputArenaSnapshot(arena).instanceGeometryEdges.get(instanceId)).toEqual(new Set([2, 3]));

    releaseVertexInputInstanceAllocation(arena, context, 1, allocation);
    expect(vertexInputArenaSnapshot(arena).instanceGeometryEdges.has(instanceId)).toBe(false);
    const secondAllocation = preparedInstanceAllocation(arena, gl, 1);
    vertexInputCompositeVertexArrayForInstance(arena, context, 1, 3, secondAllocation);
    vertexInputCompositeVertexArrayForInstance(arena, context, 1, 2, secondAllocation);
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
    const allocation = preparedInstanceAllocation(arena, firstGl, 1);
    vertexInputCompositeVertexArrayForInstance(arena, glContext(firstGl), 1, 5, allocation);
    const liveSnapshot = vertexInputArenaSnapshot(arena);
    expect(() => vertexInputGeometry(arena, glContext(firstGl), 2, 5)).toThrow(/generation mismatch/);
    expect(() => releaseVertexInputGeometry(arena, glContext(firstGl), 2, 5)).toThrow(/generation mismatch/);
    expect(() => releaseVertexInputInstanceAllocation(arena, glContext(firstGl), 2, allocation))
      .toThrow(/generation mismatch/);
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
    expect(vertexInputArenaSnapshot(arena).identityBucketSizes.get("hostile-shared-key")).toBe(8);
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
    const allocation = preparedInstanceAllocation(arena, gl, 1);
    for (let id = 1; id <= 32; id += 1) {
      retainVertexInputGeometry(arena, { geometryId: id, recipe: recipe("shared", [...shared.positions]) });
      vertexInputCompositeVertexArrayForInstance(arena, context, 1, id, allocation);
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

  it("owns fixed-ABI instance buffers with monotonic IDs, stable growth, and exact range stats", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    const first = createVertexInputInstanceAllocation(arena);
    createVertexInputInstanceAllocation(arena);
    expect(vertexInputArenaSnapshot(arena).instanceAllocationIds).toEqual(new Set([1, 2]));

    const initial = prepareVertexInputInstance(arena, context, 4, first, 2);
    initial.localModels.fill(1);
    initial.rootPoses.fill(2);
    initial.rootScales.fill(3);
    expect(initial.forceFull).toBe(true);
    expect(uploadVertexInputInstanceLane(arena, context, 4, first, "localModels", 0)).toEqual({
      bytes: 128, calls: 1,
    });
    expect(uploadVertexInputInstanceLane(arena, context, 4, first, "rootPoses", 0)).toEqual({
      bytes: 48, calls: 1,
    });
    expect(uploadVertexInputInstanceLane(arena, context, 4, first, "rootScales", 0)).toEqual({
      bytes: 24, calls: 1,
    });
    expect(initial.forceFull).toBe(false);
    const handles = gl.allocations.slice(0, 3).map(({ buffer }) => buffer);
    expect(gl.allocations.slice(0, 3).map(({ bytes }) => bytes)).toEqual([128, 48, 24]);

    gl.subUploads.length = 0;
    const partial = prepareVertexInputInstance(arena, context, 4, first, 2);
    expect(partial).toBe(initial);
    partial.localModels.fill(4, 16);
    partial.ranges[0] = 1;
    partial.ranges[1] = 2;
    expect(uploadVertexInputInstanceLane(arena, context, 4, first, "localModels", 1)).toEqual({
      bytes: 64, calls: 1,
    });
    expect(uploadVertexInputInstanceLane(arena, context, 4, first, "rootPoses", 0)).toEqual({
      bytes: 0, calls: 0,
    });
    partial.rootScales.fill(6);
    partial.ranges[0] = 0;
    partial.ranges[1] = 2;
    expect(uploadVertexInputInstanceLane(arena, context, 4, first, "rootScales", 1)).toEqual({
      bytes: 24, calls: 1,
    });
    expect(gl.subUploads).toEqual([
      { buffer: handles[0], byteOffset: 64, floatCount: 16, sourceOffset: 16 },
      { buffer: handles[2], byteOffset: 0, floatCount: 6, sourceOffset: 0 },
    ]);

    gl.subUploads.length = 0;
    const grown = prepareVertexInputInstance(arena, context, 4, first, 3);
    grown.localModels.fill(7);
    grown.rootPoses.fill(8);
    grown.rootScales.fill(9);
    expect(gl.allocations.slice(3).map(({ buffer }) => buffer)).toEqual(handles);
    const grownStats = [
      uploadVertexInputInstanceLane(arena, context, 4, first, "localModels", 0),
      uploadVertexInputInstanceLane(arena, context, 4, first, "rootPoses", 0),
      uploadVertexInputInstanceLane(arena, context, 4, first, "rootScales", 0),
    ];
    expect(grownStats.reduce((sum, stats) => sum + stats.calls, 0)).toBe(3);
    expect(grownStats.reduce((sum, stats) => sum + stats.bytes, 0)).toBe(300);
    expect(gl.subUploads.map(({ buffer }) => buffer)).toEqual(handles);
  });

  it("resolves owned composite VAOs, deletes VAOs before buffers, and lazily restores full data", () => {
    const firstGl = new FakeGl();
    const secondGl = new FakeGl();
    const arena = createVertexInputArena();
    retainVertexInputGeometry(arena, {
      geometryId: 91,
      recipe: recipe("owned", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    const allocation = createVertexInputInstanceAllocation(arena);
    const staging = prepareVertexInputInstance(arena, glContext(firstGl), 1, allocation, 1);
    staging.localModels.fill(1);
    staging.rootPoses.fill(2);
    staging.rootScales.fill(3);
    vertexInputCompositeVertexArrayForInstance(arena, glContext(firstGl), 1, 91, allocation);
    firstGl.events.length = 0;
    releaseVertexInputInstanceAllocation(arena, glContext(firstGl), 1, allocation);
    expect(firstGl.events[0]).toMatch(/^vao:/);
    expect(firstGl.events.slice(1)).toHaveLength(3);
    expect(firstGl.events.slice(1).every((event) => event.startsWith("buffer:"))).toBe(true);

    const restoredAllocation = createVertexInputInstanceAllocation(arena);
    const restoredStaging = prepareVertexInputInstance(arena, glContext(firstGl), 1, restoredAllocation, 2);
    restoredStaging.localModels.fill(4);
    restoredStaging.rootPoses.fill(5);
    restoredStaging.rootScales.fill(6);
    vertexInputCompositeVertexArrayForInstance(arena, glContext(firstGl), 1, 91, restoredAllocation);
    dropVertexInputArenaContext(arena);
    expect(() => vertexInputCompositeVertexArrayForInstance(
      arena, glContext(secondGl), 2, 91, restoredAllocation,
    )).toThrow(/restore it explicitly/);
    restoreVertexInputArenaContext(arena, 2);
    vertexInputCompositeVertexArrayForInstance(arena, glContext(secondGl), 2, 91, restoredAllocation);
    expect(secondGl.subUploads.map(({ floatCount }) => floatCount)).toEqual([32, 12, 6]);
    dropVertexInputArenaContext(arena);
    releaseLostVertexInputInstanceAllocation(arena, restoredAllocation);
    expect(vertexInputArenaSnapshot(arena).instanceAllocationCount).toBe(0);
  });

  it("cleans up earlier instance buffers when fixed-ABI creation fails", () => {
    const gl = new FakeGl();
    gl.createBufferFailureAt = 3;
    const arena = createVertexInputArena();
    const allocation = createVertexInputInstanceAllocation(arena);
    expect(() => prepareVertexInputInstance(arena, glContext(gl), 1, allocation, 1)).toThrow(/creation failed/);
    expect(gl.deletedBuffers).toHaveLength(2);
    expect(vertexInputArenaSnapshot(arena).instanceAllocationCount).toBe(1);
  });

  it("keeps prior staging published and every lane dirty when capacity growth fails", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    const allocation = createVertexInputInstanceAllocation(arena);
    const first = prepareVertexInputInstance(arena, context, 1, allocation, 1);
    uploadVertexInputInstanceLane(arena, context, 1, allocation, "localModels", 0);
    uploadVertexInputInstanceLane(arena, context, 1, allocation, "rootPoses", 0);
    uploadVertexInputInstanceLane(arena, context, 1, allocation, "rootScales", 0);
    gl.bufferDataFailureAt = 5;
    expect(() => prepareVertexInputInstance(arena, context, 1, allocation, 2)).toThrow(/bufferData failed/);
    expect(gl.arrayBufferBinding).toBeNull();
    const stillPublished = prepareVertexInputInstance(arena, context, 1, allocation, 1);
    expect(stillPublished).toBe(first);
    expect(stillPublished.localModels).toHaveLength(16);
    expect(stillPublished.rootPoses).toHaveLength(6);
    expect(stillPublished.rootScales).toHaveLength(3);
    expect(stillPublished.forceFull).toBe(true);
    delete gl.bufferDataFailureAt;
    const grown = prepareVertexInputInstance(arena, context, 1, allocation, 2);
    expect(grown).toBe(first);
    expect(grown.localModels).toHaveLength(32);
    expect(grown.rootPoses).toHaveLength(12);
    expect(grown.rootScales).toHaveLength(6);
    expect(grown.forceFull).toBe(true);
  });

  it("keeps a failed partial lane dirty and retries it as one full upload", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    const allocation = createVertexInputInstanceAllocation(arena);
    const staging = prepareVertexInputInstance(arena, context, 1, allocation, 3);
    uploadVertexInputInstanceLane(arena, context, 1, allocation, "localModels", 0);
    uploadVertexInputInstanceLane(arena, context, 1, allocation, "rootPoses", 0);
    uploadVertexInputInstanceLane(arena, context, 1, allocation, "rootScales", 0);
    staging.ranges.set([0, 1, 2, 3]);
    gl.bufferSubDataFailureAt = 5;
    expect(() => uploadVertexInputInstanceLane(arena, context, 1, allocation, "localModels", 2))
      .toThrow(/bufferSubData failed/);
    expect(staging.forceFull).toBe(true);
    expect(gl.arrayBufferBinding).toBeNull();
    delete gl.bufferSubDataFailureAt;
    gl.subUploads.length = 0;
    expect(uploadVertexInputInstanceLane(arena, context, 1, allocation, "localModels", 0))
      .toEqual({ bytes: 3 * 16 * Float32Array.BYTES_PER_ELEMENT, calls: 1 });
    expect(gl.subUploads).toEqual([{
      buffer: gl.allocations[0]!.buffer,
      byteOffset: 0,
      floatCount: 48,
      sourceOffset: 0,
    }]);
  });

  it("tears down every VAO before either static or owned-instance buffers", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    retainVertexInputGeometry(arena, {
      geometryId: 101,
      recipe: recipe("ordered-teardown", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    const allocation = createVertexInputInstanceAllocation(arena);
    prepareVertexInputInstance(arena, context, 8, allocation, 1);
    vertexInputBaseVertexArray(arena, context, 8, 101);
    vertexInputCompositeVertexArrayForInstance(arena, context, 8, 101, allocation);
    gl.events.length = 0;
    releaseVertexInputContextHandles(arena, context, 8);
    const lastVao = gl.events.reduce(
      (last, event, index) => event.startsWith("vao:") ? index : last,
      -1,
    );
    const firstBuffer = gl.events.findIndex((event) => event.startsWith("buffer:"));
    expect(lastVao).toBeGreaterThanOrEqual(0);
    expect(firstBuffer).toBeGreaterThan(lastVao);
    expect(vertexInputArenaSnapshot(arena).instanceAllocationCount).toBe(1);
  });

});
