import {
  boxGeometry,
  directionalLight,
  gltf,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  standardMaterial,
  studioEnvironment,
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
    expect(surface.model.slice(12, 15)).toEqual([1, 2, -3]);
    expect(prepared.pickSurfaces[0]!.pickingGeometry.indices).toHaveLength(6);
    expect(prepared.pickSurfaces[0]!.node).toBe(surface.node);
  });

  it("prepares a glTF picking proxy without waiting for visible asset geometry", () => {
    const node = gltf({
      pickingGeometry: planeGeometry([4, 1]),
      pickingId: "loading-asset",
      src: "/model.glb",
      transform: { position: [1, 2, -3] },
    });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      nodes: [node],
    }));
    expect(prepared.surfaces).toHaveLength(0);
    expect(prepared.pickSurfaces).toHaveLength(1);
    expect(prepared.pickSurfaces[0]).toMatchObject({
      modelHandedness: 1,
      node,
    });
    expect(prepared.pickSurfaces[0]!.pickingGeometry.indices).toHaveLength(6);
  });

  it("normalizes standard material and directional-light state before touching WebGL", () => {
    const renderScene = scene({
      camera: perspectiveCamera({}),
      exposureEv100: 2,
      nodes: [
        {
          kind: "directional-light",
          color: [0.5, 0.25, 1, 1],
          direction: [0, -1, 0],
          illuminanceLux: 8,
        },
        mesh({
          geometry: planeGeometry(1),
          material: standardMaterial({
            color: [1, 0.5, 0.25, 1],
            metallic: 0.2,
            roughness: 0.7,
          }),
        }),
      ],
    });
    const prepared = prepareCanonicalSurfaceScene(renderScene);
    expect(prepared.directionalLights).toEqual([{
      color: [4, 2, 8, 1],
      direction: [0, -1, 0],
    }]);
    expect(prepared.exposure).toBeCloseTo(1 / 4.8);
    expect(prepared.surfaces[0]!.material).toEqual({
      baseColor: [1, 0.5, 0.25, 1],
      kind: "standard",
      metallicFactor: 0.2,
      roughnessFactor: 0.7,
    });
  });

  it("erases inert lighting state from unlit-only scenes", () => {
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      environment: studioEnvironment(),
      nodes: [
        directionalLight({ direction: [0, -1, 0], illuminanceLux: 100 }),
        mesh({
          geometry: planeGeometry(1),
          material: unlitMaterial({ color: [1, 1, 1, 1] }),
        }),
      ],
    }));
    expect(prepared.directionalLights).toEqual([]);
    expect(prepared.surfaces[0]!.material.kind).toBe("unlit");
  });

  it("fails unsupported environment work when a lit surface demands it", () => {
    expect(() => prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      environment: studioEnvironment(),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
      })],
    }))).toThrow("does not yet support scene environments");
  });
});
