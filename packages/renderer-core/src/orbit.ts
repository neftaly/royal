import type { PerspectiveCamera, PerspectiveCameraOptions } from './camera';
import { perspectiveCamera } from './camera';
import type { EulerRads, Rads, Vec3 } from './primitives';

export type OrbitVector3 = Vec3;

export type OrbitCameraView = {
  readonly distance: number;
  readonly pitch: Rads;
  readonly target: OrbitVector3;
  readonly yaw: Rads;
};

export type OrbitCameraViewOptions = {
  readonly distance: number;
  readonly pitch?: Rads | undefined;
  readonly target?: OrbitVector3 | undefined;
  readonly yaw?: Rads | undefined;
};

export type OrbitCameraViewConstraints = {
  readonly maxDistance?: number | undefined;
  readonly maxPitch?: Rads | undefined;
  readonly minDistance?: number | undefined;
  readonly minPitch?: Rads | undefined;
};

export type OrbitCameraBasis = {
  readonly right: OrbitVector3;
  readonly up: OrbitVector3;
};

export type OrbitCameraTransform = {
  readonly position: OrbitVector3;
  readonly rotation: EulerRads;
};

export type OrbitPerspectiveCameraOptions =
  Omit<PerspectiveCameraOptions, 'position' | 'rotation'> & {
    readonly view: OrbitCameraViewOptions;
  };

const defaultTarget = [0, 0, 0] as const satisfies OrbitVector3;

const clamp = (
  value: number,
  minimum: number | undefined,
  maximum: number | undefined
): number => Math.min(maximum ?? Infinity, Math.max(minimum ?? -Infinity, value));

export const resolveOrbitCameraView = (view: OrbitCameraViewOptions): OrbitCameraView => ({
  distance: view.distance,
  pitch: view.pitch ?? 0,
  target: view.target ?? defaultTarget,
  yaw: view.yaw ?? 0
});

export const clampOrbitCameraView = (
  view: OrbitCameraViewOptions,
  constraints: OrbitCameraViewConstraints = {}
): OrbitCameraView => {
  const resolvedView = resolveOrbitCameraView(view);

  return {
    ...resolvedView,
    distance: clamp(resolvedView.distance, constraints.minDistance, constraints.maxDistance),
    pitch: clamp(resolvedView.pitch, constraints.minPitch, constraints.maxPitch)
  };
};

export const orbitCameraBasis = (view: OrbitCameraViewOptions): OrbitCameraBasis => {
  const { pitch, yaw } = resolveOrbitCameraView(view);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);

  return {
    right: [cy, 0, sy],
    up: [sx * sy, cx, -sx * cy]
  };
};

export const rotateOrbitCameraView = (
  view: OrbitCameraViewOptions,
  deltaX: number,
  deltaY: number,
  rotateSpeed: number
): OrbitCameraView => {
  const resolvedView = resolveOrbitCameraView(view);

  return {
    ...resolvedView,
    pitch: resolvedView.pitch + deltaY * rotateSpeed,
    yaw: resolvedView.yaw + deltaX * rotateSpeed
  };
};

export const zoomOrbitCameraView = (
  view: OrbitCameraViewOptions,
  deltaPixels: number,
  zoomSpeed: number
): OrbitCameraView => {
  const resolvedView = resolveOrbitCameraView(view);

  return {
    ...resolvedView,
    distance: resolvedView.distance * Math.exp(deltaPixels * zoomSpeed)
  };
};

export const panOrbitCameraView = (
  view: OrbitCameraViewOptions,
  deltaX: number,
  deltaY: number,
  panSpeed: number
): OrbitCameraView => {
  const resolvedView = resolveOrbitCameraView(view);
  const { right, up } = orbitCameraBasis(resolvedView);
  const scale = resolvedView.distance * panSpeed;

  return {
    ...resolvedView,
    target: [
      resolvedView.target[0] - right[0] * deltaX * scale + up[0] * deltaY * scale,
      resolvedView.target[1] - right[1] * deltaX * scale + up[1] * deltaY * scale,
      resolvedView.target[2] - right[2] * deltaX * scale + up[2] * deltaY * scale
    ]
  };
};

export const orbitCameraTransform = (
  view: OrbitCameraViewOptions
): OrbitCameraTransform => {
  const { distance, pitch, target, yaw } = resolveOrbitCameraView(view);
  const cosPitch = Math.cos(pitch);

  return {
    position: [
      target[0] - Math.sin(yaw) * cosPitch * distance,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * cosPitch * distance
    ],
    rotation: [-pitch, -yaw, 0]
  };
};

export const orbitPerspectiveCamera = ({
  view,
  ...options
}: OrbitPerspectiveCameraOptions): PerspectiveCamera => perspectiveCamera({
  ...options,
  ...orbitCameraTransform(view)
});
