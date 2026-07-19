export type BrowserBenchmarkWarningInput = Readonly<{
  canvasPresent: boolean;
  ready: boolean;
  rendererPresent: boolean;
  stats: Readonly<{
    requestedSampleCount: number;
    sampleCount: number;
    timedOut: boolean;
  }>;
  warmupComplete: boolean;
  webglPresent: boolean;
}>;

/** Pure benchmark completeness policy shared by the browser reporter and tests. */
export const benchmarkWarnings = ({
  canvasPresent,
  ready,
  rendererPresent,
  stats,
  warmupComplete,
  webglPresent,
}: BrowserBenchmarkWarningInput): readonly string[] => {
  const warnings: string[] = [];
  if (!ready) warnings.push('Document/canvas readiness timed out before sampling');
  if (!warmupComplete) warnings.push('Warmup timed out before sampling');
  if (stats.timedOut) {
    warnings.push(`Captured ${stats.sampleCount}/${stats.requestedSampleCount} requested frames`);
  }
  if (!canvasPresent) warnings.push('Canvas disappeared before benchmark finalization');
  if (!webglPresent) warnings.push('WebGL context was unavailable at benchmark finalization');
  if (!rendererPresent) warnings.push('Renderer snapshot was unavailable at benchmark finalization');
  return warnings;
};
