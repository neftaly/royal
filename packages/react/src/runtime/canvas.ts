import type { PickInput, PickResult, Scene } from "@royal/renderer-core";
import {
  createRendererRoot,
  resolveRendererRootOptions,
  type RendererRootOptions,
  type ResolvedRendererRootOptions,
  type RendererRoot,
} from "@royal/renderer-webgl";
import {
  createElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from "react";
import {
  CanvasElementContext,
  CanvasRootContext,
  useCanvasRoot,
} from "./canvas-context";
import { createCanvasPointerInteractionState } from "../interaction/canvas-pointer-interaction";
import {
  attachCanvasPointerEventHandlers,
  reconcileCanvasPointerInteractionScene,
  type CanvasLastPointerEventRef,
  type CanvasPointerInteractionStateRef,
  type CanvasSceneInteractionsRef,
} from "../interaction/canvas-pointer-events";
import {
  createScenePickingIndex,
  createScenePointerEventRegistry,
  type ScenePointerEvents,
} from "../interaction/scene-interactions";

export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children" | "height" | "width"> {
  readonly [dataAttribute: `data-${string}`]: string | number | boolean | null | undefined;
  /** Ordinary React controls and application UI rendered under Canvas context. */
  readonly children?: ReactNode;
  /** The owned canvas element. CSS, rather than intrinsic dimensions, owns layout size. */
  readonly ref?: Ref<HTMLCanvasElement>;
  /** Backing pixels per CSS pixel. Defaults to the browser device pixel ratio. */
  readonly pixelRatio?: number;
  /** Immutable WebGL creation options. A semantic change replaces the canvas and root. */
  readonly rendererOptions?: RendererRootOptions;
  /** Active root, or `null` before mount and after release. */
  readonly rendererRef?: Ref<RendererRoot>;
  /** React handlers keyed by one stable `pickingId` declared in the scene. */
  readonly scenePointerEvents?: ScenePointerEvents;
  /** Complete readonly renderer intent. */
  readonly scene: Scene;
}

type CanvasRuntime = Readonly<{
  canvas: HTMLCanvasElement | null;
  error: unknown;
  root: RendererRoot | null;
}>;

type CanvasAttachment = Readonly<{
  canvas: HTMLCanvasElement;
  options: ResolvedRendererRootOptions;
  optionsKey: string;
}>;

const EMPTY_RUNTIME: CanvasRuntime = { canvas: null, error: null, root: null };

/** Private identity for exact immutable root-creation semantics. */
const rendererRootOptionsKey = (options: ResolvedRendererRootOptions): string =>
  `${options.alpha ? 1 : 0}${options.antialias ? 1 : 0}${options.automaticVirtualTexturing ? 1 : 0}:${options.persistentGpuByteBudget}:${options.maxConcurrentPreparationJobs}:${options.ordinaryTextureUploadByteBudgetPerFrame}`;

/** A root belongs only to the exact canvas generation that created it. */
const activeCanvasRuntime = (
  runtime: CanvasRuntime,
  canvas: HTMLCanvasElement | null,
): CanvasRuntime => runtime.canvas === canvas ? runtime : EMPTY_RUNTIME;

/** @internal Pure ownership check used by the React lifecycle shell. */
export const selectOwnedCanvasRoot = <Root,>(
  ownerCanvas: HTMLCanvasElement | null,
  currentCanvas: HTMLCanvasElement | null,
  ownedRoot: Root | null,
  liveRoot: Root | null,
): Root | null => ownerCanvas === currentCanvas && ownedRoot === liveRoot ? ownedRoot : null;

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

const publishCanvasSize = (
  root: RendererRoot,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number | undefined,
): void => {
  root.setSize({
    cssHeight,
    cssWidth,
    devicePixelRatio: pixelRatio ?? (globalThis.devicePixelRatio || 1),
  });
};

