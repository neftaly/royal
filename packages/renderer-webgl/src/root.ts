import {
  configureClusteredLightArena,
  createClusteredLightArena,
  dropClusteredLightContext,
  endClusteredLightFrame,
  releaseClusteredLightContextHandles,
  type ClusteredLightArena,
} from "./webgl/clustered-light-arena";
import {
  type Material,
  type MeshNode,
  type PickInput,
  type PickResult,
  type RenderToneMapping,
  type RenderNode,
  type RenderRoot,
} from "@royal/renderer-core";
import { abortError } from "./gltf/io";
import { BoundedDiagnosticLog } from "./diagnostics";
import {
  closeDecodedTextureSource,
  DecodedTextureSourceLifetime,
} from "./decoded-texture-source-lifetime";
import { OrdinaryTextureResidencyController } from "./ordinary-texture-residency-controller";
import { SceneBindingRegistry } from "./scene-binding-registry";
import {
  applyResourceDelta,
  clearResourceArenaPreparedSources,
  createResourceArena,
  detachResourceArenaImagePreparation,
  disposeResourceArena,
  publishResourceArenaContentKey,
  resourceArenaCountersSnapshot,
  resourceArenaHasHdrReadyAsset,
  resourceArenaIblSources,
  resourceArenaOrdinaryTextureResidencySnapshot,
  resourceArenaPreparedSourceKeys,
  resourceArenaPreparedSourceValues,
  resourceArenaSourceReferenceCount,
  rekeyPreparedAssetOrdinaryTextures,
  retainResourceArenaSourceLease,
  retainResourceArenaIblSource,
  wakeResourceArenaPreparedAssetCpuCapacity,
  type PreparedAssetOrdinaryTextureRekey,
  type ResourceArena,
  type ResourceArenaChanges,
} from "./resource-arena";
import {
  beginResourceGovernorFrame,
  createResourceGovernor,
  defineResourceGovernorPolicy,
  maximumResourceGovernorClassDurableBytes,
  ResourceGovernorCpuCapacityError,
  replaceResourceGovernorLease,
  reserveResourceGovernor,
  resourceGovernorSnapshot,
  setResourceGovernorObservedDurableUsage,
  subscribeResourceGovernorDurableCapacityRelease,
  type ResourceGovernor,
  type ResourceGovernorClass,
} from "./resource-governor";
import {
  gltfRequestKey,
  type FramePlan,
} from "./frame-plan";
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
} from "./vertex-input-arena";
import {
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
  accumulateVirtualTextureGpuActivePagesByMip,
  accumulateVirtualTextureGpuCachedPagesByMip,
  clearVirtualTextureGpuOutcomes,
  consumeVirtualTextureGpuWake,
  createVirtualTextureGpuArena,
  dropVirtualTextureGpuContext,
  processVirtualTextureGpuUploads,
  virtualTextureGpuArenaSnapshot,
  virtualTextureGpuHasActionableUploads,
  virtualTextureGpuOutcome,
  virtualTextureGpuOutcomeCount,
  virtualTextureGpuResource,
  virtualTextureGpuResourceSnapshot,
  type VirtualTextureGpuArena,
} from "./webgl/virtual-texture-gpu-arena";
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
} from "./frame-views";
import { rendererFrameViews, type RendererFrameViewLane } from "./webgl/frame-view-lane";
import {
  GltfInstanceTransformRegistry,
} from "./gltf/instance-transform-registry";
import {
  GltfImageDemandCoordinator,
} from "./gltf/image-demand-coordinator";
import {
  PreparedGltfRuntime,
  type AnyGltfNode,
  type PreparedGltfState as GltfState,
} from "./gltf/prepared-runtime";
import {
  GltfMaterialPreparationArena,
  gltfPrimitiveMaterialForVariant,
  selectedGltfVariantIndex,
} from "./gltf/material-preparation-arena";
import {
  GltfPacketSelectionOwner,
  gltfMaterialLodSelectionKey,
} from "./gltf/packet-selection-owner";
import { GltfPacketSubmissionOwner } from "./gltf/packet-submission-owner";
import { PreparedAssetEventOwner } from "./gltf/prepared-asset-event-owner";
import { GltfAssetPreparationOwner } from "./gltf/asset-preparation-owner";
import {
  type GltfPacketOccurrence,
  type GltfPacketPreparedPrimitive,
} from "./gltf-packet-topology";
import type { GltfFrameDrawBatch } from "./gltf/frame-batch-arena";
import {
  identityMat4,
  multiplyMat4,
  multiplyMat4Into,
  projectionMat4Into,
  transformMat4Into,
  viewMat4Into,
  type Mat4,
} from "./math/mat4";
import {
  isBoundsVisible,
} from "./math/picking";
import { PickingController } from "./picking-controller";
import { FrameTextureResidencyIntent } from "./frame-texture-residency-intent";
import {
  isDecodedRgbaTexture,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "./texture-sources";
import {
  GENERATED_SVG_VIRTUAL_TEXTURE_DEFAULT_MAX_DIMENSION,
  GENERATED_SVG_VIRTUAL_TEXTURE_MAX_DIMENSION,
  GENERATED_SVG_VIRTUAL_TEXTURE_MIN_DIMENSION,
  isSvgUri,
  loadSvgTextureFromUri,
} from "./svg-texture";
import {
  type VirtualTextureDrawDemandModelSource,
  type VirtualTextureRef,
  type VirtualTextureRuntimeState,
  type ViewportSize,
} from "./virtual-texture-runtime";
import { VirtualTextureDemandOwner } from "./virtual-texture-demand-owner";
import { VirtualTextureGpuAdmissionOwner } from "./virtual-texture-gpu-admission-owner";
import { VirtualTextureRuntimeShell } from "./virtual-texture-runtime-shell";
import {
  textureCacheKey,
  type TextureAssetUploadRef,
} from "./webgl/materials";
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
import {
  type SurfaceImageBasedLightSpecular,
  type SurfaceLightSet,
} from "./webgl/lights";
import {
  consumeIblTextureDiagnostics,
  consumeIblTextureFrameWake,
  createIblTextureArena,
  dropIblTextureContext,
  ensureGltfIblSpecularTexture,
  ensureStudioEnvironmentSpecularTexture,
  markGltfIblSpecularTextureDirty,
  releaseGltfIblSpecularTexture,
  releaseIblTextureContextHandles,
  type IblSpecularTextureResource,
  type IblTextureArena,
  type StudioEnvironmentSpecularResource,
  wakeIblTextureDurablePressure,
} from "./webgl/ibl-texture-arena";
import { prepareFrameBaseline } from "./webgl/imperative-state";
import {
  SurfaceExecutionArena,
  type SurfaceToneMappingState,
} from "./webgl/surface-execution-arena";
import { SurfaceLightResolver } from "./surface-light-resolver";
import { WebGlContextLifecycleOwner } from "./context-lifecycle-owner";
import {
  WebGlContextCapabilityOwner,
  type WebGlContextCapabilities,
} from "./context-capability-owner";
import { WebGlFramePublicationOwner } from "./frame-publication-owner";
import { WebGlRenderClockOwner } from "./render-clock-owner";
import { WebGlCanvasViewportOwner } from "./canvas-viewport-owner";
import { ResourceArenaSideEffectDebtOwner } from "./resource-arena-side-effect-debt-owner";
import { ResourceCapacityWakeOwner } from "./resource-capacity-wake-owner";
import { ScenePlanTransactionOwner } from "./scene-plan-transaction-owner";
import type {
  NormalizedWebGlRootOptions,
  WebGlExternalRenderClock,
  WebGlContextLifecycle,
  WebGlContextSnapshot,
  WebGlGltfInstancingSnapshot,
  WebGlGltfLoadDiagnosticsAssetSnapshot,
  WebGlGltfLoadDiagnosticsPhaseKey,
  WebGlGltfLoadDiagnosticsSnapshot,
  WebGlRoot,
  WebGlRootOptions,
  WebGlRootSnapshot,
  WebGlTextureResidencySnapshot,
  WebGlRenderViewsOptions,
  WebGlVirtualTexturingSnapshot,
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
  WebGlVirtualTexturingSnapshot,
} from "./root-types";

type GeometryResource = VertexInputGeometry;

type SceneToneMappingState = SurfaceToneMappingState;

const DEFAULT_TONE_MAPPING_STATE: SceneToneMappingState = {
  exposure: 1 / 1.2,
  hdrOutput: false,
  toneMapping: "linear-clamp",
};
const EMPTY_IBL_SOURCES: ReadonlyMap<string, LoadedTextureSource> = new Map();
const sceneToneMappingState = (
  scene: {
    readonly exposureEv100: number | undefined;
    readonly toneMapping: RenderToneMapping | undefined;
  },
): SceneToneMappingState => ({
  exposure: scene.exposureEv100 === undefined
    ? DEFAULT_TONE_MAPPING_STATE.exposure
    : 1 / (1.2 * 2 ** scene.exposureEv100),
  hdrOutput: false,
  toneMapping: scene.toneMapping ?? DEFAULT_TONE_MAPPING_STATE.toneMapping,
});

type CapturedFailure = { readonly value: unknown };

const captureFailure = (action: () => void): CapturedFailure | undefined => {
  try {
    action();
    return undefined;
  } catch (value) {
    return { value };
  }
};

const captureFirstFailure = (
  firstFailure: CapturedFailure | undefined,
  action: () => void,
): CapturedFailure | undefined => {
  const nextFailure = captureFailure(action);
  return firstFailure ?? nextFailure;
};

const normalizeOptions = (options: WebGlRootOptions = {}): NormalizedWebGlRootOptions => {
  const generatedSvgVirtualTextureMaxDimension = options.generatedSvgVirtualTextureMaxDimension
    ?? GENERATED_SVG_VIRTUAL_TEXTURE_DEFAULT_MAX_DIMENSION;
  if (
    !Number.isSafeInteger(generatedSvgVirtualTextureMaxDimension)
    || generatedSvgVirtualTextureMaxDimension < GENERATED_SVG_VIRTUAL_TEXTURE_MIN_DIMENSION
    || generatedSvgVirtualTextureMaxDimension > GENERATED_SVG_VIRTUAL_TEXTURE_MAX_DIMENSION
  ) {
    throw new RangeError(
      `generatedSvgVirtualTextureMaxDimension must be an integer from ${GENERATED_SVG_VIRTUAL_TEXTURE_MIN_DIMENSION} through ${GENERATED_SVG_VIRTUAL_TEXTURE_MAX_DIMENSION} logical texels, received ${String(generatedSvgVirtualTextureMaxDimension)}`,
    );
  }
  return Object.freeze({
    alpha: options.alpha ?? true,
    antialias: options.antialias ?? true,
    generatedImageVirtualTextures: options.generatedImageVirtualTextures ?? false,
    generatedSvgVirtualTextureMaxDimension,
    resourceGovernorPolicy: defineResourceGovernorPolicy(options.resourceGovernorPolicy),
  });
};

const loadImage = (src: string, signal?: AbortSignal): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const ImageConstructor = globalThis.Image;
  if (ImageConstructor === undefined) {
    reject(new Error(`Image loading is unavailable for texture ${src}`));
    return;
  }

  const image = new ImageConstructor();
  image.crossOrigin = "anonymous";

  const cleanup = (): void => {
    image.removeEventListener("load", onLoad);
    image.removeEventListener("error", onError);
    signal?.removeEventListener("abort", onAbort);
  };
  const onAbort = (): void => {
    cleanup();
    image.src = "";
    closeDecodedTextureSource(image);
    reject(abortError());
  };
  const onLoad = (): void => {
    image.decode().then(() => {
      cleanup();
      resolve(image);
    }, (error: unknown) => {
      cleanup();
      reject(error);
    });
  };
  const onError = (event: Event): void => {
    cleanup();
    const message = "message" in event && typeof event.message === "string"
      ? event.message
      : `Image load failed for ${src}`;
    reject(new Error(message));
  };

  image.addEventListener("load", onLoad);
  image.addEventListener("error", onError);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted === true) {
    onAbort();
    return;
  }
  image.src = src;

  if (image.complete) onLoad();
});

