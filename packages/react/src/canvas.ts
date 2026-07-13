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
  createCanvasPointerInteractionState,
} from "./canvas-pointer-interaction";
import {
  attachCanvasPointerEventHandlers,
  reconcileCanvasPointerInteractionScene,
} from "./canvas-pointer-events";
import { createFrameLoop, FrameLoopContext, type FrameLoop } from "./frame";
import {
  createRoyalScenePickingIndex,
  createRoyalScenePointerEventRegistry,
  type CanvasInteractions,
} from "./scene-interactions";
import {
  acquireExternalRenderClockForRoyalRoot,
  createRendererRoot,
  rendererRootContextOptionsSemanticKey,
  type RoyalRendererRoot,
  type RoyalRendererFrameClock,
  type RoyalRendererRootLifecycleSnapshot,
  type RoyalRendererRootContextOptions,
  type RoyalRendererRootOptions,
} from "./root";

const CanvasElementContext = createContext<HTMLCanvasElement | null | undefined>(undefined);
const CanvasRootContext = createContext<RoyalRendererRoot | null | undefined>(undefined);

export {
  attachCanvasPointerEventHandlers,
  reconcileCanvasPointerInteractionScene,
} from "./canvas-pointer-events";
export type {
  CanvasLastPointerEventRef,
  CanvasPointerEventBindings,
  CanvasPointerInteractionStateRef,
  CanvasSceneInteractionsRef,
} from "./canvas-pointer-events";

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
  if (context === undefined || Object.values(context).every((value) => value === undefined)) {
    return undefined;
  }
  return { context };
};

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
  const rendererOptionsKey = rendererRootContextOptionsSemanticKey(context);
  const rendererOptionsRef = useRef<{
    readonly key: string;
    readonly options: RoyalRendererRootOptions | undefined;
  } | undefined>(undefined);
  if (rendererOptionsRef.current?.key !== rendererOptionsKey) {
    rendererOptionsRef.current = {
      key: rendererOptionsKey,
      options: normalizeCanvasRendererOptions(context),
    };
  }
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    setCanvasElement(canvas);
    assignCanvasRef(ref, canvas);
  }, [ref]);

  const memoizedRendererOptions = rendererOptionsRef.current.options;
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
