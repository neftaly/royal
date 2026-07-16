import { describe, expect, it } from "vitest";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture/sources";
import {
  bindSurfaceIbl,
  consumeIblTextureDiagnostics,
  consumeIblTextureFrameWake,
  createIblTextureArena,
  dropIblTextureContext,
  ensureGltfIblSpecularTexture,
  ensureStudioEnvironmentSpecularTexture,
  iblTextureArenaSnapshot,
  markGltfIblSpecularTextureDirty,
  releaseGltfIblSpecularTexture,
  releaseIblTextureContextHandles,
  type IblTextureGpuGovernor,
  wakeIblTextureDurablePressure,
} from "../packages/renderer-webgl/src/webgl/ibl-texture-arena";
import { IBL_BRDF_LUT_BYTES } from "../packages/renderer-webgl/src/webgl/ibl-brdf-lut";
import {
  STUDIO_ENVIRONMENT_SPECULAR_GPU_BYTES,
  STUDIO_ENVIRONMENT_SPECULAR_UPLOAD_BYTES,
} from "../packages/renderer-webgl/src/webgl/studio-environment";
import type { SurfaceImageBasedLightSpecular, SurfaceLightSet } from "../packages/renderer-webgl/src/webgl/lights";
import { createProgramArena } from "../packages/renderer-webgl/src/webgl/program-arena";

type Handle = { readonly serial: number };
type Call = { readonly args: readonly unknown[]; readonly name: string };

