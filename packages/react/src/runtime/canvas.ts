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
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from "react";

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
  /** Complete immutable renderer intent. */
  readonly scene: RenderRoot;
}

type CanvasRuntime = Readonly<{
  error: unknown;
  root: RoyalRendererRoot | null;
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

const readCssSize = (canvas: HTMLCanvasElement, root: RoyalRendererRoot): void => {
  const box = canvas.getBoundingClientRect();
  const candidateDpr = globalThis.devicePixelRatio;
  root.setSize({
    cssHeight: box.height,
    cssWidth: box.width,
    devicePixelRatio: Number.isFinite(candidateDpr) && candidateDpr > 0 ? candidateDpr : 1,
  });
};

const observeCanvasSize = (
  canvas: HTMLCanvasElement,
  root: RoyalRendererRoot,
): (() => void) => {
  const update = (): void => readCssSize(canvas, root);
  update();
  const ResizeObserverConstructor = globalThis.ResizeObserver;
  const observer = typeof ResizeObserverConstructor === "function"
    ? new ResizeObserverConstructor(update)
    : undefined;
  observer?.observe(canvas);
  globalThis.addEventListener?.("resize", update);
  return () => {
    observer?.disconnect();
    globalThis.removeEventListener?.("resize", update);
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
  ...canvasProps
}: CanvasProps): ReactNode => {
  const optionsKey = rendererRootOptionsSemanticKey(rendererOptions);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [runtime, setRuntime] = useState<CanvasRuntime>(EMPTY_RUNTIME);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const attachCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element;
    setCanvas(element);
    const releaseExternalRef = assignRef(ref, element);
    if (element === null) return releaseExternalRef;
    return () => {
      if (canvasRef.current === element) {
        canvasRef.current = null;
        setCanvas(null);
      }
      if (releaseExternalRef === undefined) assignRef(ref, null);
      else releaseExternalRef();
    };
  }, [ref]);

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
