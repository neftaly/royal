const COMPACTION_HEAD = 256;

/**
 * FIFO storage that releases consumed references immediately and compacts only
 * at an amortized boundary. Unlike Array.shift(), dequeue does not move every
 * remaining job.
 */
export class RetainedFifo<Value> {
  #head = 0;
  readonly #values: (Value | undefined)[] = [];

  clear(): void {
    this.#values.length = 0;
    this.#head = 0;
  }

  dequeue(): Value | undefined {
    if (this.#head >= this.#values.length) return undefined;
    const value = this.#values[this.#head];
    this.#values[this.#head] = undefined;
    this.#head += 1;
    if (this.#head === this.#values.length) {
      this.clear();
    } else if (this.#head >= COMPACTION_HEAD && this.#head * 2 >= this.#values.length) {
      const retained = this.#values.length - this.#head;
      this.#values.copyWithin(0, this.#head);
      this.#values.length = retained;
      this.#head = 0;
    }
    return value;
  }

  enqueue(value: Value): void {
    this.#values.push(value);
  }
}
