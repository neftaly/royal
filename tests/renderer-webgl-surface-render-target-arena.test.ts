import { describe, expect, it } from "vitest";
import {
  copyTransmissionScreenColorTexture,
  createSurfaceRenderTargetArena,
  dropSurfaceRenderTargetArenaContext,
  ensureHdrRenderTarget,
  releaseSurfaceRenderTargetContextHandles,
  type SurfaceRenderTargetGpuGovernor,
  type SurfaceRenderTargetGpuLease,
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
  failRenderbufferStorageOnce = false;
  failTextureDeleteOnce = false;
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
  deleteTexture = (value: WebGLTexture | null): void => {
    this.#record("deleteTexture", value);
    if (this.failTextureDeleteOnce) {
      this.failTextureDeleteOnce = false;
      throw new Error("delete texture failed");
    }
  };
  framebufferRenderbuffer = (...args: readonly unknown[]): void =>
    this.#record("framebufferRenderbuffer", ...args);
  framebufferTexture2D = (...args: readonly unknown[]): void =>
    this.#record("framebufferTexture2D", ...args);
  renderbufferStorage = (...args: readonly unknown[]): void => {
    this.#record("renderbufferStorage", ...args);
    if (this.failRenderbufferStorageOnce) {
      this.failRenderbufferStorageOnce = false;
      throw new Error("renderbuffer storage failed");
    }
  };
  texImage2D = (...args: readonly unknown[]): void => this.#record("texImage2D", ...args);
  texParameteri = (...args: readonly unknown[]): void => this.#record("texParameteri", ...args);
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const calls = (gl: FakeGl, name: string): readonly Call[] => gl.calls.filter((call) => call.name === name);

const recordingGovernor = (denied = false): {
  readonly cancelled: { value: number };
  readonly costs: Array<Record<string, number>>;
  readonly governor: SurfaceRenderTargetGpuGovernor;
  readonly released: { value: number };
  readonly replacements: { value: number };
} => {
  const cancelled = { value: 0 };
  const released = { value: 0 };
  const replacements = { value: 0 };
  const costs: Array<Record<string, number>> = [];
  const lease = (): SurfaceRenderTargetGpuLease => {
    let active = true;
    return { release: () => {
      if (!active) return false;
      active = false; released.value += 1; return true;
    } };
  };
  const reservation = (previous?: SurfaceRenderTargetGpuLease) => ({
    cancel: () => { cancelled.value += 1; return true; },
    commit: () => { previous?.release(); return lease(); },
  });
  return {
    cancelled,
    costs,
    governor: {
      replace: (previous, cost) => {
        costs.push({ ...cost }); replacements.value += 1;
        return denied ? undefined : reservation(previous);
      },
      reserve: (cost) => {
        costs.push({ ...cost });
        return denied ? undefined : reservation();
      },
    },
    released,
    replacements,
  };
};

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

  it("denies HDR and transmission storage before any GL allocation side effect", () => {
    const recorded = recordingGovernor(true);
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena(recorded.governor);
    expect(() => ensureHdrRenderTarget(arena, context(gl), 20, 10)).toThrow(/governor/);
    expect(() => copyTransmissionScreenColorTexture(
      arena, context(gl), 20, 10, 0, 0, false,
    )).toThrow(/governor/);
    expect(calls(gl, "createTexture")).toHaveLength(0);
    expect(recorded.costs).toEqual([
      { persistentGpuBytes: 2_200, transientPeakBytes: 2_200 },
      { persistentGpuBytes: 800, transientPeakBytes: 800 },
    ]);
  });

  it("atomically replaces render-target leases on resize and releases them on teardown", () => {
    const recorded = recordingGovernor();
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena(recorded.governor);
    ensureHdrRenderTarget(arena, context(gl), 20, 10);
    ensureHdrRenderTarget(arena, context(gl), 40, 20);
    copyTransmissionScreenColorTexture(arena, context(gl), 20, 10, 0, 0, false);
    copyTransmissionScreenColorTexture(arena, context(gl), 20, 10, 1, 1, false);
    copyTransmissionScreenColorTexture(arena, context(gl), 20, 10, 0, 0, true);
    expect(recorded.replacements.value).toBe(2);
    // Storage replacements release superseded leases. GPU-local framebuffer
    // copies do not consume CPU-to-GPU upload admission.
    expect(recorded.released.value).toBe(2);
    releaseSurfaceRenderTargetContextHandles(arena, context(gl));
    expect(recorded.released.value).toBe(4);
  });

  it("settles failed storage conservatively and retains leases across failed deletion", () => {
    const recorded = recordingGovernor();
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena(recorded.governor);
    gl.framebufferComplete = false;
    expect(() => ensureHdrRenderTarget(arena, context(gl), 20, 10)).toThrow(/complete/);
    expect(recorded.cancelled.value).toBe(0);
    gl.framebufferComplete = true;
    ensureHdrRenderTarget(arena, context(gl), 20, 10);
    expect(recorded.replacements.value).toBe(1);

    gl.failTextureDeleteOnce = true;
    expect(() => releaseSurfaceRenderTargetContextHandles(arena, context(gl)))
      .toThrow(/delete texture failed/);
    expect(recorded.released.value).toBe(1);
    releaseSurfaceRenderTargetContextHandles(arena, context(gl));
    expect(recorded.released.value).toBe(2);
  });

  it("quarantines a lease after terminal active-context deletion failure until context loss", () => {
    const recorded = recordingGovernor();
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena(recorded.governor);
    copyTransmissionScreenColorTexture(arena, context(gl), 20, 10, 0, 0, false);
    expect(recorded.released.value).toBe(0);
    gl.failTextureDeleteOnce = true;

    expect(() => releaseSurfaceRenderTargetContextHandles(arena, context(gl)))
      .toThrow("delete texture failed");
    dropSurfaceRenderTargetArenaContext(arena, false);
    expect(recorded.released.value).toBe(0);

    dropSurfaceRenderTargetArenaContext(arena, true);
    expect(recorded.released.value).toBe(1);
  });

  it("continues context-loss lease cleanup and retains only failures for retry", () => {
    const leases: Array<{ fail: boolean; released: boolean }> = [];
    const reservation = () => ({
      cancel: () => true,
      commit: (): SurfaceRenderTargetGpuLease => {
        const state = { fail: false, released: false };
        leases.push(state);
        return {
          release: () => {
            if (state.fail) throw new Error("render-target lease release failed");
            if (state.released) return false;
            state.released = true;
            return true;
          },
        };
      },
    });
    const governor: SurfaceRenderTargetGpuGovernor = {
      replace: () => reservation(),
      reserve: () => reservation(),
    };
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena(governor);
    ensureHdrRenderTarget(arena, context(gl), 20, 10);
    copyTransmissionScreenColorTexture(arena, context(gl), 20, 10, 0, 0, false);
    const retained = leases.filter(({ released }) => !released);
    expect(retained).toHaveLength(2);
    retained[0]!.fail = true;

    expect(() => dropSurfaceRenderTargetArenaContext(arena, true))
      .toThrow("render-target lease release failed");
    expect(retained[1]!.released).toBe(true);

    retained[0]!.fail = false;
    dropSurfaceRenderTargetArenaContext(arena, true);
    expect(retained[0]!.released).toBe(true);
  });

  it("preserves the larger lease when an in-place HDR shrink fails partway", () => {
    const recorded = recordingGovernor();
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena(recorded.governor);
    ensureHdrRenderTarget(arena, context(gl), 40, 20);
    gl.failRenderbufferStorageOnce = true;

    expect(() => ensureHdrRenderTarget(arena, context(gl), 20, 10))
      .toThrow("renderbuffer storage failed");

    expect(recorded.replacements.value).toBe(1);
    expect(recorded.cancelled.value).toBe(1);
    expect(recorded.released.value).toBe(0);
    const allocationsAfterFailure = calls(gl, "texImage2D").length;
    // Published dimensions still describe the old target, but its color was
    // already shrunk. It must be repaired rather than returned as reusable.
    ensureHdrRenderTarget(arena, context(gl), 40, 20);
    expect(calls(gl, "texImage2D")).toHaveLength(allocationsAfterFailure + 1);
    expect(recorded.replacements.value).toBe(2);
    expect(recorded.released.value).toBe(1);
    ensureHdrRenderTarget(arena, context(gl), 20, 10);
    expect(recorded.replacements.value).toBe(3);
    expect(recorded.released.value).toBe(2);
  });

  it("preserves the larger transmission lease across an attempted failed shrink copy", () => {
    const recorded = recordingGovernor();
    const gl = new FakeGl();
    const arena = createSurfaceRenderTargetArena(recorded.governor);
    copyTransmissionScreenColorTexture(arena, context(gl), 40, 20, 0, 0, false);
    gl.failCopyOnce = true;

    expect(() => copyTransmissionScreenColorTexture(
      arena, context(gl), 20, 10, 0, 0, false,
    )).toThrow("copy failed");

    expect(recorded.replacements.value).toBe(1);
    expect(recorded.cancelled.value).toBe(1);
    // The original durable storage lease remains active. The GPU-local copy
    // does not consume CPU-to-GPU upload admission.
    expect(recorded.released.value).toBe(0);
    expect(recorded.costs.slice(-2)).toEqual([
      { persistentGpuBytes: 3_200, transientPeakBytes: 3_200 },
      { persistentGpuBytes: 800, transientPeakBytes: 800 },
    ]);

    copyTransmissionScreenColorTexture(arena, context(gl), 20, 10, 0, 0, false);
    expect(recorded.replacements.value).toBe(2);
    expect(recorded.released.value).toBe(1);
  });
});
