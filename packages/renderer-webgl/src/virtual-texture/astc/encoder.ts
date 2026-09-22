import { workerScriptUrl } from "../../workers/runtime";
import { pool, type Pool } from "workerpool";
import workerUrl from "./idle-astc-worker.ts?worker&url";

/** A single-worker pool preserves codec state; grants never queue behind a row. */
export class IdleAstcEncoder {
  #pool: Pool | undefined;
  #disposed = false;
  #job: { grant: boolean; finish: (blocks: Uint8Array | undefined) => void } | undefined;
  failed = false;
  readonly changed: () => void;
  constructor(changed: () => void) {
    this.changed = changed;
    this.#ensurePool();
  }
  #ensurePool(): Pool {
    return this.#pool ??= pool(workerScriptUrl(workerUrl), {
      minWorkers: 1, maxWorkers: 1, workerType: "web", workerOpts: { type: "module", name: "royal-idle-astc" },
    });
  }
  start(bitmap: ImageBitmap, size: number): Promise<Uint8Array | undefined> {
    if (this.#disposed || this.failed || this.#job !== undefined) { bitmap.close(); return Promise.resolve(undefined); }
    return new Promise(resolve => {
      const job = { grant: false, finish: resolve };
      this.#job = job;
      try {
        void this.#ensurePool().exec("start", [bitmap, size], { transfer: [bitmap] }).then(() => {
          if (this.#job !== job) return;
          job.grant = true;
          this.changed();
        }, () => {
          // close() is harmless after transfer, and needed if startup/send failed.
          bitmap.close();
          if (this.#job !== job) return;
          this.failed = true; this.cancel(); this.changed();
        });
      } catch {
        bitmap.close(); this.failed = true; this.cancel(); this.changed();
      }
    });
  }
  grant(): void {
    const job = this.#job;
    if (job?.grant !== true) return;
    job.grant = false;
    try {
      void this.#ensurePool().exec("step").then((blocks: Uint8Array | undefined) => {
        if (this.#job !== job) return;
        if (blocks === undefined) job.grant = true;
        else { this.#job = undefined; job.finish(blocks); }
        this.changed();
      }, () => {
        if (this.#job !== job) return;
        this.failed = true; this.cancel(); this.changed();
      });
    } catch { this.failed = true; this.cancel(); this.changed(); }
  }
  cancel(): void {
    const job = this.#job;
    this.#job = undefined;
    if (job === undefined) return;
    // Termination also interrupts a hung codec initialization and discards state.
    this.#retire();
    job.finish(undefined);
  }
  #retire(): void {
    const workers = this.#pool;
    this.#pool = undefined;
    if (workers !== undefined) void workers.terminate(true).catch(() => undefined);
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancel();
    this.#retire();
  }
}
