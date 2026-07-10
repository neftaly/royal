import { Canvas as CanvasComponent } from './canvas';
import { OrbitControls as OrbitControlsComponent } from './orbit-controls';
import {
  TextFontProvider as TextFontProviderComponent,
  TextSurface as TextSurfaceComponent
} from './text/surface';

export {
  createGltfInstanceTransforms,
} from '@royal/renderer-core';
export type {
  CreateGltfInstanceTransformsOptions,
  GltfInstanceTransforms,
  GltfInstancesPickTarget,
  GltfPickTarget,
  MeshPickTarget,
  PickInput,
  PickingId,
  PickResult,
  PickTarget,
} from '@royal/renderer-core';
export { createTextFontFace, createTextFontFaceAsync } from '@royal/renderer-core/text/font';
export type {
  CreateTextFontFaceOptions,
  TextFontData,
  TextFontDescriptor,
  TextFontFace,
  TextFontMetrics
} from '@royal/renderer-core/text/font';
export type {
  RenderObjectHandle,
  RenderObjectRef,
  RenderObjectRefCallback,
  RenderObjectRefObject,
  RenderObjectTransformUpdate,
  RenderObjectVector3
} from '@royal/renderer-core';
export { canvasPointToWorld, worldPointToCanvasClient } from './canvas-coordinate';
export { useCanvasElement, useCanvasPick, useCanvasRoot, useInvalidate } from './canvas';
export { captureCanvasPointer, releaseCanvasPointer } from './canvas-pointer';
export { editableTextKeyboardIntent } from './text/editable-keyboard';
export {
  createOrbitCameraStore,
  createOrbitControls,
  orbitCameraTransform,
  orbitPerspectiveCamera,
  resolveOrbitCameraView,
  useOrbitCamera,
  useOrbitCameraView
} from './orbit-controls';
export { createRendererRoot, webGlRootForRoyalRoot } from './root';
export {
  Button,
  Input,
  Text,
  Textarea,
  textFieldHeight,
  useTextFont
} from './text/surface';
export { useFrame, useFrameIndex } from './frame';
export type { FrameCallback, FrameSnapshot } from './frame';
export type {
  RoyalPointerEvent,
  RoyalPointerEventHandler,
  RoyalPointerEventProps,
  RoyalPointerEventType
} from './picking-events';

export const Canvas = CanvasComponent;
export const OrbitControls = OrbitControlsComponent;
export const TextFontProvider = TextFontProviderComponent;
export const TextSurface = TextSurfaceComponent;

export type { CanvasProps, CanvasRendererOptions } from './canvas';
export type { CanvasWorldBounds } from './canvas-coordinate';
export type {
  ButtonProps,
  CheckboxInputProps,
  ColorInputProps,
  FileInputProps,
  InputProps,
  TextareaProps,
  TextFontProviderProps,
  TextFieldHeightOptions,
  TextFieldProps,
  TextInputProps,
  TextInteractionStyle,
  TextSurfaceControlStyle,
  TextProps,
  TextSurfaceBox,
  TextSurfaceProps
} from './text/surface';
export type {
  EditableTextClipboardShortcut,
  EditableTextClipboardShortcutIntent,
  EditableTextEnterKeyIntent,
  EditableTextKeyboardInput,
  EditableTextKeyboardIntent,
  EditableTextKeyboardMode,
  EditableTextKeyboardOptions
} from './text/editable-keyboard';
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
  RoyalRendererBackendRoot,
  RoyalRendererBackendRootFactory,
  RoyalRendererBackendRootOptions,
  RoyalRendererRoot,
  RoyalRendererRootContextOptions,
  RoyalRendererRootContextSnapshot,
  RoyalRendererRootOptions,
  RoyalRendererRootRenderInput,
  RoyalRendererRootSnapshot
} from './root';
