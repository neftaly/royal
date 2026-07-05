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

export interface RenderObjectTransformState {
  readonly position: Vec3;
  readonly rotation: EulerRads;
  readonly scale: Vec3;
}

type MutableVec3 = [x: number, y: number, z: number];

interface MutableRenderObjectTransformState {
  readonly position: MutableVec3;
  readonly rotation: MutableVec3;
  readonly scale: MutableVec3;
}

export type RenderObjectTransformField = keyof RenderObjectTransformState;
export type RenderObjectTransformComponent = 'x' | 'y' | 'z';

export type RenderObjectTransformAction =
  | {
    readonly type: 'set-transform';
    readonly transform: RenderObjectTransformUpdate;
  }
  | {
    readonly type: 'set-vector';
    readonly field: RenderObjectTransformField;
    readonly value: Vec3;
  }
  | {
    readonly type: 'set-component';
    readonly field: RenderObjectTransformField;
    readonly component: RenderObjectTransformComponent;
    readonly value: number;
  };

export interface RenderObjectHandle {
  readonly renderObjectId: number;
  readonly position: RenderObjectVector3;
  readonly rotation: RenderObjectVector3;
  readonly scale: RenderObjectVector3;
  readonly transformVersion: number;
  readonly positionVersion: number;
  readonly rotationVersion: number;
  readonly scaleVersion: number;
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

const copyVec3 = (value: Vec3): MutableVec3 => [value[0], value[1], value[2]];
const copyEulerRads = (value: EulerRads): MutableVec3 => [value[0], value[1], value[2]];
const transformStateSymbol: unique symbol = Symbol('royal.renderObjectTransformState');

const componentIndex = {
  x: 0,
  y: 1,
  z: 2
} satisfies Record<RenderObjectTransformComponent, 0 | 1 | 2>;

let nextRenderObjectId = 1;

const createMutableRenderObjectTransformState = (transform: Transform): MutableRenderObjectTransformState => ({
  position: copyVec3(transform.position),
  rotation: copyEulerRads(transform.rotation),
  scale: copyVec3(transform.scale)
});

export const createRenderObjectTransformState = (transform: Transform): RenderObjectTransformState =>
  createMutableRenderObjectTransformState(transform);

export const renderObjectTransformStateToTransform = (
  state: RenderObjectTransformState
): Transform => createRenderObjectTransformState(state);

const replaceRenderObjectTransformField = (
  state: RenderObjectTransformState,
  field: RenderObjectTransformField,
  value: Vec3
): RenderObjectTransformState => {
  if (sameVec3(state[field], value)) return state;

  const nextValue = copyVec3(value);
  switch (field) {
    case 'position':
      return { ...state, position: nextValue };
    case 'rotation':
      return { ...state, rotation: nextValue };
    case 'scale':
      return { ...state, scale: nextValue };
  }
};

const replaceRenderObjectTransformComponent = (
  state: RenderObjectTransformState,
  field: RenderObjectTransformField,
  component: RenderObjectTransformComponent,
  value: number
): RenderObjectTransformState => {
  const current = state[field];
  const index = componentIndex[component];
  if (Object.is(current[index], value)) return state;

  const nextValue: [number, number, number] = [current[0], current[1], current[2]];
  nextValue[index] = value;
  return replaceRenderObjectTransformField(state, field, nextValue);
};

export const reduceRenderObjectTransform = (
  state: RenderObjectTransformState,
  action: RenderObjectTransformAction
): RenderObjectTransformState => {
  switch (action.type) {
    case 'set-transform': {
      const position = action.transform.position === undefined || sameVec3(state.position, action.transform.position)
        ? state.position
        : copyVec3(action.transform.position);
      const rotation = action.transform.rotation === undefined || sameVec3(state.rotation, action.transform.rotation)
        ? state.rotation
        : copyEulerRads(action.transform.rotation);
      const scale = action.transform.scale === undefined || sameVec3(state.scale, action.transform.scale)
        ? state.scale
        : copyVec3(action.transform.scale);

      return position === state.position && rotation === state.rotation && scale === state.scale
        ? state
        : { position, rotation, scale };
    }
    case 'set-vector':
      return replaceRenderObjectTransformField(state, action.field, action.value);
    case 'set-component':
      return replaceRenderObjectTransformComponent(state, action.field, action.component, action.value);
  }
};

class MutableRenderObjectVector3 implements RenderObjectVector3 {
  readonly #field: RenderObjectTransformField;
  readonly #getState: () => RenderObjectTransformState;
  readonly #dispatch: (action: RenderObjectTransformAction) => void;

  constructor(
    field: RenderObjectTransformField,
    getState: () => RenderObjectTransformState,
    dispatch: (action: RenderObjectTransformAction) => void
  ) {
    this.#field = field;
    this.#getState = getState;
    this.#dispatch = dispatch;
  }

  get x(): number {
    return this.#value[0];
  }

  set x(value: number) {
    this.#setComponent('x', value);
  }

  get y(): number {
    return this.#value[1];
  }

  set y(value: number) {
    this.#setComponent('y', value);
  }

  get z(): number {
    return this.#value[2];
  }

