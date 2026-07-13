import { afterEach, describe, expect, it, vi } from "vitest";
import { perspectiveCamera, scene, type RenderRoot } from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
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

    const release = root.acquireExternalRenderClock();
    root.invalidate();
    expect(scheduled).toHaveLength(0);
    root.flushInvalidated();
    expect(root.frame).toBe(3);

    release();
    expect(scheduled).toHaveLength(0);
    root.dispose();
  });

  it("lets only the sole external clock flush, then resumes self-scheduling on release", () => {
    const scheduled = scheduledFrames();
    const root = createWebGlRoot(createWebGlTestCanvas(createStrictWebGl2Context().gl));
    root.render(emptyScene());
    const releaseFirst = root.acquireExternalRenderClock();
    const releaseSecond = root.acquireExternalRenderClock();

    root.invalidate();
    root.flushInvalidatedFromExternalClock();
    expect(root.frame).toBe(1);
    expect(scheduled).toHaveLength(0);

    releaseFirst();
    root.flushInvalidatedFromExternalClock();
    expect(root.frame).toBe(2);
    expect(scheduled).toHaveLength(0);

    root.invalidate();
    releaseSecond();
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
    const release = root.acquireExternalRenderClock();
    root.invalidate();

    canvas.dispatchContextEvent("webglcontextlost");
    root.flushInvalidated();
    root.flushInvalidatedFromExternalClock();
    expect(root.frame).toBe(1);

    canvas.dispatchContextEvent("webglcontextrestored");
    expect(scheduled).toHaveLength(0);
    root.flushInvalidatedFromExternalClock();
    expect(root.frame).toBe(2);
    release();
    expect(scheduled).toHaveLength(0);

    root.dispose();
    root.flushInvalidated();
    root.flushInvalidatedFromExternalClock();
    expect(root.frame).toBe(2);
    expect(() => root.acquireExternalRenderClock()).toThrow("disposed Royal renderer root");
  });
});
