import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  mesh,
  unlitMaterial,
  type MeshNode,
  type PickResult,
} from "@royal/renderer-core";
import {
  createCanvasPointerInteractionState,
  reduceCanvasPointerInteraction,
  type CanvasPickedPointerTarget,
  type CanvasPointerInteractionResult,
  type CanvasPointerInteractionState,
} from "../packages/react/src/canvas-pointer-interaction";

const targetNode = (id: string): MeshNode =>
  mesh({
    geometry: boxGeometry(1),
    material: unlitMaterial({ color: [1, 1, 1, 1] }),
    pickingId: id,
  });

const pickedTarget = (
  node: MeshNode,
  clientX = 0,
): CanvasPickedPointerTarget => {
  const hit: PickResult = {
    clientX,
    clientY: 0,
    distance: 1,
    point: [0, 0, 0],
    target: {
      id: node.pickingId ?? "target",
      kind: "mesh",
      node,
    },
  };

  return {
    hit,
    node,
    target: { handlers: {} },
  };
};

const dispatchTypes = (
  result: CanvasPointerInteractionResult,
): readonly string[] => result.dispatches.map((dispatch) => dispatch.type);

const pressedNode = (
  state: CanvasPointerInteractionState,
  pointerId: number,
): MeshNode | undefined => state.pressedNodesByPointerId.get(pointerId) as MeshNode | undefined;

