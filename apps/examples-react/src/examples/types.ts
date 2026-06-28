import type { ComponentType } from 'react';

export type ExampleSection = 'primary' | 'labs-prototypes';

export type ExampleDefinition = {
  readonly id: string;
  readonly path: string;
  readonly section: ExampleSection;
  readonly title: string;
  readonly summary: string;
  readonly Demo: ComponentType;
  readonly source: string;
  readonly sourceFile: `cases/${string}.tsx`;
  readonly sourceExport: string;
  readonly probe?: ComponentType;
  readonly notes?: readonly string[];
  readonly visualSmoke: {
    readonly surface: 'canvas' | 'dom';
    readonly canvasLabel?: string;
    readonly readableText: readonly string[];
    readonly minColorBuckets?: number;
    readonly minPaintedRatio?: number;
    readonly textQuality?: {
      readonly acceptanceText: string;
      readonly inputLabel: string;
      readonly roi: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly warnThresholds: {
        readonly minEdgeTransitions: number;
        readonly minForegroundPixels: number;
        readonly minInkCoverage: number;
        readonly minLuminanceBuckets: number;
      };
    };
  };
};

export type ExampleSectionDefinition = {
  readonly id: ExampleSection;
  readonly title: string;
  readonly examples: readonly ExampleDefinition[];
};
