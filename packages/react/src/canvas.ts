import { type PickInput, type PickResult, type RenderRoot } from "@royal/renderer-core";
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
  type Ref,
  type ReactNode,
} from "react";
import {
  canvasContextOptionsSemanticKey,
  useRendererRootRuntime,
} from "./canvas-renderer-runtime";
import {
  createCanvasPointerInteractionState,
} from "./interaction/canvas-pointer-interaction";
import {
  attachCanvasPointerEventHandlers,
  reconcileCanvasPointerInteractionScene,
} from "./interaction/canvas-pointer-events";
import { FrameLoopContext } from "./frame";
import {
  createRoyalScenePickingIndex,
  createRoyalScenePointerEventRegistry,
  type ScenePointerEvents,
} from "./interaction/scene-interactions";
import {
  type RendererOptions,
  type RoyalRendererRoot,
} from "./root";

const CanvasElementContext = createContext<HTMLCanvasElement | null | undefined>(undefined);
const CanvasRootContext = createContext<RoyalRendererRoot | null | undefined>(undefined);

/**
 * Props for the Royal-owned canvas element. Native DOM, ARIA, and `data-*`
 * props pass through; CSS owns layout size and Royal owns backing dimensions.
 */
export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children" | "height" | "width"> {
  readonly [dataAttribute: `data-${string}`]: string | number | boolean | null | undefined;
  /** Ordinary React controls and imperative controllers rendered under Canvas context. */
  readonly children?: ReactNode;
  /** React-owned pointer handlers keyed by stable `pickingId` values in the pure scene. */
  readonly scenePointerEvents?: ScenePointerEvents;
  /** The owned canvas element, with React 19 callback-ref cleanup semantics preserved. */
  readonly ref?: Ref<HTMLCanvasElement>;
  /**
   * Renderer creation options. Changing a value disposes and recreates the
   * renderer root. Changing `alpha` or `antialias` also replaces the canvas
   * element because browsers fix those attributes on its first WebGL context;
   * refs release the old element before receiving the replacement. Callback
   * refs that return a cleanup use that cleanup instead of a `null` call.
   */
  readonly rendererOptions?: RendererOptions;
  /** Active renderer root for parent-owned status, diagnostics, or imperative integration. */
  readonly rendererRef?: Ref<RoyalRendererRoot>;
  /** Pure renderer data, eagerly lowered before Canvas renders. */
  readonly scene: RenderRoot;
}

/** Returns the owned canvas, or `null` before it is attached. */
export const useCanvasElement = (): HTMLCanvasElement | null => {
  const canvas = useContext(CanvasElementContext);
  if (canvas === undefined) {
    throw new Error("useCanvasElement must be used inside <Canvas>");
  }

  return canvas;
};

/** @internal Context probe used by hooks that also accept an explicit root. */
export const useOptionalCanvasElement = (): HTMLCanvasElement | null | undefined =>
  useContext(CanvasElementContext);

/** Returns the active renderer root, or `null` while Canvas is creating it. */
export const useCanvasRoot = (): RoyalRendererRoot | null => {
  const root = useContext(CanvasRootContext);
  if (root === undefined) {
    throw new Error("useCanvasRoot must be used inside <Canvas>");
  }

  return root;
};

/** @internal Context probe used by hooks that also accept an explicit root. */
export const useOptionalCanvasRoot = (): RoyalRendererRoot | null | undefined =>
  useContext(CanvasRootContext);

/** Returns a stable callback that requests one render of the current Canvas root. */
export const useInvalidate = (): (() => void) => {
  const root = useCanvasRoot();

  return useCallback(() => {
    root?.invalidate();
  }, [root]);
};

/** Returns a stable picker accepting a DOM/React pointer event or its client coordinates. */
export const useCanvasPick = (): ((input: PickInput) => PickResult | undefined) => {
  const root = useCanvasRoot();

  return useCallback((input: PickInput): PickResult | undefined => {
    return root?.pick(input);
  }, [root]);
};

const assignRef = <Value>(
  ref: Ref<Value> | undefined,
  value: Value | null,
): (() => void) | undefined => {
  if (ref === undefined || ref === null) return undefined;

  if (typeof ref === "function") {
    const cleanup = ref(value);
    return typeof cleanup === "function" ? cleanup : undefined;
  }

  ref.current = value;
  return undefined;
};

/** Renders one pure Royal scene into a Royal-owned canvas element. */
export const Canvas = ({
  children,
  scenePointerEvents,
  ref,
  rendererOptions,
  rendererRef,
  scene,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    error: rootError,
    frameLoop,
    root: canvasRoot,
  } = useRendererRootRuntime(canvasRef, rendererOptions);
  const scenePickingIndex = useMemo(() => createRoyalScenePickingIndex(scene), [scene]);
  const sceneInteractions = useMemo(
    () => createRoyalScenePointerEventRegistry(scenePickingIndex, scenePointerEvents),
    [scenePickingIndex, scenePointerEvents],
  );
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const contextOptionsKey = canvasContextOptionsSemanticKey(rendererOptions);
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    setCanvasElement(canvas);
    const externalCleanup = assignRef(ref, canvas);
    if (canvas === null) return externalCleanup;
    return () => {
      canvasRef.current = null;
      setCanvasElement(null);
      if (externalCleanup === undefined) assignRef(ref, null);
      else externalCleanup();
    };
  }, [ref]);

  useLayoutEffect(() => {
    const externalCleanup = assignRef(rendererRef, canvasRoot);
    return () => {
      if (externalCleanup === undefined) assignRef(rendererRef, null);
      else externalCleanup();
    };
  }, [canvasRoot, rendererRef]);

  const canvasElementNode = createElement("canvas", {
    ...canvasProps,
    key: contextOptionsKey,
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
