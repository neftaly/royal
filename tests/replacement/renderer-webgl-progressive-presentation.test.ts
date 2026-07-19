import { describe, expect, it, vi } from "vitest";
import { progressivePresentationDecision } from "../../packages/renderer-webgl/src/frame/progressive-presentation";
import { ProgressivePresentationOwner } from "../../packages/renderer-webgl/src/frame/progressive-presentation-owner";

describe("progressive presentation policy", () => {
  it("presents the first and urgent changes immediately and bounds intermediate delay", () => {
    expect(progressivePresentationDecision(-Infinity, 20, 100)).toEqual({
      delayMs: 0,
      present: true,
    });
    expect(progressivePresentationDecision(20, 45, 100)).toEqual({
      delayMs: 75,
      present: false,
    });
    expect(progressivePresentationDecision(20, 120, 100)).toEqual({
      delayMs: 0,
      present: true,
    });
    expect(progressivePresentationDecision(20, 45, 100, true).present).toBe(true);
  });

  it("owns one timer, publishes settled content now, and cancels on reset", () => {
    let now = 0;
    let delayed: (() => void) | undefined;
    const cancelDelay = vi.fn();
    const present = vi.fn();
    const requestDelay = vi.fn((callback: () => void) => {
      delayed = callback;
      return 7;
    });
    const owner = new ProgressivePresentationOwner({
      cancelDelay,
      intervalMs: 100,
      now: () => now,
      onFailure: vi.fn(),
      present,
      requestDelay,
    });

    owner.changed();
    expect(present).toHaveBeenCalledTimes(1);
    now = 10;
    owner.changed();
    owner.changed();
    expect(requestDelay).toHaveBeenCalledOnce();
    expect(requestDelay).toHaveBeenCalledWith(expect.any(Function), 90);
    owner.settled();
    expect(cancelDelay).toHaveBeenCalledWith(7);
    expect(present).toHaveBeenCalledTimes(2);

    now = 20;
    owner.changed();
    expect(requestDelay).toHaveBeenCalledTimes(2);
    owner.reset();
    delayed?.();
    expect(present).toHaveBeenCalledTimes(2);
  });
});
