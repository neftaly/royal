import { monotonicNowMs, type MonotonicClock } from "./clock";

const RESOURCE_REFINEMENT_WAKE_INTERVAL_MS = 100;

export const resourceRefinementWakeDelay = (
  input: Readonly<{ elapsedMs: number; firstWake: boolean; urgent: boolean }>,
): number => input.firstWake || input.urgent
  ? 0
  : Math.max(0, RESOURCE_REFINEMENT_WAKE_INTERVAL_MS - input.elapsedMs);

type ResourceRefinementWakeOwnerOptions = Readonly<{
  invalidate(): void;
  now?: MonotonicClock;
}>;

/** Batches low-priority visual refinements without delaying first or final publication. */
export class ResourceRefinementWakeOwner {
  readonly #invalidate: () => void;
  readonly #now: MonotonicClock;
  #disposed = false;
  #lastWakeAt = Number.NEGATIVE_INFINITY;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #wakeRequested = false;

  constructor(options: ResourceRefinementWakeOwnerOptions) {
    this.#invalidate = options.invalidate;
    this.#now = options.now ?? monotonicNowMs;
  }

  acknowledgeFrame(): void {
    this.#cancelTimer();
    if (this.#wakeRequested) this.#lastWakeAt = this.#now();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelTimer();
  }

  request(urgent = false): void {
    if (this.#disposed) return;
    const now = this.#now();
    const delay = resourceRefinementWakeDelay({
      elapsedMs: now - this.#lastWakeAt,
      firstWake: !this.#wakeRequested,
      urgent,
    });
    if (delay > 0) {
      if (this.#timer !== undefined) return;
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        if (!this.#disposed) this.#wake();
      }, delay);
      return;
    }
    this.#cancelTimer();
    this.#wake();
  }

  #cancelTimer(): void {
    const timer = this.#timer;
    if (timer === undefined) return;
    this.#timer = undefined;
    clearTimeout(timer);
  }

  #wake(): void {
    this.#wakeRequested = true;
    this.#lastWakeAt = this.#now();
    this.#invalidate();
  }
}
