import type { RenderRoot } from "@royal/renderer-core";
import type { PickInput, PickResult } from "@royal/renderer-core";
import {
  createContext,
  createElement,
  isValidElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type Ref,
  type ReactNode,
} from "react";
import {
  createCanvasPointerInteractionState,
  reduceCanvasPointerInteraction,
  type CanvasPickedPointerTarget,
  type CanvasPointerInteractionState,
  type CanvasPointerInteractionAction,
} from "./canvas-pointer-interaction";
import { createFrameLoop, FrameLoopContext } from "./frame";
import {
  isRenderRootDescriptor,
  isRoyalRendererJsxElement,
  type RoyalRendererJsxElement,
} from "./renderer-descriptor";
import {
  createRoyalPointerEvent,
  handlerForRoyalPointerEvent,
  type RoyalPointerEventType,
} from "./picking-events";
import { createRoyalRendererTree, type RoyalRendererTree } from "./renderer-tree";
import {
  createRendererRoot,
  type RoyalRendererRoot,
  type RoyalRendererRootOptions,
} from "./root";

type CanvasChild = ReactNode | RoyalRendererJsxElement;
type CanvasChildren = CanvasChild | readonly CanvasChildren[];

const CanvasElementContext = createContext<HTMLCanvasElement | null | undefined>(undefined);
const CanvasRootContext = createContext<RoyalRendererRoot | null | undefined>(undefined);

export type CanvasRendererOptions = RoyalRendererRootOptions;

/** Props for the Royal-owned canvas element. */
export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children"> {
  /** Runtime-validated as exactly one Royal scene, plus optional React-only side-effect children. */
  readonly children: CanvasChildren;
  readonly ref?: Ref<HTMLCanvasElement>;
  readonly renderer?: CanvasRendererOptions;
}

const isReactRendererScene = (value: unknown): value is ReactNode =>
  isValidElement(value) && value.type === "scene";

const isCanvasChildrenArray = (
  value: CanvasChildren,
): value is readonly CanvasChildren[] => Array.isArray(value);

const toCanvasChildArray = (value: CanvasChildren): readonly CanvasChild[] => {
  if (isCanvasChildrenArray(value)) {
    return value.flatMap(toCanvasChildArray);
  }

  return [value];
};

const isEmptyCanvasChild = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  typeof value === "boolean" ||
  (typeof value === "string" && value.trim() === "");

const describeCanvasChild = (value: unknown): string => {
  if (isRoyalRendererJsxElement(value)) {
    return `kind "${String(value.kind)}"`;
  }

  if (typeof value === "object" && value !== null && "$$typeof" in value) {
    return "React element";
  }

  return value === null ? "null" : typeof value;
};

export const resolveCanvasChildren = (
  children: CanvasChildren,
): {
  readonly controls: readonly ReactNode[];
  readonly sceneChild: ReactNode | RenderRoot;
} => {
  const explicitSceneChildren: (ReactNode | RenderRoot)[] = [];
  const implicitSceneCandidates: ReactNode[] = [];
  const nonSceneChildren: ReactNode[] = [];

  for (const child of toCanvasChildArray(children)) {
    if (isEmptyCanvasChild(child)) {
      continue;
    }

    if (isRenderRootDescriptor(child) || isReactRendererScene(child)) {
      explicitSceneChildren.push(child);
      continue;
    }

    if (isRoyalRendererJsxElement(child)) {
      throw new Error(`Canvas expects renderer scene children, not ${describeCanvasChild(child)}`);
    }

    if (isValidElement(child)) {
      implicitSceneCandidates.push(child);
    }

    nonSceneChildren.push(child);
  }

  if (explicitSceneChildren.length > 1) {
    throw new Error("Canvas expects exactly one renderer scene child");
  }

  const explicitSceneChild = explicitSceneChildren[0];
  if (explicitSceneChild !== undefined) {
    return { controls: nonSceneChildren, sceneChild: explicitSceneChild };
  }

  const implicitSceneChild = implicitSceneCandidates[0];
  if (
    implicitSceneChild !== undefined &&
    implicitSceneCandidates.length === 1 &&
    nonSceneChildren.length === 1
  ) {
    return { controls: [], sceneChild: implicitSceneChild };
  }

  throw new Error(
    "Canvas expects exactly one renderer scene child. Add an explicit <scene> when rendering React controls beside a scene component.",
  );
};

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

