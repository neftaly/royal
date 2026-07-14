import { describe, expect, it } from "vitest";
import { benchmarkWarnings } from "../apps/examples-react/src/examples/BrowserBenchmarkReporter";

const completeStats = {
  averageMs: 16,
  complete: true,
  failed: false,
  jitterP95MinusP50Ms: 0,
  maxMs: 16,
  minMs: 16,
  p50Ms: 16,
  p95Ms: 16,
  p99Ms: 16,
  requestedSampleCount: 2,
  sampleCount: 2,
  samplesMissing: 0,
  timedOut: false,
  timeoutMs: 1_000,
};

describe("examples browser benchmark readiness", () => {
  it("requires final canvas, WebGL, and renderer evidence", () => {
    expect(benchmarkWarnings({
      canvasPresent: false,
      ready: true,
      rendererPresent: false,
      stats: completeStats,
      warmupComplete: true,
      webglPresent: false,
    })).toEqual([
      "Canvas disappeared before benchmark finalization",
      "WebGL context was unavailable at benchmark finalization",
      "Renderer snapshot was unavailable at benchmark finalization",
    ]);
  });

  it("keeps a complete renderer sample warning-free", () => {
    expect(benchmarkWarnings({
      canvasPresent: true,
      ready: true,
      rendererPresent: true,
      stats: completeStats,
      warmupComplete: true,
      webglPresent: true,
    })).toEqual([]);
  });
});
