import { prefilteredEnvironment } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import {
  PrefilteredEnvironmentAssetOwner,
  prefilteredEnvironmentAssetKey,
} from "../../packages/renderer-webgl/src/environment/asset-owner";
import { parseRoyalEnvironmentKtx1 } from "../../packages/renderer-webgl/src/environment/royal-environment-ktx1";
import { environmentKtx1Fixture } from "./support/environment-ktx1";

describe("prefiltered environment asset owner", () => {
  it("keeps number and string versions as distinct source identities", () => {
    expect(prefilteredEnvironmentAssetKey(prefilteredEnvironment({ src: "/env.ktx", version: 1 })))
      .not.toBe(prefilteredEnvironmentAssetKey(
        prefilteredEnvironment({ src: "/env.ktx", version: "1" }),
      ));
  });

  it("aborts replacement, publishes one parsed artifact, and isolates listener failures", async () => {
    let resolveFirst: ((source: ArrayBuffer) => void) | undefined;
    const first = new Promise<ArrayBuffer>((resolve) => { resolveFirst = resolve; });
    const requests: Array<{ signal: AbortSignal; src: string }> = [];
    const onAssetChanged = vi.fn();
    const onListenerError = vi.fn();
    const owner = new PrefilteredEnvironmentAssetOwner({
      onAssetChanged,
      onListenerError,
      prepare: async (source) => parseRoyalEnvironmentKtx1(source),
      read: (src, signal) => {
        requests.push({ signal, src });
        return src === "/first.ktx"
          ? first
          : Promise.resolve(environmentKtx1Fixture(2).source);
      },
    });
    const firstEnvironment = prefilteredEnvironment({ src: "/first.ktx" });
    const secondEnvironment = prefilteredEnvironment({ src: "/second.ktx" });
    const firstStates: string[] = [];
    owner.subscribe(firstEnvironment, () => {
      firstStates.push(owner.getSnapshot(firstEnvironment).state);
    });
    owner.subscribe(secondEnvironment, () => { throw new Error("listener failure"); });

    owner.reconcile(firstEnvironment);
    expect(owner.getSnapshot(firstEnvironment)).toEqual({ state: "loading" });
    owner.reconcile(secondEnvironment);
    expect(requests[0]!.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(owner.getSnapshot(secondEnvironment)).toMatchObject({
      mipCount: 2,
      size: 2,
      state: "ready",
    }));
    expect(owner.prepared(secondEnvironment)?.source.byteLength).toBeGreaterThan(0);
    expect(onAssetChanged).toHaveBeenCalledOnce();
    expect(onListenerError).toHaveBeenCalledTimes(2);
    expect(firstStates).toEqual(["loading", "idle"]);

    resolveFirst?.(environmentKtx1Fixture(1).source);
    await Promise.resolve();
    expect(owner.getSnapshot(firstEnvironment)).toEqual({ state: "idle" });
    owner.dispose();
    expect(requests[1]!.signal.aborted).toBe(true);
  });

  it("publishes parser failures as observable error state", async () => {
    const onAssetChanged = vi.fn();
    const owner = new PrefilteredEnvironmentAssetOwner({
      onAssetChanged,
      onListenerError: vi.fn(),
      prepare: async (source) => parseRoyalEnvironmentKtx1(source),
      read: async () => new ArrayBuffer(4),
    });
    const environment = prefilteredEnvironment({ src: "/broken.ktx" });
    owner.reconcile(environment);

    await vi.waitFor(() => expect(owner.getSnapshot(environment)).toMatchObject({
      error: expect.stringMatching(/truncated/u),
      state: "error",
    }));
    expect(onAssetChanged).not.toHaveBeenCalled();
  });
});
