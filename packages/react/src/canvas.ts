import type { PickInput, PickResult, RenderRoot } from "@royal/renderer-core";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MutableRefObject,
  type Ref,
  type ReactNode,
} from "react";
import {
  createCanvasPointerInteractionIdentity,
  createCanvasPointerInteractionState,
  reduceCanvasPointerInteraction,
  type CanvasPickedPointerTarget,
  type CanvasPointerInteractionState,
  type CanvasPointerInteractionAction,
} from "./canvas-pointer-interaction";
import { createFrameLoop, FrameLoopContext, type FrameLoop } from "./frame";
import {
  createRoyalScenePickingIndex,
  createRoyalScenePointerEventRegistry,
  type CanvasInteractions,
  type RoyalScenePointerEventRegistry,
} from "./scene-interactions";
import {
  createRoyalPointerEvent,
  handlerForRoyalPointerEvent,
} from "./picking-events";
import {
  acquireExternalRenderClockForRoyalRoot,
  createRendererRoot,
  type RoyalRendererRoot,
  type RoyalRendererFrameClock,
  type RoyalRendererRootLifecycleSnapshot,
  type RoyalRendererRootContextOptions,
  type RoyalRendererRootOptions,
} from "./root";

const CanvasElementContext = createContext<HTMLCanvasElement | null | undefined>(undefined);
const CanvasRootContext = createContext<RoyalRendererRoot | null | undefined>(undefined);

export type CanvasContextOptions = RoyalRendererRootContextOptions;

/** Props for the Royal-owned canvas element. */
export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children"> {
  /** Ordinary React controls and imperative controllers rendered under Canvas context. */
  readonly children?: ReactNode;
  /** React-owned pointer handlers keyed by stable pickingId values in the pure scene. */
  readonly interactions?: CanvasInteractions;
  readonly ref?: Ref<HTMLCanvasElement>;
  /**
   * Renderer creation options. Changing a value disposes and recreates the
   * renderer root.
   */
  readonly context?: CanvasContextOptions;
  /** Pure renderer data, eagerly lowered before Canvas renders. */
  readonly scene: RenderRoot;
}

export const useCanvasElement = (): HTMLCanvasElement | null => {
  const canvas = useContext(CanvasElementContext);
  if (canvas === undefined) {
    throw new Error("Royal canvas hooks must be used inside Canvas");
  }

  return canvas;
};

export const useCanvasRoot = (): RoyalRendererRoot | null => {
  const root = useContext(CanvasRootContext);
  if (root === undefined) {
    throw new Error("Royal canvas hooks must be used inside Canvas");
  }

  return root;
};

/** @internal Applies renderer availability to the retained Canvas frame loop. */
export const applyCanvasRendererLifecycle = (
  frameLoop: FrameLoop,
  reportError: (error: Error) => void,
  snapshot: RoyalRendererRootLifecycleSnapshot,
): void => {
  const available = snapshot.lifecycle === "available";
  frameLoop.setPaused(!available);
  if (snapshot.lifecycle === "failed") {
    reportError(new Error(snapshot.error ?? "Royal renderer context restoration failed"));
  }
};

/** @internal Normalizes opaque scheduled-render failures for React ErrorBoundary handling. */
export const applyCanvasRendererFailure = (
  reportError: (error: Error) => void,
  failure: unknown,
): void => {
  const detail = failure === null
    ? "null"
    : typeof failure === "string"
      || typeof failure === "number"
      || typeof failure === "boolean"
      || typeof failure === "bigint"
      || typeof failure === "symbol"
      ? String(failure)
      : "an opaque non-Error value";
  reportError(failure instanceof Error
    ? failure
    : new Error(failure === undefined
      ? "Royal scheduled render failed without an error value"
      : `Royal scheduled render failed: ${detail}`));
};

