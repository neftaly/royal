import { describe, expect, it, vi } from "vitest";
import { waitFor } from "./support/wait-for";
import {
  prepareStaticGltfInBrowser,
  shouldPrepareStaticGltfInWorker,
} from "../../packages/renderer-webgl/src/gltf/browser-static-preparation";

class FakeWorker extends EventTarget {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

const glbBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  new DataView(bytes.buffer).setUint32(0, 0x46_54_6c_67, true);
  return bytes;
};

describe("browser static glTF preparation", () => {
  it("uses workload shape to avoid worker startup for tiny self-contained GLBs", () => {
    expect(shouldPrepareStaticGltfInWorker(glbBytes(128))).toBe(false);
    expect(shouldPrepareStaticGltfInWorker(glbBytes(256 * 1024))).toBe(true);
    expect(shouldPrepareStaticGltfInWorker(new TextEncoder().encode("{}"))).toBe(true);
  });

  it("transfers source ownership and terminates the worker after publication", async () => {
    const worker = new FakeWorker();
    const bytes = new TextEncoder().encode("{}");
    const result = prepareStaticGltfInBrowser(
      bytes,
      "asset:v1",
      "test asset",
      "/asset.gltf",
      new AbortController().signal,
      vi.fn(),
      () => worker as unknown as Worker,
    );
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contentKey: "asset:v1", kind: "prepare" }),
      [bytes.buffer],
    );
    const prepared = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      primitives: [],
      textureAssets: [],
    } as const;
    worker.dispatchEvent(new MessageEvent("message", {
      data: { kind: "ready", prepared },
    }));
    await expect(result).resolves.toBe(prepared);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("keeps worker resource reads in the injected asset lifecycle", async () => {
    const worker = new FakeWorker();
    const source = new TextEncoder().encode("{}");
    const external = new Uint8Array([4, 5, 6]);
    const readResource = vi.fn(async () => external);
    const result = prepareStaticGltfInBrowser(
      source,
      "asset:external",
      "external asset",
      "/asset.gltf",
      new AbortController().signal,
      readResource,
      () => worker as unknown as Worker,
    );

    worker.dispatchEvent(new MessageEvent("message", {
      data: { id: 7, kind: "read-resource", uri: "/asset.bin" },
    }));
    await waitFor(() => expect(readResource).toHaveBeenCalledWith("/asset.bin"));
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      { bytes: external, id: 7, kind: "read-resource-ready" },
      [external.buffer],
    );

    const prepared = {
      bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
      primitives: [],
      textureAssets: [],
    } as const;
    worker.dispatchEvent(new MessageEvent("message", {
      data: { kind: "ready", prepared },
    }));
    await expect(result).resolves.toBe(prepared);
  });

  it("terminates in-flight preparation when its asset claim is aborted", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const result = prepareStaticGltfInBrowser(
      glbBytes(256 * 1024),
      "asset:v2",
      "test asset",
      "/asset.glb",
      controller.signal,
      vi.fn(),
      () => worker as unknown as Worker,
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