class FakeGl {
  readonly CLAMP_TO_EDGE = 0x812f;
  readonly FLOAT = 0x1406;
  readonly LINEAR = 0x2601;
  readonly LINEAR_MIPMAP_LINEAR = 0x2703;
  readonly MAX_TEXTURE_IMAGE_UNITS = 0x8872;
  readonly RGB = 0x1907;
  readonly RGB9_E5 = 0x8c3d;
  readonly RGBA = 0x1908;
  readonly RGBA8 = 0x8058;
  readonly TEXTURE0 = 0x84c0;
  readonly TEXTURE_2D = 0x0de1;
  readonly TEXTURE_CUBE_MAP = 0x8513;
  readonly TEXTURE_CUBE_MAP_POSITIVE_X = 0x8515;
  readonly TEXTURE_MAG_FILTER = 0x2800;
  readonly TEXTURE_MAX_LEVEL = 0x813d;
  readonly TEXTURE_MIN_FILTER = 0x2801;
  readonly TEXTURE_WRAP_S = 0x2802;
  readonly TEXTURE_WRAP_T = 0x2803;
  readonly TEXTURE_WRAP_R = 0x8072;
  readonly UNPACK_ALIGNMENT = 0x0cf5;
  readonly UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243;
  readonly UNPACK_FLIP_Y_WEBGL = 0x9240;
  readonly UNPACK_IMAGE_HEIGHT = 0x806e;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
  readonly UNPACK_ROW_LENGTH = 0x0cf2;
  readonly UNPACK_SKIP_IMAGES = 0x806d;
  readonly UNPACK_SKIP_PIXELS = 0x0cf4;
  readonly UNPACK_SKIP_ROWS = 0x0cf3;
  readonly UNSIGNED_BYTE = 0x1401;
  readonly calls: Call[] = [];
  readonly deleteFailures = new Set<number>();
  failCreateOnce = false;
  failTexImageOnce = false;
  #serial = 1;
  constructor(readonly maxTextureImageUnits = 16) {}
  #record(name: string, ...args: readonly unknown[]): void { this.calls.push({ args, name }); }
  activeTexture = (...args: readonly unknown[]): void => this.#record("activeTexture", ...args);
  bindTexture = (...args: readonly unknown[]): void => this.#record("bindTexture", ...args);
  createTexture = (): WebGLTexture | null => {
    if (this.failCreateOnce) {
      this.failCreateOnce = false;
      return null;
    }
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
  getParameter = (parameter: number): unknown =>
    parameter === this.MAX_TEXTURE_IMAGE_UNITS ? this.maxTextureImageUnits : undefined;
  pixelStorei = (...args: readonly unknown[]): void => this.#record("pixelStorei", ...args);
  texImage2D = (...args: readonly unknown[]): void => {
    this.#record("texImage2D", ...args);
    if (this.failTexImageOnce) {
      this.failTexImageOnce = false;
      throw new Error("upload failed");
    }
  };
  texParameteri = (...args: readonly unknown[]): void => this.#record("texParameteri", ...args);
  uniform1i = (...args: readonly unknown[]): void => this.#record("uniform1i", ...args);
  uniform4fv = (...args: readonly unknown[]): void => this.#record("uniform4fv", ...args);
  uniformMatrix4fv = (...args: readonly unknown[]): void => this.#record("uniformMatrix4fv", ...args);
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const calls = (gl: FakeGl, name: string): readonly Call[] => gl.calls.filter((call) => call.name === name);
const uniform1iValues = (gl: FakeGl, name: string): readonly unknown[] =>
  calls(gl, "uniform1i")
    .filter((call) => (call.args[0] as { readonly name?: string } | undefined)?.name === name)
    .map((call) => call.args[1]);
const uniform4fvValues = (gl: FakeGl, name: string): readonly unknown[] =>
  calls(gl, "uniform4fv")
    .filter((call) => (call.args[0] as { readonly name?: string } | undefined)?.name === name)
    .map((call) => call.args[1]);
const source = (size: number, seed = 1): LoadedTextureSource => ({
  data: new Uint8Array(size * size * 4).fill(seed), height: size, kind: "rgba-texture", width: size,
});
const keys = Array.from({ length: 6 }, (_unused, index) => `face-${index}`);
const specular: SurfaceImageBasedLightSpecular = {
  encoding: "linear", imageLoadKeys: [keys], imageSize: 4, key: "ibl:test",
};
const completeSources = (seed = 1): Map<string, LoadedTextureSource> =>
  new Map(keys.map((key) => [key, source(4, seed)]));

const recordingGovernor = () => {
  const state = {
    cancels: 0,
    commits: 0,
    costs: [] as Array<{ readonly persistentGpuBytes: number; readonly uploadBytes: number }>,
    denied: false,
    releases: 0,
  };
  const governor: IblTextureGpuGovernor = {
    reserve: (cost) => {
      state.costs.push(cost);
      if (state.denied) return undefined;
      return {
        cancel: () => { state.cancels += 1; },
        commit: () => {
          state.commits += 1;
          return { release: () => { state.releases += 1; } };
        },
      };
    },
  };
  return { governor, state };
};

describe("IBL texture arena", () => {
  it("does not bind or enable an available specular texture when its planned unit is omitted", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    const lightSet: SurfaceLightSet = {
      directionals: [],
      irradiance: {
        coefficients: Array.from({ length: 9 }, () => [1, 1, 1]),
        intensity: 2,
        worldToIbl: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      lights: [],
      punctuals: [],
      specular: {
        encoding: "linear",
        intensity: 1,
        key: "planned",
        mipCount: 1,
        texture: {} as WebGLTexture,
        worldToIbl: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    };

    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, undefined, 7);

    expect(uniform4fvValues(gl, "u_iblIrradianceSettings")).toEqual([[1, 2, 0, 0]]);
    expect(uniform1iValues(gl, "u_useIblSpecular")).toEqual([0]);
    expect(uniform1iValues(gl, "u_useIblBrdfLut")).toEqual([0]);
    expect(uniform1iValues(gl, "u_iblSpecularCube")).toEqual([]);
    expect(calls(gl, "activeTexture")).toEqual([]);
    expect(calls(gl, "bindTexture")).toEqual([]);
    expect(iblTextureArenaSnapshot(arena).brdfLut).toBe(false);
  });

  it("binds planned specular and BRDF units without aliasing them", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    const texture = {} as WebGLTexture;
    const lightSet: SurfaceLightSet = {
      directionals: [],
      lights: [],
      punctuals: [],
      specular: {
        encoding: "linear",
        intensity: 1,
        key: "planned",
        mipCount: 1,
        texture,
        worldToIbl: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    };

    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, 3, 7);

    expect(uniform1iValues(gl, "u_useIblSpecular")).toEqual([1]);
    expect(uniform1iValues(gl, "u_iblSpecularCube")).toEqual([3]);
    expect(uniform1iValues(gl, "u_useIblBrdfLut")).toEqual([1]);
    expect(uniform1iValues(gl, "u_iblBrdfLut")).toEqual([7]);
    expect(calls(gl, "activeTexture").map((call) => call.args[0])).toContain(gl.TEXTURE0 + 3);
    expect(calls(gl, "activeTexture").map((call) => call.args[0])).toContain(gl.TEXTURE0 + 7);
    expect(calls(gl, "bindTexture")).toContainEqual({ args: [gl.TEXTURE_CUBE_MAP, texture], name: "bindTexture" });
  });

  it("rejects aliased and out-of-range planned IBL units before texture binding", () => {
    const gl = new FakeGl(8);
    const arena = createIblTextureArena(context(gl));
    const lightSet: SurfaceLightSet = {
      directionals: [],
      lights: [],
      punctuals: [],
      specular: {
        encoding: "linear",
        intensity: 1,
        key: "planned",
        mipCount: 1,
        texture: {} as WebGLTexture,
        worldToIbl: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    };
    const programArena = createProgramArena(context(gl));
    const program = {} as WebGLProgram;

    expect(() => bindSurfaceIbl(arena, programArena, program, lightSet, 4, 4)).toThrow(/must not alias unit 4/);
    expect(() => bindSurfaceIbl(arena, programArena, program, lightSet, 8, undefined)).toThrow(/in \[0, 8\)/);
    expect(() => bindSurfaceIbl(arena, programArena, program, lightSet, 2, 8)).toThrow(/in \[0, 8\)/);
    expect(calls(gl, "activeTexture")).toEqual([]);
    expect(calls(gl, "bindTexture")).toEqual([]);
  });

  it("preserves permanent policy identities across lost-context drop", () => {
    const gl = new FakeGl();
    let admissions = 0;
    const arena = createIblTextureArena(context(gl), {
      reserve: () => {
        admissions += 1;
        return { permanent: true, reason: "studio cannot fit" };
      },
    });

    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBeUndefined();
    expect(admissions).toBe(1);
    dropIblTextureContext(arena);
    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBeUndefined();
    expect(admissions).toBe(1);
    expect(consumeIblTextureDiagnostics(arena)).toEqual([
      expect.stringContaining("studio cannot fit"),
    ]);
  });

  it("clears a glTF terminal identity on semantic release so a replacement can be reconsidered", () => {
    const gl = new FakeGl();
    let denied = true;
    let admissions = 0;
    const arena = createIblTextureArena(context(gl), {
      reserve: () => {
        admissions += 1;
        if (denied) return { permanent: true, reason: "old cubemap cannot fit" };
        return {
          cancel: () => undefined,
          commit: () => ({ release: () => undefined }),
        };
      },
    });

    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(false);
    expect(admissions).toBe(1);
    releaseGltfIblSpecularTexture(arena, specular.key);
    denied = false;
    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(true);
    expect(admissions).toBeGreaterThan(1);
    expect(consumeIblTextureDiagnostics(arena)).toEqual([]);
  });
  it("latches intrinsic studio, BRDF, and glTF cubemap denials without GL retry", () => {
    const gl = new FakeGl();
    const admissionCosts: string[] = [];
    const arena = createIblTextureArena(context(gl), {
      reserve: ({ persistentGpuBytes, uploadBytes }) => {
        admissionCosts.push(`${persistentGpuBytes}:${uploadBytes}`);
        return { permanent: true, reason: "exceeds tiny policy" };
      },
    });

    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBeUndefined();
    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBeUndefined();
    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(false);
    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(false);
    const lightSet: SurfaceLightSet = {
      directionals: [], lights: [], punctuals: [],
      specular: {
        encoding: "linear", intensity: 1, key: "fake", mipCount: 1,
        texture: {} as WebGLTexture,
        worldToIbl: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    };
    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, 2, 7);
    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, 2, 7);

    expect(admissionCosts).toHaveLength(3);
    expect(calls(gl, "createTexture")).toHaveLength(0);
    expect(consumeIblTextureDiagnostics(arena)).toHaveLength(2);
    expect(consumeIblTextureFrameWake(arena)).toBe(false);
    expect(wakeIblTextureDurablePressure(arena)).toBe(false);
  });

  it("separates next-frame upload pressure from durable capacity wake", () => {
    const gl = new FakeGl();
    let mode: "upload" | "durable" | "ready" = "upload";
    const arena = createIblTextureArena(context(gl), {
      reserve: () => mode === "ready" ? {
        cancel: () => undefined,
        commit: () => ({ release: () => undefined }),
      } : { permanent: false, reason: mode === "upload" ? "upload-capacity" : "persistent-gpu-capacity" },
    });

    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBeUndefined();
    expect(consumeIblTextureFrameWake(arena)).toBe(true);
    expect(wakeIblTextureDurablePressure(arena)).toBe(false);
    mode = "durable";
    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBeUndefined();
    expect(consumeIblTextureFrameWake(arena)).toBe(false);
    expect(wakeIblTextureDurablePressure(arena)).toBe(true);
    expect(wakeIblTextureDurablePressure(arena)).toBe(false);
    mode = "ready";
    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBeDefined();
  });
  it("waits for all sources, validates before upload, and publishes only a complete cubemap", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    const partial = completeSources();
    partial.delete(keys[5]!);
    expect(ensureGltfIblSpecularTexture(arena, specular, partial).uploaded).toBe(false);
    expect(calls(gl, "texImage2D")).toHaveLength(0);
    const invalid = completeSources();
    invalid.set(keys[5]!, source(2));
    const rejected = ensureGltfIblSpecularTexture(arena, specular, invalid);
    expect(rejected.unsupportedMessage).toMatch(/mip 0 face 5 has 2x2; expected 4x4/);
    expect(calls(gl, "texImage2D")).toHaveLength(0);
    const ready = ensureGltfIblSpecularTexture(arena, specular, completeSources());
    expect(ready.uploaded).toBe(true);
    expect(calls(gl, "texImage2D")).toHaveLength(6);
    expect(calls(gl, "texParameteri")).toHaveLength(6);
    expect(calls(gl, "texParameteri")).toContainEqual({
      args: [gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE],
      name: "texParameteri",
    });
  });

  it("reuploads the complete cubemap when one retained source identity is replaced", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    const sources = completeSources();
    ensureGltfIblSpecularTexture(arena, specular, sources);
    sources.set(keys[2]!, source(4, 9));
    markGltfIblSpecularTextureDirty(arena, specular.key);
    ensureGltfIblSpecularTexture(arena, specular, sources);
    expect(calls(gl, "texImage2D")).toHaveLength(12);
    expect(calls(gl, "createTexture")).toHaveLength(1);
  });

