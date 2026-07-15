import {
  orthographicCamera,
  perspectiveCamera,
  type Camera,
  type OrthographicCamera,
  type PerspectiveCamera,
} from './camera';
import { objectWithAllowedFields } from './descriptor-values';
import type { Rads } from './primitives';

export interface CameraViewReadTarget {
  kind: Camera['kind'];
  /** Mutable XYZ position storage in metres. */
  readonly position: Float64Array;
  /** Mutable XYZ Euler-angle storage in radians. */
  readonly rotation: Float64Array;
  fovY: Rads;
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
}

export type CameraViewResourceListener = (version: number) => void;

interface CameraViewResourceBase {
  readonly kind: 'camera-view-resource';
  /** Staged XYZ position in metres. */
  readonly position: Float64Array;
  /** Staged XYZ Euler angles in radians. */
  readonly rotation: Float64Array;
  readonly version: number;
  /** Publishes staged fields. Equal commits are silent. */
  commit(): void;
  /** Copies committed values into caller-owned storage without allocating. */
  read(out: CameraViewReadTarget): void;
  subscribe(listener: CameraViewResourceListener): () => void;
}

export interface PerspectiveCameraViewResource extends CameraViewResourceBase {
  readonly projection: 'perspective';
  fovY: Rads;
  /** Near clipping distance in metres. */
  near: number;
  /** Far clipping distance in metres. */
  far: number;
  set(camera: PerspectiveCamera): void;
}

export interface OrthographicCameraViewResource extends CameraViewResourceBase {
  readonly projection: 'orthographic';
  /** Orthographic bounds and clipping distances in metres. */
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
  set(camera: OrthographicCamera): void;
}

export type CameraViewResource = PerspectiveCameraViewResource | OrthographicCameraViewResource;
export type CameraSource = Camera | CameraViewResource;

type ListenerSlot = { active: boolean; readonly listener: CameraViewResourceListener };

const PERSPECTIVE_CAMERA_FIELDS = ['far', 'fovY', 'kind', 'near', 'position', 'rotation'] as const;
const ORTHOGRAPHIC_CAMERA_FIELDS = [
  'bottom', 'far', 'kind', 'left', 'near', 'position', 'right', 'rotation', 'top',
] as const;

const normalizedCamera = (camera: Camera): Camera => {
  if (camera?.kind === 'perspective-camera') {
    objectWithAllowedFields(camera, PERSPECTIVE_CAMERA_FIELDS, 'camera view perspective camera');
    const { kind: _kind, ...options } = camera;
    return perspectiveCamera(options);
  }
  if (camera?.kind === 'orthographic-camera') {
    objectWithAllowedFields(camera, ORTHOGRAPHIC_CAMERA_FIELDS, 'camera view orthographic camera');
    const { kind: _kind, ...options } = camera;
    return orthographicCamera(options);
  }
  throw new TypeError('camera view source must be a perspectiveCamera or orthographicCamera descriptor');
};

const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`camera view ${label} must be finite; received ${String(value)}`);
};

const validatePose = (position: Float64Array, rotation: Float64Array): void => {
  for (let index = 0; index < 3; index += 1) {
    finite(position[index]!, `position[${index}]`);
    finite(rotation[index]!, `rotation[${index}]`);
  }
};

const validateDepth = (near: number, far: number): void => {
  finite(near, 'near');
  finite(far, 'far');
  if (!(far > near)) throw new Error(`camera view far must be greater than near; received near=${near} far=${far}`);
};

const same3 = (left: Float64Array, right: Float64Array): boolean =>
  left[0] === right[0] && left[1] === right[1] && left[2] === right[2];

const copy3 = (out: Float64Array, source: ArrayLike<number>): void => {
  out[0] = source[0]!;
  out[1] = source[1]!;
  out[2] = source[2]!;
};

