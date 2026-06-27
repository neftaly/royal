import { CameraKind } from './kind';
import type { EulerRads, Rads, Vec3 } from './primitives';

/** Perspective camera for a render pass. */
export interface PerspectiveCamera {
  readonly kind: CameraKind.Perspective;
  readonly position: Vec3;
  readonly rotation: EulerRads;
  readonly fovY: Rads;
  readonly near: number;
  readonly far: number;
}

/** Orthographic camera for flat or isometric render passes. */
export interface OrthographicCamera {
  readonly kind: CameraKind.Orthographic;
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
  readonly position: Vec3;
  readonly rotation: EulerRads;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly near: number;
  readonly far: number;
}

export type Camera = PerspectiveCamera | OrthographicCamera;

export const perspectiveCamera = (options: PerspectiveCameraOptions): PerspectiveCamera => ({
  kind: CameraKind.Perspective,
  position: options.position,
  rotation: options.rotation,
  fovY: options.fovY,
  near: options.near,
  far: options.far
});

export const orthographicCamera = (options: OrthographicCameraOptions): OrthographicCamera => ({
  kind: CameraKind.Orthographic,
  position: options.position,
  rotation: options.rotation,
  left: options.left,
  right: options.right,
  bottom: options.bottom,
  top: options.top,
  near: options.near,
  far: options.far
});
