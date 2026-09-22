import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as draco from "../../packages/renderer-webgl/src/gltf/draco";
import { StaticDracoWorkerOwner, planStaticDracoTaskBuckets, DRACO_COLD_PARALLEL_BYTES, DRACO_WARM_PARALLEL_BYTES } from "../../packages/renderer-webgl/src/gltf/static-draco-executor";
import { PoolWorker } from "./support/pool-worker";

const task = (path: string, bytes: number): draco.StaticDracoDecodeTask => ({ attributes: [], bytes: new Uint8Array(bytes), label: "scene.gltf", path });
const result = (path: string) => ({ attributes: [], indices: new Uint16Array([0, 1, 2]), path });
beforeEach(() => {
  PoolWorker.instances = [];
  vi.stubGlobal("Worker", PoolWorker);
  PoolWorker.execute = (worker, message) => queueMicrotask(() => worker.reply(message, message.params[1].map((item: draco.StaticDracoDecodeTask) => result(item.path))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("static Draco worker executor", () => {
  it("balances largest tasks without mutating source order", () => {
    const tasks = [task("small", 1), task("large", 9), task("medium", 5)];
    expect(planStaticDracoTaskBuckets(tasks, 2).map(bucket => bucket.map(item => item.path))).toEqual([["large"], ["medium", "small"]]);
    expect(tasks.map(item => item.path)).toEqual(["small", "large", "medium"]);
  });
  it("copies slices and reuses exactly two workers across large and warm batches", async () => {
    const owner = new StaticDracoWorkerOwner();
    const tasks = [task("a", DRACO_COLD_PARALLEL_BYTES / 2), task("b", DRACO_COLD_PARALLEL_BYTES / 2)];
    const buffers = tasks.map(item => item.bytes.buffer);
    try {
      await expect(owner.execute(tasks)).resolves.toHaveLength(2);
      await expect(owner.execute([task("c", DRACO_WARM_PARALLEL_BYTES / 2), task("d", DRACO_WARM_PARALLEL_BYTES / 2)])).resolves.toHaveLength(2);
      expect(PoolWorker.instances).toHaveLength(2);
      expect(PoolWorker.instances.every(worker => worker.requests.length === 2 && worker.terminate.mock.calls.length === 0)).toBe(true);
      const sent = PoolWorker.instances.flatMap(worker => worker.requests[0]!.params[1].map((item: draco.StaticDracoDecodeTask) => item.bytes.buffer));
      expect(sent.every(buffer => !buffers.includes(buffer))).toBe(true);
      expect(tasks.map(item => item.bytes.byteLength)).toEqual([DRACO_COLD_PARALLEL_BYTES / 2, DRACO_COLD_PARALLEL_BYTES / 2]);
    } finally { await owner.dispose(); }
    expect(PoolWorker.instances.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
    await owner.dispose();
    await expect(owner.execute(tasks)).rejects.toThrow("disposed");
  });
  it("decodes small cold batches locally without creating a pool", async () => {
    const serial = vi.spyOn(draco, "executeStaticDracoTasksSerially").mockResolvedValue([result("a"), result("b")]);
    const owner = new StaticDracoWorkerOwner();
    const tasks = [task("a", DRACO_COLD_PARALLEL_BYTES / 2), task("b", DRACO_COLD_PARALLEL_BYTES / 2 - 1)];
    try { await owner.execute(tasks); expect(serial).toHaveBeenCalledWith(tasks); expect(PoolWorker.instances).toHaveLength(0); }
    finally { await owner.dispose(); }
  });
  it("terminates partial startup and can recover on another asset", async () => {
    let blocked = true;
    vi.stubGlobal("Worker", class extends PoolWorker {
      constructor() { if (blocked && PoolWorker.instances.length === 1) throw new Error("second worker blocked"); super(); }
    });
    const owner = new StaticDracoWorkerOwner();
    const tasks = [task("a", DRACO_COLD_PARALLEL_BYTES), task("b", DRACO_COLD_PARALLEL_BYTES)];
    try {
      await expect(owner.execute(tasks)).rejects.toThrow("second worker blocked");
      expect(PoolWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
      blocked = false;
      await expect(owner.execute(tasks)).resolves.toHaveLength(2);
    } finally { await owner.dispose(); }
    expect(PoolWorker.instances.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
});

it("does not spawn a second lane for a tiny companion to one large task", async () => {
  const serial = vi.spyOn(draco, "executeStaticDracoTasksSerially").mockResolvedValue([result("large"), result("small")]);
  const owner = new StaticDracoWorkerOwner();
  const tasks = [task("large", DRACO_COLD_PARALLEL_BYTES * 2), task("small", 1)];
  try {
    await owner.execute(tasks);
    expect(serial).toHaveBeenCalledWith(tasks);
    expect(PoolWorker.instances).toHaveLength(0);
  } finally { await owner.dispose(); }
});
