import type { PickInput, PickResult, RenderRoot } from "@royal/renderer-core";
import {
  createRendererRoot,
  rendererRootOptionsSemanticKey,
  type RendererRootOptions,
  type RoyalRendererRoot,
} from "@royal/renderer-webgl";
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
  type ReactNode,
  type Ref,
} from "react";
import { createCanvasPointerInteractionState } from "../interaction/canvas-pointer-interaction";
import {
  attachCanvasPointerEventHandlers,
  reconcileCanvasPointerInteractionScene,
  type CanvasLastPointerEventRef,
  type CanvasPointerInteractionStateRef,
  type CanvasSceneInteractionsRef,
} from "../interaction/canvas-pointer-events";
import {
  createRoyalScenePickingIndex,
  createRoyalScenePointerEventRegistry,
  type ScenePointerEvents,
} from "../interaction/scene-interactions";

const CanvasElementContext = createContext<HTMLCanvasElement | null | undefined>(undefined);
const CanvasRootContext = createContext<RoyalRendererRoot | null | undefined>(undefined);

export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children" | "height" | "width"> {
  readonly [dataAttribute: `data-${string}`]: string | number | boolean | null | undefined;
  /** Ordinary React controls and application UI rendered under Canvas context. */
  readonly children?: ReactNode;
  /** The owned canvas element. CSS, rather than intrinsic dimensions, owns layout size. */
  readonly ref?: Ref<HTMLCanvasElement>;
  /** Immutable WebGL creation options. A semantic change replaces the canvas and root. */
  readonly rendererOptions?: RendererRootOptions;
  /** Active root, or `null` before mount and after release. */
  readonly rendererRef?: Ref<RoyalRendererRoot>;
  /** React handlers keyed by one stable `pickingId` declared in the scene. */
  readonly scenePointerEvents?: ScenePointerEvents;
  /** Complete readonly renderer intent. */
  readonly scene: RenderRoot;
}

type CanvasRuntime = Readonly<{
  error: unknown;
  root: RoyalRendererRoot | null;
}>;

type CanvasAttachment = Readonly<{
  canvas: HTMLCanvasElement;
  optionsKey: string;
}>;

const EMPTY_RUNTIME: CanvasRuntime = { error: null, root: null };

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

const readDevicePixelRatio = (): number => {
  const candidateDpr = globalThis.devicePixelRatio;
  return Number.isFinite(candidateDpr) && candidateDpr > 0 ? candidateDpr : 1;
};

const publishCanvasSize = (
  root: RoyalRendererRoot,
  cssWidth: number,
  cssHeight: number,
): void => {
  root.setSize({
    cssHeight,
    cssWidth,
    devicePixelRatio: readDevicePixelRatio(),
  });
};

/** @internal Browser shell for CSS-size and DPR observation. */
export const observeCanvasSize = (
  canvas: HTMLCanvasElement,
  root: RoyalRendererRoot,
): (() => void) => {
  const ResizeObserverConstructor = globalThis.ResizeObserver;
  if (typeof ResizeObserverConstructor !== "function") {
    const update = (): void => {
      const box = canvas.getBoundingClientRect();
      publishCanvasSize(root, box.width, box.height);
    };
    update();
    globalThis.addEventListener?.("resize", update);
    return () => globalThis.removeEventListener?.("resize", update);
  }
  let cssHeight = 0;
  let cssWidth = 0;
  let frame: number | undefined;
  const schedulePublication = (): void => {
    if (frame !== undefined) return;
    frame = globalThis.requestAnimationFrame(() => {
      frame = undefined;
      publishCanvasSize(root, cssWidth, cssHeight);
    });
  };
  const observer = new ResizeObserverConstructor((entries) => {
    const entry = entries[entries.length - 1];
    if (entry === undefined) return;
    cssHeight = entry.contentRect.height;
    cssWidth = entry.contentRect.width;
    schedulePublication();
  });
  observer.observe(canvas);
  globalThis.addEventListener?.("resize", schedulePublication);
  return () => {
    if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
    observer.disconnect();
    globalThis.removeEventListener?.("resize", schedulePublication);
  };
};

/** Returns the surrounding canvas, or `null` before its ref is attached. */
export const useCanvasElement = (): HTMLCanvasElement | null => {
  const canvas = useContext(CanvasElementContext);
  if (canvas === undefined) throw new Error("useCanvasElement must be used inside <Canvas>");
  return canvas;
};

/** @internal Context probe for focused hooks that also accept an explicit root. */
export const useOptionalCanvasRoot = (): RoyalRendererRoot | null | undefined =>
  useContext(CanvasRootContext);

