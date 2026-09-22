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
