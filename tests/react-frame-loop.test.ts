import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameLoop } from "../packages/react/src/frame";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("React frame loop", () => {
  it("skips subscribers unsubscribed earlier in the same frame", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const frameLoop = createFrameLoop();
    let unsubscribeSecond = (): void => {};
    const first = vi.fn(() => {
      unsubscribeSecond();
    });
    const second = vi.fn();
    frameLoop.subscribe(first, 0);
    unsubscribeSecond = frameLoop.subscribe(second, 1);

    frameCallbacks[0]?.(16);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("skips remaining frame subscribers after dispose", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const frameLoop = createFrameLoop();
    const first = vi.fn(() => {
      frameLoop.dispose();
    });
    const second = vi.fn();
    frameLoop.subscribe(first, 0);
    frameLoop.subscribe(second, 1);

    frameCallbacks[0]?.(16);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
