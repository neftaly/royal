import { describe, expect, it, vi } from "vitest";
import {
  PreparedGltfAssetStore,
  type PreparedGltfAsset,
  type PreparedGltfAssetSubscription,
} from "../packages/renderer-webgl/src/gltf/prepared-asset";
import { GltfPreparationScheduler } from "../packages/renderer-webgl/src/gltf/preparation-scheduler";

const emptyAsset = (): PreparedGltfAsset => ({
  hasMaterialLod: false,
  hasMaterialVariants: false,
  hasNodeLod: false,
  lights: [],
  load: {
    imageFailures: 0,
    imageLoaded: 0,
    imageRequests: 0,
    startedAt: 0,
  },
  nodeCount: 0,
  primitives: [],
  variants: [],
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe("PreparedGltfAssetStore", () => {
  it("queues one current snapshot for subscribers joining settled entries", async () => {
    for (const outcome of ["ready", "error"] as const) {
      const job = deferred<PreparedGltfAsset>();
      const onChange = vi.fn();
      const initialListener = vi.fn();
      const store = new PreparedGltfAssetStore(() => job.promise, onChange);
      const request = { key: outcome, src: `/${outcome}.glb` };
      const initial = store.request(request, initialListener);

      if (outcome === "ready") job.resolve(emptyAsset());
      else job.reject(new Error("settled failure"));
      await job.promise.catch(() => undefined);
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      expect(initialListener, outcome).toHaveBeenCalledTimes(1);
      expect(initial.getSnapshot().status, outcome).toBe(outcome);
      expect(Object.isFrozen(initial.getSnapshot()), outcome).toBe(true);

      let late: PreparedGltfAssetSubscription | undefined;
      const observed: unknown[] = [];
      const lateListener = vi.fn(() => {
        observed.push(late?.getSnapshot());
      });
      late = store.request(request, lateListener);
      const canceledListener = vi.fn();
      const canceled = store.request(request, canceledListener);
      canceled.release();

      expect(lateListener, `${outcome} must not notify synchronously`).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      expect(lateListener, outcome).toHaveBeenCalledTimes(1);
      expect(observed, outcome).toEqual([late.getSnapshot()]);
      expect(canceledListener, outcome).not.toHaveBeenCalled();
      expect(onChange, outcome).toHaveBeenCalledTimes(2);

      late.release();
      initial.release();
      expect(store.snapshot(request.key), outcome).toBeUndefined();
    }
  });

  it("deduplicates jobs, publishes observable errors, and ignores completion after disposal", async () => {
    const first = deferred<PreparedGltfAsset>();
    const second = deferred<PreparedGltfAsset>();
    const load = vi.fn(({ key }: { readonly key: string }) => key === "first" ? first.promise : second.promise);
    const onChange = vi.fn();
    const listener = vi.fn();
    const store = new PreparedGltfAssetStore(load, onChange);

    const a = store.request({ key: "first", src: "/first.glb" }, listener);
    const b = store.request({ key: "first", src: "/first.glb" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(a.getSnapshot()).toMatchObject({ revision: 0, status: "loading" });
    expect(b.getSnapshot()).toBe(a.getSnapshot());

    first.reject(new Error("required extension is unsupported"));
    await first.promise.catch(() => undefined);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(a.getSnapshot()).toMatchObject({
      error: expect.stringContaining("required extension is unsupported"),
      revision: 1,
      status: "error",
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);

    a.release();
    expect(store.snapshot("first")).toBe(a.getSnapshot());
    b.release();
    expect(store.snapshot("first")).toBeUndefined();

    const c = store.request({ key: "second", src: "/second.glb" });
    store.dispose();
    second.resolve(emptyAsset());
    await second.promise;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(c.getSnapshot()).toMatchObject({ revision: 0, status: "loading" });
    expect(store.snapshot("second")).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("GltfPreparationScheduler", () => {
  it("bounds randomized request waves without losing or duplicating jobs", async () => {
    let seed = 0x9e3779b9;
    const random = (): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };

    for (let sample = 0; sample < 12; sample += 1) {
      const limit = 1 + random() % 4;
      const count = 8 + random() % 40;
      const scheduler = new GltfPreparationScheduler(limit);
      const controller = new AbortController();
      const releases: (() => void)[] = [];
      const completed: number[] = [];
      let active = 0;
      let peak = 0;
      const jobs = Array.from({ length: count }, (_, index) =>
        scheduler.run(controller.signal, () => new Promise<number>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          releases.push(() => {
            active -= 1;
            completed.push(index);
            resolve(index);
          });
        })));
      expect(scheduler.snapshot().queued).toBe(Math.max(0, count - limit));
      expect(scheduler.snapshot().queueHighWater).toBe(Math.max(0, count - limit));

      while (completed.length < count) {
        const releaseIndex = random() % releases.length;
        releases.splice(releaseIndex, 1)[0]?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      await expect(Promise.all(jobs)).resolves.toHaveLength(count);
      expect(peak).toBeLessThanOrEqual(limit);
      expect(new Set(completed).size).toBe(count);
      expect(scheduler.snapshot().queued).toBe(0);
      scheduler.dispose();
    }
  });

  it("rejects queued work on abort without starting it", async () => {
    const scheduler = new GltfPreparationScheduler(1);
    const running = deferred<void>();
    const firstController = new AbortController();
    const queuedController = new AbortController();
    let queuedStarted = false;
    const first = scheduler.run(firstController.signal, () => running.promise);
    const queued = scheduler.run(queuedController.signal, () => {
      queuedStarted = true;
    });

    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(queuedStarted).toBe(false);
    expect(scheduler.snapshot().queued).toBe(0);
    running.resolve();
    await first;
    scheduler.dispose();
  });

  it("promptly tombstones seeded queued abort waves while the lane remains occupied", async () => {
    let seed = 0x51a7e;
    const random = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed;
    };
    for (let sample = 0; sample < 8; sample += 1) {
      const scheduler = new GltfPreparationScheduler(1);
      const running = deferred<void>();
      const activeController = new AbortController();
      const active = scheduler.run(activeController.signal, () => running.promise);
      const starts: number[] = [];
      const queued = Array.from({ length: 24 }, (_, index) => {
        const controller = new AbortController();
        return {
          controller,
          index,
          promise: scheduler.run(controller.signal, () => {
            starts.push(index);
            return index;
          }),
        };
      });
      const aborted = queued.filter(() => random() % 3 !== 0);
      expect(scheduler.snapshot().queueHighWater).toBe(24);
      for (const job of aborted) job.controller.abort();
      await Promise.all(aborted.map(async (job) => {
        await expect(job.promise).rejects.toMatchObject({ name: "AbortError" });
      }));
      expect(starts).toEqual([]);

      running.resolve();
      await active;
      const survivors = queued.filter((job) => !aborted.includes(job));
      await expect(Promise.all(survivors.map((job) => job.promise))).resolves.toEqual(
        survivors.map((job) => job.index),
      );
      expect(starts).toEqual(survivors.map((job) => job.index));
      expect(scheduler.snapshot().queued).toBe(0);
      scheduler.dispose();
    }
  });
});
