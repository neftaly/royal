import { abortError, throwIfAborted } from "./io";

type Admission<JobResult> = {
  index: number;
  job: (() => Promise<JobResult> | JobResult) | undefined;
  readonly onAbort: () => void;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: JobResult) => void;
  readonly signal: AbortSignal;
};

export interface GltfPreparationJobAdmission {
  /** Releases this active job's global capacity. Called exactly once. */
  release(): void;
}

export type GltfPreparationJobAdmitter = () => GltfPreparationJobAdmission | undefined;

/** Browser-shell admission control for CPU-heavy codec and scene preparation. */
export class GltfPreparationScheduler {
  readonly #admit: GltfPreparationJobAdmitter | undefined;
  readonly #limit: number;
  readonly #queue: Array<Admission<unknown> | undefined> = [];
  #queueHead = 0;
  #active = 0;
  #disposed = false;
  #pumping = false;
  #queued = 0;
  #queueHighWater = 0;

  constructor(limit = 2, admit?: GltfPreparationJobAdmitter) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError(`glTF preparation concurrency must be a positive safe integer, received ${limit}`);
    }
    this.#limit = limit;
    this.#admit = admit;
  }

  run<Result>(signal: AbortSignal, job: () => Promise<Result> | Result): Promise<Result> {
    throwIfAborted(signal);
    if (this.#disposed) return Promise.reject(abortError());
    const canStartImmediately = this.#active < this.#limit && this.#queueHead >= this.#queue.length;
    let immediateAdmission: GltfPreparationJobAdmission | undefined;
    try {
      immediateAdmission = canStartImmediately ? this.#admit?.() : undefined;
    } catch (error) {
      return Promise.reject(error);
    }
    if (canStartImmediately && (this.#admit === undefined || immediateAdmission !== undefined)) {
      // Admission is an external callback and may abort or dispose reentrantly.
      if (signal.aborted || this.#disposed) {
        immediateAdmission?.release();
        return Promise.reject(abortError());
      }
      this.#active += 1;
      let result: Promise<Result>;
      try {
        result = Promise.resolve(job());
      } catch (error) {
        this.#finish(immediateAdmission);
        return Promise.reject(error);
      }
      void result.then(
        () => this.#finish(immediateAdmission),
        () => this.#finish(immediateAdmission),
      );
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

  /** Retries queued work after capacity owned by another scheduler is released. */
  wake(): void {
    this.#pump();
  }

  #pump(): void {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      this.#pumpLoop();
    } finally {
      this.#pumping = false;
    }
  }

  #pumpLoop(): void {
    while (!this.#disposed && this.#active < this.#limit) {
      if (this.#queueHead >= this.#queue.length) return;
      const admission = this.#queue[this.#queueHead];
      if (admission === undefined) {
        this.#queueHead += 1;
        continue;
      }
      if (admission.signal.aborted) {
        this.#queueHead += 1;
        admission.signal.removeEventListener("abort", admission.onAbort);
        admission.index = -1;
        admission.job = undefined;
        this.#queued = Math.max(0, this.#queued - 1);
        admission.reject(abortError());
        continue;
      }
      let jobAdmission: GltfPreparationJobAdmission | undefined;
      try {
        jobAdmission = this.#admit?.();
      } catch (error) {
        this.#queueHead += 1;
        admission.signal.removeEventListener("abort", admission.onAbort);
        admission.index = -1;
        admission.job = undefined;
        this.#queued = Math.max(0, this.#queued - 1);
        admission.reject(error);
        continue;
      }
      if (this.#admit !== undefined && jobAdmission === undefined) return;
      // The external admitter may synchronously abort this row, dispose this
      // scheduler, or re-enter wake(). Never leak capacity or start stale work.
      if (
        this.#disposed
        || admission.signal.aborted
        || this.#queue[this.#queueHead] !== admission
      ) {
        jobAdmission?.release();
        continue;
      }
      this.#queueHead += 1;
      admission.signal.removeEventListener("abort", admission.onAbort);
      this.#queued = Math.max(0, this.#queued - 1);
      admission.index = -1;
      const job = admission.job;
      admission.job = undefined;
      if (job === undefined) continue;
      this.#active += 1;
      let result: unknown;
      try {
        result = job();
      } catch (error) {
        admission.reject(error);
        this.#finish(jobAdmission);
        continue;
      }
      void Promise.resolve(result)
        .then(admission.resolve, admission.reject)
        .finally(() => this.#finish(jobAdmission));
    }
  }

  #finish(admission?: GltfPreparationJobAdmission): void {
    admission?.release();
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
