import { describe, expect, it } from "vitest";
import {
  beginGltfInstanceBufferArenaFrame,
  bindGltfInstanceBuffer,
  clearGltfInstanceBufferArena,
  createGltfInstanceBufferArena,
  releaseUnusedGltfInstanceBuffers,
  type GltfInstanceBufferUploadCounters,
} from "../packages/renderer-webgl/src/gltf-instance-buffer-arena";
import {
  identityMat4,
  multiplyMat4,
  scaleMat4,
  translationMat4,
  type Mat4,
} from "../packages/renderer-webgl/src/math/mat4";
import {
  createVertexInputArena,
  disposeVertexInputArena,
  dropVertexInputArenaContext,
  restoreVertexInputArenaContext,
  vertexInputArenaSnapshot,
} from "../packages/renderer-webgl/src/vertex-input/arena";

type Handle = { readonly serial: number };
type Upload = {
  readonly byteOffset: number;
  readonly values: readonly number[];
};

class FakeGl {
  readonly ARRAY_BUFFER = 0x8892;
  readonly ELEMENT_ARRAY_BUFFER = 0x8893;
  readonly DYNAMIC_DRAW = 0x88e8;
  readonly deletedBuffers: Handle[] = [];
  readonly uploads: Upload[] = [];
  bufferSubDataFailure?: Error;
  #serial = 1;

