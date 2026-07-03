import type { PickResult } from "@royal/renderer-core";
import type {
  RoyalPointerEventTarget,
  RoyalPointerEventType,
} from "./picking-events";

export type CanvasPointerTargetNode = PickResult["target"]["node"];

export interface CanvasPickedPointerTarget {
  readonly hit: PickResult;
  readonly node: CanvasPointerTargetNode;
  readonly target: RoyalPointerEventTarget;
}

export interface CanvasPointerInteractionState {
  readonly hoveredTarget: CanvasPickedPointerTarget | undefined;
  readonly pressedNodesByPointerId: ReadonlyMap<number, CanvasPointerTargetNode>;
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
  pressedNodesByPointerId: new Map(),
});

const stateWith = (
  state: CanvasPointerInteractionState,
  patch: Partial<CanvasPointerInteractionState>,
): CanvasPointerInteractionState => ({
  hoveredTarget: state.hoveredTarget,
  pressedNodesByPointerId: state.pressedNodesByPointerId,
  ...patch,
});

const setPressedNode = (
  state: CanvasPointerInteractionState,
  pointerId: number,
  node: CanvasPointerTargetNode,
): CanvasPointerInteractionState => {
  if (state.pressedNodesByPointerId.get(pointerId) === node) return state;

  return stateWith(state, {
    pressedNodesByPointerId: new Map(state.pressedNodesByPointerId).set(pointerId, node),
  });
};

const deletePressedNode = (
  state: CanvasPointerInteractionState,
  pointerId: number,
): CanvasPointerInteractionState => {
  if (!state.pressedNodesByPointerId.has(pointerId)) return state;

  const pressedNodesByPointerId = new Map(state.pressedNodesByPointerId);
  pressedNodesByPointerId.delete(pointerId);
  return stateWith(state, { pressedNodesByPointerId });
};

const clearState = (
  state: CanvasPointerInteractionState,
): CanvasPointerInteractionState => {
  if (state.hoveredTarget === undefined && state.pressedNodesByPointerId.size === 0) return state;

  return {
    hoveredTarget: undefined,
    pressedNodesByPointerId: new Map(),
  };
};

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

      if (previous?.node !== next?.node) {
        if (previous !== undefined) {
          dispatches.push({ picked: previous, type: "pointerleave" });
        }
        if (next !== undefined) {
          dispatches.push({ picked: next, type: "pointerenter" });
        }
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
        ? deletePressedNode(state, action.pointerId)
        : setPressedNode(state, action.pointerId, action.picked.node);

      return {
        dispatches: action.picked === undefined
          ? []
          : [{ picked: action.picked, type: "pointerdown" }],
        state: nextState,
      };
    }
    case "pointerup": {
      const pressedNode = state.pressedNodesByPointerId.get(action.pointerId);
      const nextState = deletePressedNode(state, action.pointerId);
      const dispatches: CanvasPointerInteractionDispatch[] = [];

      if (action.picked !== undefined) {
        dispatches.push({ picked: action.picked, type: "pointerup" });
        if (pressedNode === action.picked.node && action.button === 0) {
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
        state: clearState(state),
      };
    }
    case "pointercancel":
      return {
        dispatches: [],
        state: deletePressedNode(state, action.pointerId),
      };
    case "reset":
      return {
        dispatches: [],
        state: clearState(state),
      };
  }
};
