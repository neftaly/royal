import type { PickResult, PickTarget } from '@royal/renderer-core';

export type RoyalPointerEventType =
  | 'click'
  | 'pointercancel'
  | 'pointerdown'
  | 'pointerenter'
  | 'pointerleave'
  | 'pointermove'
  | 'pointerup';

export interface RoyalPointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly defaultPrevented: boolean;
  readonly hit: PickResult;
  readonly nativeEvent: PointerEvent;
  readonly target: PickTarget;
  readonly type: RoyalPointerEventType;
  /** Consumes this pointer event so canvas controls do not also act on it. */
  preventDefault(): void;
  /** Stops native DOM bubbling; Royal scene events do not bubble. */
  stopPropagation(): void;
}

export type RoyalPointerEventHandler = (event: RoyalPointerEvent) => void;

export interface RoyalPointerEventProps {
  readonly onClick?: RoyalPointerEventHandler;
  /** Called on the pressed target when the browser cancels its pointer gesture. */
  readonly onPointerCancel?: RoyalPointerEventHandler;
  readonly onPointerDown?: RoyalPointerEventHandler;
  readonly onPointerEnter?: RoyalPointerEventHandler;
  readonly onPointerLeave?: RoyalPointerEventHandler;
  readonly onPointerMove?: RoyalPointerEventHandler;
  readonly onPointerUp?: RoyalPointerEventHandler;
}

export type RoyalPointerEventHandlers = {
  -readonly [Prop in keyof RoyalPointerEventProps]?: RoyalPointerEventProps[Prop];
};

export interface RoyalPointerEventTarget {
  readonly handlers: RoyalPointerEventHandlers;
}

type PointerHandlerProp = keyof RoyalPointerEventProps;

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
} as const satisfies Record<RoyalPointerEventType, PointerHandlerProp>;

export const royalPointerEventHandlersFrom = (
  props: Record<string, unknown>,
): RoyalPointerEventHandlers => {
  const handlers: RoyalPointerEventHandlers = {};

  for (const prop of pointerHandlerProps) {
    const handler = props[prop];
    if (typeof handler === 'function') {
      handlers[prop] = handler as RoyalPointerEventHandler;
    }
  }

  return handlers;
};

type RoyalPointerEventHandlersValidator = (
  value: unknown,
  label: string,
) => asserts value is RoyalPointerEventHandlers;

export const validateRoyalPointerEventHandlers: RoyalPointerEventHandlersValidator = (
  value,
  label,
) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object of Royal pointer event handlers`);
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
    throw new TypeError(`${label} must provide at least one Royal pointer event handler`);
  }
};

export const handlerForRoyalPointerEvent = (
  target: RoyalPointerEventTarget,
  type: RoyalPointerEventType,
): RoyalPointerEventHandler | undefined =>
  target.handlers[pointerEventHandlerProp[type]];

export const createRoyalPointerEvent = ({
  hit,
  nativeEvent,
  type,
}: {
  readonly hit: PickResult;
  readonly nativeEvent: PointerEvent;
  readonly type: RoyalPointerEventType;
}): RoyalPointerEvent => {
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
