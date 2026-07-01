import {
  perspectiveCamera,
  type PerspectiveCamera,
  type PerspectiveCameraOptions,
} from "@royal/renderer-core";
import { useEffect, useRef } from "react";
import { useCanvasElement } from "./canvas";
import { captureCanvasPointer, releaseCanvasPointer } from "./canvas-pointer";

export type OrbitVector3 = readonly [x: number, y: number, z: number];

export type OrbitCameraView = {
  readonly distance: number;
  readonly pitch: number;
  readonly target: OrbitVector3;
  readonly yaw: number;
};

export type OrbitControlsBehaviorOptions = {
  readonly enabled?: boolean | undefined;
  readonly enablePan?: boolean | undefined;
  readonly enableRotate?: boolean | undefined;
  readonly enableZoom?: boolean | undefined;
  readonly maxDistance?: number | undefined;
  readonly maxPitch?: number | undefined;
  readonly minDistance?: number | undefined;
  readonly minPitch?: number | undefined;
  readonly onChange?: ((view: OrbitCameraView) => void) | undefined;
  readonly panSpeed?: number | undefined;
  readonly rotateSpeed?: number | undefined;
  readonly zoomSpeed?: number | undefined;
};

export type OrbitControlsHandle = {
  dispose(): void;
  getView(): OrbitCameraView;
  setOptions(options: OrbitControlsBehaviorOptions): void;
  setView(
    view: OrbitCameraView,
    options?: { readonly clamp?: boolean | undefined; readonly notify?: boolean | undefined }
  ): void;
};

export type OrbitCameraTransform = {
  readonly position: OrbitVector3;
  readonly rotation: OrbitVector3;
};

export type OrbitPerspectiveCameraOptions =
  Omit<PerspectiveCameraOptions, "position" | "rotation"> & {
    readonly view: OrbitCameraView;
  };

export type OrbitControlsOptions = {
  readonly defaultView?: OrbitCameraView;
  readonly value?: OrbitCameraView;
} & OrbitControlsBehaviorOptions;

export type OrbitControlsProps = OrbitControlsOptions;

type OrbitControlsViewInputs = {
  readonly defaultView?: OrbitCameraView | undefined;
  readonly value?: OrbitCameraView | undefined;
};

type DragMode = "orbit" | "pan";

type DragState = {
  readonly mode: DragMode;
  readonly pointerId: number;
  readonly startView: OrbitCameraView;
  readonly startX: number;
  readonly startY: number;
};

const defaultPanSpeed = 0.0016;
const defaultRotateSpeed = 0.006;
const defaultZoomSpeed = 0.0018;

const clamp = (
  value: number,
  minimum: number | undefined,
  maximum: number | undefined,
): number => Math.min(maximum ?? Infinity, Math.max(minimum ?? -Infinity, value));

const resolveStartingView = (options: OrbitControlsViewInputs): OrbitCameraView => {
  const view = options.value ?? options.defaultView;
  if (view === undefined) {
    throw new Error("OrbitControls expects value or defaultView");
  }

  return view;
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

const cameraBasis = (
  { pitch, yaw }: OrbitCameraView,
): { readonly right: OrbitVector3; readonly up: OrbitVector3 } => {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);

  return {
    right: [cy, 0, sy],
    up: [sx * sy, cx, -sx * cy],
  };
};

export const orbitCameraTransform = (
  { distance, pitch, target, yaw }: OrbitCameraView,
): OrbitCameraTransform => {
  const cosPitch = Math.cos(pitch);

  return {
    position: [
      target[0] - Math.sin(yaw) * cosPitch * distance,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * cosPitch * distance,
    ],
    rotation: [-pitch, -yaw, 0],
  };
};

export const orbitPerspectiveCamera = ({
  view,
  ...options
}: OrbitPerspectiveCameraOptions): PerspectiveCamera => perspectiveCamera({
  ...options,
  ...orbitCameraTransform(view),
});

