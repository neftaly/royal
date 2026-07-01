import type { RenderRoot } from "@royal/renderer-core";
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
} from "react";
import { createRoot, type RoyalRoot, type RoyalRootOptions } from "./root";

type CanvasChild = ReactNode | RenderRoot;
type CanvasChildren = CanvasChild | CanvasChild[];

const CanvasElementContext = createContext<HTMLCanvasElement | null>(null);

/** Props for the Royal-owned canvas element. */
export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children"> {
  /** Runtime-validated as exactly one Royal scene, plus optional React-only side-effect children. */
  readonly children: CanvasChildren;
  readonly rootOptions?: RoyalRootOptions;
}

const isRenderRoot = (value: unknown): value is RenderRoot =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "scene";

const toCanvasChildArray = (value: CanvasChildren): readonly CanvasChild[] => {
  if (Array.isArray(value)) {
    return value;
  }

  return [value];
};

const isEmptyCanvasChild = (value: ReactNode | RenderRoot): boolean =>
  value === null ||
  value === undefined ||
  typeof value === "boolean" ||
  (typeof value === "string" && value.trim() === "");

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

/** Canvas component that renders one Royal scene child. */
export const Canvas = ({
  children,
  rootOptions,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<RoyalRoot | undefined>(undefined);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const { controls, sceneChild } = splitCanvasChildren(children);
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    setCanvasElement(canvas);
  }, []);

  // React owns the canvas element; Royal owns its WebGL root.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) throw new Error("Canvas ref was not attached");

    const root = createRoot(canvas, rootOptions);
    rootRef.current = root;

    return () => {
      root.dispose();
      rootRef.current = undefined;
    };
  }, [rootOptions]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === undefined) throw new Error("Canvas root was not created");

    root.render(sceneChild);
  }, [sceneChild, rootOptions]);

  return createElement(
    CanvasElementContext.Provider,
    { value: canvasElement },
    createElement("canvas", { ...canvasProps, ref: setCanvasRef }),
    ...controls,
  );
};
