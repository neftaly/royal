import {
  type OrbitCameraView,
  type OrbitCameraViewOptions,
  type Metres,
  type Rads,
} from "@royal/renderer-core";
import { captureCanvasPointer, releaseCanvasPointer } from "./canvas-pointer";
import { createOrbitGestureController } from "./orbit-controls-core";

export type OrbitControlsBehaviorOptions = {
  /** Enables all configured camera gestures. @defaultValue `true` */
  readonly enabled?: boolean | undefined;
  /** Enables modified/middle/right-button drag panning. @defaultValue `true` */
  readonly enablePan?: boolean | undefined;
  /** Enables primary-button drag orbiting. @defaultValue `true` */
  readonly enableRotate?: boolean | undefined;
  /** Enables wheel and two-pointer pinch zoom. @defaultValue `true` */
  readonly enableZoom?: boolean | undefined;
  /** Maximum orbit distance in metres. */
  readonly maxDistance?: Metres | undefined;
  /** Maximum pitch in radians. */
  readonly maxPitch?: Rads | undefined;
  /**
   * Minimum camera-to-target distance in metres. Keep the camera's `near`
   * clipping distance smaller when the target lies on the viewed surface.
   */
  readonly minDistance?: Metres | undefined;
  /** Minimum pitch in radians. */
  readonly minPitch?: Rads | undefined;
  /** Called after a gesture commits a changed, clamped view. */
  readonly onChange?: ((view: OrbitCameraView) => void) | undefined;
  /** Target displacement ratio per CSS pixel, scaled by orbit distance. */
  readonly panSpeed?: number | undefined;
  /** Radians per CSS pixel. */
  readonly rotateSpeed?: number | undefined;
  /** Exponential zoom coefficient per CSS pixel. */
  readonly zoomSpeed?: number | undefined;
};

export type OrbitControlsHandle = {
  dispose(): void;
  getView(): OrbitCameraView;
  setOptions(options: OrbitControlsBehaviorOptions): void;
  setView(
    view: OrbitCameraViewOptions,
    options?: OrbitControlsSetViewOptions,
  ): void;
};

export type OrbitControlsSetViewOptions = {
  /** Applies the configured distance and pitch constraints. @defaultValue `true` */
  readonly clamp?: boolean | undefined;
  /** Calls the configured `onChange` handler when the view changes. @defaultValue `true` */
  readonly emitChange?: boolean | undefined;
};

export type OrbitControlsOptions = OrbitControlsBehaviorOptions & {
  /** View used to initialize this imperative controls instance. */
  readonly initialView: OrbitCameraViewOptions;
};

const behaviorOptionNames = new Set<string>([
  "enabled",
  "enablePan",
  "enableRotate",
  "enableZoom",
  "maxDistance",
  "maxPitch",
  "minDistance",
  "minPitch",
  "onChange",
  "panSpeed",
  "rotateSpeed",
  "zoomSpeed",
]);
const creationOptionNames = new Set<string>([...behaviorOptionNames, "initialView"]);

const optionObject = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const validateOptionNames = (
  options: Record<string, unknown>,
  names: ReadonlySet<string>,
  label: string,
): void => {
  for (const name of Object.keys(options)) {
    if (!names.has(name)) {
      throw new TypeError(`${label} contain unsupported option ${JSON.stringify(name)}`);
    }
  }
};

const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
};

const optionalFiniteNumber = (value: unknown, label: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
};

const optionalChangeHandler = (
  value: unknown,
): OrbitControlsBehaviorOptions["onChange"] => {
  if (value !== undefined && typeof value !== "function") {
    throw new TypeError("OrbitControls onChange must be a function");
  }
  return value as OrbitControlsBehaviorOptions["onChange"];
};

export const orbitControlsBehaviorOptionsFrom = (
  options: OrbitControlsBehaviorOptions,
): OrbitControlsBehaviorOptions => {
  const {
    enabled,
    enablePan,
    enableRotate,
    enableZoom,
    maxDistance,
    maxPitch,
    minDistance,
    minPitch,
    onChange,
    panSpeed,
    rotateSpeed,
    zoomSpeed,
  } = optionObject(options, "OrbitControls options") as OrbitControlsBehaviorOptions;
  return {
    enabled: optionalBoolean(enabled, "OrbitControls enabled"),
    enablePan: optionalBoolean(enablePan, "OrbitControls enablePan"),
    enableRotate: optionalBoolean(enableRotate, "OrbitControls enableRotate"),
    enableZoom: optionalBoolean(enableZoom, "OrbitControls enableZoom"),
    maxDistance,
    maxPitch,
    minDistance,
    minPitch,
    onChange: optionalChangeHandler(onChange),
    panSpeed: optionalFiniteNumber(panSpeed, "OrbitControls panSpeed"),
    rotateSpeed: optionalFiniteNumber(rotateSpeed, "OrbitControls rotateSpeed"),
    zoomSpeed: optionalFiniteNumber(zoomSpeed, "OrbitControls zoomSpeed"),
  };
};

