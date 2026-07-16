import { describe, expect, it, vi } from "vitest";
import { VirtualTextureDemandOwner } from "../packages/renderer-webgl/src/virtual-texture/demand-owner";
import type { VirtualTextureGpuArena } from "../packages/renderer-webgl/src/virtual-texture/gpu-arena";
import type {
  VirtualTextureFramePublication,
  VirtualTextureRuntimeShell,
} from "../packages/renderer-webgl/src/virtual-texture/runtime-shell";
import type { VirtualTextureRuntimeState } from "../packages/renderer-webgl/src/virtual-texture/runtime";

describe("virtual texture demand publication owner", () => {
  it("preserves the transaction failure while completing every close step", () => {
    const primary = new Error("admission failed");
    const consume = vi.fn(() => { throw new Error("outcome close failed"); });
    const schedule = vi.fn(() => { throw new Error("request schedule failed"); });
    const clearFinishedFrame = vi.fn();
    const state = { manifest: {} } as VirtualTextureRuntimeState;
    const publication: VirtualTextureFramePublication = {
      admissions: [state],
      commits: new Map(),
      demanded: new Set([state]),
    };
    const runtime = {
      clearFinishedFrame,
      finishFrame: () => publication,
      requests: { schedule },
      resources: new Map(),
    } as unknown as VirtualTextureRuntimeShell;
    const owner = new VirtualTextureDemandOwner({
      consumeGpuOutcomes: consume,
      ensureGpuResource: () => { throw primary; },
      frame: () => 1,
      gpu: {} as VirtualTextureGpuArena,
      recordUnsupported: () => undefined,
      runtime,
    });

    expect(() => owner.finishFrame(true)).toThrow(primary);
    expect(consume).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
    expect(clearFinishedFrame).toHaveBeenCalledOnce();
  });
});
