import { describe, expect, it } from "vitest";
import { RetainedFifo } from "../../packages/renderer-webgl/src/resource/retained-fifo";
import { assertFuzzEqual, forEachFuzzCase } from "../fuzz";

describe("retained FIFO", () => {
  it("matches a readable queue across seeded enqueue, dequeue, peek, and clear sequences", () => {
    forEachFuzzCase({ cases: 32, seed: 0xf1_f0_2026 }, ({ random }) => {
      const queue = new RetainedFifo<number>();
      const oracle: number[] = [];
      let next = 0;
      for (; next < 512; next += 1) {
        queue.enqueue(next);
        oracle.push(next);
      }
      for (let prefix = 0; prefix < 256; prefix += 1) {
        assertFuzzEqual(queue.dequeue(), oracle.shift(), "compacted prefix order");
      }
      for (let step = 0; step < 1_024; step += 1) {
        const operation = random.int(0, 20);
        if (operation < 11) {
          queue.enqueue(next);
          oracle.push(next);
          next += 1;
        } else if (operation < 17) {
          assertFuzzEqual(queue.dequeue(), oracle.shift(), "dequeue order");
        } else if (operation < 19) {
          assertFuzzEqual(queue.peek(), oracle[0], "peek value");
        } else {
          queue.clear();
          oracle.length = 0;
        }
      }
      while (oracle.length > 0) {
        assertFuzzEqual(queue.dequeue(), oracle.shift(), "terminal drain order");
      }
      assertFuzzEqual(queue.dequeue(), undefined, "empty terminal dequeue");
    });
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
