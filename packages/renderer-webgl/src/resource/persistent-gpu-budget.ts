export const DEFAULT_PERSISTENT_GPU_BYTE_BUDGET = 256 * 1024 * 1024;

/** Pure ordinary-texture share after known retained scene storage is reserved. */
export const ordinaryTextureStorageBudget = (
  persistentBudgetBytes: number,
  plannedNonTextureBytes: number,
): number => Math.max(0, Math.min(
  Math.floor(persistentBudgetBytes * 0.75),
  persistentBudgetBytes - plannedNonTextureBytes,
));

export type PersistentGpuBudgetSnapshot = Readonly<{
  textureBudgetBytes?: number;
  textureRetainedBytes?: number;
  textureMigrationReserveBytes?: number;
  /** Immutable persistent allocation ceiling in bytes. */
  budgetBytes: number;
  /** Claims denied during the current WebGL context generation. */
  deniedClaims: number;
  /** Current admitted persistent allocation estimate in bytes. */
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
  #textureBudget: number | undefined;
  #textureBytes = 0;
  #migrationReserve = 0;
  readonly #textures = new Set<object>();

  constructor(budgetBytes = DEFAULT_PERSISTENT_GPU_BYTE_BUDGET) {
    validateBytes(budgetBytes, "persistent GPU byte budget", false);
    this.#budgetBytes = budgetBytes;
  }

  get budgetBytes(): number {
    return this.#budgetBytes;
  }

  /** Currently unclaimed capacity for resource admission; never negative. */
  get availableBytes(): number {
    return this.#budgetBytes - this.#retainedBytes;
  }

  get textureRetainedBytes(): number { return this.#textureBytes; }

  get #textureReserveBytes(): number {
    return Math.min(this.#migrationReserve, Math.floor((this.#textureBudget ?? this.#budgetBytes) / 8));
  }
  get textureBudgetBytes(): number { return Math.max(0, (this.#textureBudget ?? Math.floor(this.#budgetBytes * 0.75)) - this.#textureReserveBytes); }
  get textureAvailableBytes(): number {
    return Math.max(0, Math.min(this.availableBytes, (this.#textureBudget ?? this.#budgetBytes) - this.#textureReserveBytes - this.#textureBytes));
  }

  /** Demand-sized scratch capacity for one coarse-preserving atlas migration. */
  setTextureMigrationReserve(bytes: number): void {
    validateBytes(bytes, "texture migration reserve", true);
    this.#migrationReserve = Math.min(bytes, Math.floor(this.#budgetBytes / 8));
  }

  /** Both allocations remain physically charged until the old atlas is retired. */
  tryClaimTextureReplacement(identity: object, bytes: number, replaced: object): boolean {
    validateBytes(bytes, "texture replacement byte length", true);
    const oldBytes = this.#textures.has(replaced) ? this.#claims.get(replaced) : undefined;
    if (identity === replaced || this.#claims.has(identity) || oldBytes === undefined) return false;
    if (bytes > this.availableBytes || (bytes > oldBytes
      && this.#textureBytes - oldBytes + bytes > this.textureBudgetBytes)) {
      this.#deniedClaims++;
      return false;
    }
    this.#claims.set(identity, bytes);
    this.#textures.add(identity);
    this.#retainedBytes += bytes;
    this.#textureBytes += bytes;
    return true;
  }

  /** Shared ordinary/VT envelope after the scene reserves essential non-texture storage. */
  setTextureBudget(bytes: number): void {
    validateBytes(bytes, "texture budget", true);
    this.#textureBudget = Math.min(bytes, this.#budgetBytes);
  }

  tryClaimTexture(identity: object, bytes: number): boolean {
    validateBytes(bytes, "persistent GPU allocation byte length", true);
    const existing = this.#textures.has(identity);
    if (!existing && this.#textureBytes + bytes > (this.#textureBudget ?? this.#budgetBytes) - this.#textureReserveBytes) {
      this.#deniedClaims++;
      return false;
    }
    const convertedBytes = existing ? 0 : this.#claims.get(identity) ?? 0;
    this.#textureBytes += convertedBytes;
    this.#textures.add(identity);
    if (this.tryClaim(identity, bytes)) return true;
    if (!existing) {
      this.#textures.delete(identity);
      this.#textureBytes -= convertedBytes;
    }
    return false;
  }

  release(identity: object): void {
    const bytes = this.#claims.get(identity);
    if (bytes === undefined) return;
    this.#claims.delete(identity);
    this.#retainedBytes -= bytes;
    if (this.#textures.delete(identity)) this.#textureBytes -= bytes;
  }

  snapshot(): PersistentGpuBudgetSnapshot {
    return {
      budgetBytes: this.#budgetBytes,
      deniedClaims: this.#deniedClaims,
      retainedBytes: this.#retainedBytes,
      ...(this.#textureBudget === undefined ? {} : { textureBudgetBytes: this.textureBudgetBytes, textureRetainedBytes: this.#textureBytes }),
      ...(this.#textureReserveBytes === 0 ? {} : { textureMigrationReserveBytes: this.#textureReserveBytes }),
    };
  }

  tryClaim(identity: object, bytes: number): boolean {
    validateBytes(bytes, "persistent GPU allocation byte length", true);
    const previous = this.#claims.get(identity) ?? 0;
    const nextRetained = this.#retainedBytes - previous + bytes;
    const textureBytes = this.#textureBytes + (this.#textures.has(identity) ? bytes - previous : 0);
    if (!Number.isSafeInteger(nextRetained) || nextRetained > this.#budgetBytes
      || (bytes > previous && this.#textures.has(identity) && textureBytes > (this.#textureBudget ?? this.#budgetBytes) - this.#textureReserveBytes)) {
      this.#deniedClaims += 1;
      return false;
    }
    this.#claims.set(identity, bytes);
    this.#retainedBytes = nextRetained;
    this.#textureBytes = textureBytes;
    return true;
  }
}
