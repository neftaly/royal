import { createCameraViewResource, mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { SurfaceGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { canvasRootHarness } from "./support/canvas-root-harness";

describe("canvas view preparation", () => {
  it.each(["camera", "timer"])("pumps preparation without redraws, responds to %s, and presents settled work immediately", trigger => {
    let pending = true;
    let viewWorkPending = true;
    const delays = new Map<object, () => void>();
    const viewPending = vi.spyOn(SurfaceGpuOwner.prototype, "viewWorkPending", "get")
      .mockImplementation(() => viewWorkPending);
    const prepare = vi.spyOn(SurfaceGpuOwner.prototype, "prepareViews")
      .mockImplementation(() => { viewWorkPending = pending; return pending; });
    const originalDraw = SurfaceGpuOwner.prototype.drawViews;
    const draw = vi.spyOn(SurfaceGpuOwner.prototype, "drawViews")
      .mockImplementation(function (this: SurfaceGpuOwner, ...args) {
        originalDraw.apply(this, args);
        return pending;
      });
    const { root, canvas, callbacks, scheduledFailures } = canvasRootHarness({
      now: () => 0,
      requestDelay: callback => {
        const handle = {};
        delays.set(handle, () => { delays.delete(handle); callback(); });
        return handle;
      },
      cancelDelay: handle => { delays.delete(handle as object); },
    });
    const camera = createCameraViewResource(perspectiveCamera({ position: [0, 0, 3] }));
    try {
      root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
      root.setScene(scene({ camera, nodes: [mesh({ geometry: planeGeometry(1), material: unlitMaterial({ color: [1, 1, 1, 1] }) })] }));
      callbacks.shift()!();
      draw.mockClear();
      canvas.gl.clear.mockClear();
      callbacks.shift()!();
      expect(prepare).toHaveBeenCalledOnce();
      expect(draw).not.toHaveBeenCalled();
      expect(canvas.gl.clear).not.toHaveBeenCalled();
      expect(delays.size).toBe(1);

      if (trigger === "camera") {
        camera.position[0] = 0.5;
        camera.commit();
      } else delays.values().next().value!();
      callbacks.shift()!();
      expect(draw).toHaveBeenCalledOnce();
      expect(delays.size).toBe(0);

      callbacks.shift()!();
      expect(draw).toHaveBeenCalledOnce();
      pending = false;
      callbacks.shift()!();
      expect(draw).toHaveBeenCalledTimes(2);
      expect(delays.size).toBe(0);
      // Urgent invalidation may leave one harmless scheduled frame.
      while (callbacks.length) callbacks.shift()!();
      expect(draw).toHaveBeenCalledTimes(2);
      expect(scheduledFailures).toEqual([]);
    } finally {
      root.dispose();
      draw.mockRestore(); prepare.mockRestore(); viewPending.mockRestore();
    }
  });
});
