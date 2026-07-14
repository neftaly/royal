import { describe, expect, it } from "vitest";
import { ResourceArenaSideEffectDebtOwner } from "../packages/renderer-webgl/src/resource-arena-side-effect-debt-owner";

describe("WebGL resource-arena side-effect debt owner", () => {
  it("retries the failed step without replaying successful steps", () => {
    const owner = new ResourceArenaSideEffectDebtOwner();
    const calls: string[] = [];
    let attempts = 0;
    owner.enqueue(
      "release",
      () => calls.push("first"),
      () => {
        calls.push("second");
        attempts += 1;
        if (attempts === 1) throw new Error("retry me");
      },
      () => calls.push("third"),
    );

    expect(() => owner.drain()).toThrow("retry me");
    owner.drain();

    expect(calls).toEqual(["first", "second", "second", "third"]);
  });

  it("runs every pending operation while retaining failures and throwing the first", () => {
    const owner = new ResourceArenaSideEffectDebtOwner();
    const calls: string[] = [];
    let failFirst = true;
    let failSecond = true;
    owner.enqueue("release", () => {
      calls.push("first");
      if (failFirst) throw new Error("first failure");
    });
    owner.enqueue("release", () => {
      calls.push("second");
      if (failSecond) throw new Error("second failure");
    });

    expect(() => owner.drain()).toThrow("first failure");
    expect(calls).toEqual(["first", "second"]);
    failFirst = false;
    failSecond = false;
    owner.drain();

    expect(calls).toEqual(["first", "second", "first", "second"]);
  });

  it("keeps re-entrant work behind retained retry debt", () => {
    const owner = new ResourceArenaSideEffectDebtOwner();
    const calls: string[] = [];
    let firstAttempt = true;
    owner.enqueue("release", () => {
      calls.push("retained");
      if (firstAttempt) {
        firstAttempt = false;
        owner.enqueue("release", () => calls.push("reentrant"));
        throw new Error("retain operation");
      }
    });

    expect(() => owner.drain()).toThrow("retain operation");
    owner.drain();

    expect(calls).toEqual(["retained", "retained", "reentrant"]);
  });

  it("ignores recursive drains while the current snapshot is active", () => {
    const owner = new ResourceArenaSideEffectDebtOwner();
    const calls: string[] = [];
    owner.enqueue("release", () => {
      calls.push("outer");
      owner.enqueue("release", () => calls.push("later"));
      owner.drain();
    });

    owner.drain();
    expect(calls).toEqual(["outer"]);
    owner.drain();
    expect(calls).toEqual(["outer", "later"]);
  });

  it("cancels active and future acquisitions without discarding releases", () => {
    const owner = new ResourceArenaSideEffectDebtOwner();
    const calls: string[] = [];
    owner.enqueue(
      "acquire",
      () => {
        calls.push("cancel");
        owner.cancelAcquisitions();
      },
      () => calls.push("discarded active acquire"),
    );
    owner.enqueue("acquire", () => calls.push("discarded queued acquire"));
    owner.enqueue("release", () => calls.push("release"));

    owner.drain();
    owner.enqueue("acquire", () => calls.push("discarded future acquire"));
    owner.enqueue("release", () => calls.push("future release"));
    owner.drain();

    expect(calls).toEqual(["cancel", "release", "future release"]);
  });

  it("treats thrown undefined as a retryable failure", () => {
    const owner = new ResourceArenaSideEffectDebtOwner();
    let attempts = 0;
    owner.enqueue("release", () => {
      attempts += 1;
      if (attempts === 1) throw undefined;
    });

    let caught = false;
    try {
      owner.drain();
    } catch (value) {
      caught = true;
      expect(value).toBeUndefined();
    }
    expect(caught).toBe(true);
    owner.drain();
    expect(attempts).toBe(2);
  });
});
