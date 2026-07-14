export {
  Canvas,
  useCanvasElement,
  useCanvasPick,
  useCanvasRoot,
  useInvalidate,
} from './canvas';
export type { CanvasProps } from './canvas';
export type { ScenePointerEvents } from './scene-interactions';
export type {
  PickInput,
  PickingId,
  PickResult,
  PickTarget,
} from '@royal/renderer-core';
export type {
  ResourceGovernorClassPolicy,
  ResourceGovernorDurableBudget,
  ResourceGovernorPolicy,
  ResourceGovernorPolicyInput,
} from '@royal/renderer-webgl';
export {
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  defineResourceGovernorPolicy,
} from '@royal/renderer-webgl';

export { useFrame } from './frame';
export type { FrameCallback, FrameSnapshot } from './frame';

export { useGltfAssetStatus } from './gltf-status';
export type {
  GltfAssetLoadState,
  GltfAssetStatus,
  GltfAssetStatusInput,
} from './gltf-status';

export {
  OrbitControls,
  useOrbitCamera,
  useOrbitCameraView,
} from './orbit-controls';
export type {
  OrbitCameraController,
  OrbitCameraHookResult,
  OrbitCameraView,
  OrbitCameraViewOptions,
  OrbitControlsBehaviorOptions,
  OrbitControlsProps,
  UseOrbitCameraOptions,
  WorldPosition3,
} from './orbit-controls';

export type {
  RoyalPointerEvent,
  RoyalPointerEventHandler,
  RoyalPointerEventProps,
  RoyalPointerEventType,
} from './picking-events';

export { createRendererRoot } from './root';
export type {
  RoyalRendererRoot,
  RoyalRendererDiagnosticsSnapshot,
  RoyalRendererRootLifecycle,
  RoyalRendererRootLifecycleSnapshot,
  RendererOptions,
  ResolvedRendererOptions,
  RoyalRendererRootSnapshot,
} from './root';
