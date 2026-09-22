import { createTextureInspectionOwner } from "../../packages/renderer-webgl/src/texture/inspection-policy";
import { describe, expect, it, vi } from "vitest";
import { TextureInspectionOwner } from "../../packages/renderer-webgl/src/texture/inspection";
import { resolveRendererRootOptions } from "../../packages/renderer-webgl/src/runtime/root-options";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const signal = () => new AbortController().signal;
const sample = () => ({ width: 256, height: 128 } as HTMLCanvasElement);

describe("root texture inspection", () => {
  it("shares pending work and cached decisions without retaining image pixels", async () => {
    const verdict = deferred<boolean>();
    const allow = vi.fn(() => verdict.promise);
    const owner = new TextureInspectionOwner({ key: "v1", allow });
    const image = sample();
    const produce = vi.fn(async () => image);
    const first = owner.inspect("content", produce, signal());
    const second = owner.inspect("content", produce, signal());
    await Promise.resolve(); await Promise.resolve();
    expect(allow).toHaveBeenCalledOnce();
    expect(image.width).toBe(256);
    verdict.resolve(true);
    await Promise.all([first, second]);
    expect(image.width).toBe(1);
    await owner.inspect("content", produce, signal());
    expect(produce).toHaveBeenCalledOnce();
    owner.dispose();
  });

  it.each([false, undefined, "yes"])("blocks non-true decisions (%s) and caches the failure", async decision => {
    const allow = vi.fn(async () => decision as boolean);
    const owner = new TextureInspectionOwner({ key: "v1", allow });
    const image = sample();
    await expect(owner.inspect("content", async () => image, signal())).rejects.toThrow("blocked by inspection");
    await expect(owner.inspect("content", async () => sample(), signal())).rejects.toThrow("blocked by inspection");
    expect(allow).toHaveBeenCalledOnce();
    expect(image.width).toBe(1);
    owner.dispose();
  });

  it("serializes classification and does not sample queued canceled content", async () => {
    const verdict = deferred<boolean>();
    const entered = deferred<void>();
    const allow = vi.fn(async () => { entered.resolve(); return verdict.promise; });
    const owner = new TextureInspectionOwner({ key: "v1", allow });
    const first = owner.inspect("first", async () => sample(), signal());
    await entered.promise;
    const abort = new AbortController();
    const produce = vi.fn(async () => sample());
    const second = owner.inspect("second", produce, abort.signal);
    const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
    abort.abort();
    verdict.resolve(true);
    await first; await rejected;
    expect(produce).not.toHaveBeenCalled();
    owner.dispose();
  });

  it("cancels shared work only when the last consumer leaves and retries canceled decisions", async () => {
    const verdict = deferred<boolean>();
    let inspectionSignal!: AbortSignal;
    const entered = deferred<void>();
    const owner = new TextureInspectionOwner({ key: "v1", allow: async (_image, abort) => {
      inspectionSignal = abort; entered.resolve(); return verdict.promise;
    } });
    const firstAbort = new AbortController(), secondAbort = new AbortController();
    const first = owner.inspect("shared", async () => sample(), firstAbort.signal);
    const second = owner.inspect("shared", async () => sample(), secondAbort.signal);
    const firstRejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const secondRejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
    await entered.promise;
    firstAbort.abort(); expect(inspectionSignal.aborted).toBe(false);
    secondAbort.abort(); expect(inspectionSignal.aborted).toBe(true);
    verdict.resolve(true);
    await Promise.all([firstRejected, secondRejected]);
    const produce = vi.fn(async () => sample());
    await owner.inspect("shared", produce, signal());
    expect(produce).toHaveBeenCalledOnce();
    owner.dispose();
  });

  it("preserves a shared decision when only one requester aborts", async () => {
    const verdict = deferred<boolean>();
    const owner = new TextureInspectionOwner({ key: "v1", allow: () => verdict.promise });
    const abort = new AbortController();
    const first = owner.inspect("shared", async () => sample(), abort.signal);
    const second = owner.inspect("shared", async () => sample(), signal());
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    abort.abort(); verdict.resolve(true);
    await rejected; await second;
    owner.dispose();
  });

  it("releases the borrowed sample after a thrown predicate and fails closed on disposal", async () => {
    const image = sample();
    const owner = new TextureInspectionOwner({ key: "v1", allow: async () => { throw new Error("model offline"); } });
    await expect(owner.inspect("first", async () => image, signal())).rejects.toThrow("model offline");
    expect(image.width).toBe(1);
    owner.dispose();
    await expect(owner.inspect("second", async () => sample(), signal())).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts an active predicate on disposal and keeps its image alive until it settles", async () => {
    const verdict = deferred<boolean>(), entered = deferred<void>();
    let abort!: AbortSignal;
    const image = sample();
    const owner = new TextureInspectionOwner({ key: "v1", allow: async (_image, signal) => {
      abort = signal; entered.resolve(); return verdict.promise;
    } });
    const pending = owner.inspect("content", async () => image, signal());
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await entered.promise;
    owner.dispose();
    expect(abort.aborted).toBe(true);
    expect(image.width).toBe(256);
    verdict.resolve(true); await rejection;
    expect(image.width).toBe(1);
  });

  it("bounds completed decisions and recomputes an evicted entry", async () => {
    const allow = vi.fn(async () => true);
    const owner = new TextureInspectionOwner({ key: "v1", allow });
    for (let i = 0; i < 1026; i++) await owner.inspect(String(i), async () => sample(), signal());
    await owner.inspect("1025", async () => sample(), signal());
    expect(allow).toHaveBeenCalledTimes(1026);
    await owner.inspect("0", async () => sample(), signal());
    expect(allow).toHaveBeenCalledTimes(1027);
    owner.dispose();
  });

  it("shares decisions through the lazy root facade and closes sources disposed during module loading", async () => {
    const allow = vi.fn(async () => true);
    const owner = createTextureInspectionOwner({ key: "v1", allow });
    await Promise.all([owner.inspect("shared", async () => sample(), signal()), owner.inspect("shared", async () => sample(), signal())]);
    expect(allow).toHaveBeenCalledOnce();
    owner.dispose();
    const pendingOwner = createTextureInspectionOwner({ key: "v1", allow });
    const close = vi.fn();
    const pending = pendingOwner.accept({ kind: "asset", src: "/image" }, { source: {} as ImageBitmap, width: 4, height: 4, close }, signal());
    pendingOwner.dispose();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("treats policy keys as separate root policies and validates the public option", () => {
    const allow = async () => true;
    expect(resolveRendererRootOptions({ textureInspection: { key: "policy-v1", allow } }).textureInspection)
      .toEqual({ key: "policy-v1", allow });
    expect(() => resolveRendererRootOptions({ textureInspection: { key: "", allow } })).toThrow("non-empty key");
    expect(() => resolveRendererRootOptions({ textureInspection: { key: "v1", allow: false as never } })).toThrow("allow predicate");
  });
});

describe("bounded inspection throughput", () => {
  it("admits two jobs, delays sampling the third, and preserves FIFO after queued cancellation", async () => {
    const gates = [deferred<boolean>(), deferred<boolean>(), deferred<boolean>()];
    const entered = [deferred<void>(), deferred<void>(), deferred<void>()];
    let calls = 0;
    const owner = new TextureInspectionOwner({ key: "v1", concurrency: 2, allow: () => {
      const index = calls++;
      entered[index]!.resolve();
      return gates[index]!.promise;
    } });
    const first = owner.inspect("a", async () => sample(), signal());
    const second = owner.inspect("b", async () => sample(), signal());
    await Promise.all([entered[0]!.promise, entered[1]!.promise]);
    const abort = new AbortController();
    const canceledSample = vi.fn(async () => sample());
    const canceled = owner.inspect("cancel", canceledSample, abort.signal);
    const rejection = expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    const thirdSample = vi.fn(async () => sample());
    const third = owner.inspect("c", thirdSample, signal());
    await Promise.resolve();
    expect(thirdSample).not.toHaveBeenCalled();
    abort.abort();
    await rejection;
    expect(canceledSample).not.toHaveBeenCalled();
    gates[0]!.resolve(true);
    await entered[2]!.promise;
    expect(thirdSample).toHaveBeenCalledOnce();
    gates[1]!.resolve(true); gates[2]!.resolve(true);
    await Promise.all([first, second, third]);
    owner.dispose();
  });

  it("retains the active lane and borrowed image if a predicate ignores cancellation", async () => {
    const gate = deferred<boolean>(), entered = deferred<void>();
    const image = sample();
    const allow = vi.fn(async () => { entered.resolve(); return gate.promise; });
    const owner = new TextureInspectionOwner({ key: "v1", allow });
    const abort = new AbortController();
    const first = owner.inspect("a", async () => image, abort.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await entered.promise;
    abort.abort();
    const produce = vi.fn(async () => sample());
    const second = owner.inspect("b", produce, signal());
    await Promise.resolve(); await Promise.resolve();
    expect(produce).not.toHaveBeenCalled();
    expect(image.width).toBe(256);
    gate.resolve(true);
    await rejected; await second;
    expect(image.width).toBe(1);
    owner.dispose();
  });

  it("drains a large burst without iterating pending maps and bounds the completed cache", async () => {
    const allow = vi.fn(async () => true);
    const owner = new TextureInspectionOwner({ key: "v1", concurrency: 2, allow });
    const iterator = vi.spyOn(Map.prototype, Symbol.iterator);
    try {
      await Promise.all(Array.from({ length: 4096 }, (_, i) => owner.inspect(String(i), async () => sample(), signal())));
      expect(iterator).not.toHaveBeenCalled();
    } finally { iterator.mockRestore(); }
    expect(allow).toHaveBeenCalledTimes(4096);
    await owner.inspect("4095", async () => sample(), signal());
    expect(allow).toHaveBeenCalledTimes(4096);
    await owner.inspect("0", async () => sample(), signal());
    expect(allow).toHaveBeenCalledTimes(4097);
    owner.dispose();
  });

  it("does not sample a queued pixel representation after cancellation or disposal", async () => {
    const gate = deferred<boolean>(), entered = deferred<void>();
    const owner = new TextureInspectionOwner({ key: "v1", allow: async () => { entered.resolve(); return gate.promise; } });
    const active = owner.inspect("a", async () => sample(), signal());
    const activeRejected = expect(active).rejects.toMatchObject({ name: "AbortError" });
    await entered.promise;
    const produce = vi.fn(async () => sample());
    const abort = new AbortController();
    const canceled = owner.inspectPixels("b", produce, abort.signal);
    const canceledRejected = expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    abort.abort(); await canceledRejected;
    const disposed = owner.inspectPixels("c", produce, signal());
    const disposedRejected = expect(disposed).rejects.toMatchObject({ name: "AbortError" });
    owner.dispose(); await disposedRejected;
    expect(produce).not.toHaveBeenCalled();
    gate.resolve(true); await activeRejected;
  });

  it.each([0, -1, 1.5, 5, NaN, Infinity])("rejects invalid concurrency %s", concurrency => {
    expect(() => resolveRendererRootOptions({ textureInspection: { key: "v1", allow: async () => true, concurrency } })).toThrow("concurrency");
  });
});

it("closes queued decoded sources exactly once on cancellation and disposal", async () => {
  const entered = deferred<void>(), verdict = deferred<boolean>();
  const owner = new TextureInspectionOwner({ key: "v1", allow: async () => { entered.resolve(); return verdict.promise; } });
  const active = owner.inspect("held", async () => sample(), signal());
  const activeRejected = expect(active).rejects.toMatchObject({ name: "AbortError" });
  await entered.promise;
  const closeCanceled = vi.fn(), closeDisposed = vi.fn();
  const abort = new AbortController();
  const canceled = owner.accept({ kind: "asset", src: "/canceled" }, { source: {} as ImageBitmap, width: 4, height: 4, close: closeCanceled }, abort.signal);
  const canceledRejected = expect(canceled).rejects.toMatchObject({ name: "AbortError" });
  abort.abort(); await canceledRejected;
  expect(closeCanceled).toHaveBeenCalledOnce();
  const disposed = owner.accept({ kind: "asset", src: "/disposed" }, { source: {} as ImageBitmap, width: 4, height: 4, close: closeDisposed }, signal());
  const disposedRejected = expect(disposed).rejects.toMatchObject({ name: "AbortError" });
  owner.dispose(); await disposedRejected;
  expect(closeDisposed).toHaveBeenCalledOnce();
  verdict.resolve(true); await activeRejected;
  expect(closeCanceled).toHaveBeenCalledOnce();
  expect(closeDisposed).toHaveBeenCalledOnce();
});
