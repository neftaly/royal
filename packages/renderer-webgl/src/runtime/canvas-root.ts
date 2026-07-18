import type { RenderRoot } from "@royal/renderer-core";
import type { ContextLifecycleSnapshot } from "../context/context-lifecycle";
import { ContextLifecycleOwner } from "../context/context-lifecycle-owner";
import type { ClearFrameIntent, LinearRgba } from "../frame/clear-frame";
import { validateClearFrameIntent, validateLinearRgba } from "../frame/clear-frame";
import {
  resolveCanvasSize,
  type CanvasSizeInput,
  type CanvasSizeLimits,
  type ResolvedCanvasSize,
} from "../frame/canvas-size";
import { FrameClockOwner, type ExternalFrameClock } from "../frame/frame-clock-owner";
import { ClearStateOwner } from "../webgl/clear-state-owner";
import {
  rendererRootOptionsSemanticKey,
  type CanvasRootOptions,
} from "./root-options";

export type { CanvasRootOptions } from "./root-options";

export type CanvasRootSnapshot = Readonly<{
  context: ContextLifecycleSnapshot;
  frame: number;
  lastFrameFailure?: string;
  size: ResolvedCanvasSize | null;
}>;

export type CanvasRootPlatform = Readonly<{
  onListenerError(error: unknown): void;
  reportScheduledFailure(error: unknown): void;
  requestFrame(callback: () => void): void;
}>;

const defaultPlatform = (): CanvasRootPlatform => ({
  onListenerError: (error) => {
    try {
      console.error("Royal renderer listener failed", error);
    } catch {
      // Listener isolation must not depend on a console implementation.
    }
  },
  reportScheduledFailure: (error) => {
    try {
      console.error("Royal scheduled frame failed", error);
    } catch {
      // Scheduled failure isolation must not depend on a console implementation.
    }
  },
  requestFrame: (callback) => {
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(callback);
    } else {
      queueMicrotask(callback);
    }
  },
});

const formatFailure = (error: unknown): string => {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 400 ? value : `${value.slice(0, 399)}…`;
};

const sameColor = (left: LinearRgba, right: LinearRgba): boolean =>
  left[0] === right[0]
  && left[1] === right[1]
  && left[2] === right[2]
  && left[3] === right[3];

const readSizeLimits = (gl: WebGL2RenderingContext): CanvasSizeLimits => {
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as unknown;
  const renderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as unknown;
  if (
    !(viewport instanceof Int32Array)
    || viewport.length < 2
    || !Number.isSafeInteger(viewport[0])
    || !Number.isSafeInteger(viewport[1])
    || viewport[0]! < 1
    || viewport[1]! < 1
    || typeof renderbuffer !== "number"
    || !Number.isSafeInteger(renderbuffer)
    || renderbuffer < 1
  ) {
    throw new Error("Royal renderer received invalid WebGL2 size limits");
  }
  return Object.freeze({
    maxHeight: Math.min(viewport[1]!, renderbuffer),
    maxWidth: Math.min(viewport[0]!, renderbuffer),
  });
};

const createContext = (
  canvas: HTMLCanvasElement,
  options: CanvasRootOptions,
): WebGL2RenderingContext => {
  const gl = canvas.getContext("webgl2", {
    alpha: options.alpha ?? true,
    antialias: options.antialias ?? true,
    depth: true,
    stencil: true,
  });
  if (gl === null) throw new Error("Royal renderer could not create a WebGL2 context");
  return gl;
};