const setViewOptionsFrom = (
  options: OrbitControlsSetViewOptions | undefined,
): { readonly clamp: boolean; readonly emitChange: boolean } => {
  if (options === undefined) return { clamp: true, emitChange: true };
  const value = optionObject(options, "OrbitControls setView options");
  for (const key of Object.keys(value)) {
    if (key !== "clamp" && key !== "emitChange") {
      throw new TypeError(`OrbitControls setView options contain unsupported option ${JSON.stringify(key)}`);
    }
  }
  return {
    clamp: optionalBoolean(value.clamp, "OrbitControls setView clamp") ?? true,
    emitChange: optionalBoolean(value.emitChange, "OrbitControls setView emitChange") ?? true,
  };
};

const wheelDeltaPixels = (event: WheelEvent): number => {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * Math.max(1, globalThis.innerHeight || 800);
  return event.deltaY;
};

export const createOrbitControls = (
  canvas: HTMLCanvasElement,
  options: OrbitControlsOptions,
): OrbitControlsHandle => {
  const creationOptions = optionObject(options, "OrbitControls options");
  validateOptionNames(creationOptions, creationOptionNames, "OrbitControls options");
  if (options.initialView === undefined) {
    throw new TypeError("OrbitControls initialView is required");
  }
  let behaviorOptions = orbitControlsBehaviorOptionsFrom(options);
  const core = createOrbitGestureController(options.initialView, behaviorOptions);
  const startDrag = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    const decision = core.pointerDown({
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      modified: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
      pointerId: event.pointerId,
    });
    if (decision.preventDefault) event.preventDefault();
    if (decision.capture !== undefined) captureCanvasPointer(canvas, decision.capture);
  };
  const moveDrag = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    const decision = core.pointerMove(event);
    if (decision.preventDefault) event.preventDefault();
  };
  const endDrag = (event: PointerEvent): void => {
    const decision = core.pointerEnd(event.pointerId);
    if (decision.release !== undefined) releaseCanvasPointer(canvas, decision.release);
  };
  const zoomView = (event: WheelEvent): void => {
    if (!event.defaultPrevented && core.wheel(wheelDeltaPixels(event))) event.preventDefault();
  };
  const blockContextMenu = (event: MouseEvent): void => {
    if (!event.defaultPrevented && core.contextMenu()) event.preventDefault();
  };
  const canvasStyle = canvas.style as CSSStyleDeclaration | undefined;
  const previousTouchAction = canvasStyle?.touchAction;
  const updateTouchAction = (): void => {
    if (canvasStyle === undefined) return;
    canvasStyle.touchAction = behaviorOptions.enabled === false
      ? previousTouchAction ?? ""
      : "none";
  };
  updateTouchAction();

  canvas.addEventListener("contextmenu", blockContextMenu);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerdown", startDrag);
  canvas.addEventListener("pointermove", moveDrag);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("wheel", zoomView, { passive: false });

  return {
    dispose: () => {
      for (const pointerId of core.cancel()) releaseCanvasPointer(canvas, pointerId);
      canvas.removeEventListener("contextmenu", blockContextMenu);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("pointerdown", startDrag);
      canvas.removeEventListener("pointermove", moveDrag);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("wheel", zoomView);
      if (canvasStyle !== undefined && previousTouchAction !== undefined) {
        canvasStyle.touchAction = previousTouchAction;
      }
    },
    getView: () => core.getView(),
    setOptions: (nextOptions) => {
      validateOptionNames(
        optionObject(nextOptions, "OrbitControls setOptions options"),
        behaviorOptionNames,
        "OrbitControls setOptions options",
      );
      behaviorOptions = orbitControlsBehaviorOptionsFrom({
        ...behaviorOptions,
        ...nextOptions,
      });
      updateTouchAction();
      for (const pointerId of core.setBehavior(behaviorOptions)) releaseCanvasPointer(canvas, pointerId);
    },
    setView: (nextView, setViewOptions) => {
      const resolved = setViewOptionsFrom(setViewOptions);
      core.setView(nextView, resolved.clamp, resolved.emitChange);
    },
  };
};
