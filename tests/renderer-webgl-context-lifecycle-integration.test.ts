import { afterEach, describe, expect, it, vi } from "vitest";
import { perspectiveCamera, scene, type RenderRoot } from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import { GltfInstanceTransformRegistry } from "../packages/renderer-webgl/src/gltf/instance-transform-registry";
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebGL root context lifecycle integration", () => {
  it("serializes a reentrant loss behind the restoring transition", () => {
    const canvas = createWebGlTestCanvas(createStrictWebGl2Context().gl);
    const root = createWebGlRoot(canvas);
    const first: string[] = [];
    const second: string[] = [];
    root.observeContextLifecycle((snapshot) => {
      first.push(snapshot.lifecycle);
      if (snapshot.lifecycle === "restoring") canvas.dispatchContextEvent("webglcontextlost");
    });
    root.observeContextLifecycle((snapshot) => second.push(snapshot.lifecycle));

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");

    expect(first).toEqual(["active", "lost", "restoring", "lost"]);
    expect(second).toEqual(["active", "lost", "restoring", "lost"]);
    expect(root.contextSnapshot()).toEqual({
      generation: 3,
      lifecycle: "lost",
      losses: 2,
      restores: 0,
    });
    expect(canvas.contextRequests).toHaveLength(1);
    root.dispose();
  });

  it("cancels restoration when a restoring observer disposes the root", () => {
    const canvas = createWebGlTestCanvas(createStrictWebGl2Context().gl);
    const root = createWebGlRoot(canvas);
    const first: string[] = [];
    const second: string[] = [];
    root.observeContextLifecycle((snapshot) => {
      first.push(snapshot.lifecycle);
      if (snapshot.lifecycle === "restoring") root.dispose();
    });
    root.observeContextLifecycle((snapshot) => second.push(snapshot.lifecycle));

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");

    expect(first).toEqual(["active", "lost", "restoring", "disposed"]);
    expect(second).toEqual(["active", "lost", "restoring", "disposed"]);
    expect(root.contextSnapshot()).toEqual({
      generation: 3,
      lifecycle: "disposed",
      losses: 1,
      restores: 0,
    });
    expect(canvas.contextRequests).toHaveLength(1);
  });

  it("isolates opaque observer and reporter failures at and after disposal", () => {
    const reporter = vi.spyOn(console, "error").mockImplementation(() => {
      throw undefined;
    });
    const canvas = createWebGlTestCanvas(createStrictWebGl2Context().gl);
    const root = createWebGlRoot(canvas);
    const later: string[] = [];
    expect(() => root.observeContextLifecycle(() => { throw undefined; })).not.toThrow();
    root.observeContextLifecycle((snapshot) => later.push(snapshot.lifecycle));

    canvas.dispatchContextEvent("webglcontextlost");
    expect(later).toEqual(["active", "lost"]);
    expect(reporter).toHaveBeenCalledTimes(2);
    expect(() => root.dispose()).not.toThrow();
    expect(reporter).toHaveBeenCalledTimes(3);

    let terminalCalls = 0;
    expect(() => root.observeContextLifecycle((snapshot) => {
      terminalCalls += 1;
      expect(snapshot.lifecycle).toBe("disposed");
      expect(Object.isFrozen(snapshot)).toBe(true);
      throw undefined;
    })).not.toThrow();
    expect(terminalCalls).toBe(1);
    expect(reporter).toHaveBeenCalledTimes(4);
    canvas.dispatchContextEvent("webglcontextrestored");
    expect(terminalCalls).toBe(1);
  });

  it("completes the frame epilogue when instance-transform endFrame throws", () => {
    const endFrame = GltfInstanceTransformRegistry.prototype.endFrame;
    const marker = new Error("endFrame failed");
    let attempts = 0;
    vi.spyOn(GltfInstanceTransformRegistry.prototype, "endFrame")
      .mockImplementation(function (this: GltfInstanceTransformRegistry, committed) {
        endFrame.call(this, committed);
        attempts += 1;
        if (attempts === 1) throw marker;
      });
    const { gl } = createStrictWebGl2Context();
    const root = createWebGlRoot(createWebGlTestCanvas(gl));

    expect(() => root.render(emptyScene())).toThrow(marker);
    expect(root.frame).toBe(1);
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, null);
    expect(gl.bindVertexArray).toHaveBeenLastCalledWith(null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ARRAY_BUFFER, null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ELEMENT_ARRAY_BUFFER, null);

    expect(() => root.render(emptyScene())).not.toThrow();
    expect(root.frame).toBe(2);
    root.dispose();
  });

  it("completes context-drop cleanup when instance-transform endFrame throws", () => {
    const endFrame = GltfInstanceTransformRegistry.prototype.endFrame;
    const marker = new Error("drop endFrame failed");
    let injected = false;
    vi.spyOn(GltfInstanceTransformRegistry.prototype, "endFrame")
      .mockImplementation(function (this: GltfInstanceTransformRegistry, committed) {
        endFrame.call(this, committed);
        if (!injected && !committed) {
          injected = true;
          throw marker;
        }
      });
    const canvas = createWebGlTestCanvas(createStrictWebGl2Context().gl);
    const root = createWebGlRoot(canvas);
    const transitions: string[] = [];
    root.observeContextLifecycle((snapshot) => transitions.push(snapshot.lifecycle));

    expect(() => canvas.dispatchContextEvent("webglcontextlost")).toThrow(marker);
    expect(root.contextLifecycle).toBe("lost");
    expect(transitions).toEqual(["active", "lost"]);

    expect(() => canvas.dispatchContextEvent("webglcontextrestored")).not.toThrow();
    expect(root.contextLifecycle).toBe("active");
    expect(() => root.render(emptyScene())).not.toThrow();
    expect(() => root.dispose()).not.toThrow();
  });
});