/** Clear-only root used to prove the replacement lifecycle and frame spine. */
export class CanvasRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #clearState: ClearStateOwner;
  readonly #clock: FrameClockOwner;
  readonly #context: ContextLifecycleOwner;
  #clearColor: LinearRgba = Object.freeze([0, 0, 0, 0]);
  #disposed = false;
  #frame = 0;
  #frameIntent: ClearFrameIntent | null = null;
  readonly #gl: WebGL2RenderingContext;
  #lastFrameFailure: string | undefined;
  readonly #listeners = new Set<() => void>();
  readonly #onContextLost: (event: Event) => void;
  readonly #onContextRestored: () => void;
  readonly #platform: CanvasRootPlatform;
  #revision = 0;
  #size: ResolvedCanvasSize | null = null;
  #sizeInput: CanvasSizeInput | null = null;
  #sizeLimits: CanvasSizeLimits;
  readonly #sizeListeners = new Set<() => void>();
  #snapshot: CanvasRootSnapshot | undefined;
  #snapshotRevision = -1;
  readonly #unsubscribeContext: () => void;

  /** Canvas whose context and backing dimensions are owned by this root. */
  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  constructor(
    canvas: HTMLCanvasElement,
    options: CanvasRootOptions = {},
    platform: CanvasRootPlatform = defaultPlatform(),
  ) {
    rendererRootOptionsSemanticKey(options);
    this.#canvas = canvas;
    this.#platform = platform;
    this.#gl = createContext(canvas, options);
    this.#sizeLimits = readSizeLimits(this.#gl);
    this.#clearState = new ClearStateOwner(this.#gl);
    this.#context = new ContextLifecycleOwner(platform.onListenerError);
    this.#unsubscribeContext = this.#context.subscribe(() => this.#publish());
    this.#clock = new FrameClockOwner({
      render: () => this.#renderFrame(),
      reportScheduledFailure: (error) => {
        this.#lastFrameFailure = formatFailure(error);
        this.#publish();
        platform.reportScheduledFailure(error);
      },
      requestFrame: platform.requestFrame,
    });
    this.#onContextLost = (event) => {
      if (this.#disposed) return;
      event.preventDefault();
      this.#clock.block();
      this.#clearState.invalidate();
      this.#context.transition({ kind: "context-lost" });
    };
    this.#onContextRestored = () => this.#restoreContext();
    canvas.addEventListener("webglcontextlost", this.#onContextLost);
    canvas.addEventListener("webglcontextrestored", this.#onContextRestored);
  }

  acquireExternalClock(): ExternalFrameClock {
    this.#assertLive("acquire an external clock");
    return this.#clock.acquireExternalClock();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#canvas.removeEventListener("webglcontextlost", this.#onContextLost);
    this.#canvas.removeEventListener("webglcontextrestored", this.#onContextRestored);
    this.#clock.dispose();
    this.#context.transition({ kind: "dispose" });
    this.#unsubscribeContext();
    this.#listeners.clear();
    this.#sizeListeners.clear();
  }

  flushInvalidated(): void {
    this.#assertLive("flush invalidated work");
    this.#clock.flushInvalidated();
  }

  getSnapshot = (): CanvasRootSnapshot => {
    if (this.#snapshot === undefined || this.#snapshotRevision !== this.#revision) {
      this.#snapshot = Object.freeze({
        context: this.#context.getSnapshot(),
        frame: this.#frame,
        ...(this.#lastFrameFailure === undefined
          ? {}
          : { lastFrameFailure: this.#lastFrameFailure }),
        size: this.#size,
      });
      this.#snapshotRevision = this.#revision;
    }
    return this.#snapshot;
  };

  /** Focused context lifecycle snapshot for product observation. */
  getLifecycleSnapshot = (): ContextLifecycleSnapshot => this.#context.getSnapshot();

  /** Focused canvas-size snapshot for product observation. */
  getSizeSnapshot = (): ResolvedCanvasSize | null => this.#size;

  invalidate(): void {
    this.#assertLive("invalidate");
    this.#clock.invalidate();
  }

  render(scene: RenderRoot): void {
    this.#assertLive("render");
    if (
      typeof scene !== "object"
      || scene === null
      || scene.kind !== "scene"
      || !Array.isArray(scene.nodes)
    ) {
      throw new TypeError("Royal renderer render requires a validated scene descriptor");
    }
    if (scene.nodes.length !== 0) {
      throw new Error("Royal renderer scene nodes are not supported by the clear-only implementation slice");
    }
    this.setClearColor(scene.clearColor);
    this.#clock.invalidate();
  }

  setClearColor(color: LinearRgba): void {
    this.#assertLive("set clear color");
    validateLinearRgba(color);
    if (sameColor(this.#clearColor, color)) return;
    const candidate = Object.freeze([...color]) as unknown as LinearRgba;
    this.#clearColor = candidate;
    this.#rebuildFrameIntent();
    this.#clock.invalidate();
  }

  setSize(input: CanvasSizeInput): void {
    this.#assertLive("set size");
    const resolved = resolveCanvasSize(input, this.#sizeLimits);
    this.#sizeInput = Object.freeze({ ...input });
    const previous = this.#size;
    const backingChanged = this.#canvas.width !== resolved.backingWidth
      || this.#canvas.height !== resolved.backingHeight;
    if (this.#canvas.width !== resolved.backingWidth) this.#canvas.width = resolved.backingWidth;
    if (this.#canvas.height !== resolved.backingHeight) this.#canvas.height = resolved.backingHeight;
    const semanticChanged = previous?.cssWidth !== resolved.cssWidth
      || previous?.cssHeight !== resolved.cssHeight
      || previous?.devicePixelRatio !== resolved.devicePixelRatio
      || previous?.backingWidth !== resolved.backingWidth
      || previous?.backingHeight !== resolved.backingHeight;
    if (!semanticChanged) return;
    this.#size = resolved;
    this.#clearState.invalidate();
    this.#rebuildFrameIntent();
    this.#publishSize();
    this.#publish();
    if (backingChanged && resolved.backingWidth > 0 && resolved.backingHeight > 0) {
      this.#clock.invalidate();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  };

  /** Subscribes only to context lifecycle changes. */
  subscribeLifecycle = (listener: () => void): (() => void) =>
    this.#context.subscribe(listener);

  /** Subscribes only to semantic canvas-size changes. */
  subscribeSize = (listener: () => void): (() => void) => {
    if (this.#disposed) return () => undefined;
    this.#sizeListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#sizeListeners.delete(listener);
    };
  };

  #assertLive(operation: string): void {
    if (this.#disposed) throw new Error(`Cannot ${operation} on a disposed Royal renderer root`);
  }

  #createFrameIntent(size: ResolvedCanvasSize, color: LinearRgba): ClearFrameIntent {
    return Object.freeze({
      clearColor: color,
      clearDepth: 1,
      clearStencil: 0,
      framebuffer: null,
      scissor: null,
      size: Object.freeze({ height: size.backingHeight, width: size.backingWidth }),
      viewport: Object.freeze({
        height: size.backingHeight,
        width: size.backingWidth,
        x: 0,
        y: 0,
      }),
    });
  }

  #publish(): void {
    this.#revision += 1;
    if (this.#listeners.size === 0) return;
    const listeners = [...this.#listeners];
    for (const listener of listeners) {
      if (!this.#listeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        try {
          this.#platform.onListenerError(error);
        } catch {
          // A failing diagnostic sink must not interrupt later listeners.
        }
      }
    }
  }

  #publishSize(): void {
    if (this.#sizeListeners.size === 0) return;
    const listeners = [...this.#sizeListeners];
    for (const listener of listeners) {
      if (!this.#sizeListeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        try {
          this.#platform.onListenerError(error);
        } catch {
          // A failing diagnostic sink must not interrupt later listeners.
        }
      }
    }
  }

  #rebuildFrameIntent(): void {
    const size = this.#size;
    if (size === null || size.backingWidth === 0 || size.backingHeight === 0) {
      this.#frameIntent = null;
      return;
    }
    const intent = this.#createFrameIntent(size, this.#clearColor);
    validateClearFrameIntent(intent);
    this.#frameIntent = intent;
  }

  #renderFrame(): void {
    const intent = this.#frameIntent;
    if (intent === null || this.#context.getSnapshot().phase !== "active") return;
    this.#clearState.clear(intent);
    this.#frame += 1;
    this.#lastFrameFailure = undefined;
    this.#publish();
  }

  #restoreContext(): void {
    if (this.#disposed || !this.#context.transition({ kind: "restoration-started" })) return;
    try {
      this.#sizeLimits = readSizeLimits(this.#gl);
      this.#clearState.invalidate();
      if (this.#sizeInput !== null) {
        const previousSize = this.#size;
        this.#size = resolveCanvasSize(this.#sizeInput, this.#sizeLimits);
        if (this.#canvas.width !== this.#size.backingWidth) {
          this.#canvas.width = this.#size.backingWidth;
        }
        if (this.#canvas.height !== this.#size.backingHeight) {
          this.#canvas.height = this.#size.backingHeight;
        }
        if (
          previousSize?.cssWidth !== this.#size.cssWidth
          || previousSize?.cssHeight !== this.#size.cssHeight
          || previousSize?.devicePixelRatio !== this.#size.devicePixelRatio
          || previousSize?.backingWidth !== this.#size.backingWidth
          || previousSize?.backingHeight !== this.#size.backingHeight
        ) this.#publishSize();
      }
      this.#rebuildFrameIntent();
      this.#context.transition({ kind: "restored" });
      this.#clock.resume();
      this.#clock.invalidate();
    } catch (error) {
      this.#context.transition({
        failure: formatFailure(error),
        kind: "restoration-failed",
      });
    }
  }
}

export const createRendererRoot = (
  canvas: HTMLCanvasElement,
  options: CanvasRootOptions = {},
): CanvasRoot => new CanvasRoot(canvas, options);
