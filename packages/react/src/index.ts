import { Canvas as CanvasComponent } from './canvas';
import { OrbitControls as OrbitControlsComponent } from './orbit-controls';
import { markReactComponent } from './jsx-runtime';

export type { PickInput, PickingId, PickResult, PickTarget } from '@royal/renderer-core';
export { canvasPointToWorld, worldPointToCanvasClient } from './canvas-coordinate';
export { useCanvasElement, useCanvasPick, useCanvasRoot } from './canvas';
export { captureCanvasPointer, releaseCanvasPointer } from './canvas-pointer';
export { editableTextKeyboardIntent } from './editable-text-keyboard';
export { createOrbitControls, orbitCameraTransform, orbitPerspectiveCamera } from './orbit-controls';
export { createRoot } from './root';
export { useFrame, useFrameIndex } from './frame';
export { AutoLod, markRendererComponent } from './jsx-runtime';
export type { AutoLodProps } from './jsx-runtime';
export type { FrameCallback, FrameSnapshot } from './frame';

export const Canvas = markReactComponent(CanvasComponent);
export const OrbitControls = markReactComponent(OrbitControlsComponent);

export type { CanvasProps, CanvasRendererOptions } from './canvas';
export type { CanvasWorldBounds } from './canvas-coordinate';
export type {
  EditableTextClipboardShortcut,
  EditableTextClipboardShortcutIntent,
  EditableTextEnterKeyIntent,
  EditableTextKeyboardInput,
  EditableTextKeyboardIntent,
  EditableTextKeyboardMode,
  EditableTextKeyboardOptions
} from './editable-text-keyboard';
export type {
  OrbitControlsBehaviorOptions,
  OrbitCameraTransform,
  OrbitCameraView,
  OrbitControlsHandle,
  OrbitControlsOptions,
  OrbitControlsProps,
  OrbitPerspectiveCameraOptions,
  OrbitVector3
} from './orbit-controls';
export type {
  RoyalRendererBackend,
  RoyalRoot,
  RoyalRootContextOptions,
  RoyalRootContextSnapshot,
  RoyalRootOptions,
  RoyalRootRenderInput,
  RoyalRootSnapshot
} from './root';