const toRendererRootOptions = ({ backend, context }: CanvasRendererOptions): RoyalRendererRootOptions => ({
  ...(backend === undefined ? {} : { backend }),
  ...(context === undefined ? {} : { context }),
});

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

export interface CanvasPointerEventBindings {
  readonly canvas: HTMLCanvasElement;
  readonly dispatchRoyalPointerEvent: (
    type: RoyalPointerEventType,
    nativeEvent: PointerEvent,
    picked: CanvasPickedPointerTarget,
  ) => void;
  readonly pointerInteractionStateRef: CanvasPointerInteractionStateRef;
  readonly rendererTree: Pick<RoyalRendererTree, "hasPointerEventTargets" | "pointerEventTarget">;
  readonly root: Pick<RoyalRendererRoot, "pick">;
}

export const attachCanvasPointerEventHandlers = ({
  canvas,
  dispatchRoyalPointerEvent,
  pointerInteractionStateRef,
  rendererTree,
  root,
}: CanvasPointerEventBindings): (() => void) => {
  const pickedTargetAt = (event: PointerEvent): CanvasPickedPointerTarget | undefined => {
    if (!rendererTree.hasPointerEventTargets()) return undefined;

    const hit = root.pick(event);
    if (hit === undefined) return undefined;

    const target = rendererTree.pointerEventTarget(hit.target.node);
    return target === undefined
      ? undefined
      : { hit, identity: target, node: hit.target.node, target };
  };
  const applyPointerInteraction = (
    event: PointerEvent,
    action: CanvasPointerInteractionAction,
  ): void => {
    const result = reduceCanvasPointerInteraction(pointerInteractionStateRef.current, action);
    pointerInteractionStateRef.current = result.state;
    for (const dispatch of result.dispatches) {
      dispatchRoyalPointerEvent(dispatch.type, event, dispatch.picked);
    }
  };

  const handlePointerMove = (event: PointerEvent): void => {
    applyPointerInteraction(event, {
      picked: pickedTargetAt(event),
      type: "pointermove",
    });
  };

  const handlePointerDown = (event: PointerEvent): void => {
    applyPointerInteraction(event, {
      picked: pickedTargetAt(event),
      pointerId: event.pointerId,
      type: "pointerdown",
    });
  };

  const handlePointerUp = (event: PointerEvent): void => {
    applyPointerInteraction(event, {
      button: event.button,
      picked: pickedTargetAt(event),
      pointerId: event.pointerId,
      type: "pointerup",
    });
  };

  const handlePointerLeave = (event: PointerEvent): void => {
    applyPointerInteraction(event, { type: "pointerleave" });
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    applyPointerInteraction(event, {
      pointerId: event.pointerId,
      type: "pointercancel",
    });
  };

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  return () => {
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointerleave", handlePointerLeave);
    canvas.removeEventListener("pointercancel", handlePointerCancel);
    pointerInteractionStateRef.current = reduceCanvasPointerInteraction(
      pointerInteractionStateRef.current,
      { type: "reset" },
    ).state;
  };
};

