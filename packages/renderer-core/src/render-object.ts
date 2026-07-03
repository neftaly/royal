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

const copyVec3 = (value: Vec3): Vec3 => [value[0], value[1], value[2]];
const copyEulerRads = (value: EulerRads): EulerRads => [value[0], value[1], value[2]];

const componentIndex = {
  x: 0,
  y: 1,
  z: 2
} satisfies Record<RenderObjectTransformComponent, 0 | 1 | 2>;

export const createRenderObjectTransformState = (transform: Transform): RenderObjectTransformState => ({
  position: copyVec3(transform.position),
  rotation: copyEulerRads(transform.rotation),
  scale: copyVec3(transform.scale)
});

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
      let nextState = state;
      if (action.transform.position !== undefined) {
        nextState = replaceRenderObjectTransformField(nextState, 'position', action.transform.position);
      }
      if (action.transform.rotation !== undefined) {
        nextState = replaceRenderObjectTransformField(nextState, 'rotation', action.transform.rotation);
      }
      if (action.transform.scale !== undefined) {
        nextState = replaceRenderObjectTransformField(nextState, 'scale', action.transform.scale);
      }
      return nextState;
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
  readonly position: MutableRenderObjectVector3;
  readonly rotation: MutableRenderObjectVector3;
  readonly scale: MutableRenderObjectVector3;
  readonly #onChange: () => void;
  #state: RenderObjectTransformState;

  constructor(transform: Transform, onChange: () => void) {
    this.#onChange = onChange;
    this.#state = createRenderObjectTransformState(transform);
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

  getTransform(): Transform {
    return renderObjectTransformStateToTransform(this.#state);
  }

  setTransform(transform: RenderObjectTransformUpdate): void {
    this.#dispatch({ type: 'set-transform', transform });
  }

  #dispatch(action: RenderObjectTransformAction): void {
    const nextState = reduceRenderObjectTransform(this.#state, action);
    if (nextState === this.#state) return;

    this.#state = nextState;
    this.#onChange();
  }
}

export const createRenderObjectHandle = (
  transform: Transform,
  onChange: () => void,
): RenderObjectHandle => new MutableRenderObjectHandle(transform, onChange);
