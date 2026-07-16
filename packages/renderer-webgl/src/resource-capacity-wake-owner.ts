export type ResourceCapacityRelease = Readonly<{
  cpuDecodedBytes: number;
  persistentGpuBytes: number;
}>;

export type ResourceCapacityWakeOwnerOptions = Readonly<{
  invalidate: () => void;
  preparation: readonly (() => void)[];
  wakeCpu: () => boolean;
  wakeGpu: () => boolean;
}>;

/** Owns coalescing and suppression for root-wide resource-capacity wakeups. */
export class ResourceCapacityWakeOwner {
  readonly #options: ResourceCapacityWakeOwnerOptions;
  #cpuWakeScheduled = false;
  #disposed = false;
  #persistentGpuSuppressionDepth = 0;
  #preparationWakeCursor = 0;

  constructor(options: ResourceCapacityWakeOwnerOptions) {
    this.#options = options;
  }

  get persistentGpuWakeSuppressed(): boolean {
    return this.#persistentGpuSuppressionDepth > 0;
  }

  dispose(): void {
    this.#disposed = true;
  }

  notifyCapacityReleased(
    released: ResourceCapacityRelease,
    cpuWakeSuppressed = false,
  ): void {
    if (this.#disposed) return;
    if (released.persistentGpuBytes > 0) this.wakePersistentGpuCapacity();
    if (released.cpuDecodedBytes > 0 && !cpuWakeSuppressed) this.scheduleCpuCapacityWake();
  }

  scheduleCpuCapacityWake(): void {
    if (this.#cpuWakeScheduled || this.#disposed) return;
    this.#cpuWakeScheduled = true;
    queueMicrotask(() => queueMicrotask(() => {
      this.#cpuWakeScheduled = false;
      if (this.#disposed) return;
      if (this.#options.wakeCpu()) this.#options.invalidate();
    }));
  }

  suppressPersistentGpuWake(): () => void {
    this.#persistentGpuSuppressionDepth += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#persistentGpuSuppressionDepth -= 1;
    };
  }

  wakePersistentGpuCapacity(): void {
    if (this.#disposed || this.persistentGpuWakeSuppressed) return;
    if (this.#options.wakeGpu()) this.#options.invalidate();
  }

  wakePreparation(): void {
    const wakes = this.#options.preparation;
    if (this.#disposed || wakes.length === 0) return;
    const start = this.#preparationWakeCursor % wakes.length;
    this.#preparationWakeCursor = (start + 1) % wakes.length;
    for (let offset = 0; offset < wakes.length; offset += 1) {
      wakes[(start + offset) % wakes.length]!();
    }
    this.#options.invalidate();
  }
}
