export {
  Canvas,
  useCanvasElement,
  useCanvasPick,
  useCanvasRoot,
  useInvalidate,
} from './canvas';
export type { CanvasContextOptions, CanvasProps } from './canvas';
export type { CanvasInteractions } from './scene-interactions';
export type {
  SolidTextureOptions,
  SolidTextureRef,
  TextureAssetOptions,
  TextureAssetRef,
  TextureColorSpace,
  TextureContentKey,
  TextureRef,
  TextureSampler,
  TextureSamplerFilter,
  TextureSamplerWrap,
  TextureVersion,
  VirtualTextureAssetOptions,
  VirtualTextureAssetRef,
} from '@royal/renderer-core';

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
  OrbitVector3,
  UseOrbitCameraOptions,
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
  RoyalRendererRootContextOptions,
  RoyalRendererRootContextSnapshot,
  RoyalRendererRootLifecycle,
  RoyalRendererRootLifecycleSnapshot,
  RoyalRendererRootOptions,
  RoyalRendererRootRenderInput,
  RoyalRendererRootSnapshot,
} from './root';