const getNodeKind = (node: RenderNode): string =>
  typeof node === "object" && node !== null && "kind" in node && typeof node.kind === "string"
    ? node.kind
    : "unknown";

const elapsedMs = (start: number | undefined, end: number | undefined): number | undefined =>
  start === undefined || end === undefined ? undefined : Math.max(0, end - start);

/**
 * Minimal Royal WebGL2 renderer root. It implements the descriptor subset used
 * by the contracts while keeping all GPU ownership inside this root.
 */
type InternalWebGlRoot = WebGlRoot & RendererOwnedWebGl2Context & RendererFrameViewLane;

class WebGlRootImpl implements InternalWebGlRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #options: NormalizedWebGlRootOptions;
  readonly #contextCapabilities: WebGlContextCapabilityOwner;
  readonly #frameViews = createFrameViews();
  readonly #renderProjection = identityMat4();
  readonly #renderView = identityMat4();
  readonly #renderViewProjection = identityMat4();
  readonly #renderViewportSize: [number, number] = [0, 0];
  readonly #meshModel = identityMat4();
  readonly #meshViewProjectionModel = identityMat4();
  readonly #context = new WebGlContextLifecycleOwner();
  readonly #framePublication = new WebGlFramePublicationOwner();
  readonly #programArena: ProgramArena;
  readonly #geometryRecipes = new GeometryRecipeRegistry();
  readonly #ordinaryTextures: OrdinaryTextureResidencyController;
  readonly #textureResidencyIntent = new FrameTextureResidencyIntent();
  readonly #decodedTextureSources: DecodedTextureSourceLifetime;
  readonly #virtualTextureGpu: VirtualTextureGpuArena;
  readonly #virtualTextureRuntime: VirtualTextureRuntimeShell;
  readonly #virtualTextureAdmission: VirtualTextureGpuAdmissionOwner;
  readonly #virtualTextureDemand: VirtualTextureDemandOwner;
  readonly #resourceArena: ResourceArena;
  /** Root authority for cross-subsystem resource admission and accounting. */
  readonly #resourceGovernor: ResourceGovernor;
  readonly #unsubscribeResourceGovernorDurableCapacityRelease: () => void;
  readonly #resourceArenaSideEffects = new ResourceArenaSideEffectDebtOwner();
  readonly #capacityWakes = new ResourceCapacityWakeOwner({
    invalidate: () => this.invalidate(),
    wakeCpuCapacity: () => {
      const ordinaryWake = this.#ordinaryTextures.wakeCpuCapacity();
      const preparedAssetWake = wakeResourceArenaPreparedAssetCpuCapacity(this.#resourceArena);
      const virtualTextureWake = this.#virtualTextureRuntime.requests.wakeDecodedCapacity();
      return ordinaryWake || preparedAssetWake || virtualTextureWake;
    },
    wakePersistentGpuCapacity: () => {
      const ordinaryWake = this.#ordinaryTextures.wakeGpuCapacity();
      const iblWake = wakeIblTextureDurablePressure(this.#iblTextures);
      this.#virtualTextureRuntime.scheduleGovernedAdmissionRetry();
      return ordinaryWake || iblWake;
    },
  });
  readonly #vertexInputs: VertexInputArena = createVertexInputArena({
    reserve: (cost) => {
      const reservation = reserveResourceGovernor(this.#resourceGovernor, "geometry", cost);
      return typeof reservation === "string" ? undefined : reservation;
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
        const wakes = [
          () => this.#preparedGltf.scheduler.wake(),
          () => this.#preparedGltf.wakeImages(),
          () => this.#ordinaryTextures.wakeSourceJobs(),
          () => this.#virtualTextureRuntime.requests.drain(),
        ];
        this.#capacityWakes.wakePreparationPeers(wakes);
      },
    };
  };
  readonly #preparedGltf = new PreparedGltfRuntime(2, this.#admitGltfPreparationJob);
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
  readonly #textureHandles: TextureHandleArena;
  readonly #diagnostics = new BoundedDiagnosticLog();
  #disposed = false;
  readonly #iblTextures: IblTextureArena;
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
  readonly #clusteredLights: ClusteredLightArena;
  readonly #scenePlan = new ScenePlanTransactionOwner({
    rebuildTopology: (plan) => this.#rebuildGltfPacketTopology(plan),
    reconcileBulkInstances: (changes) => this.#gltfInstanceTransforms.reconcile(changes),
    reconcileRenderObjectRefs: (plan, changes) => this.#sceneBindings.reconcile(plan, changes),
  });
  readonly #renderClock = new WebGlRenderClockOwner({
    contextGeneration: () => this.#context.generation,
    hasScene: () => this.#scenePlan.latestScene !== undefined,
    isContextActive: () => this.#context.lifecycle === "active",
    renderLatest: () => this.#renderLatestScene(),
    reportScheduledFailure: (failure) => this.#framePublication.reportRenderFailure(failure),
  });
  readonly #pickingController: PickingController;
  readonly #viewport: WebGlCanvasViewportOwner;
  readonly #geometryDrawArena: GeometryDrawArena;
  readonly #surfaceExecution: SurfaceExecutionArena;
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
      releaseClusteredLightContextHandles(this.#clusteredLights);
      this.#configureContextCapabilities(this.#contextCapabilities.validateRestoreAndProbe());
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
  constructor(canvas: HTMLCanvasElement, options?: WebGlRootOptions) {
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
        preparedGltfPrimitives: (node) => {
          const state = this.#preparedGltf.get(gltfRequestKey(node.asset.uri, node.asset.version));
          return state?.status === "ready" ? state.primitives : undefined;
        },
        renderObjectTransform: (node) => this.#sceneBindings.transform(node),
      });
      const requestedOptions = normalizeOptions(options);
      this.#resourceGovernor = createResourceGovernor(requestedOptions.resourceGovernorPolicy);
      this.#preparedGltf.configureCpuOwnership({
        governor: this.#resourceGovernor,
        policy: requestedOptions.resourceGovernorPolicy,
        scheduleCapacityWake: () => this.#capacityWakes.scheduleCpuCapacityWake(),
      });
      this.#gltfPreparation = new GltfAssetPreparationOwner({
        recordDiagnostic: (message, key) => this.#recordDiagnostic(message, key),
        runtime: this.#preparedGltf,
      });
      this.#decodedTextureSources = new DecodedTextureSourceLifetime({
        ordinaryReferenceCount: (source) => resourceArenaSourceReferenceCount(this.#resourceArena, source),
        reserveOrdinaryDecodedBytes: (decodedBytes) => {
          const reservation = reserveResourceGovernor(this.#resourceGovernor, "ordinary-texture", {
            cpuDecodedBytes: decodedBytes,
          });
          if (typeof reservation === "string") {
            const maximum = this.#maximumResourceClassCpuBytes("ordinary-texture");
            throw new ResourceGovernorCpuCapacityError(
              `Decoded texture source retention denied by root resource governor: ${reservation}`,
              decodedBytes > maximum,
            );
          }
          return reservation.commit();
        },
        scheduleRetry: () => this.invalidate(),
      });
      this.#resourceArena = createResourceArena(
        (request, signal) => this.#gltfPreparation.prepare(request.src, request.key, signal),
        () => this.invalidate(),
        { retain: (source) => this.#decodedTextureSources.retainOrdinary(source) },
      );
      registerRollback(() => clearResourceArenaPreparedSources(this.#resourceArena));
      registerRollback(() => { disposeResourceArena(this.#resourceArena); });
      this.#preparedGltf.configureImages(new GltfImageDemandCoordinator({
        admit: this.#admitGltfPreparationJob,
        closeSource: (source) => this.#decodedTextureSources.closeOrdinary(source),
        diagnostic: (message, key) => this.#recordDiagnostic(message, `gltf-image:${key}`),
        invalidate: () => this.invalidate(),
        retainSource: (source) => retainResourceArenaSourceLease(this.#resourceArena, source),
      }));
      registerRollback(() => this.#preparedGltf.disposeImages());
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
        ...requestedOptions,
        ...this.#contextCapabilities.attributes,
      });
      this.#clusteredLights = createClusteredLightArena(gl, {
        replace: (lease, cost) => {
          const reservation = replaceResourceGovernorLease(this.#resourceGovernor, lease, cost);
          return typeof reservation === "string" ? undefined : reservation;
        },
        reserve: (cost) => {
          const reservation = reserveResourceGovernor(this.#resourceGovernor, "render-target", cost);
          return typeof reservation === "string" ? undefined : reservation;
        },
      });
      registerRollback(() => dropClusteredLightContext(this.#clusteredLights));
      registerRollback(() => releaseClusteredLightContextHandles(this.#clusteredLights));
      this.#iblTextures = createIblTextureArena(gl, {
        reserve: (cost) => {
          const policy = requestedOptions.resourceGovernorPolicy;
          if (cost.uploadBytes > policy.limits.uploadBytes) {
            return {
              permanent: true,
              reason: `${cost.uploadBytes} upload bytes exceed the absolute limit ${policy.limits.uploadBytes}`,
            };
          }
          const maximumPersistentBytes = maximumResourceGovernorClassDurableBytes(
            policy,
            "ordinary-texture",
            "persistentGpuBytes",
          );
          if (cost.persistentGpuBytes > maximumPersistentBytes) {
            return {
              permanent: true,
              reason: `${cost.persistentGpuBytes} persistent GPU bytes exceed the ordinary-texture maximum ${maximumPersistentBytes}`,
            };
          }
          const reservation = reserveResourceGovernor(this.#resourceGovernor, "ordinary-texture", cost);
          return typeof reservation === "string"
            ? { permanent: false, reason: reservation }
            : reservation;
        },
      });
      registerRollback(() => dropIblTextureContext(this.#iblTextures));
      registerRollback(() => releaseIblTextureContextHandles(this.#iblTextures));
      this.#lightResolver = new SurfaceLightResolver({
        ensureGltfSpecular: (specular) => this.#ensureIblSpecularTexture(specular),
        studioSpecular: () => this.#studioEnvironmentSpecularTexture(),
      });
      this.#gltfPacketSubmissions = new GltfPacketSubmissionOwner({
        geometryRecipes: this.#geometryRecipes,
        instanceTransforms: this.#gltfInstanceTransforms,
        lightResolver: this.#lightResolver,
        materials: this.#gltfMaterials,
        resourceArena: this.#resourceArena,
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
        packetOccurrence: (plan, occurrenceIndex) => this.#gltfPacketOccurrence(plan, occurrenceIndex),
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
        lifecycle: () => ({
          active: this.#context.lifecycle === "active",
          disposed: this.#disposed,
          generation: this.#context.generation,
        }),
        loadSource: (request, signal) => isSvgUri(request.uri)
          ? loadSvgTextureFromUri(request.uri, signal).then((loadedImage) => loadedImage.image)
          : loadImage(request.uri, signal),
        registerAutoVirtualTextureDecodedSource: (texture, source) => {
          this.#virtualTextureRuntime.registerAutoDecodedSource(texture, source);
        },
        resourceArena: this.#resourceArena,
        textureHandles: this.#textureHandles,
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
      this.#virtualTextureGpu = createVirtualTextureGpuArena(gl, this.#textureHandles, {
        maxPhysicalBytes: maximumResourceGovernorClassDurableBytes(
          this.#options.resourceGovernorPolicy,
          "virtual-texture",
          "persistentGpuBytes",
        ),
      });
      registerRollback(() => dropVirtualTextureGpuContext(this.#virtualTextureGpu));
      this.#virtualTextureRuntime = new VirtualTextureRuntimeShell({
        active: () => !this.#disposed && this.#context.lifecycle === "active",
        admitJob: this.#admitGltfPreparationJob,
        decodedSources: this.#decodedTextureSources,
        diagnostic: (message, key) => this.#recordDiagnostic(message, key),
        disposed: () => this.#disposed,
        frame: () => this.#framePublication.frame,
        generatedImageVirtualTextures: this.#options.generatedImageVirtualTextures,
        generatedSvgVirtualTextureMaxDimension: this.#options.generatedSvgVirtualTextureMaxDimension,
        gpu: this.#virtualTextureGpu,
        invalidate: () => this.invalidate(),
        loadImageSource: (uri, signal) => loadImage(uri, signal),
        maximumDecodedCpuBytes: this.#maximumResourceClassCpuBytes("virtual-texture"),
        resourceGovernor: this.#resourceGovernor,
      });
      this.#virtualTextureAdmission = new VirtualTextureGpuAdmissionOwner({
        capabilities: () => this.#contextCapabilities.capabilities,
        consumeGpuOutcomes: () => this.#consumeVirtualTextureGpuOutcomes(),
        contextGeneration: () => this.#context.generation,
        contextLifecycle: () => this.#context.lifecycle,
        frame: () => this.#framePublication.frame,
        gpu: this.#virtualTextureGpu,
        invalidate: () => this.invalidate(),
        maximumPersistentGpuBytes: maximumResourceGovernorClassDurableBytes(
          this.#options.resourceGovernorPolicy,
          "virtual-texture",
          "persistentGpuBytes",
        ),
        maximumUploadBytes: this.#options.resourceGovernorPolicy.limits.uploadBytes,
        resourceGovernor: this.#resourceGovernor,
        runtime: this.#virtualTextureRuntime,
        suppressPersistentGpuWake: () => this.#capacityWakes.suppressPersistentGpuWake(),
        synchronizeResourceGovernorObservations: () => this.#synchronizeResourceGovernorObservations(),
        wakePersistentGpuCapacity: () => this.#capacityWakes.wakePersistentGpuCapacity(),
      });
      this.#virtualTextureDemand = new VirtualTextureDemandOwner({
        consumeGpuOutcomes: () => this.#consumeVirtualTextureGpuOutcomes(),
        ensureGpuResource: (state, manifest, demandedStates) => (
          this.#virtualTextureAdmission.ensure(state, manifest, demandedStates)
        ),
        frame: () => this.#framePublication.frame,
        gpu: this.#virtualTextureGpu,
        recordUnsupported: (texture, reason) => this.#recordUnsupportedVirtualTexture(texture, reason),
        runtime: this.#virtualTextureRuntime,
      });
      this.#geometryDrawArena = createGeometryDrawArena(gl, this.#vertexInputs);
      registerRollback(() => clearGeometryDrawArenaContext(this.#geometryDrawArena));
      this.#programArena = createProgramArena(gl);
      registerRollback(() => dropProgramArenaContext(this.#programArena));
      registerRollback(() => releaseProgramArenaContextHandles(this.#programArena));
      this.#surfaceExecution = new SurfaceExecutionArena({
        clusteredLights: this.#clusteredLights,
        geometry: this.#geometryDrawArena,
        gl,
        gltfFrames: this.#gltfPacketSubmissions.frameBatches,
        iblTextures: this.#iblTextures,
        ordinaryTextures: this.#ordinaryTextures,
        programs: this.#programArena,
        renderTargets: this.#surfaceRenderTargets,
        textureResidencyIntent: this.#textureResidencyIntent,
        virtualTextures: this.#virtualTextureGpu,
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
    configureClusteredLightArena(
      this.#clusteredLights,
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

  get frame(): number {
    return this.#framePublication.frame;
  }

  get latestScene(): RenderRoot | undefined {
    return this.#scenePlan.latestScene;
  }

  get options(): NormalizedWebGlRootOptions {
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
    beginResourceGovernorFrame(this.#resourceGovernor);
    this.#preparedAssetEvents.applyPending();
    const gl = this.#gl;
    let renderFailure: CapturedFailure | undefined;
    this.#virtualTextureRuntime.beginFrame();
    this.#textureResidencyIntent.beginFrame();
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameViews.framebuffer);
      prepareFrameBaseline(gl, frameViews.scissor);
      this.#stageReadyGltfImages();
      this.#processOrdinaryTextureUploads();
      this.#gltfInstanceTransforms.beginFrame();
      const wantsHdr = this.#planWantsHdr(plan);
      if (wantsHdr && !this.#contextCapabilities.capabilities.hdrColorBuffer) {
        throw new Error("Royal physical lighting requires EXT_color_buffer_float");
      }
      const useHdr = wantsHdr && this.#contextCapabilities.capabilities.hdrColorBuffer;
      const surfaceLights = this.#lightResolver.resolveScene(
        plan.environment,
        this.#scenePlan.sceneSurfaceLights,
        this.#scenePlan.sceneSurfaceLightSet,
      );
      const toneMapping = { ...sceneToneMappingState(plan), hdrOutput: useHdr };
      this.#gltfPacketSelection.prepareFrame(plan, frameViews);
      this.#gltfPacketSubmissions.beginFrame(plan.revision);
      for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
        this.#virtualTextureRuntime.beginView(viewIndex);
        gl.enable(gl.DEPTH_TEST);
        const viewportOffset = viewIndex * 4;
        const x = frameViews.viewports[viewportOffset]!;
        const y = frameViews.viewports[viewportOffset + 1]!;
        const width = frameViews.viewports[viewportOffset + 2]!;
        const height = frameViews.viewports[viewportOffset + 3]!;
        const hdrTarget = useHdr
          ? ensureHdrRenderTarget(this.#surfaceRenderTargets, gl, width, height)
          : undefined;
        gl.bindFramebuffer(gl.FRAMEBUFFER, hdrTarget?.framebuffer ?? frameViews.framebuffer);
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
        const flushGltfPacketSubmissions = (): void => {
          if (this.#gltfPacketSubmissions.submissionCount === 0) return;
          this.#drawGltfPacketSubmissions(
            projection,
            view,
            surfaceLights,
            toneMapping,
            viewportSize,
            sourceX,
            sourceY,
          );
          this.#gltfPacketSubmissions.resetSegment(
            plan.revision,
            this.#gltfPacketSubmissions.segment,
          );
        };

        for (let nodeIndex = 0; nodeIndex < plan.nodes.length; nodeIndex += 1) {
          const node = plan.nodes[nodeIndex]!;
          if (node.kind === "directional-light" || node.kind === "point-light" || node.kind === "spot-light") continue;
          if (node.kind === "gltf" || node.kind === "gltf-instances") {
            const orderingSegment = plan.orderSegments[nodeIndex]!;
            if (this.#gltfPacketSubmissions.segment !== orderingSegment) {
              flushGltfPacketSubmissions();
              this.#gltfPacketSubmissions.resetSegment(plan.revision, orderingSegment);
            }
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
          flushGltfPacketSubmissions();
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
        flushGltfPacketSubmissions();
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
        }
      }
    } catch (value) {
      renderFailure = { value };
    }
    renderFailure = captureFirstFailure(renderFailure, () => this.#consumeSurfaceExecutionSignals());
    renderFailure = captureFirstFailure(
      renderFailure,
      () => this.#gltfInstanceTransforms.endFrame(renderFailure === undefined),
    );
    renderFailure = captureFirstFailure(renderFailure, () => {
      this.#gltfPacketSubmissions.releaseUnused(this.#gl, this.#context.generation);
    });
    renderFailure = captureFirstFailure(
      renderFailure,
      () => endClusteredLightFrame(this.#clusteredLights, this.#framePublication.frame),
    );
    renderFailure = captureFirstFailure(
      renderFailure,
      () => this.#virtualTextureDemand.finishFrame(renderFailure === undefined),
    );
    if (renderFailure === undefined) {
      renderFailure = captureFirstFailure(renderFailure, () => this.#processVirtualTextureGpuUploads());
    }
    renderFailure = captureFirstFailure(
      renderFailure,
      () => this.#finalizeTextureResidencyIntent(renderFailure === undefined),
    );
    renderFailure = captureFirstFailure(renderFailure, () => this.#framePublication.advance());
    renderFailure = captureFirstFailure(renderFailure, () => this.#virtualTextureRuntime.requests.drain());
    renderFailure = captureFirstFailure(renderFailure, () => {
      if (virtualTextureGpuHasActionableUploads(this.#virtualTextureGpu)) this.invalidate();
    });
    // The renderer exclusively owns its context, but leaving vertex-input
    // bindings neutral makes frame teardown explicit. The EAB is VAO state,
    // so select the default VAO before clearing it.
    let normalizationFailure: CapturedFailure | undefined;
    if (frameViews.scissor) {
      normalizationFailure = captureFirstFailure(
        normalizationFailure,
        () => gl.disable(gl.SCISSOR_TEST),
      );
    }
    normalizationFailure = captureFirstFailure(
      normalizationFailure,
      () => gl.bindFramebuffer(gl.FRAMEBUFFER, null),
    );
    normalizationFailure = captureFirstFailure(normalizationFailure, () => gl.bindVertexArray(null));
    normalizationFailure = captureFirstFailure(
      normalizationFailure,
      () => gl.bindBuffer(gl.ARRAY_BUFFER, null),
    );
    normalizationFailure = captureFirstFailure(
      normalizationFailure,
      () => gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null),
    );
    if (renderFailure !== undefined) throw renderFailure.value;
    if (normalizationFailure !== undefined) throw normalizationFailure.value;
    this.#framePublication.publishFrame();
  }

  invalidate(): void {
    this.#renderClock.invalidate();
  }

  flushInvalidated(): void {
    this.#renderClock.flushInvalidated();
  }

  pick(input: PickInput): PickResult | undefined {
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
    const releaseWakeSuppression = this.#capacityWakes.suppressPersistentGpuWake();
    try {
    const ordinaryReport = this.#ordinaryTextures.dropContext();
    let releaseFailure = ordinaryReport.operationFailure === undefined
      ? undefined
      : { value: ordinaryReport.operationFailure.error };
    releaseFailure = captureFirstFailure(releaseFailure, () => {
      const settlement = this.#ordinaryTextures.settleGpuReport(ordinaryReport);
      if (settlement !== undefined) throw settlement.error;
    });
    releaseFailure = captureFirstFailure(releaseFailure, () => {
      dropVirtualTextureGpuContext(this.#virtualTextureGpu);
    });
    releaseFailure = captureFirstFailure(
      releaseFailure,
      () => this.#synchronizeResourceGovernorObservations(),
    );
    releaseFailure = captureFirstFailure(releaseFailure, () => this.#virtualTextureRuntime.releaseAllGpuLeases());
    if (deleteResources) {
      const gl = this.#gl;
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        releaseVertexInputContextHandles(this.#vertexInputs, gl, contextGeneration);
      });
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        releaseSurfaceRenderTargetContextHandles(this.#surfaceRenderTargets, gl);
      });
      releaseFailure = captureFirstFailure(releaseFailure, () => releaseProgramArenaContextHandles(this.#programArena));
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        releaseClusteredLightContextHandles(this.#clusteredLights);
      });
      releaseFailure = captureFirstFailure(releaseFailure, () => releaseIblTextureContextHandles(this.#iblTextures));
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
      releaseFailure = captureFirstFailure(releaseFailure, () => dropClusteredLightContext(this.#clusteredLights));
    }
    releaseFailure = captureFirstFailure(releaseFailure, () => dropIblTextureContext(this.#iblTextures));
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

    releaseFailure = captureFirstFailure(releaseFailure, () => this.#virtualTextureRuntime.loseContext());
    if (releaseFailure !== undefined) throw releaseFailure.value;
    } finally {
      releaseWakeSuppression();
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
        releaseClusteredLightContextHandles(this.#clusteredLights);
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
      teardown(() => this.#releaseOrdinaryTexture(key));
    }
    for (const state of this.#virtualTextureRuntime.resources.values()) {
      teardown(() => this.#releaseVirtualTextureState(state));
    }
    teardown(() => clearGeometryDrawArenaContext(this.#geometryDrawArena));
    this.#geometryRecipes.clearRetainedRecipes();
    this.#virtualTextureDemand.clear();
    this.#geometryRecipes.clearPacketPrimitives();
    teardown(() => clearResourceArenaPreparedSources(this.#resourceArena));
    this.#virtualTextureRuntime.clearAutoMetadata();
    teardown(() => this.#preparedGltf.dispose());
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
    const textureResidency = this.#textureResidencySnapshot();
    const virtualTexturing = this.#virtualTexturingSnapshot();
    const gltfImages = this.#preparedGltf.images.snapshot();
    return {
      context: this.#context.snapshot(),
      diagnostics: diagnostics.messages,
      diagnosticStats: {
        capacity: diagnostics.capacity,
        dropped: diagnostics.dropped,
        occurrences: diagnostics.occurrences,
        retained: diagnostics.retained,
      },
      disposed: this.#disposed,
      frame: this.#framePublication.frame,
      gltfLoadDiagnostics: this.#gltfLoadDiagnosticsSnapshot(),
      gltfInstancing: this.#gltfInstancingSnapshot(),
      latestScene: this.#scenePlan.latestScene,
      options: this.#options,
      planning: this.#scenePlan.planningSnapshot(),
      resourceLifetime: {
        ...resourceArenaCountersSnapshot(this.#resourceArena),
        gltfPreparationQueueHighWater: this.#preparedGltf.scheduler.snapshot().queueHighWater,
        imageQueueHighWater: gltfImages.ordinaryQueueHighWater,
        iblImageQueueHighWater: gltfImages.iblQueueHighWater,
      },
      resourceGovernor: resourceGovernorSnapshot(this.#resourceGovernor),
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
    this.#preparedGltf.sharedViewLods.resetPlan();
    const resourceFailure = captureFailure(
      () => this.#applyResourceArenaChanges(commit.resourceChanges),
    );
    this.#scenePlan.finishReconciliation(resourceFailure);
    return commit.plan;
  }

  #gltfPacketPreparedPrimitives(
    node: AnyGltfNode,
    state: GltfState,
    renderInstanceOrdinal: number,
  ): readonly GltfPacketPreparedPrimitive[] {
    const outerCount = node.kind === "gltf-instances" ? node.instances.count : 1;
    const selectedVariantIndex = state.hasMaterialVariants
      ? selectedGltfVariantIndex(state.variants, node.variant)
      : undefined;
    return state.primitives.map((primitive) => {
      const retainedGeometry = this.#geometryRecipes.retainedGltfRecipe(primitive);
      if (retainedGeometry === undefined) {
        throw new Error(`Royal glTF primitive geometry ${primitive.key} was not retained for packets`);
      }
      this.#geometryRecipes.bindPacketPrimitive(retainedGeometry.id, primitive);
      const primitiveMaterial = selectedVariantIndex === undefined
        ? primitive.baseMaterial
        : gltfPrimitiveMaterialForVariant(selectedVariantIndex, primitive);
      const materialLod = primitiveMaterial.materialLod;
      const materialAlternatives = materialLod === undefined
        ? [{ material: primitiveMaterial.material }]
        : materialLod.levels.map((material, level) => ({ level, material }));
      const renderInstanceKey = (outerIndex: number): string => node.kind === "gltf-instances"
        ? `instance:${renderInstanceOrdinal}:${outerIndex}`
        : `instance:${renderInstanceOrdinal}`;
      const materialLodSelectionIds = materialLod === undefined
        ? undefined
        : Array.from({ length: outerCount * primitive.localModels.length }, (_, index) => {
            const outerIndex = Math.floor(index / primitive.localModels.length);
            const localIndex = index % primitive.localModels.length;
            return this.#preparedGltf.sharedViewLods.materialSelectionId(
              state.key,
              gltfMaterialLodSelectionKey(
                state,
                renderInstanceKey(outerIndex),
                primitive,
                primitiveMaterial,
                localIndex,
              ),
              materialLod,
            );
          });
      const nodeLod = primitive.nodeLod === undefined
        ? undefined
        : {
            level: primitive.nodeLod.level,
            selectionIds: Array.from({ length: outerCount }, (_, outerIndex) =>
              this.#preparedGltf.sharedViewLods.nodeSelectionId(
                state.key,
                `${state.key}:${renderInstanceKey(outerIndex)}:node:${primitive.nodeLod!.group}`,
                primitive.nodeLod!,
                state.primitives,
              )),
          };
      return {
        geometryId: retainedGeometry.id,
        localBounds: primitive.localBounds,
        localModelDeterminants: primitive.localModelDeterminants,
        localModels: primitive.localModels,
        materialAlternatives,
        ...(materialLodSelectionIds === undefined ? {} : { materialLodSelectionIds }),
        ...(nodeLod === undefined ? {} : { nodeLod }),
      };
    });
  }

  #gltfPacketOccurrence(
    plan: FramePlan,
    topologyOccurrenceIndex: number,
  ): GltfPacketOccurrence {
    const row = plan.gltfRequestRows[topologyOccurrenceIndex]!;
    const node = plan.nodes[row.nodeIndex] as AnyGltfNode;
    const state = this.#preparedGltf.get(row.requestKey);
    const primitives = state?.status === "ready"
      ? this.#gltfPacketPreparedPrimitives(node, state, topologyOccurrenceIndex)
      : undefined;
    return {
      kind: node.kind,
      occurrenceIndex: topologyOccurrenceIndex,
      orderingSegment: plan.orderSegments[row.nodeIndex]!,
      outerCount: node.kind === "gltf-instances" ? node.instances.count : 1,
      planOccurrenceIndex: row.nodeIndex,
      ...(primitives === undefined ? {} : { primitives }),
    };
  }

  #rebuildGltfPacketTopology(plan: FramePlan): void {
    this.#geometryRecipes.clearPacketPrimitives();
    this.#preparedGltf.rebuildPacketTopology(
      plan.revision,
      plan.gltfRequestRows.map((row) => row.requestKey),
      plan.gltfRequestRows.map((_, index) => this.#gltfPacketOccurrence(plan, index)),
    );
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
        () => this.#virtualTextureDemand.releaseGeometry(id),
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
      apply("release", () => this.#releaseOrdinaryTexture(key));
    }
    for (const key of changes.releasedVirtualTextureKeys) {
      apply("release", () => this.#releaseVirtualTexture(key));
    }
    for (const key of changes.releasedIblKeys) {
      apply("release", () => releaseGltfIblSpecularTexture(this.#iblTextures, key));
    }
    for (const source of changes.releasedSources) {
      if (resourceArenaSourceReferenceCount(this.#resourceArena, source) !== 0) continue;
      apply("release", () => this.#decodedTextureSources.closeOrdinary(source));
    }
    this.#resourceArenaSideEffects.drain();
  }

  #releaseOrdinaryTexture(key: string): void {
    let releaseFailure = captureFailure(() => this.#releaseAutoVirtualTextures(key));
    this.#virtualTextureRuntime.releaseAutoMetadata(key);
    const releaseWakeSuppression = this.#capacityWakes.suppressPersistentGpuWake();
    let report: ReturnType<OrdinaryTextureResidencyController["release"]> | undefined;
    try {
      report = this.#ordinaryTextures.release(key);
      if (report.operationFailure !== undefined) {
        releaseFailure ??= { value: report.operationFailure.error };
      }
      releaseFailure = captureFirstFailure(
        releaseFailure,
        () => this.#synchronizeResourceGovernorObservations(),
      );
    } finally {
      releaseWakeSuppression();
    }
    if (report?.capacityReleased === true) this.#capacityWakes.wakePersistentGpuCapacity();
    if (report !== undefined) releaseFailure = captureFirstFailure(releaseFailure, () => {
      const settlement = this.#ordinaryTextures.settleGpuReport(report);
      if (settlement !== undefined) throw settlement.error;
    });
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  #releaseAutoVirtualTextures(textureKey: string): void {
    const prefix = `auto-base-color:${textureKey}:`;
    let releaseFailure: CapturedFailure | undefined;
    for (const [key, state] of this.#virtualTextureRuntime.resources) {
      if (!key.startsWith(prefix)) continue;
      releaseFailure = captureFirstFailure(releaseFailure, () => this.#releaseVirtualTextureState(state));
    }
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  #releaseVirtualTexture(key: string): void {
    const state = this.#virtualTextureRuntime.get(key);
    if (state === undefined) return;
    this.#releaseVirtualTextureState(state);
  }

  #releaseVirtualTextureState(state: VirtualTextureRuntimeState): void {
    let releaseFailure: CapturedFailure | undefined;
    releaseFailure = captureFirstFailure(releaseFailure, () => this.#virtualTextureRuntime.forget(state));
    releaseFailure = captureFirstFailure(
      releaseFailure,
      () => this.#virtualTextureAdmission.release(state, true),
    );
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  #drawNode(
    node: RenderNode,
    projection: Mat4,
    view: Mat4,
    viewProjection: Mat4,
    sceneLights: SurfaceLightSet | undefined,
    toneMapping: SceneToneMappingState,
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

  #planWantsHdr(plan: FramePlan): boolean {
    if (
      plan.environment !== undefined
      || plan.exposureEv100 !== undefined
      || plan.toneMapping === "aces-fitted"
      || plan.toneMapping === "pbr-neutral"
      || plan.lightNodes.length > 0
    ) return true;
    return resourceArenaHasHdrReadyAsset(this.#resourceArena);
  }

  #drawMesh(
    node: MeshNode,
    projection: Mat4,
    view: Mat4,
    viewProjection: Mat4,
    lights: SurfaceLightSet | undefined,
    toneMapping: SceneToneMappingState,
    viewportSize: ViewportSize,
  ): void {
    const retainedGeometry = this.#geometryRecipes.retainedDirectRecipe(node.geometry, node.material);
    const cpu = retainedGeometry.recipe;
    const model = transformMat4Into(this.#meshModel, this.#sceneBindings.transform(node));
    const localBounds = this.#geometryRecipes.localBounds(cpu);
    if (!isBoundsVisible(
      localBounds,
      multiplyMat4Into(this.#meshViewProjectionModel, viewProjection, model),
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
    toneMapping: SceneToneMappingState,
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

  #drawGltfPrimitiveDrawBatch(
    batch: GltfFrameDrawBatch,
    projection: Mat4,
    view: Mat4,
    toneMapping: SceneToneMappingState,
    viewportSize: ViewportSize,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    const modelSource: VirtualTextureDrawDemandModelSource = batch.localModels.length === 1
      ? { kind: "single", model: multiplyMat4(batch.rootModels[0]!, batch.localModels[0]!) }
      : { kind: "composed", localModels: batch.localModels, rootModels: batch.rootModels };
    const baseColorResidency = this.#virtualTextureDemand.resolveBaseColorResidency(
      batch.geometry,
      batch.material,
      this.#virtualTextureDemand.drawDemandContext(
        batch.geometryId,
        batch.cpuGeometry,
        batch.material,
        modelSource,
        projection,
        view,
        viewportSize,
      ),
    );
    this.#surfaceExecution.executeGltfBatch({
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
    });
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
    toneMapping: SceneToneMappingState,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    cpuGeometry: CpuGeometry,
  ): void {
    const baseColorResidency = this.#virtualTextureDemand.resolveBaseColorResidency(
      geometry,
      material,
      this.#virtualTextureDemand.drawDemandContext(
        geometryId,
        cpuGeometry,
        material,
        { kind: "single", model },
        projection,
        view,
        viewportSize,
      ),
    );
    this.#surfaceExecution.executeSingle({
      baseColorResidency,
      contextGeneration: this.#context.generation,
      frame: this.#framePublication.frame,
      geometry,
      geometryId,
      lights,
      material,
      model,
      projection,
      toneMapping,
      transmissionScreenColorTexture,
      view,
      viewportSize,
    });
  }

  #maximumResourceClassCpuBytes(resourceClass: ResourceGovernorClass): number {
    const policy = this.#options.resourceGovernorPolicy;
    return maximumResourceGovernorClassDurableBytes(policy, resourceClass, "cpuDecodedBytes");
  }

  #maximumResourceClassPersistentGpuBytes(resourceClass: ResourceGovernorClass): number {
    const policy = this.#options.resourceGovernorPolicy;
    return maximumResourceGovernorClassDurableBytes(policy, resourceClass, "persistentGpuBytes");
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

  #consumeVirtualTextureGpuOutcomes(): void {
    let firstFailure = captureFailure(() => this.#decodedTextureSources.retryPendingVirtualTexture());
    const outcomeCount = virtualTextureGpuOutcomeCount(this.#virtualTextureGpu);
    for (let index = 0; index < outcomeCount; index += 1) {
      const outcome = virtualTextureGpuOutcome(this.#virtualTextureGpu, index);
      if (outcome === undefined) continue;
      const state = this.#virtualTextureRuntime.get(outcome.key);
      if (state !== undefined && outcome.upload.sourceGeneration === state.sourceGeneration) {
        this.#virtualTextureRuntime.requests.settleGpuPage(state, outcome.upload.pageKey);
      }
      firstFailure = captureFirstFailure(firstFailure, () => {
        this.#decodedTextureSources.closeVirtualTexture(outcome.upload.image);
      });
    }
    clearVirtualTextureGpuOutcomes(this.#virtualTextureGpu);
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  #processVirtualTextureGpuUploads(): void {
    const gpuFailure = captureFailure(() => {
      processVirtualTextureGpuUploads(this.#virtualTextureGpu, this.#framePublication.frame, {
        reserve: (uploadBytes) => {
          const reserved = reserveResourceGovernor(this.#resourceGovernor, "virtual-texture", {
            uploadBytes,
          });
          if (typeof reserved === "string") return undefined;
          return {
            cancel: () => { reserved.cancel(); },
            commit: () => { reserved.commit().release(); },
          };
        },
      });
    });
    const closeFailure = captureFailure(() => this.#consumeVirtualTextureGpuOutcomes());
    if (consumeVirtualTextureGpuWake(this.#virtualTextureGpu)) this.invalidate();
    if (gpuFailure !== undefined) throw gpuFailure.value;
    if (closeFailure !== undefined) throw closeFailure.value;
  }

  #finalizeTextureResidencyIntent(commit: boolean): void {
    const suppressions = this.#textureResidencyIntent.finishFrame(commit);
    if (suppressions.length === 0) return;
    const releaseWakeSuppression = this.#capacityWakes.suppressPersistentGpuWake();
    let capacityReleased = false;
    let firstFailure: CapturedFailure | undefined;
    try {
      for (const key of suppressions) {
        let report: ReturnType<OrdinaryTextureResidencyController["suppressGpuResidency"]> | undefined;
        firstFailure = captureFirstFailure(firstFailure, () => {
          report = this.#ordinaryTextures.suppressGpuResidency(key);
          capacityReleased ||= report.capacityReleased;
          if (report.operationFailure !== undefined) throw report.operationFailure.error;
        });
        const settledReport = report;
        if (settledReport !== undefined) firstFailure = captureFirstFailure(firstFailure, () => {
          const settlement = this.#ordinaryTextures.settleGpuReport(settledReport);
          if (settlement !== undefined) throw settlement.error;
        });
      }
      firstFailure = captureFirstFailure(
        firstFailure,
        () => this.#synchronizeResourceGovernorObservations(),
      );
    } finally {
      releaseWakeSuppression();
    }
    if (capacityReleased) this.#capacityWakes.wakePersistentGpuCapacity();
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  #processOrdinaryTextureUploads(): void {
    const releaseWakeSuppression = this.#capacityWakes.suppressPersistentGpuWake();
    let report!: ReturnType<OrdinaryTextureResidencyController["process"]>;
    let processFailure: CapturedFailure | undefined;
    try {
      report = this.#ordinaryTextures.process(
        this.#framePublication.frame,
        this.#context.generation,
        {
          reserve: (cost) => {
            const limits = this.#options.resourceGovernorPolicy.limits;
            const persistentGpuMaximum = this.#maximumResourceClassPersistentGpuBytes("ordinary-texture");
            if (cost.persistentGpuBytes > persistentGpuMaximum) {
              return {
                limit: persistentGpuMaximum,
                reason: "persistent-gpu-cost-exceeds-limit" as const,
              };
            }
            const uploadLimit = limits.uploadBytes;
            if (cost.uploadBytes > uploadLimit) {
              return { limit: uploadLimit, reason: "upload-cost-exceeds-limit" };
            }
            const reserved = reserveResourceGovernor(this.#resourceGovernor, "ordinary-texture", cost);
            if (typeof reserved !== "string") {
              return {
                cancel: () => { reserved.cancel(); },
                commit: () => reserved.commit(),
              };
            }
            switch (reserved) {
              case "persistent-gpu-capacity":
              case "persistent-gpu-hard-limit":
              case "persistent-gpu-mandatory-floor":
              case "upload-capacity":
                return { reason: reserved };
              default:
                throw new Error(`Unexpected ordinary texture admission denial: ${reserved}`);
            }
          },
        },
      );
      processFailure = report.operationFailure === undefined
        ? undefined
        : { value: report.operationFailure.error };
      processFailure = captureFirstFailure(
        processFailure,
        () => this.#synchronizeResourceGovernorObservations(),
      );
    } finally {
      releaseWakeSuppression();
    }
    if (
      processFailure !== undefined
      && report.quarantinedBytesAfter === report.quarantinedBytesBefore
    ) {
      this.#capacityWakes.wakePersistentGpuCapacity();
    }
    const settlement = this.#ordinaryTextures.settleGpuReport(report);
    if (report.wakeRequested) this.invalidate();
    if (processFailure !== undefined) throw processFailure.value;
    if (settlement !== undefined) throw settlement.error;
  }

  #recordUnsupportedGltfImageBasedLight(message: string): void {
    this.#recordDiagnostic(message, `gltf-image-based-light:${message}`);
  }

  #ensureIblSpecularTexture(specular: SurfaceImageBasedLightSpecular): IblSpecularTextureResource {
    try {
      const resource = ensureGltfIblSpecularTexture(
        this.#iblTextures,
        specular,
        resourceArenaIblSources(this.#resourceArena, specular.key) ?? EMPTY_IBL_SOURCES,
      );
      if (resource.unsupportedMessage !== undefined) {
        this.#recordUnsupportedGltfImageBasedLight(resource.unsupportedMessage);
      }
      if (resource.uploadError !== undefined) throw resource.uploadError;
      return resource;
    } finally {
      this.#consumeIblTextureSignals();
    }
  }

  #settleIblSpecularImage(
    specular: SurfaceImageBasedLightSpecular,
    key: string,
    image: LoadedTextureSource,
  ): void {
    const previous = retainResourceArenaIblSource(this.#resourceArena, specular.key, key, image);
    markGltfIblSpecularTextureDirty(this.#iblTextures, specular.key);
    if (
      previous !== undefined
      && previous !== image
      && resourceArenaSourceReferenceCount(this.#resourceArena, previous) === 0
    ) this.#decodedTextureSources.closeOrdinary(previous);
    if (this.#context.lifecycle !== "active") return;
    try {
      const resource = ensureGltfIblSpecularTexture(
        this.#iblTextures,
        specular,
        resourceArenaIblSources(this.#resourceArena, specular.key) ?? EMPTY_IBL_SOURCES,
      );
      if (resource.unsupportedMessage !== undefined) {
        this.#recordUnsupportedGltfImageBasedLight(resource.unsupportedMessage);
      }
      const uploadError = resource.uploadError;
      if (uploadError === undefined) return;
      const uploadErrorMessage = uploadError instanceof Error
        ? uploadError.message
        : typeof uploadError === "string" ? uploadError : "unknown driver error";
      this.#recordDiagnostic(
        `glTF image-based light upload failed: ${uploadErrorMessage}`,
        `gltf-image-based-light-upload:${specular.key}`,
      );
    } catch (error) {
      this.#recordDiagnostic(
        `glTF image-based light upload failed: ${error instanceof Error ? error.message : String(error)}`,
        `gltf-image-based-light-upload:${specular.key}`,
      );
    } finally {
      this.#consumeIblTextureSignals();
    }
  }

  #studioEnvironmentSpecularTexture(): StudioEnvironmentSpecularResource | undefined {
    try {
      return ensureStudioEnvironmentSpecularTexture(this.#iblTextures);
    } finally {
      this.#consumeIblTextureSignals();
    }
  }

  #consumeIblTextureSignals(): void {
    for (const message of consumeIblTextureDiagnostics(this.#iblTextures)) {
      this.#recordDiagnostic(message, `ibl-governor:${message}`);
    }
    if (consumeIblTextureFrameWake(this.#iblTextures)) this.invalidate();
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

  #stageReadyGltfImages(): void {
    const outcomes = this.#preparedGltf.images.pendingReadyOutcomes();
    if (outcomes.length === 0) return;
    for (const outcome of outcomes) {
      const state = this.#preparedGltf.get(outcome.assetKey);
      if (
        state === undefined
        || state.status !== "ready"
        || state.instanceKey !== outcome.stateInstanceKey
      ) {
        outcome.acknowledge();
        continue;
      }
      if (!outcome.referencesRekeyed) {
        const rekeys: PreparedAssetOrdinaryTextureRekey[] = [];
        for (const binding of outcome.bindings) {
          if (binding.contentKey !== undefined || outcome.contentKey === undefined) continue;
          const previousTexture: TextureAssetUploadRef = {
            colorSpace: binding.colorSpace,
            flipY: false,
            kind: "asset",
            ...(binding.sampler === undefined ? {} : { sampler: binding.sampler }),
            uri: binding.textureUri,
          };
          const nextTexture: TextureAssetUploadRef = {
            ...previousTexture,
            contentKey: outcome.contentKey,
          };
          rekeys.push({
            next: { count: binding.count, key: textureCacheKey(nextTexture), texture: nextTexture },
            previous: { count: binding.count, key: textureCacheKey(previousTexture), texture: previousTexture },
          });
        }
        const changes = rekeyPreparedAssetOrdinaryTextures(this.#resourceArena, outcome.assetKey, rekeys);
        // The arena mutation above is the semantic commit. Record it before
        // running fallible side effects so a retry never applies the same
        // reference delta twice.
        outcome.markReferencesRekeyed();
        this.#applyResourceArenaChanges(changes);
      }
      if (outcome.contentKey !== undefined) {
        // Idempotent on retry and deliberately outside the rekey checkpoint:
        // a failure while draining rekey side effects must not suppress this
        // identity publication on the next attempt.
        for (const binding of outcome.bindings) {
          if (binding.contentKey !== undefined) continue;
          publishResourceArenaContentKey(
            this.#resourceArena,
            outcome.assetKey,
            binding.textureUri,
            outcome.contentKey,
          );
        }
      }
      for (const binding of outcome.bindings) {
        const contentKey = binding.contentKey ?? outcome.contentKey;
        const texture: TextureAssetUploadRef = {
          colorSpace: binding.colorSpace,
          ...(contentKey === undefined ? {} : { contentKey }),
          flipY: false,
          kind: "asset",
          ...(binding.sampler === undefined ? {} : { sampler: binding.sampler }),
          uri: binding.textureUri,
        };
        this.#ordinaryTextures.publishPrepared(texture, outcome.source);
      }
      if (outcome.iblSpecular !== undefined) {
        this.#settleIblSpecularImage(outcome.iblSpecular, outcome.key, outcome.source);
      }
      this.#gltfMaterials.invalidate(outcome.materials);
      outcome.acknowledge();
    }
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

  #presentHdrRenderTarget(
    target: HdrRenderTarget,
    destination: WebGLFramebuffer | null,
    x: number,
    y: number,
    width: number,
    height: number,
    toneMapping: SceneToneMappingState,
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
      toneMapping.toneMapping === "aces-fitted" ? 1 : toneMapping.toneMapping === "pbr-neutral" ? 2 : 0,
      toneMapping.exposure,
    );
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  #recordDiagnostic(message: string, key = message): void {
    const result = this.#diagnostics.record(key, message);
    if (result === "appended") console.warn(this.#diagnostics.latestMessage);
  }

  #gltfInstancingSnapshot(): WebGlGltfInstancingSnapshot {
    return this.#gltfPacketSubmissions.snapshot();
  }

  #gltfLoadDiagnosticsSnapshot(): WebGlGltfLoadDiagnosticsSnapshot {
    const assets = [...this.#preparedGltf.states.values()].map((state): WebGlGltfLoadDiagnosticsAssetSnapshot => {
      const load = state.load;
      const phaseMs: Partial<Record<WebGlGltfLoadDiagnosticsPhaseKey, number>> = {};
      const addPhase = (
        key: WebGlGltfLoadDiagnosticsPhaseKey,
        start: number | undefined,
        end: number | undefined,
      ): void => {
        const duration = elapsedMs(start, end);
        if (duration !== undefined) phaseMs[key] = duration;
      };
      addPhase("buffers", load.documentLoadedAt, load.buffersLoadedAt);
      addPhase("document", load.startedAt, load.documentLoadedAt);
      addPhase("draco", load.meshoptDecodedAt, load.dracoDecodedAt);
      addPhase("firstImageComplete", load.imageLoadStartedAt, load.firstImageSettledAt);
      addPhase("imagesComplete", load.imageLoadStartedAt, load.imagesSettledAt);
      addPhase("meshopt", load.buffersLoadedAt, load.meshoptDecodedAt);
      addPhase("scene", load.dracoDecodedAt, load.sceneReadAt);
      addPhase("toSceneReady", load.startedAt, load.readyAt);

      return {
        ...(state.error === undefined ? {} : { error: state.error }),
        imageFailures: load.imageFailures,
        imageLoaded: load.imageLoaded,
        imageRequests: load.imageRequests,
        lightCount: state.lights.length,
        nodeCount: state.nodeCount,
        phaseMs,
        primitiveCount: state.primitives.length,
        sourceUri: state.sourceUri,
        ...(state.sourceVersion === undefined ? {} : { sourceVersion: state.sourceVersion }),
        status: state.status === "ready" ? "sceneReady" : state.status,
        variantCount: state.variants.length,
      };
    });

    return {
      assets,
      errorAssets: assets.filter((asset) => asset.status === "error").length,
      loadingAssets: assets.filter((asset) => asset.status === "loading").length,
      sceneReadyAssets: assets.filter((asset) => asset.status === "sceneReady").length,
    };
  }

  #textureResidencySnapshot(): WebGlTextureResidencySnapshot {
    const sources = new Set<LoadedTextureSource>();
    for (const prepared of resourceArenaPreparedSourceValues(this.#resourceArena)) {
      sources.add(prepared.source);
    }
    let preparedBytes = 0;
    for (const source of sources) {
      if (isDecodedRgbaTexture(source)) preparedBytes += source.data.byteLength;
      else {
        const [width, height] = loadedTextureSourceSize(source);
        if (Number.isFinite(width) && Number.isFinite(height)) {
          preparedBytes += Math.max(0, Math.ceil(width)) * Math.max(0, Math.ceil(height)) * 4;
        }
      }
    }
    const ordinary = resourceArenaOrdinaryTextureResidencySnapshot(this.#resourceArena);
    return {
      activeLeases: ordinary.activeLeases,
      activeReferences: ordinary.activeReferences,
      preparedBytes,
      preparedSources: sources.size,
      resources: this.#ordinaryTextures.snapshot().resources,
    };
  }

  #virtualTexturingSnapshot(): WebGlVirtualTexturingSnapshot {
    let activePages = 0;
    const activePagesByMip: number[] = [];
    let atlasTextures = 0;
    let cachedPages = 0;
    let demandAdmissions = 0;
    let publishedDemandPages = 0;
    let demandRetentionOverflows = 0;
    let demandRetentions = 0;
    let generatedManifestUses = 0;
    let generatedPageFailures = 0;
    let generatedPageRasterizeMaxMs = 0;
    let generatedPageRasterizeMs = 0;
    let generatedPageRequests = 0;
    let generatedPagesTarget = 0;
    let gpuAdmissionFailures = 0;
    let manifestFailures = 0;
    let manifestRequests = 0;
    let pageLoadFailures = 0;
    let manifestsReady = 0;
    let pageTableTextures = 0;
    let pageTableUpdates = 0;
    let pageLifecycleEntries = 0;
    let pendingPages = 0;
    let preparedResidencyResolutions = 0;
    let outstandingPageRequests = 0;
    const cachedPagesByMip: number[] = [];
    let shaderBinds = 0;
    let unreadyDraws = 0;
    let unsupportedDraws = this.#unsupportedVirtualTextureDraws;
    let uploadedPageBytes = 0;
    let uploadedPages = 0;
    let textureUploadBytesPerChunkMax = 0;
    let textureUploadBytesPerChunkMin = 0;
    let textureUploadChunkSamples = 0;
    let uploadQueueWaitMaxMs = 0;
    let uploadQueueWaitTotalMs = 0;
    let uploadQueueWaitSamples = 0;
    const uploadQueueWaitTotalMsByMip: number[] = [];
    const uploadQueueWaitSamplesByMip: number[] = [];

    for (const state of this.#virtualTextureRuntime.resources.values()) {
      const resource = virtualTextureGpuResource(this.#virtualTextureGpu, state.key);
      const gpu = resource === undefined ? undefined : virtualTextureGpuResourceSnapshot(resource);
      if (gpu?.allocated === true) {
        atlasTextures += 1;
        pageTableTextures += 1;
      }
      demandAdmissions += state.stats.demandAdmissions;
      publishedDemandPages += state.demandedPageKeys.size;
      demandRetentionOverflows += state.stats.demandRetentionOverflows;
      demandRetentions += state.stats.demandRetentions;
      generatedManifestUses += state.stats.generatedManifestUses;
      generatedPageFailures += state.stats.generatedPageFailures;
      generatedPageRasterizeMaxMs = Math.max(generatedPageRasterizeMaxMs, state.stats.generatedPageRasterizeMaxMs);
      generatedPageRasterizeMs += state.stats.generatedPageRasterizeMs;
      generatedPageRequests += state.stats.generatedPageRequests;
      generatedPagesTarget += state.stats.generatedPagesTarget;
      gpuAdmissionFailures += state.stats.gpuAdmissionFailures;
      manifestFailures += state.stats.manifestFailures;
      manifestRequests += state.stats.manifestRequests;
      pageLoadFailures += state.stats.pageLoadFailures;
      if (state.status === "ready") manifestsReady += 1;
      pageTableUpdates += gpu?.pageTableUpdates ?? 0;
      const requests = this.#virtualTextureRuntime.requests.snapshot(state);
      pageLifecycleEntries += requests.lifecycleEntries;
      pendingPages += requests.loadingPages + (gpu?.pendingUploads ?? 0);
      preparedResidencyResolutions += state.stats.preparedResidencyResolutions;
      outstandingPageRequests += requests.loadingPages + requests.queuedPages;
      activePages += gpu?.activePages ?? 0;
      cachedPages += gpu?.cachedPages ?? 0;
      if (resource !== undefined) {
        accumulateVirtualTextureGpuActivePagesByMip(resource, activePagesByMip);
        accumulateVirtualTextureGpuCachedPagesByMip(resource, cachedPagesByMip);
      }
      shaderBinds += state.stats.shaderBinds;
      unreadyDraws += state.stats.unreadyDraws;
      unsupportedDraws += state.stats.unsupportedDraws;
      uploadedPageBytes += gpu?.uploadedPageBytes ?? 0;
      uploadedPages += gpu?.uploadedPages ?? 0;
      if (gpu !== undefined) {
        textureUploadBytesPerChunkMax = Math.max(
          textureUploadBytesPerChunkMax,
          gpu.atlasUploadBytesPerChunkMax,
        );
        if (gpu.atlasUploadBytesPerChunkMin > 0) {
          textureUploadBytesPerChunkMin = textureUploadBytesPerChunkMin === 0
            ? gpu.atlasUploadBytesPerChunkMin
            : Math.min(textureUploadBytesPerChunkMin, gpu.atlasUploadBytesPerChunkMin);
        }
        textureUploadChunkSamples += gpu.atlasUploadChunkSamples;
        uploadQueueWaitMaxMs = Math.max(uploadQueueWaitMaxMs, gpu.uploadQueueWaitMaxMs);
        uploadQueueWaitTotalMs += gpu.uploadQueueWaitTotalMs;
        uploadQueueWaitSamples += gpu.uploadQueueWaitSamples;
        for (let mip = 0; mip < gpu.uploadQueueWaitTotalMsByMip.length; mip += 1) {
          uploadQueueWaitTotalMsByMip[mip] = (uploadQueueWaitTotalMsByMip[mip] ?? 0)
            + (gpu.uploadQueueWaitTotalMsByMip[mip] ?? 0);
          uploadQueueWaitSamplesByMip[mip] = (uploadQueueWaitSamplesByMip[mip] ?? 0)
            + (gpu.uploadQueueWaitSamplesByMip[mip] ?? 0);
        }
      }
    }

    const gpuArena = virtualTextureGpuArenaSnapshot(this.#virtualTextureGpu);

    return {
      activePages,
      activePagesByMip,
      cachedPages,
      cachedPagesByMip,
      atlasTextures,
      demandAdmissions,
      publishedDemandPages,
      demandRetentionOverflows,
      demandRetentions,
      generatedManifestUses,
      generatedPageFailures,
      generatedPageRasterizeMaxMs,
      generatedPageRasterizeMs,
      generatedPageRequests,
      generatedPagesTarget,
      gpuAdmissionFailures,
      manifestFailures,
      manifestRequests,
      pageLoadFailures,
      manifestsReady,
      pageTableTextures,
      pageTableUpdates,
      pageLifecycleEntries,
      pendingPages,
      physicalAllocatedBytes: gpuArena.allocatedBytes,
      physicalBudgetBytes: gpuArena.budgetBytes,
      physicalQuarantinedBytes: gpuArena.quarantinedBytes,
      preparedResidencyResolutions,
      outstandingPageRequests,
      shaderBinds,
      unreadyDraws,
      unsupportedDraws,
      uploadedPageBytes,
      uploadedPages,
      textureUploadBytesPerChunkMax,
      textureUploadBytesPerChunkMin,
      textureUploadChunkSamples,
      uploadQueueWaitAverageMs: uploadQueueWaitSamples === 0
        ? 0
        : uploadQueueWaitTotalMs / uploadQueueWaitSamples,
      uploadQueueWaitMaxMs,
      uploadQueueWaitMsByMip: uploadQueueWaitTotalMsByMip.map((total, mip) =>
        total / (uploadQueueWaitSamplesByMip[mip] ?? 1)),
      uploadQueueWaitSamples,
    };
  }

  #synchronizeResourceGovernorObservations(): void {
    const gpuArena = virtualTextureGpuArenaSnapshot(this.#virtualTextureGpu);
    setResourceGovernorObservedDurableUsage(this.#resourceGovernor, "ordinary-texture", {
      // Decoded sources now own pre-publication leases. Keep this argument for
      // residency diagnostics without charging the same bytes observationally.
      cpuDecodedBytes: 0,
      // Migrated live allocations are represented by arena-owned durable
      // leases. Failed driver deletions remain charged observationally until
      // context loss proves that the backing storage is gone.
      persistentGpuBytes: this.#ordinaryTextures.snapshot().quarantinedBytes,
    });
    setResourceGovernorObservedDurableUsage(this.#resourceGovernor, "virtual-texture", {
      // Migrated allocations are represented by durable governor leases. Only
      // failed GL deletions remain observationally charged until context loss.
      persistentGpuBytes: gpuArena.quarantinedBytes,
    });
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
