import { describe, expect, it, vi } from "vitest";
import { PrefilteredEnvironmentGpuOwner } from "../../packages/renderer-webgl/src/environment/gpu-owner";
import {
  MAX_ROYAL_ENVIRONMENT_GPU_BYTES,
  parseRoyalEnvironmentKtx1,
  royalEnvironmentGpuByteLength,
} from "../../packages/renderer-webgl/src/environment/royal-environment-ktx1";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { SurfaceGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { ScreenSpacePartitionPatternOwner } from "../../packages/renderer-webgl/src/surface/screen-space-partition-pattern";
import { environmentKtx1Fixture } from "./support/environment-ktx1";
import { fakeGl } from "./support/canvas-root-harness";

describe("prefiltered environment GPU owner", () => {
  it("does not create a lazily requested owner after the environment is deselected", async () => {
    const gl = fakeGl();
    const prepared = parseRoyalEnvironmentKtx1(environmentKtx1Fixture(2).source);
    const budget = new PersistentGpuBudgetOwner();
    const owner = new SurfaceGpuOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );

    expect(owner.setPrefilteredEnvironment(prepared)).toBe(false);
    expect(owner.setPrefilteredEnvironment(undefined)).toBe(false);
    await import("../../packages/renderer-webgl/src/environment/gpu-owner");
    await Promise.resolve();

    expect(gl.texSubImage2D).not.toHaveBeenCalled();
    owner.dispose();
  });

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
    const uploads = vi.mocked(gl.texSubImage2D).mock.calls;
    expect(new Set(uploads.map((upload) => upload[8]))).toHaveLength(1);
    expect(uploads.map((upload) => upload[9])).toEqual(
      prepared.levels.flatMap((level) => level.faces.map((face) => face.byteOffset / 4)),
    );
    expect(royalEnvironmentGpuByteLength(prepared)).toBe(120);
    expect(MAX_ROYAL_ENVIRONMENT_GPU_BYTES).toBe(2_097_144);
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
