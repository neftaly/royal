import { describe, expect, it } from "vitest";
import {
  copyTransmissionScreenColorTexture,
  createSurfaceRenderTargetArena,
  dropSurfaceRenderTargetArenaContext,
  ensureHdrRenderTarget,
  releaseSurfaceRenderTargetContextHandles,
} from "../packages/renderer-webgl/src/surface-render-target-arena";

type Handle = { readonly kind: "framebuffer" | "renderbuffer" | "texture"; readonly serial: number };
type Call = { readonly args: readonly unknown[]; readonly name: string };

class FakeGl {
  readonly CLAMP_TO_EDGE = 0x812f;
  readonly COLOR_ATTACHMENT0 = 0x8ce0;
  readonly DEPTH_ATTACHMENT = 0x8d00;
  readonly DEPTH_COMPONENT24 = 0x81a6;
  readonly FRAMEBUFFER = 0x8d40;
  readonly FRAMEBUFFER_COMPLETE = 0x8cd5;
  readonly HALF_FLOAT = 0x140b;
  readonly LINEAR = 0x2601;
  readonly RENDERBUFFER = 0x8d41;
  readonly RGBA = 0x1908;
  readonly RGBA16F = 0x881a;
  readonly TEXTURE0 = 0x84c0;
  readonly TEXTURE_2D = 0x0de1;
  readonly TEXTURE_MAG_FILTER = 0x2800;
  readonly TEXTURE_MIN_FILTER = 0x2801;
  readonly TEXTURE_WRAP_S = 0x2802;
  readonly TEXTURE_WRAP_T = 0x2803;
  readonly UNSIGNED_BYTE = 0x1401;
  readonly calls: Call[] = [];
  framebufferComplete = true;
  failCopyOnce = false;
  failRenderbufferCreationOnce = false;
  #serial = 1;

  #handle(kind: Handle["kind"]): Handle {
    return { kind, serial: this.#serial++ };
  }

  #record(name: string, ...args: readonly unknown[]): void {
    this.calls.push({ args, name });
  }

  activeTexture = (unit: number): void => this.#record("activeTexture", unit);
  bindFramebuffer = (target: number, value: WebGLFramebuffer | null): void =>
    this.#record("bindFramebuffer", target, value);
  bindRenderbuffer = (target: number, value: WebGLRenderbuffer | null): void =>
    this.#record("bindRenderbuffer", target, value);
  bindTexture = (target: number, value: WebGLTexture | null): void =>
    this.#record("bindTexture", target, value);
  checkFramebufferStatus = (target: number): number => {
    this.#record("checkFramebufferStatus", target);
    return this.framebufferComplete ? this.FRAMEBUFFER_COMPLETE : 0;
  };
  copyTexSubImage2D = (...args: readonly unknown[]): void => {
    this.#record("copyTexSubImage2D", ...args);
    if (this.failCopyOnce) {
      this.failCopyOnce = false;
      throw new Error("copy failed");
    }
  };
  createFramebuffer = (): WebGLFramebuffer => {
    const value = this.#handle("framebuffer");
    this.#record("createFramebuffer", value);
    return value as unknown as WebGLFramebuffer;
  };
  createRenderbuffer = (): WebGLRenderbuffer | null => {
    if (this.failRenderbufferCreationOnce) {
      this.failRenderbufferCreationOnce = false;
      this.#record("createRenderbuffer", null);
      return null;
    }
    const value = this.#handle("renderbuffer");
    this.#record("createRenderbuffer", value);
    return value as unknown as WebGLRenderbuffer;
  };
  createTexture = (): WebGLTexture => {
    const value = this.#handle("texture");
    this.#record("createTexture", value);
    return value as unknown as WebGLTexture;
  };
  deleteFramebuffer = (value: WebGLFramebuffer | null): void =>
    this.#record("deleteFramebuffer", value);
  deleteRenderbuffer = (value: WebGLRenderbuffer | null): void =>
    this.#record("deleteRenderbuffer", value);
  deleteTexture = (value: WebGLTexture | null): void => this.#record("deleteTexture", value);
  framebufferRenderbuffer = (...args: readonly unknown[]): void =>
    this.#record("framebufferRenderbuffer", ...args);
  framebufferTexture2D = (...args: readonly unknown[]): void =>
    this.#record("framebufferTexture2D", ...args);
  renderbufferStorage = (...args: readonly unknown[]): void =>
    this.#record("renderbufferStorage", ...args);
  texImage2D = (...args: readonly unknown[]): void => this.#record("texImage2D", ...args);
  texParameteri = (...args: readonly unknown[]): void => this.#record("texParameteri", ...args);
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const calls = (gl: FakeGl, name: string): readonly Call[] => gl.calls.filter((call) => call.name === name);

