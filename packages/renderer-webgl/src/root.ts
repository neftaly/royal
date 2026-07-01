import type { RenderRoot } from "@royal/renderer-core";

/** Renderer context options accepted by the stub backend for API compatibility. */
export interface WebGlRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

/** Snapshot of the stub renderer state, intended for tests and host diagnostics. */
export interface WebGlRootSnapshot {
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  readonly options: WebGlRootOptions;
}

const normalizeOptions = (options: WebGlRootOptions = {}): WebGlRootOptions => ({
  alpha: options.alpha ?? true,
  antialias: options.antialias ?? true,
  preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
});

/**
 * No-op renderer root that preserves the public backend shape while the real
 * renderer is rebuilt behind the package boundary.
 */
export class WebGlRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #options: WebGlRootOptions;
  #disposed = false;
  #frame = 0;
  #latestScene: RenderRoot | undefined;

  constructor(canvas: HTMLCanvasElement, options?: WebGlRootOptions) {
    this.#canvas = canvas;
    this.#options = normalizeOptions(options);
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get frame(): number {
    return this.#frame;
  }

  get latestScene(): RenderRoot | undefined {
    return this.#latestScene;
  }

  get options(): WebGlRootOptions {
    return this.#options;
  }

  render(scene: RenderRoot): void {
    if (this.#disposed) {
      throw new Error("Cannot render with a disposed Royal renderer root");
    }

    this.#latestScene = scene;
    this.#frame += 1;
  }

  dispose(): void {
    this.#disposed = true;
  }

  snapshot(): WebGlRootSnapshot {
    return {
      disposed: this.#disposed,
      frame: this.#frame,
      latestScene: this.#latestScene,
      options: this.#options,
    };
  }
}

/** Creates an imperative stub renderer root. */
export const createWebGlRoot = (
  canvas: HTMLCanvasElement,
  options?: WebGlRootOptions,
): WebGlRoot => new WebGlRoot(canvas, options);