  it("fails closed when an uploaded key is reused with a different layout", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(true);
    const changed = ensureGltfIblSpecularTexture(
      arena,
      { ...specular, encoding: "rgbd" },
      completeSources(),
    );
    expect(changed.unsupportedMessage).toMatch(/changed its image layout/);
    expect(changed.uploaded).toBe(false);

    const failedGl = new FakeGl();
    const failedArena = createIblTextureArena(context(failedGl));
    failedGl.failTexImageOnce = true;
    expect(ensureGltfIblSpecularTexture(failedArena, specular, completeSources()).uploadError)
      .toBeInstanceOf(Error);
    const changedAfterFailure = ensureGltfIblSpecularTexture(
      failedArena,
      { ...specular, encoding: "rgbd" },
      completeSources(),
    );
    expect(changedAfterFailure.unsupportedMessage).toMatch(/changed its image layout/);
    expect(changedAfterFailure.uploadError).toBeUndefined();
    expect(changedAfterFailure.uploaded).toBe(false);
  });

  it("returns upload failure without false-ready publication and retries the same owned handle", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    gl.failTexImageOnce = true;
    const failed = ensureGltfIblSpecularTexture(arena, specular, completeSources());
    expect(failed.uploadError).toBeInstanceOf(Error);
    expect(failed.uploaded).toBe(false);
    const ready = ensureGltfIblSpecularTexture(arena, specular, completeSources());
    expect(ready.uploaded).toBe(true);
    expect(calls(gl, "createTexture")).toHaveLength(1);
  });

  it("publishes no resource when texture creation fails and retries cleanly", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    gl.failCreateOnce = true;
    expect(() => ensureGltfIblSpecularTexture(arena, specular, completeSources()))
      .toThrow(/texture creation failed/);
    expect(iblTextureArenaSnapshot(arena)).toMatchObject({ gltfSpecularCount: 0, ownedTextureCount: 0 });
    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(true);
  });

  it("creates studio and BRDF textures lazily and caches both", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    const studio = ensureStudioEnvironmentSpecularTexture(arena);
    if (studio === undefined) throw new Error("Expected ungoverned studio texture admission");
    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBe(studio);
    expect(calls(gl, "texImage2D")).toHaveLength(36);
    expect(calls(gl, "texParameteri")).toContainEqual({
      args: [gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE],
      name: "texParameteri",
    });
    const lightSet: SurfaceLightSet = {
      directionals: [], lights: [], punctuals: [],
      specular: { encoding: "linear", intensity: 1, key: studio.key, mipCount: studio.mipCount, texture: studio.texture, worldToIbl: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    };
    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, 2, undefined);
    expect(iblTextureArenaSnapshot(arena).brdfLut).toBe(false);
    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, 2, 7);
    expect(iblTextureArenaSnapshot(arena).brdfLut).toBe(true);
    expect(calls(gl, "texImage2D")).toHaveLength(37);
  });

  it("releases keys and active handles while lost drop is GL-free", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    ensureGltfIblSpecularTexture(arena, specular, completeSources());
    releaseGltfIblSpecularTexture(arena, specular.key);
    expect(calls(gl, "deleteTexture")).toHaveLength(1);
    ensureStudioEnvironmentSpecularTexture(arena);
    releaseIblTextureContextHandles(arena);
    expect(calls(gl, "deleteTexture")).toHaveLength(2);
    ensureGltfIblSpecularTexture(arena, specular, completeSources());
    const deletes = calls(gl, "deleteTexture").length;
    dropIblTextureContext(arena);
    expect(calls(gl, "deleteTexture")).toHaveLength(deletes);
    expect(iblTextureArenaSnapshot(arena).ownedTextureCount).toBe(0);
  });

  it("retains failed active deletions for a later release retry", () => {
    const gl = new FakeGl();
    const arena = createIblTextureArena(context(gl));
    ensureGltfIblSpecularTexture(arena, specular, completeSources());
    ensureStudioEnvironmentSpecularTexture(arena);
    gl.deleteFailures.add(1);
    expect(() => releaseIblTextureContextHandles(arena)).toThrow(/deleteTexture failure 1/);
    expect(iblTextureArenaSnapshot(arena)).toMatchObject({ gltfSpecularCount: 0, ownedTextureCount: 1 });
    releaseIblTextureContextHandles(arena);
    expect(iblTextureArenaSnapshot(arena).ownedTextureCount).toBe(0);
    expect(calls(gl, "deleteTexture")).toHaveLength(3);
  });

  it("admits complete glTF cubemaps before allocation and charges reuploads without durable double count", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    recorded.state.denied = true;
    const arena = createIblTextureArena(context(gl), recorded.governor);

    const denied = ensureGltfIblSpecularTexture(arena, specular, completeSources());
    expect(denied.uploaded).toBe(false);
    expect(calls(gl, "createTexture")).toHaveLength(0);
    expect(calls(gl, "texImage2D")).toHaveLength(0);

    recorded.state.denied = false;
    const ready = ensureGltfIblSpecularTexture(arena, specular, completeSources());
    expect(ready.uploaded).toBe(true);
    markGltfIblSpecularTextureDirty(arena, specular.key);
    ensureGltfIblSpecularTexture(arena, specular, completeSources(2));

    expect(recorded.state.costs.slice(0, 3)).toEqual([
      { persistentGpuBytes: 0, uploadBytes: 64 },
      { persistentGpuBytes: 0, uploadBytes: 64 },
      { persistentGpuBytes: 384, uploadBytes: 0 },
    ]);
    expect(recorded.state.costs.slice(3)).toEqual([
      ...Array.from({ length: 6 }, () => ({ persistentGpuBytes: 0, uploadBytes: 64 })),
      { persistentGpuBytes: 0, uploadBytes: 64 },
      ...Array.from({ length: 6 }, () => ({ persistentGpuBytes: 0, uploadBytes: 64 })),
    ]);
    expect(recorded.state.cancels).toBe(2);
    expect(recorded.state.commits).toBe(13);
    expect(recorded.state.releases).toBe(12);
    releaseGltfIblSpecularTexture(arena, specular.key);
    expect(recorded.state.releases).toBe(13);
  });

  it("preflights the largest cubemap face before durable reservation or GL mutation", () => {
    const gl = new FakeGl();
    const costs: Array<{ readonly persistentGpuBytes: number; readonly uploadBytes: number }> = [];
    const arena = createIblTextureArena(context(gl), {
      reserve: (cost) => {
        costs.push(cost);
        if (cost.uploadBytes > 16) {
          return { permanent: true, reason: `${cost.uploadBytes} upload bytes exceed limit 16` };
        }
        return {
          cancel: () => undefined,
          commit: () => ({ release: () => undefined }),
        };
      },
    });

    const denied = ensureGltfIblSpecularTexture(arena, specular, completeSources());
    expect(denied.uploaded).toBe(false);
    expect(denied.texture).toBeUndefined();
    expect(denied.unsupportedMessage).toMatch(/64 upload bytes exceed limit 16/);
    expect(costs).toEqual([{ persistentGpuBytes: 0, uploadBytes: 64 }]);
    expect(iblTextureArenaSnapshot(arena)).toMatchObject({
      ownedTextureCount: 0,
      retainedLeaseCount: 0,
    });
    expect(gl.calls).toEqual([]);
  });

  it("rejects hostile image dimensions and wrapped mip chains before admission or GL", () => {
    for (const hostile of [
      {
        imageLoadKeys: [keys],
        imageSize: 2 ** 31,
        message: /invalid image size/,
        sources: new Map(keys.map((key) => [key, source(1)])),
      },
      {
        imageLoadKeys: Array.from({ length: 33 }, (_unused, mipIndex) =>
          keys.map((_key, faceIndex) => `mip-${mipIndex}-face-${faceIndex}`)),
        imageSize: 4,
        message: /33 mip levels.*at most 3/,
        sources: new Map<string, LoadedTextureSource>(),
      },
    ] as const) {
      const gl = new FakeGl();
      let admissions = 0;
      const arena = createIblTextureArena(context(gl), {
        reserve: () => {
          admissions += 1;
          return {
            cancel: () => undefined,
            commit: () => ({ release: () => undefined }),
          };
        },
      });
      const rejected = ensureGltfIblSpecularTexture(arena, {
        encoding: "linear",
        imageLoadKeys: hostile.imageLoadKeys,
        imageSize: hostile.imageSize,
        key: `hostile:${hostile.imageSize}:${hostile.imageLoadKeys.length}`,
      }, hostile.sources);

      expect(rejected.uploaded).toBe(false);
      expect(rejected.texture).toBeUndefined();
      expect(rejected.unsupportedMessage).toMatch(hostile.message);
      expect(admissions).toBe(0);
      expect(gl.calls).toEqual([]);
    }
  });

  it("rechecks retained cubemaps for terminal upload policy changes before GL mutation", () => {
    const gl = new FakeGl();
    let permanentlyDenyUploads = false;
    const costs: Array<{ readonly persistentGpuBytes: number; readonly uploadBytes: number }> = [];
    const arena = createIblTextureArena(context(gl), {
      reserve: (cost) => {
        costs.push(cost);
        if (permanentlyDenyUploads && cost.uploadBytes !== 0) {
          return { permanent: true, reason: "changed upload policy" };
        }
        return {
          cancel: () => undefined,
          commit: () => ({ release: () => undefined }),
        };
      },
    });
    const ready = ensureGltfIblSpecularTexture(arena, specular, completeSources());
    expect(ready.uploaded).toBe(true);
    const texture = ready.texture;
    const callsBeforeReupload = gl.calls.slice();

    markGltfIblSpecularTextureDirty(arena, specular.key);
    permanentlyDenyUploads = true;
    const denied = ensureGltfIblSpecularTexture(arena, specular, completeSources(2));

    expect(denied.uploaded).toBe(false);
    expect(denied.texture).toBe(texture);
    expect(denied.unsupportedMessage).toMatch(/changed upload policy/);
    expect(costs.at(-1)).toEqual({ persistentGpuBytes: 0, uploadBytes: 64 });
    expect(gl.calls).toEqual(callsBeforeReupload);
  });

  it("retries admissible largest-face preflight after frame-local upload pressure", () => {
    const gl = new FakeGl();
    let framePressured = true;
    let cancels = 0;
    const arena = createIblTextureArena(context(gl), {
      reserve: ({ persistentGpuBytes, uploadBytes }) => {
        if (framePressured && persistentGpuBytes === 0 && uploadBytes === 64) {
          return { permanent: false, reason: "upload-capacity" };
        }
        return {
          cancel: () => { cancels += 1; },
          commit: () => ({ release: () => undefined }),
        };
      },
    });

    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(false);
    expect(consumeIblTextureFrameWake(arena)).toBe(true);
    expect(iblTextureArenaSnapshot(arena)).toMatchObject({
      ownedTextureCount: 0,
      retainedLeaseCount: 0,
    });
    expect(gl.calls).toEqual([]);

    framePressured = false;
    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(true);
    expect(cancels).toBe(1);
    expect(calls(gl, "texImage2D")).toHaveLength(6);
  });

  it("governs studio RGB9_E5 and BRDF RGBA8 allocations and retries denial lazily", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    recorded.state.denied = true;
    const arena = createIblTextureArena(context(gl), recorded.governor);

    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBeUndefined();
    expect(calls(gl, "createTexture")).toHaveLength(0);
    recorded.state.denied = false;
    const studio = ensureStudioEnvironmentSpecularTexture(arena);
    if (studio === undefined) throw new Error("Expected studio admission retry");
    const lightSet: SurfaceLightSet = {
      directionals: [], lights: [], punctuals: [],
      specular: {
        encoding: "linear", intensity: 1, key: studio.key, mipCount: studio.mipCount,
        texture: studio.texture, worldToIbl: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    };
    recorded.state.denied = true;
    const createsBeforeBrdf = calls(gl, "createTexture").length;
    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, 2, 7);
    expect(iblTextureArenaSnapshot(arena).brdfLut).toBe(false);
    expect(calls(gl, "createTexture")).toHaveLength(createsBeforeBrdf);
    recorded.state.denied = false;
    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, 2, 7);

    expect(recorded.state.costs).toEqual([
      {
        persistentGpuBytes: STUDIO_ENVIRONMENT_SPECULAR_GPU_BYTES,
        uploadBytes: STUDIO_ENVIRONMENT_SPECULAR_UPLOAD_BYTES,
      },
      {
        persistentGpuBytes: STUDIO_ENVIRONMENT_SPECULAR_GPU_BYTES,
        uploadBytes: STUDIO_ENVIRONMENT_SPECULAR_UPLOAD_BYTES,
      },
      { persistentGpuBytes: IBL_BRDF_LUT_BYTES, uploadBytes: IBL_BRDF_LUT_BYTES },
      { persistentGpuBytes: IBL_BRDF_LUT_BYTES, uploadBytes: IBL_BRDF_LUT_BYTES },
    ]);
    expect(recorded.state.commits).toBe(2);
    dropIblTextureContext(arena);
    expect(recorded.state.releases).toBe(2);
  });

  it("resumes a cubemap at the denied face without reuploading completed faces", () => {
    const gl = new FakeGl();
    let uploadAdmissions = 0;
    let denyThirdFace = true;
    const arena = createIblTextureArena(context(gl), {
      reserve: ({ uploadBytes }) => {
        if (uploadBytes !== 0) {
          uploadAdmissions += 1;
          // The first upload admission is the maximum-face preflight.
          if (denyThirdFace && uploadAdmissions === 4) return undefined;
        }
        return {
          cancel: () => undefined,
          commit: () => ({ release: () => undefined }),
        };
      },
    });

    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(false);
    expect(calls(gl, "texImage2D")).toHaveLength(2);
    denyThirdFace = false;
    expect(ensureGltfIblSpecularTexture(arena, specular, completeSources()).uploaded).toBe(true);
    expect(calls(gl, "texImage2D")).toHaveLength(6);
  });

  it("retains a governed lease across failed deletion and releases it on retry", () => {
    const gl = new FakeGl();
    const recorded = recordingGovernor();
    const arena = createIblTextureArena(context(gl), recorded.governor);
    ensureGltfIblSpecularTexture(arena, specular, completeSources());
    gl.deleteFailures.add(1);

    expect(() => releaseGltfIblSpecularTexture(arena, specular.key)).toThrow(/deleteTexture failure/);
    expect(recorded.state.releases).toBe(6);
    expect(iblTextureArenaSnapshot(arena)).toMatchObject({
      gltfSpecularCount: 0,
      ownedTextureCount: 1,
      retainedLeaseCount: 1,
    });
    releaseGltfIblSpecularTexture(arena, specular.key);
    expect(recorded.state.releases).toBe(7);
    expect(iblTextureArenaSnapshot(arena).retainedLeaseCount).toBe(0);
  });

  it("continues lost-context lease cleanup after the first release failure", () => {
    const gl = new FakeGl();
    const leases: Array<{ fail: boolean; released: boolean }> = [];
    const arena = createIblTextureArena(context(gl), {
      reserve: () => ({
        cancel: () => undefined,
        commit: () => {
          const state = { fail: false, released: false };
          leases.push(state);
          return {
            release: () => {
              if (state.fail) throw new Error("lease release failed");
              state.released = true;
            },
          };
        },
      }),
    });
    ensureStudioEnvironmentSpecularTexture(arena);
    ensureGltfIblSpecularTexture(arena, specular, completeSources());
    const retained = leases.filter(({ released }) => !released);
    expect(retained).toHaveLength(2);
    retained[0]!.fail = true;

    expect(() => dropIblTextureContext(arena)).toThrow("lease release failed");
    expect(retained[1]!.released).toBe(true);
    expect(iblTextureArenaSnapshot(arena)).toMatchObject({
      ownedTextureCount: 0,
      retainedLeaseCount: 1,
    });

    retained[0]!.fail = false;
    dropIblTextureContext(arena);
    expect(iblTextureArenaSnapshot(arena).retainedLeaseCount).toBe(0);
  });
});
