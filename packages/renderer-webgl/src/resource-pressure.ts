/** Renderer resource domains reported by root pressure diagnostics. */
export type WebGlResourceClass =
  | "asset-decode"
  | "geometry"
  | "ordinary-texture"
  | "render-target"
  | "virtual-texture";

/** One resource usage sample. Byte-named fields are bytes; `jobs` is a count. */
export interface WebGlResourceUsage {
  readonly cpuDecodedBytes: number;
  readonly jobs: number;
  readonly persistentGpuBytes: number;
  readonly transientPeakBytes: number;
  readonly uploadBytes: number;
}

/** Stable reason categories for resource admission backpressure. */
export type WebGlResourceDenialReason =
  | "cpu-decoded-capacity"
  | "cpu-decoded-hard-limit"
  | "cpu-decoded-mandatory-floor"
  | "job-capacity"
  | "persistent-gpu-capacity"
  | "persistent-gpu-hard-limit"
  | "persistent-gpu-mandatory-floor"
  | "transient-peak-capacity"
  | "upload-capacity";

/** Observable root-wide resource usage, pressure, and admission outcomes. */
export interface WebGlResourcePressureSnapshot {
  readonly admissions: number;
  readonly byClass: Readonly<Record<WebGlResourceClass, WebGlResourceUsage>>;
  readonly denials: number;
  readonly denialsByReason: Readonly<Record<WebGlResourceDenialReason, number>>;
  readonly frame: number;
  readonly highWater: WebGlResourceUsage;
  readonly lastDenial?: {
    readonly reason: WebGlResourceDenialReason;
    readonly resourceClass: WebGlResourceClass;
  };
  readonly limits: WebGlResourceUsage;
  readonly outstandingLeases: number;
  readonly outstandingReservations: number;
  readonly total: WebGlResourceUsage;
}
