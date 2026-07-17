const EMPTY_SUPPRESSIONS: readonly string[] = [];

/** Frame-wide arbitration between ordinary and generated-VT residency. */
export class FrameTextureResidencyIntent {
  readonly #ordinaryRequired = new Set<string>();
  readonly #suppressions: string[] = [];
  readonly #virtualBound = new Set<string>();
  #active = false;

  beginFrame(): void {
    this.#ordinaryRequired.clear();
    this.#suppressions.length = 0;
    this.#virtualBound.clear();
    this.#active = true;
  }

  /** Current-frame ordinary demand; valid only until `finishFrame` returns. */
  ordinaryRequiredKeys(): ReadonlySet<string> {
    return this.#ordinaryRequired;
  }

  requireOrdinary(key: string): void {
    if (this.#active) this.#ordinaryRequired.add(key);
  }

  recordVirtualBind(key: string): void {
    if (this.#active) this.#virtualBound.add(key);
  }

  finishFrame(commit: boolean): readonly string[] {
    if (!this.#active) return EMPTY_SUPPRESSIONS;
    if (!commit || this.#virtualBound.size === 0) {
      this.#ordinaryRequired.clear();
      this.#virtualBound.clear();
      this.#active = false;
      return EMPTY_SUPPRESSIONS;
    }
    for (const key of this.#virtualBound) {
      if (!this.#ordinaryRequired.has(key)) this.#suppressions.push(key);
    }
    this.#ordinaryRequired.clear();
    this.#virtualBound.clear();
    this.#active = false;
    // The owner consumes this view synchronously before the next beginFrame.
    return this.#suppressions;
  }
}
