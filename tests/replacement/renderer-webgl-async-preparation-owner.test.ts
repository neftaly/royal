import { describe, expect, it, vi } from "vitest";
import { waitFor } from "./support/wait-for";
import {
  AsyncPreparationOwner,
  selectAsyncPreparationLane,
} from "../../packages/renderer-webgl/src/resource/async-preparation-owner";

describe("asynchronous preparation owner", () => {
  it.each(["detail", "foreground"])("preserves live %s queue work ahead of a cancelled tail", async lane => {
    const owner = new AsyncPreparationOwner(1);
    let finish!: () => void;
    const active = owner.runForeground(new AbortController().signal, () => new Promise<void>(resolve => { finish = resolve; }));
    const run = lane === "detail" ? owner.run : owner.runForeground;
    const prepare = vi.fn(async () => 42), cancelled = vi.fn(async () => 0);
    const live = run(new AbortController().signal, prepare);
    const controller = new AbortController();
    const tail = run(controller.signal, cancelled);
    try {
      const rejected = expect(tail).rejects.toMatchObject({ name: "AbortError" });
      controller.abort(); await rejected;
      expect(owner.snapshot()).toMatchObject({ activeJobs: 1, queuedJobs: 1 });
      expect(prepare).not.toHaveBeenCalled();
      finish(); await active;
      await expect(live).resolves.toBe(42);
      expect(prepare).toHaveBeenCalledOnce();
      expect(cancelled).not.toHaveBeenCalled();
      expect(owner.snapshot()).toMatchObject({ activeJobs: 0, queuedJobs: 0 });
    } finally { owner.dispose(); finish(); await active; }
  });

  it.each(["detail", "foreground"])("releases cancelled %s queue entries while capacity stays full", async lane => {
    const owner = new AsyncPreparationOwner(1);
    let finish!: () => void;
    const active = owner.runForeground(new AbortController().signal, () => new Promise<void>(resolve => { finish = resolve; }));
    const prepare = vi.fn(async () => undefined);
    try {
      for (let index = 0; index < 100; index++) {
        const controller = new AbortController();
        const queued = (lane === "detail" ? owner.run : owner.runForeground)(controller.signal, prepare);
        const rejected = expect(queued).rejects.toMatchObject({ name: "AbortError" });
        controller.abort();
        await rejected;
      }
      expect(owner.snapshot()).toMatchObject({ activeJobs: 1, queuedJobs: 0 });
      expect(prepare).not.toHaveBeenCalled();
    } finally { owner.dispose(); finish(); await active; }
  });

  it.each(["foreground", "detail"])("unlinks arbitrary %s jobs while preserving FIFO order", async lane => {
    const owner = new AsyncPreparationOwner(1);
    let finish!: () => void;
    const active = owner.runForeground(new AbortController().signal, () => new Promise<void>(resolve => { finish = resolve; }));
    const starts: number[] = [], controllers = Array.from({ length: 100 }, () => new AbortController());
    const run = lane === "detail" ? owner.run : owner.runForeground;
    const jobs = controllers.map((controller, index) => run(controller.signal, async () => { starts.push(index); }).catch(error => {
      expect(error.name).toBe("AbortError");
    }));
    try {
      // Tail, interior and head removals in reverse order; repeated aborts are harmless.
      for (let index = 99; index >= 0; index -= 3) { controllers[index]!.abort(); controllers[index]!.abort(); }
      expect(owner.snapshot()).toMatchObject({ queuedJobs: 66, activeJobs: 1 });
      expect(starts).toEqual([]);
      finish(); await active; await Promise.all(jobs);
      expect(starts).toEqual(Array.from({ length: 100 }, (_, index) => index).filter(index => index % 3 !== 0));
      expect(owner.snapshot()).toMatchObject({ queuedJobs: 0, activeJobs: 0 });
    } finally { owner.dispose(); finish(); await active; }
  });

  it("starts a bounded FIFO prefix and admits the next job after settlement", async () => {
    const onChanged = vi.fn();
    const owner = new AsyncPreparationOwner(2, onChanged);
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const starts: number[] = [];
    const finishes: Array<() => void> = [];
    const jobs = controllers.map((controller, index) => owner.runForeground(controller.signal, () => {
      starts.push(index);
      return new Promise<number>((resolve) => finishes.push(() => resolve(index)));
    }));

    await waitFor(() => expect(starts).toEqual([0, 1]));
    expect(owner.snapshot()).toEqual({
      activeJobs: 2,
      jobLimit: 2,
      queuedDetailJobs: 0,
      queuedForegroundJobs: 1,
      queuedJobs: 1,
    });
    finishes[0]!();
    await waitFor(() => expect(starts).toEqual([0, 1, 2]));
    finishes[1]!();
    finishes[2]!();
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2]);
    expect(owner.snapshot()).toEqual({
      activeJobs: 0,
      jobLimit: 2,
      queuedDetailJobs: 0,
      queuedForegroundJobs: 0,
      queuedJobs: 0,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("reserves foreground capacity while serializing heavy detail", async () => {
    const owner = new AsyncPreparationOwner(2);
    const starts: string[] = [];
    let finish!: () => void;
    const first = owner.run(new AbortController().signal, () => {
      starts.push("first");
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const controller = new AbortController();
    const second = owner.run(controller.signal, async () => { starts.push("cancelled"); });
    const foreground = owner.runForeground(new AbortController().signal, async () => { starts.push("scene"); });
    await foreground;
    expect(starts).toEqual(["first", "scene"]);
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    finish();
    await first;
    expect(starts).toEqual(["first", "scene"]);
    expect(owner.snapshot()).toMatchObject({ activeJobs: 0, queuedJobs: 0 });
    owner.dispose();
  });

  it("releases queued aborted work without starting it", async () => {
    const owner = new AsyncPreparationOwner(1);
    const firstController = new AbortController();
    const secondController = new AbortController();
    let finishFirst: (() => void) | undefined;
    const first = owner.run(firstController.signal, () => new Promise<void>((resolve) => {
      finishFirst = resolve;
    }));
    const secondWork = vi.fn(async () => undefined);
    const second = owner.run(secondController.signal, secondWork);
    await waitFor(() => expect(owner.snapshot().activeJobs).toBe(1));
    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(secondWork).not.toHaveBeenCalled();
    expect(owner.snapshot().queuedJobs).toBe(0);
    finishFirst?.();
    await first;
  });

  it("rejects queued work on disposal but lets active ownership settle", async () => {
    const owner = new AsyncPreparationOwner(1);
    const firstController = new AbortController();
    const secondController = new AbortController();
    let finishFirst: (() => void) | undefined;
    const first = owner.run(firstController.signal, () => new Promise<void>((resolve) => {
      finishFirst = resolve;
    }));
    const second = owner.run(secondController.signal, async () => undefined);
    await waitFor(() => expect(owner.snapshot()).toMatchObject({ activeJobs: 1, queuedJobs: 1 }));
    owner.dispose();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    finishFirst?.();
    await first;
    expect(owner.snapshot()).toEqual({
      activeJobs: 0,
      jobLimit: 1,
      queuedDetailJobs: 0,
      queuedForegroundJobs: 0,
      queuedJobs: 0,
    });
    await expect(owner.run(new AbortController().signal, async () => undefined))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("starts newly claimed foreground work before an existing detail backlog", async () => {
    const owner = new AsyncPreparationOwner(1);
    const starts: string[] = [];
    const finishes = new Map<string, () => void>();
    const start = (name: string, foreground = false): Promise<string> => {
      const run = foreground ? owner.runForeground : owner.run;
      return run(new AbortController().signal, () => {
        starts.push(name);
        return new Promise<string>((resolve) => finishes.set(name, () => resolve(name)));
      });
    };
    const jobs = [start("detail-0"), start("detail-1"), start("detail-2"), start("scene", true)];
    await waitFor(() => expect(starts).toEqual(["detail-0"]));
    expect(owner.snapshot()).toMatchObject({
      queuedDetailJobs: 2,
      queuedForegroundJobs: 1,
    });
    finishes.get("detail-0")!();
    await waitFor(() => expect(starts).toEqual(["detail-0", "scene"]));
    finishes.get("scene")!();
    await waitFor(() => expect(starts).toEqual(["detail-0", "scene", "detail-1"]));
    finishes.get("detail-1")!();
    await waitFor(() => expect(starts).toEqual(["detail-0", "scene", "detail-1", "detail-2"]));
    finishes.get("detail-2")!();
    await expect(Promise.all(jobs)).resolves.toEqual([
      "detail-0",
      "detail-1",
      "detail-2",
      "scene",
    ]);
  });

  it("bounds foreground bursts while detail work remains queued", () => {
    expect(selectAsyncPreparationLane(1, 0, 4)).toEqual({
      foregroundBurst: 0,
      lane: "foreground",
    });
    let detailQueued = 2;
    let foregroundBurst = 0;
    let foregroundQueued = 10;
    const lanes: string[] = [];
    while (detailQueued + foregroundQueued > 0) {
      const selection = selectAsyncPreparationLane(
        foregroundQueued,
        detailQueued,
        foregroundBurst,
      )!;
      lanes.push(selection.lane);
      foregroundBurst = selection.foregroundBurst;
      if (selection.lane === "foreground") foregroundQueued -= 1;
      else detailQueued -= 1;
    }
    expect(lanes.slice(0, 10)).toEqual([
      "foreground",
      "foreground",
      "foreground",
      "foreground",
      "detail",
      "foreground",
      "foreground",
      "foreground",
      "foreground",
      "detail",
    ]);
  });
});
