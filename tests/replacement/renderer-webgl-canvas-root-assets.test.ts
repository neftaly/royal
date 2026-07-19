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
    const { callbacks, canvas, root } = harness({
      preparePrefilteredEnvironment: async (bytes) => parseRoyalEnvironmentKtx1(bytes),
      readPrefilteredEnvironment,
    });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      environment,
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ color: [0.8, 0.6, 0.2, 1] }),
      })],
    }));
    callbacks.shift()!();
    expect(canvas.gl.shaderSource.mock.calls.some(([, shader]) =>
      String(shader).includes("#define STUDIO_ENVIRONMENT"))).toBe(true);

    await vi.waitFor(() => expect(root.getPrefilteredEnvironmentSnapshot(environment)).toEqual({
      mipCount: 2,
      provenance: "fixture-2",
      size: 2,
      state: "ready",
    }));
    callbacks.shift()!();
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(12);
    expect(canvas.gl.shaderSource.mock.calls.some(([, shader]) =>
      String(shader).includes("#define PREFILTERED_ENVIRONMENT"))).toBe(true);
    expect(vi.mocked(canvas.gl.bindTexture).mock.calls.some(([target]) =>
      target === canvas.gl.TEXTURE_CUBE_MAP)).toBe(true);
    expect(root.getSnapshot().resources.persistentGpu.retainedBytes).toBeGreaterThanOrEqual(120);

    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
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
    root.render(scene({
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
    root.render(scene({
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
      root.render(scene({
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
    const { callbacks, canvas, root } = harness({
      decodeTexture: async () => ({
        height: 2,
        source: {} as ImageBitmap,
        width: 2,
      }),
    }, {}, { ordinaryTextureUploadByteBudgetPerFrame: 16 });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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

    callbacks.shift()!();
    expect(canvas.gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(root.getSnapshot().resources.ordinaryTextureUploads).toEqual({
      admittedBytes: 16,
      budgetBytes: 16,
      deferredUploads: 1,
    });
    expect(root.getTextureAssetSnapshot(second).state).toBe("ready");
    callbacks.shift()!();
    expect(canvas.gl.texImage2D).toHaveBeenCalledTimes(2);
    expect(root.getSnapshot().resources.ordinaryTextureUploads).toEqual({
      admittedBytes: 16,
      budgetBytes: 16,
      deferredUploads: 0,
    });
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
    root.render(scene({
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
    root.render(scene({
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
    root.render(scene({
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
    root.render(scene({
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
    root.render(scene({
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
    root.render(scene({
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
    expect(canvas.gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
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
    root.render(scene({ camera: perspectiveCamera({ position: [1, 2, 3] }), nodes: [node] }));
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
    expect(canvas.gl.texImage2D).toHaveBeenCalledTimes(1);
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
    root.render(scene({ camera: perspectiveCamera({ position: [0, 0, 3] }), nodes: [node] }));
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
    root.render(scene({
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
