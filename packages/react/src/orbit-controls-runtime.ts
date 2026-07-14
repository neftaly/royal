import {
  clampOrbitCameraView,
  panOrbitCameraView,
  resolveOrbitCameraView,
  rotateOrbitCameraView,
  zoomOrbitCameraView,
  type OrbitCameraView,
  type OrbitCameraViewOptions,
  type Metres,
  type Rads,
} from "@royal/renderer-core";
import { captureCanvasPointer, releaseCanvasPointer } from "./canvas-pointer";

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
    options?: { readonly clamp?: boolean | undefined; readonly notify?: boolean | undefined }
  ): void;
};

export type OrbitControlsOptions = {
  readonly defaultView?: OrbitCameraViewOptions;
  readonly value?: OrbitCameraViewOptions;
} & OrbitControlsBehaviorOptions;

type OrbitControlsViewInputs = {
  readonly defaultView?: OrbitCameraViewOptions | undefined;
  readonly value?: OrbitCameraViewOptions | undefined;
};

type DragMode = "orbit" | "pan";

type DragState = {
  readonly kind: "drag";
  readonly mode: DragMode;
  readonly pointerId: number;
  readonly startView: OrbitCameraView;
  readonly startX: number;
  readonly startY: number;
};

type PinchState = {
  readonly kind: "pinch";
  readonly pointerIds: readonly [number, number];
  readonly startDistance: number;
  readonly startView: OrbitCameraView;
};

type InteractionState = DragState | PinchState;

type PointerContact = {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
};

const defaultPanSpeed = 0.0016;
const defaultRotateSpeed = 0.006;
const defaultZoomSpeed = 0.0018;

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

const resolveStartingView = (options: OrbitControlsViewInputs): OrbitCameraView => {
  const view = options.value ?? options.defaultView;
  if (view === undefined) {
    throw new Error("OrbitControls expects value or defaultView");
  }

  return resolveOrbitCameraView(view);
};

export const orbitControlsBehaviorOptionsFrom = ({
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
}: OrbitControlsBehaviorOptions): OrbitControlsBehaviorOptions => ({
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
});

const wheelDeltaPixels = (event: WheelEvent): number => {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * Math.max(1, globalThis.innerHeight || 800);
  return event.deltaY;
};

const toPointerContact = (event: PointerEvent): PointerContact => ({
  clientX: event.clientX,
  clientY: event.clientY,
  pointerId: event.pointerId,
});

const pointerDistance = (first: PointerContact, second: PointerContact): number =>
  Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);

const sameOrbitCameraView = (
  left: OrbitCameraView,
  right: OrbitCameraView,
): boolean =>
  left.distance === right.distance &&
  left.pitch === right.pitch &&
  left.yaw === right.yaw &&
  left.target[0] === right.target[0] &&
  left.target[1] === right.target[1] &&
  left.target[2] === right.target[2];

