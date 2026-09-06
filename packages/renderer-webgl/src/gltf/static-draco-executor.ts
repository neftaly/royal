import { gltfCodecUrls } from "./codec-loader";
import type {
  StaticDracoDecodedTask,
  StaticDracoDecodeTask,
  StaticDracoTaskExecutor,
} from "./draco";

export type StaticDracoDecodeWorkerResult = Readonly<{
  error?: string;
  kind: "decode-draco-error" | "decode-draco-ready";
  results?: readonly StaticDracoDecodedTask[];
}>;

export const decodedDracoTaskTransferBuffers = (
  results: readonly StaticDracoDecodedTask[],
): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>();
  for (const result of results) {
    if (result.indices.buffer instanceof ArrayBuffer) buffers.add(result.indices.buffer);
    for (const attribute of result.attributes) {
      if (attribute.values.buffer instanceof ArrayBuffer) buffers.add(attribute.values.buffer);
    }
  }
  return [...buffers];
};

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

export type StaticDracoDecodeWorkerFactory = () => Worker;

const defaultWorker = (): Worker => new Worker(
  new URL("./static-preparation-worker.ts", import.meta.url),
  { name: "royal-draco-decode", type: "module" },
);

/** Bounded two-worker codec shell; task/result bytes cross only by transfer. */
export const executeDracoTasksInWorkers = async (
  tasks: readonly StaticDracoDecodeTask[],
  createWorker: StaticDracoDecodeWorkerFactory | undefined = typeof Worker === "function"
    ? defaultWorker
    : undefined,
): Promise<readonly StaticDracoDecodedTask[]> => {
  if (tasks.length < 2 || createWorker === undefined) return executeDracoTasksSerially(tasks);
  const workerCount = Math.min(2, tasks.length);
  const workers: Worker[] = [];
  try {
    for (let index = 0; index < workerCount; index += 1) workers.push(createWorker());
  } catch {
    for (const worker of workers) worker.terminate();
    return executeDracoTasksSerially(tasks);
  }
  const buckets = planStaticDracoTaskBuckets(tasks, workerCount);
  try {
    const batches = await Promise.all(workers.map((worker, index) =>
      new Promise<readonly StaticDracoDecodedTask[]>((resolve, reject) => {
        worker.addEventListener("error", (event) => {
          reject(new Error(event.message || "Royal Draco decode worker failed"));
        }, { once: true });
        worker.addEventListener("message", (event: MessageEvent<StaticDracoDecodeWorkerResult>) => {
          if (event.data.kind === "decode-draco-error") reject(new Error(event.data.error));
          else resolve(event.data.results ?? []);
        }, { once: true });
        const owned = buckets[index]!.map((task) => ({ ...task, bytes: task.bytes.slice() }));
        worker.postMessage(
          { codecs: gltfCodecUrls(), kind: "decode-draco-tasks", tasks: owned },
          owned.map((task) => task.bytes.buffer),
        );
      })));
    return batches.flat();
  } finally {
    for (const worker of workers) worker.terminate();
  }
};