describe("React canvas pointer interaction planner", () => {
  it("orders hover dispatches for target transitions", () => {
    const targetA = pickedTarget(targetNode("a"));
    const targetB = pickedTarget(targetNode("b"));
    let state = createCanvasPointerInteractionState();

    let result = reduceCanvasPointerInteraction(state, {
      picked: targetA,
      type: "pointermove",
    });
    expect(dispatchTypes(result)).toEqual(["pointerenter", "pointermove"]);
    expect(result.dispatches.map((dispatch) => dispatch.picked)).toEqual([targetA, targetA]);
    expect(result.state.hoveredTarget).toBe(targetA);

    state = result.state;
    result = reduceCanvasPointerInteraction(state, {
      picked: targetB,
      type: "pointermove",
    });
    expect(dispatchTypes(result)).toEqual(["pointerleave", "pointerenter", "pointermove"]);
    expect(result.dispatches.map((dispatch) => dispatch.picked)).toEqual([targetA, targetB, targetB]);
    expect(result.state.hoveredTarget).toBe(targetB);

    state = result.state;
    result = reduceCanvasPointerInteraction(state, {
      picked: undefined,
      type: "pointermove",
    });
    expect(dispatchTypes(result)).toEqual(["pointerleave"]);
    expect(result.dispatches.map((dispatch) => dispatch.picked)).toEqual([targetB]);
    expect(result.state.hoveredTarget).toBeUndefined();
  });

  it("keeps the stored hover target when moving within the same node", () => {
    const node = targetNode("a");
    const firstTarget = pickedTarget(node, 1);
    const nextTarget = pickedTarget(node, 2);
    const hovered = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
      picked: firstTarget,
      type: "pointermove",
    }).state;

    const result = reduceCanvasPointerInteraction(hovered, {
      picked: nextTarget,
      type: "pointermove",
    });

    expect(dispatchTypes(result)).toEqual(["pointermove"]);
    expect(result.dispatches.map((dispatch) => dispatch.picked)).toEqual([nextTarget]);
    expect(result.state).toBe(hovered);
    expect(result.state.hoveredTarget).toBe(firstTarget);
  });

  it("sets and deletes pressed nodes on pointerdown before dispatch planning", () => {
    const target = pickedTarget(targetNode("a"));
    const down = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
      picked: target,
      pointerId: 7,
      type: "pointerdown",
    });

    expect(dispatchTypes(down)).toEqual(["pointerdown"]);
    expect(pressedNode(down.state, 7)).toBe(target.node);

    const miss = reduceCanvasPointerInteraction(down.state, {
      picked: undefined,
      pointerId: 7,
      type: "pointerdown",
    });

    expect(dispatchTypes(miss)).toEqual([]);
    expect(miss.state.pressedNodesByPointerId.has(7)).toBe(false);
  });

  it("deletes pressed nodes on pointerup and clicks only for same left-button targets", () => {
    const targetA = pickedTarget(targetNode("a"));
    const targetB = pickedTarget(targetNode("b"));
    const stateWithPress = (target: CanvasPickedPointerTarget) =>
      reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
        picked: target,
        pointerId: 1,
        type: "pointerdown",
      }).state;

    const click = reduceCanvasPointerInteraction(stateWithPress(targetA), {
      button: 0,
      picked: targetA,
      pointerId: 1,
      type: "pointerup",
    });
    expect(dispatchTypes(click)).toEqual(["pointerup", "click"]);
    expect(click.state.pressedNodesByPointerId.has(1)).toBe(false);

    const differentTarget = reduceCanvasPointerInteraction(stateWithPress(targetA), {
      button: 0,
      picked: targetB,
      pointerId: 1,
      type: "pointerup",
    });
    expect(dispatchTypes(differentTarget)).toEqual(["pointerup"]);
    expect(differentTarget.state.pressedNodesByPointerId.has(1)).toBe(false);

    const rightButton = reduceCanvasPointerInteraction(stateWithPress(targetA), {
      button: 2,
      picked: targetA,
      pointerId: 1,
      type: "pointerup",
    });
    expect(dispatchTypes(rightButton)).toEqual(["pointerup"]);
    expect(rightButton.state.pressedNodesByPointerId.has(1)).toBe(false);

    const miss = reduceCanvasPointerInteraction(stateWithPress(targetA), {
      button: 0,
      picked: undefined,
      pointerId: 1,
      type: "pointerup",
    });
    expect(dispatchTypes(miss)).toEqual([]);
    expect(miss.state.pressedNodesByPointerId.has(1)).toBe(false);
  });

  it("clears hover and all pressed nodes on pointerleave", () => {
    const targetA = pickedTarget(targetNode("a"));
    const targetB = pickedTarget(targetNode("b"));
    let state = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
      picked: targetA,
      type: "pointermove",
    }).state;
    state = reduceCanvasPointerInteraction(state, {
      picked: targetA,
      pointerId: 1,
      type: "pointerdown",
    }).state;
    state = reduceCanvasPointerInteraction(state, {
      picked: targetB,
      pointerId: 2,
      type: "pointerdown",
    }).state;

    const result = reduceCanvasPointerInteraction(state, { type: "pointerleave" });

    expect(dispatchTypes(result)).toEqual(["pointerleave"]);
    expect(result.dispatches.map((dispatch) => dispatch.picked)).toEqual([targetA]);
    expect(result.state.hoveredTarget).toBeUndefined();
    expect(result.state.pressedNodesByPointerId.size).toBe(0);
  });

  it("clears only one pressed pointer on cancel and clears all state on reset", () => {
    const targetA = pickedTarget(targetNode("a"));
    const targetB = pickedTarget(targetNode("b"));
    let state = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
      picked: targetA,
      type: "pointermove",
    }).state;
    state = reduceCanvasPointerInteraction(state, {
      picked: targetA,
      pointerId: 1,
      type: "pointerdown",
    }).state;
    state = reduceCanvasPointerInteraction(state, {
      picked: targetB,
      pointerId: 2,
      type: "pointerdown",
    }).state;

    const canceled = reduceCanvasPointerInteraction(state, {
      pointerId: 1,
      type: "pointercancel",
    });
    expect(dispatchTypes(canceled)).toEqual([]);
    expect(canceled.state.hoveredTarget).toBe(targetA);
    expect(canceled.state.pressedNodesByPointerId.has(1)).toBe(false);
    expect(pressedNode(canceled.state, 2)).toBe(targetB.node);

    const reset = reduceCanvasPointerInteraction(canceled.state, { type: "reset" });
    expect(dispatchTypes(reset)).toEqual([]);
    expect(reset.state.hoveredTarget).toBeUndefined();
    expect(reset.state.pressedNodesByPointerId.size).toBe(0);
  });
});
