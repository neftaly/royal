import type { EulerRads, Scale3, Transform, Vec3, WorldPosition3 } from './primitives';
import { finiteNumber, resolveVec3, objectWithAllowedFields } from './descriptor-values';

export interface RenderObjectVector3 {
  x: number;
  y: number;
  z: number;
  set(value: Vec3): void;
  set(x: number, y: number, z: number): void;
  toArray(): Vec3;
}

export type RenderObjectTransformUpdate = Partial<{
  /** World-space translation in metres. */
  readonly position: WorldPosition3;
  readonly rotation: EulerRads;
  /** Dimensionless multiplier. */
  readonly scale: Scale3;
}>;

export interface RenderObjectTransformState {
  /** World-space translation in metres. */
  readonly position: WorldPosition3;
  readonly rotation: EulerRads;
  /** Dimensionless multiplier. */
  readonly scale: Scale3;
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
  /** Mutable world-space translation in metres. */
  readonly position: RenderObjectVector3;
  /** Mutable XYZ Euler angles in radians. */
  readonly rotation: RenderObjectVector3;
  /** Mutable dimensionless XYZ multiplier. */
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

/** A root-scoped attachment to a render-object ref shared by every attached root. */
export interface RenderObjectRefAttachment {
  readonly handle: RenderObjectHandle;
  /** Detach only this root. The public ref is cleared after the final attachment leaves. */
  detach(): void;
  /** Apply a declarative update without redundantly notifying the root applying it. */
  syncTransform(transform: Transform): void;
}

const sameVec3 = (left: Vec3, right: Vec3): boolean =>
  Object.is(left[0], right[0]) &&
  Object.is(left[1], right[1]) &&
  Object.is(left[2], right[2]);

const copyVec3 = (value: Vec3): MutableVec3 => [value[0], value[1], value[2]];
const copyEulerRads = (value: EulerRads): MutableVec3 => [value[0], value[1], value[2]];
const transformStateSymbol: unique symbol = Symbol('royal.renderObjectTransformState');
const RENDER_OBJECT_TRANSFORM_FIELDS = ['position', 'rotation', 'scale'] as const;

const componentIndex = {
  x: 0,
  y: 1,
  z: 2
} satisfies Record<RenderObjectTransformComponent, 0 | 1 | 2>;

let nextRenderObjectId = 1;

const createMutableRenderObjectTransformState = (
  transform: Transform,
): MutableRenderObjectTransformState => ({
  position: copyVec3(transform.position),
  rotation: copyEulerRads(transform.rotation),
  scale: copyVec3(transform.scale)
});

export const createRenderObjectTransformState = (transform: Transform): RenderObjectTransformState =>
  createMutableRenderObjectTransformState(transform);

const copyVec3Into = (target: MutableVec3, source: Vec3): void => {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
};

const validatedRenderObjectTransformUpdate = (
  transform: RenderObjectTransformUpdate,
): RenderObjectTransformUpdate => {
  objectWithAllowedFields(transform, RENDER_OBJECT_TRANSFORM_FIELDS, 'render object transform');
  return {
    ...(transform.position === undefined
      ? {}
      : { position: resolveVec3(transform.position, 'render object position') as WorldPosition3 }),
    ...(transform.rotation === undefined
      ? {}
      : { rotation: resolveVec3(transform.rotation, 'render object rotation') as EulerRads }),
    ...(transform.scale === undefined
      ? {}
      : { scale: resolveVec3(transform.scale, 'render object scale') as Scale3 }),
  };
};

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
    this.#dispatch({
      type: 'set-vector',
      field: this.#field,
      value: resolveVec3(value, `render object ${this.#field}`),
    });
  }

  #setComponent(component: RenderObjectTransformComponent, value: number): void {
    this.#dispatch({
      type: 'set-component',
      component,
      field: this.#field,
      value: finiteNumber(value, `render object ${this.#field}.${component}`)
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
    this.#dispatch({
      type: 'set-transform',
      transform: validatedRenderObjectTransformUpdate(transform),
    });
  }

  [transformStateSymbol](): RenderObjectTransformState {
    return this.#state;
  }

  #dispatch(action: RenderObjectTransformAction): void {
    const previous = this.#state;
    const next = reduceRenderObjectTransform(previous, action);
    if (next === previous) return;

    this.#transformVersion += 1;
    if (next.position !== previous.position) {
      copyVec3Into(previous.position, next.position);
      this.#positionVersion += 1;
    }
    if (next.rotation !== previous.rotation) {
      copyVec3Into(previous.rotation, next.rotation);
      this.#rotationVersion += 1;
    }
    if (next.scale !== previous.scale) {
      copyVec3Into(previous.scale, next.scale);
      this.#scaleVersion += 1;
    }
    this.#onChange();
  }
}

