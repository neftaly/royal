import { describe, expect, it } from "vitest";
import { summarizeCpuProfile } from "../apps/examples-react/scripts/cpu-profile-summary.mjs";

describe("examples CPU profile summary", () => {
  it("aggregates sampled self-time by source frame without CDP state", () => {
    const summary = summarizeCpuProfile({
      endTime: 5_000,
      nodes: [
        { callFrame: { columnNumber: 3, functionName: "render", lineNumber: 9, url: "app.js" }, id: 1 },
        { callFrame: { columnNumber: -1, functionName: "(idle)", lineNumber: -1, url: "" }, id: 2 },
        { callFrame: { columnNumber: 3, functionName: "render", lineNumber: 9, url: "app.js" }, id: 3 },
      ],
      samples: [1, 2, 3],
      startTime: 1_000,
      timeDeltas: [100, 400, 200],
    });

    expect(summary).toMatchObject({
      durationMs: 4,
      sampleCount: 3,
      sampledTimeMs: 0.7,
      scriptSampledTimeMs: 0.3,
      unresolvedSampleCount: 0,
    });
    expect(summary.topSelfTime).toMatchObject([
      {
        columnNumber: null,
        functionName: "(idle)",
        lineNumber: null,
        sampleCount: 1,
        selfTimeMs: 0.4,
        url: "",
      },
      {
        columnNumber: 4,
        functionName: "render",
        lineNumber: 10,
        sampleCount: 2,
        selfTimeMs: 0.3,
        url: "app.js",
      },
    ]);
    expect(summary.topSelfTime[0]?.selfPercent).toBeCloseTo(400 / 7);
    expect(summary.topSelfTime[1]?.selfPercent).toBeCloseTo(300 / 7);
    expect(summary.topScriptSelfTime).toMatchObject([{
      functionName: "render",
      selfPercent: 100,
      selfTimeMs: 0.3,
    }]);
  });

  it("reports unresolved samples and rejects invalid limits", () => {
    expect(summarizeCpuProfile({
      nodes: [],
      samples: [99],
      timeDeltas: [250],
    })).toMatchObject({ sampledTimeMs: 0.25, unresolvedSampleCount: 1 });
    expect(() => summarizeCpuProfile({ nodes: [], samples: [], timeDeltas: [] }, { limit: 0 }))
      .toThrow("positive");
  });
});
