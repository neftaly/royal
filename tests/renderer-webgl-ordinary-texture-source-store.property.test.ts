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
