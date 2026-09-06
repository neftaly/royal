import { afterEach, expect, it, vi } from "vitest";
import { mesh, boxGeometry, unlitMaterial, sceneOverlay } from "@royal/renderer-core";
import { SurfaceGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { canvasRootHarness, emptyScene } from "./support/canvas-root-harness";

afterEach(() => vi.restoreAllMocks());

it.each(["replace", "dispose"] as const)("does not publish an overlay after its ref callback requests %s", (action) => {
  const { root, listenerErrors } = canvasRootHarness();
  root.setScene(emptyScene());
  const publish = vi.spyOn(SurfaceGpuOwner.prototype, "setScene");
  try {
    root.setOverlay(sceneOverlay({ nodes: [mesh({
      geometry: boxGeometry(1),
      material: unlitMaterial({ color: [1, 0, 0, 1] }),
      ref: (handle) => {
        if (handle === null) return;
        if (action === "replace") root.setOverlay(null);
        else root.dispose();
      },
    })] }));
    expect(listenerErrors).toEqual([]);
    expect(publish.mock.calls.filter(([value]) => value !== null)).toEqual([]);
  } finally {
    root.dispose();
  }
});
