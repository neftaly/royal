import {
  createCameraViewResource,
  orbitPerspectiveCamera,
  resolveOrbitCameraView,
  type Metres,
  type OrbitCameraView,
  type OrbitCameraViewOptions,
  type PerspectiveCameraViewResource,
  type Rads,
  type WorldPosition3,
} from "@royal/renderer-core";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

/** Stable camera resource and view authority shared by controls and scene composition. */
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

/** Options for one stable orbit camera controller created by `useOrbitCamera`. */
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

const sameOrbitCameraView = (left: OrbitCameraView, right: OrbitCameraView): boolean =>
  left.distance === right.distance
  && left.pitch === right.pitch
  && left.yaw === right.yaw
  && left.target[0] === right.target[0]
  && left.target[1] === right.target[1]
  && left.target[2] === right.target[2];

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

/** Subscribes React to the controller's latest committed orbit view. */
export const useOrbitCameraView = (orbit: OrbitCameraController): OrbitCameraView =>
  useSyncExternalStore(orbit.subscribeView, orbit.getView, orbit.getView);

/** Creates one stable orbit camera controller for the lifetime of the component. */
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
