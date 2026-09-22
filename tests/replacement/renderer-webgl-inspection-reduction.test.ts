import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectionReductionWorker, INSPECTION_WORKER_TIMEOUT_MS } from "../../packages/renderer-webgl/src/texture/inspection-reduction";

vi.mock("../../packages/renderer-webgl/node_modules/workerpool", { spy: true });

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly listeners = new Map<string, ((event: { data: unknown }) => void)[]>();
  postMessage = vi.fn<(message: { id: number; method: string }, transfer?: Transferable[]) => void>();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  addEventListener(type: string, callback: (event: { data: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  emit(type: string, data: unknown) { for (const callback of this.listeners.get(type) ?? []) callback({ data }); }
  register() { this.emit("message", "ready"); }
  reply(result = { reduced: new Float64Array(7), transparent: false }) {
    const request = this.postMessage.mock.calls.slice().reverse().find(([message]) => message.method === "reduce" || message.method === "sample")![0];
    this.emit("message", { id: request.id, result });
  }
}
const input = () => ({ rgba: new Uint8Array(16), inputWidth: 2, inputHeight: 2, width: 1, height: 1 });
const owners: InspectionReductionWorker[] = [];
const owner = () => { const value = new InspectionReductionWorker(); owners.push(value); return value; };
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal("Worker", FakeWorker); vi.useFakeTimers(); });
afterEach(async () => {
  for (const value of owners.splice(0)) value.dispose();
  await vi.runAllTimersAsync();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("inspection workerpool ownership and liveness", () => {
  it("transfers only the active request and preserves queued work when it is canceled", async () => {
    const sampler = owner(), abort = new AbortController();
    const firstInput = input();
    const first = sampler.reduce(firstInput, abort.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await vi.dynamicImportSettled();
    const firstWorker = FakeWorker.instances[0]!;
    firstWorker.register();
    expect(firstWorker.postMessage.mock.calls[0]![1]).toEqual([firstInput.rgba.buffer]);
    const second = sampler.reduce(input());
    await vi.dynamicImportSettled();
    abort.abort();
    await vi.advanceTimersByTimeAsync(2);
    await rejected;
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    const replacement = FakeWorker.instances[1]!;
    replacement.register(); replacement.reply();
    await expect(second).resolves.toMatchObject({ transparent: false });
    // Late replies from a terminated worker cannot settle replacement requests.
    firstWorker.reply({ reduced: new Float64Array(7), transparent: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("bounds both lanes behind a silent worker (registered: %s)", async (registered) => {
    const sampler = owner();
    const pending = sampler.reduce(input());
    const rejected = expect(pending).rejects.toThrow("timed out");
    const queued = sampler.reduce(input());
    const queuedRejected = expect(queued).rejects.toThrow("timed out");
    await vi.dynamicImportSettled();
    if (registered) FakeWorker.instances[0]!.register();
    await vi.advanceTimersByTimeAsync(INSPECTION_WORKER_TIMEOUT_MS + 2);
    await Promise.all([rejected, queuedRejected]);
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
    const next = sampler.reduce(input());
    await vi.dynamicImportSettled();
    FakeWorker.instances[1]!.register(); FakeWorker.instances[1]!.reply();
    await expect(next).resolves.toMatchObject({ transparent: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a queued request without stopping another request's worker", async () => {
    const sampler = owner(), abort = new AbortController();
    const first = sampler.reduce(input());
    await vi.dynamicImportSettled();
    const worker = FakeWorker.instances[0]!; worker.register();
    const second = sampler.reduce(input(), abort.signal);
    const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
    await vi.dynamicImportSettled();
    abort.abort(); await rejected;
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply(); await first;
    expect(worker.postMessage).toHaveBeenCalledOnce();
  });

  it("rejects active and queued work on disposal and clears deadlines", async () => {
    const sampler = owner();
    const first = sampler.reduce(input()), second = sampler.reduce(input());
    const rejected = [expect(first).rejects.toMatchObject({ name: "AbortError" }), expect(second).rejects.toMatchObject({ name: "AbortError" })];
    await vi.dynamicImportSettled();
    sampler.dispose(); sampler.dispose();
    await Promise.all(rejected);
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(sampler.reduce(input())).rejects.toMatchObject({ name: "AbortError" });
  });

  it("settles worker startup errors without a recursive failure or stale busy worker", async () => {
    const sampler = owner();
    const pending = sampler.reduce(input());
    const rejected = expect(pending).rejects.toThrow();
    await vi.dynamicImportSettled();
    FakeWorker.instances[0]!.emit("error", new Error("module load failed"));
    await rejected;
    const fresh = sampler.reduce(input());
    await vi.dynamicImportSettled();
    FakeWorker.instances.at(-1)!.register(); FakeWorker.instances.at(-1)!.reply();
    await expect(fresh).resolves.toMatchObject({ transparent: false });
  });

  it.each([false, true])("recovers from clone failures (already ready: %s)", async (ready) => {
    const sampler = owner();
    const first = sampler.reduce(input());
    const rejected = ready ? undefined : expect(first).rejects.toThrow("clone failed");
    await vi.dynamicImportSettled();
    const worker = FakeWorker.instances[0]!;
    if (ready) {
      worker.register(); worker.reply(); await first;
      worker.postMessage.mockImplementationOnce(() => { throw new Error("clone failed"); });
      await expect(sampler.reduce(input())).rejects.toThrow("clone failed");
    } else {
      worker.postMessage.mockImplementationOnce(() => { throw new Error("clone failed"); });
      worker.register(); await rejected;
    }
    const next = sampler.reduce(input());
    await vi.dynamicImportSettled();
    const current = FakeWorker.instances.at(-1)!;
    if (current !== worker) current.register();
    current.reply(); await expect(next).resolves.toMatchObject({ transparent: false });
  });

  it("recovers after a response cannot be deserialized", async () => {
    const sampler = owner();
    const first = sampler.reduce(input());
    const rejected = expect(first).rejects.toThrow("deserialization");
    await vi.dynamicImportSettled();
    FakeWorker.instances[0]!.register();
    await vi.dynamicImportSettled();
    FakeWorker.instances[0]!.emit("messageerror", undefined);
    await rejected;
    const next = sampler.reduce(input());
    await vi.dynamicImportSettled();
    FakeWorker.instances.at(-1)!.register(); FakeWorker.instances.at(-1)!.reply();
    await expect(next).resolves.toMatchObject({ transparent: false });
  });

  it("does not start a worker when disposed between pool creation and execution", async () => {
    const sampler = owner();
    const workerpool = await import("../../packages/renderer-webgl/node_modules/workerpool");
    const { pool: createPool } = await vi.importActual<typeof workerpool>("../../packages/renderer-webgl/node_modules/workerpool");
    const spy = vi.spyOn(workerpool, "pool").mockImplementationOnce((...args) => {
      const created = createPool(...args);
      queueMicrotask(() => sampler.dispose());
      return created;
    });
    try {
      const pending = sampler.reduce(input());
      const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.dynamicImportSettled();
      expect(FakeWorker.instances).toHaveLength(0);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally { spy.mockRestore(); }
  });

});
