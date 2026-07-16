import { describe, expect, it } from "vitest";
import {
  beginGltfInstanceBufferArenaFrame,
  bindGltfInstanceBuffer,
  clearGltfInstanceBufferArena,
  createGltfInstanceBufferArena,
  releaseUnusedGltfInstanceBuffers,
  type GltfInstanceBufferSource,
  type GltfInstanceBufferUploadCounters,
} from "../packages/renderer-webgl/src/gltf-instance-buffer-arena";
import { createInstanceDirtyBits } from "../packages/renderer-webgl/src/gltf/instance-changes";
import { identityMat4, type Mat4 } from "../packages/renderer-webgl/src/math/mat4";
import {
  createVertexInputArena,
  disposeVertexInputArena,
  dropVertexInputArenaContext,
  restoreVertexInputArenaContext,
  vertexInputArenaSnapshot,
} from "../packages/renderer-webgl/src/vertex-input/arena";

type Handle = { readonly serial: number };

class FakeGl {
  readonly ARRAY_BUFFER = 0x8892;
  readonly ELEMENT_ARRAY_BUFFER = 0x8893;
  readonly DYNAMIC_DRAW = 0x88e8;
  readonly deletedBuffers: Handle[] = [];
  #serial = 1;

  createBuffer = (): WebGLBuffer => ({ serial: this.#serial++ } as unknown as WebGLBuffer);
  deleteBuffer = (buffer: WebGLBuffer | null): void => {
    if (buffer !== null) this.deletedBuffers.push(buffer as unknown as Handle);
  };
  bindBuffer = (_target: number, _buffer: WebGLBuffer | null): void => {};
  bufferData = (_target: number, _data: AllowSharedBufferSource | number, _usage: number): void => {};
  bufferSubData = (
    _target: number,
    _byteOffset: number,
    _data: AllowSharedBufferSource,
    _sourceOffset?: number,
    _length?: number,
  ): void => {};
  bindVertexArray = (_vertexArray: WebGLVertexArrayObject | null): void => {};
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;

const counters = (): GltfInstanceBufferUploadCounters => ({
  localModelUploadBytes: 0,
  localModelUploadCalls: 0,
  rootPoseUploadBytes: 0,
  rootPoseUploadCalls: 0,
  rootScaleUploadBytes: 0,
  rootScaleUploadCalls: 0,
});

const bindOne = (
  arena: ReturnType<typeof createGltfInstanceBufferArena>,
  gl: FakeGl,
  generation: number,
  key: number,
  sink: GltfInstanceBufferUploadCounters,
) => bindGltfInstanceBuffer(
  arena,
  context(gl),
  generation,
  key,
  [identityMat4()],
  [1],
  [{ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
  [undefined],
  [0],
  sink,
);

const bindValues = (
  arena: ReturnType<typeof createGltfInstanceBufferArena>,
  gl: FakeGl,
  sink: GltfInstanceBufferUploadCounters,
  values: {
    readonly key?: number;
    readonly localModels?: readonly Mat4[];
    readonly localSignature?: readonly number[];
    readonly logicalIndices?: readonly number[];
    readonly rootSources?: readonly (GltfInstanceBufferSource | undefined)[];
    readonly rootTransforms?: readonly ({
      readonly position: readonly [number, number, number];
      readonly rotation: readonly [number, number, number];
      readonly scale: readonly [number, number, number];
    } | undefined)[];
  },
) => {
  const localModels = values.localModels ?? [identityMat4()];
  const count = localModels.length;
  return bindGltfInstanceBuffer(
    arena,
    context(gl),
    1,
    values.key ?? 1,
    localModels,
    values.localSignature ?? new Array<number>(count).fill(1),
    values.rootTransforms ?? new Array(count).fill(undefined),
    values.rootSources ?? new Array(count).fill(undefined),
    values.logicalIndices ?? new Array<number>(count).fill(-1),
    sink,
  );
};

describe("glTF instance-buffer arena", () => {
  it("rejects bind and prune outside an explicitly begun frame", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    expect(() => bindOne(arena, gl, 1, 1, sink)).toThrow(/frame is not active/);
    expect(() => releaseUnusedGltfInstanceBuffers(arena, context(gl), 1)).toThrow(/frame is not active/);

    beginGltfInstanceBufferArenaFrame(arena);
    bindOne(arena, gl, 1, 1, sink);
    releaseUnusedGltfInstanceBuffers(arena, context(gl), 1);
    expect(() => bindOne(arena, gl, 1, 1, sink)).toThrow(/frame is not active/);
    expect(() => releaseUnusedGltfInstanceBuffers(arena, context(gl), 1)).toThrow(/frame is not active/);

    clearGltfInstanceBufferArena(arena);
    expect(() => bindOne(arena, gl, 1, 1, sink)).toThrow(/frame is not active/);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("rejects malformed keys and parallel lanes before publishing an allocation", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    beginGltfInstanceBufferArenaFrame(arena);
    for (const key of [-1, 1.5, 0xffff_ffff]) {
      expect(() => bindValues(arena, gl, sink, { key })).toThrow(/Invalid glTF instance-buffer key/);
    }
    expect(() => bindValues(arena, gl, sink, {
      rootTransforms: [],
    })).toThrow(/root transform length/);
    expect(() => bindValues(arena, gl, sink, {
      localModels: [[...identityMat4()].slice(0, 15) as unknown as Mat4],
    })).toThrow(/does not contain 16 elements/);
    expect(() => bindValues(arena, gl, sink, {
      localModels: [identityMat4(), identityMat4()],
      localSignature: [1, 2, 3],
    })).toThrow(/local-model signature length/);
    expect(() => bindValues(arena, gl, sink, {
      logicalIndices: [0x8000_0000],
    })).toThrow(/Invalid glTF instance-buffer logical index/);
    expect(vertexInputArenaSnapshot(vertexInputs).instanceAllocationCount).toBe(0);
    releaseUnusedGltfInstanceBuffers(arena, context(gl), 1);
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("reuses a stable numeric key without redundant lane uploads", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    beginGltfInstanceBufferArenaFrame(arena);
    const first = bindOne(arena, gl, 1, 7, sink);
    const firstCounters = { ...sink };
    const second = bindOne(arena, gl, 1, 7, sink);

    expect(second).toBe(first);
    expect(sink).toEqual(firstCounters);
    expect(firstCounters).toEqual({
      localModelUploadBytes: 16 * Float32Array.BYTES_PER_ELEMENT,
      localModelUploadCalls: 1,
      rootPoseUploadBytes: 6 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 3 * Float32Array.BYTES_PER_ELEMENT,
      rootScaleUploadCalls: 1,
    });
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("uses retained Float32 staging as the ordinary-root change authority", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    const root = (positionX: number, scaleX: number) => ({
      position: [positionX, 2, 3] as const,
      rotation: [0.1, 0.2, 0.3] as const,
      scale: [scaleX, 1, 1] as const,
    });

    beginGltfInstanceBufferArenaFrame(arena);
    bindValues(arena, gl, sink, { rootTransforms: [root(1, 1)] });
    const initial = { ...sink };
    bindValues(arena, gl, sink, { rootTransforms: [root(1, 1)] });
    expect(sink).toEqual(initial);

    bindValues(arena, gl, sink, { rootTransforms: [root(2, 1)] });
    expect(sink.rootPoseUploadCalls).toBe(initial.rootPoseUploadCalls + 1);
    expect(sink.rootScaleUploadCalls).toBe(initial.rootScaleUploadCalls);

    bindValues(arena, gl, sink, { rootTransforms: [root(2, 2)] });
    expect(sink.rootPoseUploadCalls).toBe(initial.rootPoseUploadCalls + 1);
    expect(sink.rootScaleUploadCalls).toBe(initial.rootScaleUploadCalls + 1);

    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("tracks packed source lifetime once per distinct source as membership changes", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    const source = (version: number): GltfInstanceBufferSource => ({
      changes: {
        activePose: createInstanceDirtyBits(2),
        activeScale: createInstanceDirtyBits(2),
      },
      framePoseVersion: version,
      frameScaleVersion: version,
      positions: new Float32Array(6),
      rotations: new Float32Array(6),
      scales: new Float32Array(6).fill(1),
    });
    const firstSource = source(1);
    const secondSource = source(2);
    const resource = () => (arena as unknown as {
      readonly resources: Map<number, {
        readonly poseVersions: Map<GltfInstanceBufferSource, number>;
        readonly scaleVersions: Map<GltfInstanceBufferSource, number>;
        readonly sourceCounts: Map<GltfInstanceBufferSource, number>;
      }>;
    }).resources.get(1)!;

    beginGltfInstanceBufferArenaFrame(arena);
    bindValues(arena, gl, sink, {
      localModels: [identityMat4(), identityMat4()],
      logicalIndices: [0, 1],
      rootSources: [firstSource, firstSource],
    });
    expect(Array.from(resource().sourceCounts)).toEqual([[firstSource, 2]]);
    expect(resource().poseVersions.size).toBe(1);
    expect(resource().scaleVersions.size).toBe(1);

    bindValues(arena, gl, sink, {
      localModels: [identityMat4(), identityMat4()],
      logicalIndices: [0, 1],
      rootSources: [firstSource, secondSource],
    });
    expect(Array.from(resource().sourceCounts)).toEqual([[firstSource, 1], [secondSource, 1]]);

    bindValues(arena, gl, sink, {
      logicalIndices: [1],
      rootSources: [secondSource],
    });
    expect(Array.from(resource().sourceCounts)).toEqual([[secondSource, 1]]);
    expect(Array.from(resource().poseVersions)).toEqual([[secondSource, 2]]);
    expect(Array.from(resource().scaleVersions)).toEqual([[secondSource, 2]]);

    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("does not publish packed logical-index growth when vertex admission is denied", () => {
    let denyGrowth = false;
    const vertexInputs = createVertexInputArena({
      reserve: (cost) => {
        if (denyGrowth && cost.persistentGpuBytes !== 0) return undefined;
        return {
          cancel: () => true,
          commit: () => ({ release: () => true }),
        };
      },
    });
    const gl = new FakeGl();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    beginGltfInstanceBufferArenaFrame(arena);
    bindOne(arena, gl, 1, 7, sink);
    const resource = (arena as unknown as {
      readonly resources: Map<number, { readonly packedLogicalIndices: Int32Array }>;
    }).resources.get(7)!;
    const originalPackedLogicalIndices = resource.packedLogicalIndices;
    denyGrowth = true;

    expect(() => bindValues(arena, gl, sink, {
      key: 7,
      localModels: [identityMat4(), identityMat4()],
      localSignature: [1, 1],
      logicalIndices: [0, 1],
      rootTransforms: [undefined, undefined],
    })).toThrow(/governor/);
    expect(resource.packedLogicalIndices).toBe(originalPackedLogicalIndices);
    expect(resource.packedLogicalIndices).toHaveLength(1);

    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("prunes independently active IDs and retains failed-frame creations for the next prune", () => {
    const gl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    beginGltfInstanceBufferArenaFrame(arena);
    const first = bindOne(arena, gl, 1, 3, sink);
    const failedFrameOnly = bindOne(arena, gl, 1, 9, sink);
    expect(vertexInputArenaSnapshot(vertexInputs).instanceAllocationCount).toBe(2);

    beginGltfInstanceBufferArenaFrame(arena);
    expect(bindOne(arena, gl, 1, 3, sink)).toBe(first);
    releaseUnusedGltfInstanceBuffers(arena, context(gl), 1);
    expect(vertexInputArenaSnapshot(vertexInputs).instanceAllocationCount).toBe(1);

    beginGltfInstanceBufferArenaFrame(arena);
    const recreated = bindOne(arena, gl, 1, 9, sink);
    expect(recreated).not.toBe(failedFrameOnly);
    releaseUnusedGltfInstanceBuffers(arena, context(gl), 1);
    expect(vertexInputArenaSnapshot(vertexInputs).instanceAllocationCount).toBe(1);
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(gl), 1);
  });

  it("preserves logical resources across context loss and force-uploads every lane after restore", () => {
    const firstGl = new FakeGl();
    const restoredGl = new FakeGl();
    const vertexInputs = createVertexInputArena();
    const arena = createGltfInstanceBufferArena(vertexInputs);
    const sink = counters();
    beginGltfInstanceBufferArenaFrame(arena);
    const allocation = bindOne(arena, firstGl, 1, 5, sink);
    const beforeRestore = { ...sink };

    dropVertexInputArenaContext(vertexInputs);
    restoreVertexInputArenaContext(vertexInputs, 2);
    beginGltfInstanceBufferArenaFrame(arena);
    expect(bindOne(arena, restoredGl, 2, 5, sink)).toBe(allocation);
    expect(sink.localModelUploadCalls).toBe(beforeRestore.localModelUploadCalls + 1);
    expect(sink.rootPoseUploadCalls).toBe(beforeRestore.rootPoseUploadCalls + 1);
    expect(sink.rootScaleUploadCalls).toBe(beforeRestore.rootScaleUploadCalls + 1);
    expect(vertexInputArenaSnapshot(vertexInputs).instanceAllocationCount).toBe(1);
    clearGltfInstanceBufferArena(arena);
    disposeVertexInputArena(vertexInputs, context(restoredGl), 2);
  });
});
