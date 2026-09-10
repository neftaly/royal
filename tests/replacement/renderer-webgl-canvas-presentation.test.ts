import { describe, expect, it } from "vitest";
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
import { canvasRootHarness as harness } from "./support/canvas-root-harness";

describe("canvas presentation", () => {
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
