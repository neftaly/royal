import { describe, expect, it } from "vitest";
import {
  createActiveContextLifecycle,
  reduceContextLifecycle,
} from "../../packages/renderer-webgl/src/context/context-lifecycle";
import { ContextLifecycleOwner } from "../../packages/renderer-webgl/src/context/context-lifecycle-owner";

describe("context lifecycle core", () => {
  it("invalidates allocation generation on loss and disposal only", () => {
    const active = createActiveContextLifecycle();
    const lost = reduceContextLifecycle(active, { kind: "context-lost" })!;
    const restoring = reduceContextLifecycle(lost, { kind: "restoration-started" })!;
    const restored = reduceContextLifecycle(restoring, { kind: "restored" })!;
    const disposed = reduceContextLifecycle(restored, { kind: "dispose" })!;

    expect([active.generation, lost.generation, restoring.generation, restored.generation])
      .toEqual([1, 2, 2, 2]);
    expect(disposed).toMatchObject({ generation: 3, phase: "disposed" });
    expect(restored).toMatchObject({ interruptions: 1, recoveries: 1 });
  });

  it("rejects illegal, duplicate and terminal transitions", () => {
    const active = createActiveContextLifecycle();
    expect(reduceContextLifecycle(active, { kind: "restored" })).toBeUndefined();
    const lost = reduceContextLifecycle(active, { kind: "context-lost" })!;
    expect(reduceContextLifecycle(lost, { kind: "context-lost" })).toBeUndefined();
    const disposed = reduceContextLifecycle(lost, { kind: "dispose" })!;
    expect(reduceContextLifecycle(disposed, { kind: "restoration-started" })).toBeUndefined();
    expect(reduceContextLifecycle(disposed, { kind: "dispose" })).toBeUndefined();
  });

  it("retains a bounded restoration failure until a later successful recovery", () => {
    const active = createActiveContextLifecycle();
    const lost = reduceContextLifecycle(active, { kind: "context-lost" })!;
    const restoring = reduceContextLifecycle(lost, { kind: "restoration-started" })!;
    const failed = reduceContextLifecycle(restoring, {
      failure: "program reconstruction failed",
      kind: "restoration-failed",
    })!;
    expect(failed).toMatchObject({ failure: "program reconstruction failed", phase: "lost" });
    const retrying = reduceContextLifecycle(failed, { kind: "restoration-started" })!;
    expect(reduceContextLifecycle(retrying, { kind: "restored" })).toEqual({
      generation: 2,
      interruptions: 1,
      phase: "active",
      recoveries: 1,
    });
  });
});

describe("context lifecycle shell", () => {
  it("serializes reentrant transitions and isolates failing listeners", () => {
    const errors: unknown[] = [];
    const owner = new ContextLifecycleOwner((error) => errors.push(error));
    const phases: string[] = [];
    owner.subscribe(() => {
      const phase = owner.getSnapshot().phase;
      phases.push(`first:${phase}`);
      if (phase === "lost") owner.transition({ kind: "restoration-started" });
    });
    owner.subscribe(() => {
      phases.push(`second:${owner.getSnapshot().phase}`);
      throw new Error("observer failed");
    });

    owner.transition({ kind: "context-lost" });
    expect(phases).toEqual([
      "first:lost",
      "second:lost",
      "first:restoring",
      "second:restoring",
    ]);
    expect(errors).toHaveLength(2);
  });

  it("honors unsubscribe before a captured listener turn and closes on disposal", () => {
    const owner = new ContextLifecycleOwner(() => undefined);
    const calls: string[] = [];
    let removeSecond: () => void = () => undefined;
    owner.subscribe(() => {
      calls.push("first");
      removeSecond();
    });
    removeSecond = owner.subscribe(() => calls.push("second"));

    owner.transition({ kind: "context-lost" });
    owner.transition({ kind: "dispose" });
    expect(calls).toEqual(["first", "first"]);
    expect(owner.getSnapshot().phase).toBe("disposed");
    expect(owner.subscribe(() => calls.push("late"))()).toBeUndefined();
  });
});
