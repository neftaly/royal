import { describe, expect, it } from "vitest";
import {
  OrdinaryTextureSourceStore,
  ordinaryTextureSourceKey,
  type OrdinaryTextureSourceSubscription,
} from "../packages/renderer-webgl/src/ordinary-texture-source-store";
import type { ResourceArenaSourceLease } from "../packages/renderer-webgl/src/resource-arena";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture-sources";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

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

describe("ordinary texture source jobs", () => {
  it("keys decoded content independently of upload state without ambiguous encodings", () => {
    expect(ordinaryTextureSourceKey({ contentKey: "same", uri: "/a.png" }))
      .toBe(ordinaryTextureSourceKey({ contentKey: "same", uri: "/b.png", version: 9 }));
    expect(ordinaryTextureSourceKey({ contentKey: 1, uri: "/a.png" }))
      .not.toBe(ordinaryTextureSourceKey({ contentKey: "1", uri: "/a.png" }));
    expect(ordinaryTextureSourceKey({ uri: "/a.png", version: 1 }))
      .not.toBe(ordinaryTextureSourceKey({ uri: "/a.png\u0000version:number:1" }));
  });

  it("deduplicates a 100-consumer, four-upload-variant host scenario", async () => {
    const { closed, deferred, store } = harness();
    const subscriptions: OrdinaryTextureSourceSubscription[] = [];
    let ready = 0;
    for (let index = 0; index < 100; index += 1) {
      // Upload variants (sampler/color-space) intentionally do not enter this request.
      subscriptions.push(store.acquire({ uri: "/shared.png", version: 4 }, (result) => {
        if (result.kind === "ready") ready += 1;
      }));
    }
    await flushJobs();
    expect(deferred).toHaveLength(1);
    const source = fakeSource(1);
    deferred[0]!.resolve(source);
    await flushJobs();
    expect(ready).toBe(100);
    expect(store.snapshot()).toMatchObject({ activeJobs: 1, starts: 1, subscribers: 100, successes: 1 });
    for (const subscription of subscriptions) subscription.release();
    expect(store.snapshot()).toMatchObject({ activeJobs: 0, subscribers: 0 });
    expect(closed.get(source)).toBe(1);
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

  it("delivers cached errors to later subscribers without restarting", async () => {
    const failure = new Error("load failed");
    const results: unknown[] = [];
    const store = new OrdinaryTextureSourceStore({
      close: () => undefined,
      load: async () => { throw failure; },
      retain: () => { throw new Error("unreachable"); },
    });
    store.acquire({ uri: "/cached-error.png" }, (result) => results.push(result));
    await flushJobs();
    store.acquire({ uri: "/cached-error.png" }, (result) => results.push(result));

    expect(results).toEqual([
      { error: failure, kind: "error" },
      { error: failure, kind: "error" },
    ]);
    expect(store.snapshot()).toMatchObject({ failures: 1, starts: 1, subscribers: 2 });
    store.dispose();
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
    const contexts: Array<{ readonly label: string; readonly random: SeededRandom }> = [];
    forEachFuzzCase({ cases: 20, seed: 0x51_0a_ce }, ({ label, random }) => contexts.push({ label, random }));

    for (const { label, random } of contexts) {
      const { closed, deferred, references, store } = harness();
      const live: OrdinaryTextureSourceSubscription[] = [];
      let nextSource = 1;
      for (let step = 0; step < 160; step += 1) {
        const operation = random.int(0, 4);
        if (operation <= 1 || live.length === 0) {
          const identity = random.int(0, 8);
          live.push(store.acquire(
            identity % 3 === 0
              ? { contentKey: identity, uri: `/alias-${random.int(0, 4)}.png` }
              : { uri: `/texture-${identity}.png`, version: identity % 2 },
            () => undefined,
          ));
        } else if (operation === 2) {
          const index = random.int(0, live.length);
          live[index]!.release();
          live.splice(index, 1);
        } else {
          await flushJobs();
          const pending = deferred.shift();
          if (pending !== undefined) {
            if (random.boolean(0.8)) pending.resolve(fakeSource(nextSource++));
            else pending.reject(new Error("fuzz failure"));
          }
        }
        await flushJobs();
        expect(store.snapshot().subscribers, label).toBe(live.length);
        for (const count of references.values()) expect(count, label).toBe(1);
        for (const count of closed.values()) expect(count, label).toBe(1);
      }
      for (const subscription of live) subscription.release();
      await flushJobs();
      for (const pending of deferred) pending.resolve(fakeSource(nextSource++));
      await flushJobs();
      expect(store.snapshot(), label).toMatchObject({ activeJobs: 0, subscribers: 0 });
      expect(references.size, label).toBe(0);
      for (const count of closed.values()) expect(count, label).toBe(1);
      store.dispose();
    }
  });
});
