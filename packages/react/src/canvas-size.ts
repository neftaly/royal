import { useMemo, useSyncExternalStore } from "react";
import { useCanvasElement } from "./canvas";
import { createObservedExternalStore, type ObservedExternalStore } from "./observed-external-store";

/** Current CSS layout size of the surrounding Canvas. */
export interface CanvasSize {
  /** CSS-pixel height. */
  readonly height: number;
  /** Width divided by height, suitable for camera projection and framing. */
  readonly aspectRatio: number;
  /** CSS-pixel width. */
  readonly width: number;
}

const UNAVAILABLE_CANVAS_SIZE = undefined;
const UNAVAILABLE_CANVAS_SIZE_STORE: ObservedExternalStore<CanvasSize | undefined> = Object.freeze({
  getSnapshot: () => UNAVAILABLE_CANVAS_SIZE,
  subscribe: () => () => undefined,
});

/** @internal Pure projection from a measured CSS box to the public snapshot. */
export const canvasSizeFromCssBox = (width: number, height: number): CanvasSize | undefined => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return Object.freeze({ aspectRatio: width / height, height, width });
};

const sameCanvasSize = (left: CanvasSize | undefined, right: CanvasSize | undefined): boolean =>
  left === right
  || (left !== undefined && right !== undefined
    && left.height === right.height
    && left.width === right.width);

/** @internal One lazily observed CSS-size store for a mounted canvas. */
export const createCanvasSizeStore = (
  canvas: HTMLCanvasElement,
): ObservedExternalStore<CanvasSize | undefined> => {
  const read = (): CanvasSize | undefined => {
    const rect = canvas.getBoundingClientRect();
    return canvasSizeFromCssBox(rect.width, rect.height);
  };
  return createObservedExternalStore(read(), (publish) => {
    const update = (): void => { publish(read()); };
    const ResizeObserverConstructor = globalThis.ResizeObserver;
    if (typeof ResizeObserverConstructor === "function") {
      const observer = new ResizeObserverConstructor(update);
      observer.observe(canvas);
      return () => { observer.disconnect(); };
    }
    globalThis.addEventListener?.("resize", update);
    return () => { globalThis.removeEventListener?.("resize", update); };
  }, sameCanvasSize);
};

/**
 * Observes the surrounding Canvas CSS size without polling. Returns
 * `undefined` before attachment or while layout gives the canvas no area.
 */
export const useCanvasSize = (): CanvasSize | undefined => {
  const canvas = useCanvasElement();
  const store = useMemo(
    () => canvas === null ? UNAVAILABLE_CANVAS_SIZE_STORE : createCanvasSizeStore(canvas),
    [canvas],
  );
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => UNAVAILABLE_CANVAS_SIZE,
  );
};
