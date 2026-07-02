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
import { createFrameLoop, FrameLoopContext } from "./frame";
import { isRoyalRendererJsxElement, type RoyalRendererJsxElement } from "./jsx-runtime";
import { createRoyalRendererTree } from "./renderer-tree";
import { createRoot, type RoyalRoot, type RoyalRootOptions } from "./root";

type CanvasChild = ReactNode | RoyalRendererJsxElement;
type CanvasChildren = CanvasChild | readonly CanvasChildren[];

const CanvasElementContext = createContext<HTMLCanvasElement | null>(null);
const CanvasRootContext = createContext<RoyalRoot | null>(null);

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

const splitCanvasChildren = (
  children: CanvasChildren,
): {
  readonly controls: readonly ReactNode[];
  readonly sceneChild: ReactNode | RenderRoot;
} => {
  const sceneChildren: (ReactNode | RenderRoot)[] = [];
  const controls: ReactNode[] = [];

  for (const child of toCanvasChildArray(children)) {
    if (
      isRenderRoot(child) ||
      isReactRendererScene(child) ||
      (sceneChildren.length === 0 && isValidElement(child))
    ) {
      sceneChildren.push(child);
      continue;
    }

    if (isRoyalRendererJsxElement(child)) {
      throw new Error(`Canvas expects renderer scene children, not ${describeCanvasChild(child)}`);
    }

    if (!isEmptyCanvasChild(child)) {
      controls.push(child);
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

export const useCanvasRoot = (): RoyalRoot | null =>
  useContext(CanvasRootContext);

export const useCanvasPick = (): ((input: PickInput) => PickResult | undefined) => {
  const root = useCanvasRoot();

  return useCallback((input: PickInput): PickResult | undefined =>
    root?.pick(input), [root]);
};

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
  const rootCreationErrorRef = useRef<unknown>(null);
  const frameLoop = useMemo(() => createFrameLoop(), []);
  const rendererTree = useMemo(() => createRoyalRendererTree(), []);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [canvasRoot, setCanvasRoot] = useState<RoyalRoot | null>(null);
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
    rendererTree.dispose();
  }, [rendererTree]);

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
      setCanvasRoot(null);
      setRootError(error);
      return undefined;
    }
    setCanvasRoot(root);

    return () => {
      root.dispose();
      setCanvasRoot(null);
    };
  }, [memoizedRootOptions]);

  useLayoutEffect(() => {
    const hasRootError = rootError !== null || rootCreationErrorRef.current !== null;

    if (isRenderRoot(sceneChild)) {
      rendererTree.setTarget(canvasRoot, true);
      rendererTree.render(null);
      if (!hasRootError && canvasRoot !== null) {
        canvasRoot.render(sceneChild);
      }
      return;
    }

    rendererTree.setTarget(canvasRoot, hasRootError);
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
  }, [canvasElement, canvasRoot, frameLoop, rendererTree, rootError, sceneChild]);

  if (rootError !== null) {
    if (fallback !== undefined) {
      return createElement(
        FrameLoopContext.Provider,
        { value: frameLoop },
        createElement(
          CanvasElementContext.Provider,
          { value: canvasElement },
          createElement(
            CanvasRootContext.Provider,
            { value: canvasRoot },
            fallback,
            canvasElementNode,
          ),
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
      createElement(
        CanvasRootContext.Provider,
        { value: canvasRoot },
        canvasElementNode,
        ...controls,
      ),
    ),
  );
};
