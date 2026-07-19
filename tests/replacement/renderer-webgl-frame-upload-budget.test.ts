import { describe, expect, it } from "vitest";
import { FrameUploadBudgetOwner } from "../../packages/renderer-webgl/src/resource/frame-upload-budget";

describe("frame upload byte budget", () => {
  it("admits deterministic byte traffic and resets only at the next frame", () => {
    const owner = new FrameUploadBudgetOwner(10);
    expect(owner.tryAdmit(6)).toBe(true);
    expect(owner.tryAdmit(5)).toBe(false);
    expect(owner.tryAdmit(4)).toBe(true);
    expect(owner.snapshot()).toEqual({
      admittedBytes: 10,
      budgetBytes: 10,
      deferredUploads: 1,
    });
    owner.beginFrame();
    expect(owner.snapshot()).toEqual({
      admittedBytes: 0,
      budgetBytes: 10,
      deferredUploads: 0,
    });
  });

  it("admits one oversized upload into an empty frame so work cannot starve", () => {
    const owner = new FrameUploadBudgetOwner(10);
    expect(owner.tryAdmit(12)).toBe(true);
    expect(owner.tryAdmit(1)).toBe(false);
    expect(owner.snapshot()).toEqual({
      admittedBytes: 12,
      budgetBytes: 10,
      deferredUploads: 1,
    });
  });
});
