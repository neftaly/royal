import {
  directionalLight,
  gltf,
  perspectiveCamera,
  planeGeometry,
  scene,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { canvasRootHarness as harness } from "./support/canvas-root-harness";
import {
  staticInstancedTriangleGlb,
  staticTriangleDocument,
  staticTriangleGlb,
  staticTexturedTriangleGlb,
} from "./support/static-glb";

describe("canvas root asset publication", () => {
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

    await vi.waitFor(() => expect(root.getGltfAssetSnapshot(node.asset).state).toBe("ready"));
    expect(decodeTexture).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "asset", src: "/models/albedo.png" }),
      expect.any(AbortSignal),
    );
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    expect(canvas.gl.texImage2D).not.toHaveBeenCalled();

    resolveDecode?.({ height: 32, source: {} as ImageBitmap, width: 64 });
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
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
    );
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    resolveDecode?.({ height: 8, source: {} as ImageBitmap, width: 8 });
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(3);
    expect(canvas.gl.texImage2D).toHaveBeenCalledTimes(1);
  });
});
