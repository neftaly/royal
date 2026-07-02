import { Canvas as CanvasComponent } from './canvas';
import { OrbitControls as OrbitControlsComponent } from './orbit-controls';
import { markReactComponent } from './jsx-runtime';
import { TextSurface as TextSurfaceComponent } from './text-surface';

export type { PickInput, PickingId, PickResult, PickTarget } from '@royal/renderer-core';
export type {
  RenderObjectHandle,
  RenderObjectRef,
  RenderObjectRefCallback,
  RenderObjectRefObject,
  RenderObjectTransformUpdate,
  RenderObjectVector3
} from '@royal/renderer-core';
export { canvasPointToWorld, worldPointToCanvasClient } from './canvas-coordinate';
export { useCanvasElement, useCanvasPick, useCanvasRoot } from './canvas';
export { captureCanvasPointer, releaseCanvasPointer } from './canvas-pointer';
export { editableTextKeyboardIntent } from './editable-text-keyboard';
export {
  createOrbitCameraStore,
  createOrbitControls,
  orbitCameraTransform,
  orbitPerspectiveCamera,
  resolveOrbitCameraView,
  useOrbitCamera,
  useOrbitCameraView
} from './orbit-controls';
export { createRoot } from './root';
export { ButtonPrimitive, TextPrimitive, InputPrimitive, TextareaPrimitive, textFieldHeight } from './text-surface';
export { useFrame, useFrameIndex } from './frame';
export { markRendererComponent } from './jsx-runtime';
export type { FrameCallback, FrameSnapshot } from './frame';
export type {
  RoyalPointerEvent,
  RoyalPointerEventHandler,
  RoyalPointerEventProps,
  RoyalPointerEventType
} from './picking-events';

export const Canvas = markReactComponent(CanvasComponent);
export const OrbitControls = markReactComponent(OrbitControlsComponent);
export const TextSurface = markReactComponent(TextSurfaceComponent);

export type { CanvasProps, CanvasRendererOptions } from './canvas';
export type { CanvasWorldBounds } from './canvas-coordinate';
export type {
  ButtonPrimitiveProps,
  CheckboxInputPrimitiveProps,
  ColorInputPrimitiveProps,
  FileInputPrimitiveProps,
  InputPrimitiveProps,
  TextAreaPrimitiveProps,
  TextFieldHeightOptions,
  TextFieldPrimitiveProps,
  TextInputPrimitiveProps,
  TextInteractionStyle,
  TextSurfaceControlStyle,
  TextPrimitiveProps,
  TextSurfaceBox,
  TextSurfaceProps
} from './text-surface';
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
  OrbitCameraHookResult,
  OrbitCameraState,
  OrbitCameraStore,
  OrbitCameraTransform,
  OrbitCameraView,
  OrbitCameraViewOptions,
  OrbitControlsHandle,
  OrbitControlsOptions,
  OrbitControlsProps,
  OrbitPerspectiveCameraOptions,
  OrbitVector3,
  UseOrbitCameraOptions
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
