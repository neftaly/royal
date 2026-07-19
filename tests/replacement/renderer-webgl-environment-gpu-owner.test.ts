import { describe, expect, it } from "vitest";
import { PrefilteredEnvironmentGpuOwner } from "../../packages/renderer-webgl/src/environment/gpu-owner";
import { parseRoyalEnvironmentKtx1 } from "../../packages/renderer-webgl/src/environment/royal-environment-ktx1";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { environmentKtx1Fixture } from "./support/environment-ktx1";
import { fakeGl } from "./support/canvas-root-harness";

describe("prefiltered environment GPU owner", () => {
  it("uploads borrowed packed faces once and releases its exact budget claim", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(1024);
    const prepared = parseRoyalEnvironmentKtx1(environmentKtx1Fixture(2).source);
    const owner = new PrefilteredEnvironmentGpuOwner(gl, budget);

    expect(owner.set(prepared)).toBe(true);
    expect(owner.binding).toMatchObject({ mipCount: 2, texture: { target: "cube" } });
    expect(owner.binding?.coefficients).toHaveLength(36);
    expect(gl.texStorage2D).toHaveBeenCalledWith(
      gl.TEXTURE_CUBE_MAP,
      2,
      gl.R11F_G11F_B10F,
      2,
      2,
    );
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(12);
    expect(budget.snapshot().retainedBytes).toBe(120);

    expect(owner.set(prepared)).toBe(false);
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(12);
    expect(owner.set(undefined)).toBe(true);
    expect(owner.binding).toBeUndefined();
    expect(budget.snapshot().retainedBytes).toBe(0);
    expect(gl.deleteTexture).toHaveBeenCalledOnce();
    expect(gl.deleteSampler).toHaveBeenCalledOnce();
  });

  it("keeps studio fallback available when the immutable budget denies the cubemap", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(100);
    const prepared = parseRoyalEnvironmentKtx1(environmentKtx1Fixture(2).source);
    const owner = new PrefilteredEnvironmentGpuOwner(gl, budget);

    expect(owner.set(prepared)).toBe(true);
    expect(owner.binding).toBeUndefined();
    expect(gl.createTexture).not.toHaveBeenCalled();
    expect(budget.snapshot()).toMatchObject({ deniedClaims: 1, retainedBytes: 0 });
    expect(owner.set(prepared)).toBe(false);
    expect(budget.snapshot()).toMatchObject({ deniedClaims: 1, retainedBytes: 0 });
  });
});
