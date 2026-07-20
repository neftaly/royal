import { useMemo } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import { useSizeSnapshot } from "./root-snapshot";
import {
  selectObservedRoot,
  type RendererObservationOptions,
} from "./select-root";

export type CanvasSize = Readonly<{
  /** CSS layout height in pixels. */
  height: number;
  /** Width divided by height. */
  aspectRatio: number;
  /** Backing-store height after DPR and capability limits. */
  backingHeight: number;
  /** Backing-store width after DPR and capability limits. */
  backingWidth: number;
  /** Backing pixels requested per CSS pixel; matches `Canvas.pixelRatio` when supplied. */
  pixelRatio: number;
  /** Applied backing scale relative to the requested CSS-pixel resolution. */
  renderScale: number;
  /** CSS layout width in pixels. */
  width: number;
}>;

/** Observes the current CSS and backing dimensions; zero-area/pre-mount returns undefined. */
export const useCanvasSize = (
  options?: RendererObservationOptions,
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
      height: size.cssHeight,
      pixelRatio: size.devicePixelRatio,
      renderScale: size.renderScale,
      width: size.cssWidth,
    };
  }, [size]);
};
