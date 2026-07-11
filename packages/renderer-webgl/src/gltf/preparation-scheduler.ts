import { abortError, throwIfAborted } from "./io";

type Admission<JobResult> = {
  index: number;
  job: (() => Promise<JobResult> | JobResult) | undefined;
  readonly onAbort: () => void;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: JobResult) => void;
  readonly signal: AbortSignal;
};

/** Browser-shell admission control for CPU-heavy codec and scene preparation. */
export class GltfPreparationScheduler {
  readonly #limit: number;
  readonly #queue: Array<Admission<unknown> | undefined> = [];
  #queueHead = 0;
  #active = 0;
  #disposed = false;
  #queued = 0;
  #queueHighWater = 0;

  constructor(limit = 2) {
    this.#limit = Math.max(1, Math.floor(limit));
  }

  run<Result>(signal: AbortSignal, job: () => Promise<Result> | Result): Promise<Result> {
    throwIfAborted(signal);
    if (this.#disposed) return Promise.reject(abortError());
    if (this.#active < this.#limit && this.#queueHead >= this.#queue.length) {
      this.#active += 1;
      let result: Promise<Result>;
      try {
        result = Promise.resolve(job());
      } catch (error) {
        this.#finish();
        return Promise.reject(error);
      }
      void result.then(() => this.#finish(), () => this.#finish());
      return result;
    }
    return new Promise<Result>((resolve, reject) => {
      let admission!: Admission<Result>;
      const onAbort = (): void => {
        const index = admission.index;
        if (index < this.#queueHead || this.#queue[index] !== admission) return;
        this.#queue[index] = undefined;
        admission.index = -1;
        admission.job = undefined;
        this.#queued = Math.max(0, this.#queued - 1);
        signal.removeEventListener("abort", onAbort);
        reject(abortError());
        this.#trimQueueTail();
      };
      admission = {
        index: this.#queue.length,
        job,
        onAbort,
        reject,
        resolve,
        signal,
      };
      this.#queue.push(admission as Admission<unknown>);
      this.#queued += 1;
      this.#queueHighWater = Math.max(this.#queueHighWater, this.#queued);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      this.#pump();
    });
  }

  dispose(): void {
    this.#disposed = true;
    while (this.#queueHead < this.#queue.length) {
      const admission = this.#queue[this.#queueHead];
      this.#queueHead += 1;
      if (admission === undefined) continue;
      admission.signal.removeEventListener("abort", admission.onAbort);
      admission.index = -1;
      admission.job = undefined;
      this.#queued = Math.max(0, this.#queued - 1);
      admission.reject(abortError());
    }
    this.#queue.length = 0;
    this.#queueHead = 0;
  }

  snapshot(): { readonly active: number; readonly queued: number; readonly queueHighWater: number } {
    return { active: this.#active, queued: this.#queued, queueHighWater: this.#queueHighWater };
  }

  #pump(): void {
    while (!this.#disposed && this.#active < this.#limit) {
      if (this.#queueHead >= this.#queue.length) return;
      const admission = this.#queue[this.#queueHead];
      this.#queueHead += 1;
      if (admission === undefined) continue;
      admission.signal.removeEventListener("abort", admission.onAbort);
      this.#queued = Math.max(0, this.#queued - 1);
      admission.index = -1;
      const job = admission.job;
      admission.job = undefined;
      if (job === undefined) continue;
      if (admission.signal.aborted) {
        admission.reject(abortError());
        continue;
      }
      this.#active += 1;
      let result: unknown;
      try {
        result = job();
      } catch (error) {
        admission.reject(error);
        this.#finish();
        continue;
      }
      void Promise.resolve(result).then(admission.resolve, admission.reject).finally(() => this.#finish());
    }
  }

  #finish(): void {
    this.#active = Math.max(0, this.#active - 1);
    // Only queued overflow yields. Isolated loads retain their former latency,
    // while request waves cannot chain every CPU decode in one task.
    if (this.#queueHead < this.#queue.length) setTimeout(() => this.#pump(), 0);
    else {
      this.#queue.length = 0;
      this.#queueHead = 0;
    }
  }

  #trimQueueTail(): void {
    while (
      this.#queue.length > this.#queueHead
      && this.#queue[this.#queue.length - 1] === undefined
    ) {
      this.#queue.pop();
    }
    if (this.#queueHead < this.#queue.length) return;
    this.#queue.length = 0;
    this.#queueHead = 0;
  }
}
