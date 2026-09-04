import { describe, expect, it, vi } from "vitest";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { SurfaceCompositeOwner } from "../../packages/renderer-webgl/src/surface/surface-composite-owner";
import { WebGlStateOwner } from "../../packages/renderer-webgl/src/webgl/state-owner";
import { fakeGl } from "./support/canvas-root-harness";

describe("surface composite depth sampling", () => {
  it("uses an LDR throwaway color attachment for direct-presentation occlusion", () => {
    const gl = Object.assign(fakeGl(), { texParameteri: vi.fn() });
    const budget = new PersistentGpuBudgetOwner();
    const state = new WebGlStateOwner(gl);
    const owner = new SurfaceCompositeOwner(gl, budget, {
      hasFloatBlendTarget: true,
      hasFloatColorTarget: true,
    });

    expect(owner.ensureOcclusionDepth(32, 16, state)).toBe(true);
    expect(gl.texStorage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      1,
      gl.RGBA8,
      32,
      16,
    );
    expect(gl.createProgram).not.toHaveBeenCalled();
    expect(budget.snapshot().retainedBytes).toBe(32 * 16 * 8);
    expect(owner.beginDepthSampling().texture).not.toBeNull();
    owner.dispose();
  });

  it("owns sampleable depth and brackets framebuffer feedback", () => {
    const gl = Object.assign(fakeGl(), { texParameteri: vi.fn() });
    const budget = new PersistentGpuBudgetOwner();
    const state = new WebGlStateOwner(gl);
    const owner = new SurfaceCompositeOwner(gl, budget, {
      hasFloatBlendTarget: false,
      hasFloatColorTarget: false,
    });
    owner.setSceneColorRequired(false);
    owner.setDepthSamplingRequired(true);

    expect(owner.ensure(32, 16, state, false, true)).toBe(true);
    const binding = owner.beginDepthSampling();
    expect(binding).toMatchObject({ sampler: null, target: "2d" });
    expect(binding.texture).not.toBeNull();
    expect(gl.framebufferTexture2D).toHaveBeenLastCalledWith(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      null,
      0,
    );

    owner.endDepthSampling(state, 0);
    expect(gl.framebufferTexture2D).toHaveBeenLastCalledWith(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      binding.texture,
      0,
    );
    expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_2D, null);
    owner.dispose();
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("keeps the renderbuffer depth path when no feature samples depth", () => {
    const gl = Object.assign(fakeGl(), { texParameteri: vi.fn() });
    const state = new WebGlStateOwner(gl);
    const owner = new SurfaceCompositeOwner(gl, new PersistentGpuBudgetOwner(), {
      hasFloatBlendTarget: false,
      hasFloatColorTarget: false,
    });
    owner.setSceneColorRequired(false);

    expect(owner.ensure(32, 16, state)).toBe(true);
    expect(gl.createRenderbuffer).toHaveBeenCalledTimes(1);
    expect(gl.framebufferRenderbuffer).toHaveBeenCalledTimes(1);
    expect(() => owner.beginDepthSampling()).toThrow(/sampleable composite depth/);
    owner.dispose();
  });
});
