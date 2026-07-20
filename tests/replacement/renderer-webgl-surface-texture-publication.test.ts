import {
  imageTexture,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  unlitMaterial,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { SurfaceGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import {
  decodedTextureKey,
  type TextureSourceRef,
} from "../../packages/renderer-webgl/src/texture/asset-owner";
import { WebGlStateOwner } from "../../packages/renderer-webgl/src/webgl/state-owner";
import { fakeGl } from "./support/canvas-root-harness";

describe("retained surface texture publication", () => {
  it("replaces a resident binding when the shader feature set stays unchanged", () => {
    let activeUnit = 0;
    const bound: Array<WebGLTexture | null | undefined> = [];
    const drawnTextures: Array<WebGLTexture | null | undefined> = [];
    const createdTextures = [{ id: "first" }, { id: "second" }] as unknown as WebGLTexture[];
    const gl = fakeGl();
    gl.createTexture
      .mockReturnValueOnce(createdTextures[0]!)
      .mockReturnValueOnce(createdTextures[1]!);
    vi.mocked(gl.activeTexture).mockImplementation((unit: number) => {
      activeUnit = unit - gl.TEXTURE0;
    });
    vi.mocked(gl.bindTexture).mockImplementation((target: number, texture: WebGLTexture | null) => {
      if (target === gl.TEXTURE_2D) bound[activeUnit] = texture;
    });
    gl.drawElements.mockImplementation(() => { drawnTextures.push(bound[0]); });

    const first = imageTexture("/first.png");
    const second = imageTexture("/second.png");
    const decoded = (asset: TextureSourceRef) => ({
      height: 2,
      source: { src: asset.kind === "asset" ? asset.src : asset.label } as unknown as ImageBitmap,
      width: 2,
    });
    const prepare = (texture: typeof first) => prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: unlitMaterial({ texture }),
      })],
    }), undefined, undefined, decoded);
    const firstScene = prepare(first);
    const secondScene = prepare(second);
    const owner = new SurfaceGpuOwner(gl);
    const state = new WebGlStateOwner(gl);
    const views = [{
      view: identityMat4(),
      viewProjection: identityMat4(),
      viewport: { height: 100, width: 100, x: 0, y: 0 },
    }];

    owner.setScene(firstScene);
    owner.beginFrame();
    owner.drawViews(views, null, state, [0, 0, 0, 1]);
    expect(drawnTextures.at(-1)).toBe(createdTextures[0]);

    owner.publishTextureScene(secondScene, decodedTextureKey(second));
    owner.beginFrame();
    owner.drawViews(views, null, state, [0, 0, 0, 1]);
    expect(drawnTextures.at(-1)).toBe(createdTextures[1]);

    owner.dispose();
  });
});