/** @internal Releases Canvas ownership before entering fallible renderer cleanup. */
export const disposeCanvasRendererRoot = (
  rootRef: MutableRefObject<RoyalRendererRoot | null>,
  root: RoyalRendererRoot,
): void => {
  if (rootRef.current === root) rootRef.current = null;
  root.dispose();
};

/** Returns a stable callback that requests one render of the current Canvas root. */
export const useInvalidate = (): (() => void) => {
  const root = useCanvasRoot();

  return useCallback(() => {
    root?.invalidate();
  }, [root]);
};

export const useCanvasPick = (): ((input: PickInput) => PickResult | undefined) => {
  const root = useCanvasRoot();

  return useCallback((input: PickInput): PickResult | undefined =>
    root?.pick(input), [root]);
};

/** @internal Normalizes semantically empty Canvas context options. */
export const normalizeCanvasRendererOptions = (
  context: CanvasContextOptions | undefined,
): RoyalRendererRootOptions | undefined => {
  const alpha = context?.alpha;
  const antialias = context?.antialias;
  const generatedRasterVirtualTextures = context?.generatedRasterVirtualTextures;
  const generatedSvgVirtualTextureRasterDensity = context?.generatedSvgVirtualTextureRasterDensity;
  const resourceGovernorPolicy = context?.resourceGovernorPolicy;
  const virtualTexturePhysicalByteBudget = context?.virtualTexturePhysicalByteBudget;
  if (
    alpha === undefined
    && antialias === undefined
    && generatedRasterVirtualTextures === undefined
    && generatedSvgVirtualTextureRasterDensity === undefined
    && resourceGovernorPolicy === undefined
    && virtualTexturePhysicalByteBudget === undefined
  ) return undefined;

  return {
    context: {
      ...(alpha === undefined ? {} : { alpha }),
      ...(antialias === undefined ? {} : { antialias }),
      ...(generatedRasterVirtualTextures === undefined
        ? {}
        : { generatedRasterVirtualTextures }),
      ...(generatedSvgVirtualTextureRasterDensity === undefined
        ? {}
        : { generatedSvgVirtualTextureRasterDensity }),
      ...(resourceGovernorPolicy === undefined ? {} : { resourceGovernorPolicy }),
      ...(virtualTexturePhysicalByteBudget === undefined
        ? {}
        : { virtualTexturePhysicalByteBudget }),
    },
  };
};

const resourceGovernorPolicySignature = (
  policy: RoyalRendererRootContextOptions["resourceGovernorPolicy"],
): string | undefined => policy === undefined ? undefined : [
  ...(["asset-decode", "geometry", "ordinary-texture", "render-target", "virtual-texture"] as const)
    .flatMap((resourceClass) => {
      const value = policy.classes[resourceClass];
      return [
        value.cpuDecodedBytes.mandatoryFloor,
        value.cpuDecodedBytes.softLimit,
        value.persistentGpuBytes.mandatoryFloor,
        value.persistentGpuBytes.softLimit,
      ];
    }),
  policy.limits.cpuDecodedBytes,
  policy.limits.jobs,
  policy.limits.persistentGpuBytes,
  policy.limits.transientPeakBytes,
  policy.limits.uploadBytes,
].join(":");