  createBuffer = (): WebGLBuffer => ({ serial: this.#serial++ } as unknown as WebGLBuffer);
  deleteBuffer = (buffer: WebGLBuffer | null): void => {
    if (buffer !== null) this.deletedBuffers.push(buffer as unknown as Handle);
  };
  bindBuffer = (_target: number, _buffer: WebGLBuffer | null): void => {};
  bufferData = (_target: number, _data: AllowSharedBufferSource | number, _usage: number): void => {};
  bufferSubData = (
    _target: number,
    byteOffset: number,
    data: AllowSharedBufferSource,
    sourceOffset = 0,
    length?: number,
  ): void => {
    if (this.bufferSubDataFailure !== undefined) throw this.bufferSubDataFailure;
    const floats = data as Float32Array;
    this.uploads.push({
      byteOffset,
      values: Array.from(floats.subarray(sourceOffset, sourceOffset + (length ?? floats.length))),
    });
  };
  bindVertexArray = (_vertexArray: WebGLVertexArrayObject | null): void => {};
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const counters = (): GltfInstanceBufferUploadCounters => ({
  modelUploadBytes: 0,
  modelUploadCalls: 0,
});

const bindValues = (
  arena: ReturnType<typeof createGltfInstanceBufferArena>,
  gl: FakeGl,
  sink: GltfInstanceBufferUploadCounters,
  values: {
    readonly generation?: number;
    readonly key?: number;
    readonly localModels?: readonly Mat4[];
    readonly localSignature?: readonly number[];
    readonly localSignatureDirty?: boolean;
    readonly rootModels?: readonly Mat4[];
  } = {},
) => {
  const localModels = values.localModels ?? [identityMat4()];
  return bindGltfInstanceBuffer(
    arena,
    context(gl),
    values.generation ?? 1,
    values.key ?? 1,
    localModels,
    values.localSignature ?? new Array<number>(localModels.length).fill(1),
    values.localSignatureDirty ?? true,
    values.rootModels ?? new Array<Mat4>(localModels.length).fill(identityMat4()),
    sink,
  );
};

describe("glTF instance-buffer arena", () => {
  it("requires an explicitly active frame", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    expect(() => bindValues(arena, gl, sink)).toThrow(/frame is not active/);
    expect(() => releaseUnusedGltfInstanceBuffers(arena, context(gl), 1)).toThrow(/frame is not active/);

    beginGltfInstanceBufferArenaFrame(arena);
    bindValues(arena, gl, sink);
    releaseUnusedGltfInstanceBuffers(arena, context(gl), 1);
    expect(() => bindValues(arena, gl, sink)).toThrow(/frame is not active/);
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("rejects malformed parallel inputs before allocating", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    beginGltfInstanceBufferArenaFrame(arena);
    for (const key of [-1, 1.5, 0xffff_ffff]) {
      expect(() => bindValues(arena, gl, sink, { key })).toThrow(/Invalid glTF instance-buffer key/);
    }
    expect(() => bindValues(arena, gl, sink, { rootModels: [] })).toThrow(/root-model length/);
    expect(() => bindValues(arena, gl, sink, {
      localModels: [identityMat4(), identityMat4()],
      localSignature: [1, 2, 3],
    })).toThrow(/local-model signature length/);
    expect(vertexInputArenaSnapshot(vertexInputs).instanceAllocationCount).toBe(0);
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("uploads final root-times-local matrices and skips unchanged bindings", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    const localModels = [translationMat4([1, 2, 3]), scaleMat4([2, 3, 4])];
    const rootModels = [scaleMat4([2, 2, 2]), translationMat4([5, 6, 7])];
    beginGltfInstanceBufferArenaFrame(arena);
    const first = bindValues(arena, gl, sink, {
      key: 7,
      localModels,
      localSignature: [11, 12],
      rootModels,
    });

    expect(gl.uploads).toEqual([{
      byteOffset: 0,
      values: [...multiplyMat4(rootModels[0]!, localModels[0]!), ...multiplyMat4(rootModels[1]!, localModels[1]!)],
    }]);
    expect(sink).toEqual({ modelUploadBytes: 128, modelUploadCalls: 1 });
    expect(bindValues(arena, gl, sink, {
      key: 7,
      localModels,
      localSignature: [11, 12],
      rootModels,
    })).toBe(first);
    expect(gl.uploads).toHaveLength(1);
    expect(sink).toEqual({ modelUploadBytes: 128, modelUploadCalls: 1 });
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("coalesces changed model ranges and detects in-place root mutation", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    const roots = [identityMat4(), identityMat4(), identityMat4()];
    const locals = [identityMat4(), identityMat4(), identityMat4()];
    beginGltfInstanceBufferArenaFrame(arena);
    bindValues(arena, gl, sink, { localModels: locals, localSignature: [1, 1, 1], rootModels: roots });
    roots[1]![12] = 4;
    bindValues(arena, gl, sink, { localModels: locals, localSignature: [1, 1, 1], rootModels: roots });
    expect(gl.uploads.at(-1)).toEqual({ byteOffset: 64, values: [...roots[1]!] });
    expect(sink).toEqual({ modelUploadBytes: 256, modelUploadCalls: 2 });

    bindValues(arena, gl, sink, {
      localModels: [locals[0]!, scaleMat4([2, 2, 2]), translationMat4([1, 0, 0])],
      localSignature: [1, 2, 2],
      rootModels: roots,
    });
    expect(gl.uploads.at(-1)?.byteOffset).toBe(64);
    expect(gl.uploads.at(-1)?.values).toHaveLength(32);
    expect(sink).toEqual({ modelUploadBytes: 384, modelUploadCalls: 3 });
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("force-uploads the model lane after a failed upload and after context restore", () => {
    const firstGl = new FakeGl();
    const restoredGl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    beginGltfInstanceBufferArenaFrame(arena);
    firstGl.bufferSubDataFailure = new Error("upload failed");
    expect(() => bindValues(arena, firstGl, sink, { key: 5 })).toThrow(firstGl.bufferSubDataFailure);
    expect(sink).toEqual({ modelUploadBytes: 0, modelUploadCalls: 0 });
    delete firstGl.bufferSubDataFailure;
    const allocation = bindValues(arena, firstGl, sink, { key: 5 });
    expect(sink).toEqual({ modelUploadBytes: 64, modelUploadCalls: 1 });

    dropVertexInputArenaContext(vertexInputs);
    restoreVertexInputArenaContext(vertexInputs, 2);
    beginGltfInstanceBufferArenaFrame(arena);
    expect(bindValues(arena, restoredGl, sink, { generation: 2, key: 5 })).toBe(allocation);
    expect(sink).toEqual({ modelUploadBytes: 128, modelUploadCalls: 2 });
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(restoredGl), 2);
  });

  it("prunes independently active keys", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    beginGltfInstanceBufferArenaFrame(arena);
    const first = bindValues(arena, gl, sink, { key: 3 });
    const removed = bindValues(arena, gl, sink, { key: 9 });
    expect(vertexInputArenaSnapshot(vertexInputs).instanceAllocationCount).toBe(2);

    beginGltfInstanceBufferArenaFrame(arena);
    expect(bindValues(arena, gl, sink, { key: 3 })).toBe(first);
    releaseUnusedGltfInstanceBuffers(arena, context(gl), 1);
    expect(vertexInputArenaSnapshot(vertexInputs).instanceAllocationCount).toBe(1);

    beginGltfInstanceBufferArenaFrame(arena);
    expect(bindValues(arena, gl, sink, { key: 9 })).not.toBe(removed);
    releaseUnusedGltfInstanceBuffers(arena, context(gl), 1);
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });
});
