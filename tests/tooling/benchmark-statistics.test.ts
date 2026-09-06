import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { frameStats } from "../../apps/examples-react/src/benchmark-statistics";

describe("shared browser benchmark statistics", () => {
  it("reports incomplete and empty samples without mutating input", () => {
    const samples = [30, 10, 20];
    expect(frameStats(samples, 5, 1000)).toMatchObject({
      averageMs: 20,
      p50Ms: 20,
      sampleCount: 3,
      samplesMissing: 2,
      timedOut: true,
      failed: false,
    });
    expect(samples).toEqual([30, 10, 20]);
    expect(frameStats([], 5)).toMatchObject({
      averageMs: 0,
      p95Ms: 0,
      failed: true,
      samplesMissing: 5,
    });
  });

  it("can inject the Node-loaded function into an isolated browser-like realm", () => {
    const source = stripTypeScriptTypes(
      readFileSync("apps/examples-react/src/benchmark-statistics.ts", "utf8"),
    ).replace("export const frameStats", "const frameStats");
    const serialized = runInNewContext(source + "; frameStats.toString()");
    const result = runInNewContext("(" + serialized + ")([10, 20, 30])");
    expect(result).toEqual(frameStats([10, 20, 30]));
  });
});
