import type { PickResult, PickTarget } from '@royal/renderer-core';

export type ScenePointerEventType =
  | 'click'
  | 'pointercancel'
  | 'pointerdown'
  | 'pointerenter'
  | 'pointerleave'
  | 'pointermove'
  | 'pointerup';

export interface ScenePointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly defaultPrevented: boolean;
  readonly hit: PickResult;
  readonly nativeEvent: PointerEvent;
  readonly target: PickTarget;
  readonly type: ScenePointerEventType;
  /** Consumes this pointer event so canvas controls do not also act on it. */
  preventDefault(): void;
  /** Stops native DOM bubbling; Royal scene events do not bubble. */
  stopPropagation(): void;
}

export type ScenePointerEventHandler = (event: ScenePointerEvent) => void;

/** Pointer handlers attached to one scene `pickingId`. */
export interface ScenePointerEventHandlers {
  readonly onClick?: ScenePointerEventHandler;
  /** Called on the pressed target when the browser cancels its pointer gesture. */
  readonly onPointerCancel?: ScenePointerEventHandler;
  readonly onPointerDown?: ScenePointerEventHandler;
  readonly onPointerEnter?: ScenePointerEventHandler;
  readonly onPointerLeave?: ScenePointerEventHandler;
  readonly onPointerMove?: ScenePointerEventHandler;
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
  for (const [prop, handler] of Object.entries(value)) {
    if (!pointerHandlerPropSet.has(prop)) {
      throw new TypeError(`${label} contains unsupported handler ${JSON.stringify(prop)}`);
    }
    if (handler !== undefined && typeof handler !== 'function') {
      throw new TypeError(`${label}.${prop} must be a function when provided`);
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
