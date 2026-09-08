import {
  boxGeometry,
  imageTexture,
  mesh,
  orbitPerspectiveCamera,
  perspectiveCamera,
  planeGeometry,
  scene,
  triangleGeometry,
  unlitMaterial,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { identityMat4, multiplyMat4Into, projectionMat4, viewMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  createCanonicalRenderObjectUpdateWorkspace,
  updateCanonicalRenderObjectTransform,
} from "../../packages/renderer-webgl/src/surface/render-object-scene-update";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import {
  prepareCanonicalSurfaceScene,
  refreshCanonicalSurfaceTextures,
} from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { SurfaceGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { SurfaceGeometryGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-geometry-gpu-owner";
import { ScreenSpacePartitionPatternOwner } from "../../packages/renderer-webgl/src/surface/screen-space-partition-pattern";
import {
  decodedTextureKey,
  textureStorageKey,
  type DecodedTextureSource,
  type TextureSourceRef,
} from "../../packages/renderer-webgl/src/texture/asset-owner";
import { WebGlStateOwner } from "../../packages/renderer-webgl/src/webgl/state-owner";
import type { VirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime-contract";
import { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS } from "../../packages/renderer-webgl/src/virtual-texture/shader-source";
import { fakeGl } from "./support/canvas-root-harness";
import { assertFuzz, forEachFuzzCase } from "../fuzz";

const TEST_VIEWS = [{
  view: identityMat4(),
  viewProjection: identityMat4(),
  viewport: { height: 100, width: 100, x: 0, y: 0 },
}];

const createSurfaceGpuOwner = (
  gl: WebGL2RenderingContext,
  budget = new PersistentGpuBudgetOwner(),
): SurfaceGpuOwner => new SurfaceGpuOwner(
  gl,
  budget,
  new ScreenSpacePartitionPatternOwner(gl, budget),
);

describe("retained surface texture publication", () => {
  it("draws the ordinary preview until VT compilation finishes and requests the switching frame", () => {
    const gl = fakeGl();
    vi.mocked(gl.getExtension).mockImplementation((name) => String(name) === "KHR_parallel_shader_compile"
      ? { COMPLETION_STATUS_KHR: 0x91b1 } as unknown as WEBGL_multi_draw : null);
    let complete = false;
    vi.mocked(gl.getProgramParameter).mockImplementation((_program, parameter) => parameter === 0x91b1 ? complete : true);
    vi.mocked(gl.getUniformLocation).mockImplementation((_program, name) => ({ name }) as unknown as WebGLUniformLocation);
    const owner = createSurfaceGpuOwner(gl);
    const state = new WebGlStateOwner(gl);
    const texture = imageTexture("/preview.png");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({ geometry: planeGeometry(1), material: unlitMaterial({ texture }) })],
    }), undefined, undefined, () => ({ width: 32, height: 32, source: {} as ImageBitmap }));
    const binding = {
      atlas: { texture: gl.createTexture(), sampler: null, target: gl.TEXTURE_2D },
      pageTable: { texture: gl.createTexture(), sampler: null, target: gl.TEXTURE_2D },
      settings0: new Float32Array(4), settings1: new Float32Array(4), settings2: new Float32Array(4),
    };
    const runtime = {
      bindingRevision: 1,
      shaderSource: { declarations: VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS },
      automaticBinding: () => binding,
      setScene: vi.fn(), dispose: vi.fn(),
      update: () => ({ pending: false, webGlStateChanged: false }),
    } as unknown as VirtualTextureRuntime;
    const draw = () => {
      owner.beginFrame();
      return owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1]);
    };
    const virtualUploads = () => vi.mocked(gl.uniform4fv).mock.calls.filter(([location]) =>
      (location as unknown as { name: string }).name === "virtualSettings0");
    try {
      owner.setScene(prepared);
      owner.setVirtualTextureRuntime(runtime);
      expect(draw()).toBe(true);
      expect(gl.drawElements).toHaveBeenCalled();
      expect(virtualUploads()).toHaveLength(0);
      const links = vi.mocked(gl.linkProgram).mock.calls.length;
      expect(draw()).toBe(true);
      expect(virtualUploads()).toHaveLength(0);
      expect(gl.linkProgram).toHaveBeenCalledTimes(links);
      complete = true;
      expect(draw()).toBe(false);
      expect(virtualUploads()).toHaveLength(1);
      expect(draw()).toBe(false);
      expect(gl.linkProgram).toHaveBeenCalledTimes(links);
    } finally { owner.dispose(); }
  });

  it("invalidates blended bounds when an object moves during an unrelated pending texture batch", () => {
    const camera = orbitPerspectiveCamera({ view: { pitch: Math.PI / 2, distance: 1 } });
    const texture = imageTexture("/unrelated.png");
    const card = mesh({
      geometry: boxGeometry([0.088, 0.002, 0.126]),
      material: unlitMaterial({ color: [1, 0, 0, 0.5] }),
      transform: { position: [-0.3, 0.0031, -0.2] },
      ref: { current: null },
    });
    const pending = prepareCanonicalSurfaceScene(scene({
      camera,
      nodes: [
        mesh({
          geometry: boxGeometry([0.841, 0.002, 0.594]),
          material: unlitMaterial({ color: [0, 0, 1, 0.5] }),
          transform: { position: [0, 0.001, 0] },
        }),
        card,
        mesh({ geometry: planeGeometry(0.1), material: unlitMaterial({ texture }) }),
      ],
    }), undefined, undefined, () => ({ width: 2, height: 2, source: {} as ImageBitmap }));
    const gl = fakeGl();
    const colors = new Map<WebGLProgram, number[]>();
    let currentProgram: WebGLProgram | null = null;
    let submittedColors: number[][] = [];
    vi.mocked(gl.getUniformLocation).mockImplementation((program, name) => (
      { program, name } as unknown as WebGLUniformLocation
    ));
    vi.mocked(gl.useProgram).mockImplementation((program) => { currentProgram = program; });
    vi.mocked(gl.uniform4fv).mockImplementation((location, value) => {
      const uniform = location as unknown as { program: WebGLProgram; name: string };
      if (uniform.name === "linearColor") colors.set(uniform.program, Array.from(value));
    });
    const recordDraw = () => {
      const color = currentProgram === null ? undefined : colors.get(currentProgram);
      if (color?.[3] === 0.5) submittedColors.push(color);
    };
    vi.mocked(gl.drawElements).mockImplementation(recordDraw);
    vi.mocked(gl.drawElementsInstanced).mockImplementation(recordDraw);
    vi.mocked(gl.drawArrays).mockImplementation(recordDraw);
    const owner = createSurfaceGpuOwner(gl);
    const state = new WebGlStateOwner(gl);
    const view = viewMat4(camera);
    const views = [{
      view,
      viewProjection: multiplyMat4Into(identityMat4(), projectionMat4(camera, 100, 100), view),
      viewport: { height: 100, width: 100, x: 0, y: 0 },
    }];
    const drawColors = () => {
      submittedColors = [];
      owner.beginFrame();
      owner.drawViews(views, null, state, [0, 0, 0, 1]);
      return submittedColors;
    };
    try {
      owner.setScene(pending);
      expect(drawColors()).toEqual([[0, 0, 1, 0.5], [1, 0, 0, 0.5]]);
      const ready = refreshCanonicalSurfaceTextures(pending, [decodedTextureKey(texture)], () => ({
        width: 2, height: 2, source: {} as ImageBitmap,
      }));
      owner.publishTextureBatch(ready, [decodedTextureKey(texture)]);
      const binding = updateCanonicalRenderObjectTransform(
        ready, card,
        { position: [-0.3, -0.003, -0.2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        createCanonicalRenderObjectUpdateWorkspace(),
      )!;
      owner.publishObjectTransforms(binding.surfaceIndices, false);
      expect(drawColors()).toEqual([[1, 0, 0, 0.5], [0, 0, 1, 0.5]]);
    } finally {
      owner.dispose();
    }
  });

  it("retires superseded scene storage before admitting replacement geometry", () => {
    const texture = imageTexture({
      sampler: { minFilter: "nearest" },
      src: "/superseded-scene.png",
    });
    const first = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: unlitMaterial({ texture }),
      })],
    }), undefined, undefined, () => ({
      height: 8,
      source: {} as ImageBitmap,
      width: 8,
    }));
    const second = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ color: [0.5, 0.5, 0.5, 1] }),
      })],
    }));
    const planner = new SurfaceGeometryGpuOwner(fakeGl());
    const firstGeometryBytes = planner.plannedRetainedBytes(first.surfaces);
    const secondGeometryBytes = planner.plannedRetainedBytes(second.surfaces);
    const budgetBytes = Math.max(firstGeometryBytes + 256, secondGeometryBytes);
    planner.dispose();
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(budgetBytes);
    const owner = createSurfaceGpuOwner(gl, budget);
    const state = new WebGlStateOwner(gl);

    try {
      owner.setScene(first);
      owner.beginFrame();
      owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1]);
      expect(budget.snapshot().retainedBytes).toBeGreaterThan(256);

      owner.setScene(second);
      owner.beginFrame();
      expect(() => owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1])).not.toThrow();
      expect(budget.snapshot().deniedClaims).toBe(0);
      expect(budget.snapshot().retainedBytes).toBe(secondGeometryBytes);
      expect(gl.deleteTexture).toHaveBeenCalledOnce();
      expect(gl.deleteBuffer).toHaveBeenCalled();
    } finally {
      owner.dispose();
    }
  });

  it("preserves complete-scene textures across replacement geometry publication", () => {
    const assets = Array.from({ length: 20 }, (_value, index) => imageTexture({
      sampler: { minFilter: "nearest" },
      src: `/shared-scene-${index}.avif`,
    }));
    const decoded = new Map(assets.map((asset, index) => [
      decodedTextureKey(asset),
      { height: 2, source: { index } as unknown as ImageBitmap, width: 2 },
    ]));
    const prepare = (
      geometry: (index: number) =>
        | ReturnType<typeof planeGeometry>
        | ReturnType<typeof triangleGeometry>,
    ) => prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: assets.map((texture, index) => mesh({
        geometry: geometry(index),
        material: unlitMaterial({ texture }),
      })),
    }), undefined, undefined, (asset) => decoded.get(decodedTextureKey(asset)));
    const first = prepare(() => planeGeometry(1));
    const second = prepare((index) => triangleGeometry({
      positions: [0, 0, 0, 1 + index / 100, 0, 0, 0, 1, 0],
      textureCoordinates: [0, 0, 1, 0, 0, 1],
    }));
    const gl = fakeGl();
    const owner = createSurfaceGpuOwner(gl);
    const state = new WebGlStateOwner(gl);
    const draw = (): void => {
      owner.beginFrame();
      owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1]);
    };

    try {
      owner.setScene(first);
      while (owner.surfacePublicationsPending()) draw();
      expect(gl.createTexture).toHaveBeenCalledTimes(assets.length);
      expect(gl.deleteTexture).not.toHaveBeenCalled();

      owner.setScene(second);
      draw();
      expect(owner.surfacePublicationsPending()).toBe(false);
      expect(gl.deleteTexture).not.toHaveBeenCalled();
      expect(gl.createTexture).toHaveBeenCalledTimes(assets.length);
      expect(gl.deleteTexture).not.toHaveBeenCalled();
    } finally {
      owner.dispose();
    }
  });

  it("retries replacement publication after a transient geometry allocation failure", () => {
    const first = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: unlitMaterial({ color: [0.25, 0.25, 0.25, 1] }),
      })],
    }));
    const second = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ color: [0.75, 0.75, 0.75, 1] }),
      })],
    }));
    const gl = fakeGl();
    const owner = createSurfaceGpuOwner(gl);
    const state = new WebGlStateOwner(gl);

    try {
      owner.setScene(first);
      owner.beginFrame();
      owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1]);
      const firstSceneDraws = vi.mocked(gl.drawElements).mock.calls.length;

      owner.setScene(second);
      vi.mocked(gl.createBuffer).mockReturnValueOnce(null);
      owner.beginFrame();
      expect(() => owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1]))
        .toThrow("Royal could not allocate surface geometry");
      expect(gl.drawElements).toHaveBeenCalledTimes(firstSceneDraws);

      owner.beginFrame();
      expect(() => owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1])).not.toThrow();
      expect(gl.drawElements).toHaveBeenCalledTimes(firstSceneDraws + 1);
    } finally {
      owner.dispose();
    }
  });

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
      const owner = createSurfaceGpuOwner(gl);
      const state = new WebGlStateOwner(gl);
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
          owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1]);

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
    const owner = createSurfaceGpuOwner(gl);
    const state = new WebGlStateOwner(gl);

    owner.setScene(firstScene);
    owner.beginFrame();
    owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1]);
    expect(drawnTextures.at(-1)).toBe(createdTextures[0]);

    owner.publishTextureBatch(secondScene, [decodedTextureKey(second)]);
    owner.beginFrame();
    owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1]);
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
    const owner = createSurfaceGpuOwner(gl);
    const state = new WebGlStateOwner(gl);
    const draw = (): void => {
      draws.length = 0;
      owner.beginFrame();
      owner.drawViews(TEST_VIEWS, null, state, [0, 0, 0, 1]);
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
