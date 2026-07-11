import type { PickResult, PickTarget } from '@royal/renderer-core';

export type RoyalPointerEventType =
  | 'click'
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
  'onPointerDown',
  'onPointerEnter',
  'onPointerLeave',
  'onPointerMove',
  'onPointerUp',
] as const satisfies readonly PointerHandlerProp[];

const pointerEventHandlerProp = {
  click: 'onClick',
  pointerdown: 'onPointerDown',
  pointerenter: 'onPointerEnter',
  pointerleave: 'onPointerLeave',
  pointermove: 'onPointerMove',
  pointerup: 'onPointerUp',
} as const satisfies Record<RoyalPointerEventType, PointerHandlerProp>;

export const hasRoyalPointerEventHandlers = (
  props: Record<string, unknown>,
): boolean =>
  pointerHandlerProps.some((prop) => typeof props[prop] === 'function');

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
