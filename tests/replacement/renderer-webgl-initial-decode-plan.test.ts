import { expect, it } from "vitest";
import { imageTexture, mesh, orthographicCamera, planeGeometry, scene, unlitMaterial } from "@royal/renderer-core";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { planInitialTextureDecodeBytes } from "../../packages/renderer-webgl/src/texture/initial-decode-plan";
import { decodedTextureKey } from "../../packages/renderer-webgl/src/texture/source";
import { ordinaryTextureStorageBytes } from "../../packages/renderer-webgl/src/texture/storage";

it("sizes the initial seed from projected size, preserving the preview floor", () => {
  const asset = imageTexture("/board.png");
  const prepared = prepareCanonicalSurfaceScene(scene({ camera: orthographicCamera({ left: -1, right: 1, top: 1, bottom: -1 }), nodes: [
    mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) }),
  ] }));
  const key = decodedTextureKey(asset);
  expect(planInitialTextureDecodeBytes(prepared, 1024, 1024).get(key)).toBe(ordinaryTextureStorageBytes(1024, 1024, true));
  expect(planInitialTextureDecodeBytes(prepared, 100, 100).get(key)).toBe(ordinaryTextureStorageBytes(256, 256, true));
  expect(planInitialTextureDecodeBytes(prepared, 8192, 8192).get(key)).toBe(ordinaryTextureStorageBytes(2048, 2048, true));
});

it("unions uses of one image instead of letting a small last instance lower its seed", () => {
  const asset = imageTexture("/shared.png"), material = unlitMaterial({ texture: asset });
  const prepared = prepareCanonicalSurfaceScene(scene({ camera: orthographicCamera({ left: -1, right: 1, top: 1, bottom: -1 }), nodes: [
    mesh({ geometry: planeGeometry(2), material }),
    mesh({ geometry: planeGeometry(0.1), material }),
  ] }));
  expect(planInitialTextureDecodeBytes(prepared, 1024, 1024).get(decodedTextureKey(asset)))
    .toBe(ordinaryTextureStorageBytes(1024, 1024, true));
});

it("does not size tiny distant instances from their combined screen bounds", () => {
  const asset = imageTexture("/instances.png");
  const prepared = prepareCanonicalSurfaceScene(scene({ camera: orthographicCamera({ left: -1, right: 1, top: 1, bottom: -1 }), nodes: [
    mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) }),
  ] }));
  const localModels = new Float32Array([
    0.02, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 1, 0, -0.8, 0, 0, 1,
    0.02, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 1, 0, 0.8, 0, 0, 1,
  ]);
  const instanced = { ...prepared, surfaces: prepared.surfaces.map(surface => ({ ...surface,
    instances: { key: "two", count: 2, localModels },
  })) };
  expect(planInitialTextureDecodeBytes(instanced, 1024, 1024).get(decodedTextureKey(asset)))
    .toBe(ordinaryTextureStorageBytes(256, 256, true));
});

it.each([0, 1, 2] as const)("does not enlarge seeds for bounds outside clip axis %s", axis => {
  const asset = imageTexture("/offscreen.png");
  const prepared = prepareCanonicalSurfaceScene(scene({ camera: orthographicCamera({ left: -1, right: 1, top: 1, bottom: -1 }), nodes: [
    mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) }),
  ] }));
  for (const direction of [-1, 1]) {
    const min: [number, number, number] = [-1, -1, -1];
    const max: [number, number, number] = [1, 1, 1];
    min[axis] += direction * 100000; max[axis] += direction * 100000;
    const hidden = { ...prepared, surfaces: prepared.surfaces.map(surface => ({ ...surface, worldBounds: { min, max } })) };
    expect(planInitialTextureDecodeBytes(hidden, 1024, 1024).get(decodedTextureKey(asset)))
      .toBe(ordinaryTextureStorageBytes(256, 256, true));
  }
});
