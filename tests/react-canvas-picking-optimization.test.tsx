import { describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  mesh,
  perspectiveCamera,
  scene,
  unlitMaterial,
  type MeshNode,
  type PickInput,
  type PickResult,
  type RenderRoot,
} from "@royal/renderer-core";
import {
  attachCanvasPointerEventHandlers,
  reconcileCanvasPointerInteractionScene,
} from "../packages/react/src/canvas-pointer-events";
import { createCanvasPointerInteractionState } from "../packages/react/src/canvas-pointer-interaction";
import {
  createRoyalPointerEvent,
  type RoyalPointerEvent,
} from "../packages/react/src/picking-events";
import { createOrbitControls } from "../packages/react/src/orbit-controls";
import {
  createRoyalScenePickingIndex,
  createRoyalScenePointerEventRegistry,
  type ScenePointerEvents,
} from "../packages/react/src/scene-interactions";
import { fakeCanvas, fakeRendererRoot } from "./react-test-fixtures";

const perspectiveProps = {
  far: 10,
  fovY: Math.PI / 3,
  near: 0.1,
  position: [0, 0, 4] as const,
  rotation: [0, 0, 0] as const,
};

const pointerEvent = (
  pointerId: number,
  options: Partial<PointerEvent> = {},
): PointerEvent => {
  let defaultPrevented = false;

  return {
    button: 0,
    buttons: 0,
    clientX: 24,
    clientY: 36,
    get defaultPrevented() {
      return defaultPrevented;
    },
    pointerId,
    preventDefault: () => {
      defaultPrevented = true;
    },
    ...options,
  } as unknown as PointerEvent;
};

const firstMeshNode = (scene: RenderRoot | undefined): MeshNode | undefined => {
  const node = scene?.nodes[0];
  return node?.kind === "mesh" ? node : undefined;
};

const pickResultFor = (node: MeshNode, input: PickInput): PickResult => ({
  clientX: input.clientX,
  clientY: input.clientY,
  distance: 1,
  point: [0, 0, 0],
  target: {
    kind: "mesh",
    node,
    ...(node.pickingId === undefined ? {} : { id: node.pickingId }),
  },
});

const pickFirstMesh = (
  scene: RenderRoot | undefined,
  input: PickInput,
): PickResult | undefined => {
  const node = firstMeshNode(scene);
  return node === undefined ? undefined : pickResultFor(node, input);
};

const renderScene = (): RenderRoot => scene({
  camera: perspectiveCamera(perspectiveProps),
  nodes: [mesh({
    geometry: boxGeometry(1),
    material: unlitMaterial({ color: [1, 0, 0, 1] }),
    pickingId: "pickable",
  })],
});

const interactions = (
  handlers: ScenePointerEvents[string],
): ScenePointerEvents => ({ pickable: handlers });

const interactionRegistry = (
  renderScene: RenderRoot,
  handlers?: ScenePointerEvents,
) => createRoyalScenePointerEventRegistry(createRoyalScenePickingIndex(renderScene), handlers);

