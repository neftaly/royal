export type CpuProfileFrameSummary = {
  readonly columnNumber: number | null;
  readonly functionName: string;
  readonly lineNumber: number | null;
  readonly sampleCount: number;
  readonly selfPercent: number;
  readonly selfTimeMs: number;
  readonly url: string;
};

export type CpuProfileSummary = {
  readonly durationMs: number | null;
  readonly sampleCount: number;
  readonly sampledTimeMs: number;
  readonly scriptSampledTimeMs: number;
  readonly topScriptSelfTime: readonly CpuProfileFrameSummary[];
  readonly topSelfTime: readonly CpuProfileFrameSummary[];
  readonly unresolvedSampleCount: number;
};

export type CpuProfile = {
  readonly endTime?: number;
  readonly nodes?: readonly {
    readonly callFrame?: {
      readonly columnNumber?: number;
      readonly functionName?: string;
      readonly lineNumber?: number;
      readonly url?: string;
    };
    readonly id: number;
  }[];
  readonly samples?: readonly number[];
  readonly startTime?: number;
  readonly timeDeltas?: readonly number[];
};

export declare const summarizeCpuProfile: (
  profile: CpuProfile,
  options?: { readonly limit?: number },
) => CpuProfileSummary;
