import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imageTexture,
  mesh,
  orthographicCamera,
  planeGeometry,
  scene,
  unlitMaterial,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import {
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  type ResourceGovernorPolicy,
} from "../packages/renderer-webgl/src/resource-governor";
import {
  createStrictWebGl2Context,
  createWebGlTestCanvas,
  type WebGlTestContext,
} from "./webgl-test-harness";

class ControlledImage {
  static readonly instances: ControlledImage[] = [];

  complete = false;
  readonly close = vi.fn();
  crossOrigin: string | null = null;
  height = 4;
  naturalHeight = 4;
  naturalWidth = 4;
  onerror: OnErrorEventHandler = null;
  onload: ((this: HTMLImageElement, event: Event) => unknown) | null = null;
  width = 4;
  #decodeResolvers: Array<() => void> = [];
  #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  #src = "";

  constructor() {
    ControlledImage.instances.push(this);
  }

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  decode(): Promise<void> {
    if (this.complete) return Promise.resolve();
    return new Promise((resolve) => this.#decodeResolvers.push(resolve));
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.#listeners.get(type)?.delete(listener);
  }

  settleLoad(): void {
    this.complete = true;
    const event = new Event("load");
    this.onload?.call(this as unknown as HTMLImageElement, event);
    for (const listener of this.#listeners.get("load") ?? []) {
      if (typeof listener === "function") listener.call(this, event);
      else listener.handleEvent(event);
    }
    for (const resolve of this.#decodeResolvers.splice(0)) resolve();
  }
}

class PassiveResizeObserver implements ResizeObserver {
  disconnect(): void {}
  observe(_target: Element): void {}
  takeRecords(): ResizeObserverEntry[] { return []; }
  unobserve(_target: Element): void {}
}

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const installViewport = () => {
  const animationFrames: FrameRequestCallback[] = [];
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("ResizeObserver", PassiveResizeObserver);
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: true,
    media,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }) satisfies MediaQueryList));
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return animationFrames;
};

const flushAnimationFrames = async (callbacks: FrameRequestCallback[]): Promise<void> => {
  for (const [index, callback] of callbacks.splice(0).entries()) callback(index + 1);
  await flushMicrotasks();
};

const textureTestContext = (): WebGlTestContext & {
  readonly failNextTextureDelete: (error: unknown) => void;
} => {
  let deleteFailure: unknown;
  let deleteFailurePresent = false;
  const context = createStrictWebGl2Context({
    constants: {
      BROWSER_DEFAULT_WEBGL: 0x9244,
      DYNAMIC_DRAW: 0x88E8,
      LINEAR_MIPMAP_LINEAR: 0x2703,
      MIRRORED_REPEAT: 0x8370,
      NEAREST: 0x2600,
      REPEAT: 0x2901,
      SRGB8_ALPHA8: 0x8C43,
      UNPACK_ALIGNMENT: 0x0CF5,
      UNPACK_IMAGE_HEIGHT: 0x806E,
      UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
      UNPACK_ROW_LENGTH: 0x0CF2,
      UNPACK_SKIP_IMAGES: 0x806D,
      UNPACK_SKIP_PIXELS: 0x0CF4,
      UNPACK_SKIP_ROWS: 0x0CF3,
    },
    methods: {
      generateMipmap: () => undefined,
      lineWidth: () => undefined,
      polygonOffset: () => undefined,
      scissor: () => undefined,
      texSubImage2D: () => undefined,
      uniform1f: () => undefined,
      uniform2fv: () => undefined,
      uniform4f: () => undefined,
      validateProgram: () => undefined,
      vertexAttrib2f: () => undefined,
      deleteTexture: () => {
        if (!deleteFailurePresent) return;
        deleteFailurePresent = false;
        throw deleteFailure;
      },
    },
  });
  return {
    ...context,
    failNextTextureDelete: (error: unknown) => {
      deleteFailure = error;
      deleteFailurePresent = true;
    },
  };
};

const texturePolicy = (persistentGpuBytes: number): ResourceGovernorPolicy => ({
  ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
  classes: {
    ...DEFAULT_RESOURCE_GOVERNOR_POLICY.classes,
    "ordinary-texture": {
      ...DEFAULT_RESOURCE_GOVERNOR_POLICY.classes["ordinary-texture"],
      persistentGpuBytes: {
        hardLimit: persistentGpuBytes,
        mandatoryFloor: 0,
        softLimit: persistentGpuBytes,
      },
    },
  },
});

const texturedScene = (uri: string) => scene({
  camera: orthographicCamera({
    bottom: -1,
    far: 10,
    left: -1,
    near: 0.1,
    position: [0, 0, 4],
    right: 1,
    rotation: [0, 0, 0],
    top: 1,
  }),
  clearColor: [0, 0, 0, 0],
  nodes: [
    mesh({
      geometry: planeGeometry(1),
      material: unlitMaterial({
        texture: imageTexture({
          sampler: { minFilter: "linear" },
          src: uri,
        }),
      }),
    }),
  ],
});

