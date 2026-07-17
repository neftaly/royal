import { afterEach, describe, expect, it, vi } from "vitest";
import { perspectiveCamera, scene, type RenderRoot } from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import { WebGlRenderClockOwner } from "../packages/renderer-webgl/src/render-clock-owner";
import { createStrictWebGl2Context, createWebGlTestCanvas } from "./webgl-test-harness";

const emptyScene = (): RenderRoot => scene({
  camera: perspectiveCamera({
    far: 10,
    fovY: Math.PI / 3,
    near: 0.1,
    position: [0, 0, 2],
    rotation: [0, 0, 0],
  }),
  nodes: [],
});

const scheduledFrames = (): FrameRequestCallback[] => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  }));
  return callbacks;
};

type ClockHarness = {
  active: boolean;
  contextGeneration: number;
  failures: unknown[];
  owner: WebGlRenderClockOwner;
  renders: number;
  scene: boolean;
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

describe("WebGL render-clock ownership", () => {
  it("force-flushes with zero or one external clock without leaving a duplicate frame", () => {
    const scheduled = scheduledFrames();
    const root = createWebGlRoot(createWebGlTestCanvas(createStrictWebGl2Context().gl));
    root.render(emptyScene());

    root.invalidate();
    expect(scheduled).toHaveLength(1);
    root.flushInvalidated();
    expect(root.frame).toBe(2);
    scheduled.shift()?.(16);
    expect(root.frame).toBe(2);

    const clock = root.acquireExternalRenderClock();
    root.invalidate();
    expect(scheduled).toHaveLength(0);
    root.flushInvalidated();
    expect(root.frame).toBe(3);

    clock.release();
    expect(scheduled).toHaveLength(0);
    root.dispose();
  });

  it("lets only the sole external clock flush, then resumes self-scheduling on release", () => {
    const scheduled = scheduledFrames();
    const root = createWebGlRoot(createWebGlTestCanvas(createStrictWebGl2Context().gl));
    root.render(emptyScene());
    const firstClock = root.acquireExternalRenderClock();
    const secondClock = root.acquireExternalRenderClock();

    root.invalidate();
    firstClock.flushInvalidated();
    expect(root.frame).toBe(1);
    expect(scheduled).toHaveLength(0);

    firstClock.release();
    firstClock.flushInvalidated();
    expect(root.frame).toBe(1);
    secondClock.flushInvalidated();
    expect(root.frame).toBe(2);
    expect(scheduled).toHaveLength(0);

    root.invalidate();
    secondClock.release();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.(16);
    expect(root.frame).toBe(3);
    root.dispose();
  });

  it("does not flush an unavailable or disposed context", () => {
    const scheduled = scheduledFrames();
    const canvas = createWebGlTestCanvas(createStrictWebGl2Context().gl);
    const root = createWebGlRoot(canvas);
    root.render(emptyScene());
    const clock = root.acquireExternalRenderClock();
    root.invalidate();

    canvas.dispatchContextEvent("webglcontextlost");
    root.flushInvalidated();
    clock.flushInvalidated();
    expect(root.frame).toBe(1);

    canvas.dispatchContextEvent("webglcontextrestored");
    expect(scheduled).toHaveLength(0);
    clock.flushInvalidated();
    expect(root.frame).toBe(2);
    clock.release();
    expect(scheduled).toHaveLength(0);

    root.dispose();
    root.flushInvalidated();
    clock.flushInvalidated();
    expect(root.frame).toBe(2);
    expect(() => root.acquireExternalRenderClock()).toThrow("disposed Royal renderer root");
  });
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
