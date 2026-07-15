import { describe, expect, it, vi } from "vitest";
import { OrdinaryTextureGpuOwner } from "../packages/renderer-webgl/src/texture/ordinary-gpu-owner";

describe("ordinary texture GPU owner", () => {
  it("skips the complete upload transaction while residency is idle", () => {
    const suppressPersistentGpuWake = vi.fn();
    const process = vi.fn();
    const owner = new OrdinaryTextureGpuOwner({
      capacityWakes: { suppressPersistentGpuWake },
      textures: { hasPendingWork: () => false, process },
    } as never);

    owner.processUploads();

    expect(process).not.toHaveBeenCalled();
    expect(suppressPersistentGpuWake).not.toHaveBeenCalled();
  });

  it("settles every suppression after preserving the first failure", () => {
    const firstFailure = new Error("first suppression failed");
    const suppressed: string[] = [];
    const settled: string[] = [];
    const releaseWakeSuppression = vi.fn();
    const wakePersistentGpuCapacity = vi.fn();
    const owner = new OrdinaryTextureGpuOwner({
      capacityWakes: {
        suppressPersistentGpuWake: () => releaseWakeSuppression,
        wakePersistentGpuCapacity,
      },
      residencyIntent: {
        finishFrame: () => ["first", "second"],
      },
      textures: {
        settleGpuReport: (report: { readonly key: string }) => {
          settled.push(report.key);
          return undefined;
        },
        suppressGpuResidency: (key: string) => {
          suppressed.push(key);
          return {
            capacityReleased: key === "second",
            key,
            operationFailure: key === "first" ? { error: firstFailure } : undefined,
          };
        },
      },
    } as never);

    expect(() => owner.finalizeResidencyIntent(true)).toThrow(firstFailure);
    expect(suppressed).toEqual(["first", "second"]);
    expect(settled).toEqual(["first", "second"]);
    expect(wakePersistentGpuCapacity).toHaveBeenCalledOnce();
    expect(releaseWakeSuppression).toHaveBeenCalledOnce();
  });
});
