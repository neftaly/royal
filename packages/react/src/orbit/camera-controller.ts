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
  type CameraViewSource,
  type Rads,
} from "@royal/renderer-core";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { recordWithAllowedFields } from "../validation";

const ORBIT_CAMERA_OPTION_FIELDS = ["far", "fovY", "initial", "near"] as const;
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

/** Clipping behavior applied when an orbit camera is fitted to declared bounds. */
export type OrbitCameraFitClipping = "preserve" | "track-bounds";

/** Fit options owned by the managed orbit camera controller. */
export interface OrbitCameraControllerFitOptions extends OrbitCameraFitOptions {
  /**
   * `track-bounds` derives both clipping planes from these bounds after every
   * subsequent view change. `preserve` retains the fixed projection policy.
   * @defaultValue `"preserve"`
   */
  readonly clipping?: OrbitCameraFitClipping;
}

/** Stable orbit camera and view authority shared by controls and scene composition. */
export interface OrbitCameraController {
  /** Stable scene camera; include it in `scene({ camera })`. */
  readonly camera: CameraViewSource;
  /**
   * Fits the complete view to bounds, using the current field of view unless
   * `fovY` is passed. Fixed clipping expands the far plane when required;
   * tracked clipping derives both planes from the declared bounds.
   */
  readonly fit: (bounds: GltfAssetBounds, options: OrbitCameraControllerFitOptions) => void;
  /** Reads the latest committed projection without subscribing React. */
  readonly getProjection: () => OrbitCameraProjection;
  /** Reads the latest committed orbit view without subscribing React. */
  readonly getView: () => OrbitCameraView;
  /** Replaces tracked clipping with fixed clipping and field-of-view values. */
  readonly setProjection: (projection: OrbitCameraProjection) => void;
  /** Commits a complete orbit view to every renderer using `camera`. */
  readonly setView: (view: OrbitCameraViewOptions) => void;
  /** Subscribes to committed view changes. */
  readonly subscribeView: (listener: () => void) => () => void;
}

/** Options for one stable orbit camera controller. */
export interface OrbitCameraOptions {
  /** Initial-only target and distance in metres; angles are radians. */
  readonly initial: OrbitCameraViewOptions;
  /** Far clipping distance in metres. @defaultValue `100` */
  readonly far?: Metres;
  /** Vertical field of view in radians. @defaultValue `Math.PI / 4` */
  readonly fovY?: Rads;
  /**
   * Near clipping distance in metres. Keep this below the closest intended
   * camera-to-surface distance; for example, use `0.01` when orbiting to
   * `0.1`. This is the minimum near plane under tracked bounds.
   * @defaultValue `0.1`
   */
  readonly near?: Metres;
}

