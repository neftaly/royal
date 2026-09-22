import { workerScriptUrl } from "../workers/runtime";
import { pool, type Pool } from "workerpool";
import workerUrl from "./draco-worker.ts?worker&url";
import { gltfCodecUrls } from "./codec-loader";
import type {
  StaticDracoDecodedTask,
  StaticDracoDecodeTask,
  StaticDracoTaskExecutor,
} from "./draco";

export const executeDracoTasksSerially: StaticDracoTaskExecutor = async (tasks) => {
  const { executeStaticDracoTasksSerially } = await import("./draco");
  return executeStaticDracoTasksSerially(tasks);
};

/** Largest-first byte balancing without mutating authored task order. */
export const planStaticDracoTaskBuckets = (
  tasks: readonly StaticDracoDecodeTask[],
  workerCount: number,
): readonly (readonly StaticDracoDecodeTask[])[] => {
  if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
    throw new RangeError("Royal Draco worker count must be a positive safe integer");
  }
  const buckets = Array.from({ length: workerCount }, () => [] as StaticDracoDecodeTask[]);
  const byteTotals = new Float64Array(workerCount);
  const ordered = [...tasks].sort((left, right) => right.bytes.byteLength - left.bytes.byteLength);
  for (const task of ordered) {
    let selected = 0;
    for (let index = 1; index < workerCount; index += 1) {
      if (byteTotals[index]! < byteTotals[selected]!) selected = index;
    }
    buckets[selected]!.push(task);
    byteTotals[selected] = byteTotals[selected]! + task.bytes.byteLength;
  }
  return buckets;
};

// Cold startup must earn back two workers and two codec initializations.
// Once warm, smaller batches can benefit from parallel decoding.
export const DRACO_COLD_PARALLEL_BYTES = 512 * 1024;
export const DRACO_WARM_PARALLEL_BYTES = 64 * 1024;

/** One reusable codec pool per preparation worker, retired with its parent. */
export class StaticDracoWorkerOwner {
  #pool: Pool | undefined;
  #disposed = false;

  async execute(tasks: readonly StaticDracoDecodeTask[]): Promise<readonly StaticDracoDecodedTask[]> {
    if (this.#disposed) throw new Error("Royal Draco worker owner is disposed");
    const bytes = tasks.reduce((total, task) => total + task.bytes.byteLength, 0);
    const threshold = this.#pool === undefined ? DRACO_COLD_PARALLEL_BYTES : DRACO_WARM_PARALLEL_BYTES;
    if (tasks.length < 2 || bytes < threshold || typeof Worker !== "function") return executeDracoTasksSerially(tasks);
    const buckets = planStaticDracoTaskBuckets(tasks, 2);
    // A large total does not justify startup when only one lane has real work.
    if (buckets.some(bucket => bucket.reduce((total, task) => total + task.bytes.byteLength, 0) < threshold / 2)) {
      return executeDracoTasksSerially(tasks);
    }
    const workers = this.#pool ??= pool(workerScriptUrl(workerUrl), {
      maxWorkers: 2, workerType: "web", workerOpts: { type: "module", name: "royal-draco-decode" },
    });
    try {
      const batches = await Promise.all(buckets.map(async bucket => {
        const owned = bucket.map(task => ({ ...task, bytes: task.bytes.slice() }));
        return workers.exec("decodeDraco", [gltfCodecUrls(), owned], { transfer: owned.map(task => task.bytes.buffer) });
      }));
      return batches.flat();
    } catch (error) {
      // Do not carry a partially failed batch into another asset's work.
      this.#pool = undefined;
      await workers.terminate(true);
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const workers = this.#pool;
    this.#pool = undefined;
    await workers?.terminate(true);
  }
}
