export const DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME = 4 * 1024 * 1024;
export const DEFAULT_TEXTURE_UPLOAD_BYTE_BUDGET_PER_FRAME = 32 * 1024 * 1024;

export type FrameUploadBudgetSnapshot = Readonly<{
  /** Upload bytes admitted during the most recent frame handled by this owner. */
  admittedBytes: number;
  /** Immutable per-frame target; one larger upload may be admitted alone. */
  budgetBytes: number;
  /** Uploads deferred during the most recent frame handled by this owner. */
  deferredUploads: number;
}>;

/** Root-owned byte admission for uploads submitted by one rendered frame. */
export class FrameUploadBudgetOwner {
  readonly #budgetBytes: number;
  readonly #now: () => number;
  readonly #timeBudgetMs: number;
  #startedAt = 0;
  #submittedWork = false;
  #deferredUploads = 0;
  #remainingBytes: number;
  #admittedBytes = 0;

  constructor(
    budgetBytes = DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME,
    timeBudgetMs = Infinity,
    now: () => number = () => performance.now(),
  ) {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1) {
      throw new RangeError("Royal frame upload budget must be a positive safe integer");
    }
    if (!(timeBudgetMs > 0)) throw new RangeError("Royal upload time budget must be positive");
    this.#now = now;
    this.#timeBudgetMs = timeBudgetMs;
    this.#startedAt = now();
    this.#budgetBytes = budgetBytes;
    this.#remainingBytes = budgetBytes;
  }

  beginFrame(): void {
    this.#deferredUploads = 0;
    this.#remainingBytes = this.#budgetBytes;
    this.#admittedBytes = 0;
    this.#submittedWork = false;
    this.#startedAt = this.#now();
  }

  snapshot(): FrameUploadBudgetSnapshot {
    return {
      admittedBytes: this.#admittedBytes,
      budgetBytes: this.#budgetBytes,
      deferredUploads: this.#deferredUploads,
    };
  }

  /** Accounts for indivisible allocation/mip work as well as byte copies. */
  tryAdmitAllocation(): boolean {
    if (this.#submittedWork && this.#now() - this.#startedAt >= this.#timeBudgetMs) return false;
    this.#submittedWork = true;
    return true;
  }

  tryAdmit(byteLength: number): boolean {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new RangeError("Royal frame upload byte length must be a non-negative safe integer");
    }
    if (byteLength === 0) return true;
    if (
      (!this.#submittedWork || this.#now() - this.#startedAt < this.#timeBudgetMs)
      && (byteLength <= this.#remainingBytes || this.#admittedBytes === 0)
    ) {
      this.#submittedWork = true;
      this.#admittedBytes += byteLength;
      this.#remainingBytes = Math.max(0, this.#remainingBytes - byteLength);
      return true;
    }
    this.#deferredUploads += 1;
    return false;
  }
}
