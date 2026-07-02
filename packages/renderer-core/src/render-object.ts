import type { EulerRads, Transform, Vec3 } from './primitives';

export interface RenderObjectVector3 {
  x: number;
  y: number;
  z: number;
  set(value: Vec3): void;
  set(x: number, y: number, z: number): void;
  toArray(): Vec3;
}

export type RenderObjectTransformUpdate = Partial<{
  readonly position: Vec3;
  readonly rotation: EulerRads;
  readonly scale: Vec3;
}>;

export interface RenderObjectHandle {
  readonly position: RenderObjectVector3;
  readonly rotation: RenderObjectVector3;
  readonly scale: RenderObjectVector3;
  getTransform(): Transform;
  setTransform(transform: RenderObjectTransformUpdate): void;
}

export interface RenderObjectRefObject {
  current: RenderObjectHandle | null;
}

export type RenderObjectRefCallback = (handle: RenderObjectHandle | null) => void;
export type RenderObjectRef = RenderObjectRefCallback | RenderObjectRefObject;

const sameVec3 = (left: Vec3, right: Vec3): boolean =>
  Object.is(left[0], right[0]) &&
  Object.is(left[1], right[1]) &&
  Object.is(left[2], right[2]);

class MutableRenderObjectVector3 implements RenderObjectVector3 {
  #value: [number, number, number];
  readonly #onChange: () => void;

  constructor(value: Vec3, onChange: () => void) {
    this.#value = [value[0], value[1], value[2]];
    this.#onChange = onChange;
  }

  get x(): number {
    return this.#value[0];
  }

  set x(value: number) {
    this.#setIndex(0, value);
  }

  get y(): number {
    return this.#value[1];
  }

  set y(value: number) {
    this.#setIndex(1, value);
  }

  get z(): number {
    return this.#value[2];
  }

  set z(value: number) {
    this.#setIndex(2, value);
  }

  set(value: Vec3): void;
  set(x: number, y: number, z: number): void;
  set(valueOrX: Vec3 | number, y?: number, z?: number): void {
    if (typeof valueOrX === 'number') {
      if (y === undefined || z === undefined) {
        throw new Error('Render object vector set expects x, y, and z');
      }

      this.replace([valueOrX, y, z]);
      return;
    }

    this.replace(valueOrX);
  }

  toArray(): Vec3 {
    return [this.#value[0], this.#value[1], this.#value[2]];
  }

  replace(value: Vec3, notify = true): boolean {
    if (sameVec3(this.#value, value)) return false;

    this.#value = [value[0], value[1], value[2]];
    if (notify) this.#onChange();
    return true;
  }

  #setIndex(index: 0 | 1 | 2, value: number): void {
    if (Object.is(this.#value[index], value)) return;

    this.#value[index] = value;
    this.#onChange();
  }
}

class MutableRenderObjectHandle implements RenderObjectHandle {
  readonly position: MutableRenderObjectVector3;
  readonly rotation: MutableRenderObjectVector3;
  readonly scale: MutableRenderObjectVector3;
  readonly #onChange: () => void;

  constructor(transform: Transform, onChange: () => void) {
    this.#onChange = onChange;
    this.position = new MutableRenderObjectVector3(transform.position, onChange);
    this.rotation = new MutableRenderObjectVector3(transform.rotation, onChange);
    this.scale = new MutableRenderObjectVector3(transform.scale, onChange);
  }

  getTransform(): Transform {
    return {
      position: this.position.toArray(),
      rotation: this.rotation.toArray(),
      scale: this.scale.toArray(),
    };
  }

  setTransform(transform: RenderObjectTransformUpdate): void {
    let changed = false;
    if (transform.position !== undefined) {
      changed = this.position.replace(transform.position, false) || changed;
    }
    if (transform.rotation !== undefined) {
      changed = this.rotation.replace(transform.rotation, false) || changed;
    }
    if (transform.scale !== undefined) {
      changed = this.scale.replace(transform.scale, false) || changed;
    }
    if (changed) this.#onChange();
  }
}

export const createRenderObjectHandle = (
  transform: Transform,
  onChange: () => void,
): RenderObjectHandle => new MutableRenderObjectHandle(transform, onChange);
