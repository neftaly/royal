import {
  createCanvasPointerInteractionIdentity,
  reduceCanvasPointerInteraction,
  type CanvasPickedPointerTarget,
  type CanvasPointerInteractionAction,
  type CanvasPointerInteractionState,
} from "./canvas-pointer-interaction";
import {
  createRoyalPointerEvent,
  handlerForRoyalPointerEvent,
} from "./picking-events";
import type { RoyalRendererRoot } from "./root";
import type { RoyalScenePointerEventRegistry } from "./scene-interactions";

export type CanvasPointerInteractionStateRef = {
  current: CanvasPointerInteractionState;
};

export type CanvasSceneInteractionsRef = {
  current: RoyalScenePointerEventRegistry;
};

export type CanvasLastPointerEventRef = {
  current: PointerEvent | undefined;
};

export interface CanvasPointerEventBindings {
  readonly canvas: HTMLCanvasElement;
  readonly lastPointerEventRef: CanvasLastPointerEventRef;
  readonly pointerInteractionStateRef: CanvasPointerInteractionStateRef;
  readonly sceneInteractionsRef: CanvasSceneInteractionsRef;
  readonly root: Pick<RoyalRendererRoot, "pick">;
}

export const reconcileCanvasPointerInteractionScene = ({
  lastPointerEventRef,
  pointerInteractionStateRef,
  sceneInteractions,
  sceneInteractionsRef,
}: {
  readonly lastPointerEventRef: CanvasLastPointerEventRef;
  readonly pointerInteractionStateRef: CanvasPointerInteractionStateRef;
  readonly sceneInteractions: RoyalScenePointerEventRegistry;
  readonly sceneInteractionsRef: CanvasSceneInteractionsRef;
}): void => {
  sceneInteractionsRef.current = sceneInteractions;
  const hovered = pointerInteractionStateRef.current.hoveredTarget;
  const pickingId = hovered?.identity.target;
  if (hovered === undefined || typeof pickingId !== "string") return;

  const nextTarget = sceneInteractions.pointerEventTarget(pickingId);
  if (nextTarget !== undefined) {
    if (nextTarget !== hovered.target) {
      pointerInteractionStateRef.current = {
        ...pointerInteractionStateRef.current,
        hoveredTarget: { ...hovered, target: nextTarget },
      };
    }
    return;
  }

  const result = reduceCanvasPointerInteraction(pointerInteractionStateRef.current, {
    type: "pointerleave",
  });
  pointerInteractionStateRef.current = result.state;
  const nativeEvent = lastPointerEventRef.current;
  if (nativeEvent === undefined) return;
  for (const dispatch of result.dispatches) {
    handlerForRoyalPointerEvent(dispatch.picked.target, dispatch.type)?.(
      createRoyalPointerEvent({
        hit: dispatch.picked.hit,
        nativeEvent,
        type: dispatch.type,
      }),
    );
  }
};

