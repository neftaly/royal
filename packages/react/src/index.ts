export {
  Canvas,
  useCanvasElement,
  useCanvasPick,
  useCanvasRoot,
  useInvalidate,
} from './canvas';
export type { CanvasProps } from './canvas';
export type { CanvasInteractions } from './scene-interactions';
export type {
  PickInput,
  PickingId,
  PickResult,
  PickTarget,
  SolidTextureOptions,
  SolidTextureRef,
  TextureAssetOptions,
  TextureAssetRef,
  TextureAssetSrcOptions,
  TextureAssetUriOptions,
  TextureColorSpace,
  TextureContentKey,
  TextureRef,
  TextureSampler,
  TextureSamplerFilter,
  TextureSamplerWrap,
  TextureVersion,
  VirtualTextureAssetOptions,
  VirtualTextureAssetManifestOptions,
  VirtualTextureAssetRef,
  VirtualTextureAssetSrcOptions,
  VirtualTextureInput,
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
