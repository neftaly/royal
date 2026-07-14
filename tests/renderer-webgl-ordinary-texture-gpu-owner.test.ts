import { describe, expect, it, vi } from "vitest";
import { OrdinaryTextureGpuOwner } from "../packages/renderer-webgl/src/ordinary-texture-gpu-owner";

describe("ordinary texture GPU owner", () => {
  it("settles every suppression and synchronizes observations after preserving the first failure", () => {
    const firstFailure = new Error("first suppression failed");
    const suppressed: string[] = [];
    const settled: string[] = [];
    const releaseWakeSuppression = vi.fn();
    const synchronizeGovernorObservations = vi.fn();
    const wakePersistentGpuCapacity = vi.fn();
    const owner = new OrdinaryTextureGpuOwner({
      capacityWakes: {
        suppressPersistentGpuWake: () => releaseWakeSuppression,
        wakePersistentGpuCapacity,
      },
      residencyIntent: {
        finishFrame: () => ["first", "second"],
      },
      synchronizeGovernorObservations,
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
    expect(synchronizeGovernorObservations).toHaveBeenCalledOnce();
    expect(wakePersistentGpuCapacity).toHaveBeenCalledOnce();
    expect(releaseWakeSuppression).toHaveBeenCalledOnce();
  });
});
