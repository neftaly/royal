import { captureFirstFailure, type CapturedFailure } from "./captured-failure";

export type CanvasViewportSize = Readonly<{
  height: number;
  width: number;
}>;

/** Owns canvas backing-buffer sizing and viewport invalidation listener lifetime. */
export class WebGlCanvasViewportOwner {
  readonly #canvas: HTMLCanvasElement;
  readonly #invalidate: () => void;
  #disposed = false;
  #dprMediaQuery: MediaQueryList | undefined;
  #resizeObserver: ResizeObserver | undefined;
  #started = false;

  readonly #dprChangeListener = (): void => {
    if (this.#disposed) return;
    this.#watchDevicePixelRatio();
    this.#invalidate();
  };

  readonly #resizeListener = (): void => {
    if (!this.#disposed) this.#invalidate();
  };

  constructor(canvas: HTMLCanvasElement, invalidate: () => void) {
    this.#canvas = canvas;
    this.#invalidate = invalidate;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let firstFailure: CapturedFailure | undefined;
    firstFailure = captureFirstFailure(firstFailure, () => {
      this.#resizeObserver?.disconnect();
      this.#resizeObserver = undefined;
    });
    firstFailure = captureFirstFailure(firstFailure, () => {
      this.#unwatchDevicePixelRatio();
    });
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  size(): CanvasViewportSize {
    const rect = this.#canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio ?? 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.#canvas.width !== width) this.#canvas.width = width;
    if (this.#canvas.height !== height) this.#canvas.height = height;
    return { height, width };
  }

  start(): void {
    if (this.#disposed) throw new Error("Cannot start a disposed Royal canvas viewport owner");
    if (this.#started) return;
    this.#started = true;
    const ResizeObserverConstructor = globalThis.ResizeObserver;
    if (typeof ResizeObserverConstructor === "function") {
      this.#resizeObserver = new ResizeObserverConstructor(this.#resizeListener);
      this.#resizeObserver.observe(this.#canvas);
    }
    this.#watchDevicePixelRatio();
  }

  #unwatchDevicePixelRatio(): void {
    const mediaQuery = this.#dprMediaQuery;
    if (mediaQuery === undefined) return;
    mediaQuery.removeEventListener("change", this.#dprChangeListener);
    this.#dprMediaQuery = undefined;
  }

  #watchDevicePixelRatio(): void {
    this.#unwatchDevicePixelRatio();
    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia !== "function") return;
    const mediaQuery = matchMedia(`(resolution: ${globalThis.devicePixelRatio ?? 1}dppx)`);
    this.#dprMediaQuery = mediaQuery;
    mediaQuery.addEventListener("change", this.#dprChangeListener);
  }
}
