import { describe, expect, it, vi } from "vitest";
import type {
  WebGlContextLifecycle,
  WebGlContextSnapshot,
} from "../packages/renderer-webgl/src/root-types";
import { WebGlContextLifecycleOwner } from "../packages/renderer-webgl/src/context/lifecycle-owner";
import {
  initialWebGlContextSnapshot,
  reduceWebGlContextLifecycle,
  type WebGlContextLifecycleEvent,
} from "../packages/renderer-webgl/src/context/lifecycle";
import { forEachFuzzCase } from "./fuzz";

describe("WebGL context lifecycle owner", () => {
  it("owns frozen state and preserves exact transition counters", () => {
    const owner = new WebGlContextLifecycleOwner();

    expect(owner.lifecycle).toBe("active");
    expect(owner.generation).toBe(1);
    expect(owner.snapshot()).toEqual({
      generation: 1,
      lifecycle: "active",
      losses: 0,
      restores: 0,
    });
    expect(Object.isFrozen(owner.snapshot())).toBe(true);

    expect(owner.lose()).toBe(true);
    expect(owner.beginRestore()).toBe(true);
    expect(owner.failRestore("first failure")).toBe(true);
    expect(owner.beginRestore()).toBe(true);
    expect(owner.finishRestore()).toBe(true);
    expect(owner.snapshot()).toEqual({
      generation: 2,
      lifecycle: "active",
      losses: 1,
      restores: 1,
    });
    expect(owner.dispose()).toBe(true);
    expect(owner.snapshot()).toEqual({
      generation: 3,
      lifecycle: "disposed",
      losses: 1,
      restores: 1,
    });
  });

  it("queues reentrant transitions until every observer receives the active transition", () => {
    const owner = new WebGlContextLifecycleOwner();
    const first: WebGlContextLifecycle[] = [];
    const second: WebGlContextLifecycle[] = [];
    owner.observe((value) => {
      first.push(value.lifecycle);
      if (value.lifecycle === "lost") owner.beginRestore();
    });
    owner.observe((value) => second.push(value.lifecycle));

    owner.lose();

    expect(first).toEqual(["active", "lost", "restoring"]);
    expect(second).toEqual(["active", "lost", "restoring"]);
  });

  it("lets reentrant disposal cancel restoration before GPU work starts", () => {
    const owner = new WebGlContextLifecycleOwner();
    const later: WebGlContextLifecycle[] = [];
    owner.lose();
    owner.observe((value) => {
      if (value.lifecycle === "restoring") owner.dispose();
    });
    owner.observe((value) => later.push(value.lifecycle));

    expect(owner.beginRestore()).toBe(true);

    expect(owner.lifecycle).toBe("disposed");
    expect(later).toEqual(["lost", "restoring", "disposed"]);
    expect(owner.finishRestore()).toBe(false);
  });

  it("publishes loss after cleanup and preserves an opaque cleanup failure", () => {
    const owner = new WebGlContextLifecycleOwner(() => undefined);
    const order: string[] = [];
    owner.observe((value) => order.push(`observer:${value.lifecycle}`));
    let failurePresent = false;
    let failure: unknown = "not thrown";

    try {
      owner.lose(() => {
        order.push("cleanup");
        throw undefined;
      });
    } catch (value) {
      failurePresent = true;
      failure = value;
    }

    expect(failurePresent).toBe(true);
    expect(failure).toBeUndefined();
    expect(order).toEqual(["observer:active", "cleanup", "observer:lost"]);
    expect(owner.lifecycle).toBe("lost");
  });

  it("keeps fallible restoration preparation outside the success transition", () => {
    const owner = new WebGlContextLifecycleOwner();
    const transitions: WebGlContextLifecycle[] = [];
    owner.observe((value) => transitions.push(value.lifecycle));
    owner.lose();
    owner.beginRestore();

    const duringPreparation: WebGlContextLifecycle[] = [];
    owner.observe((value) => duringPreparation.push(value.lifecycle));
    expect(owner.lifecycle).toBe("restoring");
    expect(duringPreparation).toEqual(["restoring"]);
    expect(transitions).toEqual(["active", "lost", "restoring"]);

    owner.failRestore("resource restore failed");
    expect(transitions).toEqual(["active", "lost", "restoring", "lost"]);
    expect(owner.snapshot().lastError).toBe("resource restore failed");
  });

  it("delivers one current snapshot to an observer added during publication", () => {
    const owner = new WebGlContextLifecycleOwner();
    const existing: WebGlContextLifecycle[] = [];
    const added: WebGlContextLifecycle[] = [];
    let addedObserver = false;
    owner.observe((value) => {
      if (value.lifecycle === "lost" && !addedObserver) {
        addedObserver = true;
        owner.observe((next) => added.push(next.lifecycle));
      }
    });
    owner.observe((value) => existing.push(value.lifecycle));

    owner.lose();
    owner.beginRestore();

    expect(existing).toEqual(["active", "lost", "restoring"]);
    expect(added).toEqual(["lost", "restoring"]);
  });

  it("isolates opaque observer and reporter failures without dropping the observer", () => {
    const failures: unknown[] = [];
    const owner = new WebGlContextLifecycleOwner((failure) => {
      failures.push(failure);
      throw null;
    });
    let opaqueThrows = 0;
    const later = vi.fn();
    owner.observe(() => {
      opaqueThrows += 1;
      throw undefined;
    });
    owner.observe(later);

    owner.lose();

    expect(opaqueThrows).toBe(2);
    expect(failures).toEqual([undefined, undefined]);
    expect(later).toHaveBeenCalledTimes(2);
  });

  it("publishes disposed once and never retains post-disposal observers", () => {
    const owner = new WebGlContextLifecycleOwner(() => undefined);
    const retained: WebGlContextLifecycle[] = [];
    owner.observe((value) => retained.push(value.lifecycle));

    expect(owner.dispose()).toBe(true);
    expect(retained).toEqual(["active", "disposed"]);
    expect(owner.dispose()).toBe(false);

    let deliveredBeforeReturn = false;
    const stop = owner.observe((value) => {
      deliveredBeforeReturn = true;
      expect(value.lifecycle).toBe("disposed");
      throw undefined;
    });
    expect(deliveredBeforeReturn).toBe(true);
    stop();
    expect(owner.lose()).toBe(false);
    expect(retained).toEqual(["active", "disposed"]);
  });

  it("matches the legal lifecycle reducer across generated traces", () => {
    type Action = "begin" | "dispose" | "fail" | "finish" | "lose";

    forEachFuzzCase({ cases: 64, seed: 0x1fe_c7c1e }, ({ label, random }) => {
      const owner = new WebGlContextLifecycleOwner();
      const delivered: WebGlContextSnapshot[] = [];
      owner.observe((value) => delivered.push(value));
      let expected = initialWebGlContextSnapshot();
      const published: WebGlContextSnapshot[] = [expected];

      for (let step = 0; step < 96; step += 1) {
        const action = random.pick([
          "begin",
          "dispose",
          "fail",
          "finish",
          "lose",
        ] as const satisfies readonly Action[]);
        const event: WebGlContextLifecycleEvent = action === "begin"
          ? { kind: "begin-restore" }
          : action === "fail"
            ? { kind: "fail-restore", lastError: `failure ${step}` }
            : action === "finish"
              ? { kind: "finish-restore" }
              : { kind: action };
        const next = reduceWebGlContextLifecycle(expected, event);
        const accepted = next !== undefined;
        const ownerAccepted = action === "begin"
          ? owner.beginRestore()
          : action === "fail"
            ? owner.failRestore(`failure ${step}`)
            : action === "finish"
              ? owner.finishRestore()
              : action === "lose"
                ? owner.lose()
                : owner.dispose();
        expect(ownerAccepted, `${label} ${step}:${action}`).toBe(accepted);
        if (next !== undefined) {
          expected = next;
          published.push(next);
        }
        expect(owner.snapshot(), `${label} ${step}:${action} state`).toEqual(expected);
        expect(Object.isFrozen(owner.snapshot()), `${label} ${step}:${action} frozen`).toBe(true);
      }

      expect(delivered, `${label} publications`).toEqual(published);
    });
  });
});
