import { useEffect } from "react";
import { useCanvasElement } from "./canvas";
import { captureCanvasPointer, releaseCanvasPointer } from "./canvas-pointer";

export type OrbitVector3 = readonly [x: number, y: number, z: number];

export type OrbitCameraView = {
  readonly distance: number;
  readonly pitch: number;
  readonly target: OrbitVector3;
  readonly yaw: number;
};

export type OrbitControlsHandle = {
  dispose(): void;
  getView(): OrbitCameraView;
  setView(view: OrbitCameraView): void;
};

export type OrbitCameraTransform = {
  readonly position: OrbitVector3;
  readonly rotation: OrbitVector3;
};

export type OrbitControlsOptions = {
  readonly initialView: OrbitCameraView;
  readonly onChange: (view: OrbitCameraView) => void;
  readonly panSpeed?: number;
  readonly rotateSpeed?: number;
  readonly zoomSpeed?: number;
};

export type OrbitControlsProps = OrbitControlsOptions;

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

export const createOrbitControls = (
  canvas: HTMLCanvasElement,
  options: OrbitControlsOptions,
): OrbitControlsHandle => {
  const panSpeed = options.panSpeed ?? defaultPanSpeed;
  const rotateSpeed = options.rotateSpeed ?? defaultRotateSpeed;
  const zoomSpeed = options.zoomSpeed ?? defaultZoomSpeed;
  let view: OrbitCameraView = options.initialView;
  let drag: DragState | undefined;

  const applyView = (nextView: OrbitCameraView): void => {
    view = nextView;
    options.onChange(view);
  };

  const startDrag = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;

    event.preventDefault();
    captureCanvasPointer(canvas, event.pointerId);
    drag = {
      mode: event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
        ? "orbit"
        : "pan",
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
        pitch: drag.startView.pitch + deltaY * rotateSpeed,
        yaw: drag.startView.yaw + deltaX * rotateSpeed,
      });
      return;
    }

    const { right, up } = cameraBasis(drag.startView);
    const scale = drag.startView.distance * panSpeed;
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
    event.preventDefault();
    applyView({
      ...view,
      distance: view.distance * Math.exp(wheelDeltaPixels(event) * zoomSpeed),
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
    setView: applyView,
  };
};

export const OrbitControls = ({
  initialView,
  onChange,
  panSpeed,
  rotateSpeed,
  zoomSpeed,
}: OrbitControlsProps): null => {
  const canvas = useCanvasElement();

  useEffect(() => {
    if (canvas === null) return undefined;

    const controls = createOrbitControls(canvas, {
      initialView,
      onChange,
      ...(panSpeed === undefined ? {} : { panSpeed }),
      ...(rotateSpeed === undefined ? {} : { rotateSpeed }),
      ...(zoomSpeed === undefined ? {} : { zoomSpeed }),
    });

    return () => controls.dispose();
  }, [canvas, initialView, onChange, panSpeed, rotateSpeed, zoomSpeed]);

  return null;
};
