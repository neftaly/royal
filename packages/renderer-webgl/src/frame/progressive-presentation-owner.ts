import { progressivePresentationDecision } from "./progressive-presentation";

export type ProgressivePresentationOwnerOptions = Readonly<{
  cancelDelay(handle: unknown): void;
  intervalMs: number;
  now(): number;
  onFailure(error: unknown): void;
  present(): void;
  requestDelay(callback: () => void, delayMs: number): unknown;
}>;

/** Owns one bounded progressive-presentation timer; resource commits remain independent. */
export class ProgressivePresentationOwner {
  #delayHandle: unknown;
  #disposed = false;
  #lastPresentationAt = -Infinity;
  readonly #options: ProgressivePresentationOwnerOptions;
  #pending = false;

  constructor(options: ProgressivePresentationOwnerOptions) {
    progressivePresentationDecision(-Infinity, 0, options.intervalMs);
    this.#options = options;
  }

  changed(): void {
    if (this.#disposed) return;
    this.#pending = true;
    this.#plan(false);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pending = false;
    this.#cancelDelay();
  }

  reset(): void {
    if (this.#disposed) return;
    this.#pending = false;
    this.#lastPresentationAt = -Infinity;
    this.#cancelDelay();
  }

  settled(): void {
    if (this.#disposed || !this.#pending) return;
    this.#plan(true);
  }

  #cancelDelay(): void {
    if (this.#delayHandle === undefined) return;
    const handle = this.#delayHandle;
    this.#delayHandle = undefined;
    try {
      this.#options.cancelDelay(handle);
    } catch (error) {
      this.#report(error);
    }
  }

  #plan(urgent: boolean): void {
    const now = this.#options.now();
    const decision = progressivePresentationDecision(
      this.#lastPresentationAt,
      now,
      this.#options.intervalMs,
      urgent,
    );
    if (decision.present) {
      this.#publish(now);
      return;
    }
    if (this.#delayHandle !== undefined) return;
    try {
      this.#delayHandle = this.#options.requestDelay(() => {
        this.#delayHandle = undefined;
        if (this.#disposed || !this.#pending) return;
        try {
          this.#publish(this.#options.now());
        } catch (error) {
          this.#report(error);
        }
      }, decision.delayMs);
    } catch (error) {
      this.#report(error);
      this.#publish(now);
    }
  }

  #publish(now: number): void {
    this.#cancelDelay();
    this.#pending = false;
    this.#lastPresentationAt = now;
    this.#options.present();
  }

  #report(error: unknown): void {
    try {
      this.#options.onFailure(error);
    } catch {
      // A diagnostic sink cannot corrupt publication ownership.
    }
  }
}