const emptyScene = () => scene({
  camera: orthographicCamera({
    bottom: -1,
    far: 10,
    left: -1,
    near: 0.1,
    position: [0, 0, 4],
    right: 1,
    rotation: [0, 0, 0],
    top: 1,
  }),
  clearColor: [0, 0, 0, 0],
  nodes: [],
});

afterEach(() => {
  ControlledImage.instances.splice(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL root construction and snapshot regressions", () => {
  it("rolls back late viewport setup without masking its primary constructor failure", () => {
    const { gl } = createStrictWebGl2Context();
    const canvas = createWebGlTestCanvas(gl);
    const addEventListener = vi.spyOn(canvas, "addEventListener");
    const removeEventListener = vi.spyOn(canvas, "removeEventListener");
    const primaryFailure = new Error("DPR listener registration failed");
    const cleanupFailure = new Error("ResizeObserver disconnect failed");
    const observedTargets = new Set<Element>();
    const dprListeners = new Set<EventListenerOrEventListenerObject>();
    const disconnect = vi.fn(() => {
      observedTargets.clear();
      throw cleanupFailure;
    });
    const removeDprListener = vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      dprListeners.delete(listener);
    });

    class ThrowingCleanupResizeObserver implements ResizeObserver {
      disconnect = disconnect;
      observe = vi.fn((target: Element) => {
        observedTargets.add(target);
      });
      takeRecords = vi.fn((): ResizeObserverEntry[] => []);
      unobserve = vi.fn((target: Element) => {
        observedTargets.delete(target);
      });
    }

    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("ResizeObserver", ThrowingCleanupResizeObserver);
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        dprListeners.add(listener);
        throw primaryFailure;
      },
      addListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      matches: true,
      media: "(resolution: 1dppx)",
      onchange: null,
      removeEventListener: removeDprListener,
      removeListener: vi.fn(),
    }) satisfies MediaQueryList));

    let constructionFailure: unknown;
    try {
      createWebGlRoot(canvas);
    } catch (error) {
      constructionFailure = error;
    }

    expect(constructionFailure, "rollback cleanup must not replace the setup failure").toBe(primaryFailure);
    expect(addEventListener.mock.calls.map(([type]) => type)).toEqual([
      "webglcontextlost",
      "webglcontextrestored",
    ]);
    expect(removeEventListener.mock.calls.map(([type]) => type)).toEqual([
      "webglcontextlost",
      "webglcontextrestored",
    ]);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(observedTargets).toHaveLength(0);
    expect(removeDprListener).toHaveBeenCalledTimes(1);
    expect(dprListeners).toHaveLength(0);
    expect(canvas.dispatchContextEvent("webglcontextlost").defaultPrevented).toBe(false);
  });

  it("accounts failed texture deletion quarantine before any snapshot is requested", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    const animationFrames = installViewport();
    const { calls, failNextTextureDelete, gl } = textureTestContext();
    const canvas = createWebGlTestCanvas(gl);
    const root = createWebGlRoot(canvas, { resourceGovernorPolicy: texturePolicy(64) });

    root.render(texturedScene("/textures/first.png"));
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(animationFrames);
    expect(calls.filter(({ name }) => name === "createTexture")).toHaveLength(1);

    const deleteFailure = new Error("driver retained deleted texture");
    failNextTextureDelete(deleteFailure);
    expect(() => root.render(texturedScene("/textures/second.png"))).toThrow(deleteFailure);
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(animationFrames);

    expect(
      calls.filter(({ name }) => name === "createTexture"),
      "the quarantined 64-byte allocation must consume the full budget without a snapshot side effect",
    ).toHaveLength(1);

    root.dispose();
  });

  it("keeps snapshots observational when quarantine is cleared by context recreation", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    const animationFrames = installViewport();
    const queueMicrotask = vi.spyOn(globalThis, "queueMicrotask");
    const { failNextTextureDelete, gl } = textureTestContext();
    const canvas = createWebGlTestCanvas(gl);
    const root = createWebGlRoot(canvas, { resourceGovernorPolicy: texturePolicy(64) });

    root.render(texturedScene("/textures/quarantined.png"));
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(animationFrames);
    const deleteFailure = new Error("driver retained deleted texture");
    failNextTextureDelete(deleteFailure);
    expect(() => root.render(emptyScene())).toThrow(deleteFailure);
    expect(root.snapshot().resourceGovernor.total.persistentGpuBytes).toBe(64);
    await flushMicrotasks();

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");
    const queuedBeforeSnapshots = queueMicrotask.mock.calls.length;
    const framesBeforeSnapshots = animationFrames.length;
    const first = root.snapshot();
    const second = root.snapshot();

    expect(first.virtualTexturing.demandRetentionOverflows).toBe(0);
    expect(second.resourceGovernor.total).toEqual(first.resourceGovernor.total);
    expect(second.resourceGovernor.highWater).toEqual(first.resourceGovernor.highWater);
    expect(queueMicrotask).toHaveBeenCalledTimes(queuedBeforeSnapshots);
    expect(animationFrames).toHaveLength(framesBeforeSnapshots);

    root.dispose();
  });
});
