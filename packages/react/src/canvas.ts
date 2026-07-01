import type { RenderRoot } from "@royal/renderer-core";
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
import { createFrameLoop, FrameLoopContext } from "./frame";
import type { RoyalRendererJsxElement } from "./jsx-runtime";
import { createRoot, type RoyalRoot, type RoyalRootOptions } from "./root";

type CanvasChild = ReactNode | RoyalRendererJsxElement;
type CanvasChildren = CanvasChild | readonly unknown[];

const CanvasElementContext = createContext<HTMLCanvasElement | null>(null);

export type CanvasRendererOptions = RoyalRootOptions;

/** Props for the Royal-owned canvas element. */
export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children"> {
  /** Runtime-validated as exactly one Royal scene, plus optional React-only side-effect children. */
  readonly children: CanvasChildren;
  readonly fallback?: ReactNode;
  readonly ref?: Ref<HTMLCanvasElement>;
  readonly renderer?: CanvasRendererOptions;
}

const isRenderRoot = (value: unknown): value is RenderRoot =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "scene";

const toCanvasChildArray = (value: CanvasChildren): readonly CanvasChild[] => {
  if (Array.isArray(value)) {
    return value.flatMap((child) => toCanvasChildArray(child as CanvasChildren));
  }

  return [value as CanvasChild];
};

const isEmptyCanvasChild = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  typeof value === "boolean" ||
  (typeof value === "string" && value.trim() === "");

const isRoyalRendererJsxElement = (value: unknown): value is RoyalRendererJsxElement =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value;

const describeCanvasChild = (value: unknown): string => {
  if (isRoyalRendererJsxElement(value)) {
    return `kind "${String(value.kind)}"`;
  }

  if (typeof value === "object" && value !== null && "$$typeof" in value) {
    return "React element";
  }

  return value === null ? "null" : typeof value;
};

const splitCanvasChildren = (
  children: CanvasChildren,
): {
  readonly controls: readonly ReactNode[];
  readonly sceneChild: RenderRoot;
} => {
  const sceneChildren: RenderRoot[] = [];
  const controls: ReactNode[] = [];

  for (const child of toCanvasChildArray(children)) {
    if (isRenderRoot(child)) {
      sceneChildren.push(child);
      continue;
    }

    if (isRoyalRendererJsxElement(child)) {
      throw new Error(`Canvas expects renderer scene children, not ${describeCanvasChild(child)}`);
    }

    if (!isEmptyCanvasChild(child)) {
      controls.push(child as ReactNode);
    }
  }

  if (sceneChildren.length !== 1) {
    throw new Error("Canvas expects exactly one renderer scene child");
  }

  const sceneChild = sceneChildren[0];
  if (sceneChild === undefined) {
    throw new Error("Canvas expects exactly one renderer scene child");
  }

  return { controls, sceneChild };
};

export const useCanvasElement = (): HTMLCanvasElement | null =>
  useContext(CanvasElementContext);

const toCanvasRootOptions = ({
  backend,
  context,
}: CanvasRendererOptions): RoyalRootOptions => ({
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

/** Canvas component that renders one Royal scene child. */
export const Canvas = ({
  children,
  fallback,
  ref,
  renderer,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<RoyalRoot | undefined>(undefined);
  const rootCreationErrorRef = useRef<unknown>(null);
  const frameLoop = useMemo(() => createFrameLoop(), []);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [rootError, setRootError] = useState<unknown>(null);
  const { controls, sceneChild } = splitCanvasChildren(children);
  const rendererBackend = renderer?.backend;
  const rendererContextAlpha = renderer?.context?.alpha;
  const rendererContextAntialias = renderer?.context?.antialias;
  const rendererContextPreserveDrawingBuffer = renderer?.context?.preserveDrawingBuffer;
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    setCanvasElement(canvas);
    assignCanvasRef(ref, canvas);
  }, [ref]);

  const memoizedRootOptions = useMemo(
    () => renderer === undefined
      ? undefined
      : toCanvasRootOptions({
        ...(rendererBackend === undefined ? {} : { backend: rendererBackend }),
        context: {
          ...(rendererContextAlpha === undefined ? {} : { alpha: rendererContextAlpha }),
          ...(rendererContextAntialias === undefined ? {} : { antialias: rendererContextAntialias }),
          ...(rendererContextPreserveDrawingBuffer === undefined
            ? {}
            : { preserveDrawingBuffer: rendererContextPreserveDrawingBuffer }),
        },
      }),
    [
      rendererBackend,
      rendererContextAlpha,
      rendererContextAntialias,
      rendererContextPreserveDrawingBuffer,
    ],
  );
  const canvasElementNode = createElement("canvas", {
    ...canvasProps,
    hidden: rootError !== null && fallback !== undefined
      ? true
      : canvasProps.hidden,
    ref: setCanvasRef,
  });

  useLayoutEffect(() => () => {
    frameLoop.dispose();
  }, [frameLoop]);

  // React owns the canvas element; Royal owns its WebGL root.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) throw new Error("Canvas ref was not attached");

    let root: RoyalRoot;
    try {
      root = createRoot(canvas, memoizedRootOptions);
      rootCreationErrorRef.current = null;
      setRootError(null);
    } catch (error) {
      rootCreationErrorRef.current = error;
      rootRef.current = undefined;
      setRootError(error);
      return undefined;
    }
    rootRef.current = root;

    return () => {
      root.dispose();
      rootRef.current = undefined;
    };
  }, [memoizedRootOptions]);

  useLayoutEffect(() => {
    if (rootError !== null || rootCreationErrorRef.current !== null) return;
    const root = rootRef.current;
    if (root === undefined) throw new Error("Canvas root was not created");

    root.render(sceneChild);
  }, [rootError, sceneChild, memoizedRootOptions]);

  if (rootError !== null) {
    if (fallback !== undefined) {
      return createElement(
        FrameLoopContext.Provider,
        { value: frameLoop },
        createElement(
          CanvasElementContext.Provider,
          { value: canvasElement },
          fallback,
          canvasElementNode,
        ),
      );
    }

    throw rootError;
  }

  return createElement(
    FrameLoopContext.Provider,
    { value: frameLoop },
    createElement(
      CanvasElementContext.Provider,
      { value: canvasElement },
      canvasElementNode,
      ...controls,
    ),
  );
};
