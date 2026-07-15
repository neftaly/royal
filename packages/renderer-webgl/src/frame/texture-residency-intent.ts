const EMPTY_SUPPRESSIONS: readonly string[] = Object.freeze([]);

/** Frame-wide arbitration between ordinary and generated-VT residency. */
export class FrameTextureResidencyIntent {
  readonly #ordinaryRequired = new Set<string>();
  readonly #virtualBound = new Set<string>();
  #active = false;

  beginFrame(): void {
    this.#ordinaryRequired.clear();
    this.#virtualBound.clear();
    this.#active = true;
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
    const suppressions: string[] = [];
    for (const key of this.#virtualBound) {
      if (!this.#ordinaryRequired.has(key)) suppressions.push(key);
    }
    this.#ordinaryRequired.clear();
    this.#virtualBound.clear();
    this.#active = false;
    return suppressions;
  }
}
