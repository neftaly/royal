import {
  gltfAsset,
  type GltfAssetInput,
  type GltfAssetRef,
  type PickInput,
  type PickResult,
  type Scene,
  type SceneOverlay,
} from "@royal/renderer-core";
import {
  createRendererRoot,
  RendererContextCreationError,
  resolveRendererRootOptions,
  type RendererRootOptions,
  type ResolvedRendererRootOptions,
  type RendererRoot,
  type GltfAssetGeometryVisitor,
  type GltfResourceReader,
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
  useOptionalCanvasRoot,
} from "./canvas-context";
import {
  selectObservedRoot,
  type RendererHookOptions,
} from "../observation/select-root";
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

/** Props for the React-owned canvas, renderer root, scene, and pointer-event boundary. */
export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children" | "height" | "width"> {
  readonly [dataAttribute: `data-${string}`]: string | number | boolean | null | undefined;
  /** Ordinary React controls and application UI rendered under Canvas context. */
  readonly children?: ReactNode;
  /** The owned canvas element. CSS, rather than intrinsic dimensions, owns layout size. */
  readonly ref?: Ref<HTMLCanvasElement>;
  /** Backing pixels per CSS pixel. Defaults to the browser device pixel ratio. */
  readonly pixelRatio?: number;
  /** Independently replaceable, non-picking world geometry presented above the scene. */
  readonly overlay?: SceneOverlay;
  /** Stable root-scoped byte reader for glTF roots, buffers, and external images. */
  readonly gltfResourceReader?: GltfResourceReader;
  /**
   * Complete render-ready glTF preload claim without scene membership.
   * Geometry, metadata, and material images prepare through the ordinary lifecycle.
   */
  readonly gltfAssetClaims?: readonly GltfAssetInput[];
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
  gltfResourceReader: GltfResourceReader | undefined;
  options: ResolvedRendererRootOptions;
  optionsKey: string;
}>;

const EMPTY_RUNTIME: CanvasRuntime = { canvas: null, error: null, root: null };
const EMPTY_GLTF_ASSET_CLAIMS: readonly GltfAssetRef[] = [];

/** @internal Owns the listener gap around one renderer-root creation attempt. */
export const createCanvasRootRecovery = (
  canvas: HTMLCanvasElement,
  retry: () => void,
): Readonly<{ release(): void; waitForRestore(): void }> => {
  let armed = false;
  let interrupted = false;
  let restored = false;
  const retryAfterRestoration = (): void => {
    if (!armed || !restored) return;
    armed = false;
    restored = false;
    retry();
  };
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    interrupted = true;
    restored = false;
  };
  const onContextRestored = (): void => {
    if (!interrupted) return;
    interrupted = false;
    restored = true;
    retryAfterRestoration();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  return {
    release: () => {
      armed = false;
      interrupted = false;
      restored = false;
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
    },
    waitForRestore: () => {
      armed = true;
      retryAfterRestoration();
    },
  };
};

/** Private identity for exact immutable root-creation semantics. */
const rendererRootOptionsKey = (options: ResolvedRendererRootOptions): string =>
  `${options.alpha ? 1 : 0}${options.antialias ? 1 : 0}${options.automaticVirtualTexturing ? 1 : 0}:${options.persistentGpuByteBudget}`;

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
    pixelRatio: pixelRatio ?? (globalThis.devicePixelRatio || 1),
  });
};

/** @internal Validates explicit React resolution policy before any browser observer owns it. */
export const resolveCanvasPixelRatio = (pixelRatio: number | undefined): number | undefined => {
  if (pixelRatio === undefined) return undefined;
  if (!Number.isFinite(pixelRatio)) {
    throw new TypeError("Canvas pixelRatio must be finite");
  }
  if (pixelRatio <= 0) {
    throw new RangeError("Canvas pixelRatio must be greater than 0");
  }
  return pixelRatio;
};

