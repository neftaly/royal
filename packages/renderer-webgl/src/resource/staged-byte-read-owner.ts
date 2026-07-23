import { RetainedFifo } from "./retained-fifo";

export type StagedByteReadLease = Readonly<{
  bytes: Uint8Array;
  release(): void;
}>;

export type StagedByteReadSnapshot = Readonly<{
  activeReads: number;
  queuedReads: number;
  sourceReservationLimit: number;
  sourceReservations: number;
  stagedBytes: number;
  stagedByteThreshold: number;
}>;

type PendingRead = {
  readonly cancel: () => void;
  cancelled: boolean;
  read: (() => Promise<Uint8Array>) | undefined;
  readonly reject: (error: unknown) => void;
  readonly resolve: (lease: StagedByteReadLease) => void;
  readonly signal: AbortSignal;
  started: boolean;
};

const aborted = (): DOMException => new DOMException(
  "Staged byte read was aborted",
  "AbortError",
);

/** Pure admission rule for bounded transport plus completed-source staging. */
export const stagedByteReadCanStart = (
  activeReads: number,
  activeReadLimit: number,
  sourceReservations: number,
  sourceReservationLimit: number,
  stagedBytes: number,
  stagedByteThreshold: number,
): boolean => activeReads < activeReadLimit
  && sourceReservations < sourceReservationLimit
  && (sourceReservations === activeReads || stagedBytes < stagedByteThreshold);

/**
 * Bounds source transport separately from the downstream preparation queue.
 *
 * Completed bytes retain a reservation until the consumer begins preparation.
 * One oversize source can progress while later reads wait for its release.
 */
export class StagedByteReadOwner {
  #activeReads = 0;
  readonly #activeReadLimit: number;
  readonly #active = new Set<PendingRead>();
  #changeQueued = false;
  #disposed = false;
  readonly #onChanged: () => void;
  readonly #pending = new RetainedFifo<PendingRead>();
  #queuedReads = 0;
  readonly #sourceReservationLimit: number;
  #sourceReservations = 0;
  #stagedBytes = 0;
  readonly #stagedByteThreshold: number;

  constructor(
    activeReadLimit: number,
    sourceReservationLimit: number,
    stagedByteThreshold: number,
    onChanged: () => void = () => undefined,
  ) {
    if (!Number.isSafeInteger(activeReadLimit) || activeReadLimit < 1) {
      throw new RangeError("Staged byte active-read limit must be a positive integer");
    }
    if (
      !Number.isSafeInteger(sourceReservationLimit)
      || sourceReservationLimit < activeReadLimit
    ) {
      throw new RangeError(
        "Staged byte source-reservation limit must cover the active-read limit",
      );
    }
    if (!Number.isSafeInteger(stagedByteThreshold) || stagedByteThreshold < 1) {
      throw new RangeError("Staged byte threshold must be a positive safe integer");
    }
    this.#activeReadLimit = activeReadLimit;
    this.#onChanged = onChanged;
    this.#sourceReservationLimit = sourceReservationLimit;
    this.#stagedByteThreshold = stagedByteThreshold;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#active) pending.cancel();
    for (;;) {
      const pending = this.#pending.dequeue();
      if (pending === undefined) break;
      if (pending.started || pending.cancelled) continue;
      pending.cancelled = true;
      pending.read = undefined;
      pending.signal.removeEventListener("abort", pending.cancel);
      pending.reject(aborted());
    }
    this.#queuedReads = 0;
    this.#notifyChanged();
  }

  read(
    signal: AbortSignal,
    read: () => Promise<Uint8Array>,
  ): Promise<StagedByteReadLease> {
    if (this.#disposed || signal.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const pending: PendingRead = {
        cancel: () => {
          if (pending.cancelled) return;
          pending.cancelled = true;
          pending.read = undefined;
          if (!pending.started) {
            this.#queuedReads -= 1;
            reject(aborted());
            this.#drain();
            this.#notifyChanged();
          } else reject(aborted());
        },
        cancelled: false,
        read,
        reject,
        resolve,
        signal,
        started: false,
      };
      signal.addEventListener("abort", pending.cancel, { once: true });
      this.#pending.enqueue(pending);
      this.#queuedReads += 1;
      this.#drain();
      this.#notifyChanged();
    });
  }

  snapshot(): StagedByteReadSnapshot {
    return {
      activeReads: this.#activeReads,
      queuedReads: this.#queuedReads,
      sourceReservationLimit: this.#sourceReservationLimit,
      sourceReservations: this.#sourceReservations,
      stagedBytes: this.#stagedBytes,
      stagedByteThreshold: this.#stagedByteThreshold,
    };
  }

  #complete(pending: PendingRead, bytes: Uint8Array): void {
    this.#active.delete(pending);
    this.#activeReads -= 1;
    pending.signal.removeEventListener("abort", pending.cancel);
    if (this.#disposed || pending.cancelled || pending.signal.aborted) {
      this.#sourceReservations -= 1;
      this.#drain();
      this.#notifyChanged();
      return;
    }
    const byteLength = bytes.byteLength;
    this.#stagedBytes += byteLength;
    let retained = true;
    pending.resolve({
      bytes,
      release: () => {
        if (!retained) return;
        retained = false;
        this.#stagedBytes -= byteLength;
        this.#sourceReservations -= 1;
        this.#drain();
        this.#notifyChanged();
      },
    });
    this.#drain();
    this.#notifyChanged();
  }

  #drain(): void {
    while (
      !this.#disposed
      && stagedByteReadCanStart(
        this.#activeReads,
        this.#activeReadLimit,
        this.#sourceReservations,
        this.#sourceReservationLimit,
        this.#stagedBytes,
        this.#stagedByteThreshold,
      )
    ) {
      const pending = this.#pending.dequeue();
      if (pending === undefined) return;
      if (pending.cancelled) continue;
      pending.started = true;
      this.#active.add(pending);
      this.#queuedReads -= 1;
      this.#activeReads += 1;
      this.#sourceReservations += 1;
      let reading: Promise<Uint8Array>;
      try {
        const read = pending.read;
        pending.read = undefined;
        if (read === undefined) throw aborted();
        reading = read();
      } catch (error) {
        this.#fail(pending, error);
        continue;
      }
      void reading.then(
        (bytes) => this.#complete(pending, bytes),
        (error: unknown) => this.#fail(pending, error),
      );
    }
  }

  #fail(pending: PendingRead, error: unknown): void {
    this.#active.delete(pending);
    this.#activeReads -= 1;
    this.#sourceReservations -= 1;
    pending.signal.removeEventListener("abort", pending.cancel);
    if (!pending.cancelled) pending.reject(error);
    this.#drain();
    this.#notifyChanged();
  }

  #notifyChanged(): void {
    if (this.#changeQueued) return;
    this.#changeQueued = true;
    queueMicrotask(() => {
      this.#changeQueued = false;
      this.#onChanged();
    });
  }
}
