import { describe, expect, it, vi } from "vitest";
import { waitFor } from "./support/wait-for";
import {
  BrowserStaticGltfPreparationOwner,
  prepareStaticGltfInBrowser,
  shouldPrepareStaticGltfInWorker,
} from "../../packages/renderer-webgl/src/gltf/browser-static-preparation";
import { AsyncPreparationOwner } from "../../packages/renderer-webgl/src/resource/async-preparation-owner";

class FakeWorker extends EventTarget {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
}

const glbBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  new DataView(bytes.buffer).setUint32(0, 0x46_54_6c_67, true);
  return bytes;
};

const prepared = {
  bounds: { max: [1, 1, 1], min: [-1, -1, -1] },
  lights: [],
  nodeCount: 0,
  primitives: [],
  textureAssets: [],
  variantNames: [],
} as const;

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
      2,
    );
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        codecs: expect.objectContaining({
          draco: expect.stringContaining("draco-codec"),
          meshopt: expect.stringContaining("meshopt-codec"),
        }),
        contentKey: "asset:v1",
        kind: "prepare",
        sceneIndex: 2,
      }),
      [bytes.buffer],
    );
    const preparedWithExtras = {
      ...prepared,
      rootExtras: { application: { revision: 3 } },
    } as const;
    worker.dispatchEvent(new MessageEvent("message", {
      data: { kind: "ready", prepared: preparedWithExtras },
    }));
    await expect(result).resolves.toBe(preparedWithExtras);
    await expect(result).resolves.toMatchObject({
      rootExtras: { application: { revision: 3 } },
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("sends cloneable geometry task and borrowing intent to the worker", async () => {
    const worker = new FakeWorker();
    const owner = new BrowserStaticGltfPreparationOwner({
      createWorker: () => worker as unknown as Worker,
      workerLimit: 1,
    });
    const bytes = new TextEncoder().encode("{}");
    const geometryTasks = {
      tasks: [{ key: "shared", meshIndex: 0, primitiveIndex: 0 }],
    } as const;
    const result = owner.prepare(
      bytes,
      "asset",
      "asset",
      "/asset.gltf",
      new AbortController().signal,
      vi.fn(),
      undefined,
      undefined,
      geometryTasks,
      new Set(),
    );

    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        computeGeometryTaskKeys: [],
        geometryTasks,
        kind: "prepare",
      }),
      [bytes.buffer],
    );
    worker.dispatchEvent(new MessageEvent("message", {
      data: { kind: "ready", prepared },
    }));
    await expect(result).resolves.toBe(prepared);
    owner.dispose();
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

    worker.dispatchEvent(new MessageEvent("message", {
      data: { kind: "ready", prepared },
    }));
    await expect(result).resolves.toBe(prepared);
  });

  it("returns synchronous resource-reader failures to the preparation worker", async () => {
    const worker = new FakeWorker();
    const result = prepareStaticGltfInBrowser(
      new TextEncoder().encode("{}"),
      "asset",
      "asset",
      "/asset.gltf",
      new AbortController().signal,
      () => {
        throw new Error("reader rejected");
      },
      () => worker as unknown as Worker,
    );

    worker.dispatchEvent(new MessageEvent("message", {
      data: { id: 9, kind: "read-resource", uri: "/buffer.bin" },
    }));
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      error: "reader rejected",
      id: 9,
      kind: "read-resource-error",
    });
    worker.dispatchEvent(new MessageEvent("message", {
      data: { error: "reader rejected", kind: "error" },
    }));

    await expect(result).rejects.toThrow("reader rejected");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
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

  it("reuses only the scheduler-bounded worker set across a many-asset burst", async () => {
    const workers: FakeWorker[] = [];
    const idleDelays: number[] = [];
    const owner = new BrowserStaticGltfPreparationOwner({
      cancelDelay: vi.fn(),
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
      idleWorkerTimeoutMs: 1_000,
      requestDelay: (callback, delayMs) => {
        idleDelays.push(delayMs);
        return callback;
      },
      workerLimit: 2,
    });
    const scheduler = new AsyncPreparationOwner(2);
    const controllers = Array.from({ length: 5 }, () => new AbortController());
    const results = controllers.map((controller, index) =>
      scheduler.runForeground(controller.signal, () => owner.prepare(
        new TextEncoder().encode(`{"asset":${index}}`),
        `asset:${index}`,
        `asset ${index}`,
        `/asset-${index}.gltf`,
        controller.signal,
        vi.fn(),
      )));

    expect(workers).toHaveLength(2);
    for (const worker of workers) {
      worker.dispatchEvent(new MessageEvent("message", {
        data: { kind: "ready", prepared },
      }));
    }
    await waitFor(() => expect(
      workers.reduce((sum, worker) => sum + worker.postMessage.mock.calls.length, 0),
    ).toBe(4));
    for (const worker of workers) {
      worker.dispatchEvent(new MessageEvent("message", {
        data: { kind: "ready", prepared },
      }));
    }
    await waitFor(() => expect(
      workers.reduce((sum, worker) => sum + worker.postMessage.mock.calls.length, 0),
    ).toBe(5));
    const activeWorker = workers.find((worker) => worker.postMessage.mock.calls.length === 3);
    activeWorker?.dispatchEvent(new MessageEvent("message", {
      data: { kind: "ready", prepared },
    }));

    await expect(Promise.all(results)).resolves.toHaveLength(5);
    expect(workers).toHaveLength(2);
    expect(idleDelays).toContain(1_000);
    expect(idleDelays.every((delayMs) => delayMs === 1_000)).toBe(true);
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 0)).toBe(true);
    owner.dispose();
    scheduler.dispose();
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });

  it("reuses a worker after an asset failure and retires it after the idle grace", async () => {
    const worker = new FakeWorker();
    let retire: (() => void) | undefined;
    const owner = new BrowserStaticGltfPreparationOwner({
      createWorker: () => worker as unknown as Worker,
      requestDelay: (callback, delayMs) => {
        expect(delayMs).toBe(1_000);
        retire = callback;
        return callback;
      },
      workerLimit: 2,
    });
    const first = owner.prepare(
      new TextEncoder().encode("{}"),
      "bad",
      "bad asset",
      "/bad.gltf",
      new AbortController().signal,
      vi.fn(),
    );
    worker.dispatchEvent(new MessageEvent("message", {
      data: { error: "invalid asset", kind: "error" },
    }));
    await expect(first).rejects.toThrow("invalid asset");

    const second = owner.prepare(
      new TextEncoder().encode("{}"),
      "good",
      "good asset",
      "/good.gltf",
      new AbortController().signal,
      vi.fn(),
    );
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    worker.dispatchEvent(new MessageEvent("message", {
      data: { kind: "ready", prepared },
    }));
    await expect(second).resolves.toBe(prepared);
    expect(worker.terminate).not.toHaveBeenCalled();

    retire?.();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    owner.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates and rejects every active worker when its root owner is disposed", async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    let nextWorker = 0;
    const owner = new BrowserStaticGltfPreparationOwner({
      createWorker: () => workers[nextWorker++]! as unknown as Worker,
      workerLimit: 2,
    });
    const first = owner.prepare(
      new TextEncoder().encode("{}"),
      "first",
      "first asset",
      "/first.gltf",
      new AbortController().signal,
      vi.fn(),
    );
    const second = owner.prepare(
      new TextEncoder().encode("{}"),
      "second",
      "second asset",
      "/second.gltf",
      new AbortController().signal,
      vi.fn(),
    );

    owner.dispose();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
});
