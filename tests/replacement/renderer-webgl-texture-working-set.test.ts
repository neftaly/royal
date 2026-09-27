import { expect, it } from "vitest";
import { imageTexture, mesh, orthographicCamera, planeGeometry, scene, unlitMaterial } from "@royal/renderer-core";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { planTextureWorkingSet, visibleTextureWorkingSet } from "../../packages/renderer-webgl/src/surface/texture-working-set";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { textureStorageKey } from "../../packages/renderer-webgl/src/texture/source";

it("unions disjoint stereo views while keeping catalogue growth out of active residency", () => {
  const assets = Array.from({ length: 1000 }, (_, i) => imageTexture(`/art-${i}.png`));
  const prepared = prepareCanonicalSurfaceScene(scene({ camera: orthographicCamera({ left: -1, right: 1, bottom: -1, top: 1 }),
    nodes: assets.map((asset, i) => mesh({ geometry: planeGeometry(1), material: unlitMaterial({ texture: asset }),
      transform: { position: [i * 10, 0, 0] } })) }));
  const plan = planTextureWorkingSet(prepared);
  const matrix = identityMat4();
  const second = identityMat4(); second[12] = -9990;
  const view = (viewProjection: typeof matrix) => ({ view: matrix, viewProjection, viewport: { x: 0, y: 0, width: 100, height: 100 } });
  expect([...visibleTextureWorkingSet(plan, [view(matrix)], new Float32Array(24))]).toEqual([textureStorageKey(assets[0]!)]);
  expect(visibleTextureWorkingSet(plan, [view(matrix), view(second)], new Float32Array(24)))
    .toEqual(new Set([textureStorageKey(assets[0]!), textureStorageKey(assets[999]!)]));
  expect(visibleTextureWorkingSet(plan, [], new Float32Array(24)).size).toBe(0);
});