describe("React Canvas picking optimization", () => {
  it("coalesces pointer moves per frame and flushes the latest move before a gesture", () => {
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const frame = nextFrame;
      nextFrame += 1;
      frameCallbacks.set(frame, callback);
      return frame;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frame: number) => {
      frameCallbacks.delete(frame);
    }));
    const canvas = fakeCanvas();
    const root = fakeRendererRoot({ canvas, pick: pickFirstMesh });
    const onPointerDown = vi.fn();
    const onPointerMove = vi.fn<(event: RoyalPointerEvent) => void>();
    const renderRoot = renderScene();
    root.render(renderRoot);
    const detach = attachCanvasPointerEventHandlers({
      canvas,
      lastPointerEventRef: { current: undefined },
      pointerInteractionStateRef: { current: createCanvasPointerInteractionState() },
      sceneInteractionsRef: { current: interactionRegistry(renderRoot, interactions({ onPointerDown, onPointerMove })) },
      root,
    });

    for (let index = 0; index < 100; index += 1) {
      canvas.dispatchFakeEvent("pointermove", pointerEvent(1, { clientX: index }));
    }
    expect(root.pick).not.toHaveBeenCalled();
    expect(frameCallbacks.size).toBe(1);

    const firstFrame = frameCallbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    expect(firstFrame).toBeDefined();
    frameCallbacks.delete(firstFrame![0]);
    firstFrame![1](16);
    expect(root.pick).toHaveBeenCalledTimes(1);
    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerMove.mock.calls[0]![0].clientX).toBe(99);

    canvas.dispatchFakeEvent("pointermove", pointerEvent(1, { clientX: 120 }));
    canvas.dispatchFakeEvent("pointerdown", pointerEvent(1, { clientX: 121 }));
    expect(root.pick).toHaveBeenCalledTimes(3);
    expect(onPointerMove.mock.calls[1]![0].clientX).toBe(120);
    expect(onPointerDown).toHaveBeenCalledTimes(1);

    canvas.dispatchFakeEvent("pointermove", pointerEvent(1, { buttons: 1, clientX: 122 }));
    expect(root.pick).toHaveBeenCalledTimes(4);
    expect(onPointerMove.mock.calls[2]![0].clientX).toBe(122);

    canvas.dispatchFakeEvent("pointermove", pointerEvent(2, { clientX: 200 }));
    canvas.dispatchFakeEvent("pointermove", pointerEvent(3, { clientX: 300 }));
    canvas.dispatchFakeEvent("pointermove", pointerEvent(2, { clientX: 220 }));
    const multiPointerFrame = frameCallbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    expect(multiPointerFrame).toBeDefined();
    frameCallbacks.delete(multiPointerFrame![0]);
    multiPointerFrame![1](32);
    expect(onPointerMove.mock.calls.slice(3).map(([event]) => event.clientX)).toEqual([300, 220]);

    detach();
    vi.unstubAllGlobals();
  });

  it("forwards pointer event default and propagation controls to the native event", () => {
    const stopPropagation = vi.fn();
    const nativeEvent = pointerEvent(1, { stopPropagation });
    const node = {
      geometry: boxGeometry(1),
      kind: "mesh",
      material: unlitMaterial({ color: [1, 0, 0, 1] }),
    } as MeshNode;
    const hit: PickResult = {
      clientX: nativeEvent.clientX,
      clientY: nativeEvent.clientY,
      distance: 1,
      point: [0, 0, 0],
      target: { kind: "mesh", node },
    };

    const event = createRoyalPointerEvent({
      hit,
      nativeEvent,
      type: "pointerdown",
    });

    event.preventDefault();
    event.stopPropagation();

    expect(event.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("skips root.pick for pointer events when rendered nodes have no pointer handlers", () => {
    const canvas = fakeCanvas();
    const root = fakeRendererRoot({ canvas, pick: pickFirstMesh });
    const renderRoot = renderScene();
    const sceneInteractions = interactionRegistry(renderRoot);

    root.render(renderRoot);
    expect(sceneInteractions.hasPointerEventTargets).toBe(false);

    const detach = attachCanvasPointerEventHandlers({
      canvas,
      lastPointerEventRef: { current: undefined },
      pointerInteractionStateRef: { current: createCanvasPointerInteractionState() },
      sceneInteractionsRef: { current: sceneInteractions },
      root,
    });

    canvas.dispatchFakeEvent("pointermove", pointerEvent(1));
    canvas.dispatchFakeEvent("pointerdown", pointerEvent(1));
    canvas.dispatchFakeEvent("pointerup", pointerEvent(1));

    expect(root.pick).not.toHaveBeenCalled();

    detach();
  });

  it("calls root.pick and dispatches pointer handlers when rendered nodes have handlers", () => {
    const canvas = fakeCanvas();
    const root = fakeRendererRoot({ canvas, pick: pickFirstMesh });
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    const onPointerMove = vi.fn();
    const onPointerUp = vi.fn();
    const renderRoot = renderScene();
    const sceneInteractions = interactionRegistry(renderRoot, interactions({
      onClick,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    }));

    root.render(renderRoot);
    expect(sceneInteractions.hasPointerEventTargets).toBe(true);

    const detach = attachCanvasPointerEventHandlers({
      canvas,
      lastPointerEventRef: { current: undefined },
      pointerInteractionStateRef: { current: createCanvasPointerInteractionState() },
      sceneInteractionsRef: { current: sceneInteractions },
      root,
    });

    canvas.dispatchFakeEvent("pointermove", pointerEvent(1));
    canvas.dispatchFakeEvent("pointerdown", pointerEvent(1));
    canvas.dispatchFakeEvent("pointerup", pointerEvent(1));

    expect(root.pick).toHaveBeenCalledTimes(3);
    expect(onPointerMove).toHaveBeenCalledTimes(1);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onPointerUp).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);

    detach();
  });

  it.each(["touch", "pen"] as const)(
    "routes %s cancellation to its retained press after the target is removed",
    (pointerType) => {
      const canvas = fakeCanvas();
      const root = fakeRendererRoot({ canvas, pick: pickFirstMesh });
      const onPointerCancel = vi.fn<(event: RoyalPointerEvent) => void>();
      const onPointerLeave = vi.fn();
      const renderRoot = renderScene();
      const emptyRoot = scene({
        camera: perspectiveCamera(perspectiveProps),
        nodes: [],
      });
      const sceneInteractionsRef = {
        current: interactionRegistry(
          renderRoot,
          interactions({ onPointerCancel, onPointerLeave }),
        ),
      };
      const pointerInteractionStateRef = { current: createCanvasPointerInteractionState() };
      const lastPointerEventRef: { current: PointerEvent | undefined } = { current: undefined };
      root.render(renderRoot);
      const detach = attachCanvasPointerEventHandlers({
        canvas,
        lastPointerEventRef,
        pointerInteractionStateRef,
        sceneInteractionsRef,
        root,
      });

      canvas.dispatchFakeEvent(
        "pointermove",
        pointerEvent(17, { pointerType }),
      );
      canvas.dispatchFakeEvent(
        "pointerdown",
        pointerEvent(17, { buttons: 1, pointerType }),
      );
      reconcileCanvasPointerInteractionScene({
        lastPointerEventRef,
        pointerInteractionStateRef,
        sceneInteractions: interactionRegistry(emptyRoot),
        sceneInteractionsRef,
      });
      root.render(emptyRoot);

      const canceled = pointerEvent(17, { pointerType });
      onPointerCancel.mockImplementationOnce((event) => {
        expect(event.type).toBe("pointercancel");
        expect(event.nativeEvent).toBe(canceled);
        expect(event.nativeEvent.pointerType).toBe(pointerType);
        canvas.dispatchFakeEvent("pointercancel", canceled);
      });
      canvas.dispatchFakeEvent("pointercancel", canceled);
      canvas.dispatchFakeEvent("pointerleave", canceled);

      expect(onPointerCancel).toHaveBeenCalledTimes(1);
      expect(onPointerLeave).toHaveBeenCalledTimes(1);
      expect(root.pick).toHaveBeenCalledTimes(2);
      expect(pointerInteractionStateRef.current.hoveredTarget).toBeUndefined();
      expect(pointerInteractionStateRef.current.pressedTargetsByPointerId.size).toBe(0);

      detach();
      canvas.dispatchFakeEvent("pointercancel", canceled);
      expect(onPointerCancel).toHaveBeenCalledTimes(1);
    },
  );

  it("does not invent a cancel target when pointerdown had no hit", () => {
    const canvas = fakeCanvas();
    const root = fakeRendererRoot({ canvas });
    const onPointerCancel = vi.fn();
    const renderRoot = renderScene();
    const sceneInteractions = interactionRegistry(
      renderRoot,
      interactions({ onPointerCancel }),
    );
    const pointerInteractionStateRef = { current: createCanvasPointerInteractionState() };
    root.render(renderRoot);
    expect(sceneInteractions.hasPointerEventTargets).toBe(true);
    const detach = attachCanvasPointerEventHandlers({
      canvas,
      lastPointerEventRef: { current: undefined },
      pointerInteractionStateRef,
      sceneInteractionsRef: { current: sceneInteractions },
      root,
    });

    canvas.dispatchFakeEvent(
      "pointerdown",
      pointerEvent(23, { buttons: 1, pointerType: "touch" }),
    );
    canvas.dispatchFakeEvent(
      "pointercancel",
      pointerEvent(23, { pointerType: "touch" }),
    );

    expect(root.pick).toHaveBeenCalledTimes(1);
    expect(onPointerCancel).not.toHaveBeenCalled();
    expect(pointerInteractionStateRef.current.pressedTargetsByPointerId.size).toBe(0);
    detach();
  });

  it("consumes picked gestures before controls even when controls attach first", () => {
    const canvas = fakeCanvas();
    const root = fakeRendererRoot({ canvas, pick: pickFirstMesh });
    const controls = createOrbitControls(canvas, {
      defaultView: { distance: 5, pitch: 0, target: [0, 0, 0], yaw: 0 },
    });
    const onPointerDown = vi.fn((event: RoyalPointerEvent) => {
      event.preventDefault();
    });
    const renderRoot = renderScene();
    const sceneInteractions = interactionRegistry(renderRoot, interactions({ onPointerDown }));
    root.render(renderRoot);
    const detachPicking = attachCanvasPointerEventHandlers({
      canvas,
      lastPointerEventRef: { current: undefined },
      pointerInteractionStateRef: { current: createCanvasPointerInteractionState() },
      sceneInteractionsRef: { current: sceneInteractions },
      root,
    });

    const down = pointerEvent(1, { clientX: 10, clientY: 20 });
    canvas.dispatchFakeEvent("pointerdown", down);
    canvas.dispatchFakeEvent("pointermove", pointerEvent(1, { clientX: 40, clientY: 50 }));

    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(down.defaultPrevented).toBe(true);
    expect(controls.getView()).toEqual({
      distance: 5,
      pitch: 0,
      target: [0, 0, 0],
      yaw: 0,
    });

    detachPicking();
    controls.dispose();
  });

  it("keeps a pressed gesture across handler-only interaction changes without resubmitting the scene", () => {
    const canvas = fakeCanvas();
    const root = fakeRendererRoot({ canvas, pick: pickFirstMesh });
    const oldClick = vi.fn();
    const nextClick = vi.fn();
    const renderRoot = renderScene();
    const pickingIndex = createRoyalScenePickingIndex(renderRoot);
    const oldInteractions = createRoyalScenePointerEventRegistry(
      pickingIndex,
      interactions({ onClick: oldClick }),
    );
    const nextInteractions = createRoyalScenePointerEventRegistry(
      pickingIndex,
      interactions({ onClick: nextClick }),
    );
    const sceneInteractionsRef = { current: oldInteractions };
    const pointerInteractionStateRef = { current: createCanvasPointerInteractionState() };
    const lastPointerEventRef: { current: PointerEvent | undefined } = { current: undefined };
    root.render(renderRoot);
    const detach = attachCanvasPointerEventHandlers({
      canvas,
      lastPointerEventRef,
      pointerInteractionStateRef,
      sceneInteractionsRef,
      root,
    });

    canvas.dispatchFakeEvent("pointerdown", pointerEvent(7));
    sceneInteractionsRef.current = nextInteractions;
    canvas.dispatchFakeEvent("pointerup", pointerEvent(7));

    expect(oldClick).not.toHaveBeenCalled();
    expect(nextClick).toHaveBeenCalledTimes(1);
    expect(root.render).toHaveBeenCalledTimes(1);
    detach();
  });

  it("requires every interaction key to identify exactly one scene node", () => {
    const renderRoot = renderScene();
    expect(() => interactionRegistry(renderRoot, interactions({ onClick: vi.fn() }))).not.toThrow();
    expect(() => createRoyalScenePointerEventRegistry(
      createRoyalScenePickingIndex(renderRoot),
      { missing: { onClick: vi.fn() } },
    )).toThrow(/requires one scene node/);

    const node = renderRoot.nodes[0]!;
    const duplicate = scene({
      camera: perspectiveCamera(perspectiveProps),
      nodes: [node, node],
    });
    expect(() => createRoyalScenePointerEventRegistry(
      createRoyalScenePickingIndex(duplicate),
      interactions({ onClick: vi.fn() }),
    )).toThrow(/ambiguous/);
  });

  it("emits pointerleave when a hovered pickingId is removed by a scene commit", () => {
    const canvas = fakeCanvas();
    const root = fakeRendererRoot({ canvas, pick: pickFirstMesh });
    const onPointerLeave = vi.fn();
    const nextPointerLeave = vi.fn();
    const interactiveScene = renderScene();
    const emptyScene = renderScene();
    const sceneInteractionsRef = {
      current: interactionRegistry(interactiveScene, interactions({ onPointerLeave })),
    };
    const pointerInteractionStateRef = { current: createCanvasPointerInteractionState() };
    const lastPointerEventRef: { current: PointerEvent | undefined } = { current: undefined };
    root.render(interactiveScene);
    const detach = attachCanvasPointerEventHandlers({
      canvas,
      lastPointerEventRef,
      pointerInteractionStateRef,
      sceneInteractionsRef,
      root,
    });
    canvas.dispatchFakeEvent("pointermove", pointerEvent(8));

    reconcileCanvasPointerInteractionScene({
      lastPointerEventRef,
      pointerInteractionStateRef,
      sceneInteractions: interactionRegistry(
        interactiveScene,
        interactions({ onPointerLeave: nextPointerLeave }),
      ),
      sceneInteractionsRef,
    });

    reconcileCanvasPointerInteractionScene({
      lastPointerEventRef,
      pointerInteractionStateRef,
      sceneInteractions: interactionRegistry(emptyScene),
      sceneInteractionsRef,
    });

    expect(onPointerLeave).not.toHaveBeenCalled();
    expect(nextPointerLeave).toHaveBeenCalledTimes(1);
    expect(pointerInteractionStateRef.current.hoveredTarget).toBeUndefined();
    detach();
  });
});
