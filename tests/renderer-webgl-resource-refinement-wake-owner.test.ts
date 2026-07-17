import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResourceRefinementWakeOwner,
  resourceRefinementWakeDelay,
} from "../packages/renderer-webgl/src/resource-refinement-wake-owner";

afterEach(() => {
  vi.useRealTimers();
});

describe("resource refinement wake policy", () => {
  it("wakes first and urgent refinements immediately and bounds intermediate latency", () => {
    expect(resourceRefinementWakeDelay({ elapsedMs: 0, firstWake: true, urgent: false })).toBe(0);
    expect(resourceRefinementWakeDelay({ elapsedMs: 0, firstWake: false, urgent: true })).toBe(0);
    expect(resourceRefinementWakeDelay({ elapsedMs: 25, firstWake: false, urgent: false })).toBe(75);
    expect(resourceRefinementWakeDelay({ elapsedMs: 100, firstWake: false, urgent: false })).toBe(0);
  });

  it("cancels superseded timers and makes disposal terminal", async () => {
    vi.useFakeTimers();
    let now = 0;
    const invalidate = vi.fn();
    const owner = new ResourceRefinementWakeOwner({ invalidate, now: () => now });

    owner.request();
    expect(invalidate).toHaveBeenCalledOnce();
    owner.acknowledgeFrame();

    now = 10;
    owner.request();
    owner.acknowledgeFrame();
    await vi.advanceTimersByTimeAsync(100);
    expect(invalidate).toHaveBeenCalledOnce();

    owner.request();
    owner.request(true);
    expect(invalidate).toHaveBeenCalledTimes(2);
    owner.dispose();
    await vi.advanceTimersByTimeAsync(100);
    owner.request(true);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
