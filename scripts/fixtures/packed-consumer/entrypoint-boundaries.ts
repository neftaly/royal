// Scene-coordinate vocabulary belongs to the pure authoring entrypoint.
// @ts-expect-error WorldPosition3 is not a React runtime export.
import type { WorldPosition3 } from '@royal/react';

// Injectable browser ports are implementation/test seams, not product API.
// @ts-expect-error BrowserXrSystem is not a React XR product export.
import type { BrowserXrSystem } from '@royal/react/xr';

export type EntrypointBoundaries = readonly [WorldPosition3, BrowserXrSystem];
