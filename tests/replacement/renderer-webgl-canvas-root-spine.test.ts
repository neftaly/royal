import { describe, expect, it, vi } from "vitest";
import { waitFor } from "./support/wait-for";
import {
  mesh,
  imageTexture,
  directionalLight,
  createCameraViewResource,
  gltf,
  perspectiveCamera,
  planeGeometry,
  pointLight,
  scene,
  standardMaterial,
  studioEnvironment,
  unlitMaterial,
  wireframeMaterial,
  type Scene,
} from "@royal/renderer-core";
import { resolveCanvasSize } from "../../packages/renderer-webgl/src/frame/canvas-size";
import {
  CanvasRoot,
  type CanvasRootPlatform,
} from "../../packages/renderer-webgl/src/runtime/canvas-root";
import {
  staticTriangleDocument,
  staticTriangleGlb,
} from "./support/static-glb";
import {
  canvasRootHarness as harness,
  emptyScene,
  FakeCanvas,
} from "./support/canvas-root-harness";

describe("canvas size selection", () => {
  it("preserves aspect while fitting the capability ceiling", () => {
    expect(resolveCanvasSize(
      { cssHeight: 1000, cssWidth: 2000, pixelRatio: 2 },
      { maxHeight: 1000, maxWidth: 1000 },
    )).toMatchObject({
      backingHeight: 500,
      backingWidth: 1000,
      renderScale: 0.25,
    });
  });

  it("represents a hidden canvas without inventing a drawable pixel", () => {
    expect(resolveCanvasSize(
      { cssHeight: 0, cssWidth: 300, pixelRatio: 2 },
      { maxHeight: 4096, maxWidth: 4096 },
    )).toMatchObject({ backingHeight: 0, backingWidth: 0, renderScale: 0 });
  });
});

