import { describe, expect, it } from "vitest";
import { perspectiveCamera } from "../packages/renderer-core/src/camera";
import { projectionMat4, viewMat4 } from "../packages/renderer-webgl/src/math/mat4";
import {
  bindClusteredLights,
  clusteredLightArenaSnapshot,
  clusteredLightTextureUnits,
  configureClusteredLightArena,
  createClusteredLightArena,
  dropClusteredLightContext,
  releaseClusteredLightContextHandles,
  type ClusteredLightGpuGovernor,
  type ClusteredLightGpuLease,
} from "../packages/renderer-webgl/src/webgl/clustered-light-arena";
import { GpuUploadCapacityError } from "../packages/renderer-webgl/src/gpu-upload-capacity-error";
import type { SurfacePointLight } from "../packages/renderer-webgl/src/webgl/lights";
import { createProgramArena } from "../packages/renderer-webgl/src/webgl/program-arena";

type Handle = { readonly serial: number };
type Call = { readonly args: readonly unknown[]; readonly name: string };

class FakeGl {
  readonly CLAMP_TO_EDGE = 0x812f;
  readonly FLOAT = 0x1406;
  readonly NEAREST = 0x2600;
  readonly R32UI = 0x8236;
  readonly RED_INTEGER = 0x8d94;
  readonly RG32UI = 0x823c;
  readonly RGBA = 0x1908;
  readonly RGBA32F = 0x8814;
  readonly RG_INTEGER = 0x8228;
  readonly TEXTURE0 = 0x84c0;
  readonly TEXTURE_2D = 0x0de1;
  readonly TEXTURE_MAG_FILTER = 0x2800;
  readonly TEXTURE_MIN_FILTER = 0x2801;
  readonly TEXTURE_WRAP_S = 0x2802;
  readonly TEXTURE_WRAP_T = 0x2803;
  readonly UNSIGNED_INT = 0x1405;
  readonly calls: Call[] = [];
  createFailure = -1;
  readonly deleteFailures = new Set<number>();
  texImageFailure = -1;
  texSubImageFailure = -1;
  #creates = 0;
  #serial = 1;
  #texImages = 0;
  #texSubImages = 0;

