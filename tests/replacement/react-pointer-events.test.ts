import {
  boxGeometry,
  mesh,
  perspectiveCamera,
  scene,
  unlitMaterial,
  type PickResult,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import {
  createCanvasPointerInteractionIdentity,
  createCanvasPointerInteractionState,
  reduceCanvasPointerInteraction,
  type CanvasPickedPointerTarget,
} from "../../packages/react/src/interaction/canvas-pointer-interaction";
import { attachCanvasPointerEventHandlers } from "../../packages/react/src/interaction/canvas-pointer-events";
import {
  createRoyalScenePickingIndex,
  createRoyalScenePointerEventRegistry,
} from "../../packages/react/src/interaction/scene-interactions";

const material = unlitMaterial({ color: [0.2, 0.4, 0.8, 1] });
const camera = perspectiveCamera({ position: [0, 0, 3] });

class TestPointerEvent extends Event {
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;

  constructor(type: string, options: {
    button?: number;
    buttons?: number;
    clientX: number;
    clientY: number;
    pointerId: number;
  }) {
    super(type, { bubbles: true, cancelable: true });
    this.button = options.button ?? 0;
    this.buttons = options.buttons ?? 0;
    this.clientX = options.clientX;
    this.clientY = options.clientY;
    this.pointerId = options.pointerId;
  }
}

describe("React scene pointer events", () => {
  it("dispatches down, up, and click through the one imperative picker", () => {
    const node = mesh({
      geometry: boxGeometry(1),
      material,
      pickingId: "hero",
    });
    const renderScene = scene({ camera, nodes: [node] });
    const types: string[] = [];
    const registry = createRoyalScenePointerEventRegistry(
      createRoyalScenePickingIndex(renderScene),
      {
        hero: {
          onClick: (event) => types.push(event.type),
          onPointerDown: (event) => {
            types.push(event.type);
            event.preventDefault();
          },
          onPointerUp: (event) => types.push(event.type),
        },
      },
    );
    const hit: PickResult = {
      clientX: 40,
      clientY: 50,
      distance: 2.5,
      point: [0, 0, 0.5],
      target: { kind: "mesh", node, pickingId: "hero" },
    };
    const pick = vi.fn(() => hit);
    const canvas = new EventTarget();
    const pointerInteractionStateRef = { current: createCanvasPointerInteractionState() };
    const release = attachCanvasPointerEventHandlers({
      canvas: canvas as HTMLCanvasElement,
      lastPointerEventRef: { current: undefined },
      pointerInteractionStateRef,
      root: { pick },
      sceneInteractionsRef: { current: registry },
    });

    const down = new TestPointerEvent("pointerdown", {
      buttons: 1,
      clientX: 40,
      clientY: 50,
      pointerId: 7,
    });
    canvas.dispatchEvent(down);
    canvas.dispatchEvent(new TestPointerEvent("pointerup", {
      clientX: 40,
      clientY: 50,
      pointerId: 7,
    }));

    expect(types).toEqual(["pointerdown", "pointerup", "click"]);
    expect(down.defaultPrevented).toBe(true);
    expect(pick).toHaveBeenCalledTimes(2);
    expect(pointerInteractionStateRef.current.pressedTargetsByPointerId.size).toBe(0);
    release();
  });

  it("rejects event ids that are missing or ambiguous in the scene", () => {
    const duplicateScene = scene({
      camera,
      nodes: [
        mesh({ geometry: boxGeometry(1), material, pickingId: "same" }),
        mesh({ geometry: boxGeometry(2), material, pickingId: "same" }),
      ],
    });
    const index = createRoyalScenePickingIndex(duplicateScene);
    expect(() => createRoyalScenePointerEventRegistry(index, {
      same: { onClick: () => undefined },
    })).toThrow("ambiguous because 2 scene nodes");
    expect(() => createRoyalScenePointerEventRegistry(index, {
      missing: { onClick: () => undefined },
    })).toThrow("requires one scene node");
  });

  it("plans hover transitions in leave-enter-move order", () => {
    const picked = (id: string): CanvasPickedPointerTarget => {
      const node = mesh({ geometry: boxGeometry(1), material, pickingId: id });
      const hit: PickResult = {
        clientX: 0,
        clientY: 0,
        distance: 1,
        point: [0, 0, 0],
        target: { kind: "mesh", node, pickingId: id },
      };
      const target = { handlers: {} };
      return {
        hit,
        identity: createCanvasPointerInteractionIdentity(hit, target),
        node,
        target,
      };
    };
    const first = picked("first");
    const second = picked("second");
    const entered = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
      picked: first,
      type: "pointermove",
    });
    const moved = reduceCanvasPointerInteraction(entered.state, {
      picked: second,
      type: "pointermove",
    });
    expect(moved.dispatches.map((dispatch) => dispatch.type)).toEqual([
      "pointerleave",
      "pointerenter",
      "pointermove",
    ]);
  });
});
