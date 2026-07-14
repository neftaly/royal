import type { WebGlExternalRenderClock } from "./root-types";

export type WebGlRenderClockOwnerOptions = Readonly<{
  contextGeneration(): number;
  hasScene(): boolean;
  isContextActive(): boolean;
  renderLatest(): void;
  reportScheduledFailure(failure: unknown): void;
}>;

/** Owns invalidation coalescing and arbitration between internal and external clocks. */
export class WebGlRenderClockOwner {
  readonly #externalClocks = new Set<object>();
  readonly #options: WebGlRenderClockOwnerOptions;
  #dirty = false;
  #disposed = false;
  #scheduleGeneration = 0;
  #scheduledGeneration = 0;

  constructor(options: WebGlRenderClockOwnerOptions) {
    this.#options = options;
  }

  acquireExternalClock(): WebGlExternalRenderClock {
    if (this.#disposed) {
      throw new Error("Cannot acquire a render clock from a disposed Royal renderer root");
    }

    const token = {};
    this.#externalClocks.add(token);
    this.#scheduledGeneration = 0;
    let released = false;

    return {
      flushInvalidated: () => {
        if (
          released
          || !this.#externalClocks.has(token)
          || this.#externalClocks.size !== 1
        ) return;
        this.flushInvalidated();
      },
      release: () => {
        if (released) return;
        released = true;
        this.#externalClocks.delete(token);
        if (this.#externalClocks.size === 0) this.#schedule();
      },
    };
  }

  /** Consumes queued demand before an immediate render begins. */
  beginRender(): void {
    this.#dirty = false;
    this.#scheduledGeneration = 0;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#dirty = false;
    this.#scheduledGeneration = 0;
    this.#externalClocks.clear();
  }

  flushInvalidated(): void {
    if (!this.#canRender() || !this.#dirty) return;
    this.#options.renderLatest();
  }

  invalidate(): void {
    if (this.#disposed || !this.#options.hasScene()) return;
    this.#dirty = true;
    this.#schedule();
  }

  /** Retains redraw demand while the context cannot render. */
  retain(): void {
    if (!this.#disposed && this.#options.hasScene()) this.#dirty = true;
  }

  /** Cancels the current scheduled generation while preserving retained demand. */
  interrupt(): void {
    this.retain();
    this.#scheduledGeneration = 0;
  }

  /** Resumes internal scheduling after context recovery. */
  resume(): void {
    this.#schedule();
  }

  #canRender(): boolean {
    return !this.#disposed
      && this.#options.isContextActive()
      && this.#options.hasScene();
  }

  #schedule(): void {
    if (
      !this.#canRender()
      || !this.#dirty
      || this.#externalClocks.size > 0
      || this.#scheduledGeneration !== 0
    ) return;
    const requestFrame = globalThis.requestAnimationFrame;
    const generation = this.#scheduleGeneration + 1;
    const contextGeneration = this.#options.contextGeneration();
    this.#scheduleGeneration = generation;
    this.#scheduledGeneration = generation;
    const renderIfCurrent = (): void => {
      if (
        this.#scheduledGeneration !== generation
        || this.#options.contextGeneration() !== contextGeneration
        || !this.#options.isContextActive()
        || !this.#dirty
        || this.#externalClocks.size > 0
      ) return;
      this.#scheduledGeneration = 0;
      if (!this.#canRender()) return;
      try {
        this.#options.renderLatest();
      } catch (failure) {
        this.#options.reportScheduledFailure(failure);
      }
    };
    if (typeof requestFrame === "function") requestFrame(renderIfCurrent);
    else queueMicrotask(renderIfCurrent);
  }
}
