import { describe, expect, it } from "vitest";
import {
  OrdinaryTextureSourceStore,
  ordinaryTextureSourceKey,
  type OrdinaryTextureSourceDeliveryFailure,
  type OrdinaryTextureSourceSubscription,
} from "../packages/renderer-webgl/src/texture/ordinary-source-store";
import type { ResourceArenaSourceLease } from "../packages/renderer-webgl/src/resource-arena";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture/sources";
import { runFuzzTraces, type SeededRandom } from "./fuzz";
import { ResourceGovernorCpuCapacityError } from "../packages/renderer-webgl/src/resource-governor";
type DeferredLoad = {
  readonly reject: (error: unknown) => void;
  readonly requestKey: string;
  readonly resolve: (source: LoadedTextureSource) => void;
};
const fakeSource = (id: number): LoadedTextureSource => ({ id } as unknown as LoadedTextureSource);
const flushJobs = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
const harness = () => {
  const closed = new Map<LoadedTextureSource, number>();
  const deferred: DeferredLoad[] = [];
  const references = new Map<LoadedTextureSource, number>();
  const store = new OrdinaryTextureSourceStore({
    close: (source) => closed.set(source, (closed.get(source) ?? 0) + 1),
    load: (request, signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      deferred.push({ reject, requestKey: ordinaryTextureSourceKey(request), resolve });
    }),
    retain: (source): ResourceArenaSourceLease => {
      references.set(source, (references.get(source) ?? 0) + 1);
      let released = false;
      return {
        release: () => {
          if (released) return false;
          released = true;
          const next = (references.get(source) ?? 0) - 1;
          if (next > 0) {
            references.set(source, next);
            return false;
          }
          references.delete(source);
          return true;
        },
      };
    },
  });
  return { closed, deferred, references, store };
};

it("retries decoded CPU pressure only after a fair capacity wake", async () => {
  const sources = [fakeSource(1), fakeSource(2)];
  const closed: LoadedTextureSource[] = [];
  const results: unknown[] = [];
  let loads = 0;
  let deny = true;
  const store = new OrdinaryTextureSourceStore({
    close: (source) => { closed.push(source); },
    load: async () => sources[loads++]!,
    retain: () => {
      if (deny) throw new ResourceGovernorCpuCapacityError("temporary CPU pressure", false);
      return { release: () => true };
    },
  });
  const subscription = store.acquire({ uri: "/pressure.png" }, (result) => results.push(result));
  await flushJobs();
  expect({ closed, loads, results }).toEqual({ closed: [sources[0]], loads: 1, results: [] });
  expect(store.wake()).toBeUndefined();
  await flushJobs();
  expect(loads).toBe(1);
  deny = false;
  expect(store.wakeCpuCapacity()).toBe(true);
  await flushJobs();
  expect(loads).toBe(2);
  expect(results).toHaveLength(1);
  expect(store.wakeCpuCapacity()).toBe(false);
  subscription.release();
  store.dispose();
});

it("wakes every CPU-blocked source once so a larger re-denial cannot strand a smaller source", async () => {
  const sourceUris = new WeakMap<object, string>();
  const loads = new Map<string, number>();
  const results = new Map<string, unknown[]>();
  let retry = false;
  const store = new OrdinaryTextureSourceStore({
    close: () => undefined,
    load: async (request) => {
      loads.set(request.uri, (loads.get(request.uri) ?? 0) + 1);
      const source = fakeSource(loads.get(request.uri)!);
      sourceUris.set(source as object, request.uri);
      return source;
    },
    retain: (source) => {
      if (!retry || sourceUris.get(source as object) === "/large.png") {
        throw new ResourceGovernorCpuCapacityError("temporary CPU pressure", false);
      }
      return { release: () => true };
    },
  });
  const subscriptions = ["/large.png", "/small.png"].map((uri) => {
    results.set(uri, []);
    return store.acquire({ uri }, (result) => results.get(uri)!.push(result));
  });
  await flushJobs();
  retry = true;

  expect(store.wakeCpuCapacity()).toBe(true);
  await flushJobs();

  expect(loads).toEqual(new Map([["/large.png", 2], ["/small.png", 2]]));
  expect(results.get("/large.png")).toEqual([]);
  expect(results.get("/small.png")).toEqual([expect.objectContaining({ kind: "ready" })]);
  for (const subscription of subscriptions) subscription.release();
  store.dispose();
});

