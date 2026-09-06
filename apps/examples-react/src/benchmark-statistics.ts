/** Standalone so CDP can inject the same calculation used by the in-browser reporter. */
export const frameStats = (
  deltas: readonly number[],
  requestedSampleCount = deltas.length,
  timeoutMs = 0,
) => {
  const sorted = [...deltas].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const percentile = (ratio: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
  return {
    averageMs: sorted.length === 0 ? 0 : sum / sorted.length,
    failed: sorted.length === 0,
    jitterP95MinusP50Ms: percentile(0.95) - percentile(0.5),
    maxMs: sorted[sorted.length - 1] ?? 0,
    minMs: sorted[0] ?? 0,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    requestedSampleCount,
    sampleCount: sorted.length,
    samplesMissing: Math.max(0, requestedSampleCount - sorted.length),
    timedOut: sorted.length < requestedSampleCount,
    timeoutMs,
  };
};
