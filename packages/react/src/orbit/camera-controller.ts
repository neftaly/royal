import {
  createCameraViewResource,
  fitOrbitCameraView,
  orbitPerspectiveCamera,
  resolveOrbitCameraView,
  type Metres,
  type GltfAssetBounds,
  type OrbitCameraFitOptions,
  type OrbitCameraView,
  type OrbitCameraViewOptions,
  type PerspectiveCameraViewResource,
  type Rads,
} from "@royal/renderer-core";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { recordWithAllowedFields } from "../validation";

const USE_ORBIT_CAMERA_OPTION_FIELDS = ["far", "fovY", "initial", "near"] as const;
const ORBIT_CAMERA_PROJECTION_FIELDS = ["far", "fovY", "near"] as const;

/** Perspective projection owned by an orbit camera controller. */
export interface OrbitCameraProjection {
  /** Far clipping distance in metres. */
  readonly far: Metres;
  /** Vertical field of view in radians. */
  readonly fovY: Rads;
  /** Near clipping distance in metres. */
  readonly near: Metres;
}

/** Stable camera resource and view authority shared by controls and scene composition. */
export interface OrbitCameraController {
  /** Stable scene camera resource; include it in `scene({ camera })`. */
  readonly cameraResource: PerspectiveCameraViewResource;
  /**
   * Fits the complete view to bounds, using the current field of view unless
   * `fovY` is passed. Expands the far plane when the fitted bounds require it.
   */
  readonly fit: (bounds: GltfAssetBounds, options: OrbitCameraFitOptions) => void;
  /** Reads the latest committed projection without subscribing React. */
  readonly getProjection: () => OrbitCameraProjection;
  /** Reads the latest committed orbit view without subscribing React. */
  readonly getView: () => OrbitCameraView;
  /** Updates clipping and field-of-view values on the stable camera resource. */
  readonly setProjection: (projection: OrbitCameraProjection) => void;
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

/** @internal Validates hook-only option shape before React state is retained. */
export const validateUseOrbitCameraOptions = (options: UseOrbitCameraOptions): void => {
  recordWithAllowedFields(
    options,
    USE_ORBIT_CAMERA_OPTION_FIELDS,
    "useOrbitCamera options",
    "option",
  );
  if (
    typeof options.initial !== "object"
    || options.initial === null
    || Array.isArray(options.initial)
  ) {
    throw new TypeError("useOrbitCamera initial must be an OrbitCameraViewOptions object");
  }
};

const stableOrbitView = (input: OrbitCameraViewOptions): OrbitCameraView =>
  resolveOrbitCameraView(input);

const validOrbitCameraProjection = (input: unknown): OrbitCameraProjection => {
  const { far, fovY, near } = recordWithAllowedFields(
    input,
    ORBIT_CAMERA_PROJECTION_FIELDS,
    "Orbit camera projection",
    "field",
  ) as Partial<OrbitCameraProjection>;
  if (typeof far !== "number" || !Number.isFinite(far)) {
    throw new TypeError("Orbit camera projection far must be a finite number");
  }
  if (typeof fovY !== "number" || !Number.isFinite(fovY)) {
    throw new TypeError("Orbit camera projection fovY must be a finite number");
  }
  if (typeof near !== "number" || !Number.isFinite(near)) {
    throw new TypeError("Orbit camera projection near must be a finite number");
  }
  if (!(fovY > 0 && fovY < Math.PI)) {
    throw new RangeError("Orbit camera projection fovY must be within (0, PI)");
  }
  if (!(near > 0 && far > near)) {
    throw new RangeError("Orbit camera projection requires 0 < near < far");
  }
  return { far, fovY, near };
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
};

/** Pure conservative far-plane requirement for a view fitted to these bounds. */
const fittedOrbitFar = (
  bounds: GltfAssetBounds,
  fittedView: OrbitCameraView,
  padding: number,
): number => {
  const halfX = (bounds.max[0] - bounds.min[0]) * 0.5;
  const halfY = (bounds.max[1] - bounds.min[1]) * 0.5;
  const halfZ = (bounds.max[2] - bounds.min[2]) * 0.5;
  const paddedRadius = Math.hypot(halfX, halfY, halfZ) * padding;
  // Keep the sphere strictly inside the clip boundary despite matrix and
  // authored-bound rounding. Degenerate bounds still receive distance margin.
  return (fittedView.distance + paddedRadius) * 1.01;
};

export const createOrbitCameraController = (
  initial: OrbitCameraViewOptions,
  projection: OrbitCameraProjection,
): OrbitCameraController => {
  let view = stableOrbitView(initial);
  let currentProjection = validOrbitCameraProjection(projection);
  const cameraResource = createCameraViewResource(orbitPerspectiveCamera({
    ...currentProjection,
    view,
  }));
  const setView = (next: OrbitCameraViewOptions): void => {
    const resolved = stableOrbitView(next);
    if (sameOrbitCameraView(view, resolved)) return;
    view = resolved;
    writeOrbitCamera(cameraResource, view);
    cameraResource.commit();
  };
  return {
    cameraResource,
    fit: (bounds, options) => {
      const fittedView = fitOrbitCameraView(bounds, {
        ...options,
        fovY: options.fovY ?? currentProjection.fovY,
      });
      const far = Math.max(
        currentProjection.far,
        fittedOrbitFar(bounds, fittedView, options.padding ?? 1),
      );
      const viewChanged = !sameOrbitCameraView(view, fittedView);
      const projectionChanged = currentProjection.far !== far;
      if (!viewChanged && !projectionChanged) return;
      view = fittedView;
      if (projectionChanged) {
        currentProjection = { ...currentProjection, far };
        cameraResource.far = far;
      }
      writeOrbitCamera(cameraResource, view);
      cameraResource.commit();
    },
    getProjection: () => currentProjection,
    getView: () => view,
    setProjection: (nextProjection) => {
      const { far, fovY, near } = validOrbitCameraProjection(nextProjection);
      if (
        currentProjection.far === far
        && currentProjection.fovY === fovY
        && currentProjection.near === near
      ) return;
      currentProjection = { far, fovY, near };
      cameraResource.far = far;
      cameraResource.fovY = fovY;
      cameraResource.near = near;
      cameraResource.commit();
    },
    setView,
    subscribeView: (listener) => {
      if (typeof listener !== "function") {
        throw new TypeError("Orbit camera subscribeView listener must be a function");
      }
      return cameraResource.subscribe(listener);
    },
  };
};

/** Subscribes React to the controller's latest committed orbit view. */
export const useOrbitCameraView = (orbit: OrbitCameraController): OrbitCameraView =>
  useSyncExternalStore(orbit.subscribeView, orbit.getView, orbit.getView);

/** Creates one stable orbit camera controller for the lifetime of the component. */
export const useOrbitCamera = (options: UseOrbitCameraOptions): OrbitCameraController => {
  validateUseOrbitCameraOptions(options);
  const {
    initial,
    far = 100,
    fovY = Math.PI / 4,
    near = 0.1,
  } = options;
  const controllerRef = useRef<OrbitCameraController | undefined>(undefined);
  if (controllerRef.current === undefined) {
    controllerRef.current = createOrbitCameraController(initial, { far, fovY, near });
  }
  useLayoutEffect(() => {
    controllerRef.current?.setProjection({ far, fovY, near });
  }, [far, fovY, near]);
  return controllerRef.current;
};