export const createOrbitControls = (
  canvas: HTMLCanvasElement,
  options: OrbitControlsOptions,
): OrbitControlsHandle => {
  let behaviorOptions = orbitControlsBehaviorOptionsFrom(options);
  const currentPanSpeed = (): number => behaviorOptions.panSpeed ?? defaultPanSpeed;
  const currentRotateSpeed = (): number => behaviorOptions.rotateSpeed ?? defaultRotateSpeed;
  const currentZoomSpeed = (): number => behaviorOptions.zoomSpeed ?? defaultZoomSpeed;
  let view: OrbitCameraView = clampOrbitCameraView(resolveStartingView(options), behaviorOptions);
  let interaction: InteractionState | undefined;
  const activePointers = new Map<number, PointerContact>();

  const clampView = (nextView: OrbitCameraView): OrbitCameraView => clampOrbitCameraView(nextView, {
    maxDistance: behaviorOptions.maxDistance,
    maxPitch: behaviorOptions.maxPitch,
    minDistance: behaviorOptions.minDistance,
    minPitch: behaviorOptions.minPitch,
  });

  const applyView = (
    nextView: OrbitCameraViewOptions,
    {
      clamp: shouldClamp = true,
      notify = true,
    }: { readonly clamp?: boolean | undefined; readonly notify?: boolean | undefined } = {},
  ): void => {
    const resolvedView = resolveOrbitCameraView(nextView);
    const nextResolvedView = shouldClamp ? clampView(resolvedView) : resolvedView;
    if (sameOrbitCameraView(view, nextResolvedView)) return;

    view = nextResolvedView;
    if (notify) {
      behaviorOptions.onChange?.(view);
    }
  };

  const applyZoomDelta = (deltaPixels: number, startView = view): void => {
    applyView(zoomOrbitCameraView(startView, deltaPixels, currentZoomSpeed()));
  };

  const startPinch = (): boolean => {
    if (behaviorOptions.enabled === false || behaviorOptions.enableZoom === false) return false;

    const [first, second] = Array.from(activePointers.values());
    if (first === undefined || second === undefined) return false;

    interaction = {
      kind: "pinch",
      pointerIds: [first.pointerId, second.pointerId],
      startDistance: pointerDistance(first, second),
      startView: view,
    };
    return true;
  };

  const startDrag = (event: PointerEvent): void => {
    // Picking handlers run first on Canvas and consume object interactions by
    // preventing the native event. Do not start a competing camera gesture.
    if (event.defaultPrevented) return;
    if (behaviorOptions.enabled === false) return;
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    if (activePointers.size >= 2) return;

    activePointers.set(event.pointerId, toPointerContact(event));
    if (activePointers.size >= 2 && startPinch()) {
      event.preventDefault();
      captureCanvasPointer(canvas, event.pointerId);
      return;
    }
    if (activePointers.size >= 2) {
      activePointers.delete(event.pointerId);
      return;
    }

    const mode: DragMode =
      event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
        ? "orbit"
        : "pan";
    if (mode === "orbit" && behaviorOptions.enableRotate === false) {
      activePointers.delete(event.pointerId);
      return;
    }
    if (mode === "pan" && behaviorOptions.enablePan === false) {
      activePointers.delete(event.pointerId);
      return;
    }

    event.preventDefault();
    captureCanvasPointer(canvas, event.pointerId);
    interaction = {
      kind: "drag",
      mode,
      pointerId: event.pointerId,
      startView: view,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const moveDrag = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (!activePointers.has(event.pointerId)) return;
    if (behaviorOptions.enabled === false) return;

    event.preventDefault();
    activePointers.set(event.pointerId, toPointerContact(event));
    if (interaction === undefined) return;

    if (interaction.kind === "pinch") {
      if (behaviorOptions.enableZoom === false) return;
      const [firstPointerId, secondPointerId] = interaction.pointerIds;
      const first = activePointers.get(firstPointerId);
      const second = activePointers.get(secondPointerId);
      if (first === undefined || second === undefined) return;

      applyZoomDelta(interaction.startDistance - pointerDistance(first, second), interaction.startView);
      return;
    }

    if (interaction.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - interaction.startX;
    const deltaY = event.clientY - interaction.startY;

    if (interaction.mode === "orbit") {
      if (behaviorOptions.enableRotate === false) return;
      applyView(rotateOrbitCameraView(
        interaction.startView,
        deltaX,
        deltaY,
        currentRotateSpeed(),
      ));
      return;
    }

    if (behaviorOptions.enablePan === false) return;
    applyView(panOrbitCameraView(
      interaction.startView,
      deltaX,
      deltaY,
      currentPanSpeed(),
    ));
  };

  const endDrag = (event: PointerEvent): void => {
    if (!activePointers.has(event.pointerId)) return;

    releaseCanvasPointer(canvas, event.pointerId);
    activePointers.delete(event.pointerId);

    if (interaction?.kind === "pinch" && interaction.pointerIds.includes(event.pointerId)) {
      interaction = undefined;
      return;
    }

    if (interaction?.kind === "drag" && interaction.pointerId === event.pointerId) {
      interaction = undefined;
    }
  };

  const zoomView = (event: WheelEvent): void => {
    if (event.defaultPrevented) return;
    if (behaviorOptions.enabled === false || behaviorOptions.enableZoom === false) return;

    event.preventDefault();
    applyZoomDelta(wheelDeltaPixels(event));
  };

  const blockContextMenu = (event: MouseEvent): void => {
    if (event.defaultPrevented) return;
    if (behaviorOptions.enabled !== false && behaviorOptions.enablePan !== false) {
      event.preventDefault();
    }
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
      for (const pointerId of activePointers.keys()) releaseCanvasPointer(canvas, pointerId);
      canvas.removeEventListener("contextmenu", blockContextMenu);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("pointerdown", startDrag);
      canvas.removeEventListener("pointermove", moveDrag);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("wheel", zoomView);
      if (canvasStyle !== undefined && previousTouchAction !== undefined) {
        canvasStyle.touchAction = previousTouchAction;
      }
      activePointers.clear();
      interaction = undefined;
    },
    getView: () => view,
    setOptions: (nextOptions) => {
      behaviorOptions = orbitControlsBehaviorOptionsFrom({
        ...behaviorOptions,
        ...nextOptions,
      });
      updateTouchAction();
      const interactionDisabled = behaviorOptions.enabled === false ||
        (interaction?.kind === "pinch" && behaviorOptions.enableZoom === false) ||
        (interaction?.kind === "drag" && interaction.mode === "orbit" && behaviorOptions.enableRotate === false) ||
        (interaction?.kind === "drag" && interaction.mode === "pan" && behaviorOptions.enablePan === false);
      if (interactionDisabled) {
        for (const pointerId of activePointers.keys()) releaseCanvasPointer(canvas, pointerId);
        activePointers.clear();
        interaction = undefined;
      }
      applyView(view);
    },
    setView: (nextView, setViewOptions) => {
      applyView(nextView, {
        clamp: setViewOptions?.clamp,
        notify: setViewOptions?.notify,
      });
    },
  };
};
