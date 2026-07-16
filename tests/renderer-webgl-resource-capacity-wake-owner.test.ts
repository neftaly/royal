import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceCapacityWakeOwner } from "../packages/renderer-webgl/src/resource-capacity-wake-owner";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebGL resource-capacity wake owner", () => {
  it("coalesces CPU wakes across the two-microtask settlement boundary", () => {
    const microtasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => microtasks.push(callback));
    let wakes = 0;
    let invalidations = 0;
    const owner = new ResourceCapacityWakeOwner({
      invalidate: () => { invalidations += 1; },
      preparation: [],
      wakeCpu: () => {
        wakes += 1;
        return true;
      },
      wakeGpu: () => false,
    });

    owner.scheduleCpuCapacityWake();
    owner.scheduleCpuCapacityWake();
    expect(microtasks).toHaveLength(1);
    microtasks.shift()!();
    expect(wakes).toBe(0);
    expect(microtasks).toHaveLength(1);
    microtasks.shift()!();

    expect(wakes).toBe(1);
    expect(invalidations).toBe(1);
  });

  it("makes persistent-GPU suppression nestable and idempotently releasable", () => {
    let wakes = 0;
    let invalidations = 0;
    const owner = new ResourceCapacityWakeOwner({
      invalidate: () => { invalidations += 1; },
      preparation: [],
      wakeCpu: () => false,
      wakeGpu: () => {
        wakes += 1;
        return true;
      },
    });
    const releaseOuter = owner.suppressPersistentGpuWake();
    const releaseInner = owner.suppressPersistentGpuWake();

    owner.wakePersistentGpuCapacity();
    releaseInner();
    releaseInner();
    owner.wakePersistentGpuCapacity();
    releaseOuter();
    owner.wakePersistentGpuCapacity();

    expect(wakes).toBe(1);
    expect(invalidations).toBe(1);
  });

  it("routes released dimensions and honors subsystem CPU suppression", () => {
    const calls: string[] = [];
    const owner = new ResourceCapacityWakeOwner({
      invalidate: () => calls.push("invalidate"),
      preparation: [],
      wakeCpu: () => {
        calls.push("cpu");
        return false;
      },
      wakeGpu: () => {
        calls.push("gpu");
        return false;
      },
    });
    const microtasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => microtasks.push(callback));

    owner.notifyCapacityReleased({ cpuDecodedBytes: 1, persistentGpuBytes: 2 }, true);
    expect(calls).toEqual(["gpu"]);
    expect(microtasks).toHaveLength(0);
    owner.notifyCapacityReleased({ cpuDecodedBytes: 1, persistentGpuBytes: 0 });
    microtasks.shift()!();
    microtasks.shift()!();
    expect(calls).toEqual(["gpu", "cpu"]);
  });

  it("rotates preparation-peer priority while waking every peer", () => {
    const calls: string[] = [];
    const owner = new ResourceCapacityWakeOwner({
      invalidate: () => calls.push("invalidate"),
      preparation: [
        () => calls.push("a"),
        () => calls.push("b"),
        () => calls.push("c"),
      ],
      wakeCpu: () => false,
      wakeGpu: () => false,
    });

    owner.wakePreparation();
    owner.wakePreparation();

    expect(calls).toEqual([
      "a", "b", "c", "invalidate",
      "b", "c", "a", "invalidate",
    ]);
  });

  it("makes disposal terminal for queued and future wakes", () => {
    const microtasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => microtasks.push(callback));
    let wakes = 0;
    const owner = new ResourceCapacityWakeOwner({
      invalidate: () => { throw new Error("disposed owner invalidated"); },
      preparation: [() => { wakes += 1; }],
      wakeCpu: () => {
        wakes += 1;
        return true;
      },
      wakeGpu: () => {
        wakes += 1;
        return true;
      },
    });
    owner.scheduleCpuCapacityWake();
    microtasks.shift()!();
    owner.dispose();
    microtasks.shift()!();
    owner.scheduleCpuCapacityWake();
    owner.wakePersistentGpuCapacity();
    owner.wakePreparation();

    expect(wakes).toBe(0);
    expect(microtasks).toHaveLength(0);
  });
});
