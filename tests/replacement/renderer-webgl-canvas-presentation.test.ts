import { describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  createCameraViewResource,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  sceneOverlay,
  unlitMaterial,
} from "@royal/renderer-core";
import { SurfaceGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { canvasRootHarness as harness } from "./support/canvas-root-harness";

describe("canvas presentation", () => {
  it("continues view-dependent work while progressive surface publication is pending", () => {
    const { callbacks, root } = harness();
    let steps = 3;
    const original = SurfaceGpuOwner.prototype.drawViews;
    const draw = vi.spyOn(SurfaceGpuOwner.prototype, "drawViews").mockImplementation(function (this: SurfaceGpuOwner, ...args) {
      original.apply(this, args);
      return --steps > 0;
    });
    const pending = vi.spyOn(SurfaceGpuOwner.prototype, "surfacePublicationsPending").mockImplementation(() => steps > 0);
    const viewPending = vi.spyOn(SurfaceGpuOwner.prototype, "viewWorkPending", "get").mockImplementation(() => steps > 0);
    const flush = vi.spyOn(SurfaceGpuOwner.prototype, "flushResourcePublications").mockReturnValue(true);
    try {
      root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
      root.setScene(scene({ camera: perspectiveCamera({}), nodes: [
        mesh({ geometry: planeGeometry(1), material: unlitMaterial({ color: [1, 0, 0, 1] }) }),
      ] }));
      for (let frame = 0; frame < 3; frame++) callbacks.shift()?.();
      expect(steps).toBe(0);
      expect(draw).toHaveBeenCalledTimes(3);
    } finally { root.dispose(); draw.mockRestore(); pending.mockRestore(); viewPending.mockRestore(); flush.mockRestore(); }
  });

  it("does not copy changing camera frames and rebuilds hover retention lazily", () => {
    const { callbacks, canvas, root } = harness();
    const camera = createCameraViewResource(perspectiveCamera({ position: [0, 0, 3] }));
    const material = unlitMaterial({ color: [1, 0, 0, 1] });
    try {
      root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
      root.setScene(scene({ camera, nodes: [mesh({ geometry: planeGeometry(1), material })] }));
      root.setOverlay(sceneOverlay({ nodes: [mesh({ geometry: boxGeometry(1), material })] }));
      callbacks.shift()!();
      canvas.gl.copyTexSubImage2D.mockClear();
      for (const x of [0.1, 0.2, 0.3]) {
        camera.position[0] = x;
        camera.commit();
        callbacks.shift()!();
      }
      expect(canvas.gl.copyTexSubImage2D).not.toHaveBeenCalled();
      root.setOverlay(sceneOverlay({ nodes: [mesh({ geometry: boxGeometry(2), material })] }));
      callbacks.shift()!();
      expect(canvas.gl.copyTexSubImage2D).toHaveBeenCalledOnce();
      canvas.gl.copyTexSubImage2D.mockClear();
      canvas.gl.drawArrays.mockClear();
      root.setOverlay(null);
      callbacks.shift()!();
      expect(canvas.gl.copyTexSubImage2D).not.toHaveBeenCalled();
      expect(canvas.gl.drawArrays).toHaveBeenCalledOnce();
    } finally {
      root.dispose();
    }
  });
});
