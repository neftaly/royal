import { describe, expect, it } from "vitest";
import { RetainedFifo } from "../../packages/renderer-webgl/src/resource/retained-fifo";

describe("retained FIFO", () => {
  it("preserves order across amortized compaction and later enqueue", () => {
    const queue = new RetainedFifo<number>();
    for (let value = 0; value < 1_024; value += 1) queue.enqueue(value);
    for (let value = 0; value < 768; value += 1) expect(queue.dequeue()).toBe(value);
    for (let value = 1_024; value < 1_280; value += 1) queue.enqueue(value);
    for (let value = 768; value < 1_280; value += 1) expect(queue.dequeue()).toBe(value);
    expect(queue.dequeue()).toBeUndefined();
  });

  it("can discard queued references and be reused", () => {
    const queue = new RetainedFifo<object>();
    queue.enqueue({ value: 1 });
    queue.enqueue({ value: 2 });
    queue.clear();
    expect(queue.dequeue()).toBeUndefined();
    const retained = { value: 3 };
    queue.enqueue(retained);
    expect(queue.peek()).toBe(retained);
    expect(queue.dequeue()).toBe(retained);
    expect(queue.peek()).toBeUndefined();
  });
});
