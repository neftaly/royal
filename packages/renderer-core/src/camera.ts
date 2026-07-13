import type { EulerRads, Metres, Rads, WorldPosition3 } from './primitives';

const frozenVec3 = (value: WorldPosition3): WorldPosition3 => Object.freeze([value[0], value[1], value[2]]) as WorldPosition3;

const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`camera ${label} must be finite; received ${String(value)}`);
};

const validatePose = (position: WorldPosition3, rotation: EulerRads): void => {
  for (let index = 0; index < 3; index += 1) {
    finite(position[index]!, `position[${index}]`);
    finite(rotation[index]!, `rotation[${index}]`);
  }
};

/** Perspective camera for a scene. */
export interface PerspectiveCamera {
  readonly kind: 'perspective-camera';
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  readonly rotation: EulerRads;
  readonly fovY: Rads;
  /** Near clipping distance in metres. */
  readonly near: Metres;
  /** Far clipping distance in metres. */
  readonly far: Metres;
}

/** Orthographic camera for flat or isometric scenes. */
export interface OrthographicCamera {
  readonly kind: 'orthographic-camera';
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  readonly rotation: EulerRads;
  /** Orthographic bounds relative to the camera, in metres. */
  readonly left: Metres;
  readonly right: Metres;
  readonly bottom: Metres;
  readonly top: Metres;
  /** Clipping-plane coordinates in metres. */
  readonly near: Metres;
  readonly far: Metres;
}

export interface PerspectiveCameraOptions {
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  readonly rotation: EulerRads;
  /** Vertical field of view in radians. */
  readonly fovY: Rads;
  /** Near clipping distance in metres. */
  readonly near: Metres;
  /** Far clipping distance in metres. */
  readonly far: Metres;
}

export interface OrthographicCameraOptions {
  /** World-space position in metres. @defaultValue `[0, 0, 0]` */
  readonly position?: WorldPosition3;
  readonly rotation?: EulerRads;
  /** Orthographic bounds relative to the camera, in metres. */
  readonly left: Metres;
  readonly right: Metres;
  readonly bottom: Metres;
  readonly top: Metres;
  /** @defaultValue `-1000` */
  readonly near?: Metres;
  /** @defaultValue `1000` */
  readonly far?: Metres;
}

export type Camera = PerspectiveCamera | OrthographicCamera;

export const perspectiveCamera = (options: PerspectiveCameraOptions): PerspectiveCamera => {
  validatePose(options.position, options.rotation);
  finite(options.fovY, 'fovY'); finite(options.near, 'near'); finite(options.far, 'far');
  if (!(options.fovY > 0 && options.fovY < Math.PI)) throw new Error('perspective camera fovY must be within 0..PI');
  if (!(options.near > 0 && options.far > options.near)) throw new Error('perspective camera requires 0 < near < far');
  return Object.freeze({
    kind: 'perspective-camera', position: frozenVec3(options.position), rotation: frozenVec3(options.rotation),
    fovY: options.fovY, near: options.near, far: options.far
  });
};

export const orthographicCamera = (options: OrthographicCameraOptions): OrthographicCamera => {
  const position = options.position ?? [0, 0, 0];
  const rotation = options.rotation ?? [0, 0, 0];
  const near = options.near ?? -1000;
  const far = options.far ?? 1000;
  validatePose(position, rotation);
  finite(options.left, 'left'); finite(options.right, 'right'); finite(options.bottom, 'bottom'); finite(options.top, 'top');
  finite(near, 'near'); finite(far, 'far');
  if (options.left === options.right || options.bottom === options.top) throw new Error('orthographic camera bounds must have non-zero width and height');
  if (!(far > near)) throw new Error('orthographic camera requires near < far');
  return Object.freeze({
    kind: 'orthographic-camera', position: frozenVec3(position), rotation: frozenVec3(rotation),
    left: options.left, right: options.right, bottom: options.bottom, top: options.top, near, far
  });
};