/** Returns the surrounding renderer root, or `null` during its mount lifecycle. */
export const useCanvasRoot = (): RoyalRendererRoot | null => {
  const root = useOptionalCanvasRoot();
  if (root === undefined) throw new Error("useCanvasRoot must be used inside <Canvas>");
  return root;
};

/** Requests one coalesced frame from the surrounding Canvas. */
export const useInvalidate = (): (() => void) => {
  const root = useCanvasRoot();
  return useCallback(() => root?.invalidate(), [root]);
};

/** Returns the Canvas root's exact picker; pre-mount calls have no hit. */
export const useCanvasPick = (): ((input: PickInput) => PickResult | undefined) => {
  const root = useCanvasRoot();
  return useCallback((input: PickInput) => root?.pick(input), [root]);
};

/** Renders one pure Royal scene into one ordinary, CSS-sized canvas. */
export const Canvas = ({
  children,
  ref,
  rendererOptions,
  rendererRef,
  scene,
  scenePointerEvents,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const optionsKey = rendererRootOptionsSemanticKey(rendererOptions);
  const scenePickingIndex = useMemo(() => createRoyalScenePickingIndex(scene), [scene]);
  const sceneInteractions = useMemo(
    () => createRoyalScenePointerEventRegistry(scenePickingIndex, scenePointerEvents),
    [scenePickingIndex, scenePointerEvents],
  );
  const [attachment, setAttachment] = useState<CanvasAttachment | null>(null);
  const canvas = attachment?.optionsKey === optionsKey ? attachment.canvas : null;
  const [runtime, setRuntime] = useState<CanvasRuntime>(EMPTY_RUNTIME);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pointerInteractionStateRef] = useState<CanvasPointerInteractionStateRef>(() => ({
    current: createCanvasPointerInteractionState(),
  }));
  const [sceneInteractionsRef] = useState<CanvasSceneInteractionsRef>(() => ({
    current: sceneInteractions,
  }));
  const [lastPointerEventRef] = useState<CanvasLastPointerEventRef>(() => ({
    current: undefined,
  }));

  const attachCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element;
    setAttachment(element === null ? null : { canvas: element, optionsKey });
    const releaseExternalRef = assignRef(ref, element);
    if (element === null) return releaseExternalRef;
    return () => {
      if (canvasRef.current === element) canvasRef.current = null;
      if (releaseExternalRef === undefined) assignRef(ref, null);
      else releaseExternalRef();
    };
  }, [optionsKey, ref]);

  useLayoutEffect(() => {
    if (canvas === null) return undefined;
    let root: RoyalRendererRoot;
    try {
      root = createRendererRoot(canvas, rendererOptions);
    } catch (error) {
      setRuntime({ error, root: null });
      return undefined;
    }
    setRuntime({ error: null, root });
    return () => root.dispose();
  }, [canvas, optionsKey]);

  useLayoutEffect(() => {
    const root = runtime.root;
    if (root === null) return undefined;
    return observeCanvasSize(root.canvas, root);
  }, [runtime.root]);

  useLayoutEffect(() => {
    runtime.root?.render(scene);
  }, [runtime.root, scene]);

  useLayoutEffect(() => {
    reconcileCanvasPointerInteractionScene({
      lastPointerEventRef,
      pointerInteractionStateRef,
      sceneInteractions,
      sceneInteractionsRef,
    });
  }, [lastPointerEventRef, pointerInteractionStateRef, sceneInteractions, sceneInteractionsRef]);

  useLayoutEffect(() => {
    const root = runtime.root;
    if (canvas === null || root === null || !sceneInteractions.hasPointerEventTargets) {
      return undefined;
    }
    return attachCanvasPointerEventHandlers({
      canvas,
      lastPointerEventRef,
      pointerInteractionStateRef,
      root,
      sceneInteractionsRef,
    });
  }, [
    canvas,
    lastPointerEventRef,
    pointerInteractionStateRef,
    runtime.root,
    sceneInteractions.hasPointerEventTargets,
    sceneInteractionsRef,
  ]);

  useLayoutEffect(() => {
    const releaseExternalRef = assignRef(rendererRef, runtime.root);
    return () => {
      if (releaseExternalRef === undefined) assignRef(rendererRef, null);
      else releaseExternalRef();
    };
  }, [rendererRef, runtime.root]);

  if (runtime.error !== null) throw runtime.error;

  const canvasNode = createElement("canvas", {
    ...canvasProps,
    key: optionsKey,
    ref: attachCanvas,
    style: { display: "block", width: "100%", ...canvasProps.style },
  });
  return createElement(
    CanvasElementContext.Provider,
    { value: canvas },
    createElement(
      CanvasRootContext.Provider,
      { value: runtime.root },
      canvasNode,
      children,
    ),
  );
};
