import {
  clampOrbitCameraView,
  orbitPerspectiveCamera,
  panOrbitCameraView,
  resolveOrbitCameraView,
  rotateOrbitCameraView,
  zoomOrbitCameraView,
  createCameraViewResource,
  type PerspectiveCameraViewResource,
  type OrbitCameraView,
  type OrbitCameraViewOptions,
  type Metres,
  type Rads,
  type WorldPosition3,
} from "@royal/renderer-core";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useCanvasElement } from "./canvas";
import { captureCanvasPointer, releaseCanvasPointer } from "./canvas-pointer";

export {
  orbitCameraTransform,
  orbitPerspectiveCamera,
  resolveOrbitCameraView,
} from "@royal/renderer-core";
export type {
  OrbitCameraTransform,
  OrbitCameraView,
  OrbitCameraViewOptions,
  OrbitPerspectiveCameraOptions,
  WorldPosition3,
} from "@royal/renderer-core";

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

export type OrbitControlsProps = OrbitControlsBehaviorOptions & {
  readonly orbit: OrbitCameraController;
};

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

const resolveStartingView = (options: OrbitControlsViewInputs): OrbitCameraView => {
  const view = options.value ?? options.defaultView;
  if (view === undefined) {
    throw new Error("OrbitControls expects value or defaultView");
  }

  return resolveOrbitCameraView(view);
};

const toBehaviorOptions = ({
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

export interface OrbitCameraController {
  /** Stable scene camera resource; include it in `scene({ camera })`. */
  readonly cameraResource: PerspectiveCameraViewResource;
  /** Reads the latest committed orbit view without subscribing React. */
  readonly getView: () => OrbitCameraView;
  /** Updates clipping and field-of-view values on the stable camera resource. */
  readonly setProjection: (projection: { readonly far: Metres; readonly fovY: Rads; readonly near: Metres }) => void;
  /** Commits a complete orbit view to every renderer using `cameraResource`. */
  readonly setView: (view: OrbitCameraViewOptions) => void;
  /** Subscribes to committed view changes. */
  readonly subscribeView: (listener: () => void) => () => void;
}

export interface UseOrbitCameraOptions {
  /** Initial-only target and distance in metres; angles are radians. */
  readonly initial: OrbitCameraViewOptions;
  /** Far clipping distance in metres. */
  readonly far?: Metres;
  /** Vertical field of view in radians. */
  readonly fovY?: Rads;
  /**
   * Near clipping distance in metres. Keep this below the closest intended
   * camera-to-surface distance; for example, use `0.01` when orbiting to `0.1`.
   */
  readonly near?: Metres;
}

const stableOrbitView = (input: OrbitCameraViewOptions): OrbitCameraView => {
  const view = resolveOrbitCameraView(input);
  return Object.freeze({
    distance: view.distance,
    pitch: view.pitch,
    target: Object.freeze([view.target[0], view.target[1], view.target[2]]) as WorldPosition3,
    yaw: view.yaw,
  });
};

const writeOrbitCamera = (resource: PerspectiveCameraViewResource, view: OrbitCameraView): void => {
  const cosPitch = Math.cos(view.pitch);
  resource.position[0] = view.target[0] - Math.sin(view.yaw) * cosPitch * view.distance;
  resource.position[1] = view.target[1] + Math.sin(view.pitch) * view.distance;
  resource.position[2] = view.target[2] + Math.cos(view.yaw) * cosPitch * view.distance;
  resource.rotation[0] = -view.pitch;
  resource.rotation[1] = -view.yaw;
  resource.rotation[2] = 0;
  resource.commit();
};

export const createOrbitCameraController = (
  initial: OrbitCameraViewOptions,
  projection: { readonly far: Metres; readonly fovY: Rads; readonly near: Metres },
): OrbitCameraController => {
  let view = stableOrbitView(initial);
  const cameraResource = createCameraViewResource(orbitPerspectiveCamera({ ...projection, view }));
  const setView = (next: OrbitCameraViewOptions): void => {
    const resolved = stableOrbitView(next);
    if (sameOrbitCameraView(view, resolved)) return;
    view = resolved;
    writeOrbitCamera(cameraResource, view);
  };
  return {
    cameraResource,
    getView: () => view,
    setProjection: ({ far, fovY, near }) => {
      cameraResource.far = far;
      cameraResource.fovY = fovY;
      cameraResource.near = near;
      cameraResource.commit();
    },
    setView,
    subscribeView: (listener) => cameraResource.subscribe(() => listener()),
  };
};

export const useOrbitCameraView = (orbit: OrbitCameraController): OrbitCameraView =>
  useSyncExternalStore(orbit.subscribeView, orbit.getView, orbit.getView);

export const useOrbitCamera = ({
  initial,
  far = 100,
  fovY = Math.PI / 4,
  near = 0.1,
}: UseOrbitCameraOptions): OrbitCameraController => {
  const controllerRef = useRef<OrbitCameraController | undefined>(undefined);
  if (controllerRef.current === undefined) {
    controllerRef.current = createOrbitCameraController(initial, { far, fovY, near });
  }
  useLayoutEffect(() => {
    controllerRef.current?.setProjection({ far, fovY, near });
  }, [far, fovY, near]);
  return controllerRef.current;
};

export const createOrbitControls = (
  canvas: HTMLCanvasElement,
  options: OrbitControlsOptions,
): OrbitControlsHandle => {
  let behaviorOptions = toBehaviorOptions(options);
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
      behaviorOptions = { ...behaviorOptions, ...nextOptions };
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

export const OrbitControls = ({
  enabled,
  enablePan,
  enableRotate,
  enableZoom,
  maxDistance,
  maxPitch,
  minDistance,
  minPitch,
  onChange,
  orbit,
  panSpeed,
  rotateSpeed,
  zoomSpeed,
}: OrbitControlsProps): null => {
  const canvas = useCanvasElement();
  const behaviorOptions = toBehaviorOptions({
    enabled,
    enablePan,
    enableRotate,
    enableZoom,
    maxDistance,
    maxPitch,
    minDistance,
    minPitch,
    onChange: (view) => {
      orbit.setView(view);
      onChange?.(view);
    },
    panSpeed,
    rotateSpeed,
    zoomSpeed,
  });
  const behaviorOptionsRef = useRef<OrbitControlsBehaviorOptions>(behaviorOptions);
  const controlsRef = useRef<OrbitControlsHandle | undefined>(undefined);
  behaviorOptionsRef.current = behaviorOptions;

  useEffect(() => {
    if (canvas === null) return undefined;
    const controls = createOrbitControls(canvas, {
      defaultView: orbit.getView(),
      ...behaviorOptionsRef.current,
    });
    controlsRef.current = controls;

    return () => {
      controls.dispose();
      controlsRef.current = undefined;
    };
  }, [canvas, orbit]);

  useEffect(() => {
    controlsRef.current?.setOptions(behaviorOptions);
  }, [
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
  ]);

  useEffect(() => {
    controlsRef.current?.setView(orbit.getView(), { clamp: false, notify: false });
    return orbit.subscribeView(() => {
      controlsRef.current?.setView(orbit.getView(), { clamp: false, notify: false });
    });
  }, [orbit]);

  return null;
};
