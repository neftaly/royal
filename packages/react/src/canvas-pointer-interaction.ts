import type { PickResult } from "@royal/renderer-core";
import type {
  RoyalPointerEventTarget,
  RoyalPointerEventType,
} from "./picking-events";

export type CanvasPointerTargetNode = PickResult["target"]["node"];

export interface CanvasPointerInteractionIdentity {
  /** Explicit application identity when provided, otherwise the stable React host target. */
  readonly target: object | string;
  readonly targetKind: PickResult["target"]["kind"];
  readonly instanceIndex?: number;
  readonly instanceId?: string;
  readonly primitiveKey?: string;
}

export interface CanvasPickedPointerTarget {
  readonly hit: PickResult;
  readonly identity: CanvasPointerInteractionIdentity;
  readonly node: CanvasPointerTargetNode;
  readonly target: RoyalPointerEventTarget;
}

export interface CanvasPointerInteractionState {
  readonly hoveredTarget: CanvasPickedPointerTarget | undefined;
  readonly pressedTargetsByPointerId: ReadonlyMap<number, CanvasPointerInteractionIdentity>;
}

export type CanvasPointerInteractionAction =
  | {
    readonly picked: CanvasPickedPointerTarget | undefined;
    readonly type: "pointermove";
  }
  | {
    readonly picked: CanvasPickedPointerTarget | undefined;
    readonly pointerId: number;
    readonly type: "pointerdown";
  }
  | {
    readonly button: number;
    readonly picked: CanvasPickedPointerTarget | undefined;
    readonly pointerId: number;
    readonly type: "pointerup";
  }
  | {
    readonly type: "pointerleave";
  }
  | {
    readonly pointerId: number;
    readonly type: "pointercancel";
  }
  | {
    readonly type: "reset";
  };

export interface CanvasPointerInteractionDispatch {
  readonly picked: CanvasPickedPointerTarget;
  readonly type: RoyalPointerEventType;
}

export interface CanvasPointerInteractionResult {
  readonly dispatches: readonly CanvasPointerInteractionDispatch[];
  readonly state: CanvasPointerInteractionState;
}

export const createCanvasPointerInteractionState = (): CanvasPointerInteractionState => ({
  hoveredTarget: undefined,
  pressedTargetsByPointerId: new Map(),
});

export const createCanvasPointerInteractionIdentity = (
  hit: PickResult,
  fallbackTarget: object,
): CanvasPointerInteractionIdentity => {
  const { target } = hit;

  return {
    target: target.id ?? fallbackTarget,
    targetKind: target.kind,
    ...(target.kind === "gltf-instances"
      ? {
        ...(target.instanceId === undefined ? {} : { instanceId: target.instanceId }),
        ...(target.instanceId === undefined ? { instanceIndex: target.instanceIndex } : {}),
      }
      : {}),
    ...(target.kind === "mesh" || target.primitiveKey === undefined
      ? {}
      : { primitiveKey: target.primitiveKey }),
  };
};

const samePointerInteractionIdentity = (
  left: CanvasPointerInteractionIdentity | undefined,
  right: CanvasPointerInteractionIdentity | undefined,
): boolean =>
  left === right || (
    left !== undefined
    && right !== undefined
    && left.target === right.target
    && left.targetKind === right.targetKind
    && left.instanceIndex === right.instanceIndex
    && left.instanceId === right.instanceId
    && left.primitiveKey === right.primitiveKey
  );

const stateWith = (
  state: CanvasPointerInteractionState,
  patch: Partial<CanvasPointerInteractionState>,
): CanvasPointerInteractionState => ({
  hoveredTarget: state.hoveredTarget,
  pressedTargetsByPointerId: state.pressedTargetsByPointerId,
  ...patch,
});

const setPressedTarget = (
  state: CanvasPointerInteractionState,
  pointerId: number,
  target: CanvasPointerInteractionIdentity,
): CanvasPointerInteractionState => {
  if (samePointerInteractionIdentity(state.pressedTargetsByPointerId.get(pointerId), target)) return state;

  return stateWith(state, {
    pressedTargetsByPointerId: new Map(state.pressedTargetsByPointerId).set(pointerId, target),
  });
};

const deletePressedTarget = (
  state: CanvasPointerInteractionState,
  pointerId: number,
): CanvasPointerInteractionState => {
  if (!state.pressedTargetsByPointerId.has(pointerId)) return state;

  const pressedTargetsByPointerId = new Map(state.pressedTargetsByPointerId);
  pressedTargetsByPointerId.delete(pointerId);
  return stateWith(state, { pressedTargetsByPointerId });
};

const clearState = (
  state: CanvasPointerInteractionState,
): CanvasPointerInteractionState => {
  if (state.hoveredTarget === undefined && state.pressedTargetsByPointerId.size === 0) return state;

  return {
    hoveredTarget: undefined,
    pressedTargetsByPointerId: new Map(),
  };
};

const clearHoveredTarget = (
  state: CanvasPointerInteractionState,
): CanvasPointerInteractionState =>
  state.hoveredTarget === undefined
    ? state
    : stateWith(state, { hoveredTarget: undefined });

export const reduceCanvasPointerInteraction = (
  state: CanvasPointerInteractionState,
  action: CanvasPointerInteractionAction,
): CanvasPointerInteractionResult => {
  switch (action.type) {
    case "pointermove": {
      const next = action.picked;
      const previous = state.hoveredTarget;
      const dispatches: CanvasPointerInteractionDispatch[] = [];
      let nextState = state;

      if (!samePointerInteractionIdentity(previous?.identity, next?.identity)) {
        if (previous !== undefined) {
          dispatches.push({ picked: previous, type: "pointerleave" });
        }
        if (next !== undefined) {
          dispatches.push({ picked: next, type: "pointerenter" });
        }
        nextState = stateWith(state, { hoveredTarget: next });
      } else if (next !== undefined && previous !== next) {
        nextState = stateWith(state, { hoveredTarget: next });
      }

      if (next !== undefined) {
        dispatches.push({ picked: next, type: "pointermove" });
      }

      return {
        dispatches,
        state: nextState,
      };
    }
    case "pointerdown": {
      const nextState = action.picked === undefined
        ? deletePressedTarget(state, action.pointerId)
        : setPressedTarget(state, action.pointerId, action.picked.identity);

      return {
        dispatches: action.picked === undefined
          ? []
          : [{ picked: action.picked, type: "pointerdown" }],
        state: nextState,
      };
    }
    case "pointerup": {
      const pressedTarget = state.pressedTargetsByPointerId.get(action.pointerId);
      const nextState = deletePressedTarget(state, action.pointerId);
      const dispatches: CanvasPointerInteractionDispatch[] = [];

      if (action.picked !== undefined) {
        dispatches.push({ picked: action.picked, type: "pointerup" });
        if (samePointerInteractionIdentity(pressedTarget, action.picked.identity) && action.button === 0) {
          dispatches.push({ picked: action.picked, type: "click" });
        }
      }

      return {
        dispatches,
        state: nextState,
      };
    }
    case "pointerleave": {
      const previous = state.hoveredTarget;

      return {
        dispatches: previous === undefined
          ? []
          : [{ picked: previous, type: "pointerleave" }],
        state: clearHoveredTarget(state),
      };
    }
    case "pointercancel": {
      const previous = state.hoveredTarget;
      return {
        dispatches: previous === undefined
          ? []
          : [{ picked: previous, type: "pointerleave" }],
        state: clearHoveredTarget(deletePressedTarget(state, action.pointerId)),
      };
    }
    case "reset":
      return {
        dispatches: [],
        state: clearState(state),
      };
  }
};