describe("clear-only canvas root", () => {
  it("enables ETC2 once and preserves that negotiated capability across restoration", () => {
    const etc2 = {};
    const extensionLookup = vi.fn((name: string) => name === "WEBGL_compressed_texture_etc"
      ? etc2
      : null);
    const { canvas, root } = harness({}, {
      getExtension: extensionLookup as WebGL2RenderingContext["getExtension"],
    });

    expect(extensionLookup.mock.calls.filter(([name]) =>
      name === "WEBGL_compressed_texture_etc")).toHaveLength(1);
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(extensionLookup.mock.calls.filter(([name]) =>
      name === "WEBGL_compressed_texture_etc")).toHaveLength(2);
    expect(root.getSnapshot().context.phase).toBe("active");
  });

  it("defaults persistent context costs off and preserves explicit opt-ins", () => {
    const defaults = new FakeCanvas();
    const defaultRoot = new CanvasRoot(defaults as unknown as HTMLCanvasElement);
    expect(defaults.contextAttributes).toMatchObject({
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
    });
    defaultRoot.dispose();

    const optedIn = new FakeCanvas();
    const optedInRoot = new CanvasRoot(
      optedIn as unknown as HTMLCanvasElement,
      { alpha: true, antialias: true },
    );
    expect(optedIn.contextAttributes).toMatchObject({ alpha: true, antialias: true });
    optedInRoot.dispose();
  });

  it("rejects invalid and unknown creation options at the public boundary", () => {
    const canvas = new FakeCanvas();
    expect(() => new CanvasRoot(
      canvas as unknown as HTMLCanvasElement,
      { alpha: "yes" } as unknown as { alpha: boolean },
    )).toThrow("alpha must be a boolean");
    expect(() => new CanvasRoot(
      canvas as unknown as HTMLCanvasElement,
      { powerPreference: "high-performance" } as unknown as { alpha: boolean },
    )).toThrow("unsupported field powerPreference");
  });

  it("coalesces commits and applies only changed clear state", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 360, cssWidth: 640, pixelRatio: 1 });
    root.setScene(emptyScene([0.25, 0.5, 1.5, 1]));
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(root.getSnapshot()).toMatchObject({
      frame: 1,
      size: { backingHeight: 360, backingWidth: 640 },
    });
    expect(canvas.gl.viewport).toHaveBeenCalledTimes(1);
    expect(canvas.gl.clearColor).toHaveBeenCalledTimes(1);

    root.invalidate();
    callbacks.shift()!();
    expect(root.getSnapshot().frame).toBe(2);
    expect(canvas.gl.viewport).toHaveBeenCalledTimes(1);
    expect(canvas.gl.clearColor).toHaveBeenCalledTimes(1);
    expect(canvas.gl.clear).toHaveBeenCalledTimes(2);
    expect(canvas.gl.clear).toHaveBeenLastCalledWith(
      canvas.gl.COLOR_BUFFER_BIT | canvas.gl.DEPTH_BUFFER_BIT,
    );
  });

  it("publishes metadata-only size changes without invalidating backing state", () => {
    const { callbacks, canvas, root } = harness();
    const sizeListener = vi.fn();
    root.subscribeSize(sizeListener);
    root.setSize({ cssHeight: 10, cssWidth: 20, pixelRatio: 1 });
    callbacks.shift()!();
    expect(canvas.gl.viewport).toHaveBeenCalledTimes(1);

    root.setSize({ cssHeight: 5, cssWidth: 10, pixelRatio: 2 });
    expect(sizeListener).toHaveBeenCalledTimes(2);
    expect(callbacks).toHaveLength(0);
    root.invalidate();
    callbacks.shift()!();
    expect(canvas.gl.viewport).toHaveBeenCalledTimes(1);
  });

  it("renders the first size even when the canvas already has that backing size", () => {
    const { callbacks, root } = harness();
    root.setSize({ cssHeight: 150, cssWidth: 300, pixelRatio: 1 });
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(root.getSnapshot()).toMatchObject({
      frame: 1,
      size: { backingHeight: 150, backingWidth: 300 },
    });
  });

  it("uploads one canonical surface once and reuses it across frames", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      })],
    }));
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(1);
    expect(canvas.gl.useProgram).toHaveBeenCalledTimes(1);
    root.invalidate();
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(canvas.gl.useProgram).toHaveBeenCalledTimes(1);

    const rebuiltScene = scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ color: [0.8, 0.2, 0.4, 1] }),
      })],
    });
    root.setScene(rebuiltScene);
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(3);
    expect(canvas.gl.useProgram).toHaveBeenCalledTimes(1);
  });

  it("draws public wireframes through native line topology", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: wireframeMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      })],
    }));
    callbacks.shift()!();

    expect(canvas.gl.drawElements).toHaveBeenCalledWith(
      canvas.gl.LINES,
      12,
      canvas.gl.UNSIGNED_BYTE,
      0,
    );
  });

  it("admits intermediate surface batches without redrawing unchanged content", () => {
    const { callbacks, canvas, root } = harness();
    const geometry = planeGeometry([2, 1]);
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: Array.from({ length: 40 }, (_, index) => mesh({
        geometry,
        material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
        transform: { position: [index * 0.01, 0, 0] },
      })),
    }));
    callbacks.shift()!();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(16);
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()!();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(16);
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()!();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(56);
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(callbacks).toHaveLength(0);
  });

  it("keeps textured geometry stable while neutral content progresses to one shared upload", async () => {
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
    const { callbacks, canvas, root } = harness({ decodeTexture });
    const texture = imageTexture("/checker.png");
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ texture }),
      })],
    }));
    expect(root.getTextureAssetSnapshot(texture)).toEqual({ state: "loading" });
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    expect(canvas.gl.texImage2D).not.toHaveBeenCalled();
    const vertexArrayBindings = vi.mocked(canvas.gl.bindVertexArray).mock.calls.length;

    const source = {} as ImageBitmap;
    resolveDecode?.({ height: 32, source, width: 64 });
    await waitFor(() => expect(root.getTextureAssetSnapshot(texture)).toEqual({
      height: 32,
      state: "ready",
      width: 64,
    }));
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    expect(canvas.gl.bindVertexArray).toHaveBeenCalledTimes(vertexArrayBindings);
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(vi.mocked(canvas.gl.texSubImage2D).mock.calls[0]!.at(-1)).toBe(source);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(canvas.gl.shaderSource.mock.calls.some(([, shader]) =>
      String(shader).includes("#define TEXTURED"))).toBe(true);
  });

  it("publishes offline ETC2 mip levels through the same texture lifecycle", async () => {
    const decodeTexture = vi.fn(async () => ({
      colorSpace: "srgb" as const,
      height: 8,
      kind: "ktx2-etc2" as const,
      levels: [8, 4, 2, 1].map((size) => ({
        blocks: new Uint8Array(Math.ceil(size / 4) ** 2 * 16),
        height: size,
        width: size,
      })),
      width: 8,
    }));
    const { callbacks, canvas, root } = harness({ decodeTexture }, {
      getExtension: vi.fn((name: string) => name === "WEBGL_compressed_texture_etc"
        ? {}
        : null) as WebGL2RenderingContext["getExtension"],
    });
    const texture = imageTexture("/checker.ktx2");
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ texture }),
      })],
    }));

    await waitFor(() => expect(root.getTextureAssetSnapshot(texture).state).toBe("ready"));
    callbacks.shift()!();
    expect(canvas.gl.compressedTexImage2D).toHaveBeenCalledTimes(4);
    expect(canvas.gl.texImage2D).not.toHaveBeenCalled();
    expect(canvas.gl.generateMipmap).not.toHaveBeenCalled();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(1);
  });

  it("commits intermediate texture resources without presenting the whole scene", async () => {
    let now = 0;
    let nextDelay = 1;
    const delays = new Map<number, () => void>();
    const resolvers = new Map<string, (source: {
      height: number;
      source: TexImageSource;
      width: number;
    }) => void>();
    const decodeTexture = vi.fn<NonNullable<CanvasRootPlatform["decodeTexture"]>>(
      (asset) => new Promise((resolve) => {
        if (asset.kind !== "asset") throw new Error("expected direct test texture");
        resolvers.set(asset.src, resolve);
      }),
    );
    const { callbacks, canvas, root } = harness({
      cancelDelay: (handle) => delays.delete(handle as number),
      decodeTexture,
      now: () => now,
      requestDelay: (callback) => {
        const handle = nextDelay;
        nextDelay += 1;
        delays.set(handle, callback);
        return handle;
      },
    });
    const textures = ["/one.png", "/two.png", "/three.png"].map((src) => imageTexture(src));
    const geometry = planeGeometry([2, 1]);
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: textures.map((texture, index) => mesh({
        geometry,
        material: unlitMaterial({ texture }),
        transform: { position: [index * 0.1, 0, 0] },
      })),
    }));
    callbacks.shift()!();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(3);

    resolvers.get("/one.png")!({ height: 8, source: {} as ImageBitmap, width: 8 });
    await waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks.shift()!();
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(3);

    now = 10;
    resolvers.get("/two.png")!({ height: 8, source: {} as ImageBitmap, width: 8 });
    await waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks.shift()!();
    expect(canvas.gl.texSubImage2D).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(3);
    expect(root.getSnapshot().frame).toBe(1);
    expect(delays.size).toBe(1);

    now = 100;
    delays.values().next().value!();
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(6);
    expect(root.getSnapshot().frame).toBe(2);
    root.dispose();
  });

  it("initializes fixed sampler units once per program rather than once per draw", async () => {
    const decodeTexture = vi.fn(async () => ({
      height: 8,
      source: {} as ImageBitmap,
      width: 8,
    }));
    const { callbacks, canvas, root } = harness({ decodeTexture });
    const texture = imageTexture("/shared.png");
    const geometry = planeGeometry([2, 1]);
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [
        mesh({ geometry, material: unlitMaterial({ texture }) }),
        mesh({
          geometry,
          material: unlitMaterial({ texture }),
          transform: { position: [0.25, 0, 0] },
        }),
      ],
    }));
    await waitFor(() => expect(root.getTextureAssetSnapshot(texture).state).toBe("ready"));
    callbacks.shift()!();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(canvas.gl.uniform1i).toHaveBeenCalledTimes(1);
    expect(canvas.gl.uniform1i).toHaveBeenCalledWith(expect.anything(), 0);
  });

  it("renders committed camera-resource changes without rebuilding scene resources", () => {
    const { callbacks, canvas, root } = harness();
    const camera = createCameraViewResource(perspectiveCamera({ position: [0, 0, 3] }));
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera,
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      })],
    }));
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    const firstMatrixCalls = canvas.gl.uniformMatrix4fv.mock.calls.length;

    camera.position[0] = 0.5;
    camera.commit();
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.uniformMatrix4fv.mock.calls.length).toBeGreaterThan(firstMatrixCalls);

    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 4] }),
      nodes: [],
    }));
    callbacks.shift()!();
    camera.position[0] = 1;
    camera.commit();
    expect(callbacks).toHaveLength(0);
  });

  it("executes solid standard material lighting and mirrored winding through complete state", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      environment: studioEnvironment({ radianceScaleNits: 20, rotation: [0, 0.25, 0] }),
      exposureEv100: 2,
      nodes: [
        directionalLight({
          direction: [0, 0, -1],
          illuminanceLux: 8,
        }),
        pointLight({
          intensityCandela: 4,
          position: [0, 1, 2],
          range: 8,
        }),
        mesh({
          geometry: planeGeometry([2, 1]),
          material: standardMaterial({
            color: [0.2, 0.4, 0.8, 1],
            metallic: 0.25,
            roughness: 0.75,
          }),
          transform: { scale: [-1, 1, 1] },
        }),
      ],
      toneMapping: "pbr-neutral",
    }));
    callbacks.shift()!();

    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(1);
    expect(canvas.gl.uniform1i).toHaveBeenCalledWith(expect.anything(), 1);
    expect(vi.mocked(canvas.gl.uniform4fv).mock.calls.some(([, value]) => {
      const values = Array.from(value);
      return Math.abs(values[0]! - 1 / 4.8) < 0.000_001
        && values[1] === 1
        && values[2] === 0
        && values[3] === 0;
    })).toBe(true);
    expect(canvas.gl.frontFace).toHaveBeenLastCalledWith(canvas.gl.CW);
    expect(canvas.gl.shaderSource.mock.calls.some(([, source]) =>
      String(source).includes("ggxDistribution"))).toBe(true);
    expect(canvas.gl.shaderSource.mock.calls.some(([, source]) =>
      String(source).includes("#define STUDIO_ENVIRONMENT"))).toBe(true);
    expect(canvas.gl.shaderSource.mock.calls.some(([, source]) =>
      String(source).includes("#define PUNCTUAL_LIGHTS"))).toBe(true);
    expect(canvas.gl.shaderSource.mock.calls.some(([, source]) =>
      String(source).includes("normalize(mat3(environmentRotation)"))).toBe(false);
    expect(canvas.gl.uniformMatrix4fv).toHaveBeenCalledWith(
      expect.anything(),
      false,
      expect.anything(),
    );
  });

  it("groups opaque draw work by shader variant without changing surface count", () => {
    const { callbacks, canvas, root } = harness();
    const geometry = planeGeometry([2, 1]);
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [
        mesh({
          geometry,
          material: unlitMaterial({ color: [1, 0, 0, 1] }),
        }),
        directionalLight({ direction: [0, 0, -1], illuminanceLux: 8 }),
        mesh({
          geometry,
          material: standardMaterial({ color: [0, 1, 0, 1] }),
        }),
        mesh({
          geometry,
          material: unlitMaterial({ color: [0, 0, 1, 1] }),
        }),
      ],
    }));
    callbacks.shift()!();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(3);
    expect(canvas.gl.useProgram).toHaveBeenCalledTimes(2);
  });

  it("draws opaque surfaces before retained transparent work with straight-alpha state", () => {
    const { callbacks, canvas, root } = harness();
    const geometry = planeGeometry([2, 1]);
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [
        mesh({ geometry, material: unlitMaterial({ color: [1, 0, 0, 0.5] }) }),
        mesh({ geometry, material: unlitMaterial({ color: [0, 0, 1, 1] }) }),
      ],
    }));
    callbacks.shift()!();

    const materialColors = vi.mocked(canvas.gl.uniform4fv).mock.calls
      .map(([, value]) => Array.from(value))
      .filter((value) => value[0] === 1 || value[2] === 1);
    expect(materialColors).toEqual([
      [0, 0, 1, 1],
      [1, 0, 0, 0.5],
    ]);
    expect(canvas.gl.blendFuncSeparate).toHaveBeenCalledWith(
      canvas.gl.SRC_ALPHA,
      canvas.gl.ONE_MINUS_SRC_ALPHA,
      canvas.gl.ONE,
      canvas.gl.ONE_MINUS_SRC_ALPHA,
    );
    expect(canvas.gl.depthMask).toHaveBeenLastCalledWith(false);
  });

  it("restores depth writes before clearing after a transparent frame", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ color: [1, 0, 0, 0.5] }),
      })],
    }));
    callbacks.shift()!();
    root.invalidate();
    callbacks.shift()!();

    expect(vi.mocked(canvas.gl.depthMask).mock.calls).toEqual([
      [true],
      [false],
      [true],
      [false],
    ]);
  });

  it("keeps off-frustum surfaces out of the draw shell", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        transform: { position: [100, 0, 0] },
      })],
    }));
    callbacks.shift()!();
    expect(canvas.gl.drawElements).not.toHaveBeenCalled();
  });

  it("uploads shared authored material uniforms once per program", async () => {
    const document = staticTriangleDocument();
    delete document.extensionsRequired;
    delete document.extensionsUsed;
    document.materials = [{
      pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.8, 1] },
    }];
    const meshes = document.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    meshes[0]!.primitives.push({ ...meshes[0]!.primitives[0] });
    const readGltf = vi.fn(async () => staticTriangleGlb(document));
    const { callbacks, canvas, root } = harness({ readGltf });
    const node = gltf("/shared-material.glb");
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    vi.mocked(canvas.gl.uniform4fv).mockClear();
    vi.mocked(canvas.gl.uniformMatrix4fv).mockClear();
    callbacks.shift()!();

    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(canvas.gl.uniform4fv).toHaveBeenCalledTimes(5);
    expect(canvas.gl.uniformMatrix4fv).toHaveBeenCalledTimes(3);

    vi.mocked(canvas.gl.uniform4fv).mockClear();
    root.invalidate();
    callbacks.shift()!();
    expect(canvas.gl.uniform4fv).toHaveBeenCalledTimes(1);
  });

  it("activates authored glTF specular factors only on their material variant", async () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_specular"];
    document.extensionsUsed = ["KHR_materials_specular"];
    document.materials = [{
      extensions: {
        KHR_materials_specular: {
          specularColorFactor: [0.5, 1, 2],
          specularFactor: 0.25,
        },
      },
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.4 },
    }];
    const readGltf = vi.fn(async () => staticTriangleGlb(document));
    const { callbacks, canvas, root } = harness({ readGltf });
    const node = gltf("/specular.glb");
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    callbacks.shift()!();

    expect(canvas.gl.shaderSource.mock.calls.some(([, source]) =>
      String(source).includes("#define SPECULAR_MATERIAL"))).toBe(true);
    expect(vi.mocked(canvas.gl.uniform4fv).mock.calls.some(([, value]) =>
      Array.from(value).join(",") === "0.5,1,2,0.25")).toBe(true);
  });

  it("coalesces adjacent opaque arena ranges when WEBGL_multi_draw is available", async () => {
    const multiDrawElementsWEBGL = vi.fn();
    const document = staticTriangleDocument();
    const meshes = document.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    meshes[0]!.primitives.push({ ...meshes[0]!.primitives[0] });
    const readGltf = vi.fn(async () => staticTriangleGlb(document));
    const { callbacks, canvas, root } = harness({ readGltf }, {
      getExtension: vi.fn((name: string) => name === "WEBGL_multi_draw"
        ? { multiDrawElementsWEBGL }
        : null) as WebGL2RenderingContext["getExtension"],
    });
    const node = gltf("/multi-draw.glb");
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    callbacks.shift()!();

    expect(canvas.gl.drawElements).not.toHaveBeenCalled();
    expect(multiDrawElementsWEBGL).toHaveBeenCalledOnce();
    const call = multiDrawElementsWEBGL.mock.calls[0]!;
    expect([...call[1].slice(0, call[6])]).toEqual([3, 3]);
    expect([...call[4].slice(0, call[6])]).toEqual([0, 3]);
  });

  it("coalesces ordered transmission ranges without changing their draw order", async () => {
    const multiDrawElementsWEBGL = vi.fn();
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_transmission"];
    document.extensionsUsed = ["KHR_materials_transmission"];
    document.materials = [{
      extensions: { KHR_materials_transmission: { transmissionFactor: 1 } },
    }];
    const meshes = document.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    meshes[0]!.primitives[0]!.material = 0;
    meshes[0]!.primitives.push({ ...meshes[0]!.primitives[0] });
    const readGltf = vi.fn(async () => staticTriangleGlb(document));
    const { callbacks, root } = harness({ readGltf }, {
      getExtension: vi.fn((name: string) => name === "WEBGL_multi_draw"
        ? { multiDrawElementsWEBGL }
        : null) as WebGL2RenderingContext["getExtension"],
    });
    const node = gltf("/multi-draw-transmission.glb");
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    for (let attempt = 0; attempt < 4 && multiDrawElementsWEBGL.mock.calls.length === 0; attempt += 1) {
      await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));
      callbacks.shift()!();
    }

    expect(multiDrawElementsWEBGL).toHaveBeenCalled();
    const call = multiDrawElementsWEBGL.mock.calls.at(-1)!;
    expect([...call[1].slice(0, call[6])]).toEqual([3, 3]);
    expect([...call[4].slice(0, call[6])]).toEqual([0, 3]);
  });

  it("never coalesces color draws across distinct material identities", async () => {
    const multiDrawElementsWEBGL = vi.fn();
    const document = staticTriangleDocument();
    document.materials = [
      { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
      { pbrMetallicRoughness: { baseColorFactor: [0, 1, 0, 1] } },
    ];
    const meshes = document.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    meshes[0]!.primitives[0]!.material = 0;
    meshes[0]!.primitives.push({ ...meshes[0]!.primitives[0], material: 1 });
    const readGltf = vi.fn(async () => staticTriangleGlb(document));
    const { callbacks, canvas, root } = harness({ readGltf }, {
      getExtension: vi.fn((name: string) => name === "WEBGL_multi_draw"
        ? { multiDrawElementsWEBGL }
        : null) as WebGL2RenderingContext["getExtension"],
    });
    const node = gltf("/distinct-materials.glb");
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    callbacks.shift()!();

    expect(multiDrawElementsWEBGL).not.toHaveBeenCalled();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
  });

  it("preserves authored texture identity across staggered publications", async () => {
    const multiDrawElementsWEBGL = vi.fn();
    const textureHandles = [{ label: "upload-0" }, { label: "upload-1" }] as unknown as WebGLTexture[];
    let nextTextureHandle = 0;
    const resolvers = new Map<string, (source: {
      height: number;
      source: TexImageSource;
      width: number;
    }) => void>();
    const decodeTexture = vi.fn<NonNullable<CanvasRootPlatform["decodeTexture"]>>(
      (asset) => new Promise((resolve) => {
        if (asset.kind !== "asset") throw new Error("expected direct test texture");
        resolvers.set(asset.src, resolve);
      }),
    );
    let activeTextureUnit = 0;
    const boundTextures: Array<WebGLTexture | null> = [];
    const drawnBaseColors: Array<WebGLTexture | null> = [];
    const { callbacks, canvas, root } = harness({ decodeTexture }, {
      activeTexture: vi.fn((unit: number) => { activeTextureUnit = unit - 0x84c0; }),
      bindTexture: vi.fn((_target: number, texture: WebGLTexture | null) => {
        boundTextures[activeTextureUnit] = texture;
      }),
      createTexture: vi.fn(() => textureHandles[nextTextureHandle++]!),
      drawElements: vi.fn(() => { drawnBaseColors.push(boundTextures[0] ?? null); }),
      getExtension: vi.fn((name: string) => name === "WEBGL_multi_draw"
        ? { multiDrawElementsWEBGL }
        : null) as WebGL2RenderingContext["getExtension"],
    });
    const textures = [imageTexture("/first.png"), imageTexture("/second.png")];
    const geometry = planeGeometry([2, 1]);
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: textures.map((texture) => mesh({
        geometry,
        material: unlitMaterial({ texture }),
      })),
    }));
    callbacks.shift()!();

    const secondSource = {} as ImageBitmap;
    resolvers.get("/second.png")!({ height: 8, source: secondSource, width: 8 });
    await waitFor(() => expect(root.getTextureAssetSnapshot(textures[1]!).state).toBe("ready"));
    callbacks.shift()!();

    const firstSource = {} as ImageBitmap;
    resolvers.get("/first.png")!({ height: 8, source: firstSource, width: 8 });
    await waitFor(() => expect(root.getTextureAssetSnapshot(textures[0]!).state).toBe("ready"));
    callbacks.shift()!();

    const created = vi.mocked(canvas.gl.createTexture).mock.results.map((result) => result.value);
    expect(created).toHaveLength(2);
    expect(drawnBaseColors.slice(-2)).toEqual([created[1], created[0]]);
    expect(multiDrawElementsWEBGL).not.toHaveBeenCalled();
  });

  it("uses one canonical transform and identity for visible and exact picking work", () => {
    const { callbacks, canvas, root } = harness();
    const node = mesh({
      geometry: planeGeometry([1, 1]),
      material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      pickingGeometry: planeGeometry([4, 1]),
      pickingId: "wide-hit-area",
    });
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));

    const hit = root.pick({ clientX: 240.4, clientY: 120 });
    expect(hit?.point[0]).toBeCloseTo(1, 2);
    expect(hit?.target).toMatchObject({ kind: "mesh", node, pickingId: "wide-hit-area" });
    expect(root.pick({ clientX: 311, clientY: 120 })).toBeUndefined();
    expect(canvas.gl.bufferData).not.toHaveBeenCalled();

    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
  });

  it("matches visible backface culling during picking", () => {
    const { root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 2]),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        transform: { rotation: [0, Math.PI, 0] },
      })],
    }));
    expect(root.pick({ clientX: 160, clientY: 120 })).toBeUndefined();
  });

  it("lowers a semantic scene and rejects unsupported node kinds explicitly", () => {
    const { callbacks, root } = harness();
    root.setSize({ cssHeight: 10, cssWidth: 20, pixelRatio: 1 });
    root.setScene(emptyScene([0.2, 0.3, 0.4, 1]));
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(root.getSnapshot().frame).toBe(1);
    expect(() => root.setScene({
      ...emptyScene(),
      nodes: [{ kind: "not-implemented" }],
    } as unknown as Scene)).toThrow(
      'Royal scenes do not support nodes with kind "not-implemented"',
    );
  });

  it("does not allocate a new public snapshot until observable state changes", () => {
    const { callbacks, root } = harness();
    const initial = root.getSnapshot();
    expect(root.getSnapshot()).toBe(initial);
    root.invalidate();
    expect(root.getSnapshot()).toBe(initial);
    root.setSize({ cssHeight: 10, cssWidth: 20, pixelRatio: 1 });
    const sized = root.getSnapshot();
    expect(sized).not.toBe(initial);
    expect(root.getSnapshot()).toBe(sized);
    callbacks.shift()!();
    expect(root.getSnapshot()).not.toBe(sized);
  });

  it("keeps lifecycle and size observers asleep during unrelated frames", () => {
    const { callbacks, canvas, root } = harness();
    const lifecycleListener = vi.fn();
    const sizeListener = vi.fn();
    root.subscribeLifecycle(lifecycleListener);
    root.subscribeSize(sizeListener);
    root.setSize({ cssHeight: 10, cssWidth: 20, pixelRatio: 1 });
    expect(sizeListener).toHaveBeenCalledTimes(1);
    callbacks.shift()!();
    expect(sizeListener).toHaveBeenCalledTimes(1);
    expect(lifecycleListener).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(lifecycleListener).toHaveBeenCalledTimes(1);
    expect(sizeListener).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid focused and broad subscribers at the public boundary", () => {
    const { root } = harness();
    expect(() => root.subscribe(null as unknown as () => void))
      .toThrow("Royal subscriber must be a function");
    expect(() => root.subscribeLifecycle(null as unknown as () => void))
      .toThrow("Royal subscriber must be a function");
    expect(() => root.subscribeSize(null as unknown as () => void))
      .toThrow("Royal subscriber must be a function");
  });

  it("blocks stale work on loss and reconstructs the current clear intent on restore", () => {
    const { callbacks, canvas, root } = harness();
    const phases: string[] = [];
    root.subscribe(() => phases.push(root.getSnapshot().context.phase));
    root.setSize({ cssHeight: 20, cssWidth: 30, pixelRatio: 1 });
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    callbacks.shift()!();
    expect(canvas.gl.clear).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(phases).toContain("lost");
    expect(phases).toContain("restoring");
    expect(phases).toContain("active");
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(canvas.gl.clear).toHaveBeenCalledTimes(1);
    expect(root.getSnapshot()).toMatchObject({
      context: { generation: 2, interruptions: 1, recoveries: 1 },
      frame: 1,
    });
  });

  it("captures scheduled draw failure without advancing the frame", () => {
    const { callbacks, canvas, root, scheduledFailures } = harness();
    canvas.gl.clear.mockImplementationOnce(() => {
      throw new Error("context command failed");
    });
    root.setSize({ cssHeight: 20, cssWidth: 30, pixelRatio: 1 });
    callbacks.shift()!();
    expect(scheduledFailures).toHaveLength(1);
    expect(root.getSnapshot()).toMatchObject({
      frame: 0,
      lastFrameFailure: "context command failed",
    });
  });

  it("latches scheduled draw failure until explicit invalidation", () => {
    const { callbacks, canvas, root, scheduledFailures } = harness();
    canvas.gl.clear.mockImplementationOnce(() => {
      root.invalidate();
      throw new Error("shader compilation failed");
    });
    root.setSize({ cssHeight: 20, cssWidth: 30, pixelRatio: 1 });
    callbacks.shift()!();
    expect(scheduledFailures).toHaveLength(1);
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(scheduledFailures).toHaveLength(1);
    expect(callbacks).toHaveLength(0);
    root.invalidate();
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(root.getSnapshot()).toMatchObject({ frame: 1 });
    expect(root.getSnapshot().lastFrameFailure).toBeUndefined();
  });

  it("publishes disposal once and rejects later imperative work", () => {
    const { root } = harness();
    const phases: string[] = [];
    root.subscribe(() => phases.push(root.getSnapshot().context.phase));
    root.dispose();
    root.dispose();
    expect(phases).toEqual(["disposed"]);
    expect(() => root.invalidate()).toThrow("disposed Royal renderer root");
    expect(() => root.setSize({ cssHeight: 1, cssWidth: 1, pixelRatio: 1 }))
      .toThrow("disposed Royal renderer root");
  });
});
