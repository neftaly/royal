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
} from "../packages/renderer-webgl/src/webgl/clustered-light-arena";
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
  #creates = 0;
  #serial = 1;
  #texImages = 0;

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
  texSubImage2D = (...args: readonly unknown[]): void => this.#record("texSubImage2D", ...args);
  uniform1i = (...args: readonly unknown[]): void => this.#record("uniform1i", ...args);
  uniform2fv = (...args: readonly unknown[]): void => this.#record("uniform2fv", ...args);
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
    for (let draw = 0; draw < 256; draw += 1) {
      bindLights(gl, arena, [{
        color: [draw + 1, 2, 3, 1],
        kind: "point",
        position: [draw * 0.01, 0, -3],
      }], 7);
    }
    expect(calls(gl, "createTexture")).toHaveLength(3);
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
    expect(clusteredLightArenaSnapshot(arena)).toMatchObject({ ownedTextureCount: 1, resourceCount: 0 });
    releaseClusteredLightContextHandles(arena);
    expect(clusteredLightArenaSnapshot(arena).ownedTextureCount).toBe(0);
    expect(calls(gl, "deleteTexture")).toHaveLength(4);
  });
});
