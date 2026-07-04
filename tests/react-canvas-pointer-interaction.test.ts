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
  type CanvasPointerInteractionAction,
  type CanvasPointerInteractionResult,
  type CanvasPointerInteractionState,
} from "../packages/react/src/canvas-pointer-interaction";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

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

const pointerIds = [1, 2, 7] as const;

const samePressedEntriesExcept = (
  before: CanvasPointerInteractionState,
  after: CanvasPointerInteractionState,
  pointerId: number,
): boolean => {
  const ids = new Set([
    ...before.pressedNodesByPointerId.keys(),
    ...after.pressedNodesByPointerId.keys(),
  ]);
  ids.delete(pointerId);

  for (const id of ids) {
    if (before.pressedNodesByPointerId.get(id) !== after.pressedNodesByPointerId.get(id)) {
      return false;
    }
  }
  return true;
};

const randomPicked = (
  random: SeededRandom,
  targets: readonly CanvasPickedPointerTarget[],
): CanvasPickedPointerTarget | undefined =>
  random.boolean(0.82) ? random.pick(targets) : undefined;

const randomPointerAction = (
  random: SeededRandom,
  targets: readonly CanvasPickedPointerTarget[],
): CanvasPointerInteractionAction => {
  const picked = randomPicked(random, targets);
  const pointerId = random.pick(pointerIds);

  switch (random.int(0, 6)) {
    case 0:
    case 1:
      return { picked, type: "pointermove" };
    case 2:
      return { picked, pointerId, type: "pointerdown" };
    case 3:
      return {
        button: random.boolean(0.7) ? 0 : random.pick([1, 2, 3] as const),
        picked,
        pointerId,
        type: "pointerup",
      };
    case 4:
      return { pointerId, type: "pointercancel" };
    default:
      return random.boolean() ? { type: "pointerleave" } : { type: "reset" };
  }
};

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

  it("preserves pointer interaction invariants across generated event sequences", () => {
    forEachFuzzCase({ cases: 32, seed: 0xcafe_2035 }, ({ label, random }) => {
      const nodeA = targetNode("a");
      const nodeB = targetNode("b");
      const targets = [
        pickedTarget(nodeA, 1),
        pickedTarget(nodeA, 2),
        pickedTarget(nodeB, 3),
        pickedTarget(nodeB, 4),
      ];
      let state = createCanvasPointerInteractionState();

      for (let step = 0; step < 48; step += 1) {
        const action = randomPointerAction(random, targets);
        const before = state;
        const expectedPressedNode = action.type === "pointerup"
          ? before.pressedNodesByPointerId.get(action.pointerId)
          : undefined;
        const result = reduceCanvasPointerInteraction(before, action);
        const types = dispatchTypes(result);
        const detail = `${label} step=${step} action=${action.type}`;

        expect(
          result.state.hoveredTarget === undefined || targets.includes(result.state.hoveredTarget),
          `${detail} stores at most one known hover target`,
        ).toBe(true);

        if (action.type === "pointermove" && before.hoveredTarget?.node === action.picked?.node) {
          expect(result.state.hoveredTarget, `${detail} keeps same-node hover identity`).toBe(before.hoveredTarget);
        }

        if (action.type === "pointerdown" || action.type === "pointerup" || action.type === "pointercancel") {
          expect(
            samePressedEntriesExcept(before, result.state, action.pointerId),
            `${detail} only changes matching pressed pointer`,
          ).toBe(true);
        } else if (action.type === "pointermove") {
          expect(result.state.pressedNodesByPointerId, `${detail} does not change pressed pointers`).toBe(
            before.pressedNodesByPointerId,
          );
        } else {
          expect(result.state.hoveredTarget, `${detail} clears hover`).toBeUndefined();
          expect(result.state.pressedNodesByPointerId.size, `${detail} clears pressed pointers`).toBe(0);
        }

        if (types.includes("click")) {
          expect(action.type, `${detail} click follows pointerup`).toBe("pointerup");
          if (action.type === "pointerup") {
            expect(action.button, `${detail} click uses left button`).toBe(0);
            expect(action.picked?.node, `${detail} click uses same pressed node`).toBe(expectedPressedNode);
          }
        }

        state = result.state;
      }
    });
  });
});
