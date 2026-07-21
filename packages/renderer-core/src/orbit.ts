import type { PerspectiveCamera, PerspectiveCameraOptions } from './camera';
import { perspectiveCamera } from './camera';
import type { GltfAssetBounds } from './gltf';
import {
  finiteNumber,
  resolveVec3,
  objectWithAllowedFields,
  positiveFiniteNumber,
} from './descriptor-values';
import type { Direction3, EulerRads, Metres, Rads, WorldPosition3 } from './primitives';

export type OrbitCameraView = {
  /** Camera-to-target distance in metres. */
  readonly distance: Metres;
  readonly pitch: Rads;
  readonly target: WorldPosition3;
  readonly yaw: Rads;
};

export type OrbitCameraViewOptions = {
  /** Camera-to-target distance in metres. */
  readonly distance: Metres;
  /** Vertical angle in radians. @defaultValue `0` */
  readonly pitch?: Rads | undefined;
  /** World-space point the camera orbits. @defaultValue `[0, 0, 0]` */
  readonly target?: WorldPosition3 | undefined;
  /** Horizontal angle in radians. @defaultValue `0` */
  readonly yaw?: Rads | undefined;
};

export type OrbitCameraViewConstraints = {
  /** Maximum camera-to-target distance in metres. */
  readonly maxDistance?: Metres | undefined;
  /** Maximum vertical angle in radians. */
  readonly maxPitch?: Rads | undefined;
  /** Minimum camera-to-target distance in metres. */
  readonly minDistance?: Metres | undefined;
  /** Minimum vertical angle in radians. */
  readonly minPitch?: Rads | undefined;
};

export type OrbitCameraFitOptions = {
  /** Viewport width divided by height. */
  readonly aspectRatio: number;
  /** Vertical field of view in radians. @defaultValue `Math.PI / 4` */
  readonly fovY?: Rads | undefined;
  /** Lower distance clamp in metres. Point-sized bounds otherwise fit at one metre. */
  readonly minDistance?: Metres | undefined;
  /** Multiplicative clearance around the conservative bounding sphere. @defaultValue `1` */
  readonly padding?: number | undefined;
  /** Vertical angle in radians. @defaultValue `0` */
  readonly pitch?: Rads | undefined;
  /** Horizontal angle in radians. @defaultValue `0` */
  readonly yaw?: Rads | undefined;
};

export type OrbitCameraBasis = {
  readonly right: Direction3;
  readonly up: Direction3;
};

export type OrbitCameraTransform = {
  readonly position: WorldPosition3;
  readonly rotation: EulerRads;
};

export type OrbitPerspectiveCameraOptions =
  Omit<PerspectiveCameraOptions, 'position' | 'rotation'> & {
    readonly view: OrbitCameraViewOptions;
  };

const defaultTarget = resolveVec3([0, 0, 0], 'orbit target');
const ORBIT_VIEW_FIELDS = ['distance', 'pitch', 'target', 'yaw'] as const;
const ORBIT_CONSTRAINT_FIELDS = ['maxDistance', 'maxPitch', 'minDistance', 'minPitch'] as const;
const ORBIT_FIT_FIELDS = ['aspectRatio', 'fovY', 'minDistance', 'padding', 'pitch', 'yaw'] as const;
const ORBIT_PERSPECTIVE_CAMERA_FIELDS = ['far', 'fovY', 'near', 'view'] as const;

const orbitTarget = (target: WorldPosition3 | undefined): WorldPosition3 => {
  if (target === undefined) return defaultTarget;
  finiteNumber(target[0], 'orbit target[0]');
  finiteNumber(target[1], 'orbit target[1]');
  finiteNumber(target[2], 'orbit target[2]');
  return Object.isFrozen(target) ? target : resolveVec3(target, 'orbit target');
};

const clamp = (
  value: number,
  minimum: number | undefined,
  maximum: number | undefined
): number => Math.min(maximum ?? Infinity, Math.max(minimum ?? -Infinity, value));

const finiteOptional = (value: number | undefined, label: string): number | undefined =>
  value === undefined ? undefined : finiteNumber(value, label);

