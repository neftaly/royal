import {
  boxGeometry,
  createGltfInstanceTransforms,
  directionalLight,
  gltf,
  gltfInstances,
  imageTexture,
  mesh,
  perspectiveCamera,
  planeGeometry,
  prefilteredEnvironment,
  scene,
  standardMaterial,
  unlitMaterial,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { canvasRootHarness as harness } from "./support/canvas-root-harness";
import { TextureGpuOwner } from "../../packages/renderer-webgl/src/texture/gpu-owner";
import type { TextureSourceRef } from "../../packages/renderer-webgl/src/texture/asset-owner";
import { SurfaceGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { SurfaceProgramOwner } from "../../packages/renderer-webgl/src/surface/surface-program-owner";
import { parseRoyalEnvironmentKtx1 } from "../../packages/renderer-webgl/src/environment/royal-environment-ktx1";
import { environmentKtx1Fixture } from "./support/environment-ktx1";
import {
  staticInstancedTriangleGlb,
  staticTriangleDocument,
  staticTriangleGlb,
  staticTexturedTriangleGlb,
} from "./support/static-glb";

describe("canvas root asset publication", () => {
  it("uses studio fallback until one offline environment becomes GPU-ready", async () => {
    const environment = prefilteredEnvironment({ src: "/environment.ktx", version: 2 });
    const source = environmentKtx1Fixture(2).source;
    const readPrefilteredEnvironment = vi.fn(async () => source);
    const { canvas, flushScheduledFrames, root } = harness({
      preparePrefilteredEnvironment: async (bytes) => parseRoyalEnvironmentKtx1(bytes),
      readPrefilteredEnvironment,
    });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      environment,
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ color: [0.8, 0.6, 0.2, 1] }),
      })],
    }));
    flushScheduledFrames();
    expect(canvas.gl.shaderSource.mock.calls.some(([, shader]) =>
      String(shader).includes("#define STUDIO_ENVIRONMENT"))).toBe(true);

    await vi.waitFor(() => expect(root.getPrefilteredEnvironmentSnapshot(environment)).toEqual({
      mipCount: 2,
      provenance: "fixture-2",
      size: 2,
      state: "ready",
    }));
    await vi.waitFor(() => {
      flushScheduledFrames();
      expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(12);
    });
    expect(canvas.gl.shaderSource.mock.calls.some(([, shader]) =>
      String(shader).includes("#define PREFILTERED_ENVIRONMENT"))).toBe(true);
    expect(vi.mocked(canvas.gl.bindTexture).mock.calls.some(([target]) =>
      target === canvas.gl.TEXTURE_CUBE_MAP)).toBe(true);
    expect(root.getSnapshot().resources.persistentGpu.retainedBytes).toBeGreaterThanOrEqual(120);

    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    flushScheduledFrames();
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(24);
    expect(readPrefilteredEnvironment).toHaveBeenCalledOnce();
    expect(root.getPrefilteredEnvironmentSnapshot(environment).state).toBe("ready");
  });

  it("captures environment GPU allocation failure without corrupting asset readiness", async () => {
    const environment = prefilteredEnvironment({ src: "/environment.ktx" });
    const { canvas, root, scheduledFailures } = harness({
      preparePrefilteredEnvironment: async (bytes) => parseRoyalEnvironmentKtx1(bytes),
      readPrefilteredEnvironment: async () => environmentKtx1Fixture(2).source,
    });
    canvas.gl.createTexture.mockReturnValueOnce(null);
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      environment,
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ color: [0.5, 0.5, 0.5, 1] }),
      })],
    }));

    await vi.waitFor(() => expect(root.getPrefilteredEnvironmentSnapshot(environment).state)
      .toBe("ready"));
    expect(scheduledFailures).toHaveLength(1);
    expect(root.getSnapshot().lastFrameFailure).toMatch(/prefiltered environment/u);
  });

  it("shares one immutable preparation limit across environment and texture work", async () => {
    let finishEnvironment: ((source: ArrayBuffer) => void) | undefined;
    const environmentRead = new Promise<ArrayBuffer>((resolve) => {
      finishEnvironment = resolve;
    });
    const decodeTexture = vi.fn(async () => ({
      height: 2,
      source: {} as ImageBitmap,
      width: 2,
    }));
    const environment = prefilteredEnvironment({ src: "/environment.ktx" });
    const texture = imageTexture("/texture.png");
    const { root } = harness({
      decodeTexture,
      preparePrefilteredEnvironment: async (bytes) => parseRoyalEnvironmentKtx1(bytes),
      readPrefilteredEnvironment: async () => environmentRead,
    }, {}, { maxConcurrentPreparationJobs: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      environment,
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ texture }),
      })],
    }));

    expect(root.getSnapshot().resources.asyncPreparation).toEqual({
      activeJobs: 1,
      jobLimit: 1,
      queuedJobs: 1,
    });
    expect(decodeTexture).not.toHaveBeenCalled();
    finishEnvironment?.(environmentKtx1Fixture(2).source);
    await vi.waitFor(() => expect(decodeTexture).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(root.getTextureAssetSnapshot(texture).state).toBe("ready"));
    expect(root.getSnapshot().resources.asyncPreparation).toEqual({
      activeJobs: 0,
      jobLimit: 1,
      queuedJobs: 0,
    });
  });

  it("keeps texture publication incremental while a large scene is still admitting", async () => {
    let resolveDecode: ((source: {
      height: number;
      source: TexImageSource;
      width: number;
    }) => void) | undefined;
    const decodeTexture = vi.fn(() => new Promise<{
      height: number;
      source: TexImageSource;
      width: number;
    }>((resolve) => { resolveDecode = resolve; }));
    const reconcile = vi.spyOn(TextureGpuOwner.prototype, "reconcile");
    const retain = vi.spyOn(TextureGpuOwner.prototype, "retain");
    const texture = imageTexture("/shared.png");
    const material = unlitMaterial({ texture });
    const nodes = Array.from({ length: 20 }, (_, index) => mesh({
      geometry: boxGeometry(1),
      material,
      transform: { position: [index * 2, 0, 0] },
    }));
    const { callbacks, root } = harness({ decodeTexture });
    try {
      root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
      root.setScene(scene({
        camera: perspectiveCamera({ position: [0, 0, 30] }),
        nodes,
      }));
      callbacks.shift()!();
      expect(reconcile).toHaveBeenCalledTimes(1);

      resolveDecode?.({ height: 32, source: {} as ImageBitmap, width: 32 });
      await vi.waitFor(() => expect(root.getTextureAssetSnapshot(texture).state).toBe("ready"));
      callbacks.shift()!();
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(retain).toHaveBeenCalledTimes(20 * 9);
      expect(callbacks).toHaveLength(0);
    } finally {
      root.dispose();
      reconcile.mockRestore();
      retain.mockRestore();
    }
  });

  it("defers texture upload traffic across frames without failing ready assets", async () => {
    const first = imageTexture("/first.png");
    const second = imageTexture("/second.png");
    const third = imageTexture("/third.png");
    let nextDelay = 1;
    const delays = new Map<number, () => void>();
    const presentationDelays: number[] = [];
    const { callbacks, canvas, root } = harness({
      cancelDelay: (handle) => delays.delete(handle as number),
      decodeTexture: async () => ({
        height: 2,
        source: {} as ImageBitmap,
        width: 2,
      }),
      now: () => 0,
      requestDelay: (callback, delayMs) => {
        const handle = nextDelay;
        nextDelay += 1;
        delays.set(handle, callback);
        presentationDelays.push(delayMs);
        return handle;
      },
    }, {}, { ordinaryTextureUploadByteBudgetPerFrame: 16 });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [
        mesh({ geometry: planeGeometry(1), material: unlitMaterial({ texture: first }) }),
        mesh({
          geometry: planeGeometry(1),
          material: unlitMaterial({ texture: second }),
          transform: { position: [1, 0, 0] },
        }),
        mesh({
          geometry: planeGeometry(1),
          material: unlitMaterial({ texture: third }),
          transform: { position: [2, 0, 0] },
        }),
      ],
    }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getTextureAssetSnapshot(first).state).toBe("ready"));
    await vi.waitFor(() => expect(root.getTextureAssetSnapshot(second).state).toBe("ready"));
    await vi.waitFor(() => expect(root.getTextureAssetSnapshot(third).state).toBe("ready"));

    callbacks.shift()!();
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(6);
    expect(root.getSnapshot().resources.ordinaryTextureUploads).toEqual({
      admittedBytes: 16,
      budgetBytes: 16,
      deferredUploads: 2,
    });
    expect(root.getTextureAssetSnapshot(second).state).toBe("ready");
    callbacks.shift()!();
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(6);
    expect(root.getSnapshot().resources.ordinaryTextureUploads).toEqual({
      admittedBytes: 16,
      budgetBytes: 16,
      deferredUploads: 1,
    });
    callbacks.shift()!();
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(3);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(9);
    expect(root.getSnapshot().resources.ordinaryTextureUploads.deferredUploads).toBe(0);
    expect(presentationDelays).toContain(250);
    root.dispose();
  });

  it("finishes deferred textures after final geometry admission without camera input", async () => {
    const textures = Array.from(
      { length: 20 },
      (_value, index) => imageTexture(`/overlapped-${index}.png`),
    );
    const geometry = planeGeometry(1);
    const { callbacks, canvas, root } = harness({
      decodeTexture: async () => ({
        height: 2,
        source: {} as ImageBitmap,
        width: 2,
      }),
    }, {}, { ordinaryTextureUploadByteBudgetPerFrame: 16 });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: textures.map((texture, index) => mesh({
        geometry,
        material: unlitMaterial({ texture }),
        transform: { position: [index * 0.01, 0, 0] },
      })),
    }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(textures.every(
      (texture) => root.getTextureAssetSnapshot(texture).state === "ready",
    )).toBe(true));

    for (let frame = 0; frame < 40 && callbacks.length > 0; frame += 1) {
      callbacks.shift()!();
      await Promise.resolve();
    }

    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(20);
    expect(root.getSnapshot().resources.geometryUploads.pendingSurfaces).toBe(0);
    expect(root.getSnapshot().resources.ordinaryTexturePreparation).toMatchObject({
      activeDecodes: 0,
      decodeReservations: 0,
      decodedHandoffBytes: 0,
      pendingStorageRepresentations: 0,
    });
    expect(callbacks).toHaveLength(0);
    root.dispose();
  });

  it("keeps each deferred upload attached to its authored draw", async () => {
    let activeUnit = 0;
    const bound: Array<WebGLTexture | null | undefined> = [];
    let program: WebGLProgram | null = null;
    const draws: Array<Readonly<{
      program: WebGLProgram | null;
      texture: WebGLTexture | null | undefined;
    }>> = [];
    const sources = new Map([
      ["/first.png", {} as ImageBitmap],
      ["/second.png", {} as ImageBitmap],
    ]);
    const uploaded = new Map<TexImageSource, WebGLTexture | null | undefined>();
    const first = imageTexture("/first.png");
    const second = imageTexture("/second.png");
    const { callbacks, root } = harness({
      decodeTexture: async (asset) => ({
        height: 2,
        source: sources.get(asset.kind === "asset" ? asset.src : "")!,
        width: 2,
      }),
    }, {
      activeTexture: vi.fn((unit: number) => { activeUnit = unit - 0x84c0; }),
      bindTexture: vi.fn((target: number, texture: WebGLTexture | null) => {
        if (target === 0x0de1) bound[activeUnit] = texture;
      }),
      drawElements: vi.fn(() => draws.push({ program, texture: bound[0] })),
      texSubImage2D: vi.fn((...arguments_: unknown[]) => {
        uploaded.set(arguments_.at(-1) as TexImageSource, bound[activeUnit]);
      }),
      useProgram: vi.fn((next: WebGLProgram | null) => { program = next; }),
    }, { ordinaryTextureUploadByteBudgetPerFrame: 16 });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [
        mesh({ geometry: planeGeometry(1), material: unlitMaterial({ texture: first }) }),
        mesh({
          geometry: planeGeometry(1),
          material: unlitMaterial({ texture: second }),
          transform: { position: [1, 0, 0] },
        }),
      ],
    }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getTextureAssetSnapshot(first).state).toBe("ready"));
    await vi.waitFor(() => expect(root.getTextureAssetSnapshot(second).state).toBe("ready"));
    draws.length = 0;

    callbacks.shift()!();
    expect(draws[0]!.texture).toBe(uploaded.get(sources.get("/first.png")!));
    expect(draws[1]!.program).not.toBe(draws[0]!.program);
    draws.length = 0;
    callbacks.shift()!();
    expect(draws.map((draw) => draw.texture)).toEqual([
      uploaded.get(sources.get("/first.png")!),
      uploaded.get(sources.get("/second.png")!),
    ]);
    expect(draws[0]!.texture).not.toBe(draws[1]!.texture);
    expect(draws[0]!.program).toBe(draws[1]!.program);
    root.dispose();
  });

  it("publishes one asynchronously prepared GLB into the same draw and pick path", async () => {
    const document = staticTriangleDocument();
    delete document.extensionsRequired;
    delete document.extensionsUsed;
    document.materials = [{
      pbrMetallicRoughness: {
        baseColorFactor: [0.2, 0.4, 0.8, 1],
        metallicFactor: 0.2,
        roughnessFactor: 0.7,
      },
    }];
    const meshes = document.meshes as Array<{
      primitives: Array<{ attributes: Record<string, number> }>;
    }>;
    meshes[0]!.primitives[0]!.attributes.NORMAL = 0;
    document.nodes = [{ mesh: 0 }];
    document.scenes = [{ nodes: [0] }];
    const bytes = staticTriangleGlb(document);
    const readGltf = vi.fn(async () => bytes);
    const { callbacks, canvas, root } = harness({ readGltf });
    const node = gltf({
      pickingGeometry: planeGeometry([4, 1]),
      pickingId: "triangle",
      src: "/triangle.glb",
      version: "v1",
    });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [
        directionalLight({ direction: [0, 0, -1], illuminanceLux: 8 }),
        node,
      ],
    }));
    expect(root.getGltfAssetSnapshot(node.asset)).toEqual({ state: "loading" });
    expect(root.pick({ clientX: 260, clientY: 120 })?.target).toMatchObject({
      kind: "gltf",
      node,
      pickingId: "triangle",
    });
    expect(canvas.gl.bufferData).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(root.getGltfAssetSnapshot(node.asset)).toEqual({
        bounds: { max: [1, 1, 0], min: [-1, -1, 0] },
        primitiveCount: 1,
        state: "ready",
        timings: {
          externalResourceReadDurationMs: 0,
          preparationDurationMs: expect.any(Number),
          sourceReadDurationMs: expect.any(Number),
        },
        textures: { failed: 0, loading: 0, ready: 0, total: 0 },
      });
    });
    expect(readGltf).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(1);
    expect(root.pick({ clientX: 160, clientY: 120 })?.target).toMatchObject({
      kind: "gltf",
      node,
      pickingId: "triangle",
    });
    expect(root.pick({ clientX: 260, clientY: 120 })?.target).toMatchObject({
      kind: "gltf",
      node,
      pickingId: "triangle",
    });
  });

  it("renders glTF extension instances as one shared GPU draw", async () => {
    const readGltf = vi.fn(async () => staticInstancedTriangleGlb());
    const { callbacks, canvas, root } = harness({ readGltf });
    const node = gltf({ src: "/instances.glb", version: "v1" });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    callbacks.shift()!();

    expect(canvas.gl.drawElements).not.toHaveBeenCalled();
    expect(canvas.gl.drawElementsInstanced).toHaveBeenCalledWith(
      canvas.gl.TRIANGLES,
      3,
      canvas.gl.UNSIGNED_BYTE,
      0,
      2,
    );
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
  });

  it("renders, picks, and republishes explicit instances through one canonical batch", async () => {
    const document = staticTriangleDocument();
    document.nodes = [{ mesh: 0 }];
    document.scenes = [{ nodes: [0] }];
    const transforms = createGltfInstanceTransforms({
      count: 2,
      logicalIds: ["left", "right"],
      positions: [-1, 0, 0, 1, 0, 0],
    });
    const node = gltfInstances({
      instances: transforms,
      pickingGeometry: planeGeometry(0.8),
      pickingId: "fleet",
      src: "/explicit-instances.glb",
      version: "v1",
    });
    const readGltf = vi.fn(async () => staticTriangleGlb(document));
    const { callbacks, canvas, root } = harness({ readGltf });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));

    expect(root.pick({ clientX: 92, clientY: 100 })?.target).toMatchObject({
      instanceId: "left",
      instanceIndex: 0,
      kind: "gltf-instances",
      pickingId: "fleet",
    });
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    callbacks.shift()!();
    expect(canvas.gl.drawElementsInstanced).toHaveBeenLastCalledWith(
      canvas.gl.TRIANGLES,
      3,
      canvas.gl.UNSIGNED_BYTE,
      0,
      2,
    );

    const allocations = canvas.gl.bufferData.mock.calls.length;
    const patches = canvas.gl.bufferSubData.mock.calls.length;
    transforms.positions[0] = -0.5;
    transforms.commitPosition(0, 1);
    callbacks.shift()!();
    expect(canvas.gl.bufferData.mock.calls.length).toBe(allocations);
    expect(canvas.gl.bufferSubData.mock.calls.length).toBeGreaterThan(patches);

    transforms.scales[0] = -1;
    transforms.commitScale(0, 1);
    callbacks.shift()!();
    expect(canvas.gl.bufferData.mock.calls.length).toBeGreaterThan(allocations);
  });

  it("coalesces same-frame instance commits while keeping imperative picking current", async () => {
    const document = staticTriangleDocument();
    document.nodes = [{ mesh: 0 }];
    document.scenes = [{ nodes: [0] }];
    const transforms = createGltfInstanceTransforms({
      count: 2,
      logicalIds: ["left", "right"],
      positions: [-1, 0, 0, 1, 0, 0],
    });
    const node = gltfInstances({
      instances: transforms,
      pickingGeometry: planeGeometry(0.8),
      pickingId: "fleet",
      src: "/coalesced-instances.glb",
    });
    const setGpuScene = vi.spyOn(SurfaceGpuOwner.prototype, "setScene");
    const { callbacks, root } = harness({ readGltf: async () => staticTriangleGlb(document) });
    try {
      root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
      root.setScene(scene({
        camera: perspectiveCamera({ position: [0, 0, 3] }),
        nodes: [node],
      }));
      callbacks.shift()!();
      await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
      callbacks.shift()!();
      setGpuScene.mockClear();

      transforms.positions[0] = -0.75;
      transforms.commitPosition(0, 1);
      transforms.positions[3] = 0.75;
      transforms.commitPosition(1, 1);

      expect(setGpuScene).not.toHaveBeenCalled();
      expect(root.pick({ clientX: 94, clientY: 100 })?.target).toMatchObject({
        instanceId: "left",
        instanceIndex: 0,
      });
      expect(setGpuScene).toHaveBeenCalledOnce();

      callbacks.shift()!();
      expect(setGpuScene).toHaveBeenCalledOnce();
    } finally {
      root.dispose();
      setGpuScene.mockRestore();
    }
  });

  it("submits exactly one retained node LOD level", async () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "MSFT_lod"];
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { MSFT_lod: { ids: [2] } };
    nodes[1]!.extras = { MSFT_screencoverage: [0.99, 0] };
    nodes.push({ mesh: 0, translation: [0, 2, -1] });
    const readGltf = vi.fn(async () => staticTriangleGlb(document));
    const { callbacks, canvas, root } = harness({ readGltf });
    const node = gltf({ src: "/lod.glb", version: "v1" });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [1, 2, 5] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    callbacks.shift()!();

    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(1);
  });

  it("submits exactly one retained material LOD level", async () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "MSFT_lod"];
    const materials = document.materials as Array<Record<string, unknown>>;
    materials[0]!.extensions = { KHR_materials_unlit: {}, MSFT_lod: { ids: [1] } };
    materials[0]!.extras = { MSFT_screencoverage: [0.99, 0] };
    materials.push({
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [0.1, 0.2, 0.4, 1] },
    });
    const readGltf = vi.fn(async () => staticTriangleGlb(document));
    const { callbacks, canvas, root } = harness({ readGltf });
    const node = gltf({ src: "/material-lod.glb", version: "v1" });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [1, 2, 5] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    callbacks.shift()!();

    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(1);
  });

  it("streams external glTF color images through the ordinary texture path", async () => {
    let resolveDecode: ((source: {
      height: number;
      source: TexImageSource;
      width: number;
    }) => void) | undefined;
    const decodeTexture = vi.fn(() => new Promise<{
      height: number;
      source: TexImageSource;
      width: number;
    }>((resolve) => { resolveDecode = resolve; }));
    const readGltf = vi.fn(async () => staticTexturedTriangleGlb());
    const { callbacks, canvas, root } = harness({ decodeTexture, readGltf });
    const node = gltf({ src: "/models/textured.glb", version: "v2" });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [1, 2, 3] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    expect(canvas.gl.drawElements).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("streaming"));
    expect(root.getGltfAssetSnapshot(node.asset)).toMatchObject({
      state: "streaming",
      textures: { failed: 0, loading: 1, ready: 0, total: 1 },
    });
    expect(decodeTexture).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "asset", src: "/models/albedo.png" }),
      expect.any(AbortSignal),
      201_326_592,
    );
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    expect(canvas.gl.texImage2D).not.toHaveBeenCalled();

    resolveDecode?.({ height: 32, source: {} as ImageBitmap, width: 64 });
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    expect(root.getGltfAssetSnapshot(node.asset)).toMatchObject({
      state: "ready",
      textures: { failed: 0, loading: 0, ready: 1, total: 1 },
    });
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
  });

  it("keeps authored emissive contribution neutral until its image is drawable", async () => {
    let resolveDecode: ((source: {
      height: number;
      source: TexImageSource;
      width: number;
    }) => void) | undefined;
    const decodeTexture = vi.fn(() => new Promise<{
      height: number;
      source: TexImageSource;
      width: number;
    }>((resolve) => { resolveDecode = resolve; }));
    const readGltf = vi.fn(async () => staticTexturedTriangleGlb(
      undefined,
      "emissive.png",
      (document) => {
        delete document.extensionsRequired;
        delete document.extensionsUsed;
        document.materials = [{
          emissiveFactor: [0.25, 0.5, 1],
          emissiveTexture: { index: 0 },
          pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] },
        }];
      },
    ));
    const { callbacks, canvas, root } = harness({ decodeTexture, readGltf });
    const node = gltf("/models/emissive.glb");
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({ camera: perspectiveCamera({ position: [0, 0, 3] }), nodes: [node] }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("streaming"));
    callbacks.shift()!();
    expect(vi.mocked(canvas.gl.uniform4fv).mock.calls.some(([, value]) => {
      const values = Array.from(value);
      return values[0] === 0 && values[1] === 0 && values[2] === 0
        && Math.abs(values[3]! - 0.04) < 0.000_001;
    })).toBe(true);

    vi.mocked(canvas.gl.uniform4fv).mockClear();
    resolveDecode?.({ height: 8, source: {} as ImageBitmap, width: 8 });
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    callbacks.shift()!();
    expect(vi.mocked(canvas.gl.uniform4fv).mock.calls.some(([, value]) => {
      const values = Array.from(value);
      return values[0] === 0.25 && values[1] === 0.5 && values[2] === 1
        && Math.abs(values[3]! - 0.04) < 0.000_001;
    })).toBe(true);
  });

  it("uploads coherent detail maps without rebuilding an unchanged draw packet", async () => {
    const decodes = new Map<string, (source: {
      height: number;
      source: TexImageSource;
      width: number;
    }) => void>();
    const decodeTexture = vi.fn((asset: TextureSourceRef) => new Promise<{
      height: number;
      source: TexImageSource;
      width: number;
    }>((resolve) => {
      if (asset.kind === "asset") decodes.set(asset.src, resolve);
    }));
    const readGltf = vi.fn(async () => staticTexturedTriangleGlb(
      undefined,
      "unused.png",
      (document) => {
        delete document.extensionsRequired;
        delete document.extensionsUsed;
        document.images = [{ uri: "metal.png" }, { uri: "normal.png" }];
        document.textures = [{ source: 0 }, { source: 1 }];
        document.materials = [{
          normalTexture: { index: 1 },
          pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } },
        }];
      },
    ));
    const getProgram = vi.spyOn(SurfaceProgramOwner.prototype, "get");
    const { callbacks, root } = harness({ decodeTexture, readGltf });
    const node = gltf("/models/coherent-details.glb");
    try {
      root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
      root.setScene(scene({ camera: perspectiveCamera({ position: [0, 0, 3] }), nodes: [node] }));
      callbacks.shift()!();
      await vi.waitFor(() => expect(decodes.size).toBe(2));
      callbacks.shift()!();
      const initialProgramLookups = getProgram.mock.calls.length;

      decodes.get("/models/metal.png")?.({
        height: 8,
        source: {} as ImageBitmap,
        width: 8,
      });
      await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset)).toMatchObject({
        textures: { loading: 1, ready: 1 },
      }));
      callbacks.shift()!();
      expect(getProgram).toHaveBeenCalledTimes(initialProgramLookups);

      decodes.get("/models/normal.png")?.({
        height: 8,
        source: {} as ImageBitmap,
        width: 8,
      });
      await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
      callbacks.shift()!();
      expect(getProgram.mock.calls.length).toBeGreaterThan(initialProgramLookups);
    } finally {
      root.dispose();
      getProgram.mockRestore();
    }
  });

  it("streams embedded GLB images through that same texture owner and GPU path", async () => {
    let resolveDecode: ((source: {
      height: number;
      source: TexImageSource;
      width: number;
    }) => void) | undefined;
    const decodeTexture = vi.fn(() => new Promise<{
      height: number;
      source: TexImageSource;
      width: number;
    }>((resolve) => { resolveDecode = resolve; }));
    const readGltf = vi.fn(async () => staticTexturedTriangleGlb(
      new Uint8Array([137, 80, 78, 71]),
    ));
    const { callbacks, canvas, root } = harness({ decodeTexture, readGltf });
    const node = gltf("/models/embedded.glb");
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({ camera: perspectiveCamera({ position: [1, 2, 3] }), nodes: [node] }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(decodeTexture).toHaveBeenCalled());
    expect(decodeTexture).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "embedded-asset", mimeType: "image/png" }),
      expect.any(AbortSignal),
      201_326_592,
    );
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    resolveDecode?.({ height: 8, source: {} as ImageBitmap, width: 8 });
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(1);
  });

  it("uses retained alpha in the same exact query after a MASK texture becomes ready", async () => {
    let resolveDecode: ((source: {
      alpha: { height: number; values: Uint8Array; width: number };
      height: number;
      source: TexImageSource;
      width: number;
    }) => void) | undefined;
    const decodeTexture = vi.fn(() => new Promise<{
      alpha: { height: number; values: Uint8Array; width: number };
      height: number;
      source: TexImageSource;
      width: number;
    }>((resolve) => { resolveDecode = resolve; }));
    const readGltf = vi.fn(async () => staticTexturedTriangleGlb(
      undefined,
      "cutout.png",
      (document) => {
        const materials = document.materials as Array<Record<string, unknown>>;
        materials[0]!.alphaMode = "MASK";
        materials[0]!.alphaCutoff = 0.5;
        document.nodes = [{ mesh: 0 }];
        document.scenes = [{ nodes: [0] }];
      },
    ));
    const { callbacks, root } = harness({ decodeTexture, readGltf });
    const node = gltf("/models/cutout.glb");
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({ camera: perspectiveCamera({ position: [0, 0, 3] }), nodes: [node] }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("streaming"));

    expect(decodeTexture).toHaveBeenCalledWith(
      expect.objectContaining({ src: "/models/cutout.png" }),
      expect.any(AbortSignal),
      201_326_592,
      true,
    );
    expect(root.pick({ clientX: 150, clientY: 100 })?.target).toMatchObject({ node });

    resolveDecode?.({
      alpha: { height: 1, values: new Uint8Array([0]), width: 1 },
      height: 1,
      source: {} as ImageBitmap,
      width: 1,
    });
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    expect(root.pick({ clientX: 150, clientY: 100 })).toBeUndefined();
  });

  it("reports failed glTF images without stalling geometry or republishing GPU state", async () => {
    const decodeTexture = vi.fn(async () => { throw new Error("AVIF decode failed"); });
    const { callbacks, canvas, root } = harness({
      decodeTexture,
      readGltf: vi.fn(async () => staticTexturedTriangleGlb()),
    });
    const node = gltf("/models/degraded.glb");
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [1, 2, 3] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset)).toMatchObject({
      state: "degraded",
      textures: { failed: 1, loading: 0, ready: 0, total: 1 },
    }));
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(1);
    expect(canvas.gl.texImage2D).not.toHaveBeenCalled();
  });
});
