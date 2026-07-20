import {
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  standardMaterial,
} from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { SurfaceGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { WebGlStateOwner } from "../../packages/renderer-webgl/src/webgl/state-owner";
import { fakeGl } from "./support/canvas-root-harness";

describe("retained transmission visibility", () => {
  it("indexes visibility by transmission candidates rather than sparse scene indices", () => {
    const geometry = planeGeometry(1);
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [
        mesh({ geometry, material: standardMaterial({ color: [1, 1, 1, 1] }) }),
        mesh({ geometry, material: standardMaterial({ color: [1, 1, 1, 1] }) }),
      ],
    }));
    const transmitted = prepared.surfaces[1]!;
    const material = { ...transmitted.material, transmissionFactor: 1 };
    const surfaces = [
      prepared.surfaces[0]!,
      { ...transmitted, material, materialSource: material },
    ];
    const gl = fakeGl();
    const owner = new SurfaceGpuOwner(gl);
    owner.setScene({ ...prepared, surfaces });
    owner.beginFrame();

    owner.drawViews([{
      view: identityMat4(),
      viewProjection: identityMat4(),
      viewport: { height: 100, width: 100, x: 0, y: 0 },
    }], null, new WebGlStateOwner(gl), [0, 0, 0, 1]);

    expect(gl.drawElements).toHaveBeenCalledTimes(2);
    owner.dispose();
  });

  it("shares the composite prepass decision with admitted transmission draws", () => {
    const geometry = planeGeometry(1);
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [
        mesh({
          geometry,
          material: standardMaterial({ color: [1, 1, 1, 1] }),
          transform: { position: [0, 0, 0] },
        }),
        mesh({
          geometry,
          material: standardMaterial({ color: [1, 1, 1, 1] }),
          transform: { position: [10, 0, 0] },
        }),
      ],
    }));
    const surfaces = prepared.surfaces.map((surface) => {
      const material = { ...surface.material, transmissionFactor: 1 };
      return { ...surface, material, materialSource: material };
    });
    const gl = fakeGl();
    const owner = new SurfaceGpuOwner(gl);
    owner.setScene({ ...prepared, surfaces });
    owner.beginFrame();

    owner.drawViews([{
      view: identityMat4(),
      viewProjection: identityMat4(),
      viewport: { height: 100, width: 100, x: 0, y: 0 },
    }], null, new WebGlStateOwner(gl), [0, 0, 0, 1]);

    expect(gl.drawElements).toHaveBeenCalledTimes(1);
    owner.dispose();
  });
});