const validateOrbitConstraints = (constraints: OrbitCameraViewConstraints): void => {
  objectWithAllowedFields(constraints, ORBIT_CONSTRAINT_FIELDS, 'orbit constraints');
  const minDistance = constraints.minDistance === undefined
    ? undefined
    : positiveFiniteNumber(constraints.minDistance, 'orbit minDistance');
  const maxDistance = constraints.maxDistance === undefined
    ? undefined
    : positiveFiniteNumber(constraints.maxDistance, 'orbit maxDistance');
  const minPitch = finiteOptional(constraints.minPitch, 'orbit minPitch');
  const maxPitch = finiteOptional(constraints.maxPitch, 'orbit maxPitch');
  if (minDistance !== undefined && maxDistance !== undefined && minDistance > maxDistance) {
    throw new RangeError('orbit minDistance must not exceed maxDistance');
  }
  if (minPitch !== undefined && maxPitch !== undefined && minPitch > maxPitch) {
    throw new RangeError('orbit minPitch must not exceed maxPitch');
  }
};

const resolveOrbitCameraViewWithConstraints = (
  view: OrbitCameraViewOptions,
  constraints?: OrbitCameraViewConstraints,
): OrbitCameraView => {
  objectWithAllowedFields(view, ORBIT_VIEW_FIELDS, 'orbit view');
  const distance = positiveFiniteNumber(view.distance, 'orbit distance');
  const pitch = finiteNumber(view.pitch ?? 0, 'orbit pitch');
  return {
    distance: constraints === undefined
      ? distance
      : clamp(distance, constraints.minDistance, constraints.maxDistance),
    pitch: constraints === undefined
      ? pitch
      : clamp(pitch, constraints.minPitch, constraints.maxPitch),
    target: orbitTarget(view.target),
    yaw: finiteNumber(view.yaw ?? 0, 'orbit yaw')
  };
};

/** Resolves an orbit view into explicit target, distance, pitch, and yaw values. */
export const resolveOrbitCameraView = (view: OrbitCameraViewOptions): OrbitCameraView =>
  resolveOrbitCameraViewWithConstraints(view);

/** Resolves an orbit view while applying explicit distance and pitch constraints. */
export const clampOrbitCameraView = (
  view: OrbitCameraViewOptions,
  constraints: OrbitCameraViewConstraints = {}
): OrbitCameraView => {
  validateOrbitConstraints(constraints);
  return resolveOrbitCameraViewWithConstraints(view, constraints);
};

/** Conservatively fits an orbit view to bounds in the same coordinate space as the returned target. */
export const fitOrbitCameraView = (
  bounds: GltfAssetBounds,
  options: OrbitCameraFitOptions,
): OrbitCameraView => {
  objectWithAllowedFields(options, ORBIT_FIT_FIELDS, 'orbit camera fit');
  const aspectRatio = positiveFiniteNumber(options.aspectRatio, 'orbit camera fit aspectRatio');
  const fovY = finiteNumber(options.fovY ?? Math.PI / 4, 'orbit camera fit fovY');
  if (!(fovY > 0 && fovY < Math.PI)) {
    throw new RangeError('orbit camera fit fovY must be within (0, PI)');
  }
  const padding = finiteNumber(options.padding ?? 1, 'orbit camera fit padding');
  if (padding < 1) throw new RangeError('orbit camera fit padding must be at least 1');
  const minDistance = options.minDistance === undefined
    ? undefined
    : positiveFiniteNumber(options.minDistance, 'orbit camera fit minDistance');

  const min = bounds.min;
  const max = bounds.max;
  for (let axis = 0; axis < 3; axis += 1) {
    finiteNumber(min[axis]!, `orbit camera fit bounds.min[${axis}]`);
    finiteNumber(max[axis]!, `orbit camera fit bounds.max[${axis}]`);
    if (min[axis]! > max[axis]!) {
      throw new RangeError(`orbit camera fit bounds.min[${axis}] must not exceed bounds.max[${axis}]`);
    }
  }
  const halfX = (max[0] - min[0]) / 2;
  const halfY = (max[1] - min[1]) / 2;
  const halfZ = (max[2] - min[2]) / 2;
  const radius = Math.hypot(halfX, halfY, halfZ);
  const verticalHalfFov = fovY / 2;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspectRatio);
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const fittedDistance = radius === 0 ? 1 : radius * padding / Math.sin(limitingHalfFov);

  return resolveOrbitCameraView({
    distance: Math.max(minDistance ?? 0, fittedDistance),
    pitch: options.pitch,
    target: [
      min[0] + halfX,
      min[1] + halfY,
      min[2] + halfZ,
    ],
    yaw: options.yaw,
  });
};

