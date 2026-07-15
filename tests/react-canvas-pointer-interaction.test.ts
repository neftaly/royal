import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  mesh,
  unlitMaterial,
  type GltfInstancesNode,
  type MeshNode,
  type PickResult,
} from "@royal/renderer-core";
import {
  createCanvasPointerInteractionIdentity,
  createCanvasPointerInteractionState,
  reduceCanvasPointerInteraction,
  type CanvasPickedPointerTarget,
  type CanvasPointerInteractionAction,
  type CanvasPointerInteractionResult,
  type CanvasPointerInteractionState,
} from "../packages/react/src/interaction/canvas-pointer-interaction";
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

  const target = { handlers: {} };

  return {
    hit,
    identity: createCanvasPointerInteractionIdentity(hit, target),
    node,
    target,
  };
};

const pickedInstance = (
  node: GltfInstancesNode,
  fallbackTarget: object,
  instanceIndex: number,
  id?: string,
  instanceId?: string,
): CanvasPickedPointerTarget => {
  const hit: PickResult = {
    clientX: instanceIndex,
    clientY: 0,
    distance: 1,
    point: [0, 0, 0],
    target: {
      ...(id === undefined ? {} : { id }),
      ...(instanceId === undefined ? {} : { instanceId }),
      instanceIndex,
      kind: "gltf-instances",
      node,
    },
  };

  return {
    hit,
    identity: createCanvasPointerInteractionIdentity(hit, fallbackTarget),
    node,
    target: { handlers: {} },
  };
};

const dispatchTypes = (
  result: CanvasPointerInteractionResult,
): readonly string[] => result.dispatches.map((dispatch) => dispatch.type);

const pressedIdentity = (
  state: CanvasPointerInteractionState,
  pointerId: number,
) => state.pressedTargetsByPointerId.get(pointerId)?.identity;

const pointerIds = [1, 2, 7] as const;