const listenerList = () => {
  const slots: ListenerSlot[] = [];
  let tombstones = 0;
  return {
    notify: (version: number): void => {
      const length = slots.length;
      let firstError: unknown;
      for (let index = 0; index < length; index += 1) {
        const slot = slots[index];
        if (!slot?.active) continue;
        try {
          slot.listener(version);
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== undefined) throw firstError;
    },
    subscribe: (listener: CameraViewResourceListener): (() => void) => {
      if (typeof listener !== 'function') {
        throw new TypeError('camera view listener must be a function');
      }
      if (tombstones > 16 && tombstones * 2 > slots.length) {
        let write = 0;
        for (const slot of slots) {
          if (!slot.active) continue;
          slots[write] = slot;
          write += 1;
        }
        slots.length = write;
        tombstones = 0;
      }
      const slot: ListenerSlot = { active: true, listener };
      slots.push(slot);
      return () => {
        if (!slot.active) return;
        slot.active = false;
        tombstones += 1;
      };
    },
  };
};

export function createCameraViewResource(camera: PerspectiveCamera): PerspectiveCameraViewResource;
export function createCameraViewResource(camera: OrthographicCamera): OrthographicCameraViewResource;
export function createCameraViewResource(camera: Camera): CameraViewResource {
  camera = normalizedCamera(camera);
  const position = new Float64Array(camera.position);
  const rotation = new Float64Array(camera.rotation);
  const committedPosition = new Float64Array(position);
  const committedRotation = new Float64Array(rotation);
  const listeners = listenerList();
  let version = 1;
  let notifying = false;
  const publish = (): void => {
    notifying = true;
    try {
      listeners.notify(version);
    } finally {
      notifying = false;
    }
  };

  if (camera.kind === 'perspective-camera') {
    let fovY = camera.fovY;
    let near = camera.near;
    let far = camera.far;
    let committedFovY = fovY;
    let committedNear = near;
    let committedFar = far;
    const commit = (): void => {
      if (notifying) throw new Error('camera view commit cannot run from a camera view subscriber');
      validatePose(position, rotation);
      finite(fovY, 'fovY');
      if (!(fovY > 0 && fovY < Math.PI)) throw new Error(`camera view fovY must be within 0..PI; received ${fovY}`);
      validateDepth(near, far);
      if (!(near > 0)) throw new Error(`perspective camera view near must be positive; received ${near}`);
      if (same3(position, committedPosition) && same3(rotation, committedRotation)
        && fovY === committedFovY && near === committedNear && far === committedFar) return;
      copy3(committedPosition, position);
      copy3(committedRotation, rotation);
      committedFovY = fovY;
      committedNear = near;
      committedFar = far;
      version += 1;
      publish();
    };
    const resource: PerspectiveCameraViewResource = {
      kind: 'camera-view-resource', projection: 'perspective', position, rotation,
      get fovY() { return fovY; }, set fovY(value) { fovY = value; },
      get near() { return near; }, set near(value) { near = value; },
      get far() { return far; }, set far(value) { far = value; },
      get version() { return version; },
      commit,
      read: (out) => {
        out.kind = 'perspective-camera';
        copy3(out.position, committedPosition);
        copy3(out.rotation, committedRotation);
        out.fovY = committedFovY;
        out.near = committedNear;
        out.far = committedFar;
      },
      set: (next) => {
        const normalized = normalizedCamera(next);
        if (normalized.kind !== 'perspective-camera') {
          throw new TypeError('perspective camera view set requires a perspectiveCamera descriptor');
        }
        copy3(position, normalized.position);
        copy3(rotation, normalized.rotation);
        fovY = normalized.fovY;
        near = normalized.near;
        far = normalized.far;
        commit();
      },
      subscribe: listeners.subscribe,
    };
    commit();
    return resource;
  }

  let left = camera.left;
  let right = camera.right;
  let bottom = camera.bottom;
  let top = camera.top;
  let near = camera.near;
  let far = camera.far;
  let committedLeft = left;
  let committedRight = right;
  let committedBottom = bottom;
  let committedTop = top;
  let committedNear = near;
  let committedFar = far;
  const commit = (): void => {
    if (notifying) throw new Error('camera view commit cannot run from a camera view subscriber');
    validatePose(position, rotation);
    finite(left, 'left'); finite(right, 'right'); finite(bottom, 'bottom'); finite(top, 'top');
    validateDepth(near, far);
    if (left === right || bottom === top) throw new Error('camera view orthographic bounds must have non-zero width and height');
    if (same3(position, committedPosition) && same3(rotation, committedRotation)
      && left === committedLeft && right === committedRight
      && bottom === committedBottom && top === committedTop
      && near === committedNear && far === committedFar) return;
    copy3(committedPosition, position);
    copy3(committedRotation, rotation);
    committedLeft = left; committedRight = right; committedBottom = bottom; committedTop = top;
    committedNear = near; committedFar = far;
    version += 1;
    publish();
  };
  const resource: OrthographicCameraViewResource = {
    kind: 'camera-view-resource', projection: 'orthographic', position, rotation,
    get left() { return left; }, set left(value) { left = value; },
    get right() { return right; }, set right(value) { right = value; },
    get bottom() { return bottom; }, set bottom(value) { bottom = value; },
    get top() { return top; }, set top(value) { top = value; },
    get near() { return near; }, set near(value) { near = value; },
    get far() { return far; }, set far(value) { far = value; },
    get version() { return version; },
    commit,
    read: (out) => {
      out.kind = 'orthographic-camera';
      copy3(out.position, committedPosition);
      copy3(out.rotation, committedRotation);
      out.left = committedLeft; out.right = committedRight; out.bottom = committedBottom; out.top = committedTop;
      out.near = committedNear; out.far = committedFar;
    },
    set: (next) => {
      const normalized = normalizedCamera(next);
      if (normalized.kind !== 'orthographic-camera') {
        throw new TypeError('orthographic camera view set requires an orthographicCamera descriptor');
      }
      copy3(position, normalized.position); copy3(rotation, normalized.rotation);
      left = normalized.left; right = normalized.right;
      bottom = normalized.bottom; top = normalized.top;
      near = normalized.near; far = normalized.far;
      commit();
    },
    subscribe: listeners.subscribe,
  };
  commit();
  return resource;
}
