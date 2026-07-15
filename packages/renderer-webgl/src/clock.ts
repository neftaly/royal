/** Milliseconds from an arbitrary monotonic origin. */
export type MonotonicClock = () => number;

/** The sole production boundary for renderer duration timestamps. */
export const monotonicNowMs: MonotonicClock = () =>
  globalThis.performance?.now?.() ?? Date.now();