const samePressedEntriesExcept = (
  before: CanvasPointerInteractionState,
  after: CanvasPointerInteractionState,
  pointerId: number,
): boolean => {
  const ids = new Set([
    ...before.pressedTargetsByPointerId.keys(),
    ...after.pressedTargetsByPointerId.keys(),
  ]);
  ids.delete(pointerId);

  for (const id of ids) {
    if (before.pressedTargetsByPointerId.get(id) !== after.pressedTargetsByPointerId.get(id)) {
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

  it("keeps the latest hit for the same explicit picking identity", () => {
    const firstTarget = pickedTarget(targetNode("a"), 1);
    const nextTarget = pickedTarget(targetNode("a"), 2);
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
    expect(result.state.hoveredTarget).toBe(nextTarget);
  });

  it("distinguishes bulk instances while keeping one node identity across primitives", () => {
    const node = { kind: "gltf-instances" } as GltfInstancesNode;
    const hostTarget = {};
    const instance0 = pickedInstance(node, hostTarget, 0, "pieces");
    const instance1 = pickedInstance(node, hostTarget, 1, "pieces");
    const instance1Detail = pickedInstance(node, hostTarget, 1, "pieces");
    let state = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
      picked: instance0,
      type: "pointermove",
    }).state;

    let result = reduceCanvasPointerInteraction(state, {
      picked: instance1,
      type: "pointermove",
    });
    expect(dispatchTypes(result)).toEqual(["pointerleave", "pointerenter", "pointermove"]);

    state = result.state;
    result = reduceCanvasPointerInteraction(state, {
      picked: instance1Detail,
      type: "pointermove",
    });
    expect(dispatchTypes(result)).toEqual(["pointermove"]);

    state = reduceCanvasPointerInteraction(state, {
      picked: instance1,
      pointerId: 1,
      type: "pointerdown",
    }).state;
    result = reduceCanvasPointerInteraction(state, {
      button: 0,
      picked: instance0,
      pointerId: 1,
      type: "pointerup",
    });
    expect(dispatchTypes(result)).toEqual(["pointerup"]);
  });

  it("keeps caller logical instance identity stable across packed index changes", () => {
    const node = { kind: "gltf-instances" } as GltfInstancesNode;
    const hostTarget = {};
    const before = pickedInstance(node, hostTarget, 2, "pieces", "card-17");
    const after = pickedInstance(node, hostTarget, 9, "pieces", "card-17");
    const hovered = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
      picked: before,
      type: "pointermove",
    }).state;
    const result = reduceCanvasPointerInteraction(hovered, { picked: after, type: "pointermove" });

    expect(dispatchTypes(result)).toEqual(["pointermove"]);
    expect(after.identity).toMatchObject({ instanceId: "card-17" });
    expect(after.identity.instanceIndex).toBeUndefined();
  });

  it("sets and deletes pressed nodes on pointerdown before dispatch planning", () => {
    const target = pickedTarget(targetNode("a"));
    const down = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
      picked: target,
      pointerId: 7,
      type: "pointerdown",
    });

    expect(dispatchTypes(down)).toEqual(["pointerdown"]);
    expect(down.state.pressedTargetsByPointerId.get(7)).toBe(target);

    const miss = reduceCanvasPointerInteraction(down.state, {
      picked: undefined,
      pointerId: 7,
      type: "pointerdown",
    });

    expect(dispatchTypes(miss)).toEqual([]);
    expect(miss.state.pressedTargetsByPointerId.has(7)).toBe(false);
  });

  it("handles pointerup dispatch and cleanup cases", () => {
    const targetA = pickedTarget(targetNode("a"));
    const targetB = pickedTarget(targetNode("b"));
    const stateWithPress = () =>
      reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
        picked: targetA,
        pointerId: 1,
        type: "pointerdown",
      }).state;
    const cases: Array<[
      string,
      () => CanvasPointerInteractionState,
      CanvasPickedPointerTarget | undefined,
      number,
      readonly string[],
    ]> = [
      ["same left-button target", stateWithPress, targetA, 0, ["pointerup", "click"]],
      ["different left-button target", stateWithPress, targetB, 0, ["pointerup"]],
      ["same right-button target", stateWithPress, targetA, 2, ["pointerup"]],
      ["missed left-button target", stateWithPress, undefined, 0, []],
      ["picked target without prior press", createCanvasPointerInteractionState, targetA, 0, ["pointerup"]],
    ];

    for (const [label, state, picked, button, dispatches] of cases) {
      const result = reduceCanvasPointerInteraction(state(), {
        button,
        picked,
        pointerId: 1,
        type: "pointerup",
      });

      expect(dispatchTypes(result), label).toEqual(dispatches);
      expect(
        result.dispatches.map((dispatch) => dispatch.picked),
        `${label} dispatch targets`,
      ).toEqual(dispatches.map(() => picked));
      expect(result.state.pressedTargetsByPointerId.has(1), `${label} cleanup`).toBe(false);
    }
  });

  it("clears hover without losing presses on pointerleave", () => {
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
    expect(pressedIdentity(result.state, 1)).toBe(targetA.identity);
    expect(pressedIdentity(result.state, 2)).toBe(targetB.identity);
  });

  it("dispatches cancel to its retained pressed target before clearing interaction state", () => {
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
    expect(dispatchTypes(canceled)).toEqual(["pointercancel", "pointerleave"]);
    expect(canceled.dispatches.map((dispatch) => dispatch.picked)).toEqual([targetA, targetA]);
    expect(canceled.state.hoveredTarget).toBeUndefined();
    expect(canceled.state.pressedTargetsByPointerId.has(1)).toBe(false);
    expect(pressedIdentity(canceled.state, 2)).toBe(targetB.identity);

    const laterLeave = reduceCanvasPointerInteraction(canceled.state, { type: "pointerleave" });
    expect(dispatchTypes(laterLeave)).toEqual([]);
    expect(laterLeave.state).toBe(canceled.state);

    const reset = reduceCanvasPointerInteraction(canceled.state, { type: "reset" });
    expect(dispatchTypes(reset)).toEqual([]);
    expect(reset.state.hoveredTarget).toBeUndefined();
    expect(reset.state.pressedTargetsByPointerId.size).toBe(0);
  });

  it("routes cancel to the press while leave remains owned by the hovered target", () => {
    const pressed = pickedTarget(targetNode("pressed"));
    const hovered = pickedTarget(targetNode("hovered"));
    let state = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
      picked: pressed,
      pointerId: 1,
      type: "pointerdown",
    }).state;
    state = reduceCanvasPointerInteraction(state, {
      picked: hovered,
      type: "pointermove",
    }).state;

    const result = reduceCanvasPointerInteraction(state, {
      pointerId: 1,
      type: "pointercancel",
    });

    expect(result.dispatches).toEqual([
      { picked: pressed, type: "pointercancel" },
      { picked: hovered, type: "pointerleave" },
    ]);
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
        const expectedPressedIdentity = action.type === "pointerup"
          ? before.pressedTargetsByPointerId.get(action.pointerId)?.identity
          : undefined;
        const result = reduceCanvasPointerInteraction(before, action);
        const types = dispatchTypes(result);
        const detail = `${label} step=${step} action=${action.type}`;

        expect(
          result.state.hoveredTarget === undefined || targets.includes(result.state.hoveredTarget),
          `${detail} stores at most one known hover target`,
        ).toBe(true);

        if (action.type === "pointermove" && action.picked !== undefined) {
          expect(result.state.hoveredTarget, `${detail} stores latest hover hit`).toBe(action.picked);
        }

        if (action.type === "pointerdown" || action.type === "pointerup" || action.type === "pointercancel") {
          expect(
            samePressedEntriesExcept(before, result.state, action.pointerId),
            `${detail} only changes matching pressed pointer`,
          ).toBe(true);
        } else if (action.type === "pointermove") {
          expect(result.state.pressedTargetsByPointerId, `${detail} does not change pressed pointers`).toBe(
            before.pressedTargetsByPointerId,
          );
        } else if (action.type === "pointerleave") {
          expect(result.state.hoveredTarget, `${detail} clears hover`).toBeUndefined();
          expect(result.state.pressedTargetsByPointerId, `${detail} preserves pressed pointers`).toBe(
            before.pressedTargetsByPointerId,
          );
        } else {
          expect(result.state.hoveredTarget, `${detail} clears hover`).toBeUndefined();
          expect(result.state.pressedTargetsByPointerId.size, `${detail} clears pressed pointers`).toBe(0);
        }

        if (action.type === "pointercancel") {
          const cancelDispatch = result.dispatches.find((dispatch) => dispatch.type === "pointercancel");
          expect(
            cancelDispatch?.picked,
            `${detail} routes cancel to retained press`,
          ).toBe(before.pressedTargetsByPointerId.get(action.pointerId));
          expect(
            types.filter((type) => type === "pointercancel"),
            `${detail} emits at most one cancel`,
          ).toHaveLength(before.pressedTargetsByPointerId.has(action.pointerId) ? 1 : 0);
        }

        if (types.includes("click")) {
          expect(action.type, `${detail} click follows pointerup`).toBe("pointerup");
          if (action.type === "pointerup") {
            expect(action.button, `${detail} click uses left button`).toBe(0);
            expect(action.picked?.identity, `${detail} click uses same pressed identity`).toEqual(
              expectedPressedIdentity,
            );
          }
        }

        state = result.state;
      }
    });
  });
});
