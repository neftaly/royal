import { describe, expect, it } from "vitest";
import { FrameUploadBudgetOwner } from "../../packages/renderer-webgl/src/resource/frame-upload-budget";

describe("frame upload byte budget", () => {
  it("starts the work timer at the first upload, after unrelated frame preparation", () => {
    let now = 0;
    const owner = new FrameUploadBudgetOwner(1024, 2, () => now);
    owner.beginFrame();
    now = 20;
    expect(owner.tryAdmit(32)).toBe(true);
    now = 21;
    expect(owner.tryAdmit(32)).toBe(true);
    now = 22;
    expect(owner.tryAdmit(32)).toBe(false);
    owner.beginFrame();
    now = 40;
    expect(owner.tryAdmitAllocation()).toBe(true);
    now = 41;
    expect(owner.tryAdmit(32)).toBe(true);
    now = 42;
    expect(owner.tryAdmit(32)).toBe(false);
  });

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

  it("defers uploads after expensive allocation and guarantees progress next frame", () => {
    let now = 0;
    const owner = new FrameUploadBudgetOwner(1024, 2, () => now);
    expect(owner.tryAdmitAllocation()).toBe(true);
    now = 3;
    expect(owner.tryAdmitAllocation()).toBe(false);
    expect(owner.tryAdmit(32)).toBe(false);
    owner.beginFrame();
    expect(owner.tryAdmit(32)).toBe(true);
    now = 6;
    expect(owner.tryAdmit(32)).toBe(false);
    expect(owner.snapshot().admittedBytes).toBe(32);
    owner.beginFrame();
    expect(owner.tryAdmit(32)).toBe(true);
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
