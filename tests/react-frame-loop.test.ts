import { afterEach, describe, expect, it, vi } from "vitest";
import {
  perspectiveCamera,
  scene,
} from "@royal/renderer-core";
import { createFrameLoop, type FrameSnapshot } from "../packages/react/src/frame";
import {
  applyCanvasRendererFailure,
  applyCanvasRendererLifecycle,
} from "../packages/react/src/canvas-renderer-runtime";
import {
  acquireExternalRenderClockForRoyalRoot,
  createRendererRoot,
} from "../packages/react/src/root";
import { forEachFuzzCase } from "./fuzz";
import { fakeCanvas } from "./react-test-fixtures";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("React frame loop", () => {
  const camera = perspectiveCamera({
    far: 10,
    fovY: Math.PI / 3,
    near: 0.1,
    position: [0, 0, 2],
    rotation: [0, 0, 0],
  });

  it("normalizes opaque scheduled-render failures for ErrorBoundary delivery", () => {
    const report = vi.fn();
    const existing = new Error("existing");
    applyCanvasRendererFailure(report, existing);
    applyCanvasRendererFailure(report, undefined);
    applyCanvasRendererFailure(report, "capacity denied");

    expect(report.mock.calls[0]?.[0]).toBe(existing);
    expect(report.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      message: "Royal scheduled render failed without an error value",
    }));
    expect(report.mock.calls[2]?.[0]).toEqual(expect.objectContaining({
      message: "Royal scheduled render failed: capacity denied",
    }));
  });

  it("uses one RAF when a frame callback invalidates the renderer", () => {
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frameId: number) => {
      queuedFrames.delete(frameId);
    }));
    const root = createRendererRoot(fakeCanvas());
    const renderScene = scene({ camera, nodes: [] });
    root.render(renderScene);
    const frameLoop = createFrameLoop(() => undefined);
    let rendererClock: ReturnType<typeof acquireExternalRenderClockForRoyalRoot> | undefined;
    frameLoop.observeActivity((active) => {
      if (active) rendererClock ??= acquireExternalRenderClockForRoyalRoot(root);
      else {
        rendererClock?.release();
        rendererClock = undefined;
      }
    });
    frameLoop.afterFrame(() => rendererClock?.flushInvalidated());
    frameLoop.subscribe(() => {
      for (let mutation = 0; mutation < 8; mutation += 1) root.invalidate();
    }, 0);

    for (let frame = 1; frame <= 64; frame += 1) {
      expect(queuedFrames.size, `browser frame ${frame}`).toBe(1);
      const next = queuedFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
      expect(next).toBeDefined();
      if (next === undefined) break;
      queuedFrames.delete(next[0]);
      next[1](frame * 16);
    }

    expect(requestFrame).toHaveBeenCalledTimes(65);
    expect(root.frame).toBe(65);
    frameLoop.dispose();
    root.dispose();
  });

  it("does not flush the window clock while XR also owns the renderer", () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    }));
    const root = createRendererRoot(fakeCanvas());
    const renderScene = scene({ camera, nodes: [] });
    root.render(renderScene);
    const rendererClock = acquireExternalRenderClockForRoyalRoot(root);
    const releaseXrClock = acquireExternalRenderClockForRoyalRoot(root).release;

    root.invalidate();
    rendererClock.flushInvalidated();
    expect(root.frame).toBe(1);
    expect(queuedFrames).toHaveLength(0);

    releaseXrClock();
    rendererClock.flushInvalidated();
    expect(root.frame).toBe(2);
    expect(queuedFrames).toHaveLength(0);

    rendererClock.release();
    root.dispose();
  });

  it("hands a final in-frame mutation back after the after-frame flush", () => {
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frameId: number) => {
      queuedFrames.delete(frameId);
    }));
    const root = createRendererRoot(fakeCanvas());
    const renderScene = scene({ camera, nodes: [] });
    root.render(renderScene);
    const frameLoop = createFrameLoop(() => undefined);
    let rendererClock: ReturnType<typeof acquireExternalRenderClockForRoyalRoot> | undefined;
    frameLoop.observeActivity((active) => {
      if (active) rendererClock ??= acquireExternalRenderClockForRoyalRoot(root);
      else {
        rendererClock?.release();
        rendererClock = undefined;
      }
    });
    frameLoop.afterFrame(() => {
      root.render(renderScene);
    });
    let unsubscribe = (): void => {};
    unsubscribe = frameLoop.subscribe(() => {
      root.invalidate();
      unsubscribe();
    }, 0);

    const first = queuedFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
    expect(first).toBeDefined();
    if (first !== undefined) {
      queuedFrames.delete(first[0]);
      first[1](16);
    }

    expect(queuedFrames.size).toBe(0);
    expect(root.frame).toBe(2);
    frameLoop.dispose();
    root.dispose();
  });

  it("reports after-frame failures after every flush callback has run", () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const failure = new Error("renderer flush failed");
    const reportError = vi.fn();
    const laterFlush = vi.fn();
    const frameLoop = createFrameLoop(reportError);
    frameLoop.afterFrame(() => {
      throw failure;
    });
    frameLoop.afterFrame(laterFlush);
    frameLoop.subscribe(() => undefined, 0);

    queuedFrames.shift()?.(16);

    expect(laterFlush).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(failure);
    frameLoop.dispose();
  });

  it("reports an undefined after-frame throw", () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const reportError = vi.fn();
    const frameLoop = createFrameLoop(reportError);
    frameLoop.afterFrame(() => {
      throw undefined;
    });
    frameLoop.subscribe(() => undefined, 0);

    queuedFrames.shift()?.(16);

    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(undefined);
    frameLoop.dispose();
  });

  it("keeps scheduling and active-run counters coherent under randomized churn", () => {
    forEachFuzzCase({ cases: 32, seed: 0xf24a_c10c }, ({ label, random }) => {
      const queuedFrames = new Map<number, FrameRequestCallback>();
      let nextFrameId = 1;
      vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        queuedFrames.set(frameId, callback);
        return frameId;
      }));
      vi.stubGlobal("cancelAnimationFrame", vi.fn((frameId: number) => {
        queuedFrames.delete(frameId);
      }));
      const frameLoop = createFrameLoop(() => undefined);
      const releases: { active: boolean; readonly release: () => void }[] = [];
      const snapshots: { readonly frameIndex: number; readonly deltaMs: number; readonly elapsedSeconds: number }[] = [];
      const activity: boolean[] = [];
      frameLoop.observeActivity((active) => activity.push(active));
      let activeCount = 0;
      let expectedRunIndex = 0;

      for (let operation = 0; operation < 128; operation += 1) {
        const kind = random.pick(["subscribe", "unsubscribe", "fire"] as const);
        if (kind === "subscribe") {
          const record = { active: true, release: (): void => {} };
          record.release = frameLoop.subscribe((frame) => {
            snapshots.push(frame);
          }, random.int(-2, 3));
          releases.push(record);
          activeCount += 1;
        } else if (kind === "unsubscribe" && activeCount > 0) {
          const active = releases.filter((release) => release.active);
          const release = random.pick(active);
          release.active = false;
          release.release();
          activeCount -= 1;
          if (activeCount === 0) expectedRunIndex = 0;
        } else if (kind === "fire" && queuedFrames.size > 0) {
          const next = queuedFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
          if (next !== undefined) {
            queuedFrames.delete(next[0]);
            expectedRunIndex += 1;
            const snapshotStart = snapshots.length;
            next[1](operation * 17);
            for (const snapshot of snapshots.slice(snapshotStart)) {
              expect(snapshot.frameIndex, label).toBe(expectedRunIndex);
              if (expectedRunIndex === 1) {
                expect(snapshot.deltaMs, label).toBe(0);
                expect(snapshot.elapsedSeconds, label).toBe(0);
              }
            }
          }
        }

        expect(queuedFrames.size, `${label} operation=${operation}`).toBe(activeCount > 0 ? 1 : 0);
        expect(activity.at(-1), `${label} operation=${operation}`).toBe(activeCount > 0);
      }

      frameLoop.dispose();
      expect(queuedFrames.size, label).toBe(0);
    });
  });

  it("skips subscribers unsubscribed earlier in the same frame", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const frameLoop = createFrameLoop(() => undefined);
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

    const frameLoop = createFrameLoop(() => undefined);
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

  it("isolates a throwing subscriber and still flushes later frame work", () => {
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frameId: number) => {
      queuedFrames.delete(frameId);
    }));

    const failure = new Error("animation failed");
    const errors: unknown[] = [];
    const events: string[] = [];
    const healthyFrames: FrameSnapshot[] = [];
    const frameLoop = createFrameLoop((error) => errors.push(error));
    frameLoop.afterFrame(() => events.push("flush"));
    const failing = vi.fn(() => {
      events.push("failing");
      throw failure;
    });
    const healthy = vi.fn((frame: FrameSnapshot) => {
      healthyFrames.push(frame);
      events.push("healthy");
    });
    frameLoop.subscribe(failing, 0);
    const unsubscribeHealthy = frameLoop.subscribe(healthy, 1);

    const first = queuedFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
    expect(first).toBeDefined();
    if (first !== undefined) {
      queuedFrames.delete(first[0]);
      expect(() => first[1](16)).not.toThrow();
    }

    expect(events).toEqual(["failing", "healthy", "flush"]);
    expect(errors).toEqual([failure]);
    expect(queuedFrames.size).toBe(1);

    const second = queuedFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
    expect(second).toBeDefined();
    if (second !== undefined) {
      queuedFrames.delete(second[0]);
      second[1](32);
    }

    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(healthyFrames[0]).toBe(healthyFrames[1]);
    expect(events).toEqual(["failing", "healthy", "flush", "healthy", "flush"]);
    expect(errors).toEqual([failure]);

    unsubscribeHealthy();
    expect(queuedFrames.size).toBe(0);
  });

  it("pauses an active run without dropping subscribers and resumes on demand", () => {
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frameId: number) => {
      queuedFrames.delete(frameId);
    }));
    const activity: boolean[] = [];
    const errors: Error[] = [];
    const frames: Array<{ readonly deltaMs: number; readonly elapsedSeconds: number; readonly frameIndex: number }> = [];
    const frameLoop = createFrameLoop(() => undefined);
    frameLoop.observeActivity((active) => activity.push(active));
    frameLoop.subscribe((frame) => frames.push({
      deltaMs: frame.deltaMs,
      elapsedSeconds: frame.elapsedSeconds,
      frameIndex: frame.frameIndex,
    }), 0);
    const initial = queuedFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (initial !== undefined) {
      queuedFrames.delete(initial[0]);
      initial[1](16);
    }
    const staleFrame = queuedFrames.values().next().value as FrameRequestCallback | undefined;

    applyCanvasRendererLifecycle(
      frameLoop,
      (error) => errors.push(error),
      { generation: 2, lifecycle: "unavailable" },
    );
    expect(queuedFrames.size).toBe(0);
    staleFrame?.(10_000);
    expect(frames).toEqual([{ deltaMs: 0, elapsedSeconds: 0, frameIndex: 1 }]);
    expect(activity).toEqual([false, true]);

    applyCanvasRendererLifecycle(
      frameLoop,
      (error) => errors.push(error),
      { generation: 2, lifecycle: "available" },
    );
    expect(queuedFrames.size).toBe(1);
    const resumed = queuedFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (resumed !== undefined) {
      queuedFrames.delete(resumed[0]);
      resumed[1](10_032);
    }
    expect(frames).toEqual([
      { deltaMs: 0, elapsedSeconds: 0, frameIndex: 1 },
      { deltaMs: 0, elapsedSeconds: 0, frameIndex: 1 },
    ]);
    expect(queuedFrames.size).toBe(1);

    applyCanvasRendererLifecycle(
      frameLoop,
      (error) => errors.push(error),
      { error: "restore failed", generation: 2, lifecycle: "failed" },
    );
    expect(queuedFrames.size).toBe(0);
    expect(activity).toEqual([false, true]);
    expect(errors).toEqual([expect.objectContaining({ message: "restore failed" })]);
  });
});
