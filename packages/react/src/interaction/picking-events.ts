import type { PickResult, PickTarget } from '@royal/renderer-core';

/** Pointer-event names Royal can dispatch to one exact scene picking target. */
export type ScenePointerEventType =
  | 'click'
  | 'pointercancel'
  | 'pointerdown'
  | 'pointerenter'
  | 'pointerleave'
  | 'pointermove'
  | 'pointerup';

/** One non-bubbling scene hit paired with its originating browser pointer event. */
export interface ScenePointerEvent {
  /** Horizontal browser viewport coordinate in CSS pixels. */
  readonly clientX: number;
  /** Vertical browser viewport coordinate in CSS pixels. */
  readonly clientY: number;
  /** Whether the native event has been consumed by this or another handler. */
  readonly defaultPrevented: boolean;
  /** Complete nearest-hit result from the same renderer picking path as `useCanvasPick`. */
  readonly hit: PickResult;
  /** Original browser event; Royal does not clone or retain it. */
  readonly nativeEvent: PointerEvent;
  /** Authored mesh, glTF, instance, or proxy target selected by the hit. */
  readonly target: PickTarget;
  /** Royal scene event name derived from the native pointer lifecycle. */
  readonly type: ScenePointerEventType;
  /** Consumes this pointer event so canvas controls do not also act on it. */
  preventDefault(): void;
  /** Stops native DOM bubbling; Royal scene events do not bubble. */
  stopPropagation(): void;
}

/** Handler for one exact Royal scene target; scene events do not bubble. */
export type ScenePointerEventHandler = (event: ScenePointerEvent) => void;

/** Pointer handlers attached to one scene `pickingId`. */
export interface ScenePointerEventHandlers {
  /** Called after an un-cancelled primary activation resolves to this target. */
  readonly onClick?: ScenePointerEventHandler;
  /** Called on the pressed target when the browser cancels its pointer gesture. */
  readonly onPointerCancel?: ScenePointerEventHandler;
  /** Called on the target where a pointer press begins. */
  readonly onPointerDown?: ScenePointerEventHandler;
  /** Called once when hover enters this target. */
  readonly onPointerEnter?: ScenePointerEventHandler;
  /** Called once when hover leaves this target. */
  readonly onPointerLeave?: ScenePointerEventHandler;
  /** Called while an uncaptured or captured pointer resolves to this target. */
  readonly onPointerMove?: ScenePointerEventHandler;
  /** Called on the pressed target when the pointer is released. */
  readonly onPointerUp?: ScenePointerEventHandler;
}

export interface ScenePointerEventTarget {
  readonly handlers: ScenePointerEventHandlers;
}

type PointerHandlerProp = keyof ScenePointerEventHandlers;

const pointerHandlerProps = [
  'onClick',
  'onPointerCancel',
  'onPointerDown',
  'onPointerEnter',
  'onPointerLeave',
  'onPointerMove',
  'onPointerUp',
] as const satisfies readonly PointerHandlerProp[];

const pointerHandlerPropSet: ReadonlySet<string> = new Set(pointerHandlerProps);

const pointerEventHandlerProp = {
  click: 'onClick',
  pointercancel: 'onPointerCancel',
  pointerdown: 'onPointerDown',
  pointerenter: 'onPointerEnter',
  pointerleave: 'onPointerLeave',
  pointermove: 'onPointerMove',
  pointerup: 'onPointerUp',
} as const satisfies Record<ScenePointerEventType, PointerHandlerProp>;

type ScenePointerEventHandlersValidator = (
  value: unknown,
  label: string,
) => asserts value is ScenePointerEventHandlers;

export const validateScenePointerEventHandlers: ScenePointerEventHandlersValidator = (
  value,
  label,
) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object of scene pointer event handlers`);
  }

  let handlerCount = 0;
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== 'string' || !pointerHandlerPropSet.has(field)) {
      const name = typeof field === 'string' ? JSON.stringify(field) : String(field);
      throw new TypeError(`${label} contains unsupported handler ${name}`);
    }
    const handler = (value as Record<string, unknown>)[field];
    if (handler !== undefined && typeof handler !== 'function') {
      throw new TypeError(`${label}.${field} must be a function when provided`);
    }
    if (typeof handler === 'function') handlerCount += 1;
  }
  if (handlerCount === 0) {
    throw new TypeError(`${label} must provide at least one scene pointer event handler`);
  }
};

export const handlerForScenePointerEvent = (
  target: ScenePointerEventTarget,
  type: ScenePointerEventType,
): ScenePointerEventHandler | undefined =>
  target.handlers[pointerEventHandlerProp[type]];

export const createScenePointerEvent = ({
  hit,
  nativeEvent,
  type,
}: {
  readonly hit: PickResult;
  readonly nativeEvent: PointerEvent;
  readonly type: ScenePointerEventType;
}): ScenePointerEvent => {
  return {
    get clientX() {
      return nativeEvent.clientX;
    },
    get clientY() {
      return nativeEvent.clientY;
    },
    get defaultPrevented() {
      return nativeEvent.defaultPrevented;
    },
    hit,
    nativeEvent,
    get target() {
      return hit.target;
    },
    type,
    preventDefault: () => {
      nativeEvent.preventDefault();
    },
    stopPropagation: () => {
      nativeEvent.stopPropagation();
    },
  };
};
