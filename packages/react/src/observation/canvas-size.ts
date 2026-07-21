import { useMemo } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import { useSizeSnapshot } from "./root-snapshot";
import {
  selectObservedRoot,
  type RendererHookOptions,
} from "./select-root";

export type CanvasSize = Readonly<{
  /** Width divided by height. */
  aspectRatio: number;
  /** Backing-store height after the requested ratio and capability limits. */
  backingHeight: number;
  /** Backing-store width after the requested ratio and capability limits. */
  backingWidth: number;
  /** CSS layout height in pixels. */
  cssHeight: number;
  /** CSS layout width in pixels. */
  cssWidth: number;
  /** Backing pixels requested per CSS pixel; matches `Canvas.pixelRatio` when supplied. */
  pixelRatio: number;
  /** Applied backing scale relative to the requested CSS-pixel resolution. */
  renderScale: number;
}>;

/** Observes the current CSS and backing dimensions; zero-area/pre-mount returns undefined. */
export const useCanvasSize = (
  options?: RendererHookOptions,
): CanvasSize | undefined => {
  const root = selectObservedRoot(useOptionalCanvasRoot(), options, "useCanvasSize");
  const size = useSizeSnapshot(root);
  return useMemo(() => {
    if (size === null || size === undefined || size.cssWidth === 0 || size.cssHeight === 0) {
      return undefined;
    }
    return {
      aspectRatio: size.cssWidth / size.cssHeight,
      backingHeight: size.backingHeight,
      backingWidth: size.backingWidth,
      cssHeight: size.cssHeight,
      cssWidth: size.cssWidth,
      pixelRatio: size.pixelRatio,
      renderScale: size.renderScale,
    };
  }, [size]);
};
