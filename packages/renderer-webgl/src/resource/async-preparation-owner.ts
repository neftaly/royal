import { RetainedFifo } from "./retained-fifo";

export const DEFAULT_ASYNC_PREPARATION_JOB_LIMIT = 8;

export type AsyncPreparationSnapshot = Readonly<{
  /** Jobs currently executing asynchronous preparation work. */
  activeJobs: number;
  /** Immutable root-wide concurrency ceiling. */
  jobLimit: number;
  /** Retained FIFO jobs waiting for an execution slot. */
  queuedJobs: number;
}>;

export type AsyncPreparationScheduler = <Value>(
  signal: AbortSignal,
  prepare: () => Promise<Value>,
) => Promise<Value>;

type PendingPreparation<Value = unknown> = {
  cancel: () => void;
  cancelled: boolean;
  readonly prepare: () => Promise<Value>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: Value) => void;
  readonly signal: AbortSignal;
  started: boolean;
};

type PreparationResult =
  | Readonly<{ readonly ok: true; readonly value: unknown }>
  | Readonly<{ readonly error: unknown; readonly ok: false }>;

const aborted = (): DOMException => new DOMException("Preparation was aborted", "AbortError");

/** Root-owned FIFO authority for bounded asynchronous asset preparation. */
export class AsyncPreparationOwner {
  #activeJobs = 0;
  #disposed = false;
  readonly #jobLimit: number;
  readonly #onChanged: () => void;
  readonly #pending = new RetainedFifo<PendingPreparation>();
  #queuedJobs = 0;

  constructor(jobLimit: number, onChanged: () => void = () => undefined) {
    if (!Number.isSafeInteger(jobLimit) || jobLimit < 1) {
      throw new RangeError("Royal asynchronous preparation job limit must be a positive integer");
    }
    this.#jobLimit = jobLimit;
    this.#onChanged = onChanged;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (;;) {
      const pending = this.#pending.dequeue();
      if (pending === undefined) break;
      if (pending.started || pending.cancelled) continue;
      pending.cancelled = true;
      pending.signal.removeEventListener("abort", pending.cancel);
      pending.reject(aborted());
    }
    this.#queuedJobs = 0;
    this.#onChanged();
  }

  readonly run = <Value>(
    signal: AbortSignal,
    prepare: () => Promise<Value>,
  ): Promise<Value> => {
    if (this.#disposed || signal.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const pending: PendingPreparation = {
        cancel: () => undefined,
        cancelled: false,
        prepare,
        reject,
        resolve: (value) => resolve(value as Value),
        signal,
        started: false,
      };
      const cancel = (): void => {
        if (pending.started || pending.cancelled) return;
        pending.cancelled = true;
        this.#queuedJobs -= 1;
        reject(aborted());
        this.#drain();
        this.#onChanged();
      };
      pending.cancel = cancel;
      signal.addEventListener("abort", cancel, { once: true });
      this.#pending.enqueue(pending);
      this.#queuedJobs += 1;
      this.#drain();
      this.#onChanged();
    });
  };

  snapshot(): AsyncPreparationSnapshot {
    return {
      activeJobs: this.#activeJobs,
      jobLimit: this.#jobLimit,
      queuedJobs: this.#queuedJobs,
    };
  }

  #drain(): void {
    while (!this.#disposed && this.#activeJobs < this.#jobLimit) {
      const pending = this.#pending.dequeue();
      if (pending === undefined) return;
      if (pending.cancelled) continue;
      if (pending.signal.aborted) {
        pending.cancelled = true;
        pending.signal.removeEventListener("abort", pending.cancel);
        this.#queuedJobs -= 1;
        pending.reject(aborted());
        continue;
      }
      pending.started = true;
      pending.signal.removeEventListener("abort", pending.cancel);
      this.#queuedJobs -= 1;
      this.#activeJobs += 1;
      let preparation: Promise<unknown>;
      try {
        preparation = pending.prepare();
      } catch (error) {
        this.#settle(pending, { error, ok: false });
        continue;
      }
      void preparation.then(
        (value) => this.#settle(pending, { ok: true, value }),
        (error: unknown) => this.#settle(pending, { error, ok: false }),
      );
    }
  }

  #settle(pending: PendingPreparation, result: PreparationResult): void {
    this.#activeJobs -= 1;
    this.#drain();
    if (!this.#disposed) this.#onChanged();
    if (result.ok) pending.resolve(result.value);
    else pending.reject(result.error);
  }
}
