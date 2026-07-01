import {
  type Camera,
  type RenderPass,
  type RenderRoot,
} from "@royal/renderer-core";
import { GeometryCache } from "./geometry-cache";
import { GltfCache } from "./gltf-cache";
import {
  invert,
  type Mat4,
  multiply,
  orthographic,
  perspective,
  rotation,
  translation,
} from "./matrix";
import type { MaterialVirtualTextureRuntimeStats } from "./material-texture-binding";
import {
  createGltfProgram,
  createMeshProgram,
  createTextProgram,
  createWireframeProgram,
  type GltfProgram,
  type MeshProgram,
  type TextProgram,
  type WireframeProgram,
} from "./programs";
import { renderWebGlPass } from "./render-pipeline";
import { TextCache } from "./text-cache";
import { TextureCache } from "./texture-cache";
import { VirtualTextureCache } from "./virtual-texture-cache";

type PrivateVirtualTextureStatsSnapshot = {
  readonly cache: ReturnType<VirtualTextureCache["stats"]>;
  readonly frame: number;
  readonly lastMaterial: MaterialVirtualTextureRuntimeStats | null;
  readonly version: 1;
};

/** WebGL context options for the renderer root. */
export interface WebGlRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

const resizeCanvas = (
  canvas: HTMLCanvasElement,
): { readonly height: number; readonly width: number } => {
  const bounds = canvas.getBoundingClientRect();
  const scale = currentDevicePixelRatio();
  const width = Math.max(1, Math.floor(bounds.width * scale));
  const height = Math.max(1, Math.floor(bounds.height * scale));

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  return { height, width };
};

const currentDevicePixelRatio = (): number => {
  const ratio = globalThis.devicePixelRatio;
  return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0
    ? ratio
    : 1;
};

const privateVirtualTextureStatsSymbol = Symbol.for(
  "royal.renderer-webgl.private.virtualTextureStats.v1",
);

const privateVirtualTextureStatsEnabled = (): boolean =>
  (globalThis as { readonly __ROYAL_ENABLE_PRIVATE_VT_STATS__?: unknown })
    .__ROYAL_ENABLE_PRIVATE_VT_STATS__ === true;

const viewProjection = (
  camera: Camera,
  viewport: { readonly height: number; readonly width: number },
): Mat4 => {
  const projection =
    camera.kind === "perspective-camera"
      ? perspective(camera.fovY, viewport.width / viewport.height, camera.near, camera.far)
      : orthographic(camera.left, camera.right, camera.bottom, camera.top, camera.near, camera.far);
  const cameraWorld = multiply(
    translation(camera.position),
    rotation(camera.rotation),
  );
  return multiply(projection, invert(cameraWorld));
};

