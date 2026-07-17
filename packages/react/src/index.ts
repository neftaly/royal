export {
  Canvas,
  useCanvasElement,
  useCanvasPick,
  useCanvasRoot,
  useInvalidate,
} from './canvas';
export type { CanvasProps } from './canvas';
export type { AssetStatusOptions } from './asset-status-root';
export { useCanvasSize } from './canvas-size';
export type { CanvasSize, CanvasSizeOptions } from './canvas-size';
export type { ScenePointerEvents } from './interaction/scene-interactions';
export type {
  GltfInstancesPickTarget,
  GltfPickTarget,
  MeshPickTarget,
  PickInput,
  PickingId,
  PickResult,
  PickTarget,
} from '@royal/renderer-core';
export { useFrame } from './frame';
export type { FrameCallback, FrameSnapshot, UseFrameOptions } from './frame';

export { useGltfAssetStatus } from './gltf-status';
export type {
  GltfAssetStatus,
  GltfAssetStatusInput,
} from './gltf-status';

export { useTextureAssetStatus } from './texture-status';
export type {
  TextureAssetStatus,
  TextureAssetStatusInput,
} from './texture-status';

export { useRendererLifecycle } from './renderer-lifecycle';
export { useRendererDiagnostics } from './renderer-diagnostics';

export {
  OrbitControls,
} from './orbit/controls';
export {
  useOrbitCamera,
  useOrbitCameraView,
} from './orbit/camera-controller';
export type {
  OrbitCameraController,
  OrbitCameraProjection,
  UseOrbitCameraOptions,
} from './orbit/camera-controller';
export type {
  OrbitCameraView,
  OrbitCameraViewOptions,
  OrbitControlsBehaviorOptions,
  OrbitControlsProps,
  WorldPosition3,
} from './orbit/controls';

export type {
  RoyalPointerEvent,
  RoyalPointerEventHandler,
  RoyalPointerEventHandlers,
  RoyalPointerEventType,
} from './interaction/picking-events';

export { createRendererRoot } from './root';
export type {
  RoyalRendererRoot,
  RoyalRendererDiagnosticLog,
  RoyalRendererDiagnosticMessage,
  RoyalRendererGltfAssetSnapshot,
  RoyalRendererGltfImageFailure,
  RoyalRendererGltfImageProgress,
  RoyalRendererGltfPhaseTimings,
  RoyalRendererGltfSceneStatistics,
  RoyalRendererDiagnosticsSnapshot,
  RoyalRendererGltfInstancingDiagnosticsSnapshot,
  RoyalRendererGltfLoadDiagnosticsSnapshot,
  RoyalRendererPickingDiagnosticsSnapshot,
  RoyalRendererPlanningDiagnosticsSnapshot,
  RoyalRendererResourceLifetimeDiagnosticsSnapshot,
  RoyalRendererResourcePressureDiagnosticsSnapshot,
  RoyalRendererRootLifecycle,
  RoyalRendererRootLifecycleSnapshot,
  RoyalRendererTextureResidencyDiagnosticsSnapshot,
  RoyalRendererTextureAssetSnapshot,
  RoyalRendererVirtualTexturingDiagnosticsSnapshot,
  RendererOptions,
  RendererResourceBudgetOptions,
  RendererResourceBudgets,
  ResolvedRendererOptions,
  RoyalRendererRootSnapshot,
} from './root';
