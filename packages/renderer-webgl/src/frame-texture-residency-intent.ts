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
    if (!this.#active) return [];
    const suppressions: string[] = [];
    if (commit) {
      for (const key of this.#virtualBound) {
        if (!this.#ordinaryRequired.has(key)) suppressions.push(key);
      }
    }
    this.#ordinaryRequired.clear();
    this.#virtualBound.clear();
    this.#active = false;
    return suppressions;
  }
}
