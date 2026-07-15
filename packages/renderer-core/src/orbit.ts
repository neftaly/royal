import type { PerspectiveCamera, PerspectiveCameraOptions } from './camera';
import { perspectiveCamera } from './camera';
import {
  finiteNumber,
  frozenVec3,
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
  readonly pitch?: Rads | undefined;
  readonly target?: WorldPosition3 | undefined;
  readonly yaw?: Rads | undefined;
};

export type OrbitCameraViewConstraints = {
  /** Maximum camera-to-target distance in metres. */
  readonly maxDistance?: Metres | undefined;
  readonly maxPitch?: Rads | undefined;
  /** Minimum camera-to-target distance in metres. */
  readonly minDistance?: Metres | undefined;
  readonly minPitch?: Rads | undefined;
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

const defaultTarget = frozenVec3([0, 0, 0], 'orbit target');
const ORBIT_VIEW_FIELDS = ['distance', 'pitch', 'target', 'yaw'] as const;
const ORBIT_CONSTRAINT_FIELDS = ['maxDistance', 'maxPitch', 'minDistance', 'minPitch'] as const;
const ORBIT_PERSPECTIVE_CAMERA_FIELDS = ['far', 'fovY', 'near', 'view'] as const;

const orbitTarget = (target: WorldPosition3 | undefined): WorldPosition3 => {
  if (target === undefined) return defaultTarget;
  finiteNumber(target[0], 'orbit target[0]');
  finiteNumber(target[1], 'orbit target[1]');
  finiteNumber(target[2], 'orbit target[2]');
  return Object.isFrozen(target) ? target : frozenVec3(target, 'orbit target');
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
    throw new Error('orbit minDistance must not exceed maxDistance');
  }
  if (minPitch !== undefined && maxPitch !== undefined && minPitch > maxPitch) {
    throw new Error('orbit minPitch must not exceed maxPitch');
  }
};

export const resolveOrbitCameraView = (view: OrbitCameraViewOptions): OrbitCameraView => {
  objectWithAllowedFields(view, ORBIT_VIEW_FIELDS, 'orbit view');
  return Object.freeze({
    distance: positiveFiniteNumber(view.distance, 'orbit distance'),
    pitch: finiteNumber(view.pitch ?? 0, 'orbit pitch'),
    target: orbitTarget(view.target),
    yaw: finiteNumber(view.yaw ?? 0, 'orbit yaw')
  });
};

export const clampOrbitCameraView = (
  view: OrbitCameraViewOptions,
  constraints: OrbitCameraViewConstraints = {}
): OrbitCameraView => {
  validateOrbitConstraints(constraints);
  const resolvedView = resolveOrbitCameraView(view);

  return Object.freeze({
    ...resolvedView,
    distance: clamp(resolvedView.distance, constraints.minDistance, constraints.maxDistance),
    pitch: clamp(resolvedView.pitch, constraints.minPitch, constraints.maxPitch)
  });
};

export const orbitCameraBasis = (view: OrbitCameraViewOptions): OrbitCameraBasis => {
  const { pitch, yaw } = resolveOrbitCameraView(view);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);

  return Object.freeze({
    right: frozenVec3([cy, 0, sy], 'orbit right basis'),
    up: frozenVec3([sx * sy, cx, -sx * cy], 'orbit up basis')
  });
};

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

  return resolveOrbitCameraView({
    ...resolvedView,
    pitch: resolvedView.pitch + deltaY * rotateSpeed,
    yaw: resolvedView.yaw + deltaX * rotateSpeed
  });
};

export const zoomOrbitCameraView = (
  view: OrbitCameraViewOptions,
  deltaPixels: number,
  /** Exponential zoom coefficient per CSS pixel. */
  zoomSpeed: number
): OrbitCameraView => {
  const resolvedView = resolveOrbitCameraView(view);
  finiteNumber(deltaPixels, 'orbit zoom deltaPixels');
  finiteNumber(zoomSpeed, 'orbit zoomSpeed');

  return resolveOrbitCameraView({
    ...resolvedView,
    distance: resolvedView.distance * Math.exp(deltaPixels * zoomSpeed)
  });
};

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
  const { right, up } = orbitCameraBasis(resolvedView);
  const scale = resolvedView.distance * panSpeed;

  return resolveOrbitCameraView({
    ...resolvedView,
    target: [
      resolvedView.target[0] - right[0] * deltaX * scale + up[0] * deltaY * scale,
      resolvedView.target[1] - right[1] * deltaX * scale + up[1] * deltaY * scale,
      resolvedView.target[2] - right[2] * deltaX * scale + up[2] * deltaY * scale
    ]
  });
};

export const orbitCameraTransform = (
  view: OrbitCameraViewOptions
): OrbitCameraTransform => {
  const { distance, pitch, target, yaw } = resolveOrbitCameraView(view);
  const cosPitch = Math.cos(pitch);

  return Object.freeze({
    position: frozenVec3([
      target[0] - Math.sin(yaw) * cosPitch * distance,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * cosPitch * distance
    ], 'orbit camera position'),
    rotation: frozenVec3([-pitch, -yaw, 0], 'orbit camera rotation') as EulerRads
  });
};

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
