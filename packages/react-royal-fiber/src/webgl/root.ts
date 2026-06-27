import {
  CameraKind,
  RenderNodeKind,
  type Camera,
  type RenderPass,
  type RenderRoot,
} from "@royal/renderer-core";
import type { ReactRoyalRootOptions } from "../root";
import { drawGltf, drawMesh, drawVectorText } from "./draw";
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
import {
  createGltfProgram,
  createMeshProgram,
  createTextProgram,
  type GltfProgram,
  type MeshProgram,
  type TextProgram,
} from "./programs";
import { markGltf } from "./performance";
import { findDirectionalLight } from "./render-graph";
import { TextCache } from "./text-cache";

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

const viewProjection = (
  camera: Camera,
  viewport: { readonly height: number; readonly width: number },
): Mat4 => {
  const projection =
    camera.kind === CameraKind.Perspective
      ? perspective(camera.fovY, viewport.width / viewport.height, camera.near, camera.far)
      : orthographic(camera.left, camera.right, camera.bottom, camera.top, camera.near, camera.far);
  const cameraWorld = multiply(
    translation(camera.position),
    rotation(camera.rotation),
  );
  return multiply(projection, invert(cameraWorld));
};

const assertNever = (value: never): never => {
  throw new Error(`Unsupported render node kind: ${String(value)}`);
};

export class WebGlRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #disposeResizeScheduling: () => void;
  readonly #drawnGltfAssets = new WeakSet<object>();
  readonly #gltfCache: GltfCache;
  readonly #gl: WebGLRenderingContext;
  readonly #geometryCache: GeometryCache;
  readonly #gltfProgram: GltfProgram;
  readonly #meshProgram: MeshProgram;
  readonly #textCache: TextCache;
  readonly #textProgram: TextProgram;
  #mounted = true;
  #renderScheduled = false;
  #scene: RenderRoot | undefined;

  constructor(canvas: HTMLCanvasElement, options: ReactRoyalRootOptions = {}) {
    const gl = canvas.getContext("webgl", {
      alpha: options.alpha ?? true,
      ...(options.antialias === undefined ? {} : { antialias: options.antialias }),
      ...(options.preserveDrawingBuffer === undefined
        ? {}
        : { preserveDrawingBuffer: options.preserveDrawingBuffer }),
    });
    if (gl === null) throw new Error("WebGL is not available");

    this.#canvas = canvas;
    this.#gl = gl;
    this.#geometryCache = new GeometryCache(gl);
    this.#gltfCache = new GltfCache(gl, () => this.#renderWhenReady());
    this.#textCache = new TextCache(gl);
    this.#gltfProgram = createGltfProgram(gl);
    this.#meshProgram = createMeshProgram(gl);
    this.#textProgram = createTextProgram(gl);
    this.#disposeResizeScheduling = this.#scheduleResizeInvalidation();
  }

  render(scene: RenderRoot): void {
    this.#scene = scene;
    const gl = this.#gl;
    const viewport = resizeCanvas(this.#canvas);

    gl.viewport(0, 0, viewport.width, viewport.height);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

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

  unmount(): void {
    this.#mounted = false;
    this.#disposeResizeScheduling();
    this.#gltfCache.dispose();
    this.#geometryCache.dispose();
    this.#textCache.dispose();
    this.#gl.deleteProgram(this.#gltfProgram.program);
    this.#gl.deleteProgram(this.#meshProgram.program);
    this.#gl.deleteProgram(this.#textProgram.program);
  }

  dispose(): void {
    this.unmount();
  }

  #renderPass(
    pass: RenderPass,
    viewport: { readonly height: number; readonly width: number },
  ): void {
    const gl = this.#gl;
    const clearColor = pass.clearColor;
    const vp = viewProjection(pass.camera, viewport);
    const directionalLight = findDirectionalLight(pass);

    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    for (const node of pass.children) {
      switch (node.kind) {
        case RenderNodeKind.DirectionalLight:
          break;
        case RenderNodeKind.Mesh:
          drawMesh(
            gl,
            { mesh: this.#meshProgram },
            node,
            {
              directionalLight,
              geometryCache: this.#geometryCache,
              viewProjectionMatrix: vp,
            },
          );
          break;
        case RenderNodeKind.Gltf:
          {
            const asset = this.#gltfCache.get(node);
            if (asset !== undefined) {
              drawGltf(
                gl,
                { gltf: this.#gltfProgram },
                node,
                asset,
                {
                  directionalLight,
                  viewProjectionMatrix: vp,
                },
              );
              if (!this.#drawnGltfAssets.has(asset)) {
                this.#drawnGltfAssets.add(asset);
                markGltf("first-draw");
              }
            }
          }
          break;
        case RenderNodeKind.VectorText:
          {
            const textAsset = this.#textCache.get(node);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.disable(gl.CULL_FACE);
            gl.depthMask(false);
            drawVectorText(
              gl,
              { text: this.#textProgram },
              node,
              textAsset,
              {
                viewProjectionMatrix: vp,
              },
            );
            gl.depthMask(true);
            gl.enable(gl.CULL_FACE);
            gl.disable(gl.BLEND);
          }
          break;
        default:
          assertNever(node);
      }
    }
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
