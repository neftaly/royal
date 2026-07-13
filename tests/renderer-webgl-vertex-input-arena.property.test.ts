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
  type VertexInputGpuGovernor,
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
  readonly successfullyDeletedBuffers: Handle[] = [];
  readonly successfullyDeletedVertexArrays: Handle[] = [];
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
  createVertexArrayFailureAt?: number;
  deleteBufferFailureAt?: number;
  readonly deleteBufferFailures = new Set<number>();
  deleteVertexArrayFailureAt?: number;
  readonly deleteVertexArrayFailures = new Set<number>();
  vertexAttribPointerFailureAt?: number;
  #arrayBuffer: Handle | null = null;
  #createBufferCalls = 0;
  #deleteBufferCalls = 0;
  #deleteVertexArrayCalls = 0;
  #createVertexArrayCalls = 0;
  #vertexAttribPointerCalls = 0;
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
    this.#deleteBufferCalls += 1;
    const handle = value as unknown as Handle;
    this.deletedBuffers.push(handle);
    this.events.push(`buffer:${handle.serial}`);
    if (this.#deleteBufferCalls === this.deleteBufferFailureAt
      || this.deleteBufferFailures.has(this.#deleteBufferCalls)) throw new Error("deleteBuffer failed");
    this.successfullyDeletedBuffers.push(handle);
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
  createVertexArray = (): WebGLVertexArrayObject | null => {
    this.#createVertexArrayCalls += 1;
    if (this.#createVertexArrayCalls === this.createVertexArrayFailureAt) return null;
    return { kind: "vao", serial: this.#serial++ } as unknown as WebGLVertexArrayObject;
  };
  deleteVertexArray = (value: WebGLVertexArrayObject | null): void => {
    if (value === null) return;
    const handle = value as unknown as Handle;
    this.deletedVertexArrays.push(handle);
    this.events.push(`vao:${handle.serial}`);
    this.#deleteVertexArrayCalls += 1;
    if (this.#deleteVertexArrayCalls === this.deleteVertexArrayFailureAt
      || this.deleteVertexArrayFailures.has(this.#deleteVertexArrayCalls)) {
      throw new Error("deleteVertexArray failed");
    }
    this.successfullyDeletedVertexArrays.push(handle);
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
  ): void => {
    this.#vertexAttribPointerCalls += 1;
    if (this.#vertexAttribPointerCalls === this.vertexAttribPointerFailureAt) {
      throw new Error("vertexAttribPointer failed");
    }
  };
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

type RecordedGpuCost = {
  readonly persistentGpuBytes: number;
  readonly transientPeakBytes?: number;
  readonly uploadBytes: number;
};

const recordingGovernor = (denied = false): {
  readonly cancelled: { value: number };
  readonly committed: { value: number };
  readonly costs: RecordedGpuCost[];
  readonly governor: VertexInputGpuGovernor;
  readonly released: { value: number };
} => {
  const cancelled = { value: 0 };
  const committed = { value: 0 };
  const released = { value: 0 };
  const costs: RecordedGpuCost[] = [];
  return {
    cancelled,
    committed,
    costs,
    governor: {
      reserve: (cost) => {
        costs.push(cost);
        if (denied) return undefined;
        return {
          cancel: () => { cancelled.value += 1; return true; },
          commit: () => {
            committed.value += 1;
            return { release: () => { released.value += 1; return true; } };
          },
        };
      },
    },
    released,
  };
};

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

  it("resumes a composite geometry release without applying semantic mutations twice", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    const shared = recipe("shared-release", [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const allocation = preparedInstanceAllocation(arena, gl, 1);
    retainVertexInputGeometry(arena, { geometryId: 1, recipe: shared });
    retainVertexInputGeometry(arena, { geometryId: 2, recipe: recipe("shared-release", [...shared.positions]) });
    vertexInputCompositeVertexArrayForInstance(arena, context, 1, 1, allocation);
    vertexInputCompositeVertexArrayForInstance(arena, context, 1, 2, allocation);

    releaseVertexInputGeometry(arena, context, 1, 1);
    gl.deleteVertexArrayFailureAt = 1;
    expect(() => releaseVertexInputGeometry(arena, context, 1, 2)).toThrow(/deleteVertexArray failed/);
    expect(vertexInputArenaSnapshot(arena).instanceGeometryEdges.size).toBe(0);
    expect(vertexInputArenaSnapshot(arena).semanticGeometryIds).toEqual(new Set([2]));

    expect(() => releaseVertexInputGeometry(arena, context, 1, 2)).not.toThrow();
    expect(vertexInputArenaSnapshot(arena).semanticGeometryCount).toBe(0);
    expect(vertexInputArenaSnapshot(arena).staticGeometryCount).toBe(0);
  });

  it("resumes static buffer deletion after the last successful handle", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    retainVertexInputGeometry(arena, {
      geometryId: 1,
      recipe: recipe("buffer-release", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    vertexInputGeometry(arena, context, 1, 1);
    gl.deleteBufferFailureAt = 2;

    expect(() => releaseVertexInputGeometry(arena, context, 1, 1)).toThrow(/deleteBuffer failed/);
    const firstSuccessfullyDeleted = gl.deletedBuffers[0]!;
    expect(() => releaseVertexInputGeometry(arena, context, 1, 1)).not.toThrow();
    expect(gl.deletedBuffers.filter((handle) => handle === firstSuccessfullyDeleted)).toHaveLength(1);
    expect(vertexInputArenaSnapshot(arena).semanticGeometryCount).toBe(0);
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

  it("rejects an invalid instance lane instead of uploading root scales", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    const allocation = createVertexInputInstanceAllocation(arena);
    prepareVertexInputInstance(arena, context, 1, allocation, 1);

    expect(() => uploadVertexInputInstanceLane(
      arena,
      context,
      1,
      allocation,
      "not-a-lane" as never,
      0,
    )).toThrow(/Invalid vertex-input instance lane not-a-lane/);
    expect(gl.subUploads).toHaveLength(0);
    expect(uploadVertexInputInstanceLane(arena, context, 1, allocation, "rootScales", 0))
      .toEqual({ bytes: 12, calls: 1 });
    expect(gl.subUploads[0]?.buffer).toBe(gl.allocations[2]?.buffer);
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

  it("retains failed static-upload rollback handles and retries every delete exactly once", () => {
    const gl = new FakeGl();
    const arena = createVertexInputArena();
    retainVertexInputGeometry(arena, {
      geometryId: 1,
      recipe: recipe("static-acquire-fault", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    gl.bufferDataFailureAt = 2;
    gl.deleteBufferFailures.add(1);
    gl.deleteBufferFailures.add(2);
    expect(() => vertexInputGeometry(arena, glContext(gl), 1, 1)).toThrow(/bufferData failed/);
    expect(vertexInputArenaSnapshot(arena).pendingBufferDeleteCount).toBe(2);

    gl.deleteBufferFailures.clear();
    disposeVertexInputArena(arena, glContext(gl), 1);
    expect(vertexInputArenaSnapshot(arena).pendingBufferDeleteCount).toBe(0);
    expect(new Set(gl.successfullyDeletedBuffers).size).toBe(2);
    expect(gl.successfullyDeletedBuffers).toHaveLength(2);
  });

  it("covers every partial buffer acquisition boundary, including rollback failures", () => {
    for (let failureAt = 1; failureAt <= 3; failureAt += 1) {
      const staticGl = new FakeGl();
      const staticArena = createVertexInputArena();
      retainVertexInputGeometry(staticArena, {
        geometryId: 1,
        recipe: recipe("static-create-boundary", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
      });
      staticGl.createBufferFailureAt = failureAt;
      expect(() => vertexInputGeometry(staticArena, glContext(staticGl), 1, 1)).toThrow(/creation failed/);
      expect(vertexInputArenaSnapshot(staticArena).pendingBufferDeleteCount).toBe(0);

      const instanceGl = new FakeGl();
      const instanceArena = createVertexInputArena();
      const allocation = createVertexInputInstanceAllocation(instanceArena);
      instanceGl.createBufferFailureAt = failureAt;
      if (failureAt > 1) instanceGl.deleteBufferFailures.add(1);
      expect(() => prepareVertexInputInstance(instanceArena, glContext(instanceGl), 1, allocation, 1))
        .toThrow(/creation failed/);
      expect(vertexInputArenaSnapshot(instanceArena).pendingBufferDeleteCount)
        .toBe(failureAt > 1 ? 1 : 0);
      instanceGl.deleteBufferFailures.clear();
      disposeVertexInputArena(instanceArena, glContext(instanceGl), 1);
      expect(vertexInputArenaSnapshot(instanceArena).pendingBufferDeleteCount).toBe(0);
    }
  });

  it("retains failed base and composite setup VAOs until context disposal retries them", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    retainVertexInputGeometry(arena, {
      geometryId: 1,
      recipe: recipe("vao-acquire-fault", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    gl.vertexAttribPointerFailureAt = 1;
    gl.deleteVertexArrayFailureAt = 1;
    expect(() => vertexInputBaseVertexArray(arena, context, 1, 1)).toThrow(/vertexAttribPointer failed/);
    expect(vertexInputArenaSnapshot(arena).pendingVertexArrayDeleteCount).toBe(1);

    delete gl.vertexAttribPointerFailureAt;
    const allocation = preparedInstanceAllocation(arena, gl, 1);
    gl.vertexAttribPointerFailureAt = 3;
    gl.deleteVertexArrayFailures.add(3);
    expect(() => vertexInputCompositeVertexArrayForInstance(arena, context, 1, 1, allocation))
      .toThrow(/vertexAttribPointer failed/);
    expect(vertexInputArenaSnapshot(arena).pendingVertexArrayDeleteCount).toBe(1);

    delete gl.vertexAttribPointerFailureAt;
    gl.deleteVertexArrayFailures.clear();
    disposeVertexInputArena(arena, context, 1);
    expect(vertexInputArenaSnapshot(arena).pendingVertexArrayDeleteCount).toBe(0);
    expect(new Set(gl.successfullyDeletedVertexArrays).size)
      .toBe(gl.successfullyDeletedVertexArrays.length);
  });

  it("does not publish null base or composite VAO acquisitions", () => {
    const baseGl = new FakeGl();
    const baseArena = createVertexInputArena();
    retainVertexInputGeometry(baseArena, {
      geometryId: 1,
      recipe: recipe("null-base-vao", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    baseGl.createVertexArrayFailureAt = 1;
    expect(() => vertexInputBaseVertexArray(baseArena, glContext(baseGl), 1, 1)).toThrow(/creation failed/);
    expect(vertexInputArenaSnapshot(baseArena).baseVertexArrayCount).toBe(0);
    expect(vertexInputArenaSnapshot(baseArena).pendingVertexArrayDeleteCount).toBe(0);

    const compositeGl = new FakeGl();
    const compositeArena = createVertexInputArena();
    retainVertexInputGeometry(compositeArena, {
      geometryId: 1,
      recipe: recipe("null-composite-vao", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    const allocation = preparedInstanceAllocation(compositeArena, compositeGl, 1);
    compositeGl.createVertexArrayFailureAt = 1;
    expect(() => vertexInputCompositeVertexArrayForInstance(
      compositeArena, glContext(compositeGl), 1, 1, allocation,
    )).toThrow(/creation failed/);
    expect(vertexInputArenaSnapshot(compositeArena).compositeVertexArrayCount).toBe(0);
    expect(vertexInputArenaSnapshot(compositeArena).instanceGeometryEdges.size).toBe(0);
  });

  it("resumes active instance release across multiple VAO and buffer delete failures", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    retainVertexInputGeometry(arena, {
      geometryId: 1,
      recipe: recipe("instance-release-a", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    retainVertexInputGeometry(arena, {
      geometryId: 2,
      recipe: recipe("instance-release-b", [0, 0, 1, 1, 0, 1, 0, 1, 1]),
    });
    const allocation = preparedInstanceAllocation(arena, gl, 1);
    vertexInputCompositeVertexArrayForInstance(arena, context, 1, 1, allocation);
    vertexInputCompositeVertexArrayForInstance(arena, context, 1, 2, allocation);
    gl.deleteVertexArrayFailures.add(1);
    gl.deleteVertexArrayFailures.add(2);
    expect(() => releaseVertexInputInstanceAllocation(arena, context, 1, allocation))
      .toThrow(/deleteVertexArray failed/);
    expect(vertexInputArenaSnapshot(arena).compositeVertexArrayCount).toBe(2);

    gl.deleteVertexArrayFailures.clear();
    gl.deleteBufferFailures.add(1);
    gl.deleteBufferFailures.add(3);
    expect(() => releaseVertexInputInstanceAllocation(arena, context, 1, allocation))
      .toThrow(/deleteBuffer failed/);
    expect(vertexInputArenaSnapshot(arena).pendingBufferDeleteCount).toBe(2);

    gl.deleteBufferFailures.clear();
    releaseVertexInputInstanceAllocation(arena, context, 1, allocation);
    expect(vertexInputArenaSnapshot(arena).instanceAllocationCount).toBe(0);
    expect(new Set(gl.successfullyDeletedBuffers).size)
      .toBe(gl.successfullyDeletedBuffers.length);
    expect(new Set(gl.successfullyDeletedVertexArrays).size)
      .toBe(gl.successfullyDeletedVertexArrays.length);
  });

  it("keeps failed context handles retryable or accounts them when teardown becomes terminal", () => {
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena();
    retainVertexInputGeometry(arena, {
      geometryId: 1,
      recipe: recipe("terminal-release", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    const allocation = preparedInstanceAllocation(arena, gl, 4);
    vertexInputBaseVertexArray(arena, context, 4, 1);
    vertexInputCompositeVertexArrayForInstance(arena, context, 4, 1, allocation);
    gl.deleteVertexArrayFailures.add(1);
    gl.deleteVertexArrayFailures.add(2);
    expect(() => releaseVertexInputContextHandles(arena, context, 4)).toThrow(/deleteVertexArray failed/);
    expect(vertexInputArenaSnapshot(arena).baseVertexArrayCount).toBe(1);
    expect(vertexInputArenaSnapshot(arena).compositeVertexArrayCount).toBe(1);

    dropVertexInputArenaContext(arena);
    const dropped = vertexInputArenaSnapshot(arena);
    expect(dropped.abandonedVertexArrayCount).toBe(2);
    expect(dropped.abandonedBufferCount).toBe(6);
    expect(dropped.pendingBufferDeleteCount).toBe(0);
    expect(dropped.pendingVertexArrayDeleteCount).toBe(0);
    disposeVertexInputArena(arena);
    expect(vertexInputArenaSnapshot(arena).abandonedVertexArrayCount).toBe(2);
  });

  it("reserves exact static geometry bytes before GL effects and releases the durable lease", () => {
    const denied = recordingGovernor(true);
    const deniedGl = new FakeGl();
    const deniedArena = createVertexInputArena(denied.governor);
    const geometryRecipe = recipe("governed-static", [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    retainVertexInputGeometry(deniedArena, { geometryId: 1, recipe: geometryRecipe });
    expect(() => vertexInputGeometry(deniedArena, glContext(deniedGl), 1, 1)).toThrow(/governor/);
    expect(deniedGl.uploads).toHaveLength(0);
    const expectedBytes = geometryRecipe.positions.byteLength
      + geometryRecipe.normals!.byteLength + geometryRecipe.indices!.byteLength;
    expect(denied.costs).toEqual([{ persistentGpuBytes: expectedBytes, uploadBytes: expectedBytes }]);

    const admitted = recordingGovernor();
    const gl = new FakeGl();
    const arena = createVertexInputArena(admitted.governor);
    retainVertexInputGeometry(arena, { geometryId: 1, recipe: geometryRecipe });
    vertexInputGeometry(arena, glContext(gl), 1, 1);
    expect(admitted.committed.value).toBe(1);
    expect(admitted.cancelled.value).toBe(0);
    releaseVertexInputGeometry(arena, glContext(gl), 1, 1);
    expect(admitted.released.value).toBe(1);
  });

  it("spends failed upload bandwidth and leases retained rollback handles until retry", () => {
    const clean = recordingGovernor();
    const cleanGl = new FakeGl();
    const cleanArena = createVertexInputArena(clean.governor);
    retainVertexInputGeometry(cleanArena, {
      geometryId: 1,
      recipe: recipe("clean-governor-rollback", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    cleanGl.bufferDataFailureAt = 2;
    expect(() => vertexInputGeometry(cleanArena, glContext(cleanGl), 1, 1)).toThrow(/bufferData/);
    expect(clean.cancelled.value).toBe(0);
    expect(clean.committed.value).toBe(1);
    expect(clean.released.value).toBe(1);

    const retained = recordingGovernor();
    const retainedGl = new FakeGl();
    const retainedArena = createVertexInputArena(retained.governor);
    retainVertexInputGeometry(retainedArena, {
      geometryId: 1,
      recipe: recipe("retained-governor-rollback", [0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    retainedGl.bufferDataFailureAt = 2;
    retainedGl.deleteBufferFailureAt = 1;
    expect(() => vertexInputGeometry(retainedArena, glContext(retainedGl), 1, 1)).toThrow(/bufferData/);
    expect(retained.committed.value).toBe(1);
    expect(retained.released.value).toBe(0);
    disposeVertexInputArena(retainedArena, glContext(retainedGl), 1);
    expect(retained.released.value).toBe(1);
  });

  it("governs fixed instance-buffer creation and incremental growth without double counting", () => {
    const recorded = recordingGovernor();
    const gl = new FakeGl();
    const arena = createVertexInputArena(recorded.governor);
    const allocation = createVertexInputInstanceAllocation(arena);
    prepareVertexInputInstance(arena, glContext(gl), 1, allocation, 1);
    prepareVertexInputInstance(arena, glContext(gl), 1, allocation, 3);
    expect(recorded.costs).toEqual([
      { persistentGpuBytes: 100, uploadBytes: 0 },
      { persistentGpuBytes: 200, transientPeakBytes: 400, uploadBytes: 0 },
    ]);
    expect(recorded.committed.value).toBe(2);
    releaseVertexInputInstanceAllocation(arena, glContext(gl), 1, allocation);
    expect(recorded.released.value).toBe(2);
  });

  it("denies initial instance capacity before staging or GL effects and recovers transactionally", () => {
    type InspectedInstance = {
      readonly buffers?: unknown;
      readonly capacity: number;
      readonly governedBufferCapacity: number;
      readonly instanceCount: number;
      readonly localModelsDirty: boolean;
      readonly rootPosesDirty: boolean;
      readonly rootScalesDirty: boolean;
      readonly staging: {
        readonly forceFull: boolean;
        readonly localModels: Float32Array;
        readonly ranges: Int32Array;
        readonly rootPoses: Float32Array;
        readonly rootScales: Float32Array;
      };
    };
    let deny = true;
    let committed = 0;
    const costs: RecordedGpuCost[] = [];
    const arena = createVertexInputArena({
      reserve: (cost) => {
        costs.push(cost);
        if (deny) return undefined;
        return {
          cancel: () => true,
          commit: () => {
            committed += 1;
            return { release: () => true };
          },
        };
      },
    });
    const gl = new FakeGl();
    const allocation = createVertexInputInstanceAllocation(arena);
    const resource = [...(arena as unknown as {
      readonly ownedInstances: Map<number, InspectedInstance>;
    }).ownedInstances.values()][0]!;
    const staging = resource.staging;
    const originalArrays = {
      localModels: staging.localModels,
      ranges: staging.ranges,
      rootPoses: staging.rootPoses,
      rootScales: staging.rootScales,
    };
    const originalState = {
      buffers: resource.buffers,
      capacity: resource.capacity,
      forceFull: staging.forceFull,
      governedBufferCapacity: resource.governedBufferCapacity,
      instanceCount: resource.instanceCount,
      localModelsDirty: resource.localModelsDirty,
      rootPosesDirty: resource.rootPosesDirty,
      rootScalesDirty: resource.rootScalesDirty,
    };
    const deniedCount = 2;

    expect(() => prepareVertexInputInstance(
      arena, glContext(gl), 1, allocation, deniedCount,
    )).toThrow(/governor/);
    expect(costs).toEqual([{
      persistentGpuBytes: deniedCount * 100,
      uploadBytes: 0,
    }]);
    expect(resource.staging).toBe(staging);
    expect(resource.staging.localModels).toBe(originalArrays.localModels);
    expect(resource.staging.ranges).toBe(originalArrays.ranges);
    expect(resource.staging.rootPoses).toBe(originalArrays.rootPoses);
    expect(resource.staging.rootScales).toBe(originalArrays.rootScales);
    expect({
      buffers: resource.buffers,
      capacity: resource.capacity,
      forceFull: resource.staging.forceFull,
      governedBufferCapacity: resource.governedBufferCapacity,
      instanceCount: resource.instanceCount,
      localModelsDirty: resource.localModelsDirty,
      rootPosesDirty: resource.rootPosesDirty,
      rootScalesDirty: resource.rootScalesDirty,
    }).toEqual(originalState);
    expect(gl.allocations).toHaveLength(0);
    expect(gl.uploads).toHaveLength(0);
    expect(gl.subUploads).toHaveLength(0);
    expect(gl.deletedBuffers).toHaveLength(0);
    expect(gl.events).toHaveLength(0);
    expect(gl.arrayBufferBinding).toBeNull();

    deny = false;
    const recovered = prepareVertexInputInstance(arena, glContext(gl), 1, allocation, 2);
    expect(recovered).toBe(staging);
    expect(recovered.localModels).not.toBe(originalArrays.localModels);
    expect(recovered.rootPoses).not.toBe(originalArrays.rootPoses);
    expect(recovered.rootScales).not.toBe(originalArrays.rootScales);
    expect(recovered.ranges).not.toBe(originalArrays.ranges);
    expect(recovered.localModels).toHaveLength(32);
    expect(recovered.rootPoses).toHaveLength(12);
    expect(recovered.rootScales).toHaveLength(6);
    expect(recovered.ranges).toHaveLength(4);
    expect(recovered.forceFull).toBe(true);
    expect(gl.allocations.map(({ bytes }) => bytes)).toEqual([128, 48, 24]);
    expect(committed).toBe(1);
  });

  it("keeps clean instance staging and GL state untouched across denied growth", () => {
    type InspectedInstance = {
      readonly buffers?: unknown;
      readonly capacity: number;
      readonly governedBufferCapacity: number;
      readonly instanceCount: number;
      readonly localModelsDirty: boolean;
      readonly rootPosesDirty: boolean;
      readonly rootScalesDirty: boolean;
    };
    let denyPersistent = false;
    const costs: RecordedGpuCost[] = [];
    const arena = createVertexInputArena({
      reserve: (cost) => {
        costs.push(cost);
        if (denyPersistent && cost.persistentGpuBytes !== 0) return undefined;
        return {
          cancel: () => true,
          commit: () => ({ release: () => true }),
        };
      },
    });
    const gl = new FakeGl();
    const context = glContext(gl);
    const allocation = createVertexInputInstanceAllocation(arena);
    const staging = prepareVertexInputInstance(arena, context, 1, allocation, 1);
    staging.localModels.fill(11);
    staging.rootPoses.fill(12);
    staging.rootScales.fill(13);
    uploadVertexInputInstanceLane(arena, context, 1, allocation, "localModels", 0);
    uploadVertexInputInstanceLane(arena, context, 1, allocation, "rootPoses", 0);
    uploadVertexInputInstanceLane(arena, context, 1, allocation, "rootScales", 0);
    staging.ranges.set([7, 9]);
    expect(staging.forceFull).toBe(false);

    const resource = [...(arena as unknown as {
      readonly ownedInstances: Map<number, InspectedInstance>;
    }).ownedInstances.values()][0]!;
    const arrays = {
      localModels: staging.localModels,
      ranges: staging.ranges,
      rootPoses: staging.rootPoses,
      rootScales: staging.rootScales,
    };
    const contents = {
      localModels: Array.from(staging.localModels),
      ranges: Array.from(staging.ranges),
      rootPoses: Array.from(staging.rootPoses),
      rootScales: Array.from(staging.rootScales),
    };
    const before = {
      allocations: gl.allocations.length,
      buffers: resource.buffers,
      capacity: resource.capacity,
      deletedBuffers: gl.deletedBuffers.length,
      events: gl.events.length,
      governedBufferCapacity: resource.governedBufferCapacity,
      instanceCount: resource.instanceCount,
      subUploads: gl.subUploads.length,
      uploads: gl.uploads.length,
    };
    const deniedCount = 3;
    denyPersistent = true;

    expect(() => prepareVertexInputInstance(
      arena, context, 1, allocation, deniedCount,
    )).toThrow(/governor/);
    expect(costs.at(-1)).toEqual({
      persistentGpuBytes: deniedCount * 100 - 100,
      transientPeakBytes: 400,
      uploadBytes: 0,
    });
    expect(staging.localModels).toBe(arrays.localModels);
    expect(staging.ranges).toBe(arrays.ranges);
    expect(staging.rootPoses).toBe(arrays.rootPoses);
    expect(staging.rootScales).toBe(arrays.rootScales);
    expect(Array.from(staging.localModels)).toEqual(contents.localModels);
    expect(Array.from(staging.ranges)).toEqual(contents.ranges);
    expect(Array.from(staging.rootPoses)).toEqual(contents.rootPoses);
    expect(Array.from(staging.rootScales)).toEqual(contents.rootScales);
    expect(staging.forceFull).toBe(false);
    expect(resource.localModelsDirty).toBe(false);
    expect(resource.rootPosesDirty).toBe(false);
    expect(resource.rootScalesDirty).toBe(false);
    expect({
      allocations: gl.allocations.length,
      buffers: resource.buffers,
      capacity: resource.capacity,
      deletedBuffers: gl.deletedBuffers.length,
      events: gl.events.length,
      governedBufferCapacity: resource.governedBufferCapacity,
      instanceCount: resource.instanceCount,
      subUploads: gl.subUploads.length,
      uploads: gl.uploads.length,
    }).toEqual(before);
    expect(gl.arrayBufferBinding).toBeNull();

    denyPersistent = false;
    const grown = prepareVertexInputInstance(arena, context, 1, allocation, 3);
    expect(grown).toBe(staging);
    expect(grown.localModels).not.toBe(arrays.localModels);
    expect(grown.rootPoses).not.toBe(arrays.rootPoses);
    expect(grown.rootScales).not.toBe(arrays.rootScales);
    expect(grown.ranges).not.toBe(arrays.ranges);
    expect(Array.from(grown.localModels.subarray(0, 16))).toEqual(contents.localModels);
    expect(Array.from(grown.rootPoses.subarray(0, 6))).toEqual(contents.rootPoses);
    expect(Array.from(grown.rootScales.subarray(0, 3))).toEqual(contents.rootScales);
    expect(grown.forceFull).toBe(true);
    expect(gl.allocations.slice(-3).map(({ bytes }) => bytes)).toEqual([192, 72, 36]);
    expect(gl.allocations.slice(-3).map(({ buffer }) => buffer))
      .toEqual(gl.allocations.slice(0, 3).map(({ buffer }) => buffer));
  });

  it("reuses a retained failed-growth lease across smaller and later equal growth", () => {
    const recorded = recordingGovernor();
    const gl = new FakeGl();
    const context = glContext(gl);
    const arena = createVertexInputArena(recorded.governor);
    const allocation = createVertexInputInstanceAllocation(arena);
    prepareVertexInputInstance(arena, context, 1, allocation, 1);

    gl.bufferDataFailureAt = 5;
    expect(() => prepareVertexInputInstance(arena, context, 1, allocation, 3))
      .toThrow(/bufferData/);
    delete gl.bufferDataFailureAt;

    const smaller = prepareVertexInputInstance(arena, context, 1, allocation, 2);
    expect(smaller.localModels).toHaveLength(32);
    const equalToRetained = prepareVertexInputInstance(arena, context, 1, allocation, 3);
    expect(equalToRetained.localModels).toHaveLength(48);
    expect(recorded.costs).toEqual([
      { persistentGpuBytes: 100, uploadBytes: 0 },
      { persistentGpuBytes: 200, transientPeakBytes: 400, uploadBytes: 0 },
      { persistentGpuBytes: 0, transientPeakBytes: 500, uploadBytes: 0 },
      { persistentGpuBytes: 0, transientPeakBytes: 600, uploadBytes: 0 },
    ]);
    expect(recorded.costs.every(({ persistentGpuBytes }) => persistentGpuBytes >= 0)).toBe(true);
    expect(recorded.costs.reduce((sum, cost) => sum + cost.persistentGpuBytes, 0)).toBe(300);
  });

  it("denies replacement transient peak before staging or GL mutation", () => {
    let denyTransient = false;
    const costs: RecordedGpuCost[] = [];
    const arena = createVertexInputArena({
      reserve: (cost) => {
        costs.push(cost);
        if (denyTransient && (cost.transientPeakBytes ?? 0) !== 0) return undefined;
        return {
          cancel: () => true,
          commit: () => ({ release: () => true }),
        };
      },
    });
    const gl = new FakeGl();
    const context = glContext(gl);
    const allocation = createVertexInputInstanceAllocation(arena);
    const staging = prepareVertexInputInstance(arena, context, 1, allocation, 1);
    const allocationsBefore = gl.allocations.length;
    denyTransient = true;

    expect(() => prepareVertexInputInstance(arena, context, 1, allocation, 3)).toThrow(/governor/);
    expect(costs.at(-1)).toEqual({
      persistentGpuBytes: 200,
      transientPeakBytes: 400,
      uploadBytes: 0,
    });
    expect(gl.allocations).toHaveLength(allocationsBefore);
    expect(staging.localModels).toHaveLength(16);
  });

  it("rejects unrepresentable instance layouts before governor or allocation effects", () => {
    const recorded = recordingGovernor();
    const gl = new FakeGl();
    const arena = createVertexInputArena(recorded.governor);
    const allocation = createVertexInputInstanceAllocation(arena);

    expect(() => prepareVertexInputInstance(
      arena,
      glContext(gl),
      1,
      allocation,
      0x1_0000_0000,
    )).toThrow(RangeError);
    expect(recorded.costs).toHaveLength(0);
    expect(gl.events).toHaveLength(0);
  });

  it("governs dynamic instance uploads before GL effects and spends attempted failures", () => {
    const deniedCosts: RecordedGpuCost[] = [];
    const deniedGl = new FakeGl();
    const deniedArena = createVertexInputArena({
      reserve: (cost) => {
        deniedCosts.push(cost);
        if (cost.uploadBytes !== 0) return undefined;
        return {
          cancel: () => true,
          commit: () => ({ release: () => true }),
        };
      },
    });
    const deniedAllocation = createVertexInputInstanceAllocation(deniedArena);
    prepareVertexInputInstance(deniedArena, glContext(deniedGl), 1, deniedAllocation, 1);

    expect(() => uploadVertexInputInstanceLane(
      deniedArena,
      glContext(deniedGl),
      1,
      deniedAllocation,
      "localModels",
      0,
    )).toThrow(/governor/);
    expect(deniedGl.subUploads).toHaveLength(0);
    expect(deniedCosts).toEqual([
      { persistentGpuBytes: 100, uploadBytes: 0 },
      { persistentGpuBytes: 0, uploadBytes: 64 },
    ]);

    const attempted = recordingGovernor();
    const attemptedGl = new FakeGl();
    const attemptedArena = createVertexInputArena(attempted.governor);
    const attemptedAllocation = createVertexInputInstanceAllocation(attemptedArena);
    prepareVertexInputInstance(attemptedArena, glContext(attemptedGl), 1, attemptedAllocation, 1);
    attemptedGl.bufferSubDataFailureAt = 1;

    expect(() => uploadVertexInputInstanceLane(
      attemptedArena,
      glContext(attemptedGl),
      1,
      attemptedAllocation,
      "localModels",
      0,
    )).toThrow(/bufferSubData/);
    expect(attempted.costs).toEqual([
      { persistentGpuBytes: 100, uploadBytes: 0 },
      { persistentGpuBytes: 0, uploadBytes: 64 },
    ]);
    expect(attempted.committed.value).toBe(2);
    expect(attempted.released.value).toBe(1);
    releaseVertexInputInstanceAllocation(attemptedArena, glContext(attemptedGl), 1, attemptedAllocation);
    expect(attempted.released.value).toBe(2);
  });

});
