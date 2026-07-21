import {
  boxGeometry,
  imageTexture,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  unlitMaterial,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  prepareCanonicalSurfaceScene,
  refreshCanonicalSurfaceTextures,
} from "../../packages/renderer-webgl/src/surface/scene-lowering";
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

    owner.publishTextureBatch(secondScene, [decodedTextureKey(second)]);
    owner.beginFrame();
    owner.drawViews(views, null, state, [0, 0, 0, 1]);
    expect(drawnTextures.at(-1)).toBe(createdTextures[1]);

    owner.dispose();
  });

  it("rebinds exact resident textures after a later upload mutates WebGL unit zero", () => {
    let activeUnit = 0;
    const bound: Array<WebGLTexture | null | undefined> = [];
    const draws: Array<readonly [count: number, texture: WebGLTexture | null | undefined]> = [];
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
    gl.drawElements.mockImplementation((_mode, count) => {
      draws.push([count, bound[0]]);
    });

    const first = imageTexture("/first.png");
    const second = imageTexture("/second.png");
    const authored = scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [
        mesh({ geometry: planeGeometry(1), material: unlitMaterial({ texture: first }) }),
        mesh({ geometry: boxGeometry(1), material: unlitMaterial({ texture: second }) }),
      ],
    });
    const decoded = new Map<TextureSourceRef, {
      height: number;
      source: ImageBitmap;
      width: number;
    }>();
    const decodedSource = (asset: TextureSourceRef) => decoded.get(asset);
    const pending = prepareCanonicalSurfaceScene(authored, undefined, undefined, decodedSource);
    const owner = new SurfaceGpuOwner(gl);
    const state = new WebGlStateOwner(gl);
    const views = [{
      view: identityMat4(),
      viewProjection: identityMat4(),
      viewport: { height: 100, width: 100, x: 0, y: 0 },
    }];
    const draw = (): void => {
      draws.length = 0;
      owner.beginFrame();
      owner.drawViews(views, null, state, [0, 0, 0, 1]);
    };

    owner.setScene(pending);
    draw();
    decoded.set(first, { height: 2, source: {} as ImageBitmap, width: 2 });
    const firstReady = refreshCanonicalSurfaceTextures(
      pending,
      [decodedTextureKey(first)],
      decodedSource,
    );
    owner.publishTextureBatch(firstReady, [decodedTextureKey(first)]);
    draw();
    expect(draws.find(([count]) => count === 6)?.[1]).toBe(createdTextures[0]);

    decoded.set(second, { height: 2, source: {} as ImageBitmap, width: 2 });
    const bothReady = refreshCanonicalSurfaceTextures(
      firstReady,
      [decodedTextureKey(second)],
      decodedSource,
    );
    owner.publishTextureBatch(bothReady, [decodedTextureKey(second)]);
    draw();
    expect(draws.find(([count]) => count === 6)?.[1]).toBe(createdTextures[0]);
    expect(draws.find(([count]) => count === 36)?.[1]).toBe(createdTextures[1]);

    owner.dispose();
  });
});
