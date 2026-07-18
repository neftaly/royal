import { describe, expect, it, vi } from "vitest";
import {
  mesh,
  gltf,
  perspectiveCamera,
  planeGeometry,
  scene,
  unlitMaterial,
  type RenderRoot,
} from "@royal/renderer-core";
import { resolveCanvasSize } from "../../packages/renderer-webgl/src/frame/canvas-size";
import {
  CanvasRoot,
  type CanvasRootPlatform,
} from "../../packages/renderer-webgl/src/runtime/canvas-root";
import {
  staticTriangleDocument,
  staticTriangleGlb,
} from "./support/static-glb";

type FakeGl = WebGL2RenderingContext & {
  readonly bindFramebuffer: ReturnType<typeof vi.fn>;
  readonly clear: ReturnType<typeof vi.fn>;
  readonly clearColor: ReturnType<typeof vi.fn>;
  readonly bufferData: ReturnType<typeof vi.fn>;
  readonly drawElements: ReturnType<typeof vi.fn>;
  readonly useProgram: ReturnType<typeof vi.fn>;
  readonly viewport: ReturnType<typeof vi.fn>;
};

const fakeGl = (): FakeGl => {
  const gl = {
    COLOR_BUFFER_BIT: 0x4000,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0be2,
    CCW: 0x0901,
    COMPILE_STATUS: 0x8b81,
    CULL_FACE: 0x0b44,
    DEPTH_TEST: 0x0b71,
    DEPTH_BUFFER_BIT: 0x0100,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    FRAMEBUFFER: 0x8d40,
    LEQUAL: 0x0203,
    LINK_STATUS: 0x8b82,
    MAX_RENDERBUFFER_SIZE: 0x84e8,
    MAX_VIEWPORT_DIMS: 0x0d3a,
    SCISSOR_TEST: 0x0c11,
    STATIC_DRAW: 0x88e4,
    STENCIL_TEST: 0x0b90,
    STENCIL_BUFFER_BIT: 0x0400,
    TRIANGLES: 0x0004,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_INT: 0x1405,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8b31,
    attachShader: vi.fn(),
    bindFramebuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bindVertexArray: vi.fn(),
    bufferData: vi.fn(),
    clear: vi.fn(),
    clearColor: vi.fn(),
    clearDepth: vi.fn(),
    clearStencil: vi.fn(),
    colorMask: vi.fn(),
    compileShader: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    cullFace: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteVertexArray: vi.fn(),
    depthMask: vi.fn(),
    depthFunc: vi.fn(),
    disable: vi.fn(),
    drawElements: vi.fn(),
    enable: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    frontFace: vi.fn(),
    getProgramInfoLog: vi.fn(() => ""),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    getShaderParameter: vi.fn(() => true),
    getParameter: vi.fn((parameter: number) => parameter === 0x0d3a
      ? new Int32Array([4096, 4096])
      : 4096),
    getUniformLocation: vi.fn(() => ({})),
    linkProgram: vi.fn(),
    scissor: vi.fn(),
    shaderSource: vi.fn(),
    stencilMask: vi.fn(),
    uniform4fv: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    useProgram: vi.fn(),
    vertexAttribPointer: vi.fn(),
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

  getBoundingClientRect(): DOMRect {
    return {
      bottom: 220,
      height: 200,
      left: 10,
      right: 310,
      top: 20,
      width: 300,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    };
  }
}

const harness = (platformOverrides: Partial<CanvasRootPlatform> = {}) => {
  const callbacks: Array<() => void> = [];
  const canvas = new FakeCanvas();
  const listenerErrors: unknown[] = [];
  const scheduledFailures: unknown[] = [];
  const platform: CanvasRootPlatform = {
    onListenerError: (error) => listenerErrors.push(error),
    reportScheduledFailure: (error) => scheduledFailures.push(error),
    requestFrame: (callback) => callbacks.push(callback),
    ...platformOverrides,
  };
  const root = new CanvasRoot(canvas as unknown as HTMLCanvasElement, {}, platform);
  return { callbacks, canvas, listenerErrors, root, scheduledFailures };
};

const emptyScene = (clearColor: RenderRoot["clearColor"] = [0, 0, 0, 0]): RenderRoot => ({
  camera: perspectiveCamera({}),
  clearColor,
  kind: "scene",
  nodes: [],
});

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
  it("rejects invalid and unknown creation options at the public boundary", () => {
    const canvas = new FakeCanvas();
    expect(() => new CanvasRoot(
      canvas as unknown as HTMLCanvasElement,
      { alpha: "yes" } as unknown as { alpha: boolean },
    )).toThrow("alpha must be a boolean");
    expect(() => new CanvasRoot(
      canvas as unknown as HTMLCanvasElement,
      { powerPreference: "high-performance" } as unknown as { alpha: boolean },
    )).toThrow("unsupported field powerPreference");
  });

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

  it("uploads one canonical surface once and reuses it across frames", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      })],
    }));
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(1);
    expect(canvas.gl.useProgram).toHaveBeenCalledTimes(1);
    root.invalidate();
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(canvas.gl.useProgram).toHaveBeenCalledTimes(1);

    const rebuiltScene = scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ color: [0.8, 0.2, 0.4, 1] }),
      })],
    });
    root.render(rebuiltScene);
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(3);
    expect(canvas.gl.useProgram).toHaveBeenCalledTimes(1);
  });

  it("uses one canonical transform and identity for visible and exact picking work", () => {
    const { callbacks, canvas, root } = harness();
    const node = mesh({
      geometry: planeGeometry([1, 1]),
      material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      pickingGeometry: planeGeometry([4, 1]),
      pickingId: "wide-hit-area",
    });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));

    const hit = root.pick({ clientX: 240.4, clientY: 120 });
    expect(hit?.point[0]).toBeCloseTo(1, 2);
    expect(hit?.target).toMatchObject({ kind: "mesh", node, pickingId: "wide-hit-area" });
    expect(root.pick({ clientX: 311, clientY: 120 })).toBeUndefined();
    expect(canvas.gl.bufferData).not.toHaveBeenCalled();

    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
  });

  it("matches visible backface culling during picking", () => {
    const { root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 2]),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        transform: { rotation: [0, Math.PI, 0] },
      })],
    }));
    expect(root.pick({ clientX: 160, clientY: 120 })).toBeUndefined();
  });

  it("publishes one asynchronously prepared GLB into the same draw and pick path", async () => {
    const document = staticTriangleDocument();
    document.nodes = [{ mesh: 0 }];
    document.scenes = [{ nodes: [0] }];
    const bytes = staticTriangleGlb(document);
    const readGltf = vi.fn(async () => bytes);
    const { callbacks, canvas, root } = harness({ readGltf });
    const node = gltf({ pickingId: "triangle", src: "/triangle.glb", version: "v1" });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));
    expect(root.getGltfAssetSnapshot(node.asset)).toEqual({ state: "loading" });

    await vi.waitFor(() => {
      expect(root.getGltfAssetSnapshot(node.asset)).toEqual({
        primitiveCount: 1,
        state: "ready",
      });
    });
    expect(readGltf).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(1);
    expect(root.pick({ clientX: 160, clientY: 120 })?.target).toMatchObject({
      kind: "gltf",
      node,
      pickingId: "triangle",
    });
  });

  it("lowers a semantic scene and rejects unsupported node kinds explicitly", () => {
    const { callbacks, root } = harness();
    root.setSize({ cssHeight: 10, cssWidth: 20, devicePixelRatio: 1 });
    root.render(emptyScene([0.2, 0.3, 0.4, 1]));
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(root.getSnapshot().frame).toBe(1);
    expect(() => root.render({
      ...emptyScene(),
      nodes: [{ kind: "not-implemented" }],
    } as unknown as RenderRoot)).toThrow("does not yet support not-implemented nodes");
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

  it("keeps lifecycle and size observers asleep during unrelated frames", () => {
    const { callbacks, canvas, root } = harness();
    const lifecycleListener = vi.fn();
    const sizeListener = vi.fn();
    root.subscribeLifecycle(lifecycleListener);
    root.subscribeSize(sizeListener);
    root.setSize({ cssHeight: 10, cssWidth: 20, devicePixelRatio: 1 });
    expect(sizeListener).toHaveBeenCalledTimes(1);
    callbacks.shift()!();
    expect(sizeListener).toHaveBeenCalledTimes(1);
    expect(lifecycleListener).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(lifecycleListener).toHaveBeenCalledTimes(1);
    expect(sizeListener).toHaveBeenCalledTimes(1);
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