export const createOrbitControls = (
  canvas: HTMLCanvasElement,
  options: OrbitControlsOptions,
): OrbitControlsHandle => {
  let behaviorOptions = toBehaviorOptions(options);
  const currentPanSpeed = (): number => behaviorOptions.panSpeed ?? defaultPanSpeed;
  const currentRotateSpeed = (): number => behaviorOptions.rotateSpeed ?? defaultRotateSpeed;
  const currentZoomSpeed = (): number => behaviorOptions.zoomSpeed ?? defaultZoomSpeed;
  let view: OrbitCameraView = resolveStartingView(options);
  let drag: DragState | undefined;

  const clampView = (nextView: OrbitCameraView): OrbitCameraView => ({
    ...nextView,
    distance: clamp(nextView.distance, behaviorOptions.minDistance, behaviorOptions.maxDistance),
    pitch: clamp(nextView.pitch, behaviorOptions.minPitch, behaviorOptions.maxPitch),
  });

  const applyView = (
    nextView: OrbitCameraView,
    {
      clamp: shouldClamp = true,
      notify = true,
    }: { readonly clamp?: boolean | undefined; readonly notify?: boolean | undefined } = {},
  ): void => {
    view = shouldClamp ? clampView(nextView) : nextView;
    if (notify) {
      behaviorOptions.onChange?.(view);
    }
  };

  const startDrag = (event: PointerEvent): void => {
    if (behaviorOptions.enabled === false) return;
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;

    const mode: DragMode =
      event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
        ? "orbit"
        : "pan";
    if (mode === "orbit" && behaviorOptions.enableRotate === false) return;
    if (mode === "pan" && behaviorOptions.enablePan === false) return;

    event.preventDefault();
    captureCanvasPointer(canvas, event.pointerId);
    drag = {
      mode,
      pointerId: event.pointerId,
      startView: view,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const moveDrag = (event: PointerEvent): void => {
    if (drag === undefined || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (drag.mode === "orbit") {
      applyView({
        ...drag.startView,
        pitch: drag.startView.pitch + deltaY * currentRotateSpeed(),
        yaw: drag.startView.yaw + deltaX * currentRotateSpeed(),
      });
      return;
    }

    const { right, up } = cameraBasis(drag.startView);
    const scale = drag.startView.distance * currentPanSpeed();
    applyView({
      ...drag.startView,
      target: [
        drag.startView.target[0] - right[0] * deltaX * scale + up[0] * deltaY * scale,
        drag.startView.target[1] - right[1] * deltaX * scale + up[1] * deltaY * scale,
        drag.startView.target[2] - right[2] * deltaX * scale + up[2] * deltaY * scale,
      ],
    });
  };

  const endDrag = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) return;

    releaseCanvasPointer(canvas, event.pointerId);
    drag = undefined;
  };

  const zoomView = (event: WheelEvent): void => {
    if (behaviorOptions.enabled === false || behaviorOptions.enableZoom === false) return;

    event.preventDefault();
    applyView({
      ...view,
      distance: view.distance * Math.exp(wheelDeltaPixels(event) * currentZoomSpeed()),
    });
  };

  const blockContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  canvas.addEventListener("contextmenu", blockContextMenu);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerdown", startDrag);
  canvas.addEventListener("pointermove", moveDrag);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("wheel", zoomView, { passive: false });

  return {
    dispose: () => {
      if (drag !== undefined) releaseCanvasPointer(canvas, drag.pointerId);
      canvas.removeEventListener("contextmenu", blockContextMenu);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("pointerdown", startDrag);
      canvas.removeEventListener("pointermove", moveDrag);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("wheel", zoomView);
      drag = undefined;
    },
    getView: () => view,
    setOptions: (nextOptions) => {
      behaviorOptions = toBehaviorOptions(nextOptions);
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
  defaultView,
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
  value,
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
    onChange,
    panSpeed,
    rotateSpeed,
    zoomSpeed,
  });
  const behaviorOptionsRef = useRef<OrbitControlsBehaviorOptions>(behaviorOptions);
  const viewInputsRef = useRef<OrbitControlsViewInputs>({ defaultView, value });
  const controlsRef = useRef<OrbitControlsHandle | undefined>(undefined);
  const startingViewRef = useRef<OrbitCameraView | undefined>(undefined);
  behaviorOptionsRef.current = behaviorOptions;
  viewInputsRef.current = { defaultView, value };
  startingViewRef.current ??= resolveStartingView(viewInputsRef.current);

  useEffect(() => {
    if (canvas === null) return undefined;
    const controlsStartingView = viewInputsRef.current.value ?? startingViewRef.current;
    if (controlsStartingView === undefined) {
      throw new Error("OrbitControls expects value or defaultView");
    }

    const controls = createOrbitControls(canvas, {
      defaultView: controlsStartingView,
      ...behaviorOptionsRef.current,
    });
    controlsRef.current = controls;

    return () => {
      controls.dispose();
      controlsRef.current = undefined;
    };
  }, [canvas]);

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
    if (value === undefined) return;

    controlsRef.current?.setView(value, { clamp: false, notify: false });
  }, [value]);

  return null;
};
