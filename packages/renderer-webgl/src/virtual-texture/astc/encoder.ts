/** One cooperative encoder per root; grants never queue behind a running row. */
export class IdleAstcEncoder {
  readonly #worker: Worker;
  #nextId = 0;
  #job: { id: number; grant: boolean; finish: (blocks: Uint8Array | undefined) => void } | undefined;
  failed = false;
  readonly changed: () => void;
  constructor(changed: () => void) {
    this.changed = changed;
    this.#worker = new Worker(new URL("./idle-astc-worker.ts", import.meta.url), { type: "module" });
    this.#worker.onmessage = ({ data }: MessageEvent<{ id: number; type: string; blocks?: Uint8Array }>) => {
      const job = this.#job;
      if (job?.id !== data.id) return;
      if (data.type === "yield") job.grant = true;
      else {
        this.#job = undefined;
        if (data.type === "error") this.failed = true;
        job.finish(data.blocks);
      }
      this.changed();
    };
    this.#worker.onerror = this.#worker.onmessageerror = () => { this.failed = true; this.cancel(); this.changed(); };
  }
  start(bitmap: ImageBitmap, size: number): Promise<Uint8Array | undefined> {
    if (this.failed || this.#job !== undefined) { bitmap.close(); return Promise.resolve(undefined); }
    return new Promise(resolve => {
      const id = ++this.#nextId;
      this.#job = { id, grant: false, finish: resolve };
      try {
        this.#worker.postMessage({ type: "start", id, bitmap, size }, [bitmap]);
      } catch {
        bitmap.close(); this.#job = undefined; this.failed = true;
        resolve(undefined); this.changed();
      }
    });
  }
  grant(): void {
    if (this.#job?.grant !== true) return;
    this.#job.grant = false;
    try { this.#worker.postMessage({ type: "step", id: this.#job.id }); }
    catch { this.failed = true; this.cancel(); this.changed(); }
  }
  cancel(): void {
    const job = this.#job;
    this.#job = undefined;
    if (job !== undefined) {
      try { this.#worker.postMessage({ type: "cancel", id: job.id }); }
      catch { this.failed = true; }
      job.finish(undefined);
    }
  }
  dispose(): void { this.cancel(); this.#worker.terminate(); }
}
