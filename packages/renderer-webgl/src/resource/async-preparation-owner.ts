export const DEFAULT_ASYNC_PREPARATION_JOB_LIMIT = 8;
const FOREGROUND_BURST_LIMIT = 4;

export type AsyncPreparationLane = "detail" | "foreground";

export type AsyncPreparationLaneSelection = Readonly<{
  foregroundBurst: number;
  lane: AsyncPreparationLane;
}>;

/** Pure bounded-fair choice used by the root's asynchronous preparation shell. */
export const selectAsyncPreparationLane = (
  foregroundQueued: number,
  detailQueued: number,
  foregroundBurst: number,
): AsyncPreparationLaneSelection | undefined => {
  if (foregroundQueued > 0 && detailQueued === 0) {
    return { foregroundBurst: 0, lane: "foreground" };
  }
  if (foregroundQueued > 0 && foregroundBurst < FOREGROUND_BURST_LIMIT) {
    return {
      foregroundBurst: Math.min(FOREGROUND_BURST_LIMIT, foregroundBurst + 1),
      lane: "foreground",
    };
  }
  if (detailQueued > 0) return { foregroundBurst: 0, lane: "detail" };
  return undefined;
};

export type AsyncPreparationSnapshot = Readonly<{
  /** Jobs currently executing asynchronous preparation work. */
  activeJobs: number;
  /** Immutable root-wide concurrency ceiling. */
  jobLimit: number;
  /** Queued image/detail work that cannot delay a newly claimed scene. */
  queuedDetailJobs: number;
  /** Queued scene, environment, or visible VT work. */
  queuedForegroundJobs: number;
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
  prepare: (() => Promise<Value>) | undefined;
  readonly lane: AsyncPreparationLane;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: Value) => void;
  readonly signal: AbortSignal;
  started: boolean;
  previous: PendingPreparation | undefined;
  next: PendingPreparation | undefined;
};

/** Intrusive FIFO: cancellation unlinks in O(1), without allocating queue nodes. */
class PreparationQueue {
  #first: PendingPreparation | undefined;
  #last: PendingPreparation | undefined;

  enqueue(value: PendingPreparation): void {
    value.previous = this.#last;
    if (this.#last === undefined) this.#first = value;
    else this.#last.next = value;
    this.#last = value;
  }

  remove(value: PendingPreparation): void {
    if (value.previous === undefined) this.#first = value.next;
    else value.previous.next = value.next;
    if (value.next === undefined) this.#last = value.previous;
    else value.next.previous = value.previous;
    value.previous = undefined;
    value.next = undefined;
  }

  dequeue(): PendingPreparation | undefined {
    const value = this.#first;
    if (value !== undefined) this.remove(value);
    return value;
  }
}

type PreparationResult =
  | Readonly<{ readonly ok: true; readonly value: unknown }>
  | Readonly<{ readonly error: unknown; readonly ok: false }>;

const aborted = (): DOMException => new DOMException("Preparation was aborted", "AbortError");

/** Root-owned bounded-fair authority for asynchronous asset preparation. */
export class AsyncPreparationOwner {
  #activeJobs = 0;
  #activeDetailJobs = 0;
  #detailQueued = 0;
  #disposed = false;
  #foregroundBurst = 0;
  #foregroundQueued = 0;
  readonly #jobLimit: number;
  readonly #onChanged: () => void;
  readonly #pendingDetail = new PreparationQueue();
  readonly #pendingForeground = new PreparationQueue();

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
    this.#rejectQueued(this.#pendingForeground);
    this.#rejectQueued(this.#pendingDetail);
    this.#foregroundQueued = 0;
    this.#detailQueued = 0;
    this.#onChanged();
  }

  readonly run = <Value>(
    signal: AbortSignal,
    prepare: () => Promise<Value>,
  ): Promise<Value> => this.#enqueue("detail", signal, prepare);

  /** Schedules first-visible scene work ahead of an existing detail backlog. */
  readonly runForeground = <Value>(
    signal: AbortSignal,
    prepare: () => Promise<Value>,
  ): Promise<Value> => this.#enqueue("foreground", signal, prepare);

  snapshot(): AsyncPreparationSnapshot {
    return {
      activeJobs: this.#activeJobs,
      jobLimit: this.#jobLimit,
      queuedDetailJobs: this.#detailQueued,
      queuedForegroundJobs: this.#foregroundQueued,
      queuedJobs: this.#detailQueued + this.#foregroundQueued,
    };
  }

  #enqueue<Value>(
    lane: AsyncPreparationLane,
    signal: AbortSignal,
    prepare: () => Promise<Value>,
  ): Promise<Value> {
    if (this.#disposed || signal.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const pending: PendingPreparation = {
        cancel: () => undefined,
        cancelled: false,
        lane,
        previous: undefined,
        next: undefined,
        prepare,
        reject,
        resolve: (value) => resolve(value as Value),
        signal,
        started: false,
      };
      const cancel = (): void => {
        if (pending.started || pending.cancelled) return;
        pending.cancelled = true;
        pending.prepare = undefined;
        this.#decrementQueued(lane);
        reject(aborted());
        (lane === "foreground" ? this.#pendingForeground : this.#pendingDetail).remove(pending);
        this.#drain();
        this.#onChanged();
      };
      pending.cancel = cancel;
      signal.addEventListener("abort", cancel, { once: true });
      if (lane === "foreground") {
        this.#pendingForeground.enqueue(pending);
        this.#foregroundQueued += 1;
      } else {
        this.#pendingDetail.enqueue(pending);
        this.#detailQueued += 1;
      }
      this.#drain();
      this.#onChanged();
    });
  }

  #drain(): void {
    while (!this.#disposed && this.#activeJobs < this.#jobLimit) {
      const selection = selectAsyncPreparationLane(
        this.#foregroundQueued,
        this.#activeDetailJobs === 0 ? this.#detailQueued : 0,
        this.#foregroundBurst,
      );
      if (selection === undefined) return;
      this.#foregroundBurst = selection.foregroundBurst;
      const pending = (selection.lane === "foreground"
        ? this.#pendingForeground
        : this.#pendingDetail).dequeue();
      if (pending === undefined) throw new Error("Royal preparation queue lost retained work");
      if (pending.signal.aborted) {
        pending.cancelled = true;
        pending.signal.removeEventListener("abort", pending.cancel);
        this.#decrementQueued(pending.lane);
        pending.reject(aborted());
        continue;
      }
      pending.started = true;
      pending.signal.removeEventListener("abort", pending.cancel);
      this.#decrementQueued(pending.lane);
      this.#activeJobs += 1;
      if (pending.lane === "detail") this.#activeDetailJobs += 1;
      let preparation: Promise<unknown>;
      try {
        const prepare = pending.prepare;
        pending.prepare = undefined;
        if (prepare === undefined) throw aborted();
        preparation = prepare();
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
    if (pending.lane === "detail") this.#activeDetailJobs -= 1;
    this.#drain();
    if (!this.#disposed) this.#onChanged();
    if (result.ok) pending.resolve(result.value);
    else pending.reject(result.error);
  }

  #decrementQueued(lane: AsyncPreparationLane): void {
    if (lane === "foreground") this.#foregroundQueued -= 1;
    else this.#detailQueued -= 1;
  }

  #rejectQueued(queue: PreparationQueue): void {
    for (;;) {
      const pending = queue.dequeue();
      if (pending === undefined) return;
      if (pending.started || pending.cancelled) continue;
      pending.cancelled = true;
      pending.prepare = undefined;
      pending.signal.removeEventListener("abort", pending.cancel);
      pending.reject(aborted());
    }
  }
}