/** @internal Browser shell for CSS-size and DPR observation. */
export const observeCanvasSize = (
  canvas: HTMLCanvasElement,
  root: RendererRoot,
  pixelRatio?: number,
): (() => void) => {
  const ResizeObserverConstructor = globalThis.ResizeObserver;
  if (typeof ResizeObserverConstructor !== "function") {
    throw new Error("Royal Canvas requires ResizeObserver");
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
  globalThis.addEventListener("resize", schedulePublication);
  return () => {
    if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
    observer.disconnect();
    globalThis.removeEventListener("resize", schedulePublication);
  };
};

export { useCanvasElement, useCanvasRoot } from "./canvas-context";

/** Requests one coalesced frame from the surrounding Canvas. */
export const useInvalidate = (options?: RendererHookOptions): (() => void) => {
  const root = selectObservedRoot(useOptionalCanvasRoot(), options, "useInvalidate");
  return useCallback(() => root?.invalidate(), [root]);
};

/** Returns the selected root's exact picker; pre-mount calls have no hit. */
export const useCanvasPick = (
  options?: RendererHookOptions,
): ((input: PickInput) => PickResult | undefined) => {
  const root = selectObservedRoot(useOptionalCanvasRoot(), options, "useCanvasPick");
  return useCallback((input: PickInput) => root?.pick(input), [root]);
};

/** Returns the selected root's cold, borrowed prepared-glTF geometry visitor. */
export const useVisitGltfAssetGeometry = (
  options?: RendererHookOptions,
): ((asset: GltfAssetRef, visitor: GltfAssetGeometryVisitor) => number | undefined) => {
  const root = selectObservedRoot(
    useOptionalCanvasRoot(),
    options,
    "useVisitGltfAssetGeometry",
  );
  return useCallback(
    (asset, visitor) => root?.visitGltfAssetGeometry(asset, visitor),
    [root],
  );
};

/** Renders one pure Royal scene into one ordinary, CSS-sized canvas. */
export const Canvas = ({
  children,
  gltfAssetClaims,
  gltfResourceReader,
  overlay,
  pixelRatio,
  ref,
  rendererOptions,
  rendererRef,
  scene,
  scenePointerEvents,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const resolvedPixelRatio = resolveCanvasPixelRatio(pixelRatio);
  const resolvedOptions = resolveRendererRootOptions(rendererOptions);
  const optionsKey = rendererRootOptionsKey(resolvedOptions);
  const scenePickingIndex = useMemo(() => createScenePickingIndex(scene), [scene]);
  const resolvedGltfAssetClaims = useMemo(
    () => gltfAssetClaims === undefined
      ? EMPTY_GLTF_ASSET_CLAIMS
      : gltfAssetClaims.map((asset) => gltfAsset(asset)),
    [gltfAssetClaims],
  );
  const sceneInteractions = useMemo(
    () => createScenePointerEventRegistry(scenePickingIndex, scenePointerEvents),
    [scenePickingIndex, scenePointerEvents],
  );
  const [attachment, setAttachment] = useState<CanvasAttachment | null>(null);
  const activeAttachment = attachment?.optionsKey === optionsKey ? attachment : null;
  const canvas = activeAttachment?.canvas ?? null;
  const [runtime, setRuntime] = useState<CanvasRuntime>(EMPTY_RUNTIME);
  const [creationAttempt, setCreationAttempt] = useState(0);
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
      gltfResourceReader,
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
  }, [gltfResourceReader, optionsKey, ref]);

  useLayoutEffect(() => {
    if (activeAttachment === null) return undefined;
    const { canvas: ownedCanvas, gltfResourceReader: reader, options } = activeAttachment;
    const recovery = createCanvasRootRecovery(
      ownedCanvas,
      () => setCreationAttempt((attempt) => attempt + 1),
    );
    let root: RendererRoot;
    try {
      root = createRendererRoot(
        ownedCanvas,
        options,
        reader === undefined ? {} : { gltfResourceReader: reader },
      );
    } catch (error) {
      if (
        error instanceof RendererContextCreationError
        && error.reason === "context-lost"
      ) {
        recovery.waitForRestore();
        setRuntime({ canvas: ownedCanvas, error: null, root: null });
        return recovery.release;
      }
      recovery.release();
      setRuntime({ canvas: ownedCanvas, error, root: null });
      return undefined;
    }
    recovery.release();
    liveRootRef.current = root;
    setRuntime({ canvas: ownedCanvas, error: null, root });
    return () => {
      if (liveRootRef.current === root) liveRootRef.current = null;
      root.dispose();
    };
  }, [activeAttachment, creationAttempt]);

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
    return observeCanvasSize(root.canvas, root, resolvedPixelRatio);
  }, [activeRoot, resolvedPixelRatio]);

  useLayoutEffect(() => {
    if (activeRoot !== null && liveRootRef.current === activeRoot) {
      activeRoot.setScene(scene, resolvedGltfAssetClaims);
    }
  }, [activeRoot, resolvedGltfAssetClaims, scene]);

  useLayoutEffect(() => {
    if (activeRoot !== null && liveRootRef.current === activeRoot) {
      activeRoot.setOverlay(overlay ?? null);
    }
  }, [activeRoot, overlay]);

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
