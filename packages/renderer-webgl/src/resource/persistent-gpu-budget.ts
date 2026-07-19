export const DEFAULT_PERSISTENT_GPU_BYTE_BUDGET = 512 * 1024 * 1024;

export type PersistentGpuBudgetSnapshot = Readonly<{
  budgetBytes: number;
  deniedClaims: number;
  retainedBytes: number;
}>;

const validateBytes = (bytes: number, label: string, allowZero: boolean): void => {
  if (!Number.isSafeInteger(bytes) || bytes < (allowZero ? 0 : 1)) {
    throw new RangeError(`Royal ${label} must be ${allowZero ? "a non-negative" : "a positive"} safe integer`);
  }
};

/** Root-owned admission authority for persistent allocations in one WebGL generation. */
export class PersistentGpuBudgetOwner {
  readonly #budgetBytes: number;
  readonly #claims = new Map<object, number>();
  #deniedClaims = 0;
  #retainedBytes = 0;

  constructor(budgetBytes = DEFAULT_PERSISTENT_GPU_BYTE_BUDGET) {
    validateBytes(budgetBytes, "persistent GPU byte budget", false);
    this.#budgetBytes = budgetBytes;
  }

  release(identity: object): void {
    const bytes = this.#claims.get(identity);
    if (bytes === undefined) return;
    this.#claims.delete(identity);
    this.#retainedBytes -= bytes;
  }

  snapshot(): PersistentGpuBudgetSnapshot {
    return {
      budgetBytes: this.#budgetBytes,
      deniedClaims: this.#deniedClaims,
      retainedBytes: this.#retainedBytes,
    };
  }

  tryClaim(identity: object, bytes: number): boolean {
    validateBytes(bytes, "persistent GPU allocation byte length", true);
    const previous = this.#claims.get(identity) ?? 0;
    const nextRetained = this.#retainedBytes - previous + bytes;
    if (!Number.isSafeInteger(nextRetained) || nextRetained > this.#budgetBytes) {
      this.#deniedClaims += 1;
      return false;
    }
    this.#claims.set(identity, bytes);
    this.#retainedBytes = nextRetained;
    return true;
  }
}
