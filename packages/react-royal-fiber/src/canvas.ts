import {
  RenderGraphKind,
  type RenderRoot,
} from "@royal/renderer-core";
import {
  createElement,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { createRoot, type ReactReglRoot, type ReactReglRootOptions } from "./root";

/** Props for the Royal-owned canvas element. */
export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children"> {
  /** Runtime-validated as a Royal scene. */
  readonly children: unknown;
  readonly rootOptions?: ReactReglRootOptions;
}

const isRenderRoot = (value: unknown): value is RenderRoot =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === RenderGraphKind.Scene;

/** Canvas component that renders one Royal scene child. */
export const Canvas = ({
  children,
  rootOptions,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<ReactReglRoot | undefined>(undefined);
  const sceneRef = useRef<RenderRoot | undefined>(undefined);

  // React owns the canvas element; Royal owns its WebGL root.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) throw new Error("Canvas ref was not attached");

    const root = createRoot(canvas, rootOptions);
    rootRef.current = root;

    return () => {
      root.unmount();
      rootRef.current = undefined;
      sceneRef.current = undefined;
    };
  }, [rootOptions]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === undefined) throw new Error("Canvas root was not created");
    if (!isRenderRoot(children))
      throw new Error("Canvas expects a renderer scene child");

    sceneRef.current = children;
    root.render(children);
  }, [children]);

  return createElement("canvas", { ...canvasProps, ref: canvasRef });
};
