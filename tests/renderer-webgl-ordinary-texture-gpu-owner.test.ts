import { describe, expect, it, vi } from "vitest";
import { OrdinaryTextureGpuOwner } from "../packages/renderer-webgl/src/texture/ordinary-gpu-owner";

describe("ordinary texture GPU owner", () => {
  it("skips the complete upload transaction while residency is idle", () => {
    const blockGpuWake = vi.fn();
    const process = vi.fn();
    const owner = new OrdinaryTextureGpuOwner({
      capacityWakes: { blockGpuWake },
      textures: { hasPendingWork: () => false, process },
    } as never);

    owner.processUploads();

    expect(process).not.toHaveBeenCalled();
    expect(blockGpuWake).not.toHaveBeenCalled();
  });

  it("settles every suppression after preserving the first failure", () => {
    const firstFailure = new Error("first suppression failed");
    const suppressed: string[] = [];
    const settled: string[] = [];
    const blockGpuWake = vi.fn();
    const wakePersistentGpuCapacity = vi.fn();
    const owner = new OrdinaryTextureGpuOwner({
      capacityWakes: {
        blockGpuWake,
        wakePersistentGpuCapacity,
      },
      residencyIntent: {
        finishFrame: () => ["first", "second"],
        ordinaryRequiredKeys: () => new Set<string>(),
      },
      textures: {
        consumeGpuCapacityBlocked: () => false,
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
    expect(blockGpuWake.mock.calls).toEqual([[1], [-1]]);
  });

  it("evicts only unrequested residency after durable capacity pressure", () => {
    const suppressed: string[] = [];
    const required = new Set(["visible"]);
    const owner = new OrdinaryTextureGpuOwner({
      capacityWakes: {
        blockGpuWake: () => undefined,
        wakePersistentGpuCapacity: () => undefined,
      },
      residencyIntent: {
        finishFrame: () => [],
        ordinaryRequiredKeys: () => required,
      },
      textures: {
        collectUnrequestedGpuResidencyKeys: (observed: ReadonlySet<string>, output: string[]) => {
          expect(observed).toBe(required);
          output.push("hidden");
          return output;
        },
        consumeGpuCapacityBlocked: () => true,
        settleGpuReport: () => undefined,
        suppressGpuResidency: (key: string) => {
          suppressed.push(key);
          return { capacityReleased: true };
        },
      },
    } as never);

    owner.finalizeResidencyIntent(true);

    expect(suppressed).toEqual(["hidden"]);
  });
});