it("terminally publishes an intrinsically impossible decoded CPU cost", async () => {
  const results: unknown[] = [];
  const store = new OrdinaryTextureSourceStore({
    close: () => undefined,
    load: async () => fakeSource(1),
    retain: () => {
      throw new ResourceGovernorCpuCapacityError("decoded source exceeds maximum", true);
    },
  });
  store.acquire({ uri: "/impossible.png" }, (result) => results.push(result));
  await flushJobs();
  expect(results).toEqual([expect.objectContaining({ kind: "error" })]);
  expect(store.wakeCpuCapacity()).toBe(false);
  expect(store.snapshot()).toMatchObject({ failures: 1, starts: 1 });
  store.dispose();
});
type SourceOperation =
  | { readonly alias: number; readonly identity: number; readonly kind: "acquire" }
  | { readonly alias: number; readonly kind: "release" }
  | { readonly index: number; readonly kind: "settle"; readonly ready: boolean; readonly token: number }
  | { readonly kind: "dispose" };
const sourceOperation = (random: SeededRandom, step: number): SourceOperation => {
  const action = random.int(0, 10);
  if (action < 5) return { alias: random.int(0, 12), identity: random.int(0, 6), kind: "acquire" };
  if (action < 7) return { alias: random.int(0, 12), kind: "release" };
  if (action < 9) return { index: random.int(0, 20), kind: "settle", ready: random.boolean(0.75), token: step };
  return { kind: "dispose" };
};
const runSourceTrace = async (trace: readonly SourceOperation[], label: string): Promise<void> => {
  const { closed, deferred, references, store } = harness();
  type Job = { readonly id: number; readonly key: string; readonly subscribers: Set<number>; source?: LoadedTextureSource; settled: boolean };
  const aliases = new Map<number, { readonly job: Job; readonly subscription: OrdinaryTextureSourceSubscription }>();
  const jobs = new Map<string, Job>();
  const deferredJobs: Job[] = [];
  const expectedClosed = new Map<LoadedTextureSource, number>();
  const expectedReferences = new Set<LoadedTextureSource>();
  const settledDeferred = new Set<number>();
  let disposed = false;
  let failures = 0;
  let starts = 0;
  let successes = 0;
  const releaseAlias = (alias: number): void => {
    const row = aliases.get(alias);
    if (row === undefined) return;
    aliases.delete(alias);
    row.subscription.release();
    row.job.subscribers.delete(alias);
    if (row.job.subscribers.size !== 0 || jobs.get(row.job.key) !== row.job) return;
    jobs.delete(row.job.key);
    if (row.job.source !== undefined) {
      expectedReferences.delete(row.job.source);
      expectedClosed.set(row.job.source, 1);
    }
  };
  const assertModel = (step: number): void => {
    expect(store.snapshot(), `${label} step=${step}`).toMatchObject({
      entries: jobs.size,
      failures,
      starts,
      subscribers: aliases.size,
      successes,
    });
    const readySources = [...jobs.values()].flatMap((job) => job.source === undefined ? [] : [job.source]);
    expect(expectedReferences, `${label} step=${step} modeled retained sources`).toEqual(new Set(readySources));
    expect(new Set(references.keys()), `${label} step=${step} retained sources`).toEqual(expectedReferences);
    expect(closed, `${label} step=${step} closed sources`).toEqual(expectedClosed);
    for (const count of references.values()) expect(count, `${label} step=${step} source lease`).toBe(1);
    for (const count of closed.values()) expect(count, `${label} step=${step} close exactly once`).toBe(1);
  };
  for (const [step, operation] of trace.entries()) {
    if (operation.kind === "acquire") {
      releaseAlias(operation.alias);
      if (!disposed) {
        const request = { uri: `/source-${operation.identity}.png`, version: operation.identity % 2 };
        const key = ordinaryTextureSourceKey(request);
        let job = jobs.get(key);
        if (job === undefined) {
          job = { id: starts, key, settled: false, subscribers: new Set() };
          jobs.set(key, job);
          deferredJobs.push(job);
          starts += 1;
        }
        const subscription = store.acquire(request, () => undefined);
        job.subscribers.add(operation.alias);
        aliases.set(operation.alias, { job, subscription });
      } else {
        expect(() => store.acquire({ uri: "/disposed.png" }, () => undefined)).toThrow(/disposed/);
      }
    } else if (operation.kind === "release") {
      releaseAlias(operation.alias);
    } else if (operation.kind === "settle" && deferred.length > 0) {
      const index = operation.index % deferred.length;
      if (!settledDeferred.has(index)) {
        settledDeferred.add(index);
        const job = deferredJobs[index]!;
        if (operation.ready) {
          const loaded = fakeSource(operation.token);
          deferred[index]!.resolve(loaded);
          if (!disposed && jobs.get(job.key) === job && job.subscribers.size > 0) {
            job.settled = true;
            job.source = loaded;
            expectedReferences.add(loaded);
            successes += 1;
          }
        } else {
          deferred[index]!.reject(new Error(`failure-${operation.token}`));
          if (!disposed && jobs.get(job.key) === job && job.subscribers.size > 0) {
            job.settled = true;
            failures += 1;
          }
        }
        await flushJobs();
      }
    } else if (operation.kind === "dispose" && !disposed) {
      disposed = true;
      store.dispose();
      for (const job of jobs.values()) {
        if (job.source !== undefined) {
          expectedReferences.delete(job.source);
          expectedClosed.set(job.source, 1);
        }
      }
      jobs.clear();
      aliases.clear();
    }
    await flushJobs();
    assertModel(step);
  }
  if (!disposed) store.dispose();
};
describe("ordinary texture source jobs", () => {
  it("does not double-admit or double-start when admission wakes reentrantly", async () => {
    const source = fakeSource(30);
    let admissions = 0;
    let loads = 0;
    let releases = 0;
    let store!: OrdinaryTextureSourceStore;
    store = new OrdinaryTextureSourceStore({
      admit: () => {
        admissions += 1;
        store.wake();
        return { release: () => { releases += 1; } };
      },
      close: () => undefined,
      load: async () => { loads += 1; return source; },
      retain: () => ({ release: () => true }),
    });

    const subscription = store.acquire({ uri: "/reentrant-admit.png" }, () => undefined);
    await flushJobs();
    expect({ admissions, loads, releases }).toEqual({ admissions: 1, loads: 1, releases: 1 });
    subscription.release();
    store.dispose();
  });

  it("releases admission when its callback disposes the store before load starts", () => {
    let loads = 0;
    let releases = 0;
    let store!: OrdinaryTextureSourceStore;
    store = new OrdinaryTextureSourceStore({
      admit: () => {
        store.dispose();
        return { release: () => { releases += 1; } };
      },
      close: () => undefined,
      load: async () => { loads += 1; return fakeSource(31); },
      retain: () => ({ release: () => true }),
    });

    store.acquire({ uri: "/dispose-during-admit.png" }, () => undefined);
    expect({ loads, releases }).toEqual({ loads: 0, releases: 1 });
    expect(store.snapshot()).toMatchObject({ entries: 0, subscribers: 0 });
  });

  it("retries denied work on wake and contains a throwing admission releaser", async () => {
    let allowed = false;
    let loads = 0;
    const store = new OrdinaryTextureSourceStore({
      admit: () => allowed ? { release: () => { throw new Error("release fault"); } } : undefined,
      close: () => undefined,
      load: async () => { loads += 1; return fakeSource(32); },
      retain: () => ({ release: () => true }),
    });
    const subscription = store.acquire({ uri: "/denied-then-wake.png" }, () => undefined);
    expect(loads).toBe(0);

    allowed = true;
    store.wake();
    await flushJobs();
    expect(loads).toBe(1);
    subscription.release();
    store.dispose();
  });

  it("keys decoded content independently of upload state without ambiguous encodings", () => {
    expect(ordinaryTextureSourceKey({ contentKey: "same", uri: "/a.png" }))
      .toBe(ordinaryTextureSourceKey({ contentKey: "same", uri: "/b.png", version: 9 }));
    expect(ordinaryTextureSourceKey({ contentKey: 1, uri: "/a.png" }))
      .not.toBe(ordinaryTextureSourceKey({ contentKey: "1", uri: "/a.png" }));
    expect(ordinaryTextureSourceKey({ uri: "/a.png", version: 1 }))
      .not.toBe(ordinaryTextureSourceKey({ uri: "/a.png\u0000version:number:1" }));
  });
  it("settles retain failures as errors and closes the unowned source", async () => {
    const source = fakeSource(2);
    const retainFailure = new Error("retain failed");
    const closed: LoadedTextureSource[] = [];
    const results: unknown[] = [];
    const store = new OrdinaryTextureSourceStore({
      close: (value) => closed.push(value),
      load: async () => source,
      retain: () => { throw retainFailure; },
    });
    const subscription = store.acquire({ uri: "/retain-failure.png" }, (result) => results.push(result));
    await flushJobs();
    expect(results).toEqual([{ error: retainFailure, kind: "error" }]);
    expect(closed).toEqual([source]);
    expect(store.snapshot()).toMatchObject({ entries: 1, failures: 1, successes: 0 });
    subscription.release();
    expect(store.snapshot()).toMatchObject({ entries: 0, subscribers: 0 });
    store.dispose();
    expect(closed).toEqual([source]);
  });
  it("unwinds a lease when retain re-entrantly disposes the store", async () => {
    const source = fakeSource(22);
    let closes = 0;
    let references = 0;
    let ready = 0;
    const store = new OrdinaryTextureSourceStore({
      close: () => { closes += 1; },
      load: async () => source,
      retain: () => {
        references += 1;
        store.dispose();
        let released = false;
        return {
          release: () => {
            if (released) return false;
            released = true;
            references -= 1;
            return references === 0;
          },
        };
      },
    });
    store.acquire({ uri: "/reentrant-retain.png" }, (result) => {
      if (result.kind === "ready") ready += 1;
    });
    await flushJobs();
    expect({ closes, ready, references }).toEqual({ closes: 1, ready: 0, references: 0 });
    expect(store.snapshot()).toMatchObject({ entries: 0, subscribers: 0, successes: 0 });
    store.dispose();
    expect({ closes, references }).toEqual({ closes: 1, references: 0 });
  });
  it("keeps an opaque retain failure when compensating close also throws", async () => {
    let closeAttempts = 0;
    const results: unknown[] = [];
    const store = new OrdinaryTextureSourceStore({
      close: () => {
        closeAttempts += 1;
        throw null;
      },
      load: async () => fakeSource(23),
      retain: () => { throw undefined; },
    });
    store.acquire({ uri: "/opaque-retain-failure.png" }, (result) => results.push(result));
    await flushJobs();
    expect(results).toEqual([{ error: undefined, kind: "error" }]);
    expect(closeAttempts).toBe(1);
    expect(store.snapshot()).toMatchObject({ failures: 1, successes: 0 });
    store.dispose();
  });
  it("isolates listener failures and does not revisit re-entrant subscribers", async () => {
    const { deferred, store } = harness();
    const received: number[] = [];
    store.acquire({ uri: "/listeners.png" }, () => { throw new Error("first"); });
    store.acquire({ uri: "/listeners.png" }, () => { throw null; });
    store.acquire({ uri: "/listeners.png" }, () => {
      received.push(3);
      store.acquire({ uri: "/listeners.png" }, () => {
        received.push(4);
        throw undefined;
      });
    });
    await flushJobs();
    deferred[0]!.resolve(fakeSource(3));
    await flushJobs();
    expect(received).toEqual([3, 4]);
    expect(store.snapshot()).toMatchObject({ entries: 1, subscribers: 4, successes: 1 });
    store.dispose();
  });
  it("reports the exact failed delivery and can retry it without disturbing peers or ownership", async () => {
    const source = fakeSource(40);
    const request = { contentKey: "shared-image", uri: "/delivery.png", version: 4 } as const;
    const peerRequest = { contentKey: "shared-image", uri: "/canonical.png", version: 1 } as const;
    const closed: LoadedTextureSource[] = [];
    const failures: OrdinaryTextureSourceDeliveryFailure[] = [];
    const received: string[] = [];
    let failFirst = true;
    let loads = 0;
    let releases = 0;
    const store = new OrdinaryTextureSourceStore({
      close: (value) => { closed.push(value); },
      load: async () => { loads += 1; return source; },
      retain: () => ({
        release: () => {
          releases += 1;
          return true;
        },
      }),
    });
    const peer = store.acquire(peerRequest, (result) => {
      expect(result).toEqual({ kind: "ready", source });
      received.push("peer");
    });
    const failing = store.acquire(
      request,
      (result) => {
        if (failFirst) throw new Error("publish failed");
        expect(result).toEqual({ kind: "ready", source });
        received.push("retried");
      },
      { onDeliveryFailure: (failure) => { failures.push(failure); } },
    );

    await flushJobs();

    expect(received).toEqual(["peer"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      attempt: 1,
      error: expect.objectContaining({ message: "publish failed" }),
      request,
      result: { kind: "ready", source },
    });
    expect(store.snapshot()).toMatchObject({
      entries: 1,
      deliveryFailures: 1,
      subscribers: 2,
      successes: 1,
    });
    expect({ closed, loads, releases }).toEqual({ closed: [], loads: 1, releases: 0 });

    failFirst = false;
    expect(failures[0]!.retry()).toBe(true);
    expect(failures[0]!.retry()).toBe(false);
    expect(received).toEqual(["peer", "retried"]);
    expect({ closed, loads, releases }).toEqual({ closed: [], loads: 1, releases: 0 });

    failing.release();
    expect(closed).toEqual([]);
    peer.release();
    expect({ closed, releases }).toEqual({ closed: [source], releases: 1 });
    store.dispose();
    expect({ closed, releases }).toEqual({ closed: [source], releases: 1 });
  });
  it("lets a reported delivery failure terminalize only its subscriber", async () => {
    const source = fakeSource(41);
    const closed: LoadedTextureSource[] = [];
    const received: number[] = [];
    let reportedError: unknown = "missing";
    const store = new OrdinaryTextureSourceStore({
      close: (value) => { closed.push(value); },
      load: async () => source,
      retain: () => ({ release: () => true }),
    });
    const terminal = store.acquire(
      { uri: "/terminal-delivery.png" },
      () => { throw null; },
      {
        onDeliveryFailure: (failure) => {
          reportedError = failure.error;
          failure.terminate();
        },
      },
    );
    const peer = store.acquire({ uri: "/terminal-delivery.png" }, () => { received.push(1); });

    await flushJobs();

    expect(reportedError).toBeNull();
    expect(received).toEqual([1]);
    expect(store.snapshot()).toMatchObject({ entries: 1, deliveryFailures: 1, subscribers: 1 });
    expect(closed).toEqual([]);
    terminal.release();
    peer.release();
    expect(closed).toEqual([source]);
    store.dispose();
  });
  it("contains a throwing delivery-failure reporter while preserving peer delivery", async () => {
    const received: number[] = [];
    const store = new OrdinaryTextureSourceStore({
      close: () => undefined,
      load: async () => fakeSource(42),
      retain: () => ({ release: () => true }),
    });
    store.acquire(
      { uri: "/reporter.png" },
      () => { throw new Error("listener failed"); },
      { onDeliveryFailure: () => { throw new Error("reporter failed"); } },
    );
    store.acquire({ uri: "/reporter.png" }, () => { received.push(1); });

    await flushJobs();

    expect(received).toEqual([1]);
    expect(store.snapshot()).toMatchObject({ deliveryFailures: 1, subscribers: 2 });
    store.dispose();
  });
  it("makes aggregate cleanup total and preserves the first opaque failure", async () => {
    const sources = [fakeSource(10), fakeSource(11), fakeSource(12), fakeSource(13)];
    const releases: number[] = [];
    const closes: number[] = [];
    let reentrantAcquireBlocked = false;
    const store = new OrdinaryTextureSourceStore({
      close: (source) => {
        const index = sources.indexOf(source);
        closes.push(index);
        if (index === 1) throw null;
        if (index === 3) {
          store.dispose();
          try {
            store.acquire({ uri: "/reentrant.png" }, () => undefined);
          } catch {
            reentrantAcquireBlocked = true;
          }
        }
      },
      load: async (request) => sources[Number(request.version)]!,
      retain: (source) => {
        const index = sources.indexOf(source);
        return {
          release: () => {
            releases.push(index);
            if (index === 0) throw undefined;
            if (index === 2) throw new Error("third cleanup failed");
            return true;
          },
        };
      },
    });
    for (let index = 0; index < sources.length; index += 1) {
      store.acquire({ uri: `/cleanup-${index}.png`, version: index }, () => undefined);
    }
    await flushJobs();
    let thrown = false;
    let failure: unknown = "not thrown";
    try {
      store.dispose();
    } catch (error) {
      thrown = true;
      failure = error;
    }
    expect(thrown).toBe(true);
    expect(failure).toBeUndefined();
    expect(releases).toEqual([0, 1, 2, 3]);
    expect(closes).toEqual([1, 3]);
    expect(reentrantAcquireBlocked).toBe(true);
    expect(store.snapshot()).toMatchObject({ entries: 0, subscribers: 0 });
    store.dispose();
    expect(releases).toEqual([0, 1, 2, 3]);
    expect(closes).toEqual([1, 3]);
  });
  it("consumes a terminal release even when close throws", async () => {
    const source = fakeSource(20);
    let closes = 0;
    let releases = 0;
    const store = new OrdinaryTextureSourceStore({
      close: () => {
        closes += 1;
        throw undefined;
      },
      load: async () => source,
      retain: () => ({
        release: () => {
          releases += 1;
          return true;
        },
      }),
    });
    const subscription = store.acquire({ uri: "/terminal.png" }, () => undefined);
    await flushJobs();
    let thrown = false;
    try {
      subscription.release();
    } catch (error) {
      thrown = true;
      expect(error).toBeUndefined();
    }
    expect(thrown).toBe(true);
    subscription.release();
    store.dispose();
    expect({ closes, releases }).toEqual({ closes: 1, releases: 1 });
    expect(store.snapshot()).toMatchObject({ entries: 0, subscribers: 0 });
  });
  it("preserves null as a terminal cleanup failure", async () => {
    const store = new OrdinaryTextureSourceStore({
      close: () => { throw null; },
      load: async () => fakeSource(21),
      retain: () => ({ release: () => true }),
    });
    store.acquire({ uri: "/null-cleanup.png" }, () => undefined);
    await flushJobs();
    let thrown = false;
    let failure: unknown = "not thrown";
    try {
      store.dispose();
    } catch (error) {
      thrown = true;
      failure = error;
    }
    expect(thrown).toBe(true);
    expect(failure).toBeNull();
    expect(store.snapshot()).toMatchObject({ entries: 0, subscribers: 0 });
  });
  it("safely discards late resolve and reject completions after disposal", async () => {
    const deferred: DeferredLoad[] = [];
    const closed: LoadedTextureSource[] = [];
    const store = new OrdinaryTextureSourceStore({
      close: (source) => closed.push(source),
      load: (request) => new Promise((resolve, reject) => {
        deferred.push({ reject, requestKey: ordinaryTextureSourceKey(request), resolve });
      }),
      retain: () => { throw new Error("unreachable"); },
    });
    store.acquire({ uri: "/late-resolve.png" }, () => undefined);
    store.acquire({ uri: "/late-reject.png" }, () => undefined);
    store.dispose();
    const source = fakeSource(24);
    deferred[0]!.resolve(source);
    deferred[1]!.reject(new Error("late rejection"));
    await flushJobs();
    expect(closed).toEqual([source]);
    expect(store.snapshot()).toMatchObject({ aborts: 2, entries: 0, failures: 0, subscribers: 0 });
  });
  it("keeps abort, retry, stale completion, and close ownership bounded under fuzz", async () => {
    await runFuzzTraces({
      cases: 12,
      operation: sourceOperation,
      replayEnvName: "ROYAL_TEXTURE_SOURCE_REPLAY",
      replays: [{
        label: "stale-completion-after-retry",
        value: [
          { alias: 0, identity: 1, kind: "acquire" },
          { alias: 0, kind: "release" },
          { alias: 1, identity: 1, kind: "acquire" },
          { index: 0, kind: "settle", ready: true, token: 100 },
          { index: 1, kind: "settle", ready: true, token: 101 },
        ],
      }],
      run: runSourceTrace,
      seed: 0x51_0a_ce,
      steps: 80,
    });
  });
});
