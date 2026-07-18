import { LazyClusteredLightingFeature } from "./lazy-clustered-lighting-feature";
import type { ClusteredLightingFeature } from "./clustered-lighting-feature";
import {
  validatePickInput,
  type GltfAssetRef,
  type Material,
  type MeshNode,
  type PickInput,
  type PickResult,
  type RenderNode,
  type RenderRoot,
  type TextureAssetRef,
  type VirtualTextureAssetRef,
} from "@royal/renderer-core";
import { loadHtmlImage } from "./texture/browser-image-loader";
import { monotonicNowMs, type MonotonicClock } from "./clock";
import { GpuUploadCapacityError } from "./gpu-upload-capacity-error";
import { BoundedDiagnosticLog } from "./diagnostics";
import {
  captureFailure,
  captureFirstFailure,
  retainFirstFailure,
  type CapturedFailure,
} from "./captured-failure";
import {
  DecodedTextureSourceLifetime,
} from "./texture/decoded-source-lifetime";
import {
  OrdinaryTextureResidencyController,
  type OrdinaryTextureResidencyLifecycle,
} from "./texture/ordinary-residency-controller";
import { OrdinaryTextureGpuOwner } from "./texture/ordinary-gpu-owner";
import { SceneBindingRegistry } from "./scene-binding-registry";
import {
  applyResourceDelta,
  clearResourceArenaPreparedSources,
  createResourceArena,
  detachResourceArenaImagePreparation,
  disposeResourceArena,
  resourceArenaCountersSnapshot,
  resourceArenaRequiresHdrComposition,
  resourceArenaPreparedSourceKeys,
  resourceArenaSourceReferenceCount,
  retainResourceArenaSourceLease,
  wakeResourceArenaPreparedAssetCpuCapacity,
  type ResourceArena,
  type ResourceArenaChanges,
} from "./resource-arena";
import {
  beginResourceGovernorFrame,
  createResourceGovernor,
  maximumResourceGovernorClassDurableBytes,
  resourceGovernorDurableUsage,
  resourceGovernorImpossibleCostReason,
  ResourceGovernorCpuCapacityError,
  replaceResourceGovernorLease,
  reserveResourceGovernor,
  resourceGovernorSnapshot,
  subscribeResourceGovernorDurableCapacityRelease,
  type ResourceGovernor,
  type ResourceGovernorClass,
  type ResourceGovernorPolicy,
} from "./resource-governor";
import {
  gltfRequestKey,
  type FramePlan,
} from "./frame/plan";
import {
  type CpuGeometry,
} from "./geometry-recipes";
import { GeometryRecipeRegistry } from "./geometry-recipe-registry";
import {
  createVertexInputArena,
  disposeVertexInputArena,
  dropVertexInputArenaContext,
  releaseVertexInputContextHandles,
  releaseVertexInputGeometry,
  releaseLostVertexInputGeometry,
  restoreVertexInputArenaContext,
  retainVertexInputGeometry,
  vertexInputGeometry,
  type VertexInputGeometry,
  type VertexInputArena,
} from "./vertex-input/arena";
import {
  beginGeometryDrawFrame,
  clearGeometryDrawArenaContext,
  createGeometryDrawArena,
  type GeometryDrawArena,
} from "./webgl/geometry-draw-arena";
import {
  createTextureHandleArena,
  dropTextureHandleContext,
  releaseTextureHandleContextHandles,
  type TextureHandleArena,
} from "./webgl/texture-handle-arena";
import {
  createSurfaceRenderTargetArena,
  dropSurfaceRenderTargetArenaContext,
  ensureHdrRenderTarget,
  releaseSurfaceRenderTargetContextHandles,
  type HdrRenderTarget,
  type ScreenColorTextureResource,
} from "./surface-render-target-arena";
import {
  appendFrameView,
  copyFrameViewMatrixInto,
  createFrameViews,
  resetFrameViews,
  type FrameViews,
} from "./frame/views";
import { rendererFrameViews, type RendererFrameViewLane } from "./webgl/frame-view-lane";
import {
  GltfInstanceTransformRegistry,
} from "./gltf/instance-transform-registry";
import {
  GltfImageDemandCoordinator,
} from "./gltf/image-demand-coordinator";
import { decodePreparedGltfImageSourceRecipe } from "./gltf/image-source-recipe";
import {
  activateGltfBasisuTranscodeTarget,
  type GltfBasisuTranscodeTarget,
} from "./texture/compression-target";
import {
  PreparedGltfRuntime,
} from "./gltf/prepared-runtime";
import { GltfMaterialPreparationArena } from "./gltf/material-preparation-arena";
import { GltfPacketSelectionOwner } from "./gltf/packet-selection-owner";
import { GltfPacketSubmissionOwner } from "./gltf/packet-submission-owner";
import { GltfPacketOccurrenceBuilder } from "./gltf/packet-occurrence-builder";
import { PreparedAssetEventOwner } from "./gltf/prepared-asset-event-owner";
import { GltfAssetPreparationOwner } from "./gltf/asset-preparation-owner";
import {
  preparedGltfLoadDiagnosticsAssetSnapshot,
  preparedGltfLoadDiagnosticsSnapshot,
} from "./gltf/load-diagnostics";
import { GltfReadyImagePublicationOwner } from "./gltf/ready-image-publication-owner";
import type { GltfFrameDrawBatch } from "./gltf/frame-batch-arena";
import {
  identityMat4,
  projectionMat4Into,
  viewMat4Into,
  type Mat4,
} from "./math/mat4";
import {
  isAffineBoundsVisible,
} from "./math/picking";
import { PickingController } from "./picking-controller";
import { FrameTextureResidencyIntent } from "./frame/texture-residency-intent";
import { isSvgUri } from "./texture/svg-uri";
import {
  type VirtualTextureDrawDemandContext,
  type VirtualTextureDrawDemandModelSource,
  type VirtualTextureRef,
  type ViewportSize,
} from "./virtual-texture/runtime";
import { LazyVirtualTextureFeature } from "./virtual-texture/lazy-feature";
import type { VirtualTextureFeature } from "./virtual-texture/feature";
import { RootResourceReleaseOwner } from "./root-resource-release-owner";
import { textureResidencyDiagnosticsSnapshot } from "./texture/residency-diagnostics";
import {
  type ProgramKind,
  type SurfaceShaderFeatures,
} from "./webgl/shaders";
import {
  configureProgramArenaParallelCompile,
  consumeProgramArenaWake,
  createProgramArena,
  dropProgramArenaContext,
  releaseProgramArenaContextHandles,
  requestProgram,
  uniform1i,
  uniform2f,
  useProgram,
  type ProgramArena,
  type ProgramArenaResource,
} from "./webgl/program-arena";
import { rendererOwnedWebGl2Context, type RendererOwnedWebGl2Context } from "./webgl/context-lane";
import type { SurfaceLightSet } from "./webgl/lights";
import { prepareFrameBaseline } from "./webgl/imperative-state";
import {
  SurfaceExecutionArena,
  type SurfaceGltfBatchExecution,
  type SurfaceSingleExecution,
} from "./webgl/surface-execution-arena";
import {
  writeSurfaceToneMappingState,
  surfacePresentationRequiresHdr,
  toneMappingShaderMode,
  type SurfaceToneMappingState,
} from "./surface-presentation-policy";
import { SurfaceLightResolver } from "./surface-light-resolver";
import { WebGlContextLifecycleOwner } from "./context/lifecycle-owner";
import {
  WebGlContextCapabilityOwner,
  type WebGlContextCapabilities,
} from "./context/capability-owner";
import { WebGlFramePublicationOwner } from "./frame/publication-owner";
import { WebGlRenderClockOwner } from "./render-clock-owner";
import { WebGlCanvasViewportOwner } from "./canvas-viewport-owner";
import { ResourceArenaSideEffectDebtOwner } from "./resource-arena-side-effect-debt-owner";
import { ResourceCapacityWakeOwner } from "./resource-capacity-wake-owner";
import { ResourceRefinementWakeOwner } from "./resource-refinement-wake-owner";
import { ScenePlanTransactionOwner } from "./scene-plan-transaction-owner";
import { LazyImageBasedLightingFeature } from "./lazy-image-based-lighting-feature";
import type { ImageBasedLightingRootFeature } from "./image-based-lighting-feature";
import { normalizeWebGlRootOptions } from "./root-options";
import { validateWebGlRenderViewsOptions } from "./render-views-options";
import type {
  InternalWebGlRootOptions,
  ResolvedWebGlRootOptions,
  WebGlExternalRenderClock,
  WebGlContextLifecycle,
  WebGlContextSnapshot,
  WebGlGltfLoadDiagnosticsAssetSnapshot,
  WebGlRoot,
  WebGlRootOptions,
  WebGlRootSnapshot,
  WebGlRenderViewsOptions,
  WebGlTextureAssetSnapshot,
} from "./root-types";

export type {
  WebGlContextLifecycle,
  WebGlContextSnapshot,
  WebGlGltfInstancingSnapshot,
  WebGlGltfLoadDiagnosticsAssetSnapshot,
  WebGlGltfLoadDiagnosticsSnapshot,
  WebGlRenderView,
  WebGlRenderViewport,
  WebGlRenderViewsOptions,
  WebGlRoot,
  WebGlRootOptions,
  WebGlRootSnapshot,
  WebGlTextureResidencySnapshot,
  WebGlTextureAssetSnapshot,
  WebGlVirtualTexturingSnapshot,
} from "./root-types";

type GeometryResource = VertexInputGeometry;
type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };

// Keep at most two frame upload budgets decoded and waiting for GPU upload.
// Uploaded embedded images may remain on CPU for context restoration; counting
// those durable sources here would permanently stall the rest of a GLB.
const GLTF_ORDINARY_IMAGE_DECODE_AHEAD_UPLOAD_WINDOWS = 2;

