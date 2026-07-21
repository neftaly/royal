// Scene-coordinate vocabulary belongs to the pure authoring entrypoint.
// @ts-expect-error WorldPosition3 is not a React runtime export.
import type { WorldPosition3 } from '@royal/react';
import type {
  GltfAssetStatusInput,
  PrefilteredEnvironmentStatusInput,
  TextureAssetStatusInput,
} from '@royal/react';

// Injectable browser ports are implementation/test seams, not product API.
// @ts-expect-error BrowserXrSystem is not a React XR product export.
import type { BrowserXrSystem } from '@royal/react/xr';

// Root scheduling and upload policy are available through aggregate diagnostics,
// not as standalone product types.
// @ts-expect-error AsyncPreparationSnapshot is renderer implementation vocabulary.
import type { AsyncPreparationSnapshot } from '@royal/renderer-webgl';
// @ts-expect-error FrameUploadBudgetSnapshot is renderer implementation vocabulary.
import type { FrameUploadBudgetSnapshot } from '@royal/renderer-webgl';

// Focused observation advertises content identity, not ignored scene presentation.
// A descriptor variable remains structurally compatible, as exercised by app.tsx.
// @ts-expect-error Bounds do not participate in glTF status identity.
const gltfStatusWithBounds: GltfAssetStatusInput = { bounds: { max: [1, 1, 1], min: [0, 0, 0] }, src: '/scene.glb' };
// @ts-expect-error Color space does not participate in decoded texture status identity.
const textureStatusWithColorSpace: TextureAssetStatusInput = { colorSpace: 'srgb', src: '/albedo.png' };
// @ts-expect-error Rotation does not participate in environment loading status identity.
const environmentStatusWithRotation: PrefilteredEnvironmentStatusInput = { rotation: [0, 0, 0], src: '/studio.ktx' };
void gltfStatusWithBounds;
void textureStatusWithColorSpace;
void environmentStatusWithRotation;

export type EntrypointBoundaries = readonly [
  WorldPosition3,
  BrowserXrSystem,
  AsyncPreparationSnapshot,
  FrameUploadBudgetSnapshot,
];
