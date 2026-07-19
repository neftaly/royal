import { describe, expect, it, vi } from "vitest";
import { AsyncPreparationOwner } from "../../packages/renderer-webgl/src/resource/async-preparation-owner";

describe("asynchronous preparation owner", () => {
  it("starts a bounded FIFO prefix and admits the next job after settlement", async () => {
    const onChanged = vi.fn();
    const owner = new AsyncPreparationOwner(2, onChanged);
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const starts: number[] = [];
    const finishes: Array<() => void> = [];
    const jobs = controllers.map((controller, index) => owner.run(controller.signal, () => {
      starts.push(index);
      return new Promise<number>((resolve) => finishes.push(() => resolve(index)));
    }));

    await vi.waitFor(() => expect(starts).toEqual([0, 1]));
    expect(owner.snapshot()).toEqual({ activeJobs: 2, jobLimit: 2, queuedJobs: 1 });
    finishes[0]!();
    await vi.waitFor(() => expect(starts).toEqual([0, 1, 2]));
    finishes[1]!();
    finishes[2]!();
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2]);
    expect(owner.snapshot()).toEqual({ activeJobs: 0, jobLimit: 2, queuedJobs: 0 });
    expect(onChanged).toHaveBeenCalled();
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
    await vi.waitFor(() => expect(owner.snapshot().activeJobs).toBe(1));
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
    await vi.waitFor(() => expect(owner.snapshot()).toMatchObject({ activeJobs: 1, queuedJobs: 1 }));
    owner.dispose();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    finishFirst?.();
    await first;
    expect(owner.snapshot()).toEqual({ activeJobs: 0, jobLimit: 1, queuedJobs: 0 });
    await expect(owner.run(new AbortController().signal, async () => undefined))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
