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
  readonly probe?: ComponentType;
  readonly notes?: readonly string[];
};

export type ExampleSectionDefinition = {
  readonly id: ExampleSection;
  readonly title: string;
  readonly examples: readonly ExampleDefinition[];
};
