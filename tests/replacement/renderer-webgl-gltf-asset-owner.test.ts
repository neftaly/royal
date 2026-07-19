import { gltf } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { GltfAssetOwner } from "../../packages/renderer-webgl/src/gltf/asset-owner";
import { staticTriangleGlb, staticTriangleGltf } from "./support/static-glb";

describe("glTF asset lifecycle owner", () => {
  it("routes preparation through one injected lifecycle without duplicating resource IO", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const prepared = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lights: [],
      primitives: [],
      textureAssets: [],
    } as const;
    const prepare = vi.fn(async () => prepared);
    const readResource = vi.fn();
    const owner = new GltfAssetOwner({
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      prepare,
      read: vi.fn(async () => bytes),
      readResource,
    });
    const node = gltf("/models/large.gltf");
    owner.reconcile([node]);
    await vi.waitFor(() => expect(owner.getSnapshot(node.asset).state).toBe("ready"));
    expect(prepare).toHaveBeenCalledWith(
      bytes,
      expect.any(String),
      "glTF \"/models/large.gltf\"",
      "/models/large.gltf",
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(readResource).not.toHaveBeenCalled();
  });

  it("keeps external JSON buffer IO in the same cancellable asset lifecycle", async () => {
    const fixture = staticTriangleGltf();
    const readResource = vi.fn(async () => fixture.binary);
    const owner = new GltfAssetOwner({
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      read: vi.fn(async () => fixture.document),
      readResource,
    });
    const node = gltf("/models/triangle.gltf");
    owner.reconcile([node]);
    await vi.waitFor(() => expect(owner.getSnapshot(node.asset).state).toBe("ready"));
    expect(readResource).toHaveBeenCalledWith(
      "/models/triangle.bin",
      expect.any(AbortSignal),
    );
  });

  it("deduplicates exact identities and publishes loading then ready once", async () => {
    const changes = vi.fn();
    const listener = vi.fn();
    const read = vi.fn(async () => staticTriangleGlb());
    const owner = new GltfAssetOwner({
      onAssetChanged: changes,
      onListenerError: vi.fn(),
      read,
      readResource: vi.fn(),
    });
    const first = gltf({ src: "/model.glb", version: "v1" });
    const second = gltf({ src: "/model.glb", version: "v1" });
    owner.subscribe(first.asset, listener);
    owner.reconcile([first, second]);
    expect(owner.getSnapshot(first.asset)).toEqual({ state: "loading" });
    expect(listener).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      expect(owner.getSnapshot(first.asset)).toEqual({
        bounds: { max: [2, 3, 0], min: [0, 1, 0] },
        primitiveCount: 1,
        state: "ready",
      });
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(owner.prepared(first.asset)?.primitives).toHaveLength(1);
  });

  it("aborts released work and returns observers to idle", async () => {
    let signal: AbortSignal | undefined;
    let resolveRead: ((bytes: Uint8Array) => void) | undefined;
    const read = vi.fn((_asset, nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<Uint8Array>((resolve) => {
        resolveRead = resolve;
      });
    });
    const listener = vi.fn();
    const changes = vi.fn();
    const owner = new GltfAssetOwner({
      onAssetChanged: changes,
      onListenerError: vi.fn(),
      read,
      readResource: vi.fn(),
    });
    const node = gltf("/slow.glb");
    owner.subscribe(node.asset, listener);
    owner.reconcile([node]);
    owner.reconcile([]);
    expect(signal?.aborted).toBe(true);
    expect(owner.getSnapshot(node.asset)).toEqual({ state: "idle" });
    expect(listener).toHaveBeenCalledTimes(2);
    resolveRead?.(staticTriangleGlb());
    await Promise.resolve();
    await Promise.resolve();
    expect(owner.getSnapshot(node.asset)).toEqual({ state: "idle" });
    expect(changes).not.toHaveBeenCalled();
  });

  it("retains bounded content failures without retrying on reconciliation", async () => {
    const read = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const owner = new GltfAssetOwner({
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      read,
      readResource: vi.fn(),
    });
    const node = gltf("/broken.glb");
    owner.reconcile([node]);
    await vi.waitFor(() => expect(owner.getSnapshot(node.asset).state).toBe("error"));
    const snapshot = owner.getSnapshot(node.asset);
    expect(snapshot).toMatchObject({ state: "error" });
    if (snapshot.state === "error") expect(snapshot.error.length).toBeLessThanOrEqual(400);
    owner.reconcile([node]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
