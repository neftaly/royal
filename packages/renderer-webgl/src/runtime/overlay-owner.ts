import type {
  GltfAssetRef,
  GltfNode,
  LinearRgba,
  MeshNode,
  OutlineGltfNode,
  Scene,
  SceneOverlay,
  ScreenSpaceSegmentNode,
  Transform,
} from "@royal/renderer-core";
import type { SurfaceFrameView } from "../frame/surface-frame";
import type { PreparedStaticGltf } from "../gltf/static-asset";
import { FrameUploadBudgetOwner } from "../resource/frame-upload-budget";
import type { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import { EdgeOverlayOwner } from "../surface/edge-overlay-owner";
import {
  prepareCanonicalEdgeOverlayScene,
  type CanonicalEdgeOverlayScene,
} from "../surface/edge-overlay-scene";
import { RenderObjectRefOwner } from "../surface/render-object-ref-owner";
import {
  createCanonicalRenderObjectUpdateWorkspace,
  updateCanonicalRenderObjectTransform,
} from "../surface/render-object-scene-update";
import {
  prepareCanonicalSurfaceScene,
  type CanonicalSurfaceScene,
} from "../surface/scene-lowering";
import type { ScreenSpacePartitionPatternOwner } from "../surface/screen-space-partition-pattern";
import { ScreenSpaceSegmentOwner } from "../surface/screen-space-segment-owner";
import {
  prepareCanonicalScreenSpaceSegmentScene,
  type CanonicalScreenSpaceSegmentScene,
} from "../surface/screen-space-segment-scene";
import { SurfaceGpuOwner, type SurfaceGeometryUploadSnapshot } from "../surface/surface-gpu-owner";
import type { DecodedTextureSource, TextureSourceRef } from "../texture/source";
import type { WebGlStateOwner } from "../webgl/state-owner";

type OverlayOwnerOptions = Readonly<{
  gl: WebGL2RenderingContext;
  budget: PersistentGpuBudgetOwner;
  partitionPattern: ScreenSpacePartitionPatternOwner;
  etc2Available: boolean;
  getDecodedTexture(asset: TextureSourceRef): DecodedTextureSource | undefined;
  isTexturePending(asset: TextureSourceRef): boolean;
  getGltfAsset(asset: GltfAssetRef): PreparedStaticGltf | undefined;
  onChanged(): void;
  onFailure(error: unknown): void;
  onListenerError(error: unknown): void;
}>;

/** Owns overlay preparation, refs and GPU resources. World retention and asset claims stay at the root. */
export class OverlayOwner {
  readonly #options: OverlayOwnerOptions;
  #disposed = false;
  #sceneGeneration = 0;
  #installingScene = false;
  #renderObjectUpdateWorkspace:
    | ReturnType<typeof createCanonicalRenderObjectUpdateWorkspace>
    | undefined;
  #overlayGpu: SurfaceGpuOwner | null = null;
  #overlayScene: CanonicalSurfaceScene | null = null;
  #edgeOverlay: CanonicalEdgeOverlayScene | null = null;
  #edgeOverlayGpu: EdgeOverlayOwner | null = null;
  #segmentOverlay: CanonicalScreenSpaceSegmentScene | null = null;
  #segmentOverlayGpu: ScreenSpaceSegmentOwner | null = null;
  #overlayRenderObjectRefs: RenderObjectRefOwner | null = null;

  constructor(options: OverlayOwnerOptions) {
    this.#options = options;
  }

  get resourcesPending(): boolean {
    return this.#overlayGpu?.surfacePublicationsPending() ?? false;
  }
  get hasPresentation(): boolean {
    return (
      this.#overlayScene !== null ||
      this.#segmentOverlay !== null ||
      (this.#edgeOverlay?.runs.length ?? 0) > 0
    );
  }
  get hasSurfaces(): boolean {
    return (
      (this.#overlayScene?.surfaces.length ?? 0) > 0 ||
      (this.#segmentOverlay?.runs.length ?? 0) > 0 ||
      (this.#edgeOverlay?.surfaces.length ?? 0) > 0
    );
  }
  geometryUploadSnapshot(): SurfaceGeometryUploadSnapshot | undefined {
    return this.#overlayGpu?.geometryUploadSnapshot();
  }
  beginFrame(): void {
    this.#overlayGpu?.beginFrame();
  }
  flushResourcePublications(state: WebGlStateOwner): boolean {
    return this.resourcesPending && (this.#overlayGpu?.flushResourcePublications(state) ?? false);
  }
  invalidate(): void {
    this.#overlayGpu?.invalidate();
    this.#edgeOverlayGpu?.abandon();
    this.#segmentOverlayGpu?.abandon();
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#overlayRenderObjectRefs?.dispose();
    this.#overlayGpu?.dispose();
    this.#edgeOverlayGpu?.dispose();
    this.#segmentOverlayGpu?.dispose();
  }
  drawViews(
    views: readonly SurfaceFrameView[],
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    clearColor: LinearRgba,
    world: SurfaceGpuOwner,
    cssScaleX = 1,
    cssScaleY = 1,
  ): boolean {
    let pending = false;
    if (this.#overlayScene !== null)
      pending =
        this.#overlayGpu?.drawViews(views, framebuffer, state, clearColor, cssScaleX, cssScaleY) ??
        false;
    if (this.#segmentOverlay !== null)
      this.#segmentOverlayGpu?.drawViews(views, framebuffer, state, cssScaleX, cssScaleY);
    if (this.#edgeOverlay !== null)
      pending =
        (this.#edgeOverlayGpu?.drawViews(
          views,
          framebuffer,
          state,
          cssScaleX,
          cssScaleY,
          (surface) => world.borrowPresentedGeometry(surface),
        ) ??
          false) ||
        pending;
    return pending;
  }
  #applyOverlayRenderObjectTransform(node: MeshNode | GltfNode, transform: Transform): void {
    if (this.#disposed || node.kind !== "mesh") return;
    const scene = this.#overlayScene;
    if (scene === null) return;
    const binding = updateCanonicalRenderObjectTransform(
      scene,
      node,
      transform,
      (this.#renderObjectUpdateWorkspace ??= createCanonicalRenderObjectUpdateWorkspace()),
    );
    if (binding === undefined || this.#installingScene) return;
    this.#overlayGpu?.publishObjectTransforms(binding.surfaceIndices, false);
    this.#options.onChanged();
  }

  setScene(
    input: SceneOverlay | null,
    baseInput: Scene | null,
    baseScene: CanonicalSurfaceScene | null,
  ): void {
    if (this.#disposed) return;
    const generation = ++this.#sceneGeneration;
    if (input === null || input.nodes.length === 0 || baseInput === null || baseScene === null) {
      this.#overlayScene = null;
      this.#overlayGpu?.setScene(null);
      this.#edgeOverlay = null;
      this.#edgeOverlayGpu?.setScene(null);
      this.#segmentOverlay = null;
      this.#segmentOverlayGpu?.setScene(null);
      this.#overlayRenderObjectRefs?.reconcile([]);

      return;
    }
    const meshNodes = input.nodes.filter((node): node is MeshNode => node.kind === "mesh");
    const outlineNodes = input.nodes.filter(
      (node): node is OutlineGltfNode => node.kind === "outline-gltf",
    );
    const segmentNodes = input.nodes.filter(
      (node): node is ScreenSpaceSegmentNode => node.kind === "screen-space-segment",
    );
    const overlaySceneInput: Scene = {
      camera: baseInput.camera,
      clearColor: baseInput.clearColor,
      kind: "scene",
      nodes: meshNodes,
      ...(baseInput.exposureEv100 === undefined ? {} : { exposureEv100: baseInput.exposureEv100 }),
      ...(baseInput.toneMapping === undefined ? {} : { toneMapping: baseInput.toneMapping }),
    };
    const prepared =
      meshNodes.length === 0
        ? null
        : prepareCanonicalSurfaceScene(
            overlaySceneInput,
            () => undefined,
            baseScene.camera,
            this.#options.getDecodedTexture,
            this.#options.isTexturePending,
          );
    this.#overlayScene = prepared;
    this.#edgeOverlay =
      outlineNodes.length === 0
        ? null
        : prepareCanonicalEdgeOverlayScene(
            baseInput,
            outlineNodes,
            (node) => this.#options.getGltfAsset(node.asset),
            baseScene.camera,
          );
    this.#segmentOverlay =
      segmentNodes.length === 0 ? null : prepareCanonicalScreenSpaceSegmentScene(segmentNodes);
    const wasInstalling = this.#installingScene;
    this.#installingScene = true;
    try {
      this.#reconcileOverlayRenderObjectRefs(meshNodes);
    } finally {
      this.#installingScene = wasInstalling;
    }
    // Ref callbacks can synchronously dispose the root or install a newer overlay.
    if (this.#disposed || generation !== this.#sceneGeneration) return;
    if (prepared !== null) {
      this.#overlayGpu ??= new SurfaceGpuOwner(
        this.#options.gl,
        this.#options.budget,
        this.#options.partitionPattern,
        {
          etc2Available: this.#options.etc2Available,
          onChanged: () => this.#options.onChanged(),
          onFailure: (error) => this.#options.onFailure(error),
          presentationLane: "overlay",
          uploadBudget: new FrameUploadBudgetOwner(),
        },
      );
      this.#overlayGpu.setScene(prepared);
    } else {
      this.#overlayGpu?.setScene(null);
    }
    if (this.#edgeOverlay !== null) {
      this.#edgeOverlayGpu ??= new EdgeOverlayOwner(
        this.#options.gl,
        this.#options.budget,
        this.#options.partitionPattern,
      );
      this.#edgeOverlayGpu.setScene(this.#edgeOverlay);
    } else this.#edgeOverlayGpu?.setScene(null);
    if (this.#segmentOverlay !== null) {
      this.#segmentOverlayGpu ??= new ScreenSpaceSegmentOwner(
        this.#options.gl,
        this.#options.budget,
        this.#options.partitionPattern,
      );
      this.#segmentOverlayGpu.setScene(this.#segmentOverlay);
    } else this.#segmentOverlayGpu?.setScene(null);
  }

  #reconcileOverlayRenderObjectRefs(nodes: readonly MeshNode[]): void {
    if (this.#overlayRenderObjectRefs === null && !nodes.some((node) => node.ref !== undefined))
      return;
    this.#overlayRenderObjectRefs ??= new RenderObjectRefOwner({
      onError: (error) => this.#options.onListenerError(error),
      onTransform: (node, transform) => this.#applyOverlayRenderObjectTransform(node, transform),
    });
    this.#overlayRenderObjectRefs.reconcile(nodes);
  }
}
