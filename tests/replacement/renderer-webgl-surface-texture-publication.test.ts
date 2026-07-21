import {
  boxGeometry,
  imageTexture,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  triangleGeometry,
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
  textureStorageKey,
  type DecodedTextureSource,
  type TextureSourceRef,
} from "../../packages/renderer-webgl/src/texture/asset-owner";
import { WebGlStateOwner } from "../../packages/renderer-webgl/src/webgl/state-owner";
import { fakeGl } from "./support/canvas-root-harness";
import { assertFuzz, forEachFuzzCase } from "../fuzz";

describe("retained surface texture publication", () => {
  it("preserves exact GPU bindings across randomized progressive batches", () => {
    forEachFuzzCase({
      cases: 16,
      envName: "ROYAL_TEXTURE_BINDING_FUZZ_CASES",
      seed: 0xb1ad_1d5,
    }, ({ random }) => {
      let activeUnit = 0;
      const bound: Array<WebGLTexture | null | undefined> = [];
      const uploadedAssetByTexture = new Map<WebGLTexture, number>();
      const draws: Array<readonly [count: number, texture: WebGLTexture | null | undefined]> = [];
      const gl = fakeGl();
      vi.mocked(gl.createTexture).mockImplementation(() => ({} as WebGLTexture));
      vi.mocked(gl.activeTexture).mockImplementation((unit: number) => {
        activeUnit = unit - gl.TEXTURE0;
      });
      vi.mocked(gl.bindTexture).mockImplementation((target: number, texture: WebGLTexture | null) => {
        if (target === gl.TEXTURE_2D) bound[activeUnit] = texture;
      });
      vi.mocked(gl.texSubImage2D).mockImplementation((...args: unknown[]) => {
        const source = args.at(-1) as { readonly assetIndex?: number };
        const texture = bound[activeUnit];
        if (texture !== null && texture !== undefined && source.assetIndex !== undefined) {
          uploadedAssetByTexture.set(texture, source.assetIndex);
        }
      });
      gl.drawElements.mockImplementation((_mode, count) => {
        draws.push([count, bound[0]]);
      });

      const assets = Array.from({ length: 16 }, (_value, index) => imageTexture({
        src: `/gpu-publication-${index}.avif`,
        version: `revision-${index}`,
      }));
      const authored = scene({
        camera: perspectiveCamera({ position: [0, 0, 3] }),
        nodes: assets.map((texture, index) => {
          const vertexCount = (index + 1) * 3;
          const positions = Array<number>(vertexCount * 3);
          const textureCoordinates = Array<number>(vertexCount * 2);
          for (let vertex = 0; vertex < vertexCount; vertex += 1) {
            const corner = vertex % 3;
            positions[vertex * 3] = corner === 1 ? 1 : 0;
            positions[vertex * 3 + 1] = corner === 2 ? 1 : 0;
            positions[vertex * 3 + 2] = 0;
            textureCoordinates[vertex * 2] = corner === 1 ? 1 : 0;
            textureCoordinates[vertex * 2 + 1] = corner === 2 ? 1 : 0;
          }
          return mesh({
            geometry: triangleGeometry({ positions, textureCoordinates }),
            material: unlitMaterial({ texture }),
          });
        }),
      });
      const decoded = new Map<string, DecodedTextureSource>();
      const resolve = (asset: TextureSourceRef): DecodedTextureSource | undefined =>
        decoded.get(decodedTextureKey(asset));
      let prepared = prepareCanonicalSurfaceScene(authored, undefined, undefined, resolve);
      const owner = new SurfaceGpuOwner(gl);
      const state = new WebGlStateOwner(gl);
      const views = [{
        view: identityMat4(),
        viewProjection: identityMat4(),
        viewport: { height: 100, width: 100, x: 0, y: 0 },
      }];
      const remaining = assets.map((_asset, index) => index);
      owner.setScene(prepared);

      try {
        while (remaining.length > 0) {
          const batch: string[] = [];
          const count = Math.min(remaining.length, random.int(1, 6));
          for (let offset = 0; offset < count; offset += 1) {
            const selected = random.int(0, remaining.length);
            const assetIndex = remaining.splice(selected, 1)[0]!;
            const asset = assets[assetIndex]!;
            const key = decodedTextureKey(asset);
            decoded.set(key, {
              height: 2,
              source: { assetIndex } as unknown as ImageBitmap,
              width: 2,
            });
            batch.push(key);
          }
          prepared = refreshCanonicalSurfaceTextures(prepared, batch, resolve);
          owner.publishTextureBatch(prepared, batch);
          draws.length = 0;
          owner.beginFrame();
          owner.drawViews(views, null, state, [0, 0, 0, 1]);

          for (const [indexCount, texture] of draws) {
            const assetIndex = indexCount / 3 - 1;
            if (!decoded.has(decodedTextureKey(assets[assetIndex]!))) continue;
            assertFuzz(
              texture !== null
                && texture !== undefined
                && uploadedAssetByTexture.get(texture) === assetIndex,
              `surface ${assetIndex} drew another asset's resident texture`,
            );
          }
        }
      } finally {
        owner.dispose();
      }
    });
  });

  it("fuzzes out-of-order publication without crossing authored identities", () => {
    const geometry = planeGeometry(1);
    const assets = Array.from(
      { length: 24 },
      (_value, index) => imageTexture({
        src: `/publication-${index}.avif`,
        version: `revision-${index}`,
      }),
    );
    const authored = scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: assets.map((texture) => mesh({
        geometry,
        material: unlitMaterial({ texture }),
      })),
    });

    forEachFuzzCase({
      cases: 32,
      envName: "ROYAL_TEXTURE_PUBLICATION_FUZZ_CASES",
      seed: 0x7e87_1d3a,
    }, ({ random }) => {
      const decoded = new Map<string, DecodedTextureSource>();
      const resolve = (asset: TextureSourceRef): DecodedTextureSource | undefined =>
        decoded.get(decodedTextureKey(asset));
      let prepared = prepareCanonicalSurfaceScene(authored, undefined, undefined, resolve);
      const remaining = assets.map((_asset, index) => index);
      while (remaining.length > 0) {
        const batch: string[] = [];
        const count = Math.min(remaining.length, random.int(1, 6));
        for (let offset = 0; offset < count; offset += 1) {
          const selected = random.int(0, remaining.length);
          const assetIndex = remaining.splice(selected, 1)[0]!;
          const asset = assets[assetIndex]!;
          const key = decodedTextureKey(asset);
          decoded.set(key, {
            height: 2,
            source: { assetIndex } as unknown as ImageBitmap,
            width: 2,
          });
          batch.push(key);
        }
        prepared = refreshCanonicalSurfaceTextures(prepared, batch, resolve);
        for (let surfaceIndex = 0; surfaceIndex < assets.length; surfaceIndex += 1) {
          const asset = assets[surfaceIndex]!;
          const binding = prepared.surfaces[surfaceIndex]!.material.baseColorTexture;
          const expected = decoded.get(decodedTextureKey(asset));
          assertFuzz(
            (binding === undefined) === (expected === undefined),
            `surface ${surfaceIndex} publication readiness crossed identity`,
          );
          if (binding === undefined || expected === undefined) continue;
          assertFuzz(
            binding.storageKey === textureStorageKey(asset),
            `surface ${surfaceIndex} storage key crossed identity`,
          );
          assertFuzz(
            binding.decoded === expected,
            `surface ${surfaceIndex} decoded source crossed identity`,
          );
        }
      }
    });
  });

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
