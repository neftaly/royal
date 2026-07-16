export type WebGlFrameObserver = (frame: number) => void;
export type WebGlRenderFailureObserver = (failure: unknown) => void;

type FrameObserverRecord = {
  readonly callback: WebGlFrameObserver;
  lastFrame: number;
};

const reportFailureObserverError = (failure: unknown): void => {
  try {
    console.error("Royal WebGL render failure observer failed", failure);
  } catch {
    // Failure delivery must never depend on the host's diagnostic sink.
  }
};

/** Owns frame numbering and serialized observer publication. */
export class WebGlFramePublicationOwner {
  readonly #failureObservers = new Set<WebGlRenderFailureObserver>();
  readonly #failureQueue: unknown[] = [];
  readonly #frameObservers = new Set<FrameObserverRecord>();
  readonly #frameQueue: number[] = [];
  #disposed = false;
  #drainingFailures = false;
  #drainingFrames = false;
  #failureHead = 0;
  #frame = 0;
  #frameHead = 0;

  get frame(): number {
    return this.#frame;
  }

  /** Advances resource age even if later frame teardown fails before publication. */
  advance(): number {
    if (!this.#disposed) this.#frame += 1;
    return this.#frame;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#failureObservers.clear();
    this.#frameObservers.clear();
    this.#failureQueue.length = 0;
    this.#frameQueue.length = 0;
    this.#failureHead = 0;
    this.#frameHead = 0;
  }

  /** Calls back immediately, then once for each later completed frame. */
  observeFrame(callback: WebGlFrameObserver): () => void {
    callback(this.#frame);
    if (this.#disposed) return () => undefined;
    const observer: FrameObserverRecord = { callback, lastFrame: this.#frame };
    this.#frameObservers.add(observer);
    return () => {
      this.#frameObservers.delete(observer);
    };
  }

  observeRenderFailures(callback: WebGlRenderFailureObserver): () => void {
    if (this.#disposed) return () => undefined;
    this.#failureObservers.add(callback);
    return () => {
      this.#failureObservers.delete(callback);
    };
  }

  /** Publishes the current advanced frame in order, including across reentrant renders. */
  publishFrame(): void {
    if (this.#disposed) return;
    this.#frameQueue.push(this.#frame);
    if (this.#drainingFrames) return;
    this.#drainingFrames = true;
    try {
      while (this.#frameHead < this.#frameQueue.length) {
        const frame = this.#frameQueue[this.#frameHead++]!;
        let failure: unknown;
        let failed = false;
        for (const observer of this.#frameObservers) {
          // Reentrant subscriptions are initialized to the current frame and skip this delivery.
          if (observer.lastFrame >= frame) continue;
          observer.lastFrame = frame;
          try {
            observer.callback(frame);
          } catch (error) {
            if (!failed) failure = error;
            failed = true;
          }
        }
        if (failed) this.reportRenderFailure(failure);
      }
    } finally {
      this.#frameQueue.length = 0;
      this.#frameHead = 0;
      this.#drainingFrames = false;
    }
  }

  /** Serializes failure delivery and isolates observers from the scheduled frame path. */
  reportRenderFailure(failure: unknown): void {
    if (this.#disposed) return;
    this.#failureQueue.push(failure);
    if (this.#drainingFailures) return;
    this.#drainingFailures = true;
    try {
      while (this.#failureHead < this.#failureQueue.length) {
        const next = this.#failureQueue[this.#failureHead++]!;
        for (const observer of Array.from(this.#failureObservers)) {
          if (!this.#failureObservers.has(observer)) continue;
          try {
            observer(next);
          } catch (observerFailure) {
            reportFailureObserverError(observerFailure);
          }
        }
      }
    } finally {
      this.#failureQueue.length = 0;
      this.#failureHead = 0;
      this.#drainingFailures = false;
    }
  }
}
