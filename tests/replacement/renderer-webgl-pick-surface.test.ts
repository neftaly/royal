import { describe, expect, it } from "vitest";
import {
  imageTexture,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  unlitMaterial,
} from "@royal/renderer-core";
import { canvasRootHarness } from "./support/canvas-root-harness";

describe("public pick surface", () => {
  it("returns rendered base-colour texture coordinates without adding them to proxy picks", () => {
    const { root } = canvasRootHarness();
    const texture = imageTexture("/paintable.svg");
    const rendered = mesh({
      geometry: planeGeometry([1, 1]),
      material: unlitMaterial({ texture }),
    });
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [rendered],
    }));
    expect(root.pick({ clientX: 160, clientY: 120 })?.surface).toEqual({
      baseColorTextureCoordinates: [0.5, 0.5],
      normal: [0, 0, 1],
      source: "rendered",
    });

    const proxy = mesh({
      geometry: planeGeometry([1, 1]),
      material: unlitMaterial({ texture }),
      pickingGeometry: planeGeometry([1, 1]),
    });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [proxy],
    }));
    expect(root.pick({ clientX: 160, clientY: 120 })?.surface)
      .toEqual({ normal: [0, 0, 1], source: "picking-proxy" });
    root.dispose();
  });
});
