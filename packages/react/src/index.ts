import { Canvas as CanvasComponent } from './canvas';
import { OrbitControls as OrbitControlsComponent } from './orbit-controls';
import { markReactComponent } from './jsx-runtime';

export { canvasPointToWorld, worldPointToCanvasClient } from './canvas-coordinate';
export { useCanvasElement } from './canvas';
export { captureCanvasPointer, releaseCanvasPointer } from './canvas-pointer';
export { editableTextKeyboardIntent } from './editable-text-keyboard';
export { createOrbitControls, orbitCameraTransform } from './orbit-controls';
export { createRoot } from './root';
export { useFrame } from './frame';

export const Canvas = markReactComponent(CanvasComponent);
export const OrbitControls = markReactComponent(OrbitControlsComponent);

export type { CanvasProps } from './canvas';
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
  OrbitCameraTransform,
  OrbitCameraView,
  OrbitControlsHandle,
  OrbitControlsOptions,
  OrbitControlsProps,
  OrbitVector3
} from './orbit-controls';
export type { RoyalRoot, RoyalRootContextOptions, RoyalRootOptions } from './root';
