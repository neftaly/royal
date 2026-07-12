import { describe, expect, it } from "vitest";
import {
  OrdinaryTextureSourceStore,
  ordinaryTextureSourceKey,
  type OrdinaryTextureSourceSubscription,
} from "../packages/renderer-webgl/src/ordinary-texture-source-store";
import type { ResourceArenaSourceLease } from "../packages/renderer-webgl/src/resource-arena";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture-sources";
import { runFuzzTraces, type SeededRandom } from "./fuzz";
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
      activeJobs: jobs.size,
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
    expect(store.snapshot()).toMatchObject({ activeJobs: 1, failures: 1, successes: 0 });
    subscription.release();
    expect(store.snapshot()).toMatchObject({ activeJobs: 0, subscribers: 0 });
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
    expect(store.snapshot()).toMatchObject({ activeJobs: 0, subscribers: 0, successes: 0 });
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
    expect(store.snapshot()).toMatchObject({ activeJobs: 1, subscribers: 4, successes: 1 });
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
    expect(store.snapshot()).toMatchObject({ activeJobs: 0, subscribers: 0 });
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
    expect(store.snapshot()).toMatchObject({ activeJobs: 0, subscribers: 0 });
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
    expect(store.snapshot()).toMatchObject({ activeJobs: 0, subscribers: 0 });
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
    expect(store.snapshot()).toMatchObject({ aborts: 2, activeJobs: 0, failures: 0, subscribers: 0 });
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