/** @internal Browser shell for CSS-size and DPR observation. */
export const observeCanvasSize = (
  canvas: HTMLCanvasElement,
  root: RendererRoot,
  pixelRatio?: number,
): (() => void) => {
  const ResizeObserverConstructor = globalThis.ResizeObserver;
  if (typeof ResizeObserverConstructor !== "function") {
    const update = (): void => {
      const box = canvas.getBoundingClientRect();
      publishCanvasSize(root, box.width, box.height, pixelRatio);
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
      publishCanvasSize(root, cssWidth, cssHeight, pixelRatio);
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

export { useCanvasElement, useCanvasRoot } from "./canvas-context";

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
  pixelRatio,
  ref,
  rendererOptions,
  rendererRef,
  scene,
  scenePointerEvents,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const resolvedOptions = resolveRendererRootOptions(rendererOptions);
  const optionsKey = rendererRootOptionsKey(resolvedOptions);
  const scenePickingIndex = useMemo(() => createScenePickingIndex(scene), [scene]);
  const sceneInteractions = useMemo(
    () => createScenePointerEventRegistry(scenePickingIndex, scenePointerEvents),
    [scenePickingIndex, scenePointerEvents],
  );
  const [attachment, setAttachment] = useState<CanvasAttachment | null>(null);
  const activeAttachment = attachment?.optionsKey === optionsKey ? attachment : null;
  const canvas = activeAttachment?.canvas ?? null;
  const [runtime, setRuntime] = useState<CanvasRuntime>(EMPTY_RUNTIME);
  const liveRootRef = useRef<RendererRoot | null>(null);
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
    setAttachment(element === null ? null : {
      canvas: element,
      options: resolvedOptions,
      optionsKey,
    });
    const releaseExternalRef = assignRef(ref, element);
    if (element === null) return releaseExternalRef;
    return () => {
      if (canvasRef.current === element) canvasRef.current = null;
      if (releaseExternalRef === undefined) assignRef(ref, null);
      else releaseExternalRef();
    };
  }, [optionsKey, ref]);

  useLayoutEffect(() => {
    if (activeAttachment === null) return undefined;
    const { canvas: ownedCanvas, options } = activeAttachment;
    let root: RendererRoot;
    try {
      root = createRendererRoot(ownedCanvas, options);
    } catch (error) {
      setRuntime({ canvas: ownedCanvas, error, root: null });
      return undefined;
    }
    liveRootRef.current = root;
    setRuntime({ canvas: ownedCanvas, error: null, root });
    return () => {
      if (liveRootRef.current === root) liveRootRef.current = null;
      root.dispose();
    };
  }, [activeAttachment]);

  const activeRuntime = activeCanvasRuntime(runtime, canvas);
  const activeRoot = selectOwnedCanvasRoot(
    activeRuntime.canvas,
    canvas,
    activeRuntime.root,
    liveRootRef.current,
  );

  useLayoutEffect(() => {
    const root = activeRoot;
    if (root === null) return undefined;
    return observeCanvasSize(root.canvas, root, pixelRatio);
  }, [activeRoot, pixelRatio]);

  useLayoutEffect(() => {
    if (activeRoot !== null && liveRootRef.current === activeRoot) activeRoot.setScene(scene);
  }, [activeRoot, scene]);

  useLayoutEffect(() => {
    reconcileCanvasPointerInteractionScene({
      lastPointerEventRef,
      pointerInteractionStateRef,
      sceneInteractions,
      sceneInteractionsRef,
    });
  }, [lastPointerEventRef, pointerInteractionStateRef, sceneInteractions, sceneInteractionsRef]);

  useLayoutEffect(() => {
    const root = activeRoot;
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
    activeRoot,
    sceneInteractions.hasPointerEventTargets,
    sceneInteractionsRef,
  ]);

  useLayoutEffect(() => {
    const releaseExternalRef = assignRef(rendererRef, activeRoot);
    return () => {
      if (releaseExternalRef === undefined) assignRef(rendererRef, null);
      else releaseExternalRef();
    };
  }, [activeRoot, rendererRef]);

  if (activeRuntime.error !== null) throw activeRuntime.error;

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
      { value: activeRoot },
      canvasNode,
      children,
    ),
  );
};
