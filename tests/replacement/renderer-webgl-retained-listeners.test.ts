import { describe, expect, it, vi } from "vitest";
import {
  KeyedRetainedListeners,
  RetainedListeners,
} from "../../packages/renderer-webgl/src/resource/retained-listeners";

describe("retained listener publication", () => {
  it("defers additions and observes removals within one publication", () => {
    const listeners = new RetainedListeners();
    const calls: string[] = [];
    const later = () => calls.push("later");
    let removeSecond: () => void = () => undefined;
    listeners.subscribe(() => {
      calls.push("first");
      removeSecond();
      listeners.subscribe(later);
    });
    removeSecond = listeners.subscribe(() => calls.push("removed"));

    listeners.publish(() => undefined);
    expect(calls).toEqual(["first"]);
    listeners.publish(() => undefined);
    expect(calls).toEqual(["first", "first", "later"]);
  });

  it("isolates listener and diagnostic failures without losing later listeners", () => {
    const listeners = new RetainedListeners();
    const later = vi.fn();
    listeners.subscribe(() => { throw new Error("listener failed"); });
    listeners.subscribe(later);

    listeners.publish(() => { throw new Error("diagnostic failed"); });
    expect(later).toHaveBeenCalledOnce();
  });

  it("removes keyed groups through idempotent subscriptions", () => {
    const listeners = new KeyedRetainedListeners<string>();
    const listener = vi.fn();
    const unsubscribe = listeners.subscribe("asset-a", listener);
    listeners.publish("asset-a", () => undefined);
    unsubscribe();
    unsubscribe();
    listeners.publish("asset-a", () => undefined);
    listeners.publish("asset-b", () => undefined);
    expect(listener).toHaveBeenCalledOnce();
  });
});