  #record(name: string, ...args: readonly unknown[]): void { this.calls.push({ args, name }); }
  activeTexture = (...args: readonly unknown[]): void => this.#record("activeTexture", ...args);
  bindTexture = (...args: readonly unknown[]): void => this.#record("bindTexture", ...args);
  createTexture = (): WebGLTexture | null => {
    const index = this.#creates++;
    if (index === this.createFailure) return null;
    const value = { serial: this.#serial++ } as Handle;
    this.#record("createTexture", value);
    return value as unknown as WebGLTexture;
  };
  deleteTexture = (texture: WebGLTexture): void => {
    this.#record("deleteTexture", texture);
    const serial = (texture as unknown as Handle).serial;
    if (!this.deleteFailures.delete(serial)) return;
    throw new Error(`deleteTexture failure ${serial}`);
  };
  getUniformLocation = (_program: WebGLProgram, name: string): WebGLUniformLocation =>
    ({ name } as unknown as WebGLUniformLocation);
  texImage2D = (...args: readonly unknown[]): void => {
    const index = this.#texImages++;
    this.#record("texImage2D", ...args);
    if (index === this.texImageFailure) throw new Error(`texImage failure ${index}`);
  };
  texParameteri = (...args: readonly unknown[]): void => this.#record("texParameteri", ...args);
  texSubImage2D = (...args: readonly unknown[]): void => {
    const index = this.#texSubImages++;
    this.#record("texSubImage2D", ...args);
    if (index === this.texSubImageFailure) throw new Error(`texSubImage failure ${index}`);
  };
  uniform1i = (...args: readonly unknown[]): void => this.#record("uniform1i", ...args);
  uniform2fv = (...args: readonly unknown[]): void => this.#record("uniform2fv", ...args);
  uniform2f = (...args: readonly unknown[]): void => this.#record("uniform2f", ...args);
  uniform4fv = (...args: readonly unknown[]): void => this.#record("uniform4fv", ...args);
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const calls = (gl: FakeGl, name: string): readonly Call[] => gl.calls.filter((call) => call.name === name);
const program = {} as WebGLProgram;
const camera = perspectiveCamera({ far: 100, fovY: 1, near: 0.1, position: [0, 0, 0], rotation: [0, 0, 0] });
const projection = projectionMat4(camera, 320, 240);
const view = viewMat4(camera);
const lights: readonly SurfacePointLight[] = [{
  color: [10, 20, 30, 1], kind: "point", position: [0, 0, -3], range: 2,
}];

const bind = (gl: FakeGl, arena: ReturnType<typeof createClusteredLightArena>, frame = 0): void => {
  bindClusteredLights(
    arena, createProgramArena(context(gl)), program, lights, projection, view, 320, 240, frame,
  );
};

const bindLights = (
  gl: FakeGl,
  arena: ReturnType<typeof createClusteredLightArena>,
  values: readonly SurfacePointLight[],
  frame: number,
): void => {
  bindClusteredLights(
    arena, createProgramArena(context(gl)), program, values, projection, view, 320, 240, frame,
  );
};

type ScratchView = {
  readonly bounds: Int32Array;
  readonly counts: Uint32Array;
  readonly indices: Uint32Array;
  readonly offsetsAndCounts: Uint32Array;
};
const scratchOf = (arena: ReturnType<typeof createClusteredLightArena>): ScratchView =>
  (arena as unknown as { readonly buildScratch: ScratchView }).buildScratch;
const copiedScratch = (scratch: ScratchView): ScratchView => ({
  bounds: scratch.bounds.slice(),
  counts: scratch.counts.slice(),
  indices: scratch.indices.slice(),
  offsetsAndCounts: scratch.offsetsAndCounts.slice(),
});

const recordingGovernor = (denied = false): {
  readonly cancelled: { value: number };
  readonly costs: Array<Record<string, number>>;
  readonly denyCpu: { value: boolean };
  readonly denyTransient: { value: boolean };
  readonly denyUploads: { value: boolean };
  readonly governor: ClusteredLightGpuGovernor;
  readonly released: { value: number };
  readonly replacements: { value: number };
} => {
  const cancelled = { value: 0 };
  const released = { value: 0 };
  const replacements = { value: 0 };
  const costs: Array<Record<string, number>> = [];
  const denyUploads = { value: false };
  const denyCpu = { value: false };
  const denyTransient = { value: false };
  const lease = (): ClusteredLightGpuLease => {
    let active = true;
    return { release: () => {
      if (!active) return false;
      active = false; released.value += 1; return true;
    } };
  };
  const reservation = (previous?: ClusteredLightGpuLease) => ({
    cancel: () => { cancelled.value += 1; return true; },
    commit: () => { previous?.release(); return lease(); },
  });
  return {
    cancelled,
    costs,
    denyCpu,
    denyTransient,
    denyUploads,
    governor: {
      replace: (previous, cost) => {
        replacements.value += 1; costs.push({ ...cost });
        return denied || (denyCpu.value && cost.cpuDecodedBytes !== undefined)
          || (denyTransient.value && cost.transientPeakBytes !== undefined)
          ? undefined
          : reservation(previous);
      },
      reserve: (cost) => {
        costs.push({ ...cost });
        if (
          denied
          || (denyCpu.value && cost.cpuDecodedBytes !== undefined)
          || (denyTransient.value && cost.transientPeakBytes !== undefined)
        ) return undefined;
        if (denyUploads.value && cost.uploadBytes !== undefined) {
          return { reason: "upload-capacity" };
        }
        return reservation();
      },
    },
    released,
    replacements,
  };
};

describe("clustered light arena", () => {
  it("owns top-three unit capability and allocates nothing for an empty light set", () => {
    const gl = new FakeGl();
    const arena = createClusteredLightArena(context(gl));
    const programs = createProgramArena(context(gl));
    configureClusteredLightArena(arena, 7, 1024);
    expect(clusteredLightTextureUnits(arena)).toEqual({ grid: -1, indices: -1, lights: -1 });
    bindClusteredLights(arena, programs, program, [], projection, view, 320, 240, 0);
    expect(calls(gl, "createTexture")).toHaveLength(0);
    expect(() => bindClusteredLights(
      arena, programs, program, lights, projection, view, 320, 240, 0,
    )).toThrow(/requires three fragment texture units/);
    configureClusteredLightArena(arena, 8, 1024);
    expect(clusteredLightTextureUnits(arena)).toEqual({ grid: 5, indices: 6, lights: 7 });
    configureClusteredLightArena(arena, 16, 1024);
    expect(clusteredLightTextureUnits(arena)).toEqual({ grid: 13, indices: 14, lights: 15 });
  });

  it("uploads exact integer/float textures once and reuses the sequential triple", () => {
    const gl = new FakeGl();
    const arena = createClusteredLightArena(context(gl));
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    expect(calls(gl, "createTexture")).toHaveLength(3);
    expect(calls(gl, "texImage2D").map((call) => call.args[2])).toEqual([
      gl.RG32UI, gl.R32UI, gl.RGBA32F,
    ]);
    expect(calls(gl, "texParameteri")).toHaveLength(12);
    const uploads = calls(gl, "texImage2D").length + calls(gl, "texSubImage2D").length;
    bind(gl, arena, 1);
    expect(calls(gl, "createTexture")).toHaveLength(3);
    expect(calls(gl, "texImage2D").length + calls(gl, "texSubImage2D").length).toBe(uploads);
    expect(clusteredLightArenaSnapshot(arena)).toMatchObject({ ownedTextureCount: 3, resourceCount: 1 });
  });

  it("distinguishes omitted range from explicit zero and refreshes the shared triple", () => {
    const gl = new FakeGl();
    const arena = createClusteredLightArena(context(gl));
    configureClusteredLightArena(arena, 8, 1024);
    const unbounded: SurfacePointLight = { color: [10, 10, 10, 1], kind: "point", position: [0, 0, -3] };
    bindLights(gl, arena, [unbounded], 0);
    const uploads = calls(gl, "texImage2D").length + calls(gl, "texSubImage2D").length;
    bindLights(gl, arena, [{ ...unbounded, range: 0 }], 0);
    expect(calls(gl, "texImage2D").length + calls(gl, "texSubImage2D").length).toBeGreaterThan(uploads);
    expect(calls(gl, "createTexture")).toHaveLength(3);
  });

  it("reuses one triple across 256 differing sequential same-frame light sets", () => {
    const gl = new FakeGl();
    const arena = createClusteredLightArena(context(gl));
    configureClusteredLightArena(arena, 8, 1024);
    bindLights(gl, arena, [{ color: [1, 2, 3, 1], kind: "point", position: [0, 0, -3] }], 7);
    const scratch = scratchOf(arena);
    const resource = (arena as unknown as { readonly resource: {
      readonly indexData: Uint32Array;
      readonly lightData: Float32Array;
      readonly lightSnapshot: Float64Array;
    } }).resource;
    for (let draw = 1; draw < 256; draw += 1) {
      bindLights(gl, arena, [{
        color: [draw + 1, 2, 3, 1],
        kind: "point",
        position: [draw * 0.01, 0, -3],
      }], 7);
    }
    expect(calls(gl, "createTexture")).toHaveLength(3);
    expect(scratchOf(arena)).toBe(scratch);
    const retained = (arena as unknown as { readonly resource: typeof resource }).resource;
    expect(retained.indexData).toBe(resource.indexData);
    expect(retained.lightData).toBe(resource.lightData);
    expect(retained.lightSnapshot).toBe(resource.lightSnapshot);
    expect(clusteredLightArenaSnapshot(arena)).toMatchObject({ ownedTextureCount: 3, resourceCount: 1 });
  });

  it("rolls back a partial triple and recreates cleanly", () => {
    for (const failure of [0, 1, 2]) {
      const gl = new FakeGl();
      const arena = createClusteredLightArena(context(gl));
      configureClusteredLightArena(arena, 8, 1024);
      gl.createFailure = failure;
      expect(() => bind(gl, arena)).toThrow(/texture creation failed/);
      expect(calls(gl, "deleteTexture")).toHaveLength(failure);
      expect(clusteredLightArenaSnapshot(arena)).toMatchObject({ ownedTextureCount: 0, resourceCount: 0 });
      gl.createFailure = -1;
      bind(gl, arena, 1);
      expect(clusteredLightArenaSnapshot(arena)).toMatchObject({ ownedTextureCount: 3, resourceCount: 1 });
    }
  });

  it("retains rollback handles whose deletion throws for a later release retry", () => {
    const gl = new FakeGl();
    const arena = createClusteredLightArena(context(gl));
    configureClusteredLightArena(arena, 8, 1024);
    gl.createFailure = 2;
    gl.deleteFailures.add(1);
    expect(() => bind(gl, arena)).toThrow(/texture creation failed/);
    expect(clusteredLightArenaSnapshot(arena)).toMatchObject({ ownedTextureCount: 1, resourceCount: 0 });
    releaseClusteredLightContextHandles(arena);
    expect(clusteredLightArenaSnapshot(arena).ownedTextureCount).toBe(0);
    expect(calls(gl, "deleteTexture")).toHaveLength(3);
  });

  it("retries allocation after grid, index, or light texImage failure without poisoned capacity", () => {
    for (const failure of [0, 1, 2]) {
      const gl = new FakeGl();
      const arena = createClusteredLightArena(context(gl));
      configureClusteredLightArena(arena, 8, 1024);
      gl.texImageFailure = failure;
      expect(() => bind(gl, arena)).toThrow(`texImage failure ${failure}`);
      gl.texImageFailure = -1;
      const callsBeforeRetry = gl.calls.length;
      bind(gl, arena, 1);
      const retry = gl.calls.slice(callsBeforeRetry);
      expect(
        retry.some((call) => call.name === "texImage2D" && call.args[2] === [gl.RG32UI, gl.R32UI, gl.RGBA32F][failure]),
        `failure ${failure}`,
      ).toBe(true);
      expect(clusteredLightArenaSnapshot(arena)).toMatchObject({ ownedTextureCount: 3, resourceCount: 1 });
    }
  });

  it("deletes active handles once while lost-context drop is GL-free", () => {
    const gl = new FakeGl();
    const arena = createClusteredLightArena(context(gl));
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    releaseClusteredLightContextHandles(arena);
    expect(calls(gl, "deleteTexture")).toHaveLength(3);
    releaseClusteredLightContextHandles(arena);
    expect(calls(gl, "deleteTexture")).toHaveLength(3);
    bind(gl, arena, 1);
    const deletes = calls(gl, "deleteTexture").length;
    dropClusteredLightContext(arena);
    expect(calls(gl, "deleteTexture")).toHaveLength(deletes);
    expect(clusteredLightArenaSnapshot(arena)).toMatchObject({ ownedTextureCount: 0, resourceCount: 0 });
  });

  it("retains only active-release handles whose deletion throws and retries them", () => {
    const gl = new FakeGl();
    const arena = createClusteredLightArena(context(gl));
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    gl.deleteFailures.add(2);
    expect(() => releaseClusteredLightContextHandles(arena)).toThrow(/deleteTexture failure 2/);
    expect(clusteredLightArenaSnapshot(arena)).toMatchObject({ ownedTextureCount: 1, resourceCount: 1 });
    releaseClusteredLightContextHandles(arena);
    expect(clusteredLightArenaSnapshot(arena).ownedTextureCount).toBe(0);
    expect(calls(gl, "deleteTexture")).toHaveLength(4);
  });

  it("denies the initial clustered allocation before any GL side effect", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor(true);
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 1024);
    expect(() => bind(gl, arena)).toThrow(/governor/);
    expect(calls(gl, "createTexture")).toHaveLength(0);
    expect(calls(gl, "texImage2D")).toHaveLength(0);
    expect(scratchOf(arena)).toMatchObject({
      bounds: { byteLength: 0 },
      counts: { byteLength: 0 },
      indices: { byteLength: 0 },
      offsetsAndCounts: { byteLength: 0 },
    });
    expect(recorded.costs).toEqual([expect.objectContaining({
      cpuDecodedBytes: expect.any(Number),
      transientPeakBytes: expect.any(Number),
    })]);
  });

  it("leases storage, charges upload-only refreshes, and replaces resized grids", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    const initialStorage = recorded.costs.find((cost) => cost.persistentGpuBytes !== undefined)!;
    const initialUpload = recorded.costs.find((cost) => cost.uploadBytes !== undefined)!;
    expect(initialStorage.persistentGpuBytes).toBe(initialStorage.transientPeakBytes);
    expect(initialUpload.uploadBytes).toBe(initialStorage.persistentGpuBytes);

    bindLights(gl, arena, [{ ...lights[0]!, color: [11, 20, 30, 1] }], 1);
    expect(recorded.costs.at(-1)).toEqual({ uploadBytes: initialUpload.uploadBytes });

    bindClusteredLights(
      arena, createProgramArena(context(gl)), program, lights, projection, view, 640, 240, 2,
    );
    expect(recorded.replacements.value).toBeGreaterThanOrEqual(2);
    releaseClusteredLightContextHandles(arena);
    expect(recorded.released.value).toBeGreaterThan(0);
  });

