import { describe, expect, it, vi } from "vitest";
import {
  PreparedGltfAssetStore,
  preparedGltfAssetRetainedCpuBytes,
  type PreparedGltfAsset,
  type PreparedGltfAssetSubscription,
} from "../packages/renderer-webgl/src/gltf/prepared-asset";
import { GltfPreparationScheduler } from "../packages/renderer-webgl/src/gltf/preparation-scheduler";
import { ResourceGovernorCpuCapacityError } from "../packages/renderer-webgl/src/resource-governor";

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
  it("keeps declarations loading across CPU pressure and retries only on capacity wake", async () => {
    const jobs = [deferred<PreparedGltfAsset>(), deferred<PreparedGltfAsset>()];
    const load = vi.fn((_request, _signal) => jobs[load.mock.calls.length - 1]!.promise);
    const listener = vi.fn();
    const store = new PreparedGltfAssetStore(load, vi.fn());
    const subscription = store.request({ key: "pressure", src: "/pressure.glb" }, listener);
    jobs[0]!.reject(new ResourceGovernorCpuCapacityError("temporary CPU pressure", false));
    await jobs[0]!.promise.catch(() => undefined);
    await Promise.resolve();
    expect(subscription.getSnapshot().status).toBe("loading");
    expect(listener).not.toHaveBeenCalled();
    expect(store.wakeCpuCapacity()).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    jobs[1]!.resolve(emptyAsset());
    await jobs[1]!.promise;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(subscription.getSnapshot().status).toBe("ready");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.wakeCpuCapacity()).toBe(false);
    subscription.release();
  });

  it("wakes every blocked declaration once so a larger re-denial cannot strand a smaller asset", async () => {
    const calls = new Map<string, number>();
    let retry = false;
    const store = new PreparedGltfAssetStore(async (request) => {
      calls.set(request.key, (calls.get(request.key) ?? 0) + 1);
      if (!retry || request.key === "large") {
        throw new ResourceGovernorCpuCapacityError("temporary CPU pressure", false);
      }
      return emptyAsset();
    }, vi.fn());
    const large = store.request({ key: "large", src: "/large.glb" });
    const small = store.request({ key: "small", src: "/small.glb" });
    await Promise.resolve();
    await Promise.resolve();
    retry = true;

    expect(store.wakeCpuCapacity()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(new Map([["large", 2], ["small", 2]]));
    expect(large.getSnapshot().status).toBe("loading");
    expect(small.getSnapshot().status).toBe("ready");
    large.release();
    small.release();
  });

  it("isolates throwing subscribers and still delivers peer and store notifications", async () => {
    const onChange = vi.fn();
    const first = vi.fn(() => { throw new Error("listener failed"); });
    const second = vi.fn();
    const store = new PreparedGltfAssetStore(async () => emptyAsset(), onChange);
    const firstSubscription = store.request({ key: "shared", src: "/shared.glb" }, first);
    const secondSubscription = store.request({ key: "shared", src: "/shared.glb" }, second);

    await Promise.resolve();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    firstSubscription.release();
    secondSubscription.release();
  });

  it("does not resurrect a CPU-blocked prepared declaration after removal or disposal", async () => {
    for (const dispose of [false, true]) {
      const job = deferred<PreparedGltfAsset>();
      const load = vi.fn(() => job.promise);
      const store = new PreparedGltfAssetStore(load, vi.fn());
      const subscription = store.request({ key: String(dispose), src: "/blocked.glb" });
      job.reject(new ResourceGovernorCpuCapacityError("temporary CPU pressure", false));
      await job.promise.catch(() => undefined);
      await Promise.resolve();
      if (dispose) store.dispose();
      else subscription.release();
      expect(store.wakeCpuCapacity()).toBe(false);
      expect(load).toHaveBeenCalledTimes(1);
    }
  });

  it("stops a CPU-capacity wake snapshot when an earlier retry disposes the store", async () => {
    const calls = new Map<string, number>();
    let retrying = false;
    let store!: PreparedGltfAssetStore;
    store = new PreparedGltfAssetStore((request) => {
      calls.set(request.key, (calls.get(request.key) ?? 0) + 1);
      if (retrying && request.key === "first") store.dispose();
      return Promise.reject(new ResourceGovernorCpuCapacityError("temporary CPU pressure", false));
    }, vi.fn());
    const first = store.request({ key: "first", src: "/first.glb" });
    const second = store.request({ key: "second", src: "/second.glb" });
    await Promise.resolve();
    await Promise.resolve();
    retrying = true;

    expect(store.wakeCpuCapacity()).toBe(true);
    await Promise.resolve();

    expect(calls).toEqual(new Map([["first", 2], ["second", 1]]));
    first.release();
    second.release();
  });

  it("skips a later CPU-blocked snapshot row removed by an earlier retry", async () => {
    const calls = new Map<string, number>();
    let retrying = false;
    let second: PreparedGltfAssetSubscription | undefined;
    const store = new PreparedGltfAssetStore((request) => {
      calls.set(request.key, (calls.get(request.key) ?? 0) + 1);
      if (retrying && request.key === "first") second?.release();
      return Promise.reject(new ResourceGovernorCpuCapacityError("temporary CPU pressure", false));
    }, vi.fn());
    const first = store.request({ key: "first", src: "/first.glb" });
    second = store.request({ key: "second", src: "/second.glb" });
    await Promise.resolve();
    await Promise.resolve();
    retrying = true;

    expect(store.wakeCpuCapacity()).toBe(true);
    await Promise.resolve();

    expect(calls).toEqual(new Map([["first", 2], ["second", 1]]));
    first.release();
    store.dispose();
  });

  it("terminally caches an intrinsically impossible prepared CPU cost", async () => {
    const store = new PreparedGltfAssetStore(
      async () => { throw new ResourceGovernorCpuCapacityError("asset exceeds maximum", true); },
      vi.fn(),
    );
    const subscription = store.request({ key: "impossible", src: "/impossible.glb" });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(subscription.getSnapshot()).toMatchObject({
      error: expect.stringContaining("asset exceeds maximum"),
      status: "error",
    });
    expect(store.wakeCpuCapacity()).toBe(false);
    subscription.release();
  });
  it("counts retained prepared-asset backing buffers once across shared views", () => {
    const geometryBuffer = new ArrayBuffer(64);
    const decodeBuffer = new ArrayBuffer(32);
    const asset = {
      ...emptyAsset(),
      imagePreparation: {
        buffers: [geometryBuffer, decodeBuffer],
        document: {},
        src: "/shared.glb",
      },
      primitives: [{
        instanceTransforms: [],
        localModels: [],
        normals: new Float32Array(geometryBuffer, 12, 3),
        positions: new Float32Array(geometryBuffer, 0, 3),
      }],
    } as unknown as PreparedGltfAsset;

    expect(preparedGltfAssetRetainedCpuBytes(asset)).toEqual({
      assetDecode: 32,
      geometry: 64,
    });
  });

  it("rejects retained-buffer totals outside safe integer accounting", () => {
    const oversized = {
      ...emptyAsset(),
      imagePreparation: {
        buffers: [
          { byteLength: Number.MAX_SAFE_INTEGER } as ArrayBuffer,
          { byteLength: 1 } as ArrayBuffer,
        ],
        document: {},
        src: "/oversized.glb",
      },
    } satisfies PreparedGltfAsset;

    expect(() => preparedGltfAssetRetainedCpuBytes(oversized)).toThrow(RangeError);
  });

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
  it("rejects concurrency values that could stall or unbound the lane", () => {
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new GltfPreparationScheduler(limit)).toThrow(RangeError);
    }
  });

  it("shares global job admission across independent preparation lanes", async () => {
    let globallyActive = 0;
    let globalPeak = 0;
    const schedulers: GltfPreparationScheduler[] = [];
    const admit = () => {
      if (globallyActive >= 1) return undefined;
      globallyActive += 1;
      globalPeak = Math.max(globalPeak, globallyActive);
      let released = false;
      return {
        release: () => {
          if (released) throw new Error("job admission released twice");
          released = true;
          globallyActive -= 1;
          for (const scheduler of schedulers) scheduler.wake();
        },
      };
    };
    const firstScheduler = new GltfPreparationScheduler(2, admit);
    const secondScheduler = new GltfPreparationScheduler(2, admit);
    schedulers.push(firstScheduler, secondScheduler);
    const firstWork = deferred<void>();
    const controller = new AbortController();
    const starts: string[] = [];
    const first = firstScheduler.run(controller.signal, async () => {
      starts.push("first");
      await firstWork.promise;
    });
    const second = secondScheduler.run(controller.signal, () => {
      starts.push("second");
    });

    expect(starts).toEqual(["first"]);
    expect(secondScheduler.snapshot()).toMatchObject({ active: 0, queued: 1 });
    firstWork.resolve();
    await first;
    await second;
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(starts).toEqual(["first", "second"]);
    expect(globalPeak).toBe(1);
    expect(globallyActive).toBe(0);
    firstScheduler.dispose();
    secondScheduler.dispose();
  });

  it("releases admission when an admitter aborts a queued row reentrantly", async () => {
    const firstWork = deferred<void>();
    const firstController = new AbortController();
    const queuedController = new AbortController();
    let admissionCalls = 0;
    let releases = 0;
    let queuedStarted = false;
    let scheduler!: GltfPreparationScheduler;
    const admit = () => {
      admissionCalls += 1;
      if (admissionCalls === 2) {
        queuedController.abort();
        scheduler.wake();
      }
      return { release: () => { releases += 1; } };
    };
    scheduler = new GltfPreparationScheduler(1, admit);
    const first = scheduler.run(firstController.signal, () => firstWork.promise);
    const queued = scheduler.run(queuedController.signal, () => {
      queuedStarted = true;
    });

    firstWork.resolve();
    await first;
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(queuedStarted).toBe(false);
    expect(releases).toBe(2);
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 0 });
    scheduler.dispose();
  });

  it("does not start immediate work when admission aborts it reentrantly", async () => {
    const controller = new AbortController();
    let releases = 0;
    let started = false;
    const scheduler = new GltfPreparationScheduler(1, () => {
      controller.abort();
      return { release: () => { releases += 1; } };
    });

    await expect(scheduler.run(controller.signal, () => {
      started = true;
    })).rejects.toMatchObject({ name: "AbortError" });
    expect({ releases, started }).toEqual({ releases: 1, started: false });
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 0 });
    scheduler.dispose();
  });

  it("rejects a queued row cleanly when global admission throws", async () => {
    const firstWork = deferred<void>();
    let admissionCalls = 0;
    const scheduler = new GltfPreparationScheduler(1, () => {
      admissionCalls += 1;
      if (admissionCalls === 2) throw new Error("admission fault");
      return { release: () => undefined };
    });
    const controller = new AbortController();
    const first = scheduler.run(controller.signal, () => firstWork.promise);
    const queued = scheduler.run(controller.signal, () => undefined);

    firstWork.resolve();
    await first;
    await expect(queued).rejects.toThrow("admission fault");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(scheduler.snapshot()).toMatchObject({ active: 0, queued: 0 });
    scheduler.dispose();
  });

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