export const createRenderObjectHandle = (
  transform: Transform,
  onChange: () => void,
): RenderObjectHandle => new MutableRenderObjectHandle(transform, onChange);

type RenderObjectRefListener = () => void;

interface SharedRenderObjectRef {
  attachmentCount: number;
  readonly handle: RenderObjectHandle;
  readonly listeners: Map<object, RenderObjectRefListener>;
  mutationSource: object | undefined;
}

const sharedRenderObjectRefs = new WeakMap<RenderObjectRef, SharedRenderObjectRef>();

const assignRenderObjectRef = (ref: RenderObjectRef, handle: RenderObjectHandle | null): void => {
  if (typeof ref === 'function') ref(handle);
  else ref.current = handle;
};

const notifyRenderObjectRefListeners = (shared: SharedRenderObjectRef): void => {
  const cohort = [...shared.listeners.entries()];
  let failed = false;
  let firstFailure: unknown;
  for (const [token, listener] of cohort) {
    if (token === shared.mutationSource) continue;
    try {
      listener();
    } catch (value) {
      if (!failed) {
        failed = true;
        firstFailure = value;
      }
    }
  }
  if (failed) throw firstFailure;
};

/**
 * Attach one renderer root to a ref. Attachments to the same ref share one
 * imperative handle, while retaining independent invalidation ownership.
 */
export const attachRenderObjectRef = (
  ref: RenderObjectRef,
  transform: Transform,
  onChange: RenderObjectRefListener,
): RenderObjectRefAttachment => {
  let shared = sharedRenderObjectRefs.get(ref);
  if (shared === undefined) {
    const listeners = new Map<object, RenderObjectRefListener>();
    let createdShared: SharedRenderObjectRef;
    const handle = createRenderObjectHandle(transform, () => notifyRenderObjectRefListeners(createdShared));
    createdShared = { attachmentCount: 0, handle, listeners, mutationSource: undefined };
    shared = createdShared;
    sharedRenderObjectRefs.set(ref, shared);
    try {
      assignRenderObjectRef(ref, handle);
    } catch (value) {
      // Publishing the first handle is reentrant. Roll back only the
      // provisional generation created by this call: a nested attachment may
      // now own it, or the callback may have installed a newer generation.
      if (sharedRenderObjectRefs.get(ref) === shared && shared.attachmentCount === 0) {
        sharedRenderObjectRefs.delete(ref);
      }
      throw value;
    }
  }

  const attached = shared;
  const token = {};
  attached.listeners.set(token, onChange);
  attached.attachmentCount += 1;
  let active = true;
  let listenerAttached = true;
  return {
    detach: () => {
      if (!active) return;
      if (listenerAttached) {
        attached.listeners.delete(token);
        listenerAttached = false;
      }
      if (attached.attachmentCount > 1 || sharedRenderObjectRefs.get(ref) !== attached) {
        attached.attachmentCount -= 1;
        active = false;
        return;
      }
      sharedRenderObjectRefs.delete(ref);
      try {
        assignRenderObjectRef(ref, null);
        attached.attachmentCount = 0;
        active = false;
      } catch (value) {
        // Restore only if the callback did not reentrantly attach a new
        // generation. That keeps an ordinary failure retryable while never
        // replacing ownership established during the callback itself.
        if (sharedRenderObjectRefs.get(ref) === undefined) {
          sharedRenderObjectRefs.set(ref, attached);
        } else {
          attached.attachmentCount = 0;
          active = false;
        }
        throw value;
      }
    },
    handle: attached.handle,
    syncTransform: (nextTransform) => {
      if (!active) return;
      const previousSource = attached.mutationSource;
      attached.mutationSource = token;
      try {
        attached.handle.setTransform(nextTransform);
      } finally {
        attached.mutationSource = previousSource;
      }
    },
  };
};

export const readRenderObjectHandleTransform = (handle: RenderObjectHandle): Transform => {
  const internal = handle as RenderObjectHandle & {
    readonly [transformStateSymbol]?: () => RenderObjectTransformState;
  };
  return internal[transformStateSymbol]?.() ?? handle.getTransform();
};