const getNodeKind = (node: RenderNode): string =>
  typeof node === "object" && node !== null && "kind" in node && typeof node.kind === "string"
    ? node.kind
    : "unknown";

/**
 * Minimal Royal WebGL2 renderer root. It implements the descriptor subset used
 * by the contracts while keeping all GPU ownership inside this root.
 */
type InternalWebGlRoot = WebGlRoot & RendererOwnedWebGl2Context & RendererFrameViewLane;

class WebGlRootImpl implements InternalWebGlRoot {
  readonly #now: MonotonicClock = monotonicNowMs;
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #options: ResolvedWebGlRootOptions;
  readonly #resourceGovernorPolicy: ResourceGovernorPolicy;
  readonly #contextCapabilities: WebGlContextCapabilityOwner;
  readonly #basisuTarget: GltfBasisuTranscodeTarget;
  readonly #frameViews = createFrameViews();
  readonly #renderProjection = identityMat4();
  readonly #renderView = identityMat4();
  readonly #renderViewProjection = identityMat4();
  readonly #renderViewportSize: [number, number] = [0, 0];
  readonly #surfaceToneMapping: Mutable<SurfaceToneMappingState> = {
    exposure: 0,
    hdrOutput: false,
    toneMapping: "pbr-neutral",
  };
  readonly #singleVirtualTextureDemandSource: {
    kind: "single";
    model: Mat4;
  } = { kind: "single", model: identityMat4() };
  readonly #composedVirtualTextureDemandSource: {
    kind: "composed";
    localModels: readonly Mat4[];
    rootModels: readonly Mat4[];
  } = { kind: "composed", localModels: [], rootModels: [] };
  readonly #context = new WebGlContextLifecycleOwner();
  readonly #framePublication = new WebGlFramePublicationOwner();
  readonly #programArena: ProgramArena;
  readonly #geometryRecipes = new GeometryRecipeRegistry();
  readonly #ordinaryTextures: OrdinaryTextureResidencyController;
  readonly #ordinaryTextureLifecycle: Mutable<OrdinaryTextureResidencyLifecycle> = {
    active: false,
    disposed: false,
    generation: 0,
  };
  readonly #readOrdinaryTextureLifecycle = (): OrdinaryTextureResidencyLifecycle => {
    const lifecycle = this.#ordinaryTextureLifecycle;
    lifecycle.active = this.#context.lifecycle === "active";
    lifecycle.disposed = this.#disposed;
    lifecycle.generation = this.#context.generation;
    return lifecycle;
  };
  readonly #ordinaryTextureGpu: OrdinaryTextureGpuOwner;
  readonly #textureResidencyIntent = new FrameTextureResidencyIntent();
  readonly #decodedTextureSources: DecodedTextureSourceLifetime;
  readonly #virtualTextures: VirtualTextureFeature;
  readonly #resourceReleases: RootResourceReleaseOwner;
  readonly #resourceArena: ResourceArena;
  /** Root authority for cross-subsystem resource admission and accounting. */
  readonly #resourceGovernor: ResourceGovernor;
  readonly #unsubscribeResourceGovernorDurableCapacityRelease: () => void;
  readonly #resourceArenaSideEffects = new ResourceArenaSideEffectDebtOwner();
  readonly #capacityWakes = new ResourceCapacityWakeOwner({
    invalidate: () => this.invalidate(),
    preparation: [
      () => this.#preparedGltf.scheduler.wake(),
      () => this.#preparedGltf.wakeImages(),
      () => this.#ordinaryTextures.wakeSourceJobs(),
      () => this.#virtualTextures.drainRequests(),
    ],
    wakeCpu: () => {
      this.#preparedGltf.wakeImages();
      const ordinaryWake = this.#ordinaryTextures.wakeCpuCapacity();
      const preparedAssetWake = wakeResourceArenaPreparedAssetCpuCapacity(this.#resourceArena);
      const preparedImageWake = this.#preparedGltf.wakeImageCpuCapacity();
      const virtualTextureWake = this.#virtualTextures.wakeDecodedCapacity();
      return ordinaryWake || preparedAssetWake || preparedImageWake || virtualTextureWake;
    },
    wakeGpu: () => {
      const ordinaryWake = this.#ordinaryTextures.wakeGpuCapacity();
      const iblWake = this.#ibl.wakeDurablePressure();
      this.#virtualTextures.scheduleGovernedAdmissionRetry();
      return ordinaryWake || iblWake;
    },
  });
  readonly #vertexInputs: VertexInputArena = createVertexInputArena({
    reserve: (cost) => {
      const reservation = reserveResourceGovernor(this.#resourceGovernor, "geometry", cost);
      if (typeof reservation !== "string") return reservation;
      const impossible = resourceGovernorImpossibleCostReason(
        this.#resourceGovernorPolicy,
        "geometry",
        cost,
      );
      if (impossible !== undefined) return { permanent: true, reason: impossible };
      return { reason: reservation };
    },
  });
  readonly #admitGltfPreparationJob = () => {
    const reservation = reserveResourceGovernor(this.#resourceGovernor, "asset-decode", { jobs: 1 });
    if (typeof reservation === "string") return undefined;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        reservation.cancel();
        this.#capacityWakes.wakePreparationCapacity();
      },
    };
  };
  readonly #gltfOrdinaryImagePendingUploadBytes = () =>
    this.#ordinaryTextures.pendingUploadBytes();
  readonly #admitGltfOrdinaryImageDecodeJob = () => {
    if (
      this.#gltfOrdinaryImagePendingUploadBytes()
      >= this.#resourceGovernorPolicy.limits.uploadBytes
        * GLTF_ORDINARY_IMAGE_DECODE_AHEAD_UPLOAD_WINDOWS
    ) return undefined;
    return this.#admitGltfPreparationJob();
  };
  readonly #admitGltfOrdinaryImageTransportJob = () => {
    const transportAheadBytes = resourceGovernorDurableUsage(
      this.#resourceGovernor,
      "asset-decode",
      "cpuDecodedBytes",
    );
    if (
      this.#gltfOrdinaryImagePendingUploadBytes() + transportAheadBytes
      >= this.#resourceGovernorPolicy.limits.uploadBytes
        * GLTF_ORDINARY_IMAGE_DECODE_AHEAD_UPLOAD_WINDOWS
    ) return undefined;
    return this.#admitGltfPreparationJob();
  };
  readonly #preparedGltf = new PreparedGltfRuntime(
    2,
    this.#admitGltfPreparationJob,
    (failure) => this.#framePublication.reportRenderFailure(failure),
  );
  readonly #gltfPacketOccurrences = new GltfPacketOccurrenceBuilder(
    this.#geometryRecipes,
    this.#preparedGltf,
    (message, key) => this.#recordDiagnostic(message, key),
  );
  readonly #gltfPreparation: GltfAssetPreparationOwner;
  readonly #gltfInstanceTransforms = new GltfInstanceTransformRegistry(() => this.invalidate());
  readonly #sceneBindings = new SceneBindingRegistry(() => this.invalidate());
  readonly #gltfPacketSelection = new GltfPacketSelectionOwner(
    this.#preparedGltf,
    this.#gltfInstanceTransforms,
    this.#sceneBindings,
  );
  readonly #gltfMaterials = new GltfMaterialPreparationArena();
  readonly #gltfPacketSubmissions: GltfPacketSubmissionOwner;
  readonly #preparedAssetEvents: PreparedAssetEventOwner;
  readonly #readyGltfImages: GltfReadyImagePublicationOwner;
  readonly #textureHandles: TextureHandleArena;
  readonly #diagnostics = new BoundedDiagnosticLog();
  #disposed = false;
  readonly #ibl: ImageBasedLightingRootFeature;
  readonly #lightResolver: SurfaceLightResolver;
  readonly #surfaceRenderTargets = createSurfaceRenderTargetArena({
    replace: (lease, cost) => {
      const reservation = replaceResourceGovernorLease(this.#resourceGovernor, lease, cost);
      return typeof reservation === "string" ? undefined : reservation;
    },
    reserve: (cost) => {
      const reservation = reserveResourceGovernor(this.#resourceGovernor, "render-target", cost);
      return typeof reservation === "string" ? undefined : reservation;
    },
  });
  readonly #clusteredLights: ClusteredLightingFeature;
  readonly #scenePlan = new ScenePlanTransactionOwner({
    rebuildTopology: (plan) => this.#gltfPacketOccurrences.rebuild(plan),
    reconcileBulkInstances: (changes) => this.#gltfInstanceTransforms.reconcile(changes),
    reconcileRenderObjectRefs: (plan, changes) => this.#sceneBindings.reconcile(plan, changes),
  });
  readonly #resourceRefinementWakes = new ResourceRefinementWakeOwner({
    invalidate: () => this.invalidate(),
    now: this.#now,
  });
  readonly #renderClock = new WebGlRenderClockOwner({
    contextGeneration: () => this.#context.generation,
    hasScene: () => this.#scenePlan.latestScene !== undefined,
    isContextActive: () => this.#context.lifecycle === "active",
    prepareLatest: () => this.#prepareLatestResources(),
    renderLatest: () => this.#renderLatestScene(),
    reportScheduledFailure: (failure) => this.#framePublication.reportRenderFailure(failure),
  });
  readonly #pickingController: PickingController;
  readonly #viewport: WebGlCanvasViewportOwner;
  readonly #geometryDrawArena: GeometryDrawArena;
  readonly #surfaceExecution: SurfaceExecutionArena;
  #surfaceGltfBatchExecution: Mutable<SurfaceGltfBatchExecution> | undefined;
  #surfaceSingleExecution: Mutable<SurfaceSingleExecution> | undefined;
  #unsupportedVirtualTextureDraws = 0;
  readonly #contextLostListener = (event: Event): void => {
    event.preventDefault();
    this.#context.lose(() => {
      this.#renderClock.interrupt();
      this.#dropGpuState(false);
    });
  };
  readonly #contextRestoredListener = (): void => {
    if (!this.#context.beginRestore() || this.#context.lifecycle !== "restoring") return;
    const restored = this.#canvas.getContext("webgl2", {
      alpha: this.#options.alpha,
      antialias: this.#options.antialias,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (restored === null || restored !== this.#gl) {
      this.#context.failRestore(
        "Royal WebGL context restoration did not return the renderer-owned WebGL2 context",
      );
      return;
    }
    try {
      // A failed cleanup from an earlier restoration attempt retains its
      // driver handles for retry. Drain that quarantine before allowing a
      // later restoration to reuse either arena.
      releaseSurfaceRenderTargetContextHandles(this.#surfaceRenderTargets, this.#gl);
      releaseProgramArenaContextHandles(this.#programArena);
      this.#clusteredLights.releaseContextHandles();
      this.#configureContextCapabilities(this.#contextCapabilities.validateRestoreAndProbe());
      const restoredBasisuTarget = activateGltfBasisuTranscodeTarget(this.#gl);
      if (restoredBasisuTarget !== this.#basisuTarget) {
        throw new Error(
          `Royal WebGL compressed texture support changed across context restoration: ${this.#basisuTarget} to ${restoredBasisuTarget}`,
        );
      }
      restoreVertexInputArenaContext(this.#vertexInputs, this.#context.generation);
      this.#ordinaryTextures.restoreContext(this.#context.generation);
      this.#renderClock.retain();
      if (this.#context.finishRestore()) this.#renderClock.resume();
    } catch (error) {
      const dropFailure = captureFailure(() => this.#dropGpuState(true));
      const restoreMessage = error instanceof Error ? error.message : String(error);
      this.#context.failRestore(dropFailure === undefined
        ? restoreMessage
        : `${restoreMessage}; GPU cleanup also failed: ${
          dropFailure.value instanceof Error ? dropFailure.value.message : String(dropFailure.value)
        }`);
    }
  };
  constructor(canvas: HTMLCanvasElement, options?: InternalWebGlRootOptions) {
    const rollback: Array<() => void> = [
      () => this.#preparedGltf.dispose(),
      () => disposeVertexInputArena(this.#vertexInputs),
    ];
    const registerRollback = (operation: () => void): void => { rollback.push(operation); };
    const rollbackConstruction = (): void => {
      for (let index = rollback.length - 1; index >= 0; index -= 1) {
        captureFailure(rollback[index]!);
      }
    };
    try {
      this.#canvas = canvas;
      this.#viewport = new WebGlCanvasViewportOwner(canvas, () => this.invalidate());
      this.#pickingController = new PickingController(canvas, {
        gltfInstanceRootModels: (node) => this.#gltfInstanceTransforms.views(node.instances).rootModels,
        meshGeometry: (node) => this.#geometryRecipes.retainedDirectRecipe(node.geometry, node.material).recipe,
        meshLocalBounds: (geometry) => this.#geometryRecipes.localBounds(geometry),
        pickingGeometry: (geometry) => this.#geometryRecipes.pickingRecipe(geometry),
        preparedGltfPrimitives: (node) => {
          const state = this.#preparedGltf.get(gltfRequestKey(node.asset.src, node.asset.version));
          return state?.status === "ready" ? state.primitives : undefined;
        },
        renderObjectTransform: (node) => this.#sceneBindings.transform(node),
      });
      const requestedOptions = normalizeWebGlRootOptions(options);
      this.#resourceGovernorPolicy = requestedOptions.resourceGovernorPolicy;
      this.#resourceGovernor = createResourceGovernor(requestedOptions.resourceGovernorPolicy);
      this.#preparedGltf.configureCpuOwnership({
        governor: this.#resourceGovernor,
        policy: requestedOptions.resourceGovernorPolicy,
        scheduleCapacityWake: () => this.#capacityWakes.scheduleCpuCapacityWake(),
      });
      this.#gltfPreparation = new GltfAssetPreparationOwner({
        now: this.#now,
        recordDiagnostic: (message, key) => this.#recordDiagnostic(message, key),
        runtime: this.#preparedGltf,
      });
      this.#decodedTextureSources = new DecodedTextureSourceLifetime({
        ordinaryReferenceCount: (source) => resourceArenaSourceReferenceCount(this.#resourceArena, source),
        reserveOrdinaryDecodedBytes: (bytes) => this.#reserveDecodedCpuBytes(
          "ordinary-texture",
          bytes,
          "Decoded texture source retention denied by root resource governor",
        ),
        scheduleRetry: () => this.invalidate(),
      });
      this.#resourceArena = createResourceArena(
        (request, signal) => this.#gltfPreparation.prepare(request.src, request.key, signal),
        () => this.invalidate(),
        { retain: (source) => this.#decodedTextureSources.retainOrdinary(source) },
      );
      registerRollback(() => clearResourceArenaPreparedSources(this.#resourceArena));
      registerRollback(() => { disposeResourceArena(this.#resourceArena); });
      const gl = canvas.getContext("webgl2", {
        alpha: requestedOptions.alpha,
        antialias: requestedOptions.antialias,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null;
      if (gl === null) {
        throw new Error("Royal WebGL renderer requires a WebGL2 context");
      }
      this.#gl = gl;
      this.#contextCapabilities = new WebGlContextCapabilityOwner(gl, options);
      this.#options = Object.freeze({
        automaticVirtualTextures: requestedOptions.automaticVirtualTextures,
        resourceBudgets: requestedOptions.resourceBudgets,
        ...this.#contextCapabilities.attributes,
      });
      this.#basisuTarget = activateGltfBasisuTranscodeTarget(gl);
      this.#preparedGltf.configureImages(new GltfImageDemandCoordinator({
        admit: this.#admitGltfPreparationJob,
        admitOrdinaryDecode: this.#admitGltfOrdinaryImageDecodeJob,
        admitOrdinaryTransport: this.#admitGltfOrdinaryImageTransportJob,
        closeSource: (source) => this.#decodedTextureSources.closeOrdinary(source),
        decodeRecipe: (prepared, signal) => decodePreparedGltfImageSourceRecipe(
          prepared,
          signal,
          { basisuTarget: this.#basisuTarget },
        ),
        diagnostic: (message, key) => this.#recordDiagnostic(message, `gltf-image:${key}`),
        now: this.#now,
        progress: (assetKey) => this.#preparedGltf.publishStateChange(assetKey),
        requestPreparation: () => this.#renderClock.invalidatePreparation(),
        requestRefinement: (urgent) => this.#resourceRefinementWakes.request(urgent),
        retainSource: (source) => retainResourceArenaSourceLease(this.#resourceArena, source),
        reserveTransportBytes: (bytes) => this.#reserveDecodedCpuBytes(
          "asset-decode",
          bytes,
          "glTF image transport byte retention denied by root resource governor",
        ),
      }));
      registerRollback(() => this.#preparedGltf.disposeImages());
      this.#clusteredLights = new LazyClusteredLightingFeature({
        active: () => !this.#disposed && this.#context.lifecycle === "active",
        diagnostic: (message, key) => this.#recordDiagnostic(message, key),
        disposed: () => this.#disposed,
        gl,
        governor: {
          replace: (lease, cost) => {
            const reservation = replaceResourceGovernorLease(this.#resourceGovernor, lease, cost);
            if (typeof reservation !== "string") return reservation;
            const impossible = resourceGovernorImpossibleCostReason(
              requestedOptions.resourceGovernorPolicy,
              "render-target",
              cost,
            );
            if (impossible !== undefined) return { permanent: true, reason: impossible };
            return { reason: reservation };
          },
          reserve: (cost) => {
            const reservation = reserveResourceGovernor(this.#resourceGovernor, "render-target", cost);
            if (typeof reservation !== "string") return reservation;
            const impossible = resourceGovernorImpossibleCostReason(
              requestedOptions.resourceGovernorPolicy,
              "render-target",
              cost,
            );
            if (impossible !== undefined) return { permanent: true, reason: impossible };
            return { reason: reservation };
          },
        },
        invalidate: () => this.invalidate(),
      });
      registerRollback(() => this.#clusteredLights.dropContext());
      registerRollback(() => this.#clusteredLights.releaseContextHandles());
      this.#ibl = new LazyImageBasedLightingFeature({
        active: () => !this.#disposed && this.#context.lifecycle === "active",
        contextLifecycle: () => this.#context.lifecycle,
        decodedTextureSources: this.#decodedTextureSources,
        diagnostic: (message, key) => this.#recordDiagnostic(message, key),
        disposed: () => this.#disposed,
        gl,
        governor: {
          reserve: (cost) => {
            const policy = requestedOptions.resourceGovernorPolicy;
            const reservation = reserveResourceGovernor(this.#resourceGovernor, "ordinary-texture", cost);
            if (typeof reservation !== "string") return reservation;
            const impossible = resourceGovernorImpossibleCostReason(
              policy,
              "ordinary-texture",
              cost,
            );
            if (impossible !== undefined) return { permanent: true, reason: impossible };
            return { permanent: false, reason: reservation };
          },
        },
        invalidate: () => this.invalidate(),
        resourceArena: this.#resourceArena,
      });
      registerRollback(() => this.#ibl.dropContext());
      registerRollback(() => this.#ibl.releaseContextHandles());
      this.#lightResolver = new SurfaceLightResolver({
        ensureGltfSpecular: (specular) => this.#ibl.ensureSpecular(specular),
        resolvePrefilteredEnvironment: (environment) => (
          this.#ibl.resolvePrefilteredEnvironment(environment)
        ),
        studioSpecular: () => this.#ibl.studioSpecular(),
      });
      this.#gltfPacketSubmissions = new GltfPacketSubmissionOwner({
        instanceTransforms: this.#gltfInstanceTransforms,
        lightResolver: this.#lightResolver,
        materials: this.#gltfMaterials,
        runtime: this.#preparedGltf,
        sceneBindings: this.#sceneBindings,
        selection: this.#gltfPacketSelection,
        vertexInputs: this.#vertexInputs,
      });
      this.#preparedAssetEvents = new PreparedAssetEventOwner({
        applyResourceChanges: (changes) => this.#applyResourceArenaChanges(changes),
        detachImagePreparation: (assetKey, generation) => (
          this.#detachPreparedAssetImagePreparation(assetKey, generation)
        ),
        disposed: () => this.#disposed,
        drainResourceSideEffects: () => this.#resourceArenaSideEffects.drain(),
        geometryRecipes: this.#geometryRecipes,
        now: this.#now,
        packetOccurrence: (plan, occurrenceIndex) => this.#gltfPacketOccurrences.occurrence(plan, occurrenceIndex),
        plan: () => this.#scenePlan.plan,
        recordDiagnostic: (message, key) => this.#recordDiagnostic(message, key),
        resourceArena: this.#resourceArena,
        runtime: this.#preparedGltf,
      });
      this.#textureHandles = createTextureHandleArena(gl);
      registerRollback(() => dropTextureHandleContext(this.#textureHandles));
      registerRollback(() => releaseTextureHandleContextHandles(this.#textureHandles));
      this.#ordinaryTextures = new OrdinaryTextureResidencyController({
        admitSourceJob: this.#admitGltfPreparationJob,
        decodedSources: this.#decodedTextureSources,
        diagnostic: (message, key) => this.#recordDiagnostic(message, key),
        gl,
        invalidate: () => this.invalidate(),
        lifecycle: this.#readOrdinaryTextureLifecycle,
        loadSource: (request, signal) => isSvgUri(request.uri)
          ? import("./texture/svg").then(({ loadSvgTextureFromUri }) => (
            loadSvgTextureFromUri(request.uri, signal).then((loadedImage) => loadedImage.image)
          ))
          : loadHtmlImage(request.uri, { signal }),
        recoverPreparedTexture: (texture) =>
          this.#preparedGltf.images.recoverPreparedTexture(texture),
        registerAutoVirtualTextureDecodedSource: (texture, source) => {
          this.#virtualTextures.registerAutoDecodedSource(texture, source);
        },
        resourceArena: this.#resourceArena,
        textureHandles: this.#textureHandles,
      });
      this.#ordinaryTextureGpu = new OrdinaryTextureGpuOwner({
        capacityWakes: this.#capacityWakes,
        contextGeneration: () => this.#context.generation,
        maximumPersistentGpuBytes: maximumResourceGovernorClassDurableBytes(
          this.#resourceGovernorPolicy,
          "ordinary-texture",
          "persistentGpuBytes",
        ),
        policy: this.#resourceGovernorPolicy,
        residencyIntent: this.#textureResidencyIntent,
        requestRefinement: () => this.#resourceRefinementWakes.request(),
        resourceGovernor: this.#resourceGovernor,
        scheduleUploadPass: () => this.#renderClock.invalidatePreparation(),
        textures: this.#ordinaryTextures,
      });
      this.#readyGltfImages = new GltfReadyImagePublicationOwner({
        ibl: this.#ibl,
        materials: this.#gltfMaterials,
        ordinaryTextures: this.#ordinaryTextures,
        runtime: this.#preparedGltf,
      });
      registerRollback(() => this.#ordinaryTextures.disposeSources());
      registerRollback(() => {
        const report = this.#ordinaryTextures.dropContext();
        const settlement = this.#ordinaryTextures.settleGpuReport(report);
        if (report.operationFailure !== undefined) throw report.operationFailure.error;
        if (settlement !== undefined) throw settlement.error;
      });
      this.#unsubscribeResourceGovernorDurableCapacityRelease =
        subscribeResourceGovernorDurableCapacityRelease(this.#resourceGovernor, (released) => {
          this.#capacityWakes.notifyCapacityReleased(
            released,
            this.#preparedGltf.cpuCapacityWakeSuppressed,
          );
        });
      registerRollback(() => this.#unsubscribeResourceGovernorDurableCapacityRelease());
      this.#virtualTextures = new LazyVirtualTextureFeature({
        active: () => !this.#disposed && this.#context.lifecycle === "active",
        admitJob: this.#admitGltfPreparationJob,
        automaticVirtualTextures: this.#options.automaticVirtualTextures,
        capabilities: () => this.#contextCapabilities.capabilities,
        capacityWakes: this.#capacityWakes,
        contextGeneration: () => this.#context.generation,
        contextLifecycle: () => this.#context.lifecycle,
        decodedSources: this.#decodedTextureSources,
        diagnostic: (message, key) => this.#recordDiagnostic(message, key),
        disposed: () => this.#disposed,
        frame: () => this.#framePublication.frame,
        gl,
        invalidate: () => this.invalidate(),
        maximumDecodedCpuBytes: this.#maximumResourceClassCpuBytes("virtual-texture"),
        maximumPersistentGpuBytes: maximumResourceGovernorClassDurableBytes(
          this.#resourceGovernorPolicy,
          "virtual-texture",
          "persistentGpuBytes",
        ),
        maximumUploadBytes: this.#resourceGovernorPolicy.limits.uploadBytes,
        now: this.#now,
        recordUnsupported: (texture, reason) => this.#recordUnsupportedVirtualTexture(texture, reason),
        resourceGovernor: this.#resourceGovernor,
        textureHandles: this.#textureHandles,
      });
      registerRollback(() => this.#virtualTextures.dropGpuContext());
      this.#resourceReleases = new RootResourceReleaseOwner({
        capacityWakes: this.#capacityWakes,
        ordinaryTextures: this.#ordinaryTextures,
        virtualTextures: this.#virtualTextures,
      });
      this.#geometryDrawArena = createGeometryDrawArena(gl, this.#vertexInputs);
      registerRollback(() => clearGeometryDrawArenaContext(this.#geometryDrawArena));
      this.#programArena = createProgramArena(gl);
      registerRollback(() => dropProgramArenaContext(this.#programArena));
      registerRollback(() => releaseProgramArenaContextHandles(this.#programArena));
      this.#surfaceExecution = new SurfaceExecutionArena({
        bindIbl: (
          bindings,
          program,
          lightSet,
          specularTextureUnit,
          brdfLutTextureUnit,
          bindUniforms,
        ) => {
          this.#ibl.bindSurface(
            bindings,
            this.#programArena,
            program,
            lightSet,
            specularTextureUnit,
            brdfLutTextureUnit,
            bindUniforms,
          );
        },
        bindVirtualTexture: (bindings, key, atlasTextureUnit, pageTableTextureUnit) => (
          this.#virtualTextures.bindGpuResource(bindings, key, atlasTextureUnit, pageTableTextureUnit)
        ),
        clusteredLights: this.#clusteredLights,
        consumeIblSignals: () => this.#ibl.consumeSurfaceSignals(),
        geometry: this.#geometryDrawArena,
        gl,
        gltfFrames: this.#gltfPacketSubmissions.frameBatches,
        ordinaryTextures: this.#ordinaryTextures,
        prepareIblBrdfLut: () => this.#ibl.prepareBrdfLut(),
        programs: this.#programArena,
        renderTargets: this.#surfaceRenderTargets,
        textureResidencyIntent: this.#textureResidencyIntent,
        virtualTextureDrawable: (key) => this.#virtualTextures.isGpuDrawable(key),
      });
      this.#configureContextCapabilities(this.#contextCapabilities.probe());
      restoreVertexInputArenaContext(this.#vertexInputs, this.#context.generation);
      // Replace the no-context cleanup registered before construction with an
      // active-context cleanup now that the vertex arena owns this generation.
      rollback[1] = () => disposeVertexInputArena(this.#vertexInputs, gl, this.#context.generation);
      let contextListenersStarted = false;
      registerRollback(() => {
        if (!contextListenersStarted) return;
        captureFailure(() => this.#canvas.removeEventListener("webglcontextlost", this.#contextLostListener));
        captureFailure(() => this.#canvas.removeEventListener("webglcontextrestored", this.#contextRestoredListener));
      });
      contextListenersStarted = true;
      this.#canvas.addEventListener("webglcontextlost", this.#contextLostListener);
      this.#canvas.addEventListener("webglcontextrestored", this.#contextRestoredListener);
      registerRollback(() => this.#viewport.dispose());
      this.#viewport.start();
    } catch (error) {
      rollbackConstruction();
      throw error;
    }
  }

  #configureContextCapabilities(capabilities: WebGlContextCapabilities): void {
    configureProgramArenaParallelCompile(
      this.#programArena,
      capabilities.parallelShaderCompile,
    );
    this.#surfaceExecution.configureTextureUnits(capabilities.maxTextureImageUnits);
    this.#clusteredLights.configure(
      capabilities.maxTextureImageUnits,
      capabilities.maxTextureSize,
    );
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  get [rendererOwnedWebGl2Context](): WebGL2RenderingContext {
    return this.#gl;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get contextLifecycle(): WebGlContextLifecycle {
    return this.#context.lifecycle;
  }

  contextSnapshot(): WebGlContextSnapshot {
    return this.#context.snapshot();
  }

  observeContextLifecycle(callback: (snapshot: WebGlContextSnapshot) => void): () => void {
    return this.#context.observe(callback);
  }

  observeRenderFailures(callback: (failure: unknown) => void): () => void {
    return this.#framePublication.observeRenderFailures(callback);
  }

  observeFrame(callback: (frame: number) => void): () => void {
    return this.#framePublication.observeFrame(callback);
  }

  gltfAssetSnapshot(asset: GltfAssetRef): WebGlGltfLoadDiagnosticsAssetSnapshot | undefined {
    return preparedGltfLoadDiagnosticsAssetSnapshot(
      this.#preparedGltf.get(gltfRequestKey(asset.src, asset.version)),
    );
  }

  textureAssetSnapshot(texture: TextureAssetRef | VirtualTextureAssetRef): WebGlTextureAssetSnapshot {
    if (texture.kind === "asset") {
      const snapshot = this.#ordinaryTextures.assetSnapshot(texture);
      return snapshot === undefined
        ? { kind: "ordinary", state: "idle" }
        : { kind: "ordinary", ...snapshot };
    }
    const snapshot = this.#virtualTextures.assetSnapshot(texture);
    return snapshot === undefined
      ? { kind: "virtual", pendingPages: 0, state: "idle" }
      : { kind: "virtual", ...snapshot };
  }

  observeGltfAsset(
    asset: GltfAssetRef,
    callback: (snapshot: WebGlGltfLoadDiagnosticsAssetSnapshot | undefined) => void,
  ): () => void {
    return this.#preparedGltf.observeState(
      gltfRequestKey(asset.src, asset.version),
      (state) => callback(preparedGltfLoadDiagnosticsAssetSnapshot(state)),
    );
  }

  observeTextureAsset(
    texture: TextureAssetRef | VirtualTextureAssetRef,
    callback: (snapshot: WebGlTextureAssetSnapshot) => void,
  ): () => void {
    let previous: WebGlTextureAssetSnapshot | undefined;
    return this.observeFrame(() => {
      const snapshot = this.textureAssetSnapshot(texture);
      if (
        previous?.kind === snapshot.kind
        && previous.state === snapshot.state
        && previous.error === snapshot.error
        && (previous.kind === "ordinary"
          || (snapshot.kind === "virtual" && previous.pendingPages === snapshot.pendingPages))
      ) return;
      previous = snapshot;
      callback(snapshot);
    });
  }

  get frame(): number {
    return this.#framePublication.frame;
  }

  get latestScene(): RenderRoot | undefined {
    return this.#scenePlan.latestScene;
  }

  get options(): ResolvedWebGlRootOptions {
    return this.#options;
  }

  acquireExternalRenderClock(): WebGlExternalRenderClock {
    return this.#renderClock.acquireExternalClock();
  }

  render(scene: RenderRoot): void {
    if (this.#disposed) {
      throw new Error("Cannot render with a disposed Royal renderer root");
    }
    const plan = this.#commitScene(scene);
    if (this.#context.lifecycle !== "active") {
      this.#retainPlanWhileContextUnavailable();
      return;
    }

    const { height, width } = this.#viewport.size();
    const camera = this.#sceneBindings.readCamera(plan.camera);
    resetFrameViews(this.#frameViews, null, false);
    appendFrameView(
      this.#frameViews,
      projectionMat4Into(this.#renderProjection, camera, width, height),
      viewMat4Into(this.#renderView, camera),
      0,
      0,
      width,
      height,
    );
    this.#renderScene(plan, this.#frameViews);
  }

  renderViews(scene: RenderRoot, options: WebGlRenderViewsOptions): void {
    if (this.#disposed) {
      throw new Error("Cannot render views with a disposed Royal renderer root");
    }
    validateWebGlRenderViewsOptions(options);
    const plan = this.#commitScene(scene);
    if (this.#context.lifecycle !== "active") {
      this.#retainPlanWhileContextUnavailable();
      return;
    }

    const frameViews = this.#frameViews;
    resetFrameViews(frameViews, options.framebuffer ?? null, true);
    for (const view of options.views) {
      const { height, width, x, y } = view.viewport;
      appendFrameView(frameViews, view.projectionMatrix, view.viewMatrix, x, y, width, height);
    }
    this.#renderScene(plan, frameViews);
  }

  [rendererFrameViews](scene: RenderRoot, frameViews: FrameViews): void {
    if (this.#disposed) {
      throw new Error("Cannot render views with a disposed Royal renderer root");
    }
    const plan = this.#commitScene(scene);
    if (this.#context.lifecycle !== "active") {
      this.#retainPlanWhileContextUnavailable();
      return;
    }
    this.#renderScene(plan, frameViews);
  }

  #renderScene(plan: FramePlan, frameViews: FrameViews): void {
    if (this.#context.lifecycle !== "active") {
      this.#retainPlanWhileContextUnavailable();
      return;
    }
    if (frameViews.count === 0) return;

    // An immediate render consumes any queued demand render. The queued
    // callback checks its generation before drawing.
    this.#renderClock.beginRender();
    this.#resourceRefinementWakes.acknowledgeFrame();
    beginResourceGovernorFrame(this.#resourceGovernor);
    this.#preparedAssetEvents.applyPending();
    const gl = this.#gl;
    let renderFailure: CapturedFailure | undefined;
    let renderDeferred = false;
    this.#virtualTextures.prepareFrame(plan.manifest.virtualTextures.length > 0);
    this.#virtualTextures.beginFrame();
    this.#textureResidencyIntent.beginFrame();
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameViews.framebuffer);
      let boundFramebuffer = frameViews.framebuffer;
      let depthTestEnabled = true;
      prepareFrameBaseline(gl, frameViews.scissor);
      beginGeometryDrawFrame(this.#geometryDrawArena);
      this.#surfaceExecution.beginFrame();
      this.#readyGltfImages.applyPending();
      this.#ordinaryTextureGpu.processUploads();
      this.#gltfInstanceTransforms.beginFrame();
      const requiresHdrComposition = surfacePresentationRequiresHdr(
        resourceArenaRequiresHdrComposition(this.#resourceArena),
      );
      if (requiresHdrComposition && !this.#contextCapabilities.capabilities.hdrColorBuffer) {
        throw new Error("Royal scene-linear material composition requires EXT_color_buffer_float");
      }
      const useHdr = requiresHdrComposition && this.#contextCapabilities.capabilities.hdrColorBuffer;
      const surfaceLights = this.#lightResolver.resolveScene(
        plan.environment,
        this.#scenePlan.sceneSurfaceLights,
        this.#scenePlan.sceneSurfaceLightSet,
      );
      const toneMapping = writeSurfaceToneMappingState(this.#surfaceToneMapping, plan, useHdr);
      this.#gltfPacketSelection.prepareFrame(plan, frameViews);
      this.#gltfPacketSubmissions.beginFrame(plan.revision);
      for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
        if (viewIndex > 0) this.#surfaceExecution.beginView();
        this.#virtualTextures.beginView(viewIndex);
        if (!depthTestEnabled) {
          gl.enable(gl.DEPTH_TEST);
          depthTestEnabled = true;
        }
        const viewportOffset = viewIndex * 4;
        const x = frameViews.viewports[viewportOffset]!;
        const y = frameViews.viewports[viewportOffset + 1]!;
        const width = frameViews.viewports[viewportOffset + 2]!;
        const height = frameViews.viewports[viewportOffset + 3]!;
        const hdrTarget = useHdr
          ? ensureHdrRenderTarget(this.#surfaceRenderTargets, gl, width, height)
          : undefined;
        const viewFramebuffer = hdrTarget?.framebuffer ?? frameViews.framebuffer;
        if (boundFramebuffer !== viewFramebuffer) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, viewFramebuffer);
          boundFramebuffer = viewFramebuffer;
        }
        gl.viewport(useHdr ? 0 : x, useHdr ? 0 : y, width, height);
        if (frameViews.scissor) gl.scissor(useHdr ? 0 : x, useHdr ? 0 : y, width, height);
        const [r, g, b, a] = plan.clearColor;
        gl.clearColor(r, g, b, a);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        copyFrameViewMatrixInto(this.#renderProjection, frameViews.projections, viewIndex);
        copyFrameViewMatrixInto(this.#renderView, frameViews.views, viewIndex);
        copyFrameViewMatrixInto(this.#renderViewProjection, frameViews.viewProjections, viewIndex);
        const projection = this.#renderProjection;
        const view = this.#renderView;
        const viewProjection = this.#renderViewProjection;
        const viewportSize = this.#renderViewportSize;
        viewportSize[0] = width;
        viewportSize[1] = height;
        const sourceX = useHdr ? 0 : x;
        const sourceY = useHdr ? 0 : y;
        let { packetCursor, packetEnd } = this.#gltfPacketSubmissions.beginView(
          plan.revision,
          viewIndex,
        );
        for (let nodeIndex = 0; nodeIndex < plan.nodes.length; nodeIndex += 1) {
          const node = plan.nodes[nodeIndex]!;
          if (node.kind === "directional-light" || node.kind === "point-light" || node.kind === "spot-light") continue;
          if (node.kind === "gltf" || node.kind === "gltf-instances") {
            const orderingSegment = plan.orderSegments[nodeIndex]!;
            if (this.#gltfPacketSubmissions.segment !== orderingSegment) {
              this.#flushGltfPacketSubmissions(
                plan.revision, projection, view, surfaceLights, toneMapping,
                viewportSize, sourceX, sourceY,
              );
              this.#gltfPacketSubmissions.resetSegment(plan.revision, orderingSegment);
            }
            this.#gltfPacketSubmissions.demandNodeMaterials(
              node,
              nodeIndex,
              packetCursor,
              packetEnd,
            );
            packetCursor = this.#gltfPacketSubmissions.appendNode(
              node,
              nodeIndex,
              packetCursor,
              packetEnd,
              plan.revision,
              this.#gl,
              this.#context.generation,
            );
            continue;
          }
          this.#flushGltfPacketSubmissions(
            plan.revision, projection, view, surfaceLights, toneMapping,
            viewportSize, sourceX, sourceY,
          );
          this.#drawNode(
            node,
            projection,
            view,
            viewProjection,
            surfaceLights,
            toneMapping,
            viewportSize,
          );
        }
        this.#flushGltfPacketSubmissions(
          plan.revision, projection, view, surfaceLights, toneMapping,
          viewportSize, sourceX, sourceY,
        );
        this.#surfaceExecution.finishPass();
        if (packetCursor !== packetEnd) {
          throw new Error("Royal retained glTF packet selection contains draws outside the frame plan");
        }
        if (hdrTarget !== undefined) {
          this.#presentHdrRenderTarget(
            hdrTarget,
            frameViews.framebuffer,
            x,
            y,
            width,
            height,
            toneMapping,
            frameViews.scissor,
          );
          boundFramebuffer = frameViews.framebuffer;
          depthTestEnabled = false;
          // The post-process pass binds its fullscreen VAO. Geometry for the
          // next view must not trust the cached surface VAO.
          beginGeometryDrawFrame(this.#geometryDrawArena);
          this.#surfaceExecution.invalidateTextureBindings();
        }
      }
    } catch (value) {
      if (value instanceof GpuUploadCapacityError) {
        renderDeferred = true;
        this.invalidate();
      } else renderFailure = { value };
    }
    try {
      this.#consumeSurfaceExecutionSignals();
    } catch (value) {
      renderFailure = retainFirstFailure(renderFailure, value);
    }
    try {
      this.#gltfInstanceTransforms.endFrame(renderFailure === undefined && !renderDeferred);
    } catch (value) {
      renderFailure = retainFirstFailure(renderFailure, value);
    }
    try {
      this.#gltfPacketSubmissions.releaseUnused(this.#gl, this.#context.generation);
    } catch (value) {
      renderFailure = retainFirstFailure(renderFailure, value);
    }
    try {
      this.#virtualTextures.finishFrame(renderFailure === undefined && !renderDeferred);
    } catch (value) {
      renderFailure = retainFirstFailure(renderFailure, value);
    }
    if (renderFailure === undefined && !renderDeferred) {
      try {
        this.#virtualTextures.processGpuUploads();
      } catch (value) {
        renderFailure = { value };
      }
    }
    try {
      this.#ordinaryTextureGpu.finalizeResidencyIntent(
        renderFailure === undefined && !renderDeferred,
      );
    } catch (value) {
      renderFailure = retainFirstFailure(renderFailure, value);
    }
    try {
      this.#framePublication.advance();
    } catch (value) {
      renderFailure = retainFirstFailure(renderFailure, value);
    }
    try {
      this.#virtualTextures.drainRequests();
    } catch (value) {
      renderFailure = retainFirstFailure(renderFailure, value);
    }
    try {
      if (this.#virtualTextures.hasActionableUploads()) this.invalidate();
    } catch (value) {
      renderFailure = retainFirstFailure(renderFailure, value);
    }

    if (renderFailure !== undefined) throw renderFailure.value;
    if (renderDeferred) return;
    this.#framePublication.publishFrame();
  }

  invalidate(): void {
    this.#renderClock.invalidate();
  }

  flushInvalidated(): void {
    this.#renderClock.flushInvalidated();
  }

  pick(input: PickInput): PickResult | undefined {
    validatePickInput(input);
    if (this.#disposed) {
      throw new Error("Cannot pick with a disposed Royal renderer root");
    }
    if (this.#context.lifecycle !== "active") return undefined;
    const plan = this.#scenePlan.plan;
    if (plan === undefined) return undefined;

    const { height, width } = this.#viewport.size();
    return this.#pickingController.pick({
      camera: this.#sceneBindings.readCamera(plan.camera),
      height,
      input,
      nodes: plan.nodes,
      width,
    });
  }

  #retainPlanWhileContextUnavailable(): void {
    this.#preparedAssetEvents.applyPending();
    this.#renderClock.retain();
  }

  #dropGpuState(deleteResources: boolean, contextGeneration = this.#context.generation): void {
    this.#capacityWakes.blockGpuWake(1);
    try {
    const ordinaryReport = this.#ordinaryTextures.dropContext();
    let releaseFailure = ordinaryReport.operationFailure === undefined
      ? undefined
      : { value: ordinaryReport.operationFailure.error };
    releaseFailure = captureFirstFailure(releaseFailure, () => {
      const settlement = this.#ordinaryTextures.settleGpuReport(ordinaryReport);
      if (settlement !== undefined) throw settlement.error;
    });
    releaseFailure = captureFirstFailure(releaseFailure, () => this.#virtualTextures.dropGpuContext());
    releaseFailure = captureFirstFailure(releaseFailure, () => this.#virtualTextures.releaseAllGpuLeases());
    if (deleteResources) {
      const gl = this.#gl;
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        releaseVertexInputContextHandles(this.#vertexInputs, gl, contextGeneration);
      });
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        releaseSurfaceRenderTargetContextHandles(this.#surfaceRenderTargets, gl);
      });
      releaseFailure = captureFirstFailure(releaseFailure, () => releaseProgramArenaContextHandles(this.#programArena));
      releaseFailure = captureFirstFailure(
        releaseFailure,
        () => this.#clusteredLights.releaseContextHandles(),
      );
      releaseFailure = captureFirstFailure(releaseFailure, () => this.#ibl.releaseContextHandles());
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        releaseTextureHandleContextHandles(this.#textureHandles);
      });
    }
    // Active release APIs retain failed handles for direct retry. Context loss
    // cannot call GL and therefore drops those handles and their accounting;
    // active-context teardown leaves surface/program/cluster failures in their
    // arenas so a repeated dispose (or restoration attempt) can retry them.
    releaseFailure = captureFirstFailure(releaseFailure, () => dropVertexInputArenaContext(this.#vertexInputs));
    if (!deleteResources) {
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        dropSurfaceRenderTargetArenaContext(this.#surfaceRenderTargets);
      });
      releaseFailure = captureFirstFailure(releaseFailure, () => dropProgramArenaContext(this.#programArena));
      releaseFailure = captureFirstFailure(releaseFailure, () => this.#clusteredLights.dropContext());
    }
    releaseFailure = captureFirstFailure(releaseFailure, () => this.#ibl.dropContext());
    releaseFailure = captureFirstFailure(releaseFailure, () => dropTextureHandleContext(this.#textureHandles));
    releaseFailure = captureFirstFailure(releaseFailure, () => clearGeometryDrawArenaContext(this.#geometryDrawArena));
    releaseFailure = captureFirstFailure(
      releaseFailure,
      () => this.#gltfPacketSubmissions.dropContext(),
    );
    releaseFailure = captureFirstFailure(
      releaseFailure,
      () => this.#gltfInstanceTransforms.endFrame(false),
    );

    releaseFailure = captureFirstFailure(releaseFailure, () => this.#virtualTextures.loseContext());
    if (releaseFailure !== undefined) throw releaseFailure.value;
    } finally {
      this.#capacityWakes.blockGpuWake(-1);
    }
  }

  dispose(): void {
    if (
      this.#resourceArenaSideEffects.draining
      || this.#preparedGltf.eventDrainInProgress
    ) {
      throw new Error("Cannot dispose while Royal is applying resource events");
    }
    if (this.#scenePlan.reconciling) {
      throw new Error("Cannot dispose while Royal is reconciling render-object refs");
    }
    if (this.#disposed) {
      let retryFailure = captureFailure(() => this.#sceneBindings.dispose());
      retryFailure = captureFirstFailure(retryFailure, () => {
        releaseSurfaceRenderTargetContextHandles(this.#surfaceRenderTargets, this.#gl);
      });
      retryFailure = captureFirstFailure(retryFailure, () => {
        releaseProgramArenaContextHandles(this.#programArena);
      });
      retryFailure = captureFirstFailure(retryFailure, () => {
        this.#clusteredLights.releaseContextHandles();
      });
      retryFailure = captureFirstFailure(retryFailure, () => this.#gltfInstanceTransforms.dispose());
      retryFailure = captureFirstFailure(retryFailure, () => this.#resourceArenaSideEffects.drain());
      retryFailure = captureFirstFailure(retryFailure, () => this.#decodedTextureSources.retryPending());
      if (retryFailure !== undefined) throw retryFailure.value;
      return;
    }
    const canDeleteResources = this.#context.lifecycle === "active"
      || this.#context.lifecycle === "restoring";
    const contextGeneration = this.#context.generation;
    this.#disposed = true;
    this.#capacityWakes.dispose();
    this.#unsubscribeResourceGovernorDurableCapacityRelease();
    let firstFailure: CapturedFailure | undefined;
    this.#context.dispose(() => {
      firstFailure = captureFailure(() => {
        this.#canvas.removeEventListener("webglcontextlost", this.#contextLostListener);
      });
      firstFailure = captureFirstFailure(firstFailure, () => {
        this.#canvas.removeEventListener("webglcontextrestored", this.#contextRestoredListener);
      });
      firstFailure = captureFirstFailure(
        firstFailure,
        () => this.#dropGpuState(canDeleteResources, contextGeneration),
      );
    });
    const teardown = (operation: () => void): void => {
      firstFailure = captureFirstFailure(firstFailure, operation);
    };
    this.#framePublication.dispose();
    this.#resourceRefinementWakes.dispose();
    this.#renderClock.dispose();

    teardown(() => this.#ordinaryTextures.disposeSources());
    teardown(() => this.#preparedGltf.disposeImages());
    teardown(() => {
      const disposal = disposeResourceArena(this.#resourceArena);
      // The semantic arena is now authoritatively empty. Retrying an older
      // acquisition after its paired disposal release could resurrect state in
      // this disposed root; release debt still owns any partially-created
      // imperative resources and must continue normally.
      this.#resourceArenaSideEffects.cancelAcquisitions();
      const applyFailure = captureFailure(() => this.#applyResourceArenaChanges(disposal.changes));
      if (disposal.kind === "failed") throw disposal.error;
      if (applyFailure !== undefined) throw applyFailure.value;
    });
    for (const key of resourceArenaPreparedSourceKeys(this.#resourceArena)) {
      teardown(() => this.#resourceReleases.releaseOrdinaryTexture(key));
    }
    for (const state of this.#virtualTextures.resources.values()) {
      teardown(() => this.#virtualTextures.releaseState(state));
    }
    teardown(() => clearGeometryDrawArenaContext(this.#geometryDrawArena));
    this.#geometryRecipes.clearRetainedRecipes();
    this.#virtualTextures.clear();
    teardown(() => this.#virtualTextures.dispose());
    this.#geometryRecipes.clearPacketPrimitives();
    teardown(() => clearResourceArenaPreparedSources(this.#resourceArena));
    teardown(() => this.#preparedGltf.dispose());
    teardown(() => this.#gltfPreparation.dispose());
    teardown(() => this.#gltfPacketSubmissions.dispose());
    this.#gltfMaterials.clear();
    this.#lightResolver.clear();
    teardown(() => this.#sceneBindings.dispose());
    teardown(() => this.#gltfInstanceTransforms.dispose());
    teardown(() => this.#viewport.dispose());
    teardown(() => disposeVertexInputArena(this.#vertexInputs));
    teardown(() => this.#decodedTextureSources.retryPending());
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  snapshot(): WebGlRootSnapshot {
    const diagnostics = this.#diagnostics.snapshot();
    const textureResidency = textureResidencyDiagnosticsSnapshot(
      this.#resourceArena,
      this.#ordinaryTextures,
    );
    const virtualTexturing = this.#virtualTextures.snapshot(this.#unsupportedVirtualTextureDraws);
    const gltfImages = this.#preparedGltf.images.snapshot();
    return {
      context: this.#context.snapshot(),
      diagnosticLog: diagnostics,
      frame: this.#framePublication.frame,
      gltfLoadDiagnostics: preparedGltfLoadDiagnosticsSnapshot(this.#preparedGltf),
      gltfInstancing: this.#gltfPacketSubmissions.snapshot(),
      options: this.#options,
      planning: this.#scenePlan.planningSnapshot(),
      resourceLifetime: {
        ...resourceArenaCountersSnapshot(this.#resourceArena),
        gltfPreparationQueueHighWater: this.#preparedGltf.scheduler.snapshot().queueHighWater,
        imageQueueHighWater: gltfImages.ordinaryQueueHighWater,
        iblImageQueueHighWater: gltfImages.iblQueueHighWater,
      },
      resourcePressure: resourceGovernorSnapshot(this.#resourceGovernor),
      picking: this.#pickingController.snapshot(),
      textureResidency,
      virtualTexturing,
    };
  }

  #commitScene(scene: RenderRoot): FramePlan {
    this.#resourceArenaSideEffects.drain();
    // ResourceArena is the authoritative resource generation. Once its
    // validated delta commits, publish the matching frame plan before running
    // fallible GPU cleanup, source close hooks, or user ref callbacks. A
    // reported side-effect failure can then be retried without applying the
    // same semantic resource delta to an arena that is already on `next`.
    const commit = this.#scenePlan.commit(
      scene,
      (delta) => applyResourceDelta(this.#resourceArena, delta),
    );
    if (commit.kind === "retained") return commit.plan;
    this.#gltfPacketOccurrences.resetPlan();
    const resourceFailure = captureFailure(
      () => this.#applyResourceArenaChanges(commit.resourceChanges),
    );
    this.#scenePlan.finishReconciliation(resourceFailure);
    return commit.plan;
  }

  #applyResourceArenaChanges(changes: ResourceArenaChanges): void {
    const apply = this.#resourceArenaSideEffects.enqueue.bind(this.#resourceArenaSideEffects);
    for (const { id, key, recipe } of changes.acquiredGeometryDeclarations) {
      apply(
        "acquire",
        () => retainVertexInputGeometry(this.#vertexInputs, { geometryId: id, recipe }),
        () => this.#geometryRecipes.retainRecipe(key, id, recipe),
      );
    }
    for (const { id, key } of changes.releasedGeometryDeclarations) {
      apply(
        "release",
        () => {
          if (this.#context.lifecycle === "active" || this.#context.lifecycle === "restoring") {
            releaseVertexInputGeometry(this.#vertexInputs, this.#gl, this.#context.generation, id);
          } else releaseLostVertexInputGeometry(this.#vertexInputs, id);
        },
        () => {
          this.#geometryRecipes.releaseRecipe(key, id);
        },
        () => this.#virtualTextures.releaseGeometry(id),
        () => this.#geometryRecipes.forgetPacketPrimitive(id),
      );
    }
    for (const { generation, request } of changes.acquiredGltfRequests) {
      apply(
        "acquire",
        () => this.#gltfPreparation.ensure(request.key, request.sourceUri, request.version, generation),
      );
    }
    for (const key of changes.releasedGltfKeys) {
      apply(
        "release",
        () => this.#preparedGltf.images.releaseAsset(key),
        () => this.#preparedGltf.releaseCpuLeases(key),
        () => this.#preparedGltf.delete(key),
      );
    }
    for (const key of changes.releasedOrdinaryTextureKeys) {
      apply("release", () => this.#resourceReleases.releaseOrdinaryTexture(key));
    }
    for (const key of changes.releasedVirtualTextureKeys) {
      apply("release", () => this.#resourceReleases.releaseVirtualTexture(key));
    }
    for (const key of changes.releasedIblKeys) {
      apply("release", () => this.#ibl.releaseSpecular(key));
    }
    for (const source of changes.releasedSources) {
      if (resourceArenaSourceReferenceCount(this.#resourceArena, source) !== 0) continue;
      apply("release", () => this.#decodedTextureSources.closeOrdinary(source));
    }
    this.#resourceArenaSideEffects.drain();
  }

  #drawNode(
    node: RenderNode,
    projection: Mat4,
    view: Mat4,
    viewProjection: Mat4,
    sceneLights: SurfaceLightSet | undefined,
    toneMapping: SurfaceToneMappingState,
    viewportSize: ViewportSize,
  ): void {
    switch (node.kind) {
      case "directional-light":
      case "point-light":
      case "spot-light":
        return;
      case "mesh":
        this.#drawMesh(
          node,
          projection,
          view,
          viewProjection,
          sceneLights,
          toneMapping,
          viewportSize,
        );
        return;
      default:
        {
          const kind = getNodeKind(node);
          this.#recordDiagnostic(`Unsupported render node kind "${kind}"`, `render-node:${kind}`);
        }
    }
  }

  #drawMesh(
    node: MeshNode,
    projection: Mat4,
    view: Mat4,
    viewProjection: Mat4,
    lights: SurfaceLightSet | undefined,
    toneMapping: SurfaceToneMappingState,
    viewportSize: ViewportSize,
  ): void {
    const retainedGeometry = this.#geometryRecipes.retainedDirectRecipe(node.geometry, node.material);
    const cpu = retainedGeometry.recipe;
    const model = this.#sceneBindings.modelMatrix(node);
    const localBounds = this.#geometryRecipes.localBounds(cpu);
    if (!isAffineBoundsVisible(
      localBounds,
      viewProjection,
      model,
    )) return;
    const gpu = this.#geometryResource(retainedGeometry.id);
    this.#drawGeometry(
      gpu,
      retainedGeometry.id,
      node.material,
      model,
      projection,
      view,
      viewportSize,
      lights,
      toneMapping,
      undefined,
      cpu,
    );
  }

  #drawGltfPacketSubmissions(
    projection: Mat4,
    view: Mat4,
    sceneLights: SurfaceLightSet | undefined,
    toneMapping: SurfaceToneMappingState,
    viewportSize: ViewportSize,
    sourceX: number,
    sourceY: number,
  ): void {
    if (this.#gltfPacketSubmissions.submissionCount === 0) return;
    const plan = this.#scenePlan.plan!;
    const groups = this.#gltfPacketSubmissions.prepareSegment(
      plan.revision,
      sceneLights,
      this.#gl,
      this.#context.generation,
    );

    // Full-coverage opaque draws precede alpha-tested draws. Besides keeping
    // the no-discard program contiguous, this gives masked fragments the
    // strongest available early-depth rejection without reordering either
    // class internally.
    for (let index = 0; index < groups.opaqueBatchCount; index += 1) {
      this.#drawGltfPrimitiveDrawBatch(
        this.#gltfPacketSubmissions.batch(groups.opaqueBatchIds[index]!),
        projection,
        view,
        toneMapping,
        viewportSize,
        undefined,
      );
    }
    for (let index = 0; index < groups.maskedBatchCount; index += 1) {
      this.#drawGltfPrimitiveDrawBatch(
        this.#gltfPacketSubmissions.batch(groups.maskedBatchIds[index]!),
        projection,
        view,
        toneMapping,
        viewportSize,
        undefined,
      );
    }

    if (groups.transmissiveBatchCount > 0) {
      const screenColorTexture = this.#surfaceExecution.copyTransmissionScreenColor(
        viewportSize[0],
        viewportSize[1],
        sourceX,
        sourceY,
        toneMapping.hdrOutput,
      );
      for (let index = 0; index < groups.transmissiveBatchCount; index += 1) {
        this.#drawGltfPrimitiveDrawBatch(
          this.#gltfPacketSubmissions.batch(groups.transmissiveBatchIds[index]!),
          projection,
          view,
          toneMapping,
          viewportSize,
          screenColorTexture,
        );
      }
    }
    for (let index = 0; index < groups.blendedBatchCount; index += 1) {
      this.#drawGltfPrimitiveDrawBatch(
        this.#gltfPacketSubmissions.batch(groups.blendedBatchIds[index]!),
        projection,
        view,
        toneMapping,
        viewportSize,
        undefined,
      );
    }
  }

  #flushGltfPacketSubmissions(
    planRevision: number,
    projection: Mat4,
    view: Mat4,
    sceneLights: SurfaceLightSet | undefined,
    toneMapping: SurfaceToneMappingState,
    viewportSize: ViewportSize,
    sourceX: number,
    sourceY: number,
  ): void {
    if (this.#gltfPacketSubmissions.submissionCount === 0) return;
    this.#drawGltfPacketSubmissions(
      projection,
      view,
      sceneLights,
      toneMapping,
      viewportSize,
      sourceX,
      sourceY,
    );
    this.#gltfPacketSubmissions.resetSegment(planRevision, this.#gltfPacketSubmissions.segment);
  }

  #drawGltfPrimitiveDrawBatch(
    batch: GltfFrameDrawBatch,
    projection: Mat4,
    view: Mat4,
    toneMapping: SurfaceToneMappingState,
    viewportSize: ViewportSize,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    let demandContext: VirtualTextureDrawDemandContext | undefined;
    if (this.#virtualTextures.requiresDrawDemand(batch.cpuGeometry, batch.material)) {
      let modelSource: VirtualTextureDrawDemandModelSource;
      if (batch.localModels.length === 1) {
        const singleModel = batch.singleModel;
        if (singleModel === undefined) {
          throw new Error("Royal single-instance glTF batch has no retained model");
        }
        this.#singleVirtualTextureDemandSource.model = singleModel.model;
        modelSource = this.#singleVirtualTextureDemandSource;
      } else {
        this.#composedVirtualTextureDemandSource.localModels = batch.localModels;
        this.#composedVirtualTextureDemandSource.rootModels = batch.rootModels;
        modelSource = this.#composedVirtualTextureDemandSource;
      }
      demandContext = this.#virtualTextures.drawDemandContext(
        batch.geometryId,
        batch.cpuGeometry,
        batch.material,
        modelSource,
        projection,
        view,
        viewportSize,
      );
    }
    const baseColorResidency = this.#virtualTextures.resolveBaseColorResidency(
      batch.geometry,
      batch.material,
      demandContext,
    );
    let execution = this.#surfaceGltfBatchExecution;
    if (execution === undefined) {
      execution = {
        baseColorResidency,
        batch,
        contextGeneration: this.#context.generation,
        counters: this.#gltfPacketSubmissions.counters,
        frame: this.#framePublication.frame,
        projection,
        toneMapping,
        transmissionScreenColorTexture,
        view,
        viewportSize,
      };
      this.#surfaceGltfBatchExecution = execution;
    } else {
      execution.baseColorResidency = baseColorResidency;
      execution.batch = batch;
      execution.contextGeneration = this.#context.generation;
      execution.counters = this.#gltfPacketSubmissions.counters;
      execution.frame = this.#framePublication.frame;
      execution.projection = projection;
      execution.toneMapping = toneMapping;
      execution.transmissionScreenColorTexture = transmissionScreenColorTexture;
      execution.view = view;
      execution.viewportSize = viewportSize;
    }
    this.#surfaceExecution.executeGltfBatch(execution);
  }

  #drawGeometry(
    geometry: GeometryResource,
    geometryId: number,
    material: Material,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
    lights: SurfaceLightSet | undefined,
    toneMapping: SurfaceToneMappingState,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    cpuGeometry: CpuGeometry,
  ): void {
    const demandContext = this.#virtualTextures.requiresDrawDemand(cpuGeometry, material)
      ? this.#virtualTextures.drawDemandContext(
          geometryId,
          cpuGeometry,
          material,
          this.#singleDemandSource(model),
          projection,
          view,
          viewportSize,
        )
      : undefined;
    const baseColorResidency = this.#virtualTextures.resolveBaseColorResidency(
      geometry,
      material,
      demandContext,
    );
    let execution = this.#surfaceSingleExecution;
    if (execution === undefined) {
      execution = {
        baseColorResidency,
        contextGeneration: this.#context.generation,
        frame: this.#framePublication.frame,
        geometry,
        lights,
        material,
        model,
        projection,
        toneMapping,
        transmissionScreenColorTexture,
        view,
        viewportSize,
      };
      this.#surfaceSingleExecution = execution;
    } else {
      execution.baseColorResidency = baseColorResidency;
      execution.contextGeneration = this.#context.generation;
      execution.frame = this.#framePublication.frame;
      execution.geometry = geometry;
      execution.lights = lights;
      execution.material = material;
      execution.model = model;
      execution.projection = projection;
      execution.toneMapping = toneMapping;
      execution.transmissionScreenColorTexture = transmissionScreenColorTexture;
      execution.view = view;
      execution.viewportSize = viewportSize;
    }
    this.#surfaceExecution.executeSingle(execution);
  }

  #singleDemandSource(model: Mat4): VirtualTextureDrawDemandModelSource {
    this.#singleVirtualTextureDemandSource.model = model;
    return this.#singleVirtualTextureDemandSource;
  }

  #maximumResourceClassCpuBytes(resourceClass: ResourceGovernorClass): number {
    const policy = this.#resourceGovernorPolicy;
    return maximumResourceGovernorClassDurableBytes(policy, resourceClass, "cpuDecodedBytes");
  }

  #reserveDecodedCpuBytes(
    resourceClass: ResourceGovernorClass,
    bytes: number,
    failureMessage: string,
  ) {
    const reservation = reserveResourceGovernor(this.#resourceGovernor, resourceClass, {
      cpuDecodedBytes: bytes,
    });
    if (typeof reservation === "string") {
      throw new ResourceGovernorCpuCapacityError(
        `${failureMessage}: ${reservation}`,
        bytes > this.#maximumResourceClassCpuBytes(resourceClass),
      );
    }
    return reservation.commit();
  }

  #program(kind: ProgramKind, features?: SurfaceShaderFeatures, clusteredLights = false): ProgramArenaResource | undefined {
    try {
      return requestProgram(
        this.#programArena,
        this.#framePublication.frame,
        kind,
        features,
        clusteredLights,
      );
    } finally {
      if (consumeProgramArenaWake(this.#programArena)) this.invalidate();
    }
  }

  #geometryResource(geometryId: number): GeometryResource {
    return vertexInputGeometry(
      this.#vertexInputs,
      this.#gl,
      this.#context.generation,
      geometryId,
    );
  }

  #consumeSurfaceExecutionSignals(): void {
    const signals = this.#surfaceExecution.drainSignals();
    for (const diagnostic of signals.diagnostics) {
      this.#recordDiagnostic(diagnostic.message, diagnostic.key);
    }
    if (signals.wakeRequested) this.invalidate();
  }

  #detachPreparedAssetImagePreparation(assetKey: string, generation: number): void {
    detachResourceArenaImagePreparation(this.#resourceArena, assetKey, generation);
  }

  #renderLatestScene(): void {
    const plan = this.#scenePlan.plan;
    if (plan === undefined) return;

    const { height, width } = this.#viewport.size();
    const camera = this.#sceneBindings.readCamera(plan.camera);
    resetFrameViews(this.#frameViews, null, false);
    appendFrameView(
      this.#frameViews,
      projectionMat4Into(this.#renderProjection, camera, width, height),
      viewMat4Into(this.#renderView, camera),
      0,
      0,
      width,
      height,
    );
    this.#renderScene(plan, this.#frameViews);
  }

  #prepareLatestResources(): void {
    if (this.#context.lifecycle !== "active" || this.#scenePlan.plan === undefined) return;
    this.#renderClock.beginPreparation();
    beginResourceGovernorFrame(this.#resourceGovernor);
    this.#readyGltfImages.applyPending();
    this.#ordinaryTextureGpu.processUploads();
  }

  #presentHdrRenderTarget(
    target: HdrRenderTarget,
    destination: WebGLFramebuffer | null,
    x: number,
    y: number,
    width: number,
    height: number,
    toneMapping: SurfaceToneMappingState,
    scissor: boolean,
  ): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
    gl.viewport(x, y, width, height);
    if (scissor) gl.scissor(x, y, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const programResource = this.#program("postprocess");
    if (programResource === undefined) return;
    const program = programResource.program;
    useProgram(this.#programArena, program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.color);
    uniform1i(this.#programArena, program, "u_hdrColor", 0);
    uniform2f(
      this.#programArena,
      program,
      "u_displayTransform",
      toneMappingShaderMode(toneMapping.toneMapping),
      toneMapping.exposure,
    );
    uniform2f(
      this.#programArena,
      program,
      "u_hdrUvScale",
      width / target.width,
      height / target.height,
    );
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  #recordDiagnostic(message: string, key = message): void {
    const result = this.#diagnostics.record(key, message);
    if (result === "appended") console.warn(this.#diagnostics.latestMessage);
  }

  #recordUnsupportedVirtualTexture(texture: VirtualTextureRef, reason: string): void {
    this.#unsupportedVirtualTextureDraws += 1;
    const message = `Virtual texture ${texture.manifestUri} is not rendered: ${reason}. Preview and first-page rendering are disabled.`;
    this.#recordDiagnostic(message, `virtual-texture-draw:${texture.manifestUri}:${reason}`);
  }
}

/** Creates an imperative WebGL2 renderer root. */
export const createWebGlRoot = (
  canvas: HTMLCanvasElement,
  options?: WebGlRootOptions,
): WebGlRoot => new WebGlRootImpl(canvas, options);

/** @internal Deterministic budget injection for backend tests. */
export const createWebGlRootWithResourcePolicy = (
  canvas: HTMLCanvasElement,
  options?: InternalWebGlRootOptions,
): WebGlRoot => new WebGlRootImpl(canvas, options);