  set z(value: number) {
    this.#setComponent('z', value);
  }

  set(value: Vec3): void;
  set(x: number, y: number, z: number): void;
  set(valueOrX: Vec3 | number, y?: number, z?: number): void {
    if (typeof valueOrX === 'number') {
      if (y === undefined || z === undefined) {
        throw new Error('Render object vector set expects x, y, and z');
      }

      this.#setVector([valueOrX, y, z]);
      return;
    }

    this.#setVector(valueOrX);
  }

  toArray(): Vec3 {
    return copyVec3(this.#value);
  }

  get #value(): Vec3 {
    return this.#getState()[this.#field];
  }

  #setVector(value: Vec3): void {
    this.#dispatch({ type: 'set-vector', field: this.#field, value });
  }

  #setComponent(component: RenderObjectTransformComponent, value: number): void {
    this.#dispatch({
      type: 'set-component',
      component,
      field: this.#field,
      value
    });
  }
}

class MutableRenderObjectHandle implements RenderObjectHandle {
  readonly renderObjectId: number;
  readonly position: MutableRenderObjectVector3;
  readonly rotation: MutableRenderObjectVector3;
  readonly scale: MutableRenderObjectVector3;
  readonly #onChange: () => void;
  #state: MutableRenderObjectTransformState;
  #transformVersion = 0;
  #positionVersion = 0;
  #rotationVersion = 0;
  #scaleVersion = 0;

  constructor(transform: Transform, onChange: () => void) {
    this.renderObjectId = nextRenderObjectId++;
    this.#onChange = onChange;
    this.#state = createMutableRenderObjectTransformState(transform);
    this.position = new MutableRenderObjectVector3(
      'position',
      () => this.#state,
      (action) => this.#dispatch(action)
    );
    this.rotation = new MutableRenderObjectVector3(
      'rotation',
      () => this.#state,
      (action) => this.#dispatch(action)
    );
    this.scale = new MutableRenderObjectVector3(
      'scale',
      () => this.#state,
      (action) => this.#dispatch(action)
    );
  }

  get transformVersion(): number {
    return this.#transformVersion;
  }

  get positionVersion(): number {
    return this.#positionVersion;
  }

  get rotationVersion(): number {
    return this.#rotationVersion;
  }

  get scaleVersion(): number {
    return this.#scaleVersion;
  }

  getTransform(): Transform {
    return renderObjectTransformStateToTransform(this.#state);
  }

  setTransform(transform: RenderObjectTransformUpdate): void {
    this.#applyTransformUpdate(transform);
  }

  [transformStateSymbol](): RenderObjectTransformState {
    return this.#state;
  }

  #dispatch(action: RenderObjectTransformAction): void {
    switch (action.type) {
      case 'set-transform':
        this.#applyTransformUpdate(action.transform);
        return;
      case 'set-vector':
        this.#commitSingleField(action.field, this.#applyVector(action.field, action.value));
        return;
      case 'set-component':
        this.#commitSingleField(
          action.field,
          this.#applyComponent(action.field, action.component, action.value)
        );
        return;
    }
  }

  #applyTransformUpdate(transform: RenderObjectTransformUpdate): void {
    const positionChanged = transform.position === undefined ? false : this.#applyVector('position', transform.position);
    const rotationChanged = transform.rotation === undefined ? false : this.#applyVector('rotation', transform.rotation);
    const scaleChanged = transform.scale === undefined ? false : this.#applyVector('scale', transform.scale);
    this.#commitChanges(positionChanged, rotationChanged, scaleChanged);
  }

  #applyVector(field: RenderObjectTransformField, value: Vec3): boolean {
    const current = this.#state[field];
    if (sameVec3(current, value)) return false;

    current[0] = value[0];
    current[1] = value[1];
    current[2] = value[2];
    return true;
  }

  #applyComponent(
    field: RenderObjectTransformField,
    component: RenderObjectTransformComponent,
    value: number
  ): boolean {
    const current = this.#state[field];
    const index = componentIndex[component];
    if (Object.is(current[index], value)) return false;

    current[index] = value;
    return true;
  }

  #commitSingleField(field: RenderObjectTransformField, changed: boolean): void {
    this.#commitChanges(field === 'position' && changed, field === 'rotation' && changed, field === 'scale' && changed);
  }

  #commitChanges(positionChanged: boolean, rotationChanged: boolean, scaleChanged: boolean): void {
    if (!positionChanged && !rotationChanged && !scaleChanged) return;

    this.#transformVersion += 1;
    if (positionChanged) this.#positionVersion += 1;
    if (rotationChanged) this.#rotationVersion += 1;
    if (scaleChanged) this.#scaleVersion += 1;
    this.#onChange();
  }
}

export const createRenderObjectHandle = (
  transform: Transform,
  onChange: () => void,
): RenderObjectHandle => new MutableRenderObjectHandle(transform, onChange);

export const readRenderObjectHandleTransform = (handle: RenderObjectHandle): Transform => {
  const internal = handle as RenderObjectHandle & {
    readonly [transformStateSymbol]?: () => RenderObjectTransformState;
  };
  return internal[transformStateSymbol]?.() ?? handle.getTransform();
};
