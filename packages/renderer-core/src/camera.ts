import type { EulerRads, Rads, Vec3 } from './primitives';

/** Perspective camera for a render pass. */
export interface PerspectiveCamera {
  readonly kind: 'perspective-camera';
  readonly position: Vec3;
  readonly rotation: EulerRads;
  readonly fovY: Rads;
  readonly near: number;
  readonly far: number;
}

/** Orthographic camera for flat or isometric render passes. */
export interface OrthographicCamera {
  readonly kind: 'orthographic-camera';
  readonly position: Vec3;
  readonly rotation: EulerRads;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly near: number;
  readonly far: number;
}

export interface PerspectiveCameraOptions {
  readonly position: Vec3;
  readonly rotation: EulerRads;
  /** Vertical field of view in radians. */
  readonly fovY: Rads;
  readonly near: number;
  readonly far: number;
}

export interface OrthographicCameraOptions {
  readonly position?: Vec3;
  readonly rotation?: EulerRads;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly near?: number;
  readonly far?: number;
}

export type Camera = PerspectiveCamera | OrthographicCamera;

export const perspectiveCamera = (options: PerspectiveCameraOptions): PerspectiveCamera => ({
  kind: 'perspective-camera',
  position: options.position,
  rotation: options.rotation,
  fovY: options.fovY,
  near: options.near,
  far: options.far
});

export const orthographicCamera = (options: OrthographicCameraOptions): OrthographicCamera => ({
  kind: 'orthographic-camera',
  position: options.position ?? [0, 0, 0],
  rotation: options.rotation ?? [0, 0, 0],
  left: options.left,
  right: options.right,
  bottom: options.bottom,
  top: options.top,
  near: options.near ?? -1,
  far: options.far ?? 1
});
