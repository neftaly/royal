import { workerScriptUrl } from "../workers/runtime";
import type { Pool } from "workerpool";
import workerUrl from "./inspection-reduction-worker.ts?worker&url";
import type { InspectionReadbackSource } from "./inspection-readback";
import type { InspectionReduction, InspectionRgba } from "./inspection-rgba";

/** Includes module loading and queue time, before the consumer classifier is called. */
export const INSPECTION_WORKER_TIMEOUT_MS = 15_000;
const aborted = () => new DOMException("Texture inspection was aborted", "AbortError");

/** Only inspection uses this pool. One task owns the worker and its transferred pixels. */
export class InspectionReductionWorker {
  #pool: Pool | undefined;
  #disposed = false;

  async #getPool(): Promise<Pool> {
    const { pool } = await import("workerpool");
    if (this.#disposed) throw aborted();
    return this.#pool ??= pool(workerScriptUrl(workerUrl), {
      workerType: "web",
      workerOpts: { type: "module" },
      maxWorkers: 1,
      workerTerminateTimeout: 1,
    });
  }

  reduce(input: InspectionRgba, signal?: AbortSignal): Promise<InspectionReduction> {
    return this.#run("reduce", [input], [input.rgba.buffer], signal);
  }

  sample(input: InspectionReadbackSource, dimensions: Omit<InspectionRgba, "rgba">, transfer: Transferable[], signal?: AbortSignal): Promise<InspectionReduction | undefined> {
    return this.#run("sample", [input, dimensions], transfer, signal);
  }

  async #run<T>(method: string, params: unknown[], transfer: Transferable[], signal?: AbortSignal): Promise<T> {
    if (this.#disposed || signal?.aborted) throw aborted();
    const pool = await this.#getPool();
    if (this.#disposed || signal?.aborted) throw aborted();
    const task = pool.exec<(...args: unknown[]) => T>(method, params, { transfer });
    const cancel = () => { task.cancel(); };
    let timedOut = false;
    // workerpool's timeout starts on execution; this deadline also covers a
    // queued request and a worker module that never registers its methods.
    const timer = setTimeout(() => { timedOut = true; task.cancel(); }, INSPECTION_WORKER_TIMEOUT_MS);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await task;
      if (this.#disposed || signal?.aborted) throw aborted();
      return result;
    } catch (error) {
      if (this.#disposed || signal?.aborted) throw aborted();
      if (timedOut) throw new Error("Royal texture inspection worker timed out");
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    void this.#pool?.terminate(true).catch(() => undefined);
  }
}
