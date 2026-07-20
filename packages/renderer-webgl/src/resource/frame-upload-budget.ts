export const DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME = 4 * 1024 * 1024;

export type FrameUploadBudgetSnapshot = Readonly<{
  /** Ordinary-texture bytes admitted during the most recently submitted frame. */
  admittedBytes: number;
  /** Immutable per-frame target; one larger upload may be admitted alone. */
  budgetBytes: number;
  /** Unique ordinary-texture uploads deferred during the most recent frame. */
  deferredUploads: number;
}>;

/** Root-owned byte admission for uploads submitted by one rendered frame. */
export class FrameUploadBudgetOwner {
  readonly #budgetBytes: number;
  #deferredUploads = 0;
  #remainingBytes: number;
  #admittedBytes = 0;

  constructor(budgetBytes = DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME) {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1) {
      throw new RangeError("Royal frame upload budget must be a positive safe integer");
    }
    this.#budgetBytes = budgetBytes;
    this.#remainingBytes = budgetBytes;
  }

  beginFrame(): void {
    this.#deferredUploads = 0;
    this.#remainingBytes = this.#budgetBytes;
    this.#admittedBytes = 0;
  }

  snapshot(): FrameUploadBudgetSnapshot {
    return {
      admittedBytes: this.#admittedBytes,
      budgetBytes: this.#budgetBytes,
      deferredUploads: this.#deferredUploads,
    };
  }

  tryAdmit(byteLength: number): boolean {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new RangeError("Royal frame upload byte length must be a non-negative safe integer");
    }
    if (byteLength === 0) return true;
    if (byteLength <= this.#remainingBytes || this.#admittedBytes === 0) {
      this.#admittedBytes += byteLength;
      this.#remainingBytes = Math.max(0, this.#remainingBytes - byteLength);
      return true;
    }
    this.#deferredUploads += 1;
    return false;
  }
}
