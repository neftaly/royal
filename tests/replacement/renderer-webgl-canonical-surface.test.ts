import {
  boxGeometry,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  standardMaterial,
  unlitMaterial,
} from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import { prepareCanonicalGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";

describe("canonical direct surface lowering", () => {
  it("lowers planes and boxes to the same indexed triangle ABI", () => {
    const plane = prepareCanonicalGeometry(planeGeometry([2, 4]));
    const box = prepareCanonicalGeometry(boxGeometry([2, 4, 6]));
    expect(plane.positions).toEqual(new Float32Array([
      -1, -2, 0, 1, -2, 0, 1, 2, 0, -1, 2, 0,
    ]));
    expect(plane.indices).toHaveLength(6);
    expect(box.positions).toHaveLength(24);
    expect(box.indices).toHaveLength(36);
    expect(box.bounds).toEqual({ max: [1, 2, 3], min: [-1, -2, -3] });
  });

  it("keeps one node transform and identity while replacing only exact pick triangles", () => {
    const node = mesh({
      geometry: boxGeometry(2),
      material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      pickingGeometry: planeGeometry([4, 1]),
      pickingId: "hero",
      transform: { position: [1, 2, -3], rotation: [0.1, 0.2, 0.3] },
    });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      nodes: [node],
    }));
    const surface = prepared.surfaces[0]!;
    expect(surface.node).toBe(node);
    expect(surface.node.pickingId).toBe("hero");
    expect(surface.geometry.indices).toHaveLength(36);
    expect(surface.pickingGeometry.indices).toHaveLength(6);
    expect(surface.model.slice(12, 15)).toEqual([1, 2, -3]);
  });

  it("rejects unsupported material work before touching WebGL", () => {
    const renderScene = scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
      })],
    });
    expect(() => prepareCanonicalSurfaceScene(renderScene)).toThrow(
      "does not yet support standard materials",
    );
  });
});
