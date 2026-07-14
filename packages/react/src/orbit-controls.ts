import { useEffect, useRef } from "react";
import { useCanvasElement } from "./canvas";
import type { OrbitCameraController } from "./orbit-camera-controller";
import {
  createOrbitControls,
  orbitControlsBehaviorOptionsFrom,
  type OrbitControlsBehaviorOptions,
  type OrbitControlsHandle,
} from "./orbit-controls-runtime";

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
export {
  createOrbitCameraController,
  useOrbitCamera,
  useOrbitCameraView,
} from "./orbit-camera-controller";
export type {
  OrbitCameraController,
  UseOrbitCameraOptions,
} from "./orbit-camera-controller";
export { createOrbitControls } from "./orbit-controls-runtime";
export type {
  OrbitControlsBehaviorOptions,
  OrbitControlsHandle,
  OrbitControlsOptions,
} from "./orbit-controls-runtime";

export type OrbitControlsProps = OrbitControlsBehaviorOptions & {
  readonly orbit: OrbitCameraController;
};

/** Attaches orbit, pan, wheel, and pinch gestures to the surrounding Canvas. */
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
  const behaviorOptions = orbitControlsBehaviorOptionsFrom({
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
