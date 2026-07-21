import { finiteNumber, resolveVec3, objectWithAllowedFields } from './descriptor-values';
import type { EulerRads, Metres, Rads, WorldPosition3 } from './primitives';

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
  /** World-space position in metres. @defaultValue `[0, 0, 0]` */
  readonly position?: WorldPosition3;
  /** XYZ Euler rotation in radians. @defaultValue `[0, 0, 0]` */
  readonly rotation?: EulerRads;
  /** Vertical field of view in radians. @defaultValue `Math.PI / 4` */
  readonly fovY?: Rads;
  /** Near clipping distance in metres. @defaultValue `0.1` */
  readonly near?: Metres;
  /** Far clipping distance in metres. @defaultValue `1000` */
  readonly far?: Metres;
}

export interface OrthographicCameraOptions {
  /** World-space position in metres. @defaultValue `[0, 0, 0]` */
  readonly position?: WorldPosition3;
  /** XYZ Euler rotation in radians. @defaultValue `[0, 0, 0]` */
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

const PERSPECTIVE_CAMERA_FIELDS = ['far', 'fovY', 'near', 'position', 'rotation'] as const;
const ORTHOGRAPHIC_CAMERA_FIELDS = [
  'bottom', 'far', 'left', 'near', 'position', 'right', 'rotation', 'top',
] as const;

/** Creates a validated perspective camera looking along local -Z. */
export const perspectiveCamera = (options: PerspectiveCameraOptions): PerspectiveCamera => {
  objectWithAllowedFields(options, PERSPECTIVE_CAMERA_FIELDS, 'perspective camera');
  const position = resolveVec3(options.position ?? [0, 0, 0], 'camera position') as WorldPosition3;
  const rotation = resolveVec3(options.rotation ?? [0, 0, 0], 'camera rotation') as EulerRads;
  const fovY = options.fovY ?? Math.PI / 4;
  const near = options.near ?? 0.1;
  const far = options.far ?? 1000;
  finiteNumber(fovY, 'camera fovY');
  finiteNumber(near, 'camera near');
  finiteNumber(far, 'camera far');
  if (!(fovY > 0 && fovY < Math.PI)) throw new RangeError('perspective camera fovY must be within (0, PI)');
  if (!(near > 0 && far > near)) throw new RangeError('perspective camera requires 0 < near < far');
  return {
    kind: 'perspective-camera', position, rotation,
    fovY, near, far
  };
};

/** Creates a validated orthographic camera looking along local -Z. */
export const orthographicCamera = (options: OrthographicCameraOptions): OrthographicCamera => {
  objectWithAllowedFields(options, ORTHOGRAPHIC_CAMERA_FIELDS, 'orthographic camera');
  const position = resolveVec3(options.position ?? [0, 0, 0], 'camera position') as WorldPosition3;
  const rotation = resolveVec3(options.rotation ?? [0, 0, 0], 'camera rotation') as EulerRads;
  const near = options.near ?? -1000;
  const far = options.far ?? 1000;
  finiteNumber(options.left, 'camera left');
  finiteNumber(options.right, 'camera right');
  finiteNumber(options.bottom, 'camera bottom');
  finiteNumber(options.top, 'camera top');
  finiteNumber(near, 'camera near');
  finiteNumber(far, 'camera far');
  if (options.left === options.right || options.bottom === options.top) throw new RangeError('orthographic camera bounds must have non-zero width and height');
  if (!(far > near)) throw new RangeError('orthographic camera requires near < far');
  return {
    kind: 'orthographic-camera', position, rotation,
    left: options.left, right: options.right, bottom: options.bottom, top: options.top, near, far
  };
};
