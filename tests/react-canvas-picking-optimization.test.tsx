/** @jsxImportSource @royal/react */
import { describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  unlitMaterial,
  type MeshNode,
  type PickInput,
  type PickResult,
  type RenderRoot,
} from "@royal/renderer-core";
import {
  attachCanvasPointerEventHandlers,
} from "../packages/react/src/canvas";
import {
  createCanvasPointerInteractionState,
  type CanvasPickedPointerTarget,
} from "../packages/react/src/canvas-pointer-interaction";
import {
  createRoyalPointerEvent,
  handlerForRoyalPointerEvent,
  type RoyalPointerEventType,
} from "../packages/react/src/picking-events";
import { createRoyalRendererTree } from "../packages/react/src/renderer-tree";
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
  const node = scene?.children[0]?.children[0];
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

const renderScene = (handlers: {
  readonly onClick?: () => void;
  readonly onPointerDown?: () => void;
  readonly onPointerMove?: () => void;
  readonly onPointerUp?: () => void;
} = {}) => (
  <scene>
    <pass>
      <perspectiveCamera {...perspectiveProps} />
      <mesh
        geometry={boxGeometry(1)}
        material={unlitMaterial({ color: [1, 0, 0, 1] })}
        pickingId="pickable"
        {...handlers}
      />
    </pass>
  </scene>
);

describe("React Canvas picking optimization", () => {
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
    const rendererTree = createRoyalRendererTree();
    const dispatchRoyalPointerEvent = vi.fn((
      _type: RoyalPointerEventType,
      _nativeEvent: PointerEvent,
      _picked: CanvasPickedPointerTarget,
    ): void => {});

    rendererTree.setTarget(root, false);
    rendererTree.render(renderScene());
    expect(rendererTree.hasPointerEventTargets()).toBe(false);

    const detach = attachCanvasPointerEventHandlers({
      canvas,
      dispatchRoyalPointerEvent,
      pointerInteractionStateRef: { current: createCanvasPointerInteractionState() },
      rendererTree,
      root,
    });

    canvas.dispatchFakeEvent("pointermove", pointerEvent(1));
    canvas.dispatchFakeEvent("pointerdown", pointerEvent(1));
    canvas.dispatchFakeEvent("pointerup", pointerEvent(1));

    expect(root.pick).not.toHaveBeenCalled();
    expect(dispatchRoyalPointerEvent).not.toHaveBeenCalled();

    detach();
    rendererTree.dispose();
  });

  it("calls root.pick and dispatches pointer handlers when rendered nodes have handlers", () => {
    const canvas = fakeCanvas();
    const root = fakeRendererRoot({ canvas, pick: pickFirstMesh });
    const rendererTree = createRoyalRendererTree();
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    const onPointerMove = vi.fn();
    const onPointerUp = vi.fn();
    const dispatchRoyalPointerEvent = vi.fn((
      type: RoyalPointerEventType,
      nativeEvent: PointerEvent,
      picked: CanvasPickedPointerTarget,
    ): void => {
      const target = rendererTree.pointerEventTarget(picked.node) ?? picked.target;
      handlerForRoyalPointerEvent(target, type)?.(createRoyalPointerEvent({
        hit: picked.hit,
        nativeEvent,
        type,
      }));
    });

    rendererTree.setTarget(root, false);
    rendererTree.render(renderScene({
      onClick,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    }));
    expect(rendererTree.hasPointerEventTargets()).toBe(true);

    const detach = attachCanvasPointerEventHandlers({
      canvas,
      dispatchRoyalPointerEvent,
      pointerInteractionStateRef: { current: createCanvasPointerInteractionState() },
      rendererTree,
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
    rendererTree.dispose();
  });
});
