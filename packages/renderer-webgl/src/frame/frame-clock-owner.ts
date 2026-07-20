import {
  createFrameClockState,
  createFrameClockTransition,
  FRAME_CLOCK_EVENT_ACQUIRE_EXTERNAL,
  FRAME_CLOCK_EVENT_CONTEXT_BLOCKED,
  FRAME_CLOCK_EVENT_CONTEXT_RESUMED,
  FRAME_CLOCK_EVENT_DISPOSE,
  FRAME_CLOCK_EVENT_FLUSH_EXTERNAL,
  FRAME_CLOCK_EVENT_FLUSH_INTERNAL,
  FRAME_CLOCK_EVENT_INVALIDATE,
  FRAME_CLOCK_EVENT_RELEASE_EXTERNAL,
  FRAME_CLOCK_EVENT_RENDER_FAILED,
  FRAME_CLOCK_EVENT_RETRY,
  FRAME_CLOCK_EVENT_SCHEDULE_FAILED,
  FRAME_CLOCK_EVENT_SCHEDULED_FRAME,
  FRAME_CLOCK_EFFECT_RENDER,
  FRAME_CLOCK_EFFECT_SCHEDULE,
  planFrameClockTransition,
  type FrameClockEvent,
  type FrameClockState,
} from "./frame-clock";

const INVALIDATE_EVENT = { kind: FRAME_CLOCK_EVENT_INVALIDATE } as const;
const FLUSH_INTERNAL_EVENT = { kind: FRAME_CLOCK_EVENT_FLUSH_INTERNAL } as const;
const ACQUIRE_EXTERNAL_EVENT = { kind: FRAME_CLOCK_EVENT_ACQUIRE_EXTERNAL } as const;
const CONTEXT_BLOCKED_EVENT = { kind: FRAME_CLOCK_EVENT_CONTEXT_BLOCKED } as const;
const CONTEXT_RESUMED_EVENT = { kind: FRAME_CLOCK_EVENT_CONTEXT_RESUMED } as const;
const DISPOSE_EVENT = { kind: FRAME_CLOCK_EVENT_DISPOSE } as const;
const RENDER_FAILED_EVENT = { kind: FRAME_CLOCK_EVENT_RENDER_FAILED } as const;
const RETRY_EVENT = { kind: FRAME_CLOCK_EVENT_RETRY } as const;

export type ExternalFrameClock = Readonly<{
  flushInvalidated(): void;
  release(): void;
}>;

export type FrameClockOwnerOptions = Readonly<{
  render(): void;
  reportScheduledFailure(error: unknown): void;
  requestFrame(callback: () => void): void;
}>;

/** Owns demand coalescing and arbitration between browser and external frame clocks. */
export class FrameClockOwner {
  #current: FrameClockState = createFrameClockState();
  #next: FrameClockState = createFrameClockState();
  readonly #options: FrameClockOwnerOptions;
  readonly #transition = createFrameClockTransition();

  constructor(options: FrameClockOwnerOptions) {
    this.#options = options;
  }

  acquireExternalClock(): ExternalFrameClock {
    if (!this.#apply(ACQUIRE_EXTERNAL_EVENT)) {
      throw new Error("Royal renderer already has an external frame clock or is disposed");
    }
    const token = this.#transition.token;
    const flushEvent = { kind: FRAME_CLOCK_EVENT_FLUSH_EXTERNAL, token } as const;
    const releaseEvent = { kind: FRAME_CLOCK_EVENT_RELEASE_EXTERNAL, token } as const;
    let released = false;
    return {
      flushInvalidated: () => {
        if (released) return;
        this.#apply(flushEvent);
      },
      release: () => {
        if (released) return;
        released = true;
        this.#apply(releaseEvent);
      },
    };
  }

  block(): void {
    this.#apply(CONTEXT_BLOCKED_EVENT);
  }

  dispose(): void {
    this.#apply(DISPOSE_EVENT);
  }

  flushInvalidated(): void {
    this.#apply(FLUSH_INTERNAL_EVENT);
  }

  invalidate(): void {
    this.#apply(INVALIDATE_EVENT);
  }

  /** Rearms scheduled rendering after a previously reported render failure. */
  retry(): void {
    this.#apply(RETRY_EVENT);
  }

  resume(): void {
    this.#apply(CONTEXT_RESUMED_EVENT);
  }

  #apply(event: FrameClockEvent): boolean {
    planFrameClockTransition(this.#current, event, this.#next, this.#transition);
    if (!this.#transition.accepted) return false;
    const previous = this.#current;
    this.#current = this.#next;
    this.#next = previous;

    if (this.#transition.effect === FRAME_CLOCK_EFFECT_SCHEDULE) {
      const token = this.#transition.token;
      const frameEvent = { kind: FRAME_CLOCK_EVENT_SCHEDULED_FRAME, token } as const;
      try {
        this.#options.requestFrame(() => {
          try {
            this.#apply(frameEvent);
          } catch (error) {
            this.#apply(RENDER_FAILED_EVENT);
            this.#reportScheduledFailure(error);
          }
        });
      } catch (error) {
        this.#apply({ kind: FRAME_CLOCK_EVENT_SCHEDULE_FAILED, token });
        this.#reportScheduledFailure(error);
      }
    } else if (this.#transition.effect === FRAME_CLOCK_EFFECT_RENDER) {
      this.#options.render();
    }
    return true;
  }

  #reportScheduledFailure(error: unknown): void {
    try {
      this.#options.reportScheduledFailure(error);
    } catch {
      // A diagnostic sink cannot corrupt frame-clock ownership.
    }
  }
}