/** Returns world-space right and up axes for an orbit view. */
export const orbitCameraBasis = (view: OrbitCameraViewOptions): OrbitCameraBasis => {
  const { pitch, yaw } = resolveOrbitCameraView(view);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);

  return {
    right: resolveVec3([cy, 0, sy], 'orbit right basis'),
    up: resolveVec3([sx * sy, cx, -sx * cy], 'orbit up basis')
  };
};

/** Rotates an orbit view by pointer movement measured in CSS pixels. */
export const rotateOrbitCameraView = (
  view: OrbitCameraViewOptions,
  /** Pointer movement in CSS pixels. */
  deltaX: number,
  /** Pointer movement in CSS pixels. */
  deltaY: number,
  /** Radians per CSS pixel. */
  rotateSpeed: number
): OrbitCameraView => {
  const resolvedView = resolveOrbitCameraView(view);
  finiteNumber(deltaX, 'orbit rotation deltaX');
  finiteNumber(deltaY, 'orbit rotation deltaY');
  finiteNumber(rotateSpeed, 'orbit rotateSpeed');

  return {
    distance: resolvedView.distance,
    pitch: finiteNumber(resolvedView.pitch + deltaY * rotateSpeed, 'orbit pitch'),
    target: resolvedView.target,
    yaw: finiteNumber(resolvedView.yaw + deltaX * rotateSpeed, 'orbit yaw'),
  };
};

/** Applies exponential pointer/wheel zoom to an orbit view. */
export const zoomOrbitCameraView = (
  view: OrbitCameraViewOptions,
  deltaPixels: number,
  /** Exponential zoom coefficient per CSS pixel. */
  zoomSpeed: number
): OrbitCameraView => {
  const resolvedView = resolveOrbitCameraView(view);
  finiteNumber(deltaPixels, 'orbit zoom deltaPixels');
  finiteNumber(zoomSpeed, 'orbit zoomSpeed');

  return {
    distance: positiveFiniteNumber(
      resolvedView.distance * Math.exp(deltaPixels * zoomSpeed),
      'orbit distance',
    ),
    pitch: resolvedView.pitch,
    target: resolvedView.target,
    yaw: resolvedView.yaw,
  };
};

/** Pans an orbit target using pointer movement measured in CSS pixels. */
export const panOrbitCameraView = (
  view: OrbitCameraViewOptions,
  /** Pointer movement in CSS pixels. */
  deltaX: number,
  /** Pointer movement in CSS pixels. */
  deltaY: number,
  /** Target displacement ratio per CSS pixel, scaled by orbit distance. */
  panSpeed: number
): OrbitCameraView => {
  const resolvedView = resolveOrbitCameraView(view);
  finiteNumber(deltaX, 'orbit pan deltaX');
  finiteNumber(deltaY, 'orbit pan deltaY');
  finiteNumber(panSpeed, 'orbit panSpeed');
  const cy = Math.cos(resolvedView.yaw);
  const sy = Math.sin(resolvedView.yaw);
  const cx = Math.cos(resolvedView.pitch);
  const sx = Math.sin(resolvedView.pitch);
  const scale = resolvedView.distance * panSpeed;

  return {
    distance: resolvedView.distance,
    pitch: resolvedView.pitch,
    target: resolveVec3([
      resolvedView.target[0] - cy * deltaX * scale + sx * sy * deltaY * scale,
      resolvedView.target[1] + cx * deltaY * scale,
      resolvedView.target[2] - sy * deltaX * scale - sx * cy * deltaY * scale,
    ], 'orbit target') as WorldPosition3,
    yaw: resolvedView.yaw,
  };
};

/** Converts an orbit view to a Royal camera position and Euler rotation. */
export const orbitCameraTransform = (
  view: OrbitCameraViewOptions
): OrbitCameraTransform => {
  const { distance, pitch, target, yaw } = resolveOrbitCameraView(view);
  const cosPitch = Math.cos(pitch);

  return {
    position: resolveVec3([
      target[0] - Math.sin(yaw) * cosPitch * distance,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * cosPitch * distance
    ], 'orbit camera position'),
    rotation: resolveVec3([-pitch, -yaw, 0], 'orbit camera rotation') as EulerRads
  };
};

/** Creates a perspective camera positioned and rotated from an orbit view. */
export const orbitPerspectiveCamera = (
  input: OrbitPerspectiveCameraOptions,
): PerspectiveCamera => {
  objectWithAllowedFields(input, ORBIT_PERSPECTIVE_CAMERA_FIELDS, 'orbit perspective camera');
  const { view, ...options } = input;
  return perspectiveCamera({
    ...options,
    ...orbitCameraTransform(view)
  });
};
