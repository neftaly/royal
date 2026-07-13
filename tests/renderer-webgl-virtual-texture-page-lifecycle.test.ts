import { describe, expect, it } from "vitest";
import {
  reduceVirtualTexturePageLifecycle,
  virtualTexturePageLifecycleCanBecomeResident,
  virtualTexturePageLifecycleClaimed,
  virtualTexturePageLifecycleLoading,
  virtualTexturePageLifecycleRetryBlocked,
  type VirtualTexturePageLifecycle,
  type VirtualTexturePageLifecycleEvent,
} from "../packages/renderer-webgl/src/virtual-texture-page-lifecycle";

const policy = { retryBaseDelayMs: 50, retryLimit: 2 } as const;

const reduce = (
  state: VirtualTexturePageLifecycle | undefined,
  event: VirtualTexturePageLifecycleEvent,
) => reduceVirtualTexturePageLifecycle(state, event, policy);

describe("virtual texture page lifecycle", () => {
  it("grants only absent or eligible pages and preserves retry attempts", () => {
    expect(reduce(undefined, { kind: "grant" })).toEqual({
      state: { attempts: 0, kind: "loading" },
    });
    expect(reduce({ attempts: 1, kind: "eligible" }, { kind: "grant" })).toEqual({
      state: { attempts: 1, kind: "loading" },
    });

    for (const state of [
      { attempts: 1, kind: "loading" },
      { kind: "queued" },
      { attempts: 1, kind: "backoff", retryDelayMs: 50 },
      { attempts: 2, kind: "terminal" },
    ] as const satisfies readonly VirtualTexturePageLifecycle[]) {
      expect(reduce(state, { kind: "grant" }).state).toBe(state);
    }
  });

  it("hands decoded loading pages to the queue, discards them, or makes invalid data terminal", () => {
    const loading = { attempts: 1, kind: "loading" } as const;

    expect(reduce(loading, { disposition: "queued", kind: "decoded" })).toEqual({
      state: { kind: "queued" },
    });
    expect(reduce(loading, { disposition: "discarded", kind: "decoded" })).toEqual({});
    expect(reduce(loading, { disposition: "invalid", kind: "decoded" })).toEqual({
      state: { attempts: policy.retryLimit, kind: "terminal" },
    });
    expect(reduce(
      { attempts: policy.retryLimit + 1, kind: "loading" },
      { disposition: "invalid", kind: "decoded" },
    )).toEqual({
      state: { attempts: policy.retryLimit + 1, kind: "terminal" },
    });
  });

  it("ignores decoded events unless a load owns the completion", () => {
    for (const disposition of ["discarded", "invalid", "queued"] as const) {
      expect(reduce(undefined, { disposition, kind: "decoded" })).toEqual({});
      for (const state of [
        { attempts: 1, kind: "eligible" },
        { kind: "queued" },
        { attempts: 1, kind: "backoff", retryDelayMs: 50 },
        { attempts: 2, kind: "terminal" },
      ] as const satisfies readonly VirtualTexturePageLifecycle[]) {
        expect(reduce(state, { disposition, kind: "decoded" }).state).toBe(state);
      }
    }
  });

  it("applies exponential retry delays and becomes terminal at the retry cap", () => {
    const firstFailure = reduce({ attempts: 0, kind: "loading" }, { kind: "load-rejected" });
    expect(firstFailure).toEqual({
      retryDelayMs: 50,
      state: { attempts: 1, kind: "backoff", retryDelayMs: 50 },
    });

    const firstElapsed = reduce(firstFailure.state, { kind: "retry-elapsed" });
    const secondLoad = reduce(firstElapsed.state, { kind: "grant" });
    const secondFailure = reduce(secondLoad.state, { kind: "load-rejected" });
    expect(secondFailure).toEqual({
      retryDelayMs: 100,
      state: { attempts: 2, kind: "backoff", retryDelayMs: 100 },
    });

    const secondElapsed = reduce(secondFailure.state, { kind: "retry-elapsed" });
    const finalLoad = reduce(secondElapsed.state, { kind: "grant" });
    expect(reduce(finalLoad.state, { kind: "load-rejected" })).toEqual({
      state: { attempts: 2, kind: "terminal" },
    });
  });

  it("classifies permanent source absence as terminal and non-convergent", () => {
    expect(reduce(undefined, { kind: "unrequestable" })).toEqual({
      state: { attempts: policy.retryLimit, kind: "terminal" },
    });
    expect(virtualTexturePageLifecycleCanBecomeResident(undefined)).toBe(true);
    expect(virtualTexturePageLifecycleCanBecomeResident({ kind: "capacity-blocked" })).toBe(true);
    expect(virtualTexturePageLifecycleCanBecomeResident({
      attempts: policy.retryLimit,
      kind: "terminal",
    })).toBe(false);
  });

  it("clamps negative retry delays and honors a zero retry cap", () => {
    expect(reduceVirtualTexturePageLifecycle(
      { attempts: 0, kind: "loading" },
      { kind: "load-rejected" },
      { retryBaseDelayMs: -10, retryLimit: 1 },
    )).toEqual({
      retryDelayMs: 0,
      state: { attempts: 1, kind: "backoff", retryDelayMs: 0 },
    });
    expect(reduceVirtualTexturePageLifecycle(
      { attempts: 0, kind: "loading" },
      { kind: "load-rejected" },
      { retryBaseDelayMs: 50, retryLimit: 0 },
    )).toEqual({ state: { attempts: 0, kind: "terminal" } });
  });

  it("ignores load rejection unless a page is loading", () => {
    expect(reduce(undefined, { kind: "load-rejected" })).toEqual({});
    for (const state of [
      { attempts: 1, kind: "eligible" },
      { kind: "queued" },
      { attempts: 1, kind: "backoff", retryDelayMs: 50 },
      { attempts: 2, kind: "terminal" },
    ] as const satisfies readonly VirtualTexturePageLifecycle[]) {
      expect(reduce(state, { kind: "load-rejected" }).state).toBe(state);
    }
  });

  it("makes elapsed backoff eligible while retaining its attempt count", () => {
    expect(reduce(
      { attempts: 2, kind: "backoff", retryDelayMs: 100 },
      { kind: "retry-elapsed" },
    )).toEqual({ state: { attempts: 2, kind: "eligible" } });

    expect(reduce(undefined, { kind: "retry-elapsed" })).toEqual({});
    for (const state of [
      { attempts: 1, kind: "eligible" },
      { attempts: 1, kind: "loading" },
      { kind: "queued" },
      { attempts: 2, kind: "terminal" },
    ] as const satisfies readonly VirtualTexturePageLifecycle[]) {
      expect(reduce(state, { kind: "retry-elapsed" }).state).toBe(state);
    }
  });

  it("cancels backoff on context loss without reviving terminal failures", () => {
    expect(reduce(
      { attempts: 1, kind: "backoff", retryDelayMs: 50 },
      { kind: "context-lost" },
    )).toEqual({ state: { attempts: 1, kind: "eligible" } });
    expect(reduce(
      { attempts: 1, kind: "loading" },
      { kind: "context-lost" },
    )).toEqual({ state: { attempts: 1, kind: "eligible" } });

    const terminal = { attempts: 2, kind: "terminal" } as const;
    expect(reduce(terminal, { kind: "context-lost" }).state).toBe(terminal);
    for (const state of [
      { attempts: 1, kind: "eligible" },
      { kind: "queued" },
    ] as const satisfies readonly VirtualTexturePageLifecycle[]) {
      expect(reduce(state, { kind: "context-lost" }).state).toBe(state);
    }
    expect(reduce(undefined, { kind: "context-lost" })).toEqual({});
  });

  it("settles only GPU-queued pages", () => {
    expect(reduce({ kind: "queued" }, { kind: "gpu-settled" })).toEqual({});
    expect(reduce(undefined, { kind: "gpu-settled" })).toEqual({});
    for (const state of [
      { attempts: 1, kind: "eligible" },
      { attempts: 1, kind: "loading" },
      { attempts: 1, kind: "backoff", retryDelayMs: 50 },
      { attempts: 2, kind: "terminal" },
    ] as const satisfies readonly VirtualTexturePageLifecycle[]) {
      expect(reduce(state, { kind: "gpu-settled" }).state).toBe(state);
    }
  });

  it("releases every lifecycle state to absence", () => {
    expect(reduce(undefined, { kind: "release" })).toEqual({});
    for (const state of [
      { attempts: 1, kind: "eligible" },
      { attempts: 1, kind: "loading" },
      { kind: "queued" },
      { attempts: 1, kind: "backoff", retryDelayMs: 50 },
      { attempts: 2, kind: "terminal" },
    ] as const satisfies readonly VirtualTexturePageLifecycle[]) {
      expect(reduce(state, { kind: "release" })).toEqual({});
    }
  });

  it("derives claim, loading, and retry-blocked predicates from lifecycle state", () => {
    const cases: readonly [
      VirtualTexturePageLifecycle | undefined,
      claimed: boolean,
      loading: boolean,
      retryBlocked: boolean,
    ][] = [
      [undefined, false, false, false],
      [{ attempts: 1, kind: "eligible" }, false, false, false],
      [{ attempts: 1, kind: "loading" }, true, true, false],
      [{ kind: "queued" }, true, false, false],
      [{ attempts: 1, kind: "backoff", retryDelayMs: 50 }, false, false, true],
      [{ attempts: 2, kind: "terminal" }, false, false, true],
    ];

    for (const [state, claimed, loading, retryBlocked] of cases) {
      expect(virtualTexturePageLifecycleClaimed(state)).toBe(claimed);
      expect(virtualTexturePageLifecycleLoading(state)).toBe(loading);
      expect(virtualTexturePageLifecycleRetryBlocked(state)).toBe(retryBlocked);
    }
  });
});
