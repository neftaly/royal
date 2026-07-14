export type ResourceArenaSideEffectPhase = "acquire" | "release";

type ResourceArenaSideEffectDebt = {
  nextStep: number;
  readonly phase: ResourceArenaSideEffectPhase;
  readonly steps: readonly (() => void)[];
};

type CapturedFailure = { readonly value: unknown };

const captureFailure = (action: () => void): CapturedFailure | undefined => {
  try {
    action();
    return undefined;
  } catch (value) {
    return { value };
  }
};

/**
 * Owns ordered, retryable imperative work produced by committed resource-arena
 * changes. Successful steps are never replayed, even when a later step fails.
 */
export class ResourceArenaSideEffectDebtOwner {
  #acquisitionsCancelled = false;
  #debt: ResourceArenaSideEffectDebt[] = [];
  #draining = false;

  get draining(): boolean {
    return this.#draining;
  }

  enqueue(
    phase: ResourceArenaSideEffectPhase,
    ...steps: readonly (() => void)[]
  ): void {
    if (phase === "acquire" && this.#acquisitionsCancelled) return;
    this.#debt.push({ nextStep: 0, phase, steps });
  }

  drain(): void {
    if (this.#draining || this.#debt.length === 0) return;
    const pending = this.#debt;
    this.#debt = [];
    this.#draining = true;
    let firstFailure: CapturedFailure | undefined;
    const remaining: ResourceArenaSideEffectDebt[] = [];
    try {
      for (const operation of pending) {
        if (operation.phase === "acquire" && this.#acquisitionsCancelled) continue;
        while (operation.nextStep < operation.steps.length) {
          const failure = captureFailure(operation.steps[operation.nextStep]!);
          if (failure !== undefined) {
            firstFailure ??= failure;
            if (!(operation.phase === "acquire" && this.#acquisitionsCancelled)) {
              remaining.push(operation);
            }
            break;
          }
          operation.nextStep += 1;
          if (operation.phase === "acquire" && this.#acquisitionsCancelled) break;
        }
      }
    } finally {
      this.#draining = false;
      this.#debt = [...remaining, ...this.#debt];
    }
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  /**
   * Prevents committed acquisition work from resurrecting resources after the
   * semantic arena has been disposed. Release debt remains retryable.
   */
  cancelAcquisitions(): void {
    this.#acquisitionsCancelled = true;
    this.#debt = this.#debt.filter((operation) => operation.phase !== "acquire");
  }
}
