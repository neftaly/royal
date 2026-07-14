import { describe, expect, it, vi } from "vitest";
import { createObservedExternalStore } from "../packages/react/src/observed-external-store";

describe("React observed external store", () => {
  it("starts lazily, multicasts changes, and stops after the final subscriber", () => {
    let publish!: (value: number) => void;
    const stop = vi.fn();
    const observe = vi.fn((next: (value: number) => void) => {
      publish = next;
      next(1);
      return stop;
    });
    const store = createObservedExternalStore(0, observe);
    const first = vi.fn();
    const second = vi.fn();

    expect(store.getSnapshot()).toBe(0);
    const unsubscribeFirst = store.subscribe(first);
    const unsubscribeSecond = store.subscribe(second);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(1);
    publish(2);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeFirst();
    expect(stop).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("retains snapshot identity and suppresses notifications for semantic equality", () => {
    let publish!: (value: { readonly state: string }) => void;
    const initial = { state: "ready" };
    const store = createObservedExternalStore(
      initial,
      (next) => {
        publish = next;
        return () => undefined;
      },
      (left, right) => left.state === right.state,
    );
    const listener = vi.fn();
    store.subscribe(listener);

    publish({ state: "ready" });
    expect(store.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    const failed = { state: "error" };
    publish(failed);
    expect(store.getSnapshot()).toBe(failed);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("restarts observation after all subscribers leave", () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const observe = vi.fn(() => {
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    });
    const store = createObservedExternalStore("idle", observe);

    store.subscribe(() => undefined)();
    store.subscribe(() => undefined)();

    expect(observe).toHaveBeenCalledTimes(2);
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  });

  it("owns duplicate callback subscriptions independently", () => {
    let publish!: (value: number) => void;
    const store = createObservedExternalStore(0, (next) => {
      publish = next;
      return () => undefined;
    });
    const listener = vi.fn();
    const unsubscribeFirst = store.subscribe(listener);
    const unsubscribeSecond = store.subscribe(listener);

    publish(1);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribeFirst();
    publish(2);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribeSecond();
  });
});
