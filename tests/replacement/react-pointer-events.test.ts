import {
  boxGeometry,
  createGltfInstanceTransforms,
  gltfInstances,
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
import {
  attachCanvasPointerEventHandlers,
  reconcileCanvasPointerInteractionScene,
} from "../../packages/react/src/interaction/canvas-pointer-events";
import {
  createScenePickingIndex,
  createScenePointerEventRegistry,
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
    const registry = createScenePointerEventRegistry(
      createScenePickingIndex(renderScene),
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
    const index = createScenePickingIndex(duplicateScene);
    expect(() => createScenePointerEventRegistry(index, {
      same: { onClick: () => undefined },
    })).toThrow("ambiguous because 2 scene nodes");
    expect(() => createScenePointerEventRegistry(index, {
      missing: { onClick: () => undefined },
    })).toThrow("requires one scene node");
  });

  it("validates every own pointer-map and handler key", () => {
    const renderScene = scene({
      camera,
      nodes: [mesh({ geometry: boxGeometry(1), material, pickingId: "hero" })],
    });
    const index = createScenePickingIndex(renderScene);
    const symbolHandlers = {
      hero: { onClick: () => undefined },
      [Symbol("hidden")]: { onClick: () => undefined },
    };
    expect(() => createScenePointerEventRegistry(index, symbolHandlers as never))
      .toThrow(/unsupported pickingId Symbol\(hidden\)/);
    expect(() => createScenePointerEventRegistry(index, {
      hero: {
        onClick: () => undefined,
        [Symbol("hidden")]: () => undefined,
      } as never,
    })).toThrow(/unsupported handler Symbol\(hidden\)/);

    const handlers = {};
    Object.defineProperty(handlers, "onClick", {
      value: () => undefined,
    });
    const registry = createScenePointerEventRegistry(index, { hero: handlers });
    expect(registry.pointerEventTarget("hero")).toBeDefined();
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


it("dispatches instance-specific handlers and retains identity when its collection id changes", () => {
  const make = (ids: string[]) => gltfInstances({src: "/pieces.glb", pickingId: ids[0]!, instances: createGltfInstanceTransforms({count: ids.length, logicalIds: ids})});
  const original = make(["a", "b"]);
  const index = createScenePickingIndex(scene({camera, nodes: [original]}));
  expect(index.count("a")).toBe(1);
  expect(index.count("b")).toBe(1);
  const calls: string[] = [];
  const registry = createScenePointerEventRegistry(index, {
    a: {onClick: () => calls.push("a")},
    b: {onPointerDown: () => calls.push("b-down"), onClick: () => calls.push("b-click")},
  });
  let node = original;
  const hit = (): PickResult => ({clientX: 10, clientY: 10, distance: 1, point: [0, 0, 0], target: {kind: "gltf-instances", node, pickingId: node.pickingId!, instanceId: "b", instanceIndex: node.instances.logicalIds!.indexOf("b")}});
  const canvas = new EventTarget();
  const sceneInteractionsRef = { current: registry };
  const release = attachCanvasPointerEventHandlers({canvas: canvas as HTMLCanvasElement, lastPointerEventRef: {current: undefined}, pointerInteractionStateRef: {current: createCanvasPointerInteractionState()}, root: {pick: hit}, sceneInteractionsRef});
  canvas.dispatchEvent(new TestPointerEvent("pointerdown", {buttons: 1, clientX: 10, clientY: 10, pointerId: 1}));
  node = make(["b", "a"]);
  canvas.dispatchEvent(new TestPointerEvent("pointerup", {clientX: 10, clientY: 10, pointerId: 1}));
  expect(calls).toEqual(["b-down", "b-click"]);
  // A collection binding remains the fallback for an unbound logical instance.
  node = make(["a", "b"]);
  const fallbackRegistry = createScenePointerEventRegistry(index, {
    a: { onClick: () => calls.push("collection") },
  });
  sceneInteractionsRef.current = fallbackRegistry;
  canvas.dispatchEvent(new TestPointerEvent("pointerdown", { buttons: 1, clientX: 10, clientY: 10, pointerId: 1 }));
  canvas.dispatchEvent(new TestPointerEvent("pointerup", { clientX: 10, clientY: 10, pointerId: 1 }));
  expect(calls).toEqual(["b-down", "b-click", "collection"]);
  release();
  expect(() => createScenePointerEventRegistry(createScenePickingIndex(scene({camera, nodes: [original, make(["b"])]})), {b: {onClick: () => undefined}})).toThrow("ambiguous");
});

it.each([false, true])("keeps clicks when instance handlers change between down and up (initial override: %s)", (initialOverride) => {
  const node = gltfInstances({
    src: "/pieces.glb",
    pickingId: "collection",
    instances: createGltfInstanceTransforms({ count: 1, logicalIds: ["piece"] }),
  });
  const index = createScenePickingIndex(scene({ camera, nodes: [node] }));
  const calls: string[] = [];
  const leaves: string[] = [];
  const registry = (override: boolean) => createScenePointerEventRegistry(index, {
    collection: { onClick: () => calls.push("collection"), onPointerLeave: () => leaves.push("collection") },
    ...(override ? { piece: { onClick: () => calls.push("piece"), onPointerLeave: () => leaves.push("piece") } } : {}),
  });
  const sceneInteractionsRef = { current: registry(initialOverride) };
  const hit: PickResult = {
    clientX: 10, clientY: 10, distance: 1, point: [0, 0, 0],
    target: { kind: "gltf-instances", node, pickingId: "collection", instanceId: "piece", instanceIndex: 0 },
  };
  const canvas = new EventTarget();
  const lastPointerEventRef = { current: undefined as PointerEvent | undefined };
  const pointerInteractionStateRef = { current: createCanvasPointerInteractionState() };
  const release = attachCanvasPointerEventHandlers({
    canvas: canvas as HTMLCanvasElement,
    lastPointerEventRef,
    pointerInteractionStateRef,
    root: { pick: () => hit },
    sceneInteractionsRef,
  });
  canvas.dispatchEvent(new TestPointerEvent("pointermove", { buttons: 1, clientX: 10, clientY: 10, pointerId: 1 }));
  canvas.dispatchEvent(new TestPointerEvent("pointerdown", { buttons: 1, clientX: 10, clientY: 10, pointerId: 1 }));
  reconcileCanvasPointerInteractionScene({
    lastPointerEventRef, pointerInteractionStateRef, sceneInteractionsRef,
    sceneInteractions: registry(!initialOverride),
  });
  expect(leaves).toEqual([]);
  expect(pointerInteractionStateRef.current.hoveredTarget?.target).toBe(
    sceneInteractionsRef.current.pointerEventTarget(initialOverride ? "collection" : "piece"),
  );
  canvas.dispatchEvent(new TestPointerEvent("pointerup", { clientX: 10, clientY: 10, pointerId: 1 }));
  expect(calls).toEqual([initialOverride ? "collection" : "piece"]);
  release();
});

it("keeps repeated logical IDs in separate collections distinct", () => {
  const nodes = ["first", "second"].map((pickingId) => gltfInstances({
    src: "/pieces.glb", pickingId,
    instances: createGltfInstanceTransforms({ count: 1, logicalIds: ["piece"] }),
  }));
  const registry = createScenePointerEventRegistry(createScenePickingIndex(scene({ camera, nodes })), {
    first: { onClick: () => undefined }, second: { onClick: () => undefined },
  });
  const picked = nodes.map((node): CanvasPickedPointerTarget => {
    const hit: PickResult = {
      clientX: 10, clientY: 10, distance: 1, point: [0, 0, 0],
      target: { kind: "gltf-instances", node, pickingId: node.pickingId!, instanceId: "piece", instanceIndex: 0 },
    };
    const target = registry.pointerEventTarget(node.pickingId)!;
    return {
      hit, node, target,
      identity: createCanvasPointerInteractionIdentity(hit, target, registry.uniqueInstanceId("piece")),
    };
  });
  const down = reduceCanvasPointerInteraction(createCanvasPointerInteractionState(), {
    type: "pointerdown", picked: picked[0], pointerId: 1,
  });
  const up = reduceCanvasPointerInteraction(down.state, {
    type: "pointerup", picked: picked[1], pointerId: 1, button: 0,
  });
  expect(up.dispatches.map(({ type }) => type)).toEqual(["pointerup"]);
});

it.each([false, true])("keeps a collection's click when another collection changes logical ID uniqueness (initial duplicate: %s)", (initialDuplicate) => {
  const make = (pickingId: string) => gltfInstances({
    src: "/pieces.glb", pickingId,
    instances: createGltfInstanceTransforms({ count: 1, logicalIds: ["piece"] }),
  });
  const node = make("collection");
  const other = make("other");
  const calls: string[] = [];
  const registry = (duplicate: boolean) => createScenePointerEventRegistry(
    createScenePickingIndex(scene({ camera, nodes: duplicate ? [node, other] : [node] })),
    { collection: { onClick: () => calls.push("click") } },
  );
  const sceneInteractionsRef = { current: registry(initialDuplicate) };
  const hit: PickResult = {
    clientX: 10, clientY: 10, distance: 1, point: [0, 0, 0],
    target: { kind: "gltf-instances", node, pickingId: "collection", instanceId: "piece", instanceIndex: 0 },
  };
  const canvas = new EventTarget();
  const release = attachCanvasPointerEventHandlers({
    canvas: canvas as HTMLCanvasElement,
    lastPointerEventRef: { current: undefined },
    pointerInteractionStateRef: { current: createCanvasPointerInteractionState() },
    root: { pick: () => hit }, sceneInteractionsRef,
  });
  canvas.dispatchEvent(new TestPointerEvent("pointerdown", { buttons: 1, clientX: 10, clientY: 10, pointerId: 1 }));
  sceneInteractionsRef.current = registry(!initialDuplicate);
  canvas.dispatchEvent(new TestPointerEvent("pointerup", { clientX: 10, clientY: 10, pointerId: 1 }));
  expect(calls).toEqual(["click"]);
  release();
});