/** Canvas component that renders one Royal scene child. */
export const Canvas = ({
  children,
  ref,
  renderer,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameLoop = useMemo(() => createFrameLoop(), []);
  const rendererTree = useMemo(() => createRoyalRendererTree(), []);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [canvasRoot, setCanvasRoot] = useState<RoyalRendererRoot | null>(null);
  const [rootError, setRootError] = useState<unknown>(null);
  const { controls, sceneChild } = resolveCanvasChildren(children);
  const rendererOptions = renderer;
  const rendererContextAlpha = rendererOptions?.context?.alpha;
  const rendererContextAntialias = rendererOptions?.context?.antialias;
  const rendererContextPreserveDrawingBuffer = rendererOptions?.context?.preserveDrawingBuffer;
  const rendererBackend = rendererOptions?.backend;
  const hasRendererOptions = rendererOptions !== undefined;
  const hasRendererContext = rendererOptions?.context !== undefined;
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    setCanvasElement(canvas);
    assignCanvasRef(ref, canvas);
  }, [ref]);

  const memoizedRendererOptions = useMemo(
    () => !hasRendererOptions
      ? undefined
      : toRendererRootOptions({
        ...(hasRendererContext
          ? {
            context: {
              ...(rendererContextAlpha === undefined ? {} : { alpha: rendererContextAlpha }),
              ...(rendererContextAntialias === undefined ? {} : { antialias: rendererContextAntialias }),
              ...(rendererContextPreserveDrawingBuffer === undefined
                ? {}
                : { preserveDrawingBuffer: rendererContextPreserveDrawingBuffer }),
            },
          }
          : {}),
        ...(rendererBackend === undefined ? {} : { backend: rendererBackend }),
      }),
    [
      hasRendererContext,
      hasRendererOptions,
      rendererBackend,
      rendererContextAlpha,
      rendererContextAntialias,
      rendererContextPreserveDrawingBuffer,
    ],
  );
  const canvasElementNode = createElement("canvas", {
    ...canvasProps,
    ref: setCanvasRef,
  });

  const pointerInteractionStateRef = useRef(createCanvasPointerInteractionState());

  const dispatchRoyalPointerEvent = useCallback((
    type: RoyalPointerEventType,
    nativeEvent: PointerEvent,
    picked: CanvasPickedPointerTarget,
  ): void => {
    const target = rendererTree.pointerEventTarget(picked.node) ?? picked.target;
    const handler = handlerForRoyalPointerEvent(target, type);
    if (handler === undefined) return;

    handler(createRoyalPointerEvent({
      hit: picked.hit,
      nativeEvent,
      type,
    }));
  }, [rendererTree]);

  useLayoutEffect(() => () => {
    rendererTree.dispose();
  }, [rendererTree]);

  useLayoutEffect(() => () => {
    frameLoop.dispose();
  }, [frameLoop]);

  useLayoutEffect(() => frameLoop.afterFrame(() => {
    rendererTree.flushFrame();
    canvasRoot?.flushInvalidated();
  }), [canvasRoot, frameLoop, rendererTree]);

  // React owns the canvas element; Royal owns its WebGL root.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) throw new Error("Canvas ref was not attached");

    let root: RoyalRendererRoot;
    try {
      root = createRendererRoot(canvas, memoizedRendererOptions);
      setRootError(null);
    } catch (error) {
      setCanvasRoot(null);
      setRootError(error);
      return undefined;
    }
    setCanvasRoot(root);

    return () => {
      root.dispose();
      setCanvasRoot(null);
    };
  }, [memoizedRendererOptions]);

  useLayoutEffect(() => {
    const hasRootError = rootError !== null;

    if (isRenderRootDescriptor(sceneChild)) {
      rendererTree.setTarget(canvasRoot, true);
      rendererTree.render(null);
      if (!hasRootError && canvasRoot !== null) {
        canvasRoot.render(sceneChild);
      }
      return;
    }

    // Reconcile with drawing paused, then publish the latest descriptor graph
    // exactly once. This also hands a cached scene to a newly attached root
    // when React has no host changes to commit.
    rendererTree.setTarget(canvasRoot, true);
    rendererTree.render(createElement(
      FrameLoopContext.Provider,
      { value: frameLoop },
      createElement(
        CanvasElementContext.Provider,
        { value: canvasElement },
        createElement(
          CanvasRootContext.Provider,
          { value: canvasRoot },
          sceneChild,
        ),
      ),
    ));
    rendererTree.setTarget(canvasRoot, hasRootError);
  }, [canvasElement, canvasRoot, frameLoop, rendererTree, rootError, sceneChild]);

  useLayoutEffect(() => {
    const canvas = canvasElement;
    const root = canvasRoot;
    if (canvas === null || root === null) return undefined;

    return attachCanvasPointerEventHandlers({
      canvas,
      dispatchRoyalPointerEvent,
      pointerInteractionStateRef,
      rendererTree,
      root,
    });
  }, [
    canvasElement,
    canvasRoot,
    dispatchRoyalPointerEvent,
    rendererTree,
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
        ...controls,
      ),
    ),
  );
};
