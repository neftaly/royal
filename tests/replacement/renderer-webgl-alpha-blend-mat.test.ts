import {
  boxGeometry, createCameraViewResource, mesh, orbitPerspectiveCamera, scene, unlitMaterial,
  type RenderObjectHandle,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { canvasRootHarness } from "./support/canvas-root-harness";

describe("BLEND mat presentation", () => {
  it.each([0.99998, 0.5])("retains correct draw order and alpha %s during camera and object motion", (alpha) => {
    const { callbacks, canvas, root } = canvasRootHarness();
    const cameraAt = (pitch: number, yaw: number) => orbitPerspectiveCamera({
      view: { pitch, yaw, target: [0, 0, 0], distance: 1 },
    });
    const camera = createCameraViewResource(cameraAt(Math.PI / 2, 0));
    const cardRef: { current: RenderObjectHandle | null } = { current: null };
    root.setSize({ cssHeight: 500, cssWidth: 700, pixelRatio: 1 });
    root.setScene(scene({
      camera,
      nodes: [
        mesh({
          geometry: boxGeometry([0.841, 0.002, 0.594]), transform: { position: [0, 0.001, 0] },
          material: unlitMaterial({ color: [0, 0, 1, alpha] }),
        }),
        mesh({
          geometry: boxGeometry([0.088, 0.002, 0.126]), transform: { position: [-0.3765, 0.0031, -0.234] },
          material: unlitMaterial({ color: [1, 0, 0, alpha] }), ref: cardRef,
        }),
        mesh({
          geometry: boxGeometry([0.088, 0.002, 0.126]), transform: { position: [-0.3765, 0.0031, -0.100] },
          material: unlitMaterial({ color: [0, 1, 0, alpha] }),
        }),
      ],
    }));
    const drawColors = () => {
      vi.mocked(canvas.gl.uniform4fv).mockClear();
      callbacks.shift()!();
      return vi.mocked(canvas.gl.uniform4fv).mock.calls
        .map(([, value]) => Array.from(value))
        .filter((value) => value.length === 4 && Math.abs(value[3]! - alpha) < 1e-6);
    };
    const expectMatFirst = () => {
      const colors = drawColors();
      expect(colors).toHaveLength(3);
      expect(colors[0]!.slice(0, 3)).toEqual([0, 0, 1]);
      expect(canvas.gl.depthMask).toHaveBeenLastCalledWith(false);
    };
    expectMatFirst();
    const uploads = canvas.gl.bufferData.mock.calls.length;
    for (const yaw of [0, Math.PI, 0]) {
      camera.set(cameraAt(0.6, yaw));
      expectMatFirst();
    }
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(uploads);

    // Ref updates publish new bounds without replacing the scene descriptor.
    cardRef.current!.setTransform({ position: [-0.3765, -0.003, -0.234] });
    const moved = drawColors();
    expect(moved.map((color) => color.slice(0, 3))).toEqual([
      [1, 0, 0], [0, 0, 1], [0, 1, 0],
    ]);
    cardRef.current!.setTransform({ position: [-0.3765, 0.0031, -0.234], scale: [-1, 1, 1] });
    expectMatFirst();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(uploads);

    // Removing a member and replacing material/pass membership must drop the old plan.
    root.setScene(scene({
      camera,
      nodes: [mesh({
        geometry: boxGeometry([0.088, 0.002, 0.126]),
        material: unlitMaterial({ color: [1, 1, 0, alpha] }),
      })],
    }));
    expect(drawColors().map((color) => color.slice(0, 3))).toEqual([[1, 1, 0]]);
    root.setScene(scene({ camera, nodes: [] }));
    expect(drawColors()).toEqual([]);
    root.dispose();
  });
});