export class WebGlRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #disposeResizeScheduling: () => void;
  readonly #drawnGltfAssets = new WeakSet<object>();
  readonly #gltfCache: GltfCache;
  readonly #gl: WebGL2RenderingContext;
  readonly #geometryCache: GeometryCache;
  readonly #gltfProgram: GltfProgram;
  readonly #meshProgram: MeshProgram;
  readonly #textCache: TextCache;
  readonly #textProgram: TextProgram;
  readonly #textureCache: TextureCache;
  readonly #virtualTextureCache: VirtualTextureCache;
  readonly #wireframeProgram: WireframeProgram;
  #frame = 0;
  #latestVirtualTextureRuntimeStats: MaterialVirtualTextureRuntimeStats | null = null;
  #mounted = true;
  #privateVirtualTextureStatsInstalled = false;
  #renderScheduled = false;
  #scene: RenderRoot | undefined;

  constructor(canvas: HTMLCanvasElement, options: WebGlRootOptions = {}) {
    const gl = canvas.getContext("webgl2", {
      alpha: options.alpha ?? true,
      ...(options.antialias === undefined ? {} : { antialias: options.antialias }),
      ...(options.preserveDrawingBuffer === undefined
        ? {}
        : { preserveDrawingBuffer: options.preserveDrawingBuffer }),
    });
    if (gl === null) throw new Error("WebGL2 is not available");

    this.#canvas = canvas;
    this.#gl = gl;
    this.#geometryCache = new GeometryCache(gl);
    this.#gltfCache = new GltfCache(gl, () => this.#renderWhenReady());
    this.#textCache = new TextCache(gl);
    this.#textureCache = new TextureCache(gl);
    this.#virtualTextureCache = new VirtualTextureCache(gl);
    this.#gltfProgram = createGltfProgram(gl);
    this.#meshProgram = createMeshProgram(gl);
    this.#textProgram = createTextProgram(gl);
    this.#wireframeProgram = createWireframeProgram(gl);
    this.#disposeResizeScheduling = this.#scheduleResizeInvalidation();
    this.#installPrivateVirtualTextureStatsReader();
  }

  render(scene: RenderRoot): void {
    this.#scene = scene;
    const gl = this.#gl;
    const viewport = resizeCanvas(this.#canvas);

    gl.viewport(0, 0, viewport.width, viewport.height);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    this.#frame += 1;
    this.#textCache.beginFrame();
    let completed = false;
    try {
      for (const pass of scene.children) {
        this.#renderPass(pass, viewport);
      }
      completed = true;
    } finally {
      if (completed) this.#textCache.endFrame();
      else this.#textCache.abortFrame();
    }
  }

  dispose(): void {
    this.#mounted = false;
    this.#latestVirtualTextureRuntimeStats = null;
    this.#removePrivateVirtualTextureStatsReader();
    this.#disposeResizeScheduling();
    this.#gltfCache.dispose();
    this.#geometryCache.dispose();
    this.#textCache.dispose();
    this.#textureCache.dispose();
    this.#virtualTextureCache.dispose();
    this.#gl.deleteProgram(this.#gltfProgram.program);
    this.#gl.deleteProgram(this.#meshProgram.program);
    this.#gl.deleteProgram(this.#textProgram.program);
    this.#gl.deleteProgram(this.#wireframeProgram.program);
  }

  #renderPass(
    pass: RenderPass,
    viewport: { readonly height: number; readonly width: number },
  ): void {
    renderWebGlPass(pass, viewProjection(pass.camera, viewport), {
      drawnGltfAssets: this.#drawnGltfAssets,
      frame: this.#frame,
      geometryCache: this.#geometryCache,
      gl: this.#gl,
      gltfCache: this.#gltfCache,
      gltfProgram: this.#gltfProgram,
      meshProgram: this.#meshProgram,
      onTextureSettled: () => this.#renderWhenReady(),
      onVirtualTextureRuntimeStats: (stats) => this.#recordVirtualTextureRuntimeStats(stats),
      textCache: this.#textCache,
      textProgram: this.#textProgram,
      textureCache: this.#textureCache,
      viewport,
      virtualTextureCache: this.#virtualTextureCache,
      wireframeProgram: this.#wireframeProgram,
    });
  }

  #installPrivateVirtualTextureStatsReader(): void {
    if (!privateVirtualTextureStatsEnabled()) return;

    Object.defineProperty(this.#canvas, privateVirtualTextureStatsSymbol, {
      configurable: true,
      enumerable: false,
      value: (): PrivateVirtualTextureStatsSnapshot => this.#readPrivateVirtualTextureStats(),
    });
    this.#privateVirtualTextureStatsInstalled = true;
  }

  #removePrivateVirtualTextureStatsReader(): void {
    if (!this.#privateVirtualTextureStatsInstalled) return;
    Reflect.deleteProperty(this.#canvas, privateVirtualTextureStatsSymbol);
    this.#privateVirtualTextureStatsInstalled = false;
  }

  #recordVirtualTextureRuntimeStats(stats: MaterialVirtualTextureRuntimeStats): void {
    this.#latestVirtualTextureRuntimeStats = copyMaterialVirtualTextureRuntimeStats(stats);
  }

  #readPrivateVirtualTextureStats(): PrivateVirtualTextureStatsSnapshot {
    return {
      cache: this.#virtualTextureCache.stats(),
      frame: this.#frame,
      lastMaterial: this.#latestVirtualTextureRuntimeStats === null
        ? null
        : copyMaterialVirtualTextureRuntimeStats(this.#latestVirtualTextureRuntimeStats),
      version: 1,
    };
  }

  #renderWhenReady(): void {
    if (!this.#mounted || this.#scene === undefined) return;
    const render = (): void => {
      this.#renderScheduled = false;
      if (this.#mounted && this.#scene !== undefined) this.render(this.#scene);
    };

    if (this.#renderScheduled) return;
    this.#renderScheduled = true;

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(render);
      return;
    }

    queueMicrotask(render);
  }

  #scheduleResizeInvalidation(): () => void {
    const disposers: (() => void)[] = [];
    const scheduleRender = (): void => this.#renderWhenReady();

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(scheduleRender);
      observer.observe(this.#canvas);
      disposers.push(() => observer.disconnect());
    }

    if (typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("resize", scheduleRender);
      disposers.push(() => globalThis.removeEventListener("resize", scheduleRender));
    }

    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia === "function") {
      let media: MediaQueryList | undefined;
      let removeMediaListener: (() => void) | undefined;

      const watchDevicePixelRatio = (): void => {
        removeMediaListener?.();
        const ratio = currentDevicePixelRatio();
        media = matchMedia(`(resolution: ${ratio}dppx)`);
        const onChange = (): void => {
          scheduleRender();
          watchDevicePixelRatio();
        };

        if (typeof media.addEventListener === "function") {
          media.addEventListener("change", onChange);
          removeMediaListener = () => media?.removeEventListener("change", onChange);
          return;
        }

        media.addListener(onChange);
        removeMediaListener = () => media?.removeListener(onChange);
      };

      watchDevicePixelRatio();
      disposers.push(() => removeMediaListener?.());
    }

    return () => {
      for (const dispose of disposers) dispose();
    };
  }
}

const copyMaterialVirtualTextureRuntimeStats = (
  stats: MaterialVirtualTextureRuntimeStats,
): MaterialVirtualTextureRuntimeStats => ({
  frame: stats.frame,
  pageTableSize: [stats.pageTableSize[0] ?? 0, stats.pageTableSize[1] ?? 0],
  requestPages: {
    pages: stats.requestPages.pages.map((page) => ({
      mip: page.mip,
      x: page.x,
      y: page.y,
    })),
    pending: stats.requestPages.pending,
    ready: stats.requestPages.ready,
    resident: stats.requestPages.resident,
    scheduled: stats.requestPages.scheduled,
  },
  resource: {
    cache: {
      ...stats.resource.cache,
      byMip: { ...stats.resource.cache.byMip },
    },
    mappings: { ...stats.resource.mappings },
    pendingUploadCount: stats.resource.pendingUploadCount,
    requests: { ...stats.resource.requests },
    uploads: { ...stats.resource.uploads },
  },
  selectedMip: stats.selectedMip,
  ...(stats.source === undefined ? {} : { source: { ...stats.source } }),
  uploadFrame: { ...stats.uploadFrame },
});

/** Creates an imperative WebGL renderer root. */
export const createWebGlRoot = (
  canvas: HTMLCanvasElement,
  options?: WebGlRootOptions,
): WebGlRoot => new WebGlRoot(canvas, options);
