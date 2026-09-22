import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserStaticGltfPreparationOwner, shouldPrepareStaticGltfInWorker } from "../../packages/renderer-webgl/src/gltf/browser-static-preparation";
import { PoolWorker } from "./support/pool-worker";
import { waitFor } from "./support/wait-for";

beforeEach(() => { PoolWorker.instances = []; PoolWorker.execute = undefined; vi.stubGlobal("Worker", PoolWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const bytes = () => new TextEncoder().encode("{}");
const prepared = { primitives: [], lights: [], textureAssets: [], rootExtras: { revision: 3 } };
const run = (owner: BrowserStaticGltfPreparationOwner, signal = new AbortController().signal, reader = vi.fn(async () => new Uint8Array([4, 5, 6]))) =>
  owner.prepare(bytes(), "asset", "asset", "/asset.gltf", signal, reader);
const first = async () => {
  await waitFor(() => expect(PoolWorker.instances[0]?.requests.length).toBeGreaterThan(0));
  const worker = PoolWorker.instances[0]!;
  return { worker, request: worker.requests.at(-1)! };
};
it("keeps tiny self-contained GLBs local", () => {
  const glb = new Uint8Array(256 * 1024);
  new DataView(glb.buffer).setUint32(0, 0x46546c67, true);
  expect(shouldPrepareStaticGltfInWorker(glb.subarray(0, 128))).toBe(false);
  expect(shouldPrepareStaticGltfInWorker(glb)).toBe(true);
  expect(shouldPrepareStaticGltfInWorker(bytes())).toBe(true);
});
it("transfers bytes, ports and geometry intent; preserves result extras", async () => {
  const owner = new BrowserStaticGltfPreparationOwner();
  try {
    const source = bytes();
    const result = owner.prepare(source, "asset", "asset", "/asset.gltf", new AbortController().signal, vi.fn(), 2, undefined, { tasks: [] }, new Set());
    const { worker, request } = await first();
    expect(request.method).toBe("prepare");
    expect(request.params[0]).toMatchObject({ sceneIndex: 2, computeGeometryTaskKeys: [], geometryTasks: { tasks: [] }, codecs: { draco: expect.stringContaining("draco-codec") } });
    expect(worker.postMessage.mock.calls[0]![1]).toEqual([source.buffer, request.params[1]]);
    worker.reply(request, prepared);
    await expect(result).resolves.toBe(prepared);
  } finally { owner.dispose(); }
});
it.each([false, true])("routes resource reads and synchronous reader errors (failure=%s)", async fail => {
  const owner = new BrowserStaticGltfPreparationOwner();
  const reader = vi.fn(() => { if (fail) throw new Error("reader rejected"); return Promise.resolve(new Uint8Array([4, 5, 6])); });
  try {
    const result = run(owner, undefined, reader);
    const { worker, request } = await first();
    const port = request.params[1] as MessagePort;
    const response = new Promise<any>(resolve => { port.onmessage = event => resolve(event.data); });
    port.postMessage({ id: 7, uri: "/asset.bin" });
    expect(await response).toEqual(fail ? { id: 7, error: "reader rejected" } : { id: 7, bytes: new Uint8Array([4, 5, 6]) });
    expect(reader).toHaveBeenCalledWith("/asset.bin");
    worker.reply(request, prepared);
    await result;
  } finally { owner.dispose(); }
});
it("reuses bounded workers across a queued burst", async () => {
  const owner = new BrowserStaticGltfPreparationOwner({ workerLimit: 2 });
  try {
    const results = Array.from({ length: 7 }, () => run(owner));
    await first();
    expect(PoolWorker.instances).toHaveLength(2);
    const replied = new Set<object>();
    for (let i = 0; i < 7; i++) {
      await waitFor(() => expect(PoolWorker.instances.flatMap(w => w.requests).some(r => !replied.has(r))).toBe(true));
      const worker = PoolWorker.instances.find(w => w.requests.some(r => !replied.has(r)))!;
      const request = worker.requests.find(r => !replied.has(r))!;
      replied.add(request); worker.reply(request, prepared);
    }
    await expect(Promise.all(results)).resolves.toHaveLength(7);
    expect(PoolWorker.instances).toHaveLength(2);
  } finally { owner.dispose(); }
  expect(PoolWorker.instances.every(w => w.terminate.mock.calls.length === 1)).toBe(true);
});
it("cancels a queued task without killing another asset", async () => {
  const owner = new BrowserStaticGltfPreparationOwner({ workerLimit: 1 });
  try {
    const active = run(owner);
    const controller = new AbortController();
    const queued = run(owner, controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    const { worker, request } = await first();
    worker.reply(request, prepared);
    await expect(active).resolves.toBe(prepared);
    expect(worker.requests).toHaveLength(1);
  } finally { owner.dispose(); }
});
it("aborts active tasks and rejects later work on disposal", async () => {
  const owner = new BrowserStaticGltfPreparationOwner();
  const result = run(owner);
  await first();
  owner.dispose(); owner.dispose();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  await expect(run(owner)).rejects.toMatchObject({ name: "AbortError" });
});
it("reuses after asset errors and retires after idle grace", async () => {
  let retire = () => {};
  const owner = new BrowserStaticGltfPreparationOwner({ requestDelay: callback => { retire = callback; return callback; }, cancelDelay: vi.fn() });
  try {
    const failed = run(owner);
    const { worker, request } = await first();
    worker.reply(request, undefined, "invalid asset");
    await expect(failed).rejects.toThrow("invalid asset");
    const second = run(owner);
    worker.reply(worker.requests.at(-1)!, prepared);
    await expect(second).resolves.toBe(prepared);
    expect(PoolWorker.instances).toHaveLength(1);
    retire();
    expect(worker.terminate).toHaveBeenCalledOnce();
  } finally { owner.dispose(); }
});
it("rejects failed startup without leaving a ghost task ahead of the next asset", async () => {
  let fail = true;
  vi.stubGlobal("Worker", class extends PoolWorker {
    constructor() {
      if (fail) { fail = false; throw new Error("worker blocked"); }
      super();
    }
  });
  const owner = new BrowserStaticGltfPreparationOwner({ workerLimit: 1 });
  try {
    await expect(run(owner)).rejects.toThrow("worker blocked");
    const next = run(owner);
    const { worker, request } = await first();
    worker.reply(request, prepared);
    await expect(next).resolves.toBe(prepared);
    expect(worker.requests).toHaveLength(1);
  } finally { owner.dispose(); }
});
it("uses a five-second default idle grace and cancels it on reuse", async () => {
  let retirement: (() => void) | undefined;
  const cancelDelay = vi.fn();
  const requestDelay = vi.fn((callback: () => void) => { retirement = callback; return callback; });
  const owner = new BrowserStaticGltfPreparationOwner({ requestDelay, cancelDelay });
  try {
    const result = run(owner);
    const { worker, request } = await first();
    worker.reply(request, prepared);
    await result;
    expect(requestDelay).toHaveBeenLastCalledWith(expect.any(Function), 5000);
    const firstRetirement = retirement;
    const second = run(owner);
    expect(cancelDelay).toHaveBeenCalledWith(firstRetirement);
    worker.reply(worker.requests.at(-1)!, prepared);
    await second;
    retirement?.();
    expect(worker.terminate).toHaveBeenCalledOnce();
  } finally { owner.dispose(); }
});
it("replaces an idle crashed worker before admitting the next asset", async () => {
  const owner = new BrowserStaticGltfPreparationOwner({ workerLimit: 1 });
  try {
    const firstResult = run(owner);
    const { worker, request } = await first();
    worker.reply(request, prepared);
    await firstResult;
    worker.dispatchEvent(new MessageEvent("error", { data: new Error("idle crash") }));
    const next = run(owner);
    const observed = next.then(value => value, error => error);
    await waitFor(() => expect(PoolWorker.instances.length).toBe(2));
    const replacement = PoolWorker.instances[1]!;
    await waitFor(() => expect(replacement.requests).toHaveLength(1));
    replacement.reply(replacement.requests[0]!, prepared);
    await expect(observed).resolves.toBe(prepared);
  } finally { owner.dispose(); }
});