describe("surface render-target arena", () => {
  it("allocates and reuses one complete HDR target, resizing with RGBA16F storage", () => {
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena();
    const first = ensureHdrRenderTarget(arena, context(gl), 320, 180);

    expect(first).toMatchObject({ height: 180, width: 320 });
    expect(calls(gl, "createTexture")).toHaveLength(1);
    expect(calls(gl, "createRenderbuffer")).toHaveLength(1);
    expect(calls(gl, "createFramebuffer")).toHaveLength(1);
    expect(calls(gl, "texImage2D")[0]?.args).toEqual([
      gl.TEXTURE_2D, 0, gl.RGBA16F, 320, 180, 0, gl.RGBA, gl.HALF_FLOAT, null,
    ]);
    expect(calls(gl, "bindTexture").at(-1)?.args).toEqual([gl.TEXTURE_2D, null]);

    expect(ensureHdrRenderTarget(arena, context(gl), 320, 180)).toBe(first);
    expect(calls(gl, "texImage2D")).toHaveLength(1);
    expect(ensureHdrRenderTarget(arena, context(gl), 640, 360)).toBe(first);
    expect(first).toMatchObject({ height: 360, width: 640 });
    expect(calls(gl, "texImage2D")).toHaveLength(2);
  });

  it("copies transmission color with stable metadata and reallocates for resize or HDR changes", () => {
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena();
    const first = copyTransmissionScreenColorTexture(arena, context(gl), 100, 80, 11, 13, false);

    expect(first).toMatchObject({
      hdr: false, height: 80, originX: 11, originY: 13, uploaded: true, width: 100,
    });
    expect(calls(gl, "texImage2D")[0]?.args).toEqual([
      gl.TEXTURE_2D, 0, gl.RGBA, 100, 80, 0, gl.RGBA, gl.UNSIGNED_BYTE, null,
    ]);
    expect(calls(gl, "copyTexSubImage2D")[0]?.args).toEqual([
      gl.TEXTURE_2D, 0, 0, 0, 11, 13, 100, 80,
    ]);

    expect(copyTransmissionScreenColorTexture(arena, context(gl), 100, 80, 17, 19, false)).toBe(first);
    expect(calls(gl, "texImage2D")).toHaveLength(1);
    expect(first).toMatchObject({ originX: 17, originY: 19 });
    copyTransmissionScreenColorTexture(arena, context(gl), 120, 90, 0, 0, false);
    copyTransmissionScreenColorTexture(arena, context(gl), 120, 90, 0, 0, true);
    expect(calls(gl, "texImage2D")).toHaveLength(3);
    expect(calls(gl, "texImage2D").at(-1)?.args).toEqual([
      gl.TEXTURE_2D, 0, gl.RGBA16F, 120, 90, 0, gl.RGBA, gl.HALF_FLOAT, null,
    ]);
  });

  it("does not publish transmission metadata when copy fails and retries allocation", () => {
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena();
    gl.failCopyOnce = true;
    expect(() => copyTransmissionScreenColorTexture(
      arena, context(gl), 64, 32, 3, 5, false,
    )).toThrow(/copy failed/);

    const resource = copyTransmissionScreenColorTexture(arena, context(gl), 64, 32, 3, 5, false);
    expect(resource).toMatchObject({ height: 32, originX: 3, originY: 5, uploaded: true, width: 64 });
    expect(calls(gl, "createTexture")).toHaveLength(1);
    expect(calls(gl, "texImage2D")).toHaveLength(2);
    expect(calls(gl, "copyTexSubImage2D")).toHaveLength(2);
  });

  it("keeps incomplete HDR allocation owned and retries without duplicating handles", () => {
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena();
    gl.framebufferComplete = false;
    expect(() => ensureHdrRenderTarget(arena, context(gl), 90, 45)).toThrow(/complete RGBA16F HDR framebuffer/);
    gl.framebufferComplete = true;

    const target = ensureHdrRenderTarget(arena, context(gl), 90, 45);
    expect(target).toMatchObject({ height: 45, width: 90 });
    expect(calls(gl, "createTexture")).toHaveLength(1);
    expect(calls(gl, "createRenderbuffer")).toHaveLength(1);
    expect(calls(gl, "createFramebuffer")).toHaveLength(1);
    expect(calls(gl, "texImage2D")).toHaveLength(2);
  });

  it("releases active-context handles, but lost-context drop performs no GL deletion", () => {
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena();
    ensureHdrRenderTarget(arena, context(gl), 32, 16);
    copyTransmissionScreenColorTexture(arena, context(gl), 32, 16, 0, 0, false);
    releaseSurfaceRenderTargetContextHandles(arena, context(gl));

    expect(calls(gl, "deleteFramebuffer")).toHaveLength(1);
    expect(calls(gl, "deleteRenderbuffer")).toHaveLength(1);
    expect(calls(gl, "deleteTexture")).toHaveLength(2);
    releaseSurfaceRenderTargetContextHandles(arena, context(gl));
    expect(calls(gl, "deleteTexture")).toHaveLength(2);

    ensureHdrRenderTarget(arena, context(gl), 32, 16);
    copyTransmissionScreenColorTexture(arena, context(gl), 32, 16, 0, 0, false);
    const deletesBeforeDrop = calls(gl, "deleteFramebuffer").length
      + calls(gl, "deleteRenderbuffer").length
      + calls(gl, "deleteTexture").length;
    dropSurfaceRenderTargetArenaContext(arena);
    expect(
      calls(gl, "deleteFramebuffer").length
      + calls(gl, "deleteRenderbuffer").length
      + calls(gl, "deleteTexture").length,
    ).toBe(deletesBeforeDrop);
    const recreated = ensureHdrRenderTarget(arena, context(gl), 32, 16);
    expect(recreated.color).not.toBeNull();
    expect(calls(gl, "createFramebuffer")).toHaveLength(3);
  });

  it("keeps partial HDR creation reachable for active-context release", () => {
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena();
    gl.failRenderbufferCreationOnce = true;
    expect(() => ensureHdrRenderTarget(arena, context(gl), 20, 10)).toThrow(/renderbuffer creation failed/);
    releaseSurfaceRenderTargetContextHandles(arena, context(gl));
    expect(calls(gl, "deleteTexture")).toHaveLength(1);
    expect(calls(gl, "deleteRenderbuffer")).toHaveLength(0);
    expect(calls(gl, "deleteFramebuffer")).toHaveLength(0);
  });
});
