import { describe, expect, it, vi } from "vitest";
import type { StaticDracoDecodeTask } from "../../packages/renderer-webgl/src/gltf/draco";
import {
  executeDracoTasksInWorkers,
  planStaticDracoTaskBuckets,
} from "../../packages/renderer-webgl/src/gltf/static-draco-executor";

const task = (path: string, bytes: number): StaticDracoDecodeTask => ({
  attributes: [],
  bytes: new Uint8Array(bytes),
  label: "scene.gltf",
  path,
});

class FakeDecodeWorker extends EventTarget {
  readonly postMessage = vi.fn((message: Readonly<{
    tasks: readonly StaticDracoDecodeTask[];
  }>) => {
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
      data: {
        kind: "decode-draco-ready",
        results: message.tasks.map((item) => ({
          attributes: [],
          indices: new Uint16Array([0, 1, 2]),
          path: item.path,
        })),
      },
    })));
  });
  readonly terminate = vi.fn();
}

describe("static Draco worker executor", () => {
  it("balances largest tasks without mutating source order", () => {
    const tasks = [task("small", 1), task("large", 9), task("medium", 5)];
    const buckets = planStaticDracoTaskBuckets(tasks, 2);
    expect(tasks.map((item) => item.path)).toEqual(["small", "large", "medium"]);
    expect(buckets.map((bucket) => bucket.map((item) => item.path)))
      .toEqual([["large"], ["medium", "small"]]);
  });

  it("copies compressed slices, joins results, and terminates both workers", async () => {
    const workers = [new FakeDecodeWorker(), new FakeDecodeWorker()];
    let nextWorker = 0;
    const tasks = [task("a", 8), task("b", 4), task("c", 2)];
    const sourceBuffers = tasks.map((item) => item.bytes.buffer);
    const results = await executeDracoTasksInWorkers(
      tasks,
      () => workers[nextWorker++]! as unknown as Worker,
    );

    for (const worker of workers) {
      expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        codecs: expect.objectContaining({
          draco: expect.stringContaining("draco-codec"),
          meshopt: expect.stringContaining("meshopt-codec"),
        }),
      }), expect.any(Array));
    }
    expect(new Set(results.map((result) => result.path))).toEqual(new Set(["a", "b", "c"]));
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    const postedBuffers = workers.flatMap((worker) =>
      worker.postMessage.mock.calls.flatMap(([message]) =>
        message.tasks.map((item: StaticDracoDecodeTask) => item.bytes.buffer)));
    expect(postedBuffers.every((buffer) => !sourceBuffers.includes(buffer))).toBe(true);
    expect(tasks.map((item) => item.bytes.byteLength)).toEqual([8, 4, 2]);
  });
});
