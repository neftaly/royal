import { describe, expect, it, vi } from "vitest";
import { resolveCanvasSize } from "../packages/renderer-webgl/src/frame/canvas-size";
import {
  CanvasRoot,
  type CanvasRootPlatform,
} from "../packages/renderer-webgl/src/runtime/canvas-root";

type FakeGl = WebGL2RenderingContext & {
  readonly bindFramebuffer: ReturnType<typeof vi.fn>;
  readonly clear: ReturnType<typeof vi.fn>;
  readonly clearColor: ReturnType<typeof vi.fn>;
  readonly viewport: ReturnType<typeof vi.fn>;
};

const fakeGl = (): FakeGl => {
  const gl = {
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    FRAMEBUFFER: 0x8d40,
    MAX_RENDERBUFFER_SIZE: 0x84e8,
    MAX_VIEWPORT_DIMS: 0x0d3a,
    SCISSOR_TEST: 0x0c11,
    STENCIL_BUFFER_BIT: 0x0400,
    bindFramebuffer: vi.fn(),
    clear: vi.fn(),
    clearColor: vi.fn(),
    clearDepth: vi.fn(),
    clearStencil: vi.fn(),
    colorMask: vi.fn(),
    depthMask: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    getParameter: vi.fn((parameter: number) => parameter === 0x0d3a
      ? new Int32Array([4096, 4096])
      : 4096),
    scissor: vi.fn(),
    stencilMask: vi.fn(),
    viewport: vi.fn(),
  };
  return gl as unknown as FakeGl;
};

class FakeCanvas extends EventTarget {
  height = 150;
  width = 300;
  readonly gl: FakeGl;

  constructor(gl = fakeGl()) {
    super();
    this.gl = gl;
  }

  getContext(kind: string): WebGL2RenderingContext | null {
    return kind === "webgl2" ? this.gl : null;
  }
}

const harness = () => {
  const callbacks: Array<() => void> = [];
  const canvas = new FakeCanvas();
  const listenerErrors: unknown[] = [];
  const scheduledFailures: unknown[] = [];
  const platform: CanvasRootPlatform = {
    onListenerError: (error) => listenerErrors.push(error),
    reportScheduledFailure: (error) => scheduledFailures.push(error),
    requestFrame: (callback) => callbacks.push(callback),
  };
  const root = new CanvasRoot(canvas as unknown as HTMLCanvasElement, {}, platform);
  return { callbacks, canvas, listenerErrors, root, scheduledFailures };
};

describe("canvas size selection", () => {
  it("preserves aspect while fitting the capability ceiling", () => {
    expect(resolveCanvasSize(
      { cssHeight: 1000, cssWidth: 2000, devicePixelRatio: 2 },
      { maxHeight: 1000, maxWidth: 1000 },
    )).toMatchObject({
      backingHeight: 500,
      backingWidth: 1000,
      renderScale: 0.25,
    });
  });

  it("represents a hidden canvas without inventing a drawable pixel", () => {
    expect(resolveCanvasSize(
      { cssHeight: 0, cssWidth: 300, devicePixelRatio: 2 },
      { maxHeight: 4096, maxWidth: 4096 },
    )).toMatchObject({ backingHeight: 0, backingWidth: 0, renderScale: 0 });
  });
});

describe("clear-only canvas root", () => {
  it("coalesces commits and applies only changed clear state", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 360, cssWidth: 640, devicePixelRatio: 1 });
    root.setClearColor([0.25, 0.5, 1.5, 1]);
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(root.getSnapshot()).toMatchObject({
      frame: 1,
      size: { backingHeight: 360, backingWidth: 640 },
    });
    expect(canvas.gl.viewport).toHaveBeenCalledTimes(1);
    expect(canvas.gl.clearColor).toHaveBeenCalledTimes(1);

    root.invalidate();
    callbacks.shift()!();
    expect(root.getSnapshot().frame).toBe(2);
    expect(canvas.gl.viewport).toHaveBeenCalledTimes(1);
    expect(canvas.gl.clearColor).toHaveBeenCalledTimes(1);
    expect(canvas.gl.clear).toHaveBeenCalledTimes(2);
  });

  it("does not allocate a new public snapshot until observable state changes", () => {
    const { callbacks, root } = harness();
    const initial = root.getSnapshot();
    expect(root.getSnapshot()).toBe(initial);
    root.invalidate();
    expect(root.getSnapshot()).toBe(initial);
    root.setSize({ cssHeight: 10, cssWidth: 20, devicePixelRatio: 1 });
    const sized = root.getSnapshot();
    expect(sized).not.toBe(initial);
    expect(root.getSnapshot()).toBe(sized);
    callbacks.shift()!();
    expect(root.getSnapshot()).not.toBe(sized);
  });

  it("blocks stale work on loss and reconstructs the current clear intent on restore", () => {
    const { callbacks, canvas, root } = harness();
    const phases: string[] = [];
    root.subscribe(() => phases.push(root.getSnapshot().context.phase));
    root.setSize({ cssHeight: 20, cssWidth: 30, devicePixelRatio: 1 });
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    callbacks.shift()!();
    expect(canvas.gl.clear).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(phases).toContain("lost");
    expect(phases).toContain("restoring");
    expect(phases).toContain("active");
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(canvas.gl.clear).toHaveBeenCalledTimes(1);
    expect(root.getSnapshot()).toMatchObject({
      context: { generation: 2, interruptions: 1, recoveries: 1 },
      frame: 1,
    });
  });

  it("captures scheduled draw failure without advancing the frame", () => {
    const { callbacks, canvas, root, scheduledFailures } = harness();
    canvas.gl.clear.mockImplementationOnce(() => {
      throw new Error("context command failed");
    });
    root.setSize({ cssHeight: 20, cssWidth: 30, devicePixelRatio: 1 });
    callbacks.shift()!();
    expect(scheduledFailures).toHaveLength(1);
    expect(root.getSnapshot()).toMatchObject({
      frame: 0,
      lastFrameFailure: "context command failed",
    });
  });

  it("publishes disposal once and rejects later imperative work", () => {
    const { root } = harness();
    const phases: string[] = [];
    root.subscribe(() => phases.push(root.getSnapshot().context.phase));
    root.dispose();
    root.dispose();
    expect(phases).toEqual(["disposed"]);
    expect(() => root.invalidate()).toThrow("disposed Royal renderer root");
    expect(() => root.setSize({ cssHeight: 1, cssWidth: 1, devicePixelRatio: 1 }))
      .toThrow("disposed Royal renderer root");
  });
});
