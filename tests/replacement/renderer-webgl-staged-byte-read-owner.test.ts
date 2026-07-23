import { describe, expect, it, vi } from "vitest";
import {
  StagedByteReadOwner,
  stagedByteReadCanStart,
} from "../../packages/renderer-webgl/src/resource/staged-byte-read-owner";

describe("staged byte read owner", () => {
  it("coalesces synchronous diagnostic transitions without delaying state", async () => {
    let changes = 0;
    const owner = new StagedByteReadOwner(2, 4, 8, () => {
      changes += 1;
    });
    const controller = new AbortController();

    const first = owner.read(controller.signal, async () => new Uint8Array(1));
    const second = owner.read(controller.signal, async () => new Uint8Array(1));

    expect(owner.snapshot()).toMatchObject({
      activeReads: 2,
      queuedReads: 0,
      sourceReservations: 2,
    });
    expect(changes).toBe(0);
    await Promise.resolve();
    expect(changes).toBe(1);

    const firstLease = await first;
    const secondLease = await second;
    await Promise.resolve();
    const changesBeforeRelease = changes;
    firstLease.release();
    secondLease.release();
    expect(owner.snapshot()).toMatchObject({
      activeReads: 0,
      sourceReservations: 0,
      stagedBytes: 0,
    });
    await Promise.resolve();
    expect(changes).toBe(changesBeforeRelease + 1);
  });

  it("keeps admission policy pure and permits one oversize source", () => {
    expect(stagedByteReadCanStart(0, 2, 0, 4, 100, 10)).toBe(true);
    expect(stagedByteReadCanStart(0, 2, 1, 4, 10, 10)).toBe(false);
    expect(stagedByteReadCanStart(2, 2, 2, 4, 0, 10)).toBe(false);
    expect(stagedByteReadCanStart(0, 2, 4, 4, 0, 10)).toBe(false);
  });

  it("overlaps transport while bounding completed source bytes", async () => {
    const owner = new StagedByteReadOwner(2, 4, 5);
    const completions: Array<(bytes: Uint8Array) => void> = [];
    const reads = Array.from({ length: 4 }, () => vi.fn(
      () => new Promise<Uint8Array>((resolve) => completions.push(resolve)),
    ));
    const controller = new AbortController();
    const leases = reads.map((read) => owner.read(controller.signal, read));

    expect(reads.map((read) => read.mock.calls.length)).toEqual([1, 1, 0, 0]);
    completions[0]!(new Uint8Array(6));
    const first = await leases[0]!;
    expect(reads.map((read) => read.mock.calls.length)).toEqual([1, 1, 0, 0]);
    expect(owner.snapshot()).toMatchObject({
      activeReads: 1,
      queuedReads: 2,
      sourceReservations: 2,
      stagedBytes: 6,
    });

    first.release();
    expect(reads.map((read) => read.mock.calls.length)).toEqual([1, 1, 1, 0]);
    completions[1]!(new Uint8Array(2));
    const second = await leases[1]!;
    expect(reads.map((read) => read.mock.calls.length)).toEqual([1, 1, 1, 1]);

    completions[2]!(new Uint8Array(1));
    completions[3]!(new Uint8Array(1));
    const remaining = await Promise.all(leases.slice(2));
    second.release();
    for (const lease of remaining) lease.release();
    expect(owner.snapshot()).toMatchObject({
      activeReads: 0,
      queuedReads: 0,
      sourceReservations: 0,
      stagedBytes: 0,
    });
  });

  it("drops queued cancellation without starting its transport", async () => {
    const owner = new StagedByteReadOwner(1, 1, 8);
    let complete: ((bytes: Uint8Array) => void) | undefined;
    const first = owner.read(
      new AbortController().signal,
      () => new Promise((resolve) => { complete = resolve; }),
    );
    const controller = new AbortController();
    const queuedRead = vi.fn(async () => new Uint8Array([2]));
    const queued = owner.read(controller.signal, queuedRead);

    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(queuedRead).not.toHaveBeenCalled();

    complete?.(new Uint8Array([1]));
    const lease = await first;
    lease.release();
    expect(owner.snapshot().sourceReservations).toBe(0);
  });

  it("holds active capacity until a cancelled transport actually settles", async () => {
    const owner = new StagedByteReadOwner(1, 1, 8);
    const controller = new AbortController();
    let complete: ((bytes: Uint8Array) => void) | undefined;
    const reading = owner.read(
      controller.signal,
      () => new Promise((resolve) => { complete = resolve; }),
    );

    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(owner.snapshot()).toMatchObject({
      activeReads: 1,
      sourceReservations: 1,
    });

    complete?.(new Uint8Array([1]));
    await Promise.resolve();
    expect(owner.snapshot()).toMatchObject({
      activeReads: 0,
      sourceReservations: 0,
    });
  });
});
