/** Retryable frame-local CPU-to-GPU upload contention. */
export class GpuUploadCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpuUploadCapacityError";
  }
}
