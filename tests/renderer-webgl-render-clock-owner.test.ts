import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGlRenderClockOwner } from "../packages/renderer-webgl/src/render-clock-owner";

type ClockHarness = {
  active: boolean;
  contextGeneration: number;
  failures: unknown[];
  owner: WebGlRenderClockOwner;
  renders: number;
  scene: boolean;
};

const scheduledFrames = (): FrameRequestCallback[] => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  }));
  return callbacks;
};

const clockHarness = (renderFailure?: unknown): ClockHarness => {
  const harness: ClockHarness = {
    active: true,
    contextGeneration: 1,
    failures: [],
    owner: undefined as unknown as WebGlRenderClockOwner,
    renders: 0,
    scene: true,
  };
  harness.owner = new WebGlRenderClockOwner({
    contextGeneration: () => harness.contextGeneration,
    hasScene: () => harness.scene,
    isContextActive: () => harness.active,
    renderLatest: () => {
      harness.owner.beginRender();
      harness.renders += 1;
      if (renderFailure !== undefined) throw renderFailure;
    },
    reportScheduledFailure: (failure) => harness.failures.push(failure),
  });
  return harness;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL render clock owner", () => {
  it("coalesces invalidations and cancels a queued generation on immediate render", () => {
    const scheduled = scheduledFrames();
    const harness = clockHarness();

    harness.owner.invalidate();
    harness.owner.invalidate();
    expect(scheduled).toHaveLength(1);

    harness.owner.beginRender();
    scheduled.shift()?.(16);
    expect(harness.renders).toBe(0);

    harness.owner.invalidate();
    scheduled.shift()?.(32);
    expect(harness.renders).toBe(1);
  });

  it("arbitrates multiple external clocks and resumes internal scheduling", () => {
    const scheduled = scheduledFrames();
    const harness = clockHarness();
    const first = harness.owner.acquireExternalClock();
    const second = harness.owner.acquireExternalClock();

    harness.owner.invalidate();
    first.flushInvalidated();
    expect(harness.renders).toBe(0);
    first.release();
    second.flushInvalidated();
    expect(harness.renders).toBe(1);

    harness.owner.invalidate();
    second.release();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.(16);
    expect(harness.renders).toBe(2);
  });

  it("retains demand across context interruption and rejects stale generations", () => {
    const scheduled = scheduledFrames();
    const harness = clockHarness();

    harness.owner.invalidate();
    expect(scheduled).toHaveLength(1);
    harness.active = false;
    harness.contextGeneration += 1;
    harness.owner.interrupt();
    scheduled.shift()?.(16);
    expect(harness.renders).toBe(0);

    harness.active = true;
    harness.owner.resume();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.(32);
    expect(harness.renders).toBe(1);
  });

  it("routes scheduled failures, preserves direct flush failures, and terminates on dispose", () => {
    const scheduled = scheduledFrames();
    const failure = new Error("draw failed");
    const harness = clockHarness(failure);

    harness.owner.invalidate();
    expect(() => scheduled.shift()?.(16)).not.toThrow();
    expect(harness.failures).toEqual([failure]);

    harness.owner.invalidate();
    expect(() => harness.owner.flushInvalidated()).toThrow(failure);
    expect(harness.failures).toEqual([failure]);

    harness.owner.dispose();
    harness.owner.invalidate();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.(32);
    expect(harness.renders).toBe(2);
    expect(() => harness.owner.acquireExternalClock()).toThrow("disposed Royal renderer root");
  });
});
