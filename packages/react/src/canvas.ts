import type { RenderRoot } from "@royal/renderer-core";
import {
  createElement,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { createRoot, type RoyalRoot, type RoyalRootOptions } from "./root";

/** Props for the Royal-owned canvas element. */
export interface CanvasProps
  extends Omit<ComponentPropsWithoutRef<"canvas">, "children"> {
  /** Runtime-validated as a Royal scene for JavaScript callers. */
  readonly children: RenderRoot;
  readonly rootOptions?: RoyalRootOptions;
}

const isRenderRoot = (value: unknown): value is RenderRoot =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "scene";

/** Canvas component that renders one Royal scene child. */
export const Canvas = ({
  children,
  rootOptions,
  ...canvasProps
}: CanvasProps): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<RoyalRoot | undefined>(undefined);

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
    if (!isRenderRoot(children))
      throw new Error("Canvas expects a renderer scene child");

    root.render(children);
  }, [children, rootOptions]);

  return createElement("canvas", { ...canvasProps, ref: canvasRef });
};