  it("keeps CPU growth transactional and recovers after capacity returns", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    const callsBefore = gl.calls.length;
    const releasesBefore = recorded.released.value;
    recorded.denyCpu.value = true;

    expect(() => bindClusteredLights(
      arena, createProgramArena(context(gl)), program, lights, projection, view, 640, 240, 1,
    )).toThrow(/CPU update denied/);
    expect(gl.calls).toHaveLength(callsBefore);
    expect(recorded.released.value).toBe(releasesBefore);

    recorded.denyCpu.value = false;
    bindClusteredLights(
      arena, createProgramArena(context(gl)), program, lights, projection, view, 640, 240, 2,
    );
    expect(gl.calls.length).toBeGreaterThan(callsBefore);
    releaseClusteredLightContextHandles(arena);
  });

  it("denies the full side-by-side CPU peak before allocating or mutating scratch", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    const scratch = scratchOf(arena);
    const before = copiedScratch(scratch);
    const callsBefore = gl.calls.length;
    recorded.denyTransient.value = true;

    expect(() => bindClusteredLights(
      arena, createProgramArena(context(gl)), program, lights, projection, view, 640, 240, 1,
    )).toThrow(/CPU update denied/);

    expect(gl.calls).toHaveLength(callsBefore);
    expect(scratchOf(arena)).toBe(scratch);
    expect(copiedScratch(scratchOf(arena))).toEqual(before);
    expect(recorded.costs.at(-1)?.transientPeakBytes).toBeGreaterThan(
      (arena as unknown as { readonly cpuBytes: number }).cpuBytes,
    );
  });

  it("keeps published scratch byte-for-byte unchanged after a GPU upload fault", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    const scratch = scratchOf(arena);
    const before = copiedScratch(scratch);
    gl.texSubImageFailure = 0;

    expect(() => bindLights(
      gl,
      arena,
      [{ ...lights[0]!, color: [12, 20, 30, 1] }],
      1,
    )).toThrow(/texSubImage failure/);

    expect(scratchOf(arena)).toBe(scratch);
    expect(copiedScratch(scratchOf(arena))).toEqual(before);
  });

  it("poisons partial GPU generations and completely restores the old input after later upload faults", () => {
    for (const failedUpload of [1, 2]) {
      const gl = new FakeGl();
      const arena = createClusteredLightArena(context(gl));
      configureClusteredLightArena(arena, 8, 1024);
      bind(gl, arena);
      const changed = [{ ...lights[0]!, position: [1, 0, -3] as const }];
      gl.texSubImageFailure = calls(gl, "texSubImage2D").length + failedUpload;

      expect(() => bindLights(gl, arena, changed, 1)).toThrow(/texSubImage failure/);
      gl.texSubImageFailure = -1;
      const uploadsBeforeRecovery = calls(gl, "texSubImage2D").length;

      bind(gl, arena, 2);
      expect(calls(gl, "texSubImage2D")).toHaveLength(uploadsBeforeRecovery + 3);
      bind(gl, arena, 3);
      expect(calls(gl, "texSubImage2D")).toHaveLength(uploadsBeforeRecovery + 3);
    }
  });

  it("charges old plus new GPU storage as the replacement transient peak", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    const oldStorage = recorded.costs.find((cost) => cost.persistentGpuBytes !== undefined)!;
    const costCount = recorded.costs.length;

    bindClusteredLights(
      arena, createProgramArena(context(gl)), program, lights, projection, view, 640, 240, 1,
    );

    const replacement = recorded.costs.slice(costCount)
      .find((cost) => cost.persistentGpuBytes !== undefined)!;
    expect(replacement.transientPeakBytes).toBe(
      Number(oldStorage.persistentGpuBytes) + Number(replacement.persistentGpuBytes),
    );
    releaseClusteredLightContextHandles(arena);
  });

  it("accounts padded index rows exactly for a non-power-of-two texture limit", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 17);
    const twoLights = [
      { ...lights[0]!, range: 100 },
      { ...lights[0]!, position: [0.1, 0, -3] as const, range: 100 },
    ];

    bindClusteredLights(
      arena, createProgramArena(context(gl)), program, twoLights, projection, view, 64, 64, 0,
    );

    const state = arena as unknown as {
      readonly buildScratch: ScratchView;
      readonly cpuBytes: number;
      readonly resource: {
        readonly indexData: Uint32Array;
        readonly lightData: Float32Array;
        readonly lightSnapshot: Float64Array;
        readonly projection: Float64Array;
        readonly view: Float64Array;
      };
    };
    expect(state.resource.indexData.length % 17).toBe(0);
    const expected = Object.values(state.buildScratch)
      .reduce((bytes, value) => bytes + value.byteLength, 0)
      + state.resource.indexData.byteLength
      + state.resource.lightData.byteLength
      + state.resource.lightSnapshot.byteLength
      + state.resource.projection.byteLength
      + state.resource.view.byteLength;
    expect(state.cpuBytes).toBe(expected);
    releaseClusteredLightContextHandles(arena);
  });

  it("cancels an admitted storage replacement when upload admission denies before GL", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    const callsBefore = gl.calls.length;
    const createsBefore = calls(gl, "createTexture").length;
    const releasesBefore = recorded.released.value;
    const cancelsBefore = recorded.cancelled.value;
    recorded.denyUploads.value = true;

    expect(() => bindClusteredLights(
      arena, createProgramArena(context(gl)), program, lights, projection, view, 640, 240, 1,
    )).toThrow(GpuUploadCapacityError);

    expect(recorded.replacements.value).toBeGreaterThanOrEqual(2);
    expect(recorded.cancelled.value).toBeGreaterThanOrEqual(cancelsBefore + 2);
    expect(recorded.released.value).toBe(releasesBefore);
    expect(gl.calls).toHaveLength(callsBefore);
    expect(calls(gl, "createTexture")).toHaveLength(createsBefore);
    expect(clusteredLightArenaSnapshot(arena)).toMatchObject({
      ownedTextureCount: 3,
      resourceCount: 1,
    });

    recorded.denyUploads.value = false;
    bindClusteredLights(
      arena, createProgramArena(context(gl)), program, lights, projection, view, 640, 240, 2,
    );
    expect(recorded.replacements.value).toBeGreaterThanOrEqual(4);
    expect(calls(gl, "createTexture")).toHaveLength(createsBefore);
    releaseClusteredLightContextHandles(arena);
  });

  it("does not retry a clustered-light upload that cannot fit an empty frame", () => {
    const gl = new FakeGl();
    const arena = createClusteredLightArena(context(gl), {
      replace: () => undefined,
      reserve: (cost) => cost.uploadBytes === undefined
        ? {
            cancel: () => true,
            commit: () => ({ release: () => true }),
          }
        : {
            permanent: true,
            reason: `${cost.uploadBytes} upload bytes exceed the per-frame limit 1`,
          },
    });
    configureClusteredLightArena(arena, 8, 1024);

    let failure: unknown;
    try {
      bind(gl, arena);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(GpuUploadCapacityError);
    expect((failure as Error).message).toMatch(/upload bytes exceed the per-frame limit 1/);
    expect(calls(gl, "createTexture")).toHaveLength(0);
  });

  it("keeps a conservative lease across upload and deletion failures", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 1024);
    gl.texImageFailure = 1;
    expect(() => bind(gl, arena)).toThrow(/texImage failure/);
    expect(recorded.cancelled.value).toBeGreaterThanOrEqual(1);
    expect(clusteredLightArenaSnapshot(arena).resourceCount).toBe(1);
    expect((arena as unknown as { readonly cpuBytes: number }).cpuBytes).toBeGreaterThan(0);
    expect((arena as unknown as { readonly cpuLease?: unknown }).cpuLease).toBeDefined();
    gl.texImageFailure = -1;
    bind(gl, arena, 1);
    expect(recorded.replacements.value).toBeGreaterThanOrEqual(1);

    const releasesBeforeDelete = recorded.released.value;
    gl.deleteFailures.add(1);
    expect(() => releaseClusteredLightContextHandles(arena)).toThrow(/deleteTexture failure/);
    expect(recorded.released.value).toBe(releasesBeforeDelete);
    releaseClusteredLightContextHandles(arena);
    expect(recorded.released.value).toBe(releasesBeforeDelete + 2);
  });

  it("spends upload bandwidth when a subimage driver call fails", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createClusteredLightArena(context(gl), recorded.governor);
    configureClusteredLightArena(arena, 8, 1024);
    bind(gl, arena);
    const releasesBefore = recorded.released.value;
    const cancelsBefore = recorded.cancelled.value;
    gl.texSubImageFailure = 0;

    expect(() => bindLights(
      gl,
      arena,
      [{ ...lights[0]!, color: [12, 20, 30, 1] }],
      1,
    )).toThrow(/texSubImage failure/);

    expect(recorded.costs.at(-1)).toMatchObject({ uploadBytes: expect.any(Number) });
    expect(recorded.released.value).toBe(releasesBefore + 1);
    expect(recorded.cancelled.value).toBeGreaterThan(cancelsBefore);
    releaseClusteredLightContextHandles(arena);
  });
});
