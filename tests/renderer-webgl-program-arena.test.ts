import { describe, expect, it } from "vitest";
import {
  configureProgramArenaParallelCompile,
  consumeProgramArenaWake,
  createProgramArena,
  dropProgramArenaContext,
  programArenaSnapshot,
  releaseProgramArenaContextHandles,
  requestProgram,
  programVariantKey,
  uniform1f,
  uniform1i,
  uniform2f,
  uniform4f,
  useProgram,
} from "../packages/renderer-webgl/src/webgl/program-arena";

type Handle = { readonly kind: string; readonly serial: number };
type Call = { readonly args: readonly unknown[]; readonly name: string };

class FakeGl {
  readonly FRAGMENT_SHADER = 0x8b30;
  readonly LINK_STATUS = 0x8b82;
  readonly VERTEX_SHADER = 0x8b31;
  readonly calls: Call[] = [];
  complete = true;
  failNextProgramDelete = false;
  failNextShaderDelete = false;
  linkStatus = true;
  nullUniforms = new Set<string>();
  #serial = 1;

  #handle(kind: string): Handle { return { kind, serial: this.#serial++ }; }
  #record(name: string, ...args: readonly unknown[]): void { this.calls.push({ args, name }); }

  attachShader = (...args: readonly unknown[]): void => this.#record("attachShader", ...args);
  compileShader = (...args: readonly unknown[]): void => this.#record("compileShader", ...args);
  createProgram = (): WebGLProgram => {
    const value = this.#handle("program"); this.#record("createProgram", value);
    return value as unknown as WebGLProgram;
  };
  createShader = (type: number): WebGLShader => {
    const value = this.#handle("shader"); this.#record("createShader", type, value);
    return value as unknown as WebGLShader;
  };
  deleteProgram = (value: WebGLProgram): void => {
    this.#record("deleteProgram", value);
    if (!this.failNextProgramDelete) return;
    this.failNextProgramDelete = false;
    throw new Error("program delete failed");
  };
  deleteShader = (value: WebGLShader): void => {
    this.#record("deleteShader", value);
    if (!this.failNextShaderDelete) return;
    this.failNextShaderDelete = false;
    throw new Error("shader delete failed");
  };
  detachShader = (...args: readonly unknown[]): void => this.#record("detachShader", ...args);
  getProgramInfoLog = (): string => "program log";
  getProgramParameter = (program: WebGLProgram, parameter: number): boolean => {
    this.#record("getProgramParameter", program, parameter);
    return parameter === 0x91b1 ? this.complete : this.linkStatus;
  };
  getShaderInfoLog = (): string => "shader log";
  getUniformLocation = (_program: WebGLProgram, name: string): WebGLUniformLocation | null => {
    this.#record("getUniformLocation", name);
    return this.nullUniforms.has(name)
      ? null
      : this.#handle(`uniform:${name}`) as unknown as WebGLUniformLocation;
  };
  linkProgram = (...args: readonly unknown[]): void => this.#record("linkProgram", ...args);
  shaderSource = (...args: readonly unknown[]): void => this.#record("shaderSource", ...args);
  uniform1f = (...args: readonly unknown[]): void => this.#record("uniform1f", ...args);
  uniform1i = (...args: readonly unknown[]): void => this.#record("uniform1i", ...args);
  uniform2f = (...args: readonly unknown[]): void => this.#record("uniform2f", ...args);
  uniform2fv = (...args: readonly unknown[]): void => this.#record("uniform2fv", ...args);
  uniform4f = (...args: readonly unknown[]): void => this.#record("uniform4f", ...args);
  uniform4fv = (...args: readonly unknown[]): void => this.#record("uniform4fv", ...args);
  uniformMatrix4fv = (...args: readonly unknown[]): void => this.#record("uniformMatrix4fv", ...args);
  useProgram = (...args: readonly unknown[]): void => this.#record("useProgram", ...args);
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const count = (gl: FakeGl, name: string): number => gl.calls.filter((call) => call.name === name).length;

describe("program arena", () => {
  it("assigns distinct allocation-free identities to kind, feature, and clustered variants", () => {
    const baseColor = new Set(["baseColorTexture"] as const);
    const normal = new Set(["normalTexture"] as const);
    const keys = new Set([
      programVariantKey("surface", baseColor, false),
      programVariantKey("surface", baseColor, true),
      programVariantKey("surface", baseColor, false, true),
      programVariantKey("surface", normal, false),
      programVariantKey("unlit", baseColor, false),
      programVariantKey("wireframe", undefined, false),
    ]);
    expect(keys.size).toBe(6);
  });
  it("compiles, links, caches, and reuses a synchronous program", () => {
    const gl = new FakeGl();
    const arena = createProgramArena(context(gl));
    const first = requestProgram(arena, 0, "wireframe");
    expect(first).toBeDefined();
    expect(requestProgram(arena, 0, "wireframe")).toBe(first);
    expect(count(gl, "createProgram")).toBe(1);
    expect(count(gl, "deleteShader")).toBe(2);
    expect(programArenaSnapshot(arena)).toMatchObject({
      linkedProgramCount: 1, ownedProgramCount: 1, ownedShaderCount: 0, requestCount: 1,
    });
  });

  it("limits starts per frame and exposes a consumable sticky wake", () => {
    const gl = new FakeGl();
    const arena = createProgramArena(context(gl));
    expect(requestProgram(arena, 4, "wireframe")).toBeDefined();
    expect(requestProgram(arena, 4, "postprocess")).toBeUndefined();
    expect(consumeProgramArenaWake(arena)).toBe(true);
    expect(consumeProgramArenaWake(arena)).toBe(false);
    expect(count(gl, "createProgram")).toBe(1);
    expect(requestProgram(arena, 5, "postprocess")).toBeDefined();
    expect(count(gl, "createProgram")).toBe(2);
  });

  it("polls parallel completion and budgets completed links", () => {
    const gl = new FakeGl();
    const arena = createProgramArena(context(gl));
    configureProgramArenaParallelCompile(arena, { COMPLETION_STATUS_KHR: 0x91b1 });
    gl.complete = false;
    expect(requestProgram(arena, 0, "wireframe")).toBeUndefined();
    expect(requestProgram(arena, 0, "wireframe")).toBeUndefined();
    expect(gl.calls.filter((call) => call.name === "getProgramParameter" && call.args[1] === 0x91b1))
      .toHaveLength(1);
    expect(consumeProgramArenaWake(arena)).toBe(true);
    gl.complete = true;
    expect(requestProgram(arena, 1, "wireframe")).toBeDefined();
    expect(requestProgram(arena, 1, "postprocess")).toBeUndefined();
    expect(requestProgram(arena, 2, "postprocess")).toBeDefined();
  });

  it("caches active programs, locations, finite scalar values, equivalent signed zero, and vec2 values", () => {
    const gl = new FakeGl();
    const arena = createProgramArena(context(gl));
    const program = requestProgram(arena, 0, "wireframe")!.program;
    useProgram(arena, program); useProgram(arena, program);
    uniform1i(arena, program, "u_i", 2); uniform1i(arena, program, "u_i", 2);
    uniform1f(arena, program, "u_nan", Number.NaN); uniform1f(arena, program, "u_nan", Number.NaN);
    uniform1f(arena, program, "u_zero", 0); uniform1f(arena, program, "u_zero", -0);
    uniform2f(arena, program, "u_pair", 1, 2); uniform2f(arena, program, "u_pair", 1, 2);
    uniform4f(arena, program, "u_quad", 1, 2, 3, 4); uniform4f(arena, program, "u_quad", 1, 2, 3, 4);
    gl.nullUniforms.add("u_missing");
    uniform1i(arena, program, "u_missing", 1); uniform1i(arena, program, "u_missing", 1);

    expect(count(gl, "useProgram")).toBe(1);
    expect(count(gl, "uniform1i")).toBe(1);
    expect(count(gl, "uniform1f")).toBe(3);
    expect(count(gl, "uniform2f")).toBe(1);
    expect(count(gl, "uniform4f")).toBe(1);
    expect(gl.calls.filter((call) => call.name === "getUniformLocation" && call.args[0] === "u_missing"))
      .toHaveLength(1);
  });

  it("evicts failed links and releases active or drops lost context handles", () => {
    const gl = new FakeGl();
    const arena = createProgramArena(context(gl));
    gl.linkStatus = false;
    expect(() => requestProgram(arena, 0, "wireframe")).toThrow(/program link error.*program log/s);
    expect(programArenaSnapshot(arena).ownedProgramCount).toBe(0);
    expect(programArenaSnapshot(arena).ownedShaderCount).toBe(0);

    gl.linkStatus = true;
    requestProgram(arena, 1, "wireframe");
    releaseProgramArenaContextHandles(arena);
    expect(count(gl, "deleteProgram")).toBe(2);
    expect(programArenaSnapshot(arena).requestCount).toBe(0);
    requestProgram(arena, 2, "wireframe");
    const deletes = count(gl, "deleteProgram");
    dropProgramArenaContext(arena);
    expect(count(gl, "deleteProgram")).toBe(deletes);
    expect(programArenaSnapshot(arena).ownedProgramCount).toBe(0);
  });

  it("retains failed program and shader deletes for active-context retry", () => {
    const gl = new FakeGl();
    const arena = createProgramArena(context(gl));
    configureProgramArenaParallelCompile(arena, { COMPLETION_STATUS_KHR: 0x91b1 });
    gl.complete = false;
    expect(requestProgram(arena, 0, "wireframe")).toBeUndefined();
    expect(programArenaSnapshot(arena)).toMatchObject({
      ownedProgramCount: 1,
      ownedShaderCount: 2,
    });
    gl.failNextProgramDelete = true;
    gl.failNextShaderDelete = true;

    expect(() => releaseProgramArenaContextHandles(arena)).toThrow("program delete failed");
    expect(programArenaSnapshot(arena)).toMatchObject({
      ownedProgramCount: 1,
      ownedShaderCount: 1,
      requestCount: 0,
    });

    releaseProgramArenaContextHandles(arena);
    expect(programArenaSnapshot(arena)).toMatchObject({
      ownedProgramCount: 0,
      ownedShaderCount: 0,
    });
  });
});
