import { describe, expect, it } from "vitest";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture-sources";
import {
  bindSurfaceIbl,
  createIblTextureArena,
  dropIblTextureContext,
  ensureGltfIblSpecularTexture,
  ensureStudioEnvironmentSpecularTexture,
  iblTextureArenaSnapshot,
  markGltfIblSpecularTextureDirty,
  releaseGltfIblSpecularTexture,
  releaseIblTextureContextHandles,
} from "../packages/renderer-webgl/src/webgl/ibl-texture-arena";
import type { SurfaceImageBasedLightSpecular, SurfaceLightSet } from "../packages/renderer-webgl/src/webgl/lights";
import { createProgramArena } from "../packages/renderer-webgl/src/webgl/program-arena";

type Handle = { readonly serial: number };
type Call = { readonly args: readonly unknown[]; readonly name: string };

class FakeGl {
  readonly CLAMP_TO_EDGE = 0x812f;
  readonly FLOAT = 0x1406;
  readonly LINEAR = 0x2601;
  readonly LINEAR_MIPMAP_LINEAR = 0x2703;
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
const source = (size: number, seed = 1): LoadedTextureSource => ({
  data: new Uint8Array(size * size * 4).fill(seed), height: size, kind: "rgba-texture", width: size,
});
const keys = Array.from({ length: 6 }, (_unused, index) => `face-${index}`);
const specular: SurfaceImageBasedLightSpecular = {
  encoding: "linear", imageLoadKeys: [keys], imageSize: 4, key: "ibl:test",
};
const completeSources = (seed = 1): Map<string, LoadedTextureSource> =>
  new Map(keys.map((key) => [key, source(4, seed)]));

describe("IBL texture arena", () => {
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
    expect(calls(gl, "texParameteri")).toHaveLength(5);
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
    expect(ensureStudioEnvironmentSpecularTexture(arena)).toBe(studio);
    expect(calls(gl, "texImage2D")).toHaveLength(36);
    const lightSet: SurfaceLightSet = {
      directionals: [], lights: [], punctuals: [],
      specular: { encoding: "linear", intensity: 1, key: studio.key, mipCount: studio.mipCount, texture: studio.texture, worldToIbl: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    };
    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, undefined);
    expect(iblTextureArenaSnapshot(arena).brdfLut).toBe(false);
    bindSurfaceIbl(arena, createProgramArena(context(gl)), {} as WebGLProgram, lightSet, 7);
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
});
