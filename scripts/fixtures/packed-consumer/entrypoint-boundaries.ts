// Scene-coordinate vocabulary belongs to the pure authoring entrypoint.
// @ts-expect-error WorldPosition3 is not a React runtime export.
import type { WorldPosition3 } from '@royal/react';

// Injectable browser ports are implementation/test seams, not product API.
// @ts-expect-error BrowserXrSystem is not a React XR product export.
import type { BrowserXrSystem } from '@royal/react/xr';

// Root scheduling and upload policy are available through aggregate diagnostics,
// not as standalone product types.
// @ts-expect-error AsyncPreparationSnapshot is renderer implementation vocabulary.
import type { AsyncPreparationSnapshot } from '@royal/renderer-webgl';
// @ts-expect-error FrameUploadBudgetSnapshot is renderer implementation vocabulary.
import type { FrameUploadBudgetSnapshot } from '@royal/renderer-webgl';

export type EntrypointBoundaries = readonly [
  WorldPosition3,
  BrowserXrSystem,
  AsyncPreparationSnapshot,
  FrameUploadBudgetSnapshot,
];