/** @internal Validates shared imperative/hook options before state is retained. */
export const validateOrbitCameraOptions = (options: OrbitCameraOptions): void => {
  recordWithAllowedFields(
    options,
    ORBIT_CAMERA_OPTION_FIELDS,
    "Orbit camera options",
    "option",
  );
  if (
    typeof options.initial !== "object"
    || options.initial === null
    || Array.isArray(options.initial)
  ) {
    throw new TypeError("Orbit camera initial must be an OrbitCameraViewOptions object");
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

type TrackedOrbitClipping = Readonly<{
  center: readonly [number, number, number];
  radius: number;
}>;

const trackedOrbitClipping = (
  bounds: GltfAssetBounds,
  padding: number,
): TrackedOrbitClipping => {
  const center: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  ];
  return {
    center,
    radius: Math.hypot(
      bounds.max[0] - center[0],
      bounds.max[1] - center[1],
      bounds.max[2] - center[2],
    ) * padding,
  };
};

const trackedOrbitProjection = (
  clipping: TrackedOrbitClipping,
  view: OrbitCameraView,
  fixed: OrbitCameraProjection,
): OrbitCameraProjection => {
  const cosPitch = Math.cos(view.pitch);
  const forwardX = Math.sin(view.yaw) * cosPitch;
  const forwardY = -Math.sin(view.pitch);
  const forwardZ = -Math.cos(view.yaw) * cosPitch;
  const cameraX = view.target[0] - forwardX * view.distance;
  const cameraY = view.target[1] - forwardY * view.distance;
  const cameraZ = view.target[2] - forwardZ * view.distance;
  const centerDepth = (
    (clipping.center[0] - cameraX) * forwardX
    + (clipping.center[1] - cameraY) * forwardY
    + (clipping.center[2] - cameraZ) * forwardZ
  );
  const near = Math.max(fixed.near, centerDepth - clipping.radius);
  const minimumFar = near + Number.EPSILON * Math.max(1, Math.abs(near));
  return {
    far: Math.max(minimumFar, centerDepth + clipping.radius),
    fovY: fixed.fovY,
    near,
  };
};

const sameOrbitCameraProjection = (
  left: OrbitCameraProjection,
  right: OrbitCameraProjection,
): boolean => left.far === right.far && left.fovY === right.fovY && left.near === right.near;

/** Creates a stable imperative orbit camera controller for React or non-React composition. */
export const createOrbitCameraController = (
  options: OrbitCameraOptions,
): OrbitCameraController => {
  validateOrbitCameraOptions(options);
  const {
    initial,
    far = 100,
    fovY = Math.PI / 4,
    near = 0.1,
  } = options;
  let view = stableOrbitView(initial);
  let currentProjection = validOrbitCameraProjection({ far, fovY, near });
  let fixedProjection = currentProjection;
  let trackedClipping: TrackedOrbitClipping | null = null;
  const cameraResource = createCameraViewResource(orbitPerspectiveCamera({
    ...currentProjection,
    view,
  }));
  const setView = (next: OrbitCameraViewOptions): void => {
    const resolved = stableOrbitView(next);
    const projection = trackedClipping === null
      ? currentProjection
      : trackedOrbitProjection(trackedClipping, resolved, fixedProjection);
    if (
      sameOrbitCameraView(view, resolved)
      && sameOrbitCameraProjection(currentProjection, projection)
    ) return;
    view = resolved;
    if (!sameOrbitCameraProjection(currentProjection, projection)) {
      currentProjection = projection;
      cameraResource.far = projection.far;
      cameraResource.near = projection.near;
    }
    writeOrbitCamera(cameraResource, view);
    cameraResource.commit();
  };
  return {
    camera: cameraResource,
    fit: (bounds, options) => {
      const {
        clipping = "preserve",
        ...viewOptions
      } = options;
      if (clipping !== "preserve" && clipping !== "track-bounds") {
        throw new TypeError(`Orbit camera fit has unsupported clipping ${String(clipping)}`);
      }
      const fittedView = fitOrbitCameraView(bounds, {
        ...viewOptions,
        fovY: viewOptions.fovY ?? currentProjection.fovY,
      });
      let projection: OrbitCameraProjection;
      if (clipping === "track-bounds") {
        trackedClipping = trackedOrbitClipping(bounds, viewOptions.padding ?? 1);
        projection = trackedOrbitProjection(trackedClipping, fittedView, fixedProjection);
      } else {
        const preservedFar = trackedClipping === null
          ? currentProjection.far
          : fixedProjection.far;
        trackedClipping = null;
        projection = {
          ...fixedProjection,
          far: Math.max(
            preservedFar,
            fittedOrbitFar(bounds, fittedView, viewOptions.padding ?? 1),
          ),
        };
      }
      const viewChanged = !sameOrbitCameraView(view, fittedView);
      const projectionChanged = !sameOrbitCameraProjection(currentProjection, projection);
      if (!viewChanged && !projectionChanged) return;
      view = fittedView;
      if (projectionChanged) {
        currentProjection = projection;
        cameraResource.far = projection.far;
        cameraResource.fovY = projection.fovY;
        cameraResource.near = projection.near;
      }
      writeOrbitCamera(cameraResource, view);
      cameraResource.commit();
    },
    getProjection: () => currentProjection,
    getView: () => view,
    setProjection: (nextProjection) => {
      const { far, fovY, near } = validOrbitCameraProjection(nextProjection);
      const projection = { far, fovY, near };
      trackedClipping = null;
      fixedProjection = projection;
      if (sameOrbitCameraProjection(currentProjection, projection)) return;
      currentProjection = projection;
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
export const useOrbitCamera = (options: OrbitCameraOptions): OrbitCameraController => {
  validateOrbitCameraOptions(options);
  const {
    initial,
    far = 100,
    fovY = Math.PI / 4,
    near = 0.1,
  } = options;
  const controllerRef = useRef<OrbitCameraController | undefined>(undefined);
  if (controllerRef.current === undefined) {
    controllerRef.current = createOrbitCameraController({ far, fovY, initial, near });
  }
  const requestedProjectionRef = useRef<OrbitCameraProjection>({ far, fovY, near });
  useLayoutEffect(() => {
    const requested = { far, fovY, near };
    if (sameOrbitCameraProjection(requestedProjectionRef.current, requested)) return;
    requestedProjectionRef.current = requested;
    controllerRef.current?.setProjection({ far, fovY, near });
  }, [far, fovY, near]);
  return controllerRef.current;
};
