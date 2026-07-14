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
  type Ref,
  type ReactNode,
} from "react";
import { useRendererRootRuntime } from "./canvas-renderer-runtime";
import {
  createCanvasPointerInteractionState,
} from "./canvas-pointer-interaction";
import {
  attachCanvasPointerEventHandlers,
  reconcileCanvasPointerInteractionScene,
} from "./canvas-pointer-events";
import { FrameLoopContext } from "./frame";
import {
  createRoyalScenePickingIndex,
  createRoyalScenePointerEventRegistry,
  type ScenePointerEvents,
} from "./scene-interactions";
import type {
  RendererOptions,
  RoyalRendererRoot,
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
export {
  applyCanvasRendererFailure,
  applyCanvasRendererLifecycle,
  disposeCanvasRendererRoot,
  normalizeCanvasRendererOptions,
} from "./canvas-renderer-runtime";

/** Props for the Royal-owned canvas element. */
export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children"> {
  /** Ordinary React controls and imperative controllers rendered under Canvas context. */
  readonly children?: ReactNode;
  /** React-owned pointer handlers keyed by stable `pickingId` values in the pure scene. */
  readonly scenePointerEvents?: ScenePointerEvents;
  readonly ref?: Ref<HTMLCanvasElement>;
  /**
   * Renderer creation options. Changing a value disposes and recreates the
   * renderer root.
   */
  readonly rendererOptions?: RendererOptions;
  /** Pure renderer data, eagerly lowered before Canvas renders. */
  readonly scene: RenderRoot;
}

export const useCanvasElement = (): HTMLCanvasElement | null => {
  const canvas = useContext(CanvasElementContext);
  if (canvas === undefined) {
    throw new Error("useCanvasElement must be used inside <Canvas>");
  }

  return canvas;
};

export const useCanvasRoot = (): RoyalRendererRoot | null => {
  const root = useContext(CanvasRootContext);
  if (root === undefined) {
    throw new Error("useCanvasRoot must be used inside <Canvas>");
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

/** Returns a stable picker that accepts DOM client coordinates for this Canvas. */
export const useCanvasPick = (): ((input: PickInput) => PickResult | undefined) => {
  const root = useCanvasRoot();

  return useCallback((input: PickInput): PickResult | undefined =>
    root?.pick(input), [root]);
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
  scenePointerEvents,
  ref,
  rendererOptions,
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
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    setCanvasElement(canvas);
    assignCanvasRef(ref, canvas);
  }, [ref]);

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
