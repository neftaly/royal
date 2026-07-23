import { gltf, imageTexture } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "./support/wait-for";
import {
  GltfAssetOwner,
  type GltfAssetOwnerPlatform,
} from "../../packages/renderer-webgl/src/gltf/asset-owner";
import { prepareStaticGltfSource } from "../../packages/renderer-webgl/src/gltf/static-asset";
import type { AsyncPreparationScheduler } from "../../packages/renderer-webgl/src/resource/async-preparation-owner";
import { staticTriangleGlb, staticTriangleGltf } from "./support/static-glb";

const prepareStatic = (
  bytes: Uint8Array,
  contentKey: string,
  label: string,
  sourceUri: string,
  _signal: AbortSignal,
  readResource: (uri: string) => Promise<Uint8Array>,
  sceneIndex?: number,
) => prepareStaticGltfSource(
  bytes,
  contentKey,
  label,
  sourceUri,
  readResource,
  undefined,
  true,
  sceneIndex,
);

describe("glTF asset lifecycle owner", () => {
  it("separates selected-scene lifecycle while preserving source content identity", async () => {
    const prepared = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lights: [],
      nodeCount: 0,
      primitives: [],
      sceneIndex: 0,
      scenes: [{ index: 0 }],
      textureAssets: [],
      variantNames: [],
    } as const;
    const prepare = vi.fn<NonNullable<GltfAssetOwnerPlatform["prepare"]>>(
      async (_bytes, _key, _label, _uri, _signal, _read, sceneIndex) => ({
        ...prepared,
        sceneIndex: sceneIndex ?? 0,
      }),
    );
    const owner = new GltfAssetOwner({
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      prepare,
      read: vi.fn(async () => new Uint8Array([1, 2, 3])),
      readResource: vi.fn(),
    });
    const exterior = gltf({ sceneIndex: 0, src: "/bistro.gltf", version: "web-v5" });
    const interior = gltf({ sceneIndex: 1, src: "/bistro.gltf", version: "web-v5" });

    owner.reconcile([exterior, interior]);
    await waitFor(() => expect(owner.getSnapshot(exterior.asset).status).toBe("ready"));
    await waitFor(() => expect(owner.getSnapshot(interior.asset).status).toBe("ready"));

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(owner.getSnapshot(exterior.asset).status).toBe("ready");
    expect(new Set(prepare.mock.calls.map((call) => call[1])).size).toBe(1);
    expect(prepare.mock.calls.map((call) => call[6])).toEqual([0, 1]);
    expect(owner.getSnapshot(exterior.asset)).toMatchObject({ sceneIndex: 0 });
    expect(owner.getSnapshot(interior.asset)).toMatchObject({ sceneIndex: 1 });
  });

  it("shares exact root and referenced-resource reads across selected assets", async () => {
    const prepared = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lights: [],
      nodeCount: 0,
      primitives: [],
      sceneIndex: 0,
      scenes: [{ index: 0 }],
      textureAssets: [],
      variantNames: [],
    } as const;
    const read = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const readResource = vi.fn(async () => new Uint8Array([4, 5, 6]));
    const prepare = vi.fn<NonNullable<GltfAssetOwnerPlatform["prepare"]>>(
      async (_bytes, _key, _label, _uri, _signal, resource, sceneIndex) => {
        const bytes = await resource("/models/shared.bin", {
          byteLength: 3,
          ranges: [{ byteLength: 1, byteOffset: sceneIndex ?? 0 }],
        });
        bytes[0] = sceneIndex ?? 0;
        return { ...prepared, sceneIndex: sceneIndex ?? 0 };
      },
    );
    const owner = new GltfAssetOwner({
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      prepare,
      read,
      readResource,
      readResourceRanges: false,
    });
    const first = gltf({ sceneIndex: 0, src: "/models/shared.gltf", version: 1 });
    const second = gltf({ sceneIndex: 1, src: "/models/shared.gltf", version: 1 });

    owner.reconcile([first, second]);
    await waitFor(() => expect(owner.getSnapshot(first.asset).status).toBe("ready"));
    await waitFor(() => expect(owner.getSnapshot(second.asset).status).toBe("ready"));

    expect(read).toHaveBeenCalledOnce();
    expect(readResource).toHaveBeenCalledOnce();
    expect(readResource).toHaveBeenCalledWith(
      first.asset,
      "/models/shared.bin",
      expect.any(AbortSignal),
    );

    const changedVersion = gltf({ sceneIndex: 0, src: "/models/shared.gltf", version: 2 });
    owner.reconcile([first, changedVersion]);
    await waitFor(() => expect(owner.getSnapshot(changedVersion.asset).status).toBe("ready"));
    expect(read).toHaveBeenCalledTimes(2);
    expect(readResource).toHaveBeenCalledTimes(2);
    owner.dispose();
  });

  it("routes preparation through one injected lifecycle without duplicating resource IO", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const prepared = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lights: [],
      nodeCount: 0,
      primitives: [],
      sceneIndex: 2,
      scenes: [{ index: 0 }, { index: 1 }, { index: 2 }],
      textureAssets: [],
      variantNames: [],
    } as const;
    const prepare = vi.fn(async () => prepared);
    const readResource = vi.fn();
    const scheduled = vi.fn();
    const schedule: AsyncPreparationScheduler = (signal, work) => {
      scheduled(signal);
      return work();
    };
    const owner = new GltfAssetOwner({
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      prepare,
      read: vi.fn(async () => bytes),
      readResource,
      schedule,
    });
    const node = gltf({ sceneIndex: 2, src: "/models/large.gltf" });
    owner.reconcile([node]);
    await waitFor(() => expect(owner.getSnapshot(node.asset).status).toBe("ready"));
    expect(prepare).toHaveBeenCalledWith(
      bytes,
      expect.any(String),
      "glTF \"/models/large.gltf\"",
      "/models/large.gltf",
      expect.any(AbortSignal),
      expect.any(Function),
      2,
      undefined,
    );
    expect(readResource).not.toHaveBeenCalled();
    expect(scheduled).toHaveBeenCalledOnce();
  });

  it("keeps external JSON buffer IO in the same cancellable asset lifecycle", async () => {
    const fixture = staticTriangleGltf();
    const document = JSON.parse(new TextDecoder().decode(fixture.document)) as
      Record<string, unknown>;
    document.extras = { application: { revision: 3 } };
    const rootBytes = new TextEncoder().encode(JSON.stringify(document));
    const read = vi.fn(async () => rootBytes);
    const readResource = vi.fn(async () => fixture.binary);
    const owner = new GltfAssetOwner({
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      prepare: prepareStatic,
      read,
      readResource,
    });
    const node = gltf("/models/triangle.gltf");
    owner.reconcile([node]);
    await waitFor(() => expect(owner.getSnapshot(node.asset).status).toBe("ready"));
    expect(readResource).toHaveBeenCalledWith(
      node.asset,
      "/models/triangle.bin",
      expect.any(AbortSignal),
    );
    const ready = owner.getSnapshot(node.asset);
    expect(ready.status).toBe("ready");
    if (ready.status === "ready") {
      expect(ready.rootExtras).toEqual({ application: { revision: 3 } });
      expect(ready.timings.externalResourceReadDurationMs).toBeGreaterThanOrEqual(0);
    }
    expect(read).toHaveBeenCalledOnce();
  });

  it("reports concurrent external reads as one disjoint wall-clock span", async () => {
    let now = 0;
    let resolveFirst: ((bytes: Uint8Array) => void) | undefined;
    let resolveSecond: ((bytes: Uint8Array) => void) | undefined;
    const prepared = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lights: [],
      nodeCount: 0,
      primitives: [],
      sceneIndex: 0,
      scenes: [{ index: 0 }],
      textureAssets: [],
      variantNames: [],
    } as const;
    const owner = new GltfAssetOwner({
      now: () => now,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      prepare: async (_bytes, _key, _label, _uri, _signal, readResource) => {
        now = 10;
        const first = readResource("/first.bin");
        now = 12;
        const second = readResource("/second.bin");
        now = 30;
        resolveFirst?.(new Uint8Array([1]));
        await first;
        now = 32;
        resolveSecond?.(new Uint8Array([2]));
        await second;
        now = 40;
        return prepared;
      },
      read: vi.fn(async () => {
        now = 5;
        return new Uint8Array([1]);
      }),
      readResource: vi.fn((_asset, uri) => new Promise<Uint8Array>((resolve) => {
        if (uri === "/first.bin") resolveFirst = resolve;
        else resolveSecond = resolve;
      })),
    });
    const node = gltf("/parallel.gltf");
    owner.reconcile([node]);
    await waitFor(() => expect(owner.getSnapshot(node.asset).status).toBe("ready"));
    const snapshot = owner.getSnapshot(node.asset);
    expect(snapshot).toMatchObject({
      status: "ready",
      timings: {
        externalResourceReadDurationMs: 22,
        preparationDurationMs: 13,
        sourceReadDurationMs: 5,
      },
    });
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
    expect(owner.getSnapshot(first.asset)).toEqual({ status: "loading" });
    expect(listener).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(owner.getSnapshot(first.asset)).toEqual({
        bounds: { max: [2, 3, 0], min: [0, 1, 0] },
        lightCount: 0,
        nodeCount: 2,
        primitiveCount: 1,
        sceneIndex: 0,
        scenes: [{ index: 0 }],
        status: "ready",
        timings: {
          externalResourceReadDurationMs: 0,
          preparationDurationMs: expect.any(Number),
          sourceReadDurationMs: expect.any(Number),
        },
        textures: { failed: 0, fallback: 0, loading: 0, ready: 0, total: 0 },
        variantNames: [],
      });
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(owner.prepared(first.asset)?.primitives).toHaveLength(1);
    const ready = owner.getSnapshot(first.asset);
    expect(ready.status).toBe("ready");
    if (ready.status === "ready") {
      expect(ready.timings.sourceReadDurationMs).toBeGreaterThanOrEqual(0);
      expect(ready.timings.externalResourceReadDurationMs).toBe(0);
      expect(ready.timings.preparationDurationMs).toBeGreaterThanOrEqual(0);
    }
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
    expect(owner.getSnapshot(node.asset)).toEqual({ status: "idle" });
    expect(listener).toHaveBeenCalledTimes(2);
    resolveRead?.(staticTriangleGlb());
    await Promise.resolve();
    await Promise.resolve();
    expect(owner.getSnapshot(node.asset)).toEqual({ status: "idle" });
    expect(changes).not.toHaveBeenCalled();
  });

  it("separates usable geometry from streaming and degraded texture progress", async () => {
    const texture = imageTexture("/albedo.avif");
    const rootExtras = {
      application: {
        capabilities: ["stacked-layout"],
        revision: 3,
      },
    } as const;
    const prepared = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      lights: [],
      nodeCount: 0,
      primitives: [],
      rootExtras,
      sceneIndex: 0,
      scenes: [{ index: 0 }],
      textureAssets: [texture],
      variantNames: [],
    } as const;
    const owner = new GltfAssetOwner({
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      prepare: vi.fn(async () => prepared),
      read: vi.fn(async () => new Uint8Array([1])),
      readResource: vi.fn(),
    });
    const node = gltf("/textured.gltf");
    owner.reconcile([node]);
    await waitFor(() => expect(owner.getSnapshot(node.asset).status).toBe("streaming"));
    const streaming = owner.getSnapshot(node.asset);
    expect(streaming).toMatchObject({ rootExtras });
    expect(streaming.status).toBe("streaming");
    if (streaming.status !== "streaming") throw new Error("expected drawable streaming status");
    expect(streaming.rootExtras).not.toBe(rootExtras);
    const publishedRootExtras = streaming.rootExtras;

    owner.refreshTextureProgress(() => ({ error: "decode failed", status: "error" }));
    expect(owner.getSnapshot(node.asset)).toMatchObject({
      status: "degraded",
      timings: {
        externalResourceReadDurationMs: expect.any(Number),
        imagesCompleteAfterMs: expect.any(Number),
        preparationDurationMs: expect.any(Number),
        sourceReadDurationMs: expect.any(Number),
      },
      textures: { failed: 1, fallback: 0, loading: 0, ready: 0, total: 1 },
    });
    const degraded = owner.getSnapshot(node.asset);
    expect(degraded.status).toBe("degraded");
    if (degraded.status === "degraded") {
      expect(degraded.rootExtras).toBe(publishedRootExtras);
    }
    const completionMs = degraded.status === "degraded"
      ? degraded.timings.imagesCompleteAfterMs
      : undefined;
    if (degraded.status === "degraded") {
      expect(completionMs).toBeGreaterThanOrEqual(
        degraded.timings.sourceReadDurationMs
          + degraded.timings.externalResourceReadDurationMs
          + degraded.timings.preparationDurationMs,
      );
    }
    owner.refreshTextureProgress(() => ({
      fallbackReason: "preferred SVG failed",
      height: 16,
      status: "ready",
      width: 16,
    }));
    expect(owner.getSnapshot(node.asset)).toMatchObject({
      status: "ready",
      timings: { imagesCompleteAfterMs: completionMs },
      textures: { failed: 0, fallback: 1, loading: 0, ready: 1, total: 1 },
    });
    const ready = owner.getSnapshot(node.asset);
    if (ready.status === "ready") expect(ready.rootExtras).toBe(publishedRootExtras);

    const publishedApplication = (
      publishedRootExtras as { application: { revision: number } }
    ).application;
    publishedApplication.revision = 4;
    expect(prepared.rootExtras.application.revision).toBe(3);
    expect(owner.prepared(node.asset)?.rootExtras).toBe(rootExtras);
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
    await waitFor(() => expect(owner.getSnapshot(node.asset).status).toBe("error"));
    const snapshot = owner.getSnapshot(node.asset);
    expect(snapshot).toMatchObject({ status: "error" });
    if (snapshot.status === "error") expect(snapshot.error.length).toBeLessThanOrEqual(400);
    owner.reconcile([node]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