export const attachCanvasPointerEventHandlers = ({
  canvas,
  lastPointerEventRef,
  pointerInteractionStateRef,
  sceneInteractionsRef,
  root,
}: CanvasPointerEventBindings): (() => void) => {
  let pointerMoveFrame: number | undefined;
  const pendingPointerMoves = new Map<number, PointerEvent>();
  const pendingPointerMoveScratch: PointerEvent[] = [];
  const pickedTargetAt = (event: PointerEvent): CanvasPickedPointerTarget | undefined => {
    const sceneInteractions = sceneInteractionsRef.current;
    if (!sceneInteractions.hasPointerEventTargets) return undefined;

    const hit = root.pick(event);
    if (hit === undefined) return undefined;

    const target = sceneInteractions.pointerEventTarget(hit.target.id);
    return target === undefined
      ? undefined
      : {
        hit,
        identity: createCanvasPointerInteractionIdentity(hit, target),
        node: hit.target.node,
        target,
      };
  };
  const applyPointerInteraction = (
    event: PointerEvent,
    action: CanvasPointerInteractionAction,
  ): void => {
    lastPointerEventRef.current = event;
    const result = reduceCanvasPointerInteraction(pointerInteractionStateRef.current, action);
    pointerInteractionStateRef.current = result.state;
    for (const dispatch of result.dispatches) {
      const handler = handlerForRoyalPointerEvent(dispatch.picked.target, dispatch.type);
      handler?.(createRoyalPointerEvent({
        hit: dispatch.picked.hit,
        nativeEvent: event,
        type: dispatch.type,
      }));
    }
  };

  const flushPendingPointerMoves = (): void => {
    if (pointerMoveFrame !== undefined && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(pointerMoveFrame);
    }
    pointerMoveFrame = undefined;
    for (const event of pendingPointerMoves.values()) pendingPointerMoveScratch.push(event);
    pendingPointerMoves.clear();
    try {
      for (const event of pendingPointerMoveScratch) {
        applyPointerInteraction(event, {
          picked: pickedTargetAt(event),
          type: "pointermove",
        });
      }
    } finally {
      pendingPointerMoveScratch.length = 0;
    }
  };

  const handlePointerMove = (event: PointerEvent): void => {
    // Active drags stay synchronous so object handlers can still consume the
    // native move before bubble-phase camera/gesture controls. Hover-only moves
    // are safe to collapse to the newest position for each pointer per frame.
    if (event.buttons !== 0) {
      flushPendingPointerMoves();
      applyPointerInteraction(event, {
        picked: pickedTargetAt(event),
        type: "pointermove",
      });
      return;
    }
    if (typeof globalThis.requestAnimationFrame !== "function") {
      applyPointerInteraction(event, {
        picked: pickedTargetAt(event),
        type: "pointermove",
      });
      return;
    }
    pendingPointerMoves.delete(event.pointerId);
    pendingPointerMoves.set(event.pointerId, event);
    pointerMoveFrame ??= globalThis.requestAnimationFrame(flushPendingPointerMoves);
  };

  const handlePointerDown = (event: PointerEvent): void => {
    flushPendingPointerMoves();
    applyPointerInteraction(event, {
      picked: pickedTargetAt(event),
      pointerId: event.pointerId,
      type: "pointerdown",
    });
  };

  const handlePointerUp = (event: PointerEvent): void => {
    flushPendingPointerMoves();
    applyPointerInteraction(event, {
      button: event.button,
      picked: pickedTargetAt(event),
      pointerId: event.pointerId,
      type: "pointerup",
    });
  };

  const handlePointerLeave = (event: PointerEvent): void => {
    flushPendingPointerMoves();
    applyPointerInteraction(event, { type: "pointerleave" });
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    flushPendingPointerMoves();
    applyPointerInteraction(event, {
      pointerId: event.pointerId,
      type: "pointercancel",
    });
  };

  // Picking owns the capture phase so a scene handler can consume an event
  // before bubble-phase controls, independent of listener registration order.
  canvas.addEventListener("pointermove", handlePointerMove, true);
  canvas.addEventListener("pointerdown", handlePointerDown, true);
  canvas.addEventListener("pointerup", handlePointerUp, true);
  canvas.addEventListener("pointerleave", handlePointerLeave, true);
  canvas.addEventListener("pointercancel", handlePointerCancel, true);
  return () => {
    if (pointerMoveFrame !== undefined && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(pointerMoveFrame);
    }
    pointerMoveFrame = undefined;
    pendingPointerMoves.clear();
    pendingPointerMoveScratch.length = 0;
    canvas.removeEventListener("pointermove", handlePointerMove, true);
    canvas.removeEventListener("pointerdown", handlePointerDown, true);
    canvas.removeEventListener("pointerup", handlePointerUp, true);
    canvas.removeEventListener("pointerleave", handlePointerLeave, true);
    canvas.removeEventListener("pointercancel", handlePointerCancel, true);
    pointerInteractionStateRef.current = reduceCanvasPointerInteraction(
      pointerInteractionStateRef.current,
      { type: "reset" },
    ).state;
    lastPointerEventRef.current = undefined;
  };
};
