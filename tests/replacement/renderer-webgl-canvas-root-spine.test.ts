import { describe, expect, it, vi } from "vitest";
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
  type RenderRoot,
} from "@royal/renderer-core";
import { resolveCanvasSize } from "../../packages/renderer-webgl/src/frame/canvas-size";
import { CanvasRoot } from "../../packages/renderer-webgl/src/runtime/canvas-root";
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
      { cssHeight: 1000, cssWidth: 2000, devicePixelRatio: 2 },
      { maxHeight: 1000, maxWidth: 1000 },
    )).toMatchObject({
      backingHeight: 500,
      backingWidth: 1000,
      renderScale: 0.25,
    });
  });

  it("represents a hidden canvas without inventing a drawable pixel", () => {
    expect(resolveCanvasSize(
      { cssHeight: 0, cssWidth: 300, devicePixelRatio: 2 },
      { maxHeight: 4096, maxWidth: 4096 },
    )).toMatchObject({ backingHeight: 0, backingWidth: 0, renderScale: 0 });
  });
});

describe("clear-only canvas root", () => {
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
    root.setSize({ cssHeight: 360, cssWidth: 640, devicePixelRatio: 1 });
    root.setClearColor([0.25, 0.5, 1.5, 1]);
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
  });

  it("uploads one canonical surface once and reuses it across frames", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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
    root.render(rebuiltScene);
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(3);
    expect(canvas.gl.useProgram).toHaveBeenCalledTimes(1);
  });

  it("admits large surface sets across follow-up frames without duplicating geometry", () => {
    const { callbacks, canvas, root } = harness();
    const geometry = planeGeometry([2, 1]);
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: Array.from({ length: 20 }, (_, index) => mesh({
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
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(36);
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
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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
    await vi.waitFor(() => expect(root.getTextureAssetSnapshot(texture)).toEqual({
      height: 32,
      state: "ready",
      width: 64,
    }));
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    expect(canvas.gl.bindVertexArray).toHaveBeenCalledTimes(vertexArrayBindings);
    expect(canvas.gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(canvas.gl.texImage2D.mock.calls[0]!.at(-1)).toBe(source);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(canvas.gl.shaderSource.mock.calls.some(([, shader]) =>
      String(shader).includes("#define TEXTURED"))).toBe(true);
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
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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
    await vi.waitFor(() => expect(root.getTextureAssetSnapshot(texture).state).toBe("ready"));
    callbacks.shift()!();
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(canvas.gl.uniform1i).toHaveBeenCalledTimes(1);
    expect(canvas.gl.uniform1i).toHaveBeenCalledWith(expect.anything(), 0);
  });

  it("renders committed camera-resource changes without rebuilding scene resources", () => {
    const { callbacks, canvas, root } = harness();
    const camera = createCameraViewResource(perspectiveCamera({ position: [0, 0, 3] }));
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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

    root.render(scene({
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
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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

  it("keeps off-frustum surfaces out of the draw shell", () => {
    const { callbacks, canvas, root } = harness();
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [node],
    }));
    callbacks.shift()!();
    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    vi.mocked(canvas.gl.uniform4fv).mockClear();
    vi.mocked(canvas.gl.uniformMatrix4fv).mockClear();
    callbacks.shift()!();

    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(canvas.gl.uniform4fv).toHaveBeenCalledTimes(7);
    expect(canvas.gl.uniformMatrix4fv).toHaveBeenCalledTimes(3);
  });

  it("uses one canonical transform and identity for visible and exact picking work", () => {
    const { callbacks, canvas, root } = harness();
    const node = mesh({
      geometry: planeGeometry([1, 1]),
      material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      pickingGeometry: planeGeometry([4, 1]),
      pickingId: "wide-hit-area",
    });
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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
    root.setSize({ cssHeight: 200, cssWidth: 300, devicePixelRatio: 1 });
    root.render(scene({
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
    root.setSize({ cssHeight: 10, cssWidth: 20, devicePixelRatio: 1 });
    root.render(emptyScene([0.2, 0.3, 0.4, 1]));
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    expect(root.getSnapshot().frame).toBe(1);
    expect(() => root.render({
      ...emptyScene(),
      nodes: [{ kind: "not-implemented" }],
    } as unknown as RenderRoot)).toThrow("does not yet support not-implemented nodes");
  });

  it("does not allocate a new public snapshot until observable state changes", () => {
    const { callbacks, root } = harness();
    const initial = root.getSnapshot();
    expect(root.getSnapshot()).toBe(initial);
    root.invalidate();
    expect(root.getSnapshot()).toBe(initial);
    root.setSize({ cssHeight: 10, cssWidth: 20, devicePixelRatio: 1 });
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
    root.setSize({ cssHeight: 10, cssWidth: 20, devicePixelRatio: 1 });
    expect(sizeListener).toHaveBeenCalledTimes(1);
    callbacks.shift()!();
    expect(sizeListener).toHaveBeenCalledTimes(1);
    expect(lifecycleListener).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(lifecycleListener).toHaveBeenCalledTimes(1);
    expect(sizeListener).toHaveBeenCalledTimes(1);
  });

  it("blocks stale work on loss and reconstructs the current clear intent on restore", () => {
    const { callbacks, canvas, root } = harness();
    const phases: string[] = [];
    root.subscribe(() => phases.push(root.getSnapshot().context.phase));
    root.setSize({ cssHeight: 20, cssWidth: 30, devicePixelRatio: 1 });
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
    root.setSize({ cssHeight: 20, cssWidth: 30, devicePixelRatio: 1 });
    callbacks.shift()!();
    expect(scheduledFailures).toHaveLength(1);
    expect(root.getSnapshot()).toMatchObject({
      frame: 0,
      lastFrameFailure: "context command failed",
    });
  });

  it("publishes disposal once and rejects later imperative work", () => {
    const { root } = harness();
    const phases: string[] = [];
    root.subscribe(() => phases.push(root.getSnapshot().context.phase));
    root.dispose();
    root.dispose();
    expect(phases).toEqual(["disposed"]);
    expect(() => root.invalidate()).toThrow("disposed Royal renderer root");
    expect(() => root.setSize({ cssHeight: 1, cssWidth: 1, devicePixelRatio: 1 }))
      .toThrow("disposed Royal renderer root");
  });
});