const assignCanvasRef = (
  ref: Ref<HTMLCanvasElement> | undefined,
  canvas: HTMLCanvasElement | null,
): void => {
  if (ref === undefined || ref === null) return;

  if (typeof ref === "function") {
    ref(canvas);
    return;
  }

  ref.current = canvas;
};

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
  let nextPointerMoveOrder = 0;
  let pointerMoveFrame: number | undefined;
  const pendingPointerMoves = new Map<number, {
    readonly event: PointerEvent;
    readonly order: number;
  }>();
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
    const pending = Array.from(pendingPointerMoves.values())
      .sort((left, right) => left.order - right.order);
    pendingPointerMoves.clear();
    for (const { event } of pending) {
      applyPointerInteraction(event, {
        picked: pickedTargetAt(event),
        type: "pointermove",
      });
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
    pendingPointerMoves.set(event.pointerId, {
      event,
      order: nextPointerMoveOrder,
    });
    nextPointerMoveOrder += 1;
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

/** Renders one pure Royal scene into a Royal-owned canvas element. */
export const Canvas = ({
  children,
  interactions,
  ref,
  context,
  scene,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRootRef = useRef<RoyalRendererRoot | null>(null);
  const rendererFrameClockRef = useRef<RoyalRendererFrameClock | undefined>(undefined);
  const [rootError, setRootError] = useState<unknown>(null);
  const frameLoop = useMemo(() => createFrameLoop((error) => {
    const failure = error ?? new Error("Royal frame callback failed without an error value");
    setRootError((current: unknown) => current ?? failure);
  }), []);
  const scenePickingIndex = useMemo(() => createRoyalScenePickingIndex(scene), [scene]);
  const sceneInteractions = useMemo(
    () => createRoyalScenePointerEventRegistry(scenePickingIndex, interactions),
    [interactions, scenePickingIndex],
  );
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [canvasRoot, setCanvasRoot] = useState<RoyalRendererRoot | null>(null);
  const contextAlpha = context?.alpha;
  const contextAntialias = context?.antialias;
  const contextGeneratedRasterVirtualTextures = context?.generatedRasterVirtualTextures;
  const contextGeneratedSvgVirtualTextureRasterDensity = context?.generatedSvgVirtualTextureRasterDensity;
  const suppliedResourceGovernorPolicy = context?.resourceGovernorPolicy;
  const resourceGovernorPolicyKey = resourceGovernorPolicySignature(suppliedResourceGovernorPolicy);
  const resourceGovernorPolicyRef = useRef<{
    readonly key: string;
    readonly policy: NonNullable<RoyalRendererRootContextOptions["resourceGovernorPolicy"]>;
  } | undefined>(undefined);
  if (resourceGovernorPolicyKey === undefined) resourceGovernorPolicyRef.current = undefined;
  else if (
    suppliedResourceGovernorPolicy !== undefined
    && resourceGovernorPolicyRef.current?.key !== resourceGovernorPolicyKey
  ) {
    resourceGovernorPolicyRef.current = {
      key: resourceGovernorPolicyKey,
      policy: suppliedResourceGovernorPolicy,
    };
  }
  const contextResourceGovernorPolicy = resourceGovernorPolicyRef.current?.policy;
  const contextVirtualTexturePhysicalByteBudget = context?.virtualTexturePhysicalByteBudget;
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    setCanvasElement(canvas);
    assignCanvasRef(ref, canvas);
  }, [ref]);

  const memoizedRendererOptions = useMemo(
    () => normalizeCanvasRendererOptions({
      ...(contextAlpha === undefined ? {} : { alpha: contextAlpha }),
      ...(contextAntialias === undefined ? {} : { antialias: contextAntialias }),
      ...(contextGeneratedRasterVirtualTextures === undefined
        ? {}
        : { generatedRasterVirtualTextures: contextGeneratedRasterVirtualTextures }),
      ...(contextGeneratedSvgVirtualTextureRasterDensity === undefined
        ? {}
        : { generatedSvgVirtualTextureRasterDensity: contextGeneratedSvgVirtualTextureRasterDensity }),
      ...(contextResourceGovernorPolicy === undefined
        ? {}
        : { resourceGovernorPolicy: contextResourceGovernorPolicy }),
      ...(contextVirtualTexturePhysicalByteBudget === undefined
        ? {}
        : { virtualTexturePhysicalByteBudget: contextVirtualTexturePhysicalByteBudget }),
    }),
    [
      contextAlpha,
      contextAntialias,
      contextGeneratedRasterVirtualTextures,
      contextGeneratedSvgVirtualTextureRasterDensity,
      contextResourceGovernorPolicy,
      contextVirtualTexturePhysicalByteBudget,
    ],
  );
  const canvasElementNode = createElement("canvas", {
    ...canvasProps,
    ref: setCanvasRef,
  });

  const pointerInteractionStateRef = useRef(createCanvasPointerInteractionState());
  const sceneInteractionsRef = useRef(sceneInteractions);
  const lastPointerEventRef = useRef<PointerEvent | undefined>(undefined);

  useLayoutEffect(() => {
    reconcileCanvasPointerInteractionScene({
      lastPointerEventRef,
      pointerInteractionStateRef,
      sceneInteractions,
      sceneInteractionsRef,
    });
  }, [sceneInteractions]);

  useLayoutEffect(() => () => {
    frameLoop.dispose();
  }, [frameLoop]);

  useLayoutEffect(() => frameLoop.afterFrame(() => {
    const rendererFrameClock = rendererFrameClockRef.current;
    if (rendererFrameClock === undefined) canvasRoot?.flushInvalidated();
    else rendererFrameClock.flushInvalidated();
  }), [canvasRoot, frameLoop]);

  useLayoutEffect(() => {
    if (canvasRoot === null) return undefined;
    return canvasRoot.observeLifecycle((snapshot) => {
      applyCanvasRendererLifecycle(frameLoop, (failure) => {
        setRootError((current: unknown) => current ?? failure);
      }, snapshot);
    });
  }, [canvasRoot, frameLoop]);

  useLayoutEffect(() => {
    if (canvasRoot === null) return undefined;
    return canvasRoot.observeRenderFailures((failure) => {
      applyCanvasRendererFailure((error) => {
        setRootError((current: unknown) => current ?? error);
      }, failure);
    });
  }, [canvasRoot]);

  // Exactly one window-frame scheduler owns a Canvas at a time. A static
  // Canvas leaves demand scheduling with the renderer; the first useFrame
  // subscriber takes ownership until the active run ends.
  useLayoutEffect(() => {
    if (canvasRoot === null) return undefined;

    const stopObserving = frameLoop.observeActivity((active) => {
      if (active) {
        rendererFrameClockRef.current ??= acquireExternalRenderClockForRoyalRoot(canvasRoot);
      } else {
        rendererFrameClockRef.current?.release();
        rendererFrameClockRef.current = undefined;
      }
    });

    return () => {
      stopObserving();
      rendererFrameClockRef.current?.release();
      rendererFrameClockRef.current = undefined;
    };
  }, [canvasRoot, frameLoop]);

  // React owns the canvas element; Royal owns its WebGL root.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) throw new Error("Canvas ref was not attached");

    let root: RoyalRendererRoot;
    try {
      root = createRendererRoot(canvas, memoizedRendererOptions);
      rendererRootRef.current = root;
      setRootError(null);
    } catch (error) {
      rendererRootRef.current = null;
      setCanvasRoot(null);
      setRootError(error);
      return undefined;
    }
    setCanvasRoot(root);

    return () => {
      disposeCanvasRendererRoot(rendererRootRef, root);
    };
  }, [memoizedRendererOptions]);

  useLayoutEffect(() => {
    if (rootError === null && canvasRoot !== null) canvasRoot.render(scene);
  }, [canvasRoot, rootError, scene]);

  useLayoutEffect(() => {
    const canvas = canvasElement;
    const root = canvasRoot;
    if (canvas === null || root === null) return undefined;

    return attachCanvasPointerEventHandlers({
      canvas,
      lastPointerEventRef,
      pointerInteractionStateRef,
      sceneInteractionsRef,
      root,
    });
  }, [
    canvasElement,
    canvasRoot,
  ]);

  if (rootError !== null) {
    throw rootError;
  }

  return createElement(
    FrameLoopContext.Provider,
    { value: frameLoop },
    createElement(
      CanvasElementContext.Provider,
      { value: canvasElement },
      createElement(
        CanvasRootContext.Provider,
        { value: canvasRoot },
        canvasElementNode,
        children,
      ),
    ),
  );
};
