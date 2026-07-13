import {
  bindClusteredLights,
  clusteredLightTextureUnits,
  configureClusteredLightArena,
  createClusteredLightArena,
  dropClusteredLightContext,
  endClusteredLightFrame,
  releaseClusteredLightContextHandles,
  type ClusteredLightArena,
} from "./webgl/clustered-light-arena";
import {
  type DirectionalLightNode,
  type PointLightNode,
  type SpotLightNode,
  type EnvironmentLight,
  type GltfInstancesNode,
  type GltfNode,
  type Material,
  type MeshNode,
  type PickInput,
  type PickResult,
  type RenderToneMapping,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type TextureContentKey,
  type TextureRef,
  type TextureSampler,
  type Transform,
} from "@royal/renderer-core";
import { readRenderObjectHandleTransform } from "@royal/renderer-core/render-object";
import {
  abortError,
  loadGltfBuffers,
  loadGltfDocument,
  resolveResourceUri,
  throwIfAborted,
} from "./gltf/io";
import { BoundedDiagnosticLog } from "./diagnostics";
import {
  closeDecodedTextureSource,
  DecodedTextureSourceLifetime,
} from "./decoded-texture-source-lifetime";
import { OrdinaryTextureResidencyController } from "./ordinary-texture-residency-controller";
import { SceneBindingRegistry } from "./scene-binding-registry";
import {
  applyPreparedAssetEvents,
  applyResourceDelta,
  clearResourceArenaPreparedSources,
  createResourceArena,
  detachResourceArenaImagePreparation,
  disposeResourceArena,
  publishResourceArenaContentKey,
  resourceArenaContentKeys,
  resourceArenaCountersSnapshot,
  resourceArenaHasHdrReadyAsset,
  resourceArenaHasPendingAssetEvents,
  resourceArenaIblSources,
  resourceArenaOrdinaryTextureResidencySnapshot,
  resourceArenaPreparedSourceKeys,
  resourceArenaPreparedSourceValues,
  resourceArenaSourceReferenceCount,
  rekeyPreparedAssetOrdinaryTextures,
  retainResourceArenaSourceLease,
  retainResourceArenaIblSource,
  wakeResourceArenaPreparedAssetCpuCapacity,
  type PreparedAssetArenaEvent,
  type PreparedAssetDependencyManifest,
  type PreparedAssetOrdinaryTextureRekey,
  type ResourceArena,
  type ResourceArenaChanges,
} from "./resource-arena";
import {
  beginResourceGovernorFrame,
  createResourceGovernor,
  defineResourceGovernorPolicy,
  maximumResourceGovernorClassDurableBytes,
  RESOURCE_GOVERNOR_CLASSES,
  ResourceGovernorCpuCapacityError,
  replaceResourceGovernorLease,
  reserveResourceGovernor,
  resourceGovernorSnapshot,
  setResourceGovernorObservedDurableUsage,
  subscribeResourceGovernorDurableCapacityRelease,
  type ResourceGovernor,
  type ResourceGovernorClass,
  type ResourceGovernorLease,
  type ResourceGovernorReservation,
} from "./resource-governor";
import {
  compileFramePlan,
  createResourceManifestDiffScratch,
  diffResourceManifests,
  gltfRequestKey,
  type FramePlan,
  type FramePlanResourceManifest,
  type CountedTextureDeclaration,
  type ResourceManifestDelta,
} from "./frame-plan";
import {
  directGeometryDeclaration,
  directGeometryDeclarationKey,
  geometryDeclarationBucketKey,
  gltfGeometryDeclaration,
  type CpuGeometry,
} from "./geometry-recipes";
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
  drawGeometry,
  prepareGeometryInstancedDraw,
  submitGeometryInstancedDraw,
  type GeometryDrawArena,
} from "./webgl/geometry-draw-arena";
import {
  createTextureHandleArena,
  dropTextureHandleContext,
  releaseTextureHandleContextHandles,
  type TextureHandleArena,
} from "./webgl/texture-handle-arena";
import {
  type OrdinaryTextureGpuResource,
} from "./webgl/ordinary-texture-gpu-arena";
import {
  accumulateVirtualTextureGpuActivePagesByMip,
  accumulateVirtualTextureGpuCachedPagesByMip,
  admitVirtualTextureGpuResource,
  bindVirtualTextureGpuResource,
  clearVirtualTextureGpuOutcomes,
  consumeVirtualTextureGpuWake,
  createVirtualTextureGpuArena,
  dropVirtualTextureGpuContext,
  processVirtualTextureGpuUploads,
  releaseVirtualTextureGpuAllocation,
  releaseVirtualTextureGpuResource,
  setVirtualTextureGpuDesiredPageKeys,
  touchVirtualTextureGpuResidency,
  virtualTextureGpuArenaSnapshot,
  virtualTextureGpuCachedResidency,
  virtualTextureGpuDrawable,
  virtualTextureGpuExactResidency,
  virtualTextureGpuHasActionableUploads,
  virtualTextureGpuOutcome,
  virtualTextureGpuOutcomeCount,
  virtualTextureGpuResource,
  virtualTextureGpuResourceSnapshot,
  virtualTextureGpuAdmission,
  type VirtualTextureGpuArena,
} from "./webgl/virtual-texture-gpu-arena";
import {
  beginGltfInstanceBufferArenaFrame,
  bindGltfInstanceBuffer,
  clearGltfInstanceBufferArena,
  createGltfInstanceBufferArena,
  releaseUnusedGltfInstanceBuffers,
} from "./gltf-instance-buffer-arena";
import {
  copyTransmissionScreenColorTexture,
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
import type { DecodedGltfDracoPrimitive } from "./gltf/codecs/draco";
import { gltfCodecDemand } from "./gltf/codecs/demand";
import { assertSupportedRequiredGltfExtensions } from "./gltf/extensions";
import {
  GltfInstanceTransformRegistry,
  type GltfInstanceTransformView,
} from "./gltf/instance-transform-registry";
import {
  GltfImageDemandCoordinator,
  gltfImageDemandKeys,
  type GltfImageRecipeLease,
} from "./gltf/image-demand-coordinator";
import {
  createGltfImageSourceRecipes,
  gltfImageSourceRecipeBytes,
} from "./gltf/image-source-recipe";
import {
  estimateGltfPreparationCpu,
  type GltfPreparationCpuEstimate,
} from "./gltf/preparation-admission";
import {
  GLTF_MATERIAL_EXTENSION_TEXTURES,
  readGltfScene,
} from "./gltf/scene-reader";
import {
  type GltfDocument,
  type GltfMeshPrimitive,
} from "./gltf/schema";
import {
  IDENTITY_GLTF_TEXTURE_COORDINATES,
  type GltfTextureCoordinates,
} from "./gltf/texture-coordinates";
import {
  preparedGltfAssetRetainedCpuBytes,
  type GltfLoadMetrics,
  type LoadedGltfMaterial,
  type LoadedGltfMaterialTextureSlot,
  type LoadedGltfPrimitive,
  type LoadedGltfPrimitiveMaterial,
  type PreparedGltfAsset,
} from "./gltf/prepared-asset";
import {
  GltfPreparationScheduler,
} from "./gltf/preparation-scheduler";
import { GltfSharedViewLodRegistry } from "./gltf/shared-view-lod-registry";
import {
  appendReadyGltfPacketOccurrence,
  clearGltfPacketOccurrence,
  createGltfPacketTopology,
  GLTF_PACKET_OCCURRENCE_STATUS,
  GLTF_PACKET_ROOT_SOURCE_KIND,
  replaceReadyGltfPacketOccurrence,
  rebuildGltfPacketTopology,
  type GltfPacketOccurrence,
  type GltfPacketPreparedPrimitive,
  type GltfPacketTopology,
} from "./gltf-packet-topology";
import {
  appendSelectedFramePacket,
  beginSelectedFramePacketView,
  beginSelectedFramePacketViews,
  createSelectedFramePackets,
  endSelectedFramePacketView,
  FRAME_PACKET_SIDEDNESS,
  framePacketLodRequirementsMatch,
  NO_FRAME_PACKET_ID,
  type FramePacketRenderClass,
  type SelectedFramePackets,
} from "./frame-packets";
import {
  readPacketBoundsInto,
  readPacketLocalModelInto,
  readPacketRootSourceInto,
  resolvePacketMaterial,
  type MutablePacketRootSourceRow,
} from "./packet-resource-tables";
import {
  appendGltfPacketSubmission,
  clearGltfPacketSubmissionWorkspace,
  createGltfPacketSubmissionWorkspace,
  resetGltfPacketSubmissionWorkspaceForFrame,
  resetGltfPacketSubmissionWorkspaceForSegment,
  resetGltfPacketSubmissionWorkspaceForView,
  retainGltfPacketSubmissionLightBinding,
  retainGltfPacketSubmissionMaterialBinding,
  retainGltfPacketSubmissionRootBinding,
  type GltfPacketSubmissionWorkspace,
} from "./gltf-packet-submission-workspace";
import {
  assertGltfPacketBatchSegmentGroupsCurrent,
  beginGltfPacketBatchRegistryFrame,
  clearGltfPacketBatchRegistry,
  clearGltfPacketBatchSegmentGroups,
  createGltfPacketBatchRegistry,
  createGltfPacketBatchSegmentGroups,
  groupGltfPacketSubmissionSegment,
  type GltfPacketBatchRegistry,
  type GltfPacketBatchSegmentGroups,
} from "./gltf-packet-batch-registry";
import {
  identityMat4,
  inverseMat4,
  multiplyMat4,
  multiplyMat4Into,
  projectionMat4Into,
  transformMat4,
  transformMat4Into,
  viewMat4Into,
  type Mat4,
  type MutableMat4,
} from "./math/mat4";
import {
  isBoundsVisible,
  worldBounds,
  type Bounds3,
  type MutableBounds3,
} from "./math/picking";
import {
  createProjectedBoundsWorkspace,
  projectedBoundsScreenCoverage,
} from "./math/projected-bounds";
import { PickingController } from "./picking-controller";
import { FrameTextureResidencyIntent } from "./frame-texture-residency-intent";
import {
  isDecodedRgbaTexture,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "./texture-sources";
import {
  GENERATED_SVG_VIRTUAL_TEXTURE_DEFAULT_RASTER_DENSITY,
  GENERATED_SVG_VIRTUAL_TEXTURE_MAX_RASTER_DENSITY,
  generatedSvgVirtualTextureManifest,
  isSvgUri,
  loadGeneratedSvgVirtualTexturePageImage,
  loadSvgTextureFromUri,
  svgVirtualTextureSourceForImage,
} from "./svg-texture";
import {
  generatedVirtualTexturePageCount,
  parseVirtualTextureManifest,
  virtualTextureDecodedPageBytes,
  virtualTextureExplicitPageUrisByKey,
  virtualTexturePageKey,
  virtualTexturePageUri,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
} from "./virtual-texturing";
import {
  GENERATED_RASTER_VIRTUAL_TEXTURE_MIN_DIMENSION,
  generatedVirtualTextureSource,
  generatedRasterVirtualTextureManifest,
  generatedRasterVirtualTexturePageImage,
  virtualTextureNow,
  type BaseColorTextureResidency,
  type GeneratedVirtualTextureSource,
  type VirtualTextureDrawDemand,
  type VirtualTextureDrawDemandContext,
  type VirtualTextureDrawDemandModelSource,
  type VirtualTextureGeneratedPageSource,
  type VirtualTextureManifestSource,
  type VirtualTextureRef,
  type VirtualTextureRuntimeState,
  type ViewportSize,
} from "./virtual-texture-runtime";
import {
  createVirtualTextureDemandPlanningWorkspace,
  planVirtualTextureDrawDemand,
  selectVirtualTextureFrameWorkingSet,
  selectVirtualTextureWorkingSet,
  stabilizeVirtualTextureDesiredPagesInto,
  virtualTextureDemandMipCount,
  virtualTextureDemandModelCount,
} from "./virtual-texture-demand";
import {
  cachedVirtualTextureCoverageProvider,
  clearVirtualTextureCoverageProviderCache,
  createVirtualTextureCoverageProviderCache,
  releaseVirtualTextureCoverageProviders,
} from "./virtual-texture-coverage-cache";
import {
  advanceVirtualTextureFrameDemand,
  beginVirtualTextureFrameDemand,
  createVirtualTextureFrameDemandWorkspace,
  finalizeVirtualTextureFrameDemand,
  releaseVirtualTextureFrameDemandResource,
  resetVirtualTextureFrameDemand,
  submitVirtualTextureFrameDemand,
  type VirtualTextureFrameDemandCommit,
} from "./virtual-texture-frame-demand";
import {
  VirtualTextureRequestCoordinator,
} from "./virtual-texture-request-coordinator";
import {
  isBlendedSurfaceMaterial,
  materialColor,
  materialEmissiveColor,
  surfaceMaterialAlphaCutoff,
  surfaceMaterialAlphaMode,
  surfaceMaterialMetallicFactor,
  surfaceMaterialOcclusionStrength,
  surfaceMaterialRoughnessFactor,
  surfaceMaterialBatchKey,
  surfaceMaterialExtensionFactors,
  textureCacheKey,
  type SurfaceMaterial,
  type SurfaceMaterialTextureCoordinates,
  type TextureAssetUploadRef,
} from "./webgl/materials";
import {
  SURFACE_MATERIAL_TEXTURE_BINDINGS,
  planSurfaceTextureBindings,
  resolveAdmittedSurfaceTextureBindings,
  type SurfaceIndependentTextureFeature,
  type SurfaceTextureBindingPlan as PureSurfaceTextureBindingPlan,
  type SurfaceTextureCandidate,
} from "./webgl/surface-texture-binding-plan";
import {
  type ProgramKind,
  type SurfaceShaderFeatures,
  type SurfaceShaderTextureFeature,
} from "./webgl/shaders";
import {
  configureProgramArenaParallelCompile,
  consumeProgramArenaWake,
  createProgramArena,
  dropProgramArenaContext,
  releaseProgramArenaContextHandles,
  requestProgram,
  uniform1f,
  uniform1i,
  uniform2f,
  uniform2fv,
  uniformColor,
  uniformMatrix,
  useProgram,
  type ProgramArena,
  type ProgramArenaResource,
} from "./webgl/program-arena";
import { rendererOwnedWebGl2Context, type RendererOwnedWebGl2Context } from "./webgl/context-lane";
import {
  combineSurfaceLightSets,
  EMPTY_SURFACE_LIGHT_SET,
  MAX_SURFACE_LIGHTS,
  surfaceLightSet,
  transformSurfaceIblIrradiance,
  transformSurfaceLight,
  type SurfaceImageBasedLight,
  type SurfaceImageBasedLightSpecular,
  type SurfaceIblSpecular,
  type SurfaceLight,
  type SurfaceLightSet,
} from "./webgl/lights";
import {
  bindSurfaceIbl,
  consumeIblTextureDiagnostics,
  consumeIblTextureFrameWake,
  createIblTextureArena,
  dropIblTextureContext,
  ensureGltfIblSpecularTexture,
  ensureStudioEnvironmentSpecularTexture,
  IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT,
  markGltfIblSpecularTextureDirty,
  prepareSurfaceIblBrdfLut,
  releaseGltfIblSpecularTexture,
  releaseIblTextureContextHandles,
  type IblSpecularTextureResource,
  type IblTextureArena,
  type StudioEnvironmentSpecularResource,
  wakeIblTextureDurablePressure,
} from "./webgl/ibl-texture-arena";
import { prepareFrameBaseline } from "./webgl/imperative-state";
import {
  STUDIO_ENVIRONMENT_IRRADIANCE,
} from "./webgl/studio-environment";
import { WebGlContextLifecycleOwner } from "./context-lifecycle-owner";
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

type SurfaceBaseColorTextureBinding =
  | { readonly kind: "none" }
  | {
      readonly kind: "ordinary";
      readonly resource: Extract<OrdinaryTextureGpuResource, { readonly uploaded: true }>;
    }
  | {
      readonly kind: "prepared-virtual";
      readonly ordinaryFallback?: TextureAssetUploadRef;
      readonly state: VirtualTextureRuntimeState;
    };

type SurfaceTextureBindingPlan = Omit<PureSurfaceTextureBindingPlan, "baseColor"> & {
  readonly baseColor: SurfaceBaseColorTextureBinding;
  readonly readyTextures: ReadonlyMap<SurfaceShaderTextureFeature, Extract<
    OrdinaryTextureGpuResource,
    { readonly uploaded: true }
  >>;
};

type GltfBasisuCodecModule = typeof import("./gltf/codecs/basisu");
type GltfDracoCodecModule = typeof import("./gltf/codecs/draco");
type GltfMeshoptCodecModule = typeof import("./gltf/codecs/meshopt");

type GltfCodecImports = {
  readonly basisu?: Promise<GltfBasisuCodecModule>;
  readonly draco?: Promise<GltfDracoCodecModule>;
  readonly meshopt?: Promise<GltfMeshoptCodecModule>;
};

const startGltfCodecImport = <Module>(load: () => Promise<Module>): Promise<Module> => {
  const pending = load();
  // Buffer and image IO intentionally overlap module loading. Mark an early
  // import failure handled until the original promise is awaited at its phase.
  void pending.catch(() => undefined);
  return pending;
};

const importGltfCodecs = (document: GltfDocument): GltfCodecImports => {
  const demand = gltfCodecDemand(document);
  return {
    ...(demand.basisu
      ? { basisu: startGltfCodecImport(() => import("./gltf/codecs/basisu")) }
      : {}),
    ...(demand.draco
      ? { draco: startGltfCodecImport(() => import("./gltf/codecs/draco")) }
      : {}),
    ...(demand.meshopt
      ? { meshopt: startGltfCodecImport(() => import("./gltf/codecs/meshopt")) }
      : {}),
  };
};

type DrawSidedness = {
  readonly doubleSided: boolean;
  readonly frontFaceCcw: boolean;
};

type LoadedGltfSurfaceTextures = {
  readonly clearcoatRoughnessTexture?: TextureAssetUploadRef;
  readonly clearcoatTexture?: TextureAssetUploadRef;
  readonly emissiveTexture?: TextureAssetUploadRef;
  readonly iridescenceTexture?: TextureAssetUploadRef;
  readonly iridescenceThicknessTexture?: TextureAssetUploadRef;
  readonly materialTransmissionTexture?: TextureAssetUploadRef;
  readonly metallicRoughnessTexture?: TextureAssetUploadRef;
  readonly normalTexture?: TextureAssetUploadRef;
  readonly occlusionTexture?: TextureAssetUploadRef;
  readonly sheenColorTexture?: TextureAssetUploadRef;
  readonly sheenRoughnessTexture?: TextureAssetUploadRef;
  readonly specularColorTexture?: TextureAssetUploadRef;
  readonly specularTexture?: TextureAssetUploadRef;
  readonly thicknessTexture?: TextureAssetUploadRef;
  readonly textureCoordinates?: SurfaceMaterialTextureCoordinates;
};

type TextureColorSpace = NonNullable<TextureRef["colorSpace"]>;
const loadedGltfSurfaceMaterial = (
  loadedMaterial: LoadedGltfMaterial,
  baseColor: TextureRef,
  textures: LoadedGltfSurfaceTextures,
): SurfaceMaterial => {
  const emissive = loadedMaterial.emissive;
  const extensionFactors = loadedMaterial.extensionFactors;
  const common = {
    baseColor,
    baseColorFactor: loadedMaterial.color ?? TEXTURE_COLOR,
    alphaMode: loadedMaterial.alphaMode,
    ...(loadedMaterial.alphaMode === "MASK" ? { alphaCutoff: loadedMaterial.alphaCutoff ?? 0.5 } : {}),
    doubleSided: loadedMaterial.doubleSided,
    ...(emissive === undefined ? {} : { emissive }),
    ...(textures.emissiveTexture === undefined ? {} : { emissiveTexture: textures.emissiveTexture }),
    ...(extensionFactors === undefined ? {} : { extensionFactors }),
    ...(textures.textureCoordinates === undefined ? {} : { textureCoordinates: textures.textureCoordinates }),
  };
  if (loadedMaterial.unlit === true) {
    return {
      ...common,
      kind: "unlit",
    };
  }

  return {
    ...common,
    kind: "standard",
    ...(textures.clearcoatRoughnessTexture === undefined
      ? {}
      : { clearcoatRoughnessTexture: textures.clearcoatRoughnessTexture }),
    ...(textures.clearcoatTexture === undefined ? {} : { clearcoatTexture: textures.clearcoatTexture }),
    ...(textures.iridescenceTexture === undefined ? {} : { iridescenceTexture: textures.iridescenceTexture }),
    ...(textures.iridescenceThicknessTexture === undefined
      ? {}
      : { iridescenceThicknessTexture: textures.iridescenceThicknessTexture }),
    ...(textures.materialTransmissionTexture === undefined
      ? {}
      : { materialTransmissionTexture: textures.materialTransmissionTexture }),
    metallicFactor: loadedMaterial.metallicFactor ?? 1,
    ...(textures.metallicRoughnessTexture === undefined
      ? {}
      : { metallicRoughnessTexture: textures.metallicRoughnessTexture }),
    ...(textures.normalTexture === undefined ? {} : { normalTexture: textures.normalTexture }),
    normalScale: loadedMaterial.normalScale ?? 1,
    ...(textures.occlusionTexture === undefined ? {} : { occlusionTexture: textures.occlusionTexture }),
    occlusionStrength: loadedMaterial.occlusionStrength ?? 1,
    roughnessFactor: loadedMaterial.roughnessFactor ?? 1,
    ...(textures.sheenColorTexture === undefined ? {} : { sheenColorTexture: textures.sheenColorTexture }),
    ...(textures.sheenRoughnessTexture === undefined
      ? {}
      : { sheenRoughnessTexture: textures.sheenRoughnessTexture }),
    ...(textures.specularColorTexture === undefined
      ? {}
      : { specularColorTexture: textures.specularColorTexture }),
    ...(textures.specularTexture === undefined ? {} : { specularTexture: textures.specularTexture }),
    ...(textures.thicknessTexture === undefined ? {} : { thicknessTexture: textures.thicknessTexture }),
  };
};

type GltfState = {
  hasMaterialLod: boolean;
  hasMaterialVariants: boolean;
  hasNodeLod: boolean;
  imageBasedLight?: SurfaceImageBasedLight;
  readonly instanceKey: number;
  readonly key: string;
  readonly preparedGeneration: number;
  error?: string;
  lights: readonly SurfaceLight[];
  load: GltfLoadMetrics;
  materials: readonly LoadedGltfMaterial[];
  nodeCount: number;
  primitives: readonly LoadedGltfPrimitive[];
  status: "loading" | "ready" | "error";
  variants: readonly string[];
};

const preparedPrimitiveMaterials = (
  primitives: readonly LoadedGltfPrimitive[],
): readonly LoadedGltfMaterial[] => {
  const materials = new Set<LoadedGltfMaterial>();
  for (const primitive of primitives) {
    materials.add(primitive.material);
    for (const material of primitive.materialLod?.levels ?? []) materials.add(material);
    for (const variant of primitive.materialVariants ?? []) {
      materials.add(variant.material);
      for (const material of variant.materialLod?.levels ?? []) materials.add(material);
    }
  }
  return [...materials];
};

const preparedAssetMaterials = (asset: PreparedGltfAsset): readonly LoadedGltfMaterial[] =>
  preparedPrimitiveMaterials(asset.primitives);
const VIRTUAL_TEXTURE_COLD_ALLOCATION_GRACE_FRAMES = 2;

type AnyGltfNode = GltfNode | GltfInstancesNode;

type GltfPacketMaterialBinding = {
  readonly material: SurfaceMaterial;
};

type GltfPacketRootBinding = {
  readonly rootModel: Mat4;
  readonly rootInstanceViews?: GltfInstanceTransformView;
  readonly rootPositionSignatureVersion?: number;
  readonly rootRotationSignatureVersion?: number;
  readonly rootScaleSignatureVersion?: number;
  readonly rootSignatureInstanceIndex: number;
  readonly rootSignatureRenderInstanceOrdinal: number;
  readonly rootTransform: Transform | undefined;
};

type GltfPrimitiveDrawBatch = {
  cpuGeometry: CpuGeometry;
  geometry: GeometryResource;
  geometryId: number;
  readonly key: number;
  lights: SurfaceLightSet;
  readonly localModelSignature: number[];
  readonly localModels: Mat4[];
  readonly localModelSlots: MutableMat4[];
  material: SurfaceMaterial;
  readonly rootPositionSignature: number[];
  readonly rootRotationSignature: number[];
  readonly rootScaleSignature: number[];
  readonly rootModels: Mat4[];
  readonly rootInstanceViews: Array<GltfInstanceTransformView | undefined>;
  readonly rootLogicalIndices: number[];
  readonly rootTransforms: Array<Transform | undefined>;
  sidedness: DrawSidedness;
};

type GltfPreparedPrimitiveMaterial = {
  readonly material: SurfaceMaterial;
  readonly materialBatchClassId: number;
};

type WebGlGltfInstancingCounters = {
  -readonly [Key in keyof WebGlGltfInstancingSnapshot]: WebGlGltfInstancingSnapshot[Key];
};

type SceneToneMappingState = {
  readonly exposure: number;
  readonly hdrOutput: boolean;
  readonly toneMapping: RenderToneMapping;
};

const DEFAULT_COLOR: Rgba = [0.5, 0.5, 0.5, 1];
const TEXTURE_COLOR: Rgba = [1, 1, 1, 1];
const DEFAULT_TONE_MAPPING_STATE: SceneToneMappingState = {
  exposure: 1 / 1.2,
  hdrOutput: false,
  toneMapping: "linear-clamp",
};
const EMPTY_FRAME_PLAN_RESOURCE_MANIFEST: FramePlanResourceManifest = {
  bulkInstances: [],
  directGeometries: [],
  gltfRequests: [],
  ordinaryTextures: [],
  renderObjectRefs: [],
  virtualTextures: [],
};
const VT_WRAP_CLAMP_TO_EDGE = 0;
const VT_WRAP_REPEAT = 1;
const VT_WRAP_MIRRORED_REPEAT = 2;
const EMPTY_IBL_SOURCES: ReadonlyMap<string, LoadedTextureSource> = new Map();
const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

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

const compileSceneSurfaceLights = (
  lights: readonly (DirectionalLightNode | PointLightNode | SpotLightNode)[],
): readonly SurfaceLight[] => {
  const scaleColor = (color: Rgba, intensity: number): Rgba => [
    color[0] * intensity,
    color[1] * intensity,
    color[2] * intensity,
    1,
  ];
  return lights.map((light) => {
    switch (light.kind) {
      case "directional-light":
        return {
          color: scaleColor(light.color, light.illuminanceLux),
          direction: light.direction,
          kind: "directional",
        };
      case "point-light":
        return {
          color: scaleColor(light.color, light.intensityCandela),
          kind: "point",
          position: light.position,
          ...(light.range === undefined ? {} : { range: light.range }),
        };
      case "spot-light":
        return {
          color: scaleColor(light.color, light.intensityCandela),
          direction: light.direction,
          innerConeAngle: light.innerConeAngle,
          kind: "spot",
          outerConeAngle: light.outerConeAngle,
          position: light.position,
          ...(light.range === undefined ? {} : { range: light.range }),
        };
    }
  });
};

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

const appendTransformVectorSignatureValues = (
  signature: number[],
  transform: Transform | undefined,
  field: keyof Transform,
): void => {
  const resolved = transform ?? IDENTITY_TRANSFORM;
  signature.push(resolved[field][0], resolved[field][1], resolved[field][2]);
};

const appendGltfRootSignatures = (
  positionSignature: number[],
  rotationSignature: number[],
  scaleSignature: number[],
  root: GltfPacketRootBinding,
): void => {
  if (root.rootPositionSignatureVersion === undefined) {
    appendTransformVectorSignatureValues(positionSignature, root.rootTransform, "position");
  } else {
    positionSignature.push(
      root.rootPositionSignatureVersion,
      root.rootSignatureRenderInstanceOrdinal,
      root.rootSignatureInstanceIndex,
    );
  }
  if (root.rootRotationSignatureVersion === undefined) {
    appendTransformVectorSignatureValues(rotationSignature, root.rootTransform, "rotation");
  } else {
    rotationSignature.push(
      root.rootRotationSignatureVersion,
      root.rootSignatureRenderInstanceOrdinal,
      root.rootSignatureInstanceIndex,
    );
  }
  if (root.rootScaleSignatureVersion === undefined) {
    appendTransformVectorSignatureValues(scaleSignature, root.rootTransform, "scale");
  } else {
    scaleSignature.push(
      root.rootScaleSignatureVersion,
      root.rootSignatureRenderInstanceOrdinal,
      root.rootSignatureInstanceIndex,
    );
  }
};

const createWebGlGltfInstancingCounters = (): WebGlGltfInstancingCounters => ({
  batchPlansBuilt: 0,
  batchInstancesTotal: 0,
  drawCalls: 0,
  instancesDrawn: 0,
  localModelUploadBytes: 0,
  localModelUploadCalls: 0,
  rootPoseUploadBytes: 0,
  rootPoseUploadCalls: 0,
  rootScaleUploadBytes: 0,
  rootScaleUploadCalls: 0,
});

const maxVirtualTexturePageTableUploadBytes = (
  manifest: VirtualTextureManifestModel,
  generated: boolean,
): number => {
  const width = Math.ceil(manifest.width / manifest.pageSize);
  const height = Math.ceil(manifest.height / manifest.pageSize);
  if (generated || manifest.uriTemplate !== undefined) return width * height * 4;
  let maximum = 0;
  for (const page of manifest.pages) {
    const coverage = 2 ** page.mip;
    const x = page.x * coverage;
    const y = page.y * coverage;
    const updateWidth = Math.max(0, Math.min(width, x + coverage) - x);
    const updateHeight = Math.max(0, Math.min(height, y + coverage) - y);
    maximum = Math.max(maximum, updateWidth * updateHeight * 4);
  }
  return maximum;
};

const normalizeOptions = (options: WebGlRootOptions = {}): NormalizedWebGlRootOptions => {
  const generatedSvgVirtualTextureRasterDensity = options.generatedSvgVirtualTextureRasterDensity
    ?? GENERATED_SVG_VIRTUAL_TEXTURE_DEFAULT_RASTER_DENSITY;
  if (
    !Number.isFinite(generatedSvgVirtualTextureRasterDensity)
    || generatedSvgVirtualTextureRasterDensity <= 0
    || generatedSvgVirtualTextureRasterDensity > GENERATED_SVG_VIRTUAL_TEXTURE_MAX_RASTER_DENSITY
  ) {
    throw new RangeError(
      `generatedSvgVirtualTextureRasterDensity must be finite and in (0, ${GENERATED_SVG_VIRTUAL_TEXTURE_MAX_RASTER_DENSITY}] logical texels per authored SVG CSS pixel, received ${String(generatedSvgVirtualTextureRasterDensity)}`,
    );
  }
  return Object.freeze({
    alpha: options.alpha ?? true,
    antialias: options.antialias ?? true,
    generatedImageVirtualTextures: options.generatedImageVirtualTextures ?? false,
    generatedSvgVirtualTextureRasterDensity,
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

const nowMs = (): number => globalThis.performance?.now?.() ?? Date.now();

const elapsedMs = (start: number | undefined, end: number | undefined): number | undefined =>
  start === undefined || end === undefined ? undefined : Math.max(0, end - start);

const mat4OrientationDeterminant = (matrix: Mat4): number =>
  matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6])
  - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2])
  + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]);

/**
 * Minimal Royal WebGL2 renderer root. It implements the descriptor subset used
 * by the contracts while keeping all GPU ownership inside this root.
 */
type InternalWebGlRoot = WebGlRoot & RendererOwnedWebGl2Context & RendererFrameViewLane;

type ResourceArenaSideEffectDebt = {
  nextStep: number;
  readonly phase: "acquire" | "release";
  readonly steps: readonly (() => void)[];
};

type PreparedAssetCpuAdmission = {
  assetDecode: ResourceGovernorLease | undefined;
  geometry: ResourceGovernorLease | undefined;
  transient: ResourceGovernorReservation | undefined;
};

class WebGlRootImpl implements InternalWebGlRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #options: NormalizedWebGlRootOptions;
  readonly #requestedContextOptions: WebGlRootOptions;
  readonly #frameViews = createFrameViews();
  readonly #renderProjection = identityMat4();
  readonly #renderView = identityMat4();
  readonly #renderViewProjection = identityMat4();
  readonly #renderViewportSize: [number, number] = [0, 0];
  readonly #meshModel = identityMat4();
  readonly #meshViewProjectionModel = identityMat4();
  readonly #context = new WebGlContextLifecycleOwner();
  readonly #renderFailureObservers = new Set<(failure: unknown) => void>();
  readonly #programArena: ProgramArena;
  readonly #geometryLocalBounds = new WeakMap<Float32Array, Bounds3 | undefined>();
  readonly #retainedGeometryRecipes = new Map<string, { readonly id: number; readonly recipe: CpuGeometry }>();
  /** Prepared CPU coverage survives WebGL context loss and follows semantic geometry ownership. */
  readonly #virtualTextureCoverageProviders = createVirtualTextureCoverageProviderCache();
  readonly #gltfPrimitiveGeometryKeys = new WeakMap<LoadedGltfPrimitive, string>();
  readonly #gltfPacketPrimitivesByGeometryId = new Map<number, LoadedGltfPrimitive>();
  readonly #ordinaryTextures: OrdinaryTextureResidencyController;
  readonly #textureResidencyIntent = new FrameTextureResidencyIntent();
  readonly #decodedTextureSources: DecodedTextureSourceLifetime;
  readonly #gltfImages: GltfImageDemandCoordinator;
  readonly #virtualTextures = new Map<string, VirtualTextureRuntimeState>();
  readonly #virtualTextureGpu: VirtualTextureGpuArena;
  readonly #virtualTextureRequests: VirtualTextureRequestCoordinator;
  readonly #autoVirtualTextureRefs = new Map<string, VirtualTextureRef>();
  readonly #autoVirtualTextureGeneratedPageSources = new Map<string, GeneratedVirtualTextureSource>();
  readonly #gltf = new Map<string, GltfState>();
  readonly #resourceArena: ResourceArena;
  /** Root authority for cross-subsystem resource admission and accounting. */
  readonly #resourceGovernor: ResourceGovernor;
  readonly #unsubscribeResourceGovernorDurableCapacityRelease: () => void;
  readonly #preparedAssetCpuGovernorLeases = new Map<string, {
    assetDecode?: ResourceGovernorLease;
    geometry?: ResourceGovernorLease;
  }>();
  readonly #virtualTextureGovernorLeases = new Map<string, ResourceGovernorLease>();
  #nextVirtualTextureAdmissionTicket = 1;
  #virtualTextureAllocationRetryFrame = -1;
  #virtualTextureRetryTicket = 1;
  #governedVirtualTextureRetryScheduled = false;
  #resourceArenaSideEffectDebt: ResourceArenaSideEffectDebt[] = [];
  #resourceArenaAcquisitionsCancelled = false;
  #resourceArenaSideEffectDrainInProgress = false;
  readonly #pendingPreparedAssetEvents: PreparedAssetArenaEvent[] = [];
  #pendingPreparedAssetEventHead = 0;
  #preparedAssetEventDrainInProgress = false;
  #cpuCapacityWakeScheduled = false;
  #suppressCpuCapacityWake = false;
  #suppressPersistentGpuCapacityWake = false;
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
          () => this.#gltfPreparationScheduler.wake(),
          () => this.#gltfImages.wake(),
          () => this.#ordinaryTextures.wakeSourceJobs(),
          () => this.#virtualTextureRequests.drain(),
        ];
        const start = this.#gltfPreparationWakeCursor % wakes.length;
        this.#gltfPreparationWakeCursor = (start + 1) % wakes.length;
        for (let offset = 0; offset < wakes.length; offset += 1) {
          wakes[(start + offset) % wakes.length]!();
        }
        this.invalidate();
      },
    };
  };
  readonly #gltfPreparationScheduler = new GltfPreparationScheduler(2, this.#admitGltfPreparationJob);
  readonly #gltfStatesByNode = new WeakMap<AnyGltfNode, GltfState>();
  readonly #gltfInstanceTransforms = new GltfInstanceTransformRegistry(() => this.invalidate());
  #gltfPreparationWakeCursor = 0;
  readonly #gltfBatches: Array<GltfPrimitiveDrawBatch | undefined> = [];
  readonly #gltfInstanceBufferArena = createGltfInstanceBufferArena(this.#vertexInputs);
  readonly #sharedViewLods = new GltfSharedViewLodRegistry();
  readonly #gltfPacketTopology: GltfPacketTopology = createGltfPacketTopology();
  readonly #selectedGltfFramePackets: SelectedFramePackets = createSelectedFramePackets(
    this.#gltfPacketTopology.catalog,
  );
  readonly #gltfPacketSubmissionWorkspace: GltfPacketSubmissionWorkspace<
    GltfPacketMaterialBinding,
    GltfPacketRootBinding,
    SurfaceLightSet
  > = createGltfPacketSubmissionWorkspace();
  readonly #gltfPacketBatchRegistry: GltfPacketBatchRegistry = createGltfPacketBatchRegistry();
  readonly #gltfPacketBatchSegmentGroups: GltfPacketBatchSegmentGroups = createGltfPacketBatchSegmentGroups();
  #gltfLiveBatchIds = new Uint32Array(1);
  #gltfLiveBatchCount = 0;
  readonly #gltfMaterialBatchClassIds = new Map<string, number>();
  #gltfMaterialBatchClassIdCount = 0;
  readonly #gltfLightScopeIds = new Map<string, number>();
  #gltfLightScopeIdCount = 0;
  readonly #gltfPacketOccurrenceIndicesByRequestKey = new Map<string, number[]>();
  readonly #gltfPacketBoundsScratch: MutableBounds3 = { max: [0, 0, 0], min: [0, 0, 0] };
  readonly #projectedBoundsWorkspace = createProjectedBoundsWorkspace();
  readonly #gltfPacketLocalModelScratch: MutableMat4 = identityMat4();
  readonly #gltfPacketRootSourceScratch: MutablePacketRootSourceRow = {
    kind: 0,
    outerIndex: 0,
    planOccurrenceIndex: 0,
  };
  readonly #sharedViewLodRootModel = identityMat4();
  readonly #sharedViewLodRootViewProjection = identityMat4();
  #gltfPreparedPrimitiveMaterials =
    new WeakMap<LoadedGltfPrimitive, WeakMap<LoadedGltfMaterial, GltfPreparedPrimitiveMaterial>>();
  readonly #gltfMaterialPrimitives = new WeakMap<LoadedGltfMaterial, Set<LoadedGltfPrimitive>>();
  readonly #textureHandles: TextureHandleArena;
  readonly #sceneBindings = new SceneBindingRegistry(() => this.invalidate());
  #dprMediaQuery: MediaQueryList | undefined;
  readonly #diagnostics = new BoundedDiagnosticLog();
  #disposed = false;
  readonly #externalRenderClocks = new Set<object>();
  #frame = 0;
  #gltfRenderOrdinal = 0;
  #gltfStateInstanceKey = 1;
  readonly #iblTextures: IblTextureArena;
  #gltfInstancingCounters = createWebGlGltfInstancingCounters();
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
  #hdrSupported = false;
  readonly #clusteredLights: ClusteredLightArena;
  #framePlan: FramePlan | undefined;
  readonly #framePlanDiffScratch = createResourceManifestDiffScratch();
  #framePlanReconciliationInProgress = false;
  #framePlanReconciliationPending = false;
  #framePlanReconciliationPrevious: FramePlan | undefined;
  #framePlanTopologyPending = false;
  #framePlanSurfaceLights: readonly SurfaceLight[] = [];
  #framePlanSurfaceLightSet: SurfaceLightSet | undefined;
  #latestScene: RenderRoot | undefined;
  #planRevision = 0;
  #planCompiles = 0;
  #compileNodeVisits = 0;
  #sceneCommits = 0;
  #maxTextureImageUnits = 0;
  #maxTextureSize = 0;
  readonly #pickingController: PickingController;
  #renderDirty = false;
  #renderScheduleGeneration = 0;
  #scheduledRenderGeneration = 0;
  #resizeObserver: ResizeObserver | undefined;
  readonly #geometryDrawArena: GeometryDrawArena;
  readonly #virtualTextureFrameDemand =
    createVirtualTextureFrameDemandWorkspace<VirtualTextureRuntimeState>();
  readonly #virtualTextureDemandPlanning = createVirtualTextureDemandPlanningWorkspace();
  readonly #virtualTextureFrameCommits = new Map<
    VirtualTextureRuntimeState,
    VirtualTextureFrameDemandCommit<VirtualTextureRuntimeState>
  >();
  readonly #virtualTextureDemandPublicationStates: VirtualTextureRuntimeState[] = [];
  readonly #virtualTextureAdmissionStates: VirtualTextureRuntimeState[] = [];
  readonly #virtualTextureDemandedStates = new Set<VirtualTextureRuntimeState>();
  readonly #virtualTextureDemandPublicationCommits: Array<
    VirtualTextureFrameDemandCommit<VirtualTextureRuntimeState> | undefined
  > = [];
  #virtualTextureDemandViewIndex = 0;
  readonly #virtualTextureDemandCursors = new WeakMap<VirtualTextureRuntimeState, number>();
  #unsupportedVirtualTextureDraws = 0;
  readonly #dprChangeListener = (): void => {
    this.#watchDevicePixelRatio();
    this.invalidate();
  };
  readonly #viewportInvalidationListener = (): void => {
    this.invalidate();
  };
  readonly #contextLostListener = (event: Event): void => {
    event.preventDefault();
    this.#context.lose(() => {
      this.#renderDirty ||= this.#latestScene !== undefined;
      this.#scheduledRenderGeneration = 0;
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
      this.#validateRestoredContextAttributes();
      this.#probeContextCapabilities();
      restoreVertexInputArenaContext(this.#vertexInputs, this.#context.generation);
      this.#ordinaryTextures.restoreContext(this.#context.generation);
      this.#renderDirty ||= this.#latestScene !== undefined;
      if (this.#context.finishRestore()) this.#scheduleRender();
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
      () => this.#gltfPreparationScheduler.dispose(),
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
      this.#pickingController = new PickingController(canvas, {
        gltfInstanceRootModels: (node) => this.#gltfInstanceTransforms.views(node.instances).rootModels,
        meshGeometry: (node) => this.#meshGeometry(node.geometry, node.material),
        meshLocalBounds: (geometry) => this.#localGeometryBounds(geometry),
        preparedGltfPrimitives: (node) => {
          const state = this.#gltf.get(gltfRequestKey(node.asset.uri, node.asset.version));
          return state?.status === "ready" ? state.primitives : undefined;
        },
        renderObjectTransform: (node) => this.#sceneBindings.transform(node),
      });
      const requestedOptions = normalizeOptions(options);
      this.#requestedContextOptions = {
        ...options,
        resourceGovernorPolicy: requestedOptions.resourceGovernorPolicy,
      };
      this.#resourceGovernor = createResourceGovernor(requestedOptions.resourceGovernorPolicy);
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
        (request, signal) => this.#prepareGltfAsset(request.src, request.key, signal),
        () => this.invalidate(),
        { retain: (source) => this.#decodedTextureSources.retainOrdinary(source) },
      );
      registerRollback(() => clearResourceArenaPreparedSources(this.#resourceArena));
      registerRollback(() => { disposeResourceArena(this.#resourceArena); });
      this.#gltfImages = new GltfImageDemandCoordinator({
        admit: this.#admitGltfPreparationJob,
        closeSource: (source) => this.#decodedTextureSources.closeOrdinary(source),
        diagnostic: (message, key) => this.#recordDiagnostic(message, `gltf-image:${key}`),
        invalidate: () => this.invalidate(),
        retainSource: (source) => retainResourceArenaSourceLease(this.#resourceArena, source),
      });
      registerRollback(() => this.#gltfImages.dispose());
      const gl = canvas.getContext("webgl2", {
        alpha: requestedOptions.alpha,
        antialias: requestedOptions.antialias,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null;
      if (gl === null) {
        throw new Error("Royal WebGL renderer requires a WebGL2 context");
      }
      this.#gl = gl;
      this.#options = this.#validatedContextOptions(requestedOptions);
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
          this.#registerAutoBaseColorVirtualTextureDecodedPageSource(texture, source);
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
          if (this.#disposed) return;
          if (released.persistentGpuBytes > 0) {
            if (!this.#suppressPersistentGpuCapacityWake) this.#wakePersistentGpuCapacity();
          }
          if (released.cpuDecodedBytes > 0) {
            if (!this.#suppressCpuCapacityWake) this.#scheduleCpuCapacityWake();
          }
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
      this.#virtualTextureRequests = new VirtualTextureRequestCoordinator({
        active: () => !this.#disposed && this.#context.lifecycle === "active",
        admitJob: this.#admitGltfPreparationJob,
        decodedSources: this.#decodedTextureSources,
        diagnostic: (message, key) => this.#recordDiagnostic(message, key),
        frame: () => this.#frame,
        gpu: this.#virtualTextureGpu,
        invalidate: () => this.invalidate(),
        loadPage: (state, page, signal) => this.#virtualTexturePageImage(state, page, signal),
        maximumDecodedCpuBytes: this.#maximumResourceClassCpuBytes("virtual-texture"),
        resourceGovernor: this.#resourceGovernor,
        resources: this.#virtualTextures,
      });
      this.#geometryDrawArena = createGeometryDrawArena(gl, this.#vertexInputs);
      registerRollback(() => clearGeometryDrawArenaContext(this.#geometryDrawArena));
      this.#programArena = createProgramArena(gl);
      registerRollback(() => dropProgramArenaContext(this.#programArena));
      registerRollback(() => releaseProgramArenaContextHandles(this.#programArena));
      this.#probeContextCapabilities();
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
      registerRollback(() => this.#resizeObserver?.disconnect());
      registerRollback(() => this.#unwatchDevicePixelRatio());
      this.#watchViewport();
    } catch (error) {
      rollbackConstruction();
      throw error;
    }
  }

  #wakePersistentGpuCapacity(): void {
    const ordinaryWake = this.#ordinaryTextures.wakeGpuCapacity();
    const iblWake = wakeIblTextureDurablePressure(this.#iblTextures);
    if (ordinaryWake || iblWake) this.invalidate();
    this.#scheduleGovernedVirtualTextureAdmissionRetry();
  }

  #probeContextCapabilities(): void {
    const gl = this.#gl;
    configureProgramArenaParallelCompile(
      this.#programArena,
      gl.getExtension("KHR_parallel_shader_compile") ?? undefined,
    );
    this.#hdrSupported = gl.getExtension("EXT_color_buffer_float") !== null;
    const maxTextureImageUnits = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    this.#maxTextureImageUnits = Number.isFinite(maxTextureImageUnits) ? maxTextureImageUnits : 0;
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.#maxTextureSize = Number.isFinite(maxTextureSize) ? maxTextureSize : 0;
    configureClusteredLightArena(this.#clusteredLights, this.#maxTextureImageUnits, this.#maxTextureSize);
  }

  #validatedContextOptions(base: NormalizedWebGlRootOptions): NormalizedWebGlRootOptions {
    const attributes = this.#gl.getContextAttributes();
    if (
      attributes === null
      || typeof attributes.alpha !== "boolean"
      || typeof attributes.antialias !== "boolean"
    ) {
      throw new Error("Royal WebGL context attributes are unavailable");
    }
    const { alpha, antialias } = attributes;
    if (this.#requestedContextOptions.alpha !== undefined && alpha !== this.#requestedContextOptions.alpha) {
      throw new Error(
        `Royal WebGL context requested alpha=${this.#requestedContextOptions.alpha} but received alpha=${alpha}`,
      );
    }
    if (
      this.#requestedContextOptions.antialias !== undefined
      && antialias !== this.#requestedContextOptions.antialias
    ) {
      throw new Error(
        `Royal WebGL context requested antialias=${this.#requestedContextOptions.antialias} but received antialias=${antialias}`,
      );
    }
    return Object.freeze({
      alpha,
      antialias,
      generatedImageVirtualTextures: base.generatedImageVirtualTextures,
      generatedSvgVirtualTextureRasterDensity: base.generatedSvgVirtualTextureRasterDensity,
      resourceGovernorPolicy: base.resourceGovernorPolicy,
    });
  }

  #validateRestoredContextAttributes(): void {
    const restored = this.#validatedContextOptions(this.#options);
    if (restored.alpha !== this.#options.alpha || restored.antialias !== this.#options.antialias) {
      throw new Error("Royal WebGL context restoration changed renderer context attributes");
    }
  }

  #notifyRenderFailure(failure: unknown): void {
    for (const observer of Array.from(this.#renderFailureObservers)) {
      if (!this.#renderFailureObservers.has(observer)) continue;
      try {
        observer(failure);
      } catch (observerFailure) {
        try {
          console.error("Royal WebGL render failure observer failed", observerFailure);
        } catch {
          // Failure delivery must never create a second uncaught async error.
        }
      }
    }
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
    if (this.#disposed) return () => undefined;
    this.#renderFailureObservers.add(callback);
    return () => {
      this.#renderFailureObservers.delete(callback);
    };
  }

  get frame(): number {
    return this.#frame;
  }

  get latestScene(): RenderRoot | undefined {
    return this.#latestScene;
  }

  get options(): NormalizedWebGlRootOptions {
    return this.#options;
  }

  acquireExternalRenderClock(): WebGlExternalRenderClock {
    if (this.#disposed) {
      throw new Error("Cannot acquire a render clock from a disposed Royal renderer root");
    }

    const token = {};
    this.#externalRenderClocks.add(token);
    this.#scheduledRenderGeneration = 0;
    let released = false;

    return {
      flushInvalidated: () => {
        if (
          released
          || !this.#externalRenderClocks.has(token)
          || this.#externalRenderClocks.size !== 1
        ) return;
        this.flushInvalidated();
      },
      release: () => {
        if (released) return;
        released = true;
        this.#externalRenderClocks.delete(token);
        if (this.#externalRenderClocks.size === 0) this.#scheduleRender();
      },
    };
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

    const { height, width } = this.#resize();
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
    this.#renderDirty = false;
    this.#scheduledRenderGeneration = 0;
    beginResourceGovernorFrame(this.#resourceGovernor);
    this.#applyPendingResourceArenaEvents();
    this.#gltfRenderOrdinal = 0;
    const gl = this.#gl;
    let renderFailure: CapturedFailure | undefined;
    beginVirtualTextureFrameDemand(this.#virtualTextureFrameDemand);
    this.#textureResidencyIntent.beginFrame();
    for (const state of this.#virtualTextures.values()) state.demandedPageKeysScratch.clear();
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameViews.framebuffer);
      prepareFrameBaseline(gl, frameViews.scissor);
      this.#stageReadyGltfImages();
      this.#processOrdinaryTextureUploads();
      this.#gltfInstanceTransforms.beginFrame();
      const wantsHdr = this.#planWantsHdr(plan);
      if (wantsHdr && !this.#hdrSupported) {
        throw new Error("Royal physical lighting requires EXT_color_buffer_float");
      }
      const useHdr = wantsHdr && this.#hdrSupported;
      const surfaceLights = this.#sceneSurfaceLightSet(plan.environment);
      const toneMapping = { ...sceneToneMappingState(plan), hdrOutput: useHdr };
      this.#prepareSharedViewGltfLodSelections(plan, frameViews);
      this.#selectGltfFramePackets(plan, frameViews);
      resetGltfPacketSubmissionWorkspaceForFrame(
        this.#gltfPacketSubmissionWorkspace,
        plan.revision,
        this.#gltfPacketTopology.catalog,
      );
      beginGltfPacketBatchRegistryFrame(this.#gltfPacketBatchRegistry);
      beginGltfInstanceBufferArenaFrame(this.#gltfInstanceBufferArena);
      for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
        this.#virtualTextureDemandViewIndex = viewIndex;
        // A scene occurrence has the same resource identity in every view.
        // Resetting the ordinal across eyes avoids duplicate instance uploads
        // and other occurrence-owned resources in XR.
        this.#gltfRenderOrdinal = 0;
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
        resetGltfPacketSubmissionWorkspaceForView(
          this.#gltfPacketSubmissionWorkspace,
          plan.revision,
          this.#gltfPacketTopology.catalog,
          viewIndex,
        );
        let packetCursor = this.#selectedGltfFramePackets.viewFirsts[viewIndex]!;
        const packetEnd = packetCursor
          + this.#selectedGltfFramePackets.viewCounts[viewIndex]!;
        const flushGltfPacketSubmissions = (): void => {
          if (this.#gltfPacketSubmissionWorkspace.count === 0) return;
          this.#drawGltfPacketSubmissions(
            projection,
            view,
            surfaceLights,
            toneMapping,
            viewportSize,
            sourceX,
            sourceY,
          );
          resetGltfPacketSubmissionWorkspaceForSegment(
            this.#gltfPacketSubmissionWorkspace,
            plan.revision,
            this.#gltfPacketTopology.catalog,
            this.#gltfPacketSubmissionWorkspace.segment,
          );
        };

        for (let nodeIndex = 0; nodeIndex < plan.nodes.length; nodeIndex += 1) {
          const node = plan.nodes[nodeIndex]!;
          if (node.kind === "directional-light" || node.kind === "point-light" || node.kind === "spot-light") continue;
          if (node.kind === "gltf" || node.kind === "gltf-instances") {
            const orderingSegment = plan.orderSegments[nodeIndex]!;
            if (this.#gltfPacketSubmissionWorkspace.segment !== orderingSegment) {
              flushGltfPacketSubmissions();
              resetGltfPacketSubmissionWorkspaceForSegment(
                this.#gltfPacketSubmissionWorkspace,
                plan.revision,
                this.#gltfPacketTopology.catalog,
                orderingSegment,
              );
            }
            const renderInstanceOrdinal = this.#gltfRenderOrdinal;
            this.#gltfRenderOrdinal += 1;
            packetCursor = this.#appendSelectedGltfPacketDrawsForNode(
              node,
              nodeIndex,
              renderInstanceOrdinal,
              packetCursor,
              packetEnd,
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
    renderFailure = captureFirstFailure(
      renderFailure,
      () => this.#gltfInstanceTransforms.endFrame(renderFailure === undefined),
    );
    renderFailure = captureFirstFailure(renderFailure, () => this.#releaseUnusedGltfBatchResources());
    renderFailure = captureFirstFailure(
      renderFailure,
      () => endClusteredLightFrame(this.#clusteredLights, this.#frame),
    );
    renderFailure = captureFirstFailure(
      renderFailure,
      () => this.#finalizeVirtualTextureFrameDemand(renderFailure === undefined),
    );
    if (renderFailure === undefined) {
      renderFailure = captureFirstFailure(renderFailure, () => this.#processVirtualTextureGpuUploads());
    }
    renderFailure = captureFirstFailure(
      renderFailure,
      () => this.#finalizeTextureResidencyIntent(renderFailure === undefined),
    );
    renderFailure = captureFirstFailure(renderFailure, () => {
      this.#frame += 1;
    });
    renderFailure = captureFirstFailure(renderFailure, () => this.#virtualTextureRequests.drain());
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
  }

  invalidate(): void {
    if (this.#disposed || this.#latestScene === undefined) return;

    this.#renderDirty = true;
    this.#scheduleRender();
  }

  flushInvalidated(): void {
    if (
      this.#disposed
      || this.#context.lifecycle !== "active"
      || !this.#renderDirty
      || this.#latestScene === undefined
    ) return;
    this.#renderLatestScene();
  }

  pick(input: PickInput): PickResult | undefined {
    if (this.#disposed) {
      throw new Error("Cannot pick with a disposed Royal renderer root");
    }
    if (this.#context.lifecycle !== "active") return undefined;
    const plan = this.#framePlan;
    if (plan === undefined) return undefined;

    const { height, width } = this.#resize();
    return this.#pickingController.pick({
      camera: this.#sceneBindings.readCamera(plan.camera),
      height,
      input,
      nodes: plan.nodes,
      width,
    });
  }

  #retainPlanWhileContextUnavailable(): void {
    this.#applyPendingResourceArenaEvents();
    this.#renderDirty = true;
  }

  #dropGpuState(deleteResources: boolean, contextGeneration = this.#context.generation): void {
    const previouslySuppressed = this.#suppressPersistentGpuCapacityWake;
    this.#suppressPersistentGpuCapacityWake = true;
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
    for (const lease of this.#virtualTextureGovernorLeases.values()) {
      releaseFailure = captureFirstFailure(releaseFailure, () => lease.release());
    }
    this.#virtualTextureGovernorLeases.clear();
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
    this.#gltfBatches.length = 0;
    this.#gltfLiveBatchCount = 0;
    releaseFailure = captureFirstFailure(releaseFailure, () => {
      clearGltfPacketBatchSegmentGroups(this.#gltfPacketBatchSegmentGroups);
    });
    releaseFailure = captureFirstFailure(
      releaseFailure,
      () => this.#gltfInstanceTransforms.endFrame(false),
    );

    releaseFailure = captureFirstFailure(releaseFailure, () => this.#virtualTextureRequests.loseContext());
    resetVirtualTextureFrameDemand(this.#virtualTextureFrameDemand);
    if (releaseFailure !== undefined) throw releaseFailure.value;
    } finally {
      this.#suppressPersistentGpuCapacityWake = previouslySuppressed;
    }
  }

  dispose(): void {
    if (
      this.#resourceArenaSideEffectDrainInProgress
      || this.#preparedAssetEventDrainInProgress
    ) {
      throw new Error("Cannot dispose while Royal is applying resource events");
    }
    if (this.#framePlanReconciliationInProgress) {
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
      retryFailure = captureFirstFailure(retryFailure, () => this.#drainResourceArenaSideEffectDebt());
      retryFailure = captureFirstFailure(retryFailure, () => this.#decodedTextureSources.retryPending());
      if (retryFailure !== undefined) throw retryFailure.value;
      return;
    }
    const canDeleteResources = this.#context.lifecycle === "active"
      || this.#context.lifecycle === "restoring";
    const contextGeneration = this.#context.generation;
    this.#disposed = true;
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
    this.#renderFailureObservers.clear();
    this.#externalRenderClocks.clear();

    teardown(() => this.#ordinaryTextures.disposeSources());
    teardown(() => this.#gltfImages.dispose());
    teardown(() => {
      const disposal = disposeResourceArena(this.#resourceArena);
      // The semantic arena is now authoritatively empty. Retrying an older
      // acquisition after its paired disposal release could resurrect state in
      // this disposed root; release debt still owns any partially-created
      // imperative resources and must continue normally.
      this.#cancelResourceArenaAcquisitionDebt();
      const applyFailure = captureFailure(() => this.#applyResourceArenaChanges(disposal.changes));
      if (disposal.kind === "failed") throw disposal.error;
      if (applyFailure !== undefined) throw applyFailure.value;
    });
    for (const key of resourceArenaPreparedSourceKeys(this.#resourceArena)) {
      teardown(() => this.#releaseOrdinaryTexture(key));
    }
    for (const state of this.#virtualTextures.values()) {
      teardown(() => this.#releaseVirtualTextureState(state));
    }
    this.#virtualTextures.clear();
    teardown(() => clearGeometryDrawArenaContext(this.#geometryDrawArena));
    this.#retainedGeometryRecipes.clear();
    clearVirtualTextureCoverageProviderCache(this.#virtualTextureCoverageProviders);
    this.#gltfPacketPrimitivesByGeometryId.clear();
    teardown(() => clearResourceArenaPreparedSources(this.#resourceArena));
    this.#autoVirtualTextureRefs.clear();
    this.#autoVirtualTextureGeneratedPageSources.clear();
    this.#pendingPreparedAssetEvents.length = 0;
    this.#pendingPreparedAssetEventHead = 0;
    this.#gltf.clear();
    for (const key of this.#preparedAssetCpuGovernorLeases.keys()) {
      this.#releasePreparedAssetCpuLeases(key);
    }
    teardown(() => this.#gltfPreparationScheduler.dispose());
    this.#gltfBatches.length = 0;
    teardown(() => clearGltfInstanceBufferArena(this.#gltfInstanceBufferArena));
    this.#gltfLiveBatchCount = 0;
    teardown(() => clearGltfPacketBatchSegmentGroups(this.#gltfPacketBatchSegmentGroups));
    teardown(() => clearGltfPacketBatchRegistry(this.#gltfPacketBatchRegistry));
    teardown(() => clearGltfPacketSubmissionWorkspace(this.#gltfPacketSubmissionWorkspace));
    this.#gltfMaterialBatchClassIds.clear();
    this.#gltfMaterialBatchClassIdCount = 0;
    this.#gltfLightScopeIds.clear();
    this.#gltfLightScopeIdCount = 0;
    teardown(() => this.#sceneBindings.dispose());
    teardown(() => this.#gltfInstanceTransforms.dispose());
    this.#renderDirty = false;
    this.#scheduledRenderGeneration = 0;
    teardown(() => this.#resizeObserver?.disconnect());
    this.#resizeObserver = undefined;
    teardown(() => this.#unwatchDevicePixelRatio());
    teardown(() => disposeVertexInputArena(this.#vertexInputs));
    teardown(() => this.#decodedTextureSources.retryPending());
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  snapshot(): WebGlRootSnapshot {
    const diagnostics = this.#diagnostics.snapshot();
    const textureResidency = this.#textureResidencySnapshot();
    const virtualTexturing = this.#virtualTexturingSnapshot();
    const gltfImages = this.#gltfImages.snapshot();
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
      frame: this.#frame,
      gltfLoadDiagnostics: this.#gltfLoadDiagnosticsSnapshot(),
      gltfInstancing: this.#gltfInstancingSnapshot(),
      latestScene: this.#latestScene,
      options: this.#options,
      planning: {
        compileNodeVisits: this.#compileNodeVisits,
        planCompiles: this.#planCompiles,
        planRevision: this.#planRevision,
        sceneCommits: this.#sceneCommits,
      },
      resourceLifetime: {
        ...resourceArenaCountersSnapshot(this.#resourceArena),
        gltfPreparationQueueHighWater: this.#gltfPreparationScheduler.snapshot().queueHighWater,
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
    if (this.#framePlanReconciliationInProgress) {
      throw new Error("Cannot render while Royal is reconciling render-object refs");
    }
    this.#drainResourceArenaSideEffectDebt();
    const previous = this.#framePlan;
    if (this.#framePlanReconciliationPending) this.#finishFramePlanReconciliation();
    if (previous?.scene === scene) return previous;

    const revision = this.#planRevision + 1;
    const next = compileFramePlan(scene, revision);
    const surfaceLights = compileSceneSurfaceLights(next.lightNodes);
    const resourceDelta = diffResourceManifests(
      previous?.manifest ?? EMPTY_FRAME_PLAN_RESOURCE_MANIFEST,
      next.manifest,
      this.#framePlanDiffScratch,
    );
    // ResourceArena is the authoritative resource generation. Once its
    // validated delta commits, publish the matching frame plan before running
    // fallible GPU cleanup, source close hooks, or user ref callbacks. A
    // reported side-effect failure can then be retried without applying the
    // same semantic resource delta to an arena that is already on `next`.
    const resourceChanges = applyResourceDelta(this.#resourceArena, resourceDelta);
    this.#framePlan = next;
    this.#sharedViewLods.resetPlan();
    this.#framePlanSurfaceLights = surfaceLights;
    this.#framePlanSurfaceLightSet = surfaceLights.length === 0 ? undefined : surfaceLightSet(surfaceLights);
    this.#latestScene = scene;
    this.#planRevision = revision;
    this.#planCompiles += 1;
    this.#compileNodeVisits += next.nodes.length;
    this.#sceneCommits += 1;
    this.#framePlanReconciliationPending = true;
    this.#framePlanReconciliationPrevious = previous;
    this.#framePlanTopologyPending = true;
    const resourceFailure = captureFailure(() => this.#applyResourceArenaChanges(resourceChanges));
    this.#finishFramePlanReconciliation(resourceDelta, resourceFailure);
    return next;
  }

  #gltfPacketPreparedPrimitives(
    node: AnyGltfNode,
    state: GltfState,
    renderInstanceOrdinal: number,
  ): readonly GltfPacketPreparedPrimitive[] {
    const outerCount = node.kind === "gltf-instances" ? node.instances.count : 1;
    const selectedVariantIndex = state.hasMaterialVariants
      ? this.#selectedGltfVariantIndex(state, node)
      : undefined;
    return state.primitives.map((primitive) => {
      const geometryKey = this.#gltfPrimitiveGeometryKeys.get(primitive);
      const retainedGeometry = geometryKey === undefined
        ? undefined
        : this.#retainedGeometryRecipes.get(geometryKey);
      if (retainedGeometry === undefined) {
        throw new Error(`Royal glTF primitive geometry ${primitive.key} was not retained for packets`);
      }
      this.#gltfPacketPrimitivesByGeometryId.set(retainedGeometry.id, primitive);
      const primitiveMaterial = selectedVariantIndex === undefined
        ? primitive.baseMaterial
        : this.#gltfPrimitiveMaterialForVariant(selectedVariantIndex, primitive);
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
            return this.#sharedViewLods.materialSelectionId(
              state.key,
              this.#gltfMaterialLodSelectionKey(
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
              this.#sharedViewLods.nodeSelectionId(
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
    const state = this.#gltf.get(row.requestKey);
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
    this.#gltfPacketPrimitivesByGeometryId.clear();
    this.#gltfPacketOccurrenceIndicesByRequestKey.clear();
    for (let index = 0; index < plan.gltfRequestRows.length; index += 1) {
      const key = plan.gltfRequestRows[index]!.requestKey;
      const indices = this.#gltfPacketOccurrenceIndicesByRequestKey.get(key);
      if (indices === undefined) this.#gltfPacketOccurrenceIndicesByRequestKey.set(key, [index]);
      else indices.push(index);
    }
    rebuildGltfPacketTopology(
      this.#gltfPacketTopology,
      plan.revision,
      plan.gltfRequestRows.map((_, index) => this.#gltfPacketOccurrence(plan, index)),
    );
  }

  #finishFramePlanReconciliation(
    initialDelta?: ResourceManifestDelta,
    initialFailure?: CapturedFailure,
  ): void {
    if (this.#framePlanReconciliationInProgress) {
      throw new Error("Render-object ref reconciliation is already in progress");
    }
    const next = this.#framePlan;
    if (next === undefined) return;
    const previous = this.#framePlanReconciliationPrevious;
    const delta = initialDelta ?? diffResourceManifests(
      previous?.manifest ?? EMPTY_FRAME_PLAN_RESOURCE_MANIFEST,
      next.manifest,
      this.#framePlanDiffScratch,
    );
    this.#framePlanReconciliationInProgress = true;
    try {
      let firstFailure = initialFailure;
      if (this.#framePlanTopologyPending) {
        const topologyFailure = captureFailure(() => this.#rebuildGltfPacketTopology(next));
        if (topologyFailure === undefined) this.#framePlanTopologyPending = false;
        else firstFailure ??= topologyFailure;
      }
      firstFailure = captureFirstFailure(
        firstFailure,
        () => this.#sceneBindings.reconcile(next, delta.renderObjectRefs),
      );
      firstFailure = captureFirstFailure(
        firstFailure,
        () => this.#gltfInstanceTransforms.reconcile(delta.bulkInstances),
      );
      if (firstFailure !== undefined) throw firstFailure.value;
      this.#framePlanReconciliationPending = false;
      this.#framePlanReconciliationPrevious = undefined;
    } finally {
      this.#framePlanReconciliationInProgress = false;
    }
  }

  #preparedAssetDependencyManifest(
    asset: PreparedGltfAsset,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
    assetKey: string,
  ): PreparedAssetDependencyManifest {
    const geometries = asset.primitives.map((primitive, index) => {
      const declaration = gltfGeometryDeclaration({
        ...(primitive.colors === undefined ? {} : { colors: primitive.colors }),
        ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
        mode: primitive.mode,
        ...(primitive.normals === undefined ? {} : { normals: primitive.normals }),
        positions: primitive.positions,
        ...(primitive.tangents === undefined ? {} : { tangents: primitive.tangents }),
        ...(primitive.texCoords0 === undefined ? {} : { texCoords0: primitive.texCoords0 }),
        ...(primitive.texCoords1 === undefined ? {} : { texCoords1: primitive.texCoords1 }),
      });
      const key = JSON.stringify([
        "gltf-geometry-owner-v1",
        assetKey,
        primitive.key,
        index,
        geometryDeclarationBucketKey(declaration),
      ]);
      this.#gltfPrimitiveGeometryKeys.set(primitive, key);
      return {
        count: 1,
        declaration,
        key,
      };
    });
    return {
      ...this.#materialDependencyManifest(preparedAssetMaterials(asset), contentKeys),
      geometries,
      iblKeys: asset.imageBasedLight?.specular === undefined
        ? []
        : [{ count: 1, key: asset.imageBasedLight.specular.key }],
      wantsHdr: asset.lights.length !== 0 || asset.imageBasedLight !== undefined,
    };
  }

  #materialDependencyManifest(
    materials: readonly LoadedGltfMaterial[],
    contentKeys: ReadonlyMap<string, TextureContentKey>,
  ): PreparedAssetDependencyManifest {
    const byKey = new Map<string, CountedTextureDeclaration<TextureAssetUploadRef> & { count: number }>();
    const ordinaryTextures: Array<CountedTextureDeclaration<TextureAssetUploadRef> & { count: number }> = [];
    for (const material of materials) {
      for (const texture of this.#gltfMaterialTextureRefs(material, contentKeys)) {
        const key = textureCacheKey(texture);
        const existing = byKey.get(key);
        if (existing === undefined) {
          const entry = { count: 1, key, texture };
          byKey.set(key, entry);
          ordinaryTextures.push(entry);
        } else {
          existing.count += 1;
        }
      }
    }
    return { geometries: [], iblKeys: [], ordinaryTextures, virtualTextures: [], wantsHdr: false };
  }

  #applyResourceArenaChanges(changes: ResourceArenaChanges): void {
    const apply = (
      phase: ResourceArenaSideEffectDebt["phase"],
      ...steps: readonly (() => void)[]
    ): void => {
      if (phase === "acquire" && this.#resourceArenaAcquisitionsCancelled) return;
      this.#resourceArenaSideEffectDebt.push({ nextStep: 0, phase, steps });
    };
    for (const { id, key, recipe } of changes.acquiredGeometryDeclarations) {
      apply(
        "acquire",
        () => retainVertexInputGeometry(this.#vertexInputs, { geometryId: id, recipe }),
        () => this.#retainedGeometryRecipes.set(key, { id, recipe }),
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
          if (this.#retainedGeometryRecipes.get(key)?.id === id) this.#retainedGeometryRecipes.delete(key);
        },
        () => releaseVirtualTextureCoverageProviders(this.#virtualTextureCoverageProviders, id),
        () => this.#gltfPacketPrimitivesByGeometryId.delete(id),
      );
    }
    for (const { generation, request } of changes.acquiredGltfRequests) {
      apply("acquire", () => this.#ensureGltfState(request.key, generation));
    }
    for (const key of changes.releasedGltfKeys) {
      apply(
        "release",
        () => this.#gltfImages.releaseAsset(key),
        () => this.#releasePreparedAssetCpuLeases(key),
        () => this.#gltf.delete(key),
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
    this.#drainResourceArenaSideEffectDebt();
  }

  #drainResourceArenaSideEffectDebt(): void {
    if (
      this.#resourceArenaSideEffectDrainInProgress
      || this.#resourceArenaSideEffectDebt.length === 0
    ) return;
    const pending = this.#resourceArenaSideEffectDebt;
    this.#resourceArenaSideEffectDebt = [];
    this.#resourceArenaSideEffectDrainInProgress = true;
    let firstFailure: CapturedFailure | undefined;
    const remaining: ResourceArenaSideEffectDebt[] = [];
    try {
      for (const operation of pending) {
        if (operation.phase === "acquire" && this.#resourceArenaAcquisitionsCancelled) continue;
        while (operation.nextStep < operation.steps.length) {
          const failure = captureFailure(operation.steps[operation.nextStep]!);
          if (failure !== undefined) {
            firstFailure ??= failure;
            if (!(operation.phase === "acquire" && this.#resourceArenaAcquisitionsCancelled)) {
              remaining.push(operation);
            }
            break;
          }
          operation.nextStep += 1;
          if (operation.phase === "acquire" && this.#resourceArenaAcquisitionsCancelled) break;
        }
      }
    } finally {
      this.#resourceArenaSideEffectDrainInProgress = false;
      this.#resourceArenaSideEffectDebt = [
        ...remaining,
        ...this.#resourceArenaSideEffectDebt,
      ];
    }
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  #cancelResourceArenaAcquisitionDebt(): void {
    this.#resourceArenaAcquisitionsCancelled = true;
    this.#resourceArenaSideEffectDebt = this.#resourceArenaSideEffectDebt.filter(
      (operation) => operation.phase !== "acquire",
    );
  }

  #applyPendingResourceArenaEvents(): void {
    if (this.#preparedAssetEventDrainInProgress) return;
    this.#drainResourceArenaSideEffectDebt();
    // A retained event belongs to the already-applied arena generation. Drain
    // it before admitting newer arena events so same-key revisions cannot be
    // published in reverse order after a fallible imperative side effect.
    this.#drainPendingPreparedAssetEvents();
    if (resourceArenaHasPendingAssetEvents(this.#resourceArena)) {
      const applied = applyPreparedAssetEvents(
        this.#resourceArena,
        (asset, contentKeys, assetKey) => this.#preparedAssetDependencyManifest(asset, contentKeys, assetKey),
      );
      // The arena consumes its pending keys transactionally. Retain the event
      // batch before running fallible imperative side effects so their retry
      // cannot strand semantic publication on the old renderer generation.
      this.#pendingPreparedAssetEvents.push(...applied.events);
      this.#applyResourceArenaChanges(applied.changes);
    }
    this.#drainPendingPreparedAssetEvents();
  }

  #drainPendingPreparedAssetEvents(): void {
    if (this.#preparedAssetEventDrainInProgress) return;
    this.#preparedAssetEventDrainInProgress = true;
    try {
      while (this.#pendingPreparedAssetEventHead < this.#pendingPreparedAssetEvents.length) {
        this.#applyPreparedAssetEvent(
          this.#pendingPreparedAssetEvents[this.#pendingPreparedAssetEventHead]!,
        );
        this.#pendingPreparedAssetEventHead += 1;
      }
      this.#pendingPreparedAssetEvents.length = 0;
      this.#pendingPreparedAssetEventHead = 0;
    } finally {
      this.#preparedAssetEventDrainInProgress = false;
    }
  }

  #applyPreparedAssetEvent(event: PreparedAssetArenaEvent): void {
    const snapshot = event.snapshot;
    const state = this.#gltf.get(snapshot.key);
    if (state === undefined || state.preparedGeneration !== snapshot.generation) return;
    if (snapshot.status === "error") {
      this.#releaseGltfImageAssetForReplacement(snapshot.key);
      state.status = "error";
      state.error = snapshot.error;
      state.load.readyAt = nowMs();
      this.#recordDiagnostic(snapshot.error, `gltf-asset:${state.key}`);
      const plan = this.#framePlan;
      if (plan !== undefined) {
        for (const occurrenceIndex of this.#gltfPacketOccurrenceIndicesByRequestKey.get(snapshot.key) ?? []) {
          if (
            this.#gltfPacketTopology.occurrenceStatuses[occurrenceIndex]
            === GLTF_PACKET_OCCURRENCE_STATUS.ready
          ) {
            clearGltfPacketOccurrence(this.#gltfPacketTopology, plan.revision, occurrenceIndex);
          }
        }
      }
      return;
    }
    if (snapshot.status !== "ready") return;
    const asset = snapshot.asset;
    this.#releaseGltfImageAssetForReplacement(snapshot.key);
    const replacesReadyAsset = state.status === "ready";
    const lodReplacement = replacesReadyAsset
      ? this.#sharedViewLods.beginAssetReplacement(state.key)
      : undefined;
    state.hasMaterialLod = asset.hasMaterialLod;
    state.hasMaterialVariants = asset.hasMaterialVariants;
    state.hasNodeLod = asset.hasNodeLod;
    if (asset.imageBasedLight === undefined) delete state.imageBasedLight;
    else state.imageBasedLight = asset.imageBasedLight;
    state.lights = asset.lights;
    state.materials = preparedAssetMaterials(asset);
    state.load = asset.load;
    delete state.error;
    state.nodeCount = asset.nodeCount;
    state.primitives = asset.primitives;
    state.status = "ready";
    state.variants = asset.variants;
    const plan = this.#framePlan;
    if (plan !== undefined) {
      const occurrenceIndices = this.#gltfPacketOccurrenceIndicesByRequestKey.get(snapshot.key) ?? [];
      try {
        for (const occurrenceIndex of occurrenceIndices) {
          const topologyStatus = this.#gltfPacketTopology.occurrenceStatuses[occurrenceIndex];
          if (topologyStatus === GLTF_PACKET_OCCURRENCE_STATUS.loading) {
            appendReadyGltfPacketOccurrence(
              this.#gltfPacketTopology,
              plan.revision,
              this.#gltfPacketOccurrence(plan, occurrenceIndex),
            );
          } else if (topologyStatus === GLTF_PACKET_OCCURRENCE_STATUS.ready) {
            replaceReadyGltfPacketOccurrence(
              this.#gltfPacketTopology,
              plan.revision,
              this.#gltfPacketOccurrence(plan, occurrenceIndex),
            );
          }
        }
        if (lodReplacement !== undefined) {
          this.#sharedViewLods.commitAssetReplacement(lodReplacement);
        }
      } catch (error) {
        // Asset state and the packet resolver bridge must never describe
        // different generations. If publication fails, make every range for
        // this request unreachable instead of retaining a mixed generation.
        for (const occurrenceIndex of occurrenceIndices) {
          if (
            this.#gltfPacketTopology.occurrenceStatuses[occurrenceIndex]
            === GLTF_PACKET_OCCURRENCE_STATUS.ready
          ) {
            clearGltfPacketOccurrence(this.#gltfPacketTopology, plan.revision, occurrenceIndex);
          }
        }
        if (lodReplacement !== undefined) {
          this.#sharedViewLods.rollbackAssetReplacement(lodReplacement);
        }
        state.status = "error";
        state.error = error instanceof Error ? error.message : String(error);
        state.load.readyAt = nowMs();
        this.#recordDiagnostic(state.error, `gltf-packets:${state.key}`);
        if (asset.imagePreparation !== undefined) {
          this.#detachPreparedAssetImagePreparation(snapshot.key, snapshot.generation);
          this.#releasePreparedAssetDecodeLease(snapshot.key);
        }
        return;
      }
    } else if (lodReplacement !== undefined) {
      this.#sharedViewLods.commitAssetReplacement(lodReplacement);
    }
    const images = asset.imagePreparation;
    if (images === undefined) return;
    const eventIsCurrent = (): boolean =>
      !this.#disposed
      && this.#gltf.get(snapshot.key) === state
      && state.preparedGeneration === snapshot.generation;
    let recipeLease: GltfImageRecipeLease | undefined;
    try {
      recipeLease = this.#takePreparedAssetDecodeRecipeLease(
        state.key,
        gltfImageSourceRecipeBytes(images.recipes),
      );
      this.#gltfImages.registerAsset({
        ...(state.imageBasedLight === undefined ? {} : { imageBasedLight: state.imageBasedLight }),
        key: state.key,
        load: state.load,
        materials: state.materials,
        recipeLease,
        recipes: images.recipes,
        stateInstanceKey: state.instanceKey,
      });
      if (!eventIsCurrent()) {
        this.#releaseGltfImageAssetForReplacement(state.key);
        return;
      }
      this.#detachPreparedAssetImagePreparation(snapshot.key, snapshot.generation);
    } catch (error) {
      recipeLease?.release();
      if (!eventIsCurrent()) return;
      this.#detachPreparedAssetImagePreparation(snapshot.key, snapshot.generation);
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
      state.load.readyAt = nowMs();
      this.#recordDiagnostic(state.error, `gltf-images:${state.key}`);
    }
  }

  #releaseGltfImageAssetForReplacement(key: string): void {
    try {
      this.#gltfImages.releaseAsset(key);
    } catch (error) {
      // releaseAsset removes the old generation before fallible cleanup and
      // retains failed work as coordinator cleanup debt. Do not strand an
      // already-consumed prepared-asset event outside the replacement path.
      this.#recordDiagnostic(
        `glTF image asset cleanup failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
        `gltf-image-cleanup:${key}`,
      );
    }
  }

  #releaseOrdinaryTexture(key: string): void {
    let releaseFailure = captureFailure(() => this.#releaseAutoVirtualTextures(key));
    this.#autoVirtualTextureRefs.delete(`auto-base-color:${key}`);
    this.#autoVirtualTextureGeneratedPageSources.delete(key);
    const previouslySuppressed = this.#suppressPersistentGpuCapacityWake;
    this.#suppressPersistentGpuCapacityWake = true;
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
      this.#suppressPersistentGpuCapacityWake = previouslySuppressed;
    }
    if (report?.capacityReleased === true && !previouslySuppressed) {
      this.#wakePersistentGpuCapacity();
    }
    if (report !== undefined) releaseFailure = captureFirstFailure(releaseFailure, () => {
      const settlement = this.#ordinaryTextures.settleGpuReport(report);
      if (settlement !== undefined) throw settlement.error;
    });
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  #releaseAutoVirtualTextures(textureKey: string): void {
    const prefix = `auto-base-color:${textureKey}:`;
    let releaseFailure: CapturedFailure | undefined;
    for (const [key, state] of this.#virtualTextures) {
      if (!key.startsWith(prefix)) continue;
      this.#virtualTextures.delete(key);
      releaseFailure = captureFirstFailure(releaseFailure, () => this.#releaseVirtualTextureState(state));
    }
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  #releaseVirtualTexture(key: string): void {
    const state = this.#virtualTextures.get(key);
    if (state === undefined) return;
    this.#virtualTextures.delete(key);
    this.#releaseVirtualTextureState(state);
  }

  #releaseVirtualTextureState(state: VirtualTextureRuntimeState): void {
    state.sourceGeneration += 1;
    let releaseFailure: CapturedFailure | undefined;
    releaseFailure = captureFirstFailure(releaseFailure, () => state.manifestAbortController?.abort());
    delete state.manifestAbortController;
    releaseFailure = captureFirstFailure(releaseFailure, () => this.#virtualTextureRequests.release(state));
    state.desiredPageKeys.clear();
    state.desiredPageKeysScratch.clear();
    state.demandedPageKeys.clear();
    state.demandedPageKeysScratch.clear();
    state.desiredPages.length = 0;
    state.desiredPagesScratch.length = 0;
    releaseVirtualTextureFrameDemandResource(this.#virtualTextureFrameDemand, state);
    this.#virtualTextureDemandCursors.delete(state);
    releaseFailure = captureFirstFailure(
      releaseFailure,
      () => this.#releaseVirtualTextureGpuOwnership(state, true),
    );
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  #releaseVirtualTextureGpuOwnership(
    state: VirtualTextureRuntimeState,
    removeResource: boolean,
  ): void {
    let releaseFailure: CapturedFailure | undefined;
    let release: ReturnType<typeof releaseVirtualTextureGpuResource> = {
      releaseError: undefined,
      releaseErrorPresent: false,
    };
    // Logical ownership ends even when driver deletion fails. The arena's
    // quarantined bytes are observed separately until the context is dropped.
    const lease = this.#virtualTextureGovernorLeases.get(state.key);
    const previouslySuppressed = this.#suppressPersistentGpuCapacityWake;
    this.#suppressPersistentGpuCapacityWake = true;
    try {
      releaseFailure = captureFirstFailure(releaseFailure, () => {
        release = removeResource
          ? releaseVirtualTextureGpuResource(this.#virtualTextureGpu, state.key)
          : releaseVirtualTextureGpuAllocation(this.#virtualTextureGpu, state.key);
      });
      releaseFailure = captureFirstFailure(
        releaseFailure,
        () => this.#synchronizeResourceGovernorObservations(),
      );
      releaseFailure = captureFirstFailure(releaseFailure, () => lease?.release());
    } finally {
      this.#suppressPersistentGpuCapacityWake = previouslySuppressed;
    }
    this.#virtualTextureGovernorLeases.delete(state.key);
    releaseFailure = captureFirstFailure(releaseFailure, () => this.#consumeVirtualTextureGpuOutcomes());
    if (release.releaseErrorPresent) {
      releaseFailure ??= { value: release.releaseError };
    } else if (lease !== undefined && !previouslySuppressed) {
      this.#wakePersistentGpuCapacity();
    }
    if (this.#context.lifecycle === "active") {
      if (consumeVirtualTextureGpuWake(this.#virtualTextureGpu)) this.invalidate();
    }
    if (releaseFailure !== undefined) throw releaseFailure.value;
  }

  #scheduleGovernedVirtualTextureAdmissionRetry(): void {
    if (
      this.#governedVirtualTextureRetryScheduled
      || this.#disposed
      || this.#context.lifecycle !== "active"
      || !this.#hasGovernedVirtualTextureAdmissionDemand()
    ) return;
    this.#governedVirtualTextureRetryScheduled = true;
    queueMicrotask(() => {
      this.#governedVirtualTextureRetryScheduled = false;
      if (
        this.#disposed
        || this.#context.lifecycle !== "active"
        || !this.#hasGovernedVirtualTextureAdmissionDemand()
      ) return;
      this.invalidate();
    });
  }

  #hasGovernedVirtualTextureAdmissionDemand(): boolean {
    for (const state of this.#virtualTextures.values()) {
      if (
        state.status === "ready"
        && state.manifest !== undefined
        && state.lastDemandFrame !== Number.NEGATIVE_INFINITY
        && !this.#virtualTextureGovernorLeases.has(state.key)
      ) return true;
    }
    return false;
  }

  #gltfMaterialTextureRefs(
    material: LoadedGltfMaterial,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
  ): readonly TextureAssetUploadRef[] {
    const refs = [
      this.#gltfMaterialTextureRef(material, contentKeys),
      this.#gltfMaterialEmissiveTextureRef(material, contentKeys),
      this.#gltfMaterialMetallicRoughnessTextureRef(material, contentKeys),
      this.#gltfMaterialNormalTextureRef(material, contentKeys),
      this.#gltfMaterialOcclusionTextureRef(material, contentKeys),
      ...GLTF_MATERIAL_EXTENSION_TEXTURES.map((texture) =>
        this.#gltfTextureSlotRef(material.extensionTextures?.[texture.key], texture.colorSpace, contentKeys)),
    ];
    return refs.filter((ref): ref is TextureAssetUploadRef => ref !== undefined);
  }

  #resize(): { readonly height: number; readonly width: number } {
    const rect = this.#canvas.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;
    const dpr = globalThis.devicePixelRatio ?? 1;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.#canvas.width !== width) this.#canvas.width = width;
    if (this.#canvas.height !== height) this.#canvas.height = height;

    return { height, width };
  }

  #watchViewport(): void {
    const ResizeObserverConstructor = globalThis.ResizeObserver;
    if (typeof ResizeObserverConstructor === "function") {
      this.#resizeObserver = new ResizeObserverConstructor(this.#viewportInvalidationListener);
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
    const retainedGeometry = this.#meshGeometryRow(node.geometry, node.material);
    const cpu = retainedGeometry.recipe;
    const model = transformMat4Into(this.#meshModel, this.#sceneBindings.transform(node));
    const localBounds = this.#localGeometryBounds(cpu);
    if (!isBoundsVisible(
      localBounds,
      multiplyMat4Into(this.#meshViewProjectionModel, viewProjection, model),
    )) return;
    const gpu = this.#geometryResource(retainedGeometry.id);
    this.#applyDrawAlphaState(node.material);
    try {
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
    } finally {
      this.#resetDrawAlphaState();
    }
  }

  #appendSelectedGltfPacketDrawsForNode(
    node: AnyGltfNode,
    nodeIndex: number,
    renderInstanceOrdinal: number,
    packetCursor: number,
    packetEnd: number,
  ): number {
    const topology = this.#gltfPacketTopology;
    const catalog = topology.catalog;
    const selected = this.#selectedGltfFramePackets;
    if (packetCursor >= packetEnd) return packetCursor;
    const firstPacketIndex = selected.orderedPacketIndices[packetCursor]!;
    readPacketRootSourceInto(
      topology.resources,
      catalog.rootSourceIds[firstPacketIndex]!,
      this.#gltfPacketRootSourceScratch,
    );
    if (this.#gltfPacketRootSourceScratch.planOccurrenceIndex !== nodeIndex) {
      if (this.#gltfPacketRootSourceScratch.planOccurrenceIndex < nodeIndex) {
        throw new Error("Royal retained glTF packet selection is not in frame-plan order");
      }
      return packetCursor;
    }
    const state = this.#gltfState(node);
    const instanceViews = node.kind === "gltf-instances"
      ? this.#gltfInstanceTransforms.views(node.instances)
      : undefined;
    const rootHandle = node.kind === "gltf" ? this.#sceneBindings.handle(node) : undefined;
    const ordinaryRootTransform = node.kind === "gltf"
      ? rootHandle === undefined ? node.transform : readRenderObjectHandleTransform(rootHandle)
      : undefined;
    const ordinaryRootModel = node.kind === "gltf"
      ? transformMat4(ordinaryRootTransform)
      : undefined;
    const ordinaryAssetLights = ordinaryRootModel === undefined
      ? undefined
      : this.#gltfAssetLightSet(state, ordinaryRootModel);
    const ordinaryLightScopeId = ordinaryAssetLights === undefined
      ? 0
      : this.#gltfLightScopeId(state.instanceKey, renderInstanceOrdinal, 0);
    const instanceAssetLights = instanceViews === undefined
      ? undefined
      : new Map<number, { readonly lights: SurfaceLightSet | undefined; readonly scopeId: number }>();
    let cursor = packetCursor;

    while (cursor < packetEnd) {
      const packetIndex = selected.orderedPacketIndices[cursor]!;
      readPacketRootSourceInto(
        topology.resources,
        catalog.rootSourceIds[packetIndex]!,
        this.#gltfPacketRootSourceScratch,
      );
      const source = this.#gltfPacketRootSourceScratch;
      if (source.planOccurrenceIndex !== nodeIndex) {
        if (source.planOccurrenceIndex < nodeIndex) {
          throw new Error("Royal retained glTF packet selection is not in frame-plan order");
        }
        break;
      }
      const expectedKind = node.kind === "gltf"
        ? GLTF_PACKET_ROOT_SOURCE_KIND.gltf
        : GLTF_PACKET_ROOT_SOURCE_KIND.gltfInstances;
      if (source.kind !== expectedKind) {
        throw new Error("Royal retained glTF packet root kind diverged from the frame plan");
      }
      const outerIndex = catalog.instanceFirsts[packetIndex]!;
      if (source.outerIndex !== outerIndex || catalog.instanceCounts[packetIndex] !== 1) {
        throw new Error("Royal retained glTF packet instance source is invalid");
      }
      const geometryId = catalog.geometryIds[packetIndex]!;
      const primitive = this.#gltfPacketPrimitivesByGeometryId.get(geometryId);
      if (primitive === undefined) {
        throw new Error(`Royal retained glTF packet geometry ${geometryId} has no prepared primitive`);
      }
      const loadedMaterial = resolvePacketMaterial(
        topology.resources,
        catalog.materialIds[packetIndex]!,
      );
      this.#gltfImages.demandMaterial(state.key, loadedMaterial);
      const prepared = this.#preparedGltfPrimitiveMaterial(state, primitive, loadedMaterial);
      const geometry = this.#geometryResource(geometryId);
      const localDeterminant = readPacketLocalModelInto(
        topology.resources,
        catalog.localModelIds[packetIndex]!,
        this.#gltfPacketLocalModelScratch,
      );
      const rootModel = instanceViews?.rootModels[outerIndex] ?? ordinaryRootModel;
      const rootTransform = instanceViews?.transforms[outerIndex] ?? ordinaryRootTransform;
      if (rootModel === undefined) {
        throw new Error("Royal retained glTF packet root source has no current transform");
      }
      const rootDeterminant = mat4OrientationDeterminant(rootModel);
      const packetSidedness = catalog.sidedness[packetIndex]!;
      let assetLights = ordinaryAssetLights;
      let lightScopeId = ordinaryLightScopeId;
      if (instanceAssetLights !== undefined) {
        const cachedLights = instanceAssetLights.get(outerIndex);
        if (cachedLights !== undefined) {
          assetLights = cachedLights.lights;
          lightScopeId = cachedLights.scopeId;
        } else {
          assetLights = this.#gltfAssetLightSet(state, rootModel);
          lightScopeId = assetLights === undefined
            ? 0
            : this.#gltfLightScopeId(state.instanceKey, renderInstanceOrdinal, outerIndex);
          instanceAssetLights.set(outerIndex, { lights: assetLights, scopeId: lightScopeId });
        }
      }
      const materialBindingId = retainGltfPacketSubmissionMaterialBinding(
        this.#gltfPacketSubmissionWorkspace,
        this.#framePlan!.revision,
        catalog,
        catalog.materialIds[packetIndex]!,
        prepared.materialBatchClassId,
        { material: prepared.material },
      );
      const rootBindingId = retainGltfPacketSubmissionRootBinding(
        this.#gltfPacketSubmissionWorkspace,
        this.#framePlan!.revision,
        catalog,
        catalog.rootSourceIds[packetIndex]!,
        outerIndex,
        lightScopeId,
        {
          rootModel,
          ...(instanceViews === undefined ? {} : { rootInstanceViews: instanceViews }),
          ...(instanceViews !== undefined
            ? {
                rootPositionSignatureVersion: instanceViews.sourceKey,
                rootRotationSignatureVersion: instanceViews.sourceKey,
                rootScaleSignatureVersion: instanceViews.sourceKey,
              }
            : rootHandle === undefined
              ? {}
              : {
                  rootPositionSignatureVersion: rootHandle.positionVersion,
                  rootRotationSignatureVersion: rootHandle.rotationVersion,
                  rootScaleSignatureVersion: rootHandle.scaleVersion,
                }),
          rootSignatureInstanceIndex: instanceViews === undefined ? -1 : outerIndex,
          rootSignatureRenderInstanceOrdinal: renderInstanceOrdinal,
          rootTransform,
        },
      );
      const lightBindingId = assetLights === undefined
        ? NO_FRAME_PACKET_ID
        : retainGltfPacketSubmissionLightBinding(
            this.#gltfPacketSubmissionWorkspace,
            this.#framePlan!.revision,
            catalog,
            lightScopeId,
            assetLights,
          );
      appendGltfPacketSubmission(
        this.#gltfPacketSubmissionWorkspace,
        this.#framePlan!.revision,
        catalog,
        {
          geometryId,
          geometryIdentityId: geometry.staticIdentityId,
          lightBindingId,
          lightScopeId,
          localModelId: catalog.localModelIds[packetIndex]!,
          materialBindingId,
          packetIndex,
          renderClass: catalog.renderClasses[packetIndex]! as FramePacketRenderClass,
          rootBindingId,
          sidedness: (packetSidedness & FRAME_PACKET_SIDEDNESS.doubleSided)
            | (rootDeterminant * localDeterminant >= 0 ? FRAME_PACKET_SIDEDNESS.frontFaceCcw : 0),
        },
      );
      cursor += 1;
    }

    return cursor;
  }

  #gltfMaterialBatchClassId(key: string): number {
    const existing = this.#gltfMaterialBatchClassIds.get(key);
    if (existing !== undefined) return existing;
    this.#gltfMaterialBatchClassIdCount += 1;
    if (!Number.isSafeInteger(this.#gltfMaterialBatchClassIdCount)) {
      throw new Error("Royal glTF material batch-class ID space is exhausted");
    }
    this.#gltfMaterialBatchClassIds.set(key, this.#gltfMaterialBatchClassIdCount);
    return this.#gltfMaterialBatchClassIdCount;
  }

  #gltfLightScopeId(stateKey: number, renderInstanceOrdinal: number, outerIndex: number): number {
    const key = `${stateKey}:${renderInstanceOrdinal}:${outerIndex}`;
    const existing = this.#gltfLightScopeIds.get(key);
    if (existing !== undefined) return existing;
    this.#gltfLightScopeIdCount += 1;
    if (!Number.isSafeInteger(this.#gltfLightScopeIdCount)) {
      throw new Error("Royal glTF light-scope ID space is exhausted");
    }
    this.#gltfLightScopeIds.set(key, this.#gltfLightScopeIdCount);
    return this.#gltfLightScopeIdCount;
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
    if (this.#gltfPacketSubmissionWorkspace.count === 0) return;
    const plan = this.#framePlan!;
    const catalog = this.#gltfPacketTopology.catalog;
    groupGltfPacketSubmissionSegment(
      this.#gltfPacketBatchRegistry,
      this.#gltfPacketBatchSegmentGroups,
      this.#gltfPacketSubmissionWorkspace,
      plan.revision,
      catalog,
    );
    assertGltfPacketBatchSegmentGroupsCurrent(
      this.#gltfPacketBatchRegistry,
      this.#gltfPacketBatchSegmentGroups,
      this.#gltfPacketSubmissionWorkspace,
      plan.revision,
      catalog,
    );
    this.#prepareGltfPacketBatches(sceneLights);
    const groups = this.#gltfPacketBatchSegmentGroups;
    for (let index = 0; index < groups.activeBatchCount; index += 1) {
      const batch = this.#gltfBatches[groups.activeBatchIds[index]!]!;
      this.#gltfInstancingCounters.batchInstancesTotal += batch.localModels.length;
    }

    for (let index = 0; index < groups.opaqueBatchCount; index += 1) {
      this.#drawGltfPrimitiveDrawBatch(
        this.#gltfBatches[groups.opaqueBatchIds[index]!]!,
        projection,
        view,
        toneMapping,
        viewportSize,
        undefined,
      );
    }

    if (groups.transmissiveBatchCount > 0) {
      const screenColorTexture = copyTransmissionScreenColorTexture(
        this.#surfaceRenderTargets,
        this.#gl,
        viewportSize[0],
        viewportSize[1],
        sourceX,
        sourceY,
        toneMapping.hdrOutput,
      );
      for (let index = 0; index < groups.transmissiveBatchCount; index += 1) {
        this.#drawGltfPrimitiveDrawBatch(
          this.#gltfBatches[groups.transmissiveBatchIds[index]!]!,
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
        this.#gltfBatches[groups.blendedBatchIds[index]!]!,
        projection,
        view,
        toneMapping,
        viewportSize,
        undefined,
      );
    }
  }

  #prepareGltfPacketBatches(sceneLights: SurfaceLightSet | undefined): void {
    const workspace = this.#gltfPacketSubmissionWorkspace;
    const groups = this.#gltfPacketBatchSegmentGroups;
    for (let activeIndex = 0; activeIndex < groups.activeBatchCount; activeIndex += 1) {
      const batchId = groups.activeBatchIds[activeIndex]!;
      const memberFirst = groups.batchMemberFirsts[batchId]!;
      const memberCount = groups.batchCounts[batchId]!;
      const firstIndex = groups.memberIndices[memberFirst]!;
      let batch = this.#gltfBatches[batchId];
      if (batch === undefined) {
        const geometryId = workspace.geometryIds[firstIndex]!;
        const geometry = this.#geometryResource(geometryId);
        const material = workspace.materialBindings[workspace.materialBindingIds[firstIndex]!]!;
        const assetLights = workspace.lightBindingIds[firstIndex] === NO_FRAME_PACKET_ID
          ? undefined
          : workspace.lightBindings[workspace.lightBindingIds[firstIndex]!]!;
        batch = {
          cpuGeometry: geometry.source,
          geometry,
          geometryId,
          key: batchId,
          lights: combineSurfaceLightSets(sceneLights, assetLights),
          localModelSignature: [],
          localModels: [],
          localModelSlots: [],
          material: material.material,
          rootPositionSignature: [],
          rootRotationSignature: [],
          rootScaleSignature: [],
          rootModels: [],
          rootInstanceViews: [],
          rootLogicalIndices: [],
          rootTransforms: [],
          sidedness: {
            doubleSided: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.doubleSided) !== 0,
            frontFaceCcw: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.frontFaceCcw) !== 0,
          },
        };
        if (this.#gltfLiveBatchIds.length <= this.#gltfLiveBatchCount) {
          const ids = new Uint32Array(this.#gltfLiveBatchIds.length * 2);
          ids.set(this.#gltfLiveBatchIds);
          this.#gltfLiveBatchIds = ids;
        }
        this.#gltfBatches[batchId] = batch;
        this.#gltfLiveBatchIds[this.#gltfLiveBatchCount] = batchId;
        this.#gltfLiveBatchCount += 1;
        this.#gltfInstancingCounters.batchPlansBuilt += 1;
      }
      batch.localModelSignature.length = 0;
      batch.localModels.length = 0;
      batch.rootPositionSignature.length = 0;
      batch.rootRotationSignature.length = 0;
      batch.rootScaleSignature.length = 0;
      batch.rootModels.length = 0;
      batch.rootInstanceViews.length = 0;
      batch.rootLogicalIndices.length = 0;
      batch.rootTransforms.length = 0;
      const geometryId = workspace.geometryIds[firstIndex]!;
      const geometry = this.#geometryResource(geometryId);
      const material = workspace.materialBindings[workspace.materialBindingIds[firstIndex]!]!;
      const assetLights = workspace.lightBindingIds[firstIndex] === NO_FRAME_PACKET_ID
        ? undefined
        : workspace.lightBindings[workspace.lightBindingIds[firstIndex]!]!;
      batch.cpuGeometry = geometry.source;
      batch.geometry = geometry;
      batch.geometryId = geometryId;
      batch.lights = combineSurfaceLightSets(sceneLights, assetLights);
      batch.material = material.material;
      batch.sidedness = {
        doubleSided: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.doubleSided) !== 0,
        frontFaceCcw: (workspace.sidedness[firstIndex]! & FRAME_PACKET_SIDEDNESS.frontFaceCcw) !== 0,
      };
      for (let memberOffset = 0; memberOffset < memberCount; memberOffset += 1) {
        this.#appendGltfWorkspaceSubmissionToBatch(
          batch,
          groups.memberIndices[memberFirst + memberOffset]!,
        );
      }
    }
  }

  #appendGltfWorkspaceSubmissionToBatch(batch: GltfPrimitiveDrawBatch, index: number): void {
    const workspace = this.#gltfPacketSubmissionWorkspace;
    const root = workspace.rootBindings[workspace.rootBindingIds[index]!]!;
    const localModelIndex = batch.localModels.length;
    let localModel = batch.localModelSlots[localModelIndex];
    if (localModel === undefined) {
      localModel = identityMat4();
      batch.localModelSlots.push(localModel);
    }
    readPacketLocalModelInto(
      this.#gltfPacketTopology.resources,
      workspace.localModelIds[index]!,
      localModel,
    );
    for (let component = 0; component < 16; component += 1) {
      batch.localModelSignature.push(localModel[component]!);
    }
    appendGltfRootSignatures(
      batch.rootPositionSignature,
      batch.rootRotationSignature,
      batch.rootScaleSignature,
      root,
    );
    batch.localModels.push(localModel);
    batch.rootModels.push(root.rootModel);
    batch.rootInstanceViews.push(root.rootInstanceViews);
    batch.rootLogicalIndices.push(root.rootSignatureInstanceIndex);
    batch.rootTransforms.push(root.rootTransform);
  }

  #drawGltfPrimitiveDrawBatch(
    batch: GltfPrimitiveDrawBatch,
    projection: Mat4,
    view: Mat4,
    toneMapping: SceneToneMappingState,
    viewportSize: ViewportSize,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    this.#applyDrawSidedness(batch.sidedness);
    this.#applyDrawAlphaState(batch.material);
    try {
      if (batch.localModels.length === 1) {
        this.#drawGeometry(
          batch.geometry,
          batch.geometryId,
          batch.material,
          multiplyMat4(batch.rootModels[0]!, batch.localModels[0]!),
          projection,
          view,
          viewportSize,
          batch.lights,
          toneMapping,
          transmissionScreenColorTexture,
          batch.cpuGeometry,
        );
      } else {
        this.#drawGeometryInstanced(
          batch.geometry,
          batch.geometryId,
          batch.cpuGeometry,
          batch.key,
          batch.material,
          batch.localModels,
          batch.localModelSignature,
          batch.rootModels,
          batch.rootInstanceViews,
          batch.rootLogicalIndices,
          batch.rootTransforms,
          batch.rootPositionSignature,
          batch.rootRotationSignature,
          batch.rootScaleSignature,
          projection,
          view,
          viewportSize,
          batch.lights,
          toneMapping,
          transmissionScreenColorTexture,
        );
      }
    } finally {
      this.#resetDrawAlphaState();
      this.#resetDrawSidedness();
    }
  }

  #applyDrawAlphaState(material: Material): void {
    const gl = this.#gl;
    if (material.kind !== "wireframe" && isBlendedSurfaceMaterial(material)) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);

      return;
    }

    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  #resetDrawAlphaState(): void {
    const gl = this.#gl;
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  #applyDrawSidedness(sidedness: DrawSidedness): void {
    const gl = this.#gl;
    if (sidedness.doubleSided) {
      gl.disable(gl.CULL_FACE);

      return;
    }

    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(sidedness.frontFaceCcw ? gl.CCW : gl.CW);
  }

  #resetDrawSidedness(): void {
    const gl = this.#gl;
    gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
  }

  #sceneSurfaceLightSet(
    environment: EnvironmentLight | undefined,
  ): SurfaceLightSet | undefined {
    if (environment === undefined) return this.#framePlanSurfaceLightSet;
    const environmentLights = this.#environmentLightSet(environment);

    return surfaceLightSet(
      this.#framePlanSurfaceLights,
      environmentLights?.irradiance,
      environmentLights?.specular,
    );
  }

  #environmentLightSet(environment: EnvironmentLight): Pick<SurfaceLightSet, "irradiance" | "specular"> {
    switch (environment.preset) {
      case "studio":
        return this.#studioEnvironmentLightSet(environment);
    }
  }

  #studioEnvironmentLightSet(environment: EnvironmentLight): Pick<SurfaceLightSet, "irradiance" | "specular"> {
    const worldFromIbl = transformMat4({
      position: [0, 0, 0],
      rotation: environment.rotation,
      scale: [1, 1, 1],
    });
    const worldToIbl = inverseMat4(worldFromIbl) ?? identityMat4();
    const specular = this.#studioEnvironmentSpecularTexture();

    return {
      irradiance: {
        coefficients: STUDIO_ENVIRONMENT_IRRADIANCE,
        intensity: environment.radianceScaleNits,
        worldToIbl,
      },
      ...(specular === undefined ? {} : { specular: {
        encoding: "linear",
        intensity: environment.radianceScaleNits,
        key: specular.key,
        mipCount: specular.mipCount,
        texture: specular.texture,
        worldToIbl,
      } }),
    };
  }

  #gltfAssetLightSet(state: GltfState, rootModel: Mat4): SurfaceLightSet | undefined {
    const imageBasedLight = state.imageBasedLight;
    const irradiance = imageBasedLight === undefined
      ? undefined
      : transformSurfaceIblIrradiance(rootModel, imageBasedLight);
    const specular = imageBasedLight?.specular === undefined || irradiance === undefined
      ? undefined
      : this.#gltfIblSpecularLight(imageBasedLight.specular, irradiance);
    if (state.lights.length === 0 && irradiance === undefined && specular === undefined) return undefined;

    return surfaceLightSet(
      state.lights.map((light) => transformSurfaceLight(rootModel, light)),
      irradiance,
      specular,
    );
  }

  #gltfIblSpecularLight(
    specular: SurfaceImageBasedLightSpecular,
    irradiance: ReturnType<typeof transformSurfaceIblIrradiance>,
  ): SurfaceIblSpecular | undefined {
    const resource = this.#ensureIblSpecularTexture(specular);
    if (!resource.uploaded) return undefined;

    return {
      encoding: specular.encoding,
      intensity: irradiance.intensity,
      key: specular.key,
      mipCount: resource.mipCount,
      texture: resource.texture,
      worldToIbl: irradiance.worldToIbl,
    };
  }

  #prepareSharedViewGltfLodSelections(plan: FramePlan, frameViews: FrameViews): void {
    this.#sharedViewLods.beginFrame();

    for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
      copyFrameViewMatrixInto(this.#renderViewProjection, frameViews.viewProjections, viewIndex);
      this.#visitGltfLodRoots(plan, this.#renderViewProjection, 1);
    }
    this.#sharedViewLods.finalizeNodes();

    for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
      copyFrameViewMatrixInto(this.#renderViewProjection, frameViews.viewProjections, viewIndex);
      this.#visitGltfLodRoots(plan, this.#renderViewProjection, 2);
    }
    this.#sharedViewLods.finalizeMaterials();
  }

  #selectGltfFramePackets(plan: FramePlan, frameViews: FrameViews): void {
    const topology = this.#gltfPacketTopology;
    const selected = this.#selectedGltfFramePackets;
    const packetSelections = this.#sharedViewLods.packetSelections;
    beginSelectedFramePacketViews(selected, topology.catalog, frameViews.count);
    for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
      beginSelectedFramePacketView(selected, topology.catalog, viewIndex);
      copyFrameViewMatrixInto(this.#renderViewProjection, frameViews.viewProjections, viewIndex);
      for (let occurrenceIndex = 0; occurrenceIndex < topology.occurrenceCount; occurrenceIndex += 1) {
        const requestRow = plan.gltfRequestRows[occurrenceIndex]!;
        const node = plan.nodes[requestRow.nodeIndex] as AnyGltfNode;
        const instanceViews = node.kind === "gltf-instances"
          ? this.#gltfInstanceTransforms.views(node.instances)
          : undefined;
        const rootHandle = node.kind === "gltf" ? this.#sceneBindings.handle(node) : undefined;
        const ordinaryRootModel = node.kind === "gltf"
          ? transformMat4Into(
              this.#sharedViewLodRootModel,
              rootHandle === undefined ? node.transform : readRenderObjectHandleTransform(rootHandle),
            )
          : undefined;
        const first = topology.occurrenceFirsts[occurrenceIndex]!;
        const end = first + topology.occurrenceCounts[occurrenceIndex]!;
        for (let packetIndex = first; packetIndex < end; packetIndex += 1) {
          if (!framePacketLodRequirementsMatch(
            topology.catalog,
            topology.requirements,
            packetIndex,
            packetSelections.selectedLevels,
            packetSelections.selectionEpochs,
            packetSelections.epoch,
          )) continue;
          const outerIndex = topology.catalog.instanceFirsts[packetIndex]!;
          const rootModel = instanceViews?.rootModels[outerIndex] ?? ordinaryRootModel;
          if (rootModel === undefined) continue;
          multiplyMat4Into(this.#sharedViewLodRootViewProjection, this.#renderViewProjection, rootModel);
          const hasBounds = readPacketBoundsInto(
            topology.resources,
            topology.catalog.boundsIds[packetIndex]!,
            this.#gltfPacketBoundsScratch,
          );
          if (!isBoundsVisible(
            hasBounds ? this.#gltfPacketBoundsScratch : undefined,
            this.#sharedViewLodRootViewProjection,
          )) continue;
          appendSelectedFramePacket(selected, topology.catalog, packetIndex);
        }
      }
      endSelectedFramePacketView(selected, topology.catalog, viewIndex);
    }
  }

  #visitGltfLodRoots(
    plan: FramePlan,
    viewProjection: Mat4,
    phase: 1 | 2,
  ): void {
    let renderInstanceOrdinal = 0;
    for (const planNode of plan.nodes) {
      if (planNode.kind !== "gltf" && planNode.kind !== "gltf-instances") continue;
      const node = planNode;
      const ordinal = renderInstanceOrdinal;
      renderInstanceOrdinal += 1;
      const state = this.#gltfState(node);
      if (state.status !== "ready" || (!state.hasNodeLod && !state.hasMaterialLod)) continue;
      if (node.kind === "gltf-instances") {
        const views = this.#gltfInstanceTransforms.views(node.instances);
        for (let outerIndex = 0; outerIndex < node.instances.count; outerIndex += 1) {
          const rootModel = views.rootModels[outerIndex]!;
          multiplyMat4Into(this.#sharedViewLodRootViewProjection, viewProjection, rootModel);
          this.#observeSharedViewGltfLodRoot(
            state, node, `instance:${ordinal}:${outerIndex}`, this.#sharedViewLodRootViewProjection, phase,
          );
        }
        continue;
      }
      const rootHandle = this.#sceneBindings.handle(node);
      const rootTransform = rootHandle === undefined ? node.transform : readRenderObjectHandleTransform(rootHandle);
      transformMat4Into(this.#sharedViewLodRootModel, rootTransform);
      multiplyMat4Into(this.#sharedViewLodRootViewProjection, viewProjection, this.#sharedViewLodRootModel);
      this.#observeSharedViewGltfLodRoot(
        state, node, `instance:${ordinal}`, this.#sharedViewLodRootViewProjection, phase,
      );
    }
  }

  #observeSharedViewGltfLodRoot(
    state: GltfState,
    node: AnyGltfNode,
    renderInstanceKey: string,
    rootViewProjectionModel: Mat4,
    phase: 1 | 2,
  ): void {
    const selectedVariantIndex = phase === 2 && state.hasMaterialVariants
      ? this.#selectedGltfVariantIndex(state, node)
      : undefined;
    for (const primitive of state.primitives) {
      const nodeLod = primitive.nodeLod;
      if (phase === 1) {
        if (nodeLod === undefined) continue;
        const selectionKey = `${state.key}:${renderInstanceKey}:node:${nodeLod.group}`;
        const id = this.#sharedViewLods.nodeSelectionId(
          state.key,
          selectionKey,
          nodeLod,
          state.primitives,
        );
        this.#sharedViewLods.touchNode(id);
        if (nodeLod.level !== 0) {
          for (const bounds of primitive.localBounds) {
            if (!isBoundsVisible(bounds, rootViewProjectionModel)) continue;
            this.#sharedViewLods.observeNodeFallback(id, nodeLod.level);
          }
          continue;
        }
        for (const bounds of primitive.localBounds) {
          if (!isBoundsVisible(bounds, rootViewProjectionModel)) continue;
          this.#sharedViewLods.observeCoverage(
            id,
            projectedBoundsScreenCoverage(bounds, rootViewProjectionModel, this.#projectedBoundsWorkspace),
          );
        }
        continue;
      }
      if (nodeLod !== undefined) {
        const nodeSelectionKey = `${state.key}:${renderInstanceKey}:node:${nodeLod.group}`;
        if (this.#sharedViewLods.selectedLevel(state.key, nodeSelectionKey) !== nodeLod.level) continue;
      }
      const primitiveMaterial = selectedVariantIndex === undefined
        ? primitive.baseMaterial
        : this.#gltfPrimitiveMaterialForVariant(selectedVariantIndex, primitive);
      const materialLod = primitiveMaterial.materialLod;
      if (materialLod === undefined) continue;
      for (let instanceIndex = 0; instanceIndex < primitive.localBounds.length; instanceIndex += 1) {
        const bounds = primitive.localBounds[instanceIndex];
        if (!isBoundsVisible(bounds, rootViewProjectionModel)) continue;
        const selectionKey = this.#gltfMaterialLodSelectionKey(
          state, renderInstanceKey, primitive, primitiveMaterial, instanceIndex,
        );
        const id = this.#sharedViewLods.materialSelectionId(state.key, selectionKey, materialLod);
        this.#sharedViewLods.touchMaterial(id);
        this.#sharedViewLods.observeCoverage(
          id,
          projectedBoundsScreenCoverage(bounds, rootViewProjectionModel, this.#projectedBoundsWorkspace),
        );
      }
    }
  }

  #gltfMaterialLodSelectionKey(
    state: GltfState,
    renderInstanceKey: string,
    primitive: LoadedGltfPrimitive,
    primitiveMaterial: LoadedGltfPrimitiveMaterial,
    instanceIndex: number,
  ): string {
    return `${state.key}:${renderInstanceKey}:material:${primitive.key}:${primitiveMaterial.selectionKey}:instance:${instanceIndex}`;
  }

  #preparedGltfPrimitiveMaterial(
    state: GltfState,
    primitive: LoadedGltfPrimitive,
    loadedMaterial: LoadedGltfMaterial,
  ): GltfPreparedPrimitiveMaterial {
    let materialPrimitives = this.#gltfMaterialPrimitives.get(loadedMaterial);
    if (materialPrimitives === undefined) {
      materialPrimitives = new Set();
      this.#gltfMaterialPrimitives.set(loadedMaterial, materialPrimitives);
    }
    materialPrimitives.add(primitive);

    let primitiveCache = this.#gltfPreparedPrimitiveMaterials.get(primitive);
    if (primitiveCache === undefined) {
      primitiveCache = new WeakMap();
      this.#gltfPreparedPrimitiveMaterials.set(primitive, primitiveCache);
    }

    const cached = primitiveCache.get(loadedMaterial);
    if (cached !== undefined) return cached;

    const contentKeys = resourceArenaContentKeys(this.#resourceArena, state.key);
    const baseColor = this.#gltfMaterialTextureRef(loadedMaterial, contentKeys);
    const surfaceTextures = this.#gltfMaterialSurfaceTextures(loadedMaterial, contentKeys);
    const material = loadedGltfSurfaceMaterial(
      loadedMaterial,
      loadedMaterial.baseColorTexture?.imageUri !== undefined
        && this.#gltfImages.imageReady(state.key, loadedMaterial.baseColorTexture.imageUri)
        && baseColor !== undefined
        ? baseColor
        : {
            color: loadedMaterial.baseColorTexture?.textureUri === undefined ? TEXTURE_COLOR : DEFAULT_COLOR,
            kind: "solid",
          },
      surfaceTextures,
    );
    const materialBatchKey = surfaceMaterialBatchKey(material);
    const prepared: GltfPreparedPrimitiveMaterial = {
      material,
      materialBatchClassId: this.#gltfMaterialBatchClassId(materialBatchKey),
    };
    primitiveCache.set(loadedMaterial, prepared);
    return prepared;
  }

  #gltfPrimitiveMaterialForVariant(
    variantIndex: number,
    primitive: LoadedGltfPrimitive,
  ): LoadedGltfPrimitiveMaterial {
    const variant = primitive.materialVariants?.find((mapping) => mapping.variants.includes(variantIndex));
    if (variant !== undefined) {
      return {
        material: variant.material,
        ...(variant.materialLod === undefined ? {} : { materialLod: variant.materialLod }),
        selectionKey: `variant:${variantIndex}`,
      };
    }

    return primitive.baseMaterial;
  }

  #selectedGltfVariantIndex(state: GltfState, node: AnyGltfNode): number | undefined {
    const variant = node.variant;
    if (variant === undefined) return undefined;
    if (typeof variant === "number") {
      return Number.isInteger(variant) && variant >= 0 && variant < state.variants.length
        ? variant
        : undefined;
    }

    const index = state.variants.indexOf(variant);
    return index === -1 ? undefined : index;
  }

  #gltfMaterialTextureRef(
    material: LoadedGltfMaterial,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
  ): TextureAssetUploadRef | undefined {
    const slot = material.baseColorTexture;
    const texture = this.#gltfTextureSlotRef(slot, "srgb", contentKeys);
    if (texture === undefined) return undefined;
    return texture;
  }

  #gltfMaterialMetallicRoughnessTextureRef(material: LoadedGltfMaterial, contentKeys: ReadonlyMap<string, TextureContentKey>): TextureAssetUploadRef | undefined {
    return this.#gltfTextureSlotRef(material.metallicRoughnessTexture, "linear", contentKeys);
  }

  #gltfMaterialNormalTextureRef(material: LoadedGltfMaterial, contentKeys: ReadonlyMap<string, TextureContentKey>): TextureAssetUploadRef | undefined {
    return this.#gltfTextureSlotRef(material.normalTexture, "linear", contentKeys);
  }

  #gltfMaterialEmissiveTextureRef(material: LoadedGltfMaterial, contentKeys: ReadonlyMap<string, TextureContentKey>): TextureAssetUploadRef | undefined {
    return this.#gltfTextureSlotRef(material.emissiveTexture, "srgb", contentKeys);
  }

  #gltfMaterialOcclusionTextureRef(material: LoadedGltfMaterial, contentKeys: ReadonlyMap<string, TextureContentKey>): TextureAssetUploadRef | undefined {
    return this.#gltfTextureSlotRef(material.occlusionTexture, "linear", contentKeys);
  }

  #gltfTextureSlotRef(
    slot: LoadedGltfMaterialTextureSlot | undefined,
    colorSpace: TextureColorSpace,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
  ): TextureAssetUploadRef | undefined {
    if (slot?.textureUri === undefined) return undefined;
    return {
      colorSpace,
      ...this.#gltfTextureContentKeyProps(slot.textureUri, slot.contentKey, contentKeys),
      flipY: false,
      kind: "asset",
      preparedOnly: true,
      ...(slot.sampler === undefined ? {} : { sampler: slot.sampler }),
      uri: slot.textureUri,
    };
  }

  #gltfTextureContentKeyProps(
    textureUri: string,
    authored: TextureContentKey | undefined,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
  ): { readonly contentKey?: TextureContentKey } {
    const contentKey = authored ?? contentKeys.get(textureUri);
    return contentKey === undefined ? {} : { contentKey };
  }

  #gltfMaterialSurfaceTextures(
    material: LoadedGltfMaterial,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
  ): LoadedGltfSurfaceTextures {
    const extensionTextures = material.extensionTextures;
    const textures: { -readonly [Key in keyof Omit<LoadedGltfSurfaceTextures, "textureCoordinates">]?: TextureAssetUploadRef } = {};
    const textureCoordinates: { -readonly [Key in keyof SurfaceMaterialTextureCoordinates]?: GltfTextureCoordinates } = {};
    const setTexture = (
      key: keyof Omit<LoadedGltfSurfaceTextures, "textureCoordinates">,
      texture: TextureAssetUploadRef | undefined,
    ): void => {
      if (texture !== undefined) textures[key] = texture;
    };

    setTexture("emissiveTexture", this.#gltfMaterialEmissiveTextureRef(material, contentKeys));
    setTexture("metallicRoughnessTexture", this.#gltfMaterialMetallicRoughnessTextureRef(material, contentKeys));
    setTexture("normalTexture", this.#gltfMaterialNormalTextureRef(material, contentKeys));
    setTexture("occlusionTexture", this.#gltfMaterialOcclusionTextureRef(material, contentKeys));
    const setCoordinates = (
      key: keyof SurfaceMaterialTextureCoordinates,
      slot: LoadedGltfMaterialTextureSlot | undefined,
    ): void => {
      if (slot !== undefined) textureCoordinates[key] = slot.coordinates;
    };
    setCoordinates("baseColorTexture", material.baseColorTexture);
    setCoordinates("emissiveTexture", material.emissiveTexture);
    setCoordinates("metallicRoughnessTexture", material.metallicRoughnessTexture);
    setCoordinates("normalTexture", material.normalTexture);
    setCoordinates("occlusionTexture", material.occlusionTexture);
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      const slot = extensionTextures?.[texture.key];
      setTexture(texture.key, this.#gltfTextureSlotRef(slot, texture.colorSpace, contentKeys));
      setCoordinates(texture.key, slot);
    }

    return {
      ...textures,
      ...(Object.keys(textureCoordinates).length === 0 ? {} : { textureCoordinates }),
    };
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
    const baseColorResidency = this.#resolveBaseColorTextureResidency(
      geometry,
      material,
      this.#virtualTextureDrawDemandContext(
        geometryId,
        cpuGeometry,
        material,
        { kind: "single", model },
        projection,
        view,
        viewportSize,
      ),
    );
    const programKind: ProgramKind = material.kind === "wireframe" ? "wireframe" : "surface";
    const surfaceMaterial: SurfaceMaterial | undefined =
      material.kind !== "wireframe" ? material : undefined;
    const surfaceLights = surfaceMaterial?.kind === "standard"
      ? lights ?? EMPTY_SURFACE_LIGHT_SET
      : surfaceMaterial === undefined ? undefined : EMPTY_SURFACE_LIGHT_SET;
    const surfaceTexturePlan = surfaceMaterial === undefined || surfaceLights === undefined
      ? undefined
      : this.#surfaceTextureBindingPlan(
        surfaceMaterial,
        transmissionScreenColorTexture,
        surfaceLights,
        baseColorResidency,
      );
    const clusteredLights = (surfaceLights?.punctuals.length ?? 0) > 0;
    const programResource = this.#program(programKind, surfaceTexturePlan?.features, clusteredLights);
    if (programResource === undefined) return;
    const program = programResource.program;
    useProgram(this.#programArena, program);

    uniformMatrix(this.#programArena, program, "u_projection", projection);
    uniformMatrix(this.#programArena, program, "u_view", view);
    uniformMatrix(this.#programArena, program, "u_model", model);
    uniformColor(
      this.#programArena,
      program,
      "u_color",
      surfaceTexturePlan?.baseColor.kind === "prepared-virtual"
        ? ("baseColorFactor" in material ? materialColor(material) : TEXTURE_COLOR)
        : materialColor(material),
    );
    uniform1i(this.#programArena, program, "u_unlit", material.kind === "standard" ? 0 : 1);
    if (surfaceTexturePlan !== undefined && surfaceLights !== undefined && surfaceMaterial !== undefined) {
      uniformColor(this.#programArena, program, "u_emissiveColor", materialEmissiveColor(surfaceMaterial));
      this.#bindSurfaceMaterialFactors(program, surfaceMaterial, transmissionScreenColorTexture, surfaceTexturePlan);
      this.#bindSurfaceToneMapping(program, toneMapping);
      this.#bindSurfaceLights(program, surfaceLights, surfaceTexturePlan, projection, view, viewportSize);
    }

    const baseColorBinding = this.#bindSurfaceBaseColorTexture(program, surfaceTexturePlan);
    uniform1i(this.#programArena, program, "u_useTexture", baseColorBinding.kind === "ordinary" ? 1 : 0);
    uniform1i(this.#programArena, program, "u_useVirtualTexture", baseColorBinding.kind === "prepared-virtual" ? 1 : 0);
    drawGeometry(
      this.#geometryDrawArena,
      this.#context.generation,
      geometryId,
      geometry,
      material.kind === "wireframe" ? material.width : undefined,
    );
  }

  #drawGeometryInstanced(
    geometry: GeometryResource,
    geometryId: number,
    cpuGeometry: CpuGeometry,
    instanceBufferKey: number,
    material: SurfaceMaterial,
    localModels: readonly Mat4[],
    localModelSignature: readonly number[],
    rootModels: readonly Mat4[],
    rootInstanceViews: readonly (GltfInstanceTransformView | undefined)[],
    rootLogicalIndices: readonly number[],
    rootTransforms: readonly (Transform | undefined)[],
    rootPositionSignature: readonly number[],
    rootRotationSignature: readonly number[],
    rootScaleSignature: readonly number[],
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
    lights: SurfaceLightSet,
    toneMapping: SceneToneMappingState,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    const surfaceLights = material.kind === "standard" ? lights : EMPTY_SURFACE_LIGHT_SET;
    const baseColorResidency = this.#resolveBaseColorTextureResidency(
      geometry,
      material,
      this.#virtualTextureDrawDemandContext(
        geometryId,
        cpuGeometry,
        material,
        { kind: "composed", localModels, rootModels },
        projection,
        view,
        viewportSize,
      ),
    );
    const surfaceTexturePlan = this.#surfaceTextureBindingPlan(
      material,
      transmissionScreenColorTexture,
      surfaceLights,
      baseColorResidency,
    );
    const programKind: ProgramKind = "surface-instanced-split";
    const clusteredLights = surfaceLights.punctuals.length > 0;
    const programResource = this.#program(programKind, surfaceTexturePlan.features, clusteredLights);
    if (programResource === undefined) return;
    const program = programResource.program;
    useProgram(this.#programArena, program);

    uniformMatrix(this.#programArena, program, "u_projection", projection);
    uniformMatrix(this.#programArena, program, "u_view", view);
    uniformColor(
      this.#programArena,
      program,
      "u_color",
      surfaceTexturePlan.baseColor.kind === "prepared-virtual"
        ? ("baseColorFactor" in material ? materialColor(material) : TEXTURE_COLOR)
        : materialColor(material),
    );
    uniformColor(this.#programArena, program, "u_emissiveColor", materialEmissiveColor(material));
    uniform1i(this.#programArena, program, "u_unlit", material.kind === "standard" ? 0 : 1);
    this.#bindSurfaceMaterialFactors(program, material, transmissionScreenColorTexture, surfaceTexturePlan);
    this.#bindSurfaceToneMapping(program, toneMapping);
    this.#bindSurfaceLights(program, surfaceLights, surfaceTexturePlan, projection, view, viewportSize);

    const baseColorBinding = this.#bindSurfaceBaseColorTexture(program, surfaceTexturePlan);
    uniform1i(this.#programArena, program, "u_useTexture", baseColorBinding.kind === "ordinary" ? 1 : 0);
    uniform1i(this.#programArena, program, "u_useVirtualTexture", baseColorBinding.kind === "prepared-virtual" ? 1 : 0);
    const instanceAllocation = bindGltfInstanceBuffer(
      this.#gltfInstanceBufferArena,
      this.#gl,
      this.#context.generation,
      instanceBufferKey,
      localModels,
      localModelSignature,
      rootTransforms,
      rootInstanceViews,
      rootLogicalIndices,
      rootPositionSignature,
      rootRotationSignature,
      rootScaleSignature,
      this.#gltfInstancingCounters,
    );
    prepareGeometryInstancedDraw(
      this.#geometryDrawArena,
      this.#context.generation,
      geometryId,
      geometry,
      instanceAllocation,
    );
    this.#gltfInstancingCounters.drawCalls += 1;
    this.#gltfInstancingCounters.instancesDrawn += localModels.length;
    submitGeometryInstancedDraw(this.#geometryDrawArena, geometry, localModels.length);
  }

  #bindSurfaceMaterialFactors(
    program: WebGLProgram,
    material: SurfaceMaterial,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    plan: SurfaceTextureBindingPlan,
  ): void {
    const factors = surfaceMaterialExtensionFactors(material);
    const alphaMode = surfaceMaterialAlphaMode(material);
    const hasFiniteAttenuationDistance = Number.isFinite(factors.attenuationDistance);
    uniformColor(this.#programArena, program, "u_alphaSettings", [
      alphaMode === "MASK" ? 1 : alphaMode === "BLEND" ? 2 : 0,
      surfaceMaterialAlphaCutoff(material),
      0,
      0,
    ]);
    uniformColor(this.#programArena, program, "u_materialPbrFactors", [
      surfaceMaterialMetallicFactor(material),
      surfaceMaterialRoughnessFactor(material),
      0,
      0,
    ]);
    uniformColor(this.#programArena, program, "u_specularColorFactor", [
      factors.specularColorFactor[0],
      factors.specularColorFactor[1],
      factors.specularColorFactor[2],
      1,
    ]);
    uniformColor(this.#programArena, program, "u_materialExtensionFactors", [
      factors.specularFactor,
      factors.ior,
      factors.clearcoatFactor,
      factors.clearcoatRoughnessFactor,
    ]);
    uniformColor(this.#programArena, program, "u_anisotropyFactors", [
      factors.anisotropyStrength,
      factors.anisotropyRotation,
      0,
      0,
    ]);
    uniformColor(this.#programArena, program, "u_diffuseTransmissionFactors", [
      factors.diffuseTransmissionColorFactor[0],
      factors.diffuseTransmissionColorFactor[1],
      factors.diffuseTransmissionColorFactor[2],
      factors.diffuseTransmissionFactor,
    ]);
    uniformColor(this.#programArena, program, "u_sheenColorFactor", [
      factors.sheenColorFactor[0],
      factors.sheenColorFactor[1],
      factors.sheenColorFactor[2],
      factors.sheenRoughnessFactor,
    ]);
    uniformColor(this.#programArena, program, "u_iridescenceFactors", [
      factors.iridescenceFactor,
      factors.iridescenceIor,
      factors.iridescenceThicknessMinimum,
      factors.iridescenceThicknessMaximum,
    ]);
    uniformColor(this.#programArena, program, "u_dispersionFactors", [
      factors.dispersionFactor,
      0,
      0,
      0,
    ]);
    uniformColor(this.#programArena, program, "u_attenuationColorFactor", [
      factors.attenuationColor[0],
      factors.attenuationColor[1],
      factors.attenuationColor[2],
      1,
    ]);
    uniformColor(this.#programArena, program, "u_transmissionVolumeFactors", [
      factors.transmissionFactor,
      factors.thicknessFactor,
      hasFiniteAttenuationDistance ? factors.attenuationDistance : 0,
      hasFiniteAttenuationDistance ? 1 : 0,
    ]);
    this.#bindTransmissionScreenColorTexture(program, transmissionScreenColorTexture, plan);
    this.#bindSurfaceTextureCoordinates(program, material, plan);
    uniformColor(this.#programArena, program, "u_normalTextureSettings", [
      material.kind === "standard" ? material.normalScale ?? 1 : 1,
      0,
      0,
      0,
    ]);
    uniformColor(this.#programArena, program, "u_occlusionSettings", [
      surfaceMaterialOcclusionStrength(material),
      0,
      0,
      0,
    ]);
    this.#bindSurfaceMaterialTextures(program, plan);
  }

  #bindSurfaceTextureCoordinates(
    program: WebGLProgram,
    material: SurfaceMaterial,
    plan: SurfaceTextureBindingPlan,
  ): void {
    const bind = (
      feature: SurfaceShaderTextureFeature,
      key: keyof SurfaceMaterialTextureCoordinates,
      uniformStem: string,
      virtualBaseColor = false,
    ): void => {
      const preparedCoordinates = material.textureCoordinates?.[key];
      const active = preparedCoordinates !== undefined
        || plan.features.has(feature)
        || (virtualBaseColor && (
          plan.features.has("baseColorVirtualTextureAtlas")
          || plan.features.has("baseColorVirtualTexturePageTable")
        ));
      if (!active) return;
      const coordinates = preparedCoordinates ?? IDENTITY_GLTF_TEXTURE_COORDINATES;
      uniform1i(this.#programArena, program, `${uniformStem}Set`, coordinates.set);
      uniformColor(this.#programArena, program, `${uniformStem}Row0`, coordinates.row0);
      uniformColor(this.#programArena, program, `${uniformStem}Row1`, coordinates.row1);
    };
    bind("baseColorTexture", "baseColorTexture", "u_baseColorUv", true);
    for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) {
      bind(descriptor.feature, descriptor.key, descriptor.uvUniformStem);
    }
  }

  #surfaceTextureBindingPlan(
    material: SurfaceMaterial,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    lightSet: SurfaceLightSet,
    baseColorResidency: BaseColorTextureResidency,
  ): SurfaceTextureBindingPlan {
    type ReadyOrdinaryTexture = Extract<OrdinaryTextureGpuResource, { readonly uploaded: true }>;
    const declaredCandidates: Partial<Record<SurfaceIndependentTextureFeature, SurfaceTextureCandidate>> = {};
    const declaredTextures = new Map<SurfaceShaderTextureFeature, TextureAssetUploadRef>();
    for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) {
      const texture = descriptor.key === "emissiveTexture"
        ? material.emissiveTexture
        : material.kind === "standard" ? material[descriptor.key] : undefined;
      if (texture === undefined) continue;
      declaredCandidates[descriptor.feature] = "ready";
      declaredTextures.set(descriptor.feature, texture);
    }
    if (transmissionScreenColorTexture !== undefined) declaredCandidates.transmissionScreenTexture = "ready";
    if (lightSet.specular !== undefined) {
      declaredCandidates.iblSpecularCube = "ready";
      declaredCandidates.iblBrdfLut = "ready";
    }

    const declaredBaseColor = (() => {
      switch (baseColorResidency.kind) {
        case "none": return { kind: "none" } as const;
        case "ordinary": return { kind: "ordinary", ordinary: "ready" } as const;
        case "prepared-virtual": return {
          ...(baseColorResidency.ordinaryFallback === undefined ? {} : { fallback: "ready" as const }),
          kind: "virtual" as const,
          virtual: "ready" as const,
        };
      }
    })();
    const clusterUnits = clusteredLightTextureUnits(this.#clusteredLights);
    const reserveClusterUnits = lightSet.punctuals.length > 0;
    const reservedTextureUnits = reserveClusterUnits
      ? new Set([clusterUnits.grid, clusterUnits.indices, clusterUnits.lights].filter((unit) => unit >= 0))
      : new Set<number>();
    const admission = planSurfaceTextureBindings({
      baseColor: declaredBaseColor,
      brdfLutPreferredUnit: reserveClusterUnits && clusterUnits.grid > 0
        ? clusterUnits.grid - 1
        : IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT,
      candidates: declaredCandidates,
      maxTextureUnits: this.#maxTextureImageUnits,
      reservedTextureUnits,
    });

    const candidates: Partial<Record<SurfaceIndependentTextureFeature, SurfaceTextureCandidate>> = {};
    const readyTextures = new Map<SurfaceShaderTextureFeature, ReadyOrdinaryTexture>();
    for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) {
      if (!admission.features.has(descriptor.feature)) continue;
      const texture = declaredTextures.get(descriptor.feature);
      if (texture === undefined) continue;
      const resource = this.#requestOrdinaryTexture(texture);
      const ready = resource.uploaded ? resource : undefined;
      candidates[descriptor.feature] = ready === undefined ? "unavailable" : "ready";
      if (ready !== undefined) readyTextures.set(descriptor.feature, ready);
    }

    let ordinaryBaseColor: ReadyOrdinaryTexture | undefined;
    let virtualFallbackTexture: TextureAssetUploadRef | undefined;
    let virtualFallbackReady: ReadyOrdinaryTexture | undefined;
    const baseColor = (() => {
      switch (baseColorResidency.kind) {
        case "none": return { kind: "none" } as const;
        case "ordinary": {
          if (admission.baseColor.kind === "ordinary") {
            const resource = this.#requestOrdinaryTexture(baseColorResidency.texture);
            ordinaryBaseColor = resource.uploaded ? resource : undefined;
          }
          return {
            kind: "ordinary" as const,
            ordinary: ordinaryBaseColor === undefined ? "unavailable" as const : "ready" as const,
          };
        }
        case "prepared-virtual": {
          const drawable = this.#isVirtualTextureDrawable(baseColorResidency.state);
          if (!drawable) {
            if (baseColorResidency.state.status === "unsupported") baseColorResidency.state.stats.unsupportedDraws += 1;
            else baseColorResidency.state.stats.unreadyDraws += 1;
          }
          virtualFallbackTexture = baseColorResidency.ordinaryFallback;
          let fallbackResource = virtualFallbackTexture === undefined
            ? undefined
            : this.#ordinaryTextures.peekGpuResource(textureCacheKey(virtualFallbackTexture));
          if (
            virtualFallbackTexture !== undefined
            && admission.baseColor.kind !== "none"
            && (admission.baseColor.kind === "ordinary" || !drawable)
          ) fallbackResource = this.#requestOrdinaryTexture(virtualFallbackTexture);
          virtualFallbackReady = fallbackResource?.uploaded === true ? fallbackResource : undefined;
          return {
            ...(virtualFallbackTexture === undefined || admission.baseColor.kind === "none"
              ? {}
              : { fallback: virtualFallbackReady === undefined ? "unavailable" as const : "ready" as const }),
            kind: "virtual" as const,
            virtual: admission.baseColor.kind === "virtual" && drawable
              ? "ready" as const
              : "unavailable" as const,
          };
        }
      }
    })();

    if (transmissionScreenColorTexture !== undefined) {
      candidates.transmissionScreenTexture = transmissionScreenColorTexture.uploaded ? "ready" : "unavailable";
    }
    if (lightSet.specular !== undefined) {
      candidates.iblSpecularCube = "ready";
      if (admission.features.has("iblBrdfLut")) {
        let ready = false;
        try {
          ready = prepareSurfaceIblBrdfLut(this.#iblTextures);
        } finally {
          this.#consumeIblTextureSignals();
        }
        candidates.iblBrdfLut = ready ? "ready" : "unavailable";
      }
    }
    const pure = resolveAdmittedSurfaceTextureBindings(admission, { baseColor, candidates });
    this.#recordSurfaceTextureBindingOmissions(pure);
    const selectedBaseColor: SurfaceBaseColorTextureBinding = pure.baseColor.kind === "ordinary"
      ? ordinaryBaseColor === undefined && virtualFallbackReady !== undefined
        ? { kind: "ordinary", resource: virtualFallbackReady }
        : ordinaryBaseColor === undefined
          ? { kind: "none" }
          : { kind: "ordinary", resource: ordinaryBaseColor }
      : pure.baseColor.kind === "virtual" && baseColorResidency.kind === "prepared-virtual"
        ? {
            kind: "prepared-virtual",
            ...(virtualFallbackTexture === undefined ? {} : { ordinaryFallback: virtualFallbackTexture }),
            state: baseColorResidency.state,
          }
        : { kind: "none" };
    return { ...pure, baseColor: selectedBaseColor, readyTextures };
  }

  #recordSurfaceTextureBindingOmissions(plan: PureSurfaceTextureBindingPlan): void {
    for (const omission of plan.omissions) {
      if (omission.reason !== "unit-exhausted") continue;
      const key = `surface-texture-unit-exhausted:${omission.feature}:${this.#maxTextureImageUnits}`;
      this.#recordDiagnostic(
        `Surface texture ${omission.feature} omitted because no fragment sampler unit was available`,
        key,
      );
    }
  }

  #bindSurfaceToneMapping(program: WebGLProgram, toneMapping: SceneToneMappingState): void {
    uniformColor(this.#programArena, program, "u_toneMappingSettings", [
      toneMapping.toneMapping === "aces-fitted" ? 1 : toneMapping.toneMapping === "pbr-neutral" ? 2 : 0,
      toneMapping.exposure,
      toneMapping.hdrOutput ? 1 : 0,
      0,
    ]);
  }

  #bindSurfaceMaterialTextures(
    program: WebGLProgram,
    plan: SurfaceTextureBindingPlan,
  ): void {
    for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) {
      this.#bindCachedTexture2d(program, descriptor, plan);
    }
  }

  #bindCachedTexture2d(
    program: WebGLProgram,
    descriptor: (typeof SURFACE_MATERIAL_TEXTURE_BINDINGS)[number],
    plan: SurfaceTextureBindingPlan,
  ): void {
    const resource = plan.readyTextures.get(descriptor.feature);
    const gl = this.#gl;
    const allocatedUnit = plan.textureUnits.get(descriptor.feature);
    if (resource === undefined || allocatedUnit === undefined) {
      uniform1i(this.#programArena, program, descriptor.useUniform, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE0 + allocatedUnit);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    uniform1i(this.#programArena, program, descriptor.samplerUniform, allocatedUnit);
    uniform1i(this.#programArena, program, descriptor.useUniform, 1);
  }

  #bindTransmissionScreenColorTexture(
    program: WebGLProgram,
    resource: ScreenColorTextureResource | undefined,
    plan: SurfaceTextureBindingPlan,
  ): void {
    if (resource === undefined || !resource.uploaded) {
      uniform1i(this.#programArena, program, "u_useTransmissionTexture", 0);
      return;
    }

    const gl = this.#gl;
    const textureUnit = plan.textureUnits.get("transmissionScreenTexture");
    if (textureUnit === undefined) {
      uniform1i(this.#programArena, program, "u_useTransmissionTexture", 0);
      return;
    }
    uniform1i(this.#programArena, program, "u_useTransmissionTexture", 1);
    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    uniform1i(this.#programArena, program, "u_transmissionScreenTexture", textureUnit);
    uniform2fv(this.#programArena, program, "u_viewportOrigin", [resource.originX, resource.originY]);
    uniform2fv(this.#programArena, program, "u_viewportSize", [resource.width, resource.height]);
  }

  #bindSurfaceLights(
    program: WebGLProgram,
    lightSet: SurfaceLightSet,
    plan: SurfaceTextureBindingPlan,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
  ): void {
    try {
      bindSurfaceIbl(
        this.#iblTextures,
        this.#programArena,
        program,
        lightSet,
        plan.textureUnits.get("iblSpecularCube"),
        plan.textureUnits.get("iblBrdfLut"),
      );
    } finally {
      this.#consumeIblTextureSignals();
    }

    const lights = lightSet.directionals;
    if (lights.length > MAX_SURFACE_LIGHTS) {
      throw new Error(`Royal supports at most ${MAX_SURFACE_LIGHTS} directional lights per pass`);
    }
    uniform1i(this.#programArena, program, "u_surfaceLightCount", lights.length);

    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      if (light === undefined) continue;

      const range = 0;
      const direction = light.direction;
      const position = [0, 0, 0] as const;
      const cone = [1, 0, 0, 0] as const;
      const kind = 0;

      uniform1i(this.#programArena, program, `u_surfaceLightKind[${index}]`, kind);
      uniformColor(this.#programArena, program, `u_surfaceLightColor[${index}]`, light.color);
      uniformColor(this.#programArena, program, `u_surfaceLightDirection[${index}]`, [
        direction[0],
        direction[1],
        direction[2],
        range,
      ]);
      uniformColor(this.#programArena, program, `u_surfaceLightPosition[${index}]`, [
        position[0],
        position[1],
        position[2],
        0,
      ]);
      uniformColor(this.#programArena, program, `u_surfaceLightCone[${index}]`, cone);
    }
    bindClusteredLights(
      this.#clusteredLights,
      this.#programArena,
      program,
      lightSet.punctuals,
      projection,
      view,
      viewportSize[0],
      viewportSize[1],
      this.#frame,
    );

  }

  #releaseUnusedGltfBatchResources(): void {
    const registry = this.#gltfPacketBatchRegistry;
    for (let index = 0; index < this.#gltfLiveBatchCount; index += 1) {
      const batchId = this.#gltfLiveBatchIds[index]!;
      if (registry.batchTouchedEpochs[batchId] === registry.frameEpoch) continue;
      this.#gltfBatches[batchId] = undefined;
    }
    releaseUnusedGltfInstanceBuffers(
      this.#gltfInstanceBufferArena,
      this.#gl,
      this.#context.generation,
    );
    if (this.#gltfLiveBatchIds.length < registry.touchedBatchCount) {
      let capacity = this.#gltfLiveBatchIds.length;
      while (capacity < registry.touchedBatchCount) capacity *= 2;
      this.#gltfLiveBatchIds = new Uint32Array(capacity);
    }
    this.#gltfLiveBatchIds.set(registry.touchedBatchIds.subarray(0, registry.touchedBatchCount));
    this.#gltfLiveBatchCount = registry.touchedBatchCount;
  }

  #bindSurfaceBaseColorTexture(
    program: WebGLProgram,
    plan: SurfaceTextureBindingPlan | undefined,
  ): SurfaceBaseColorTextureBinding {
    if (plan === undefined) return { kind: "none" };
    const binding = plan.baseColor;
    switch (binding.kind) {
      case "ordinary":
        return this.#bindOrdinaryBaseColorTexture(program, binding, plan)
          ? binding
          : { kind: "none" };
      case "prepared-virtual": {
        if (this.#bindVirtualTexture(program, binding.state, plan)) {
          if (binding.ordinaryFallback !== undefined) {
            this.#textureResidencyIntent.recordVirtualBind(textureCacheKey(binding.ordinaryFallback));
          }
          return binding;
        }
        if (binding.ordinaryFallback !== undefined) {
          const resource = this.#requestOrdinaryTexture(binding.ordinaryFallback);
          if (!resource.uploaded) return { kind: "none" };
          const fallback = { kind: "ordinary" as const, resource };
          return this.#bindOrdinaryBaseColorTexture(program, fallback, plan)
            ? fallback
            : { kind: "none" };
        }
        return { kind: "none" };
      }
      case "none":
        return { kind: "none" };
    }
  }

  #requestOrdinaryTexture(texture: TextureAssetUploadRef): OrdinaryTextureGpuResource {
    this.#textureResidencyIntent.requireOrdinary(textureCacheKey(texture));
    return this.#ordinaryTextures.request(texture);
  }

  #bindOrdinaryBaseColorTexture(
    program: WebGLProgram,
    binding: Extract<SurfaceBaseColorTextureBinding, { readonly kind: "ordinary" }>,
    plan: SurfaceTextureBindingPlan,
  ): boolean {
    const textureUnit = plan.textureUnits.get("baseColorTexture");
    if (textureUnit === undefined) return false;
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, binding.resource.texture);
    uniform1i(this.#programArena, program, "u_texture", textureUnit);
    return true;
  }

  #virtualTextureDrawDemandContext(
    geometryId: number,
    geometry: CpuGeometry,
    material: Material,
    modelSource: VirtualTextureDrawDemandModelSource,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
  ): VirtualTextureDrawDemandContext | undefined {
    const texture = material.baseColor;
    if (
      material.kind === "wireframe"
      || texture.kind === "solid"
      || (texture.kind === "asset" && this.#autoBaseColorVirtualTextureSource(texture) === undefined)
      || geometry.texCoords0 === undefined
      || geometry.mode !== "triangles"
      || virtualTextureDemandModelCount(modelSource) === 0
    ) {
      return undefined;
    }
    const baseColorCoordinates = (material as SurfaceMaterial).textureCoordinates?.baseColorTexture;
    const requestedSet = baseColorCoordinates?.set === 1 && geometry.texCoords1 !== undefined ? 1 : 0;
    const provider = cachedVirtualTextureCoverageProvider(
      this.#virtualTextureCoverageProviders,
      geometryId,
      geometry,
      requestedSet,
    );
    if (provider === undefined) return undefined;
    return {
      modelSource,
      projection,
      provider,
      ...(baseColorCoordinates === undefined ? {} : { textureCoordinates: baseColorCoordinates }),
      view,
      viewportSize,
    };
  }

  #resolveBaseColorTextureResidency(
    geometry: GeometryResource,
    material: Material,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency {
    const texture = material.baseColor;
    switch (texture.kind) {
      case "solid":
        return { kind: "none" };
      case "asset":
        return this.#resolveAutoBaseColorTextureResidency(geometry, material, texture, demandContext);
      case "virtual-asset":
        return this.#resolvePreparedVirtualTextureResidency(geometry, material, texture, demandContext);
    }
  }

  #resolveAutoBaseColorTextureResidency(
    geometry: GeometryResource,
    material: Material,
    texture: TextureAssetUploadRef,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency {
    const ordinary: BaseColorTextureResidency = { kind: "ordinary", texture };
    if (material.kind === "wireframe" || geometry.mode !== "triangles" || geometry.texCoord0Buffer === undefined) {
      return ordinary;
    }

    const textureKey = textureCacheKey(texture);
    const source = this.#autoBaseColorVirtualTextureSource(texture);
    if (source === undefined) return ordinary;

    const virtualTexture = this.#autoBaseColorVirtualTextureRef(texture, source);
    const state = this.#virtualTexture(virtualTexture, {
      generatedSource: source,
      cacheNamespace: `auto-base-color:${textureKey}`,
      diagnosticsEnabled: false,
    });
    state.stats.preparedResidencyResolutions += 1;
    const drawDemand = state.status === "ready"
      ? this.#virtualTextureDrawDemand(state, demandContext)
      : undefined;
    if (drawDemand !== undefined) {
      this.#demandVirtualTexturePageCandidates(
        state,
        drawDemand.demandCandidates,
        true,
        drawDemand.preferredCandidates,
      );
    }

    return this.#isAutoVirtualTextureCoverageReady(state, drawDemand)
      ? { kind: "prepared-virtual", ordinaryFallback: texture, state }
      : ordinary;
  }

  #autoBaseColorVirtualTextureRef(
    texture: TextureAssetUploadRef,
    source: GeneratedVirtualTextureSource,
  ): VirtualTextureRef {
    const key = `auto-base-color:${textureCacheKey(texture)}`;
    const cached = this.#autoVirtualTextureRefs.get(key);
    if (cached !== undefined) return cached;

    const virtualTexture: VirtualTextureRef = {
      kind: "virtual-asset",
      ...(texture.colorSpace === undefined ? {} : { colorSpace: texture.colorSpace }),
      ...(texture.contentKey === undefined ? {} : { contentKey: texture.contentKey }),
      flipY: texture.flipY ?? true,
      manifestUri: source.manifestUri,
      ...(texture.sampler === undefined ? {} : { sampler: texture.sampler }),
      ...(texture.version === undefined ? {} : { version: texture.version }),
    };
    this.#autoVirtualTextureRefs.set(key, virtualTexture);
    return virtualTexture;
  }

  #autoBaseColorVirtualTextureSource(texture: TextureAssetUploadRef): GeneratedVirtualTextureSource | undefined {
    const textureKey = textureCacheKey(texture);
    return this.#autoVirtualTextureGeneratedPageSources.get(textureKey);
  }

  #registerAutoBaseColorVirtualTextureGeneratedPageSource(
    texture: TextureAssetUploadRef,
    source: VirtualTextureGeneratedPageSource | undefined,
  ): void {
    if (source === undefined) return;
    const textureKey = textureCacheKey(texture);
    this.#autoVirtualTextureGeneratedPageSources.set(
      textureKey,
      generatedVirtualTextureSource(textureKey, source),
    );
  }

  #registerAutoBaseColorVirtualTextureRasterPageSource(
    texture: TextureAssetUploadRef,
    source: LoadedTextureSource,
  ): void {
    if (!this.#options.generatedImageVirtualTextures) return;
    if (svgVirtualTextureSourceForImage(source) !== undefined) return;

    const [width, height] = loadedTextureSourceSize(source);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    if (Math.max(width, height) < GENERATED_RASTER_VIRTUAL_TEXTURE_MIN_DIMENSION) return;
    this.#registerAutoBaseColorVirtualTextureGeneratedPageSource(texture, {
      kind: "raster",
      source: {
        ...(texture.colorSpace === undefined ? {} : { colorSpace: texture.colorSpace }),
        height: Math.ceil(height),
        label: texture.uri,
        source,
        width: Math.ceil(width),
      },
    });
  }

  #registerAutoBaseColorVirtualTextureDecodedPageSource(
    texture: TextureAssetUploadRef,
    source: LoadedTextureSource,
  ): void {
    if (!this.#options.generatedImageVirtualTextures) return;
    const svgSource = svgVirtualTextureSourceForImage(source);
    if (svgSource !== undefined) {
      this.#registerAutoBaseColorVirtualTextureGeneratedPageSource(texture, {
        kind: "svg",
        source: svgSource,
      });
      return;
    }

    this.#registerAutoBaseColorVirtualTextureRasterPageSource(texture, source);
  }

  #resolvePreparedVirtualTextureResidency(
    geometry: GeometryResource,
    material: Material,
    texture: VirtualTextureRef,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency {
    if (material.kind === "wireframe") {
      this.#recordUnsupportedVirtualTexture(texture, "virtual textures require surface materials");
      return { kind: "none" };
    }
    if (geometry.mode !== "triangles" || geometry.texCoord0Buffer === undefined) {
      this.#recordUnsupportedVirtualTexture(texture, "virtual textures require triangle geometry with UVs");
      return { kind: "none" };
    }

    const state = this.#virtualTexture(texture);
    state.stats.preparedResidencyResolutions += 1;
    if (state.status === "ready") this.#demandVirtualTexturePages(state, demandContext);
    return { kind: "prepared-virtual", state };
  }

  #virtualTexture(
    texture: VirtualTextureRef,
    options: {
      readonly generatedSource?: GeneratedVirtualTextureSource;
      readonly cacheNamespace?: string;
      readonly diagnosticsEnabled?: boolean;
    } = {},
  ): VirtualTextureRuntimeState {
    const diagnosticsEnabled = options.diagnosticsEnabled ?? true;
    const textureKey = textureCacheKey(texture);
    const key = options.cacheNamespace === undefined
      ? textureKey
      : `${options.cacheNamespace}:${textureKey}`;
    const cached = this.#virtualTextures.get(key);
    if (cached !== undefined) {
      if (diagnosticsEnabled) cached.diagnosticsEnabled = true;
      return cached;
    }
    const activeSource = options.generatedSource ?? {
      kind: "sidecar" as const,
      manifestUri: texture.manifestUri,
    };

    const state: VirtualTextureRuntimeState = {
      activeSource,
      admissionTicket: this.#nextVirtualTextureAdmissionTicket,
      demandPublished: false,
      demandedPageKeys: new Set(),
      demandedPageKeysScratch: new Set(),
      diagnosticsEnabled,
      desiredPageKeys: new Set(),
      desiredPageKeysScratch: new Set(),
      desiredPages: [],
      desiredPagesScratch: [],
      key,
      lastDemandFrame: Number.NEGATIVE_INFINITY,
      sourceGeneration: 1,
      stats: {
        demandAdmissions: 0,
        demandRetentionOverflows: 0,
        demandRetentions: 0,
        generatedManifestUses: 0,
        generatedPageFailures: 0,
        generatedPageRasterizeMaxMs: 0,
        generatedPageRasterizeMs: 0,
        generatedPageRequests: 0,
        generatedPagesTarget: 0,
        gpuAdmissionFailures: 0,
        manifestFailures: 0,
        manifestRequests: activeSource.kind === "sidecar" ? 1 : 0,
        preparedResidencyResolutions: 0,
        pageLoadFailures: 0,
        shaderBinds: 0,
        unreadyDraws: 0,
        unsupportedDraws: 0,
      },
      status: "loading",
      texture,
    };
    this.#nextVirtualTextureAdmissionTicket += 1;
    this.#virtualTextures.set(key, state);
    this.#startVirtualTextureSource(state);

    return state;
  }

  #startVirtualTextureSource(state: VirtualTextureRuntimeState): void {
    switch (state.activeSource.kind) {
      case "generated":
        this.#useGeneratedVirtualTextureManifest(state, state.activeSource);
        return;
      case "sidecar":
        state.manifestAbortController = new AbortController();
        void this.#loadVirtualTextureManifest(state, state.manifestAbortController.signal);
        return;
    }
  }

  async #loadVirtualTextureManifest(
    state: VirtualTextureRuntimeState,
    signal: AbortSignal,
  ): Promise<void> {
    const source = state.activeSource;
    if (source.kind !== "sidecar") return;
    const sourceGeneration = state.sourceGeneration;
    let response: Response;
    try {
      response = await fetch(source.manifestUri, { signal });
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
      ) return;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    } catch (error) {
      if (state.manifestAbortController?.signal === signal) delete state.manifestAbortController;
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
      ) return;
      this.#failVirtualTexture(
        state,
        `manifest transport failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    let payload: unknown;
    try {
      payload = await response.json() as unknown;
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
      ) return;
      if (state.manifestAbortController?.signal === signal) delete state.manifestAbortController;

    } catch (error) {
      if (state.manifestAbortController?.signal === signal) delete state.manifestAbortController;
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
      ) return;
      this.#failVirtualTexture(
        state,
        `manifest JSON decode failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const parsed = parseVirtualTextureManifest(payload);
      for (const diagnostic of parsed.diagnostics) {
        const message = `Virtual texture ${source.manifestUri}: ${diagnostic.message}`;
        if (state.diagnosticsEnabled) {
          this.#recordDiagnostic(
            message,
            `virtual-texture-manifest:${source.manifestUri}:${diagnostic.severity}:${diagnostic.message}`,
          );
        }
      }
      if (parsed.manifest === undefined) {
        this.#failVirtualTexture(state, "manifest parse failed");
        return;
      }

      const manifestUnsupported = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "unsupported");
      if (manifestUnsupported !== undefined) {
        this.#markVirtualTextureUnsupported(
          state,
          manifestUnsupported.message,
        );
        return;
      }
      state.manifest = parsed.manifest;
      state.pageUrisByKey = virtualTextureExplicitPageUrisByKey(parsed.manifest);
      state.status = "ready";
      this.invalidate();
  }

  #useGeneratedVirtualTextureManifest(
    state: VirtualTextureRuntimeState,
    source: Extract<VirtualTextureManifestSource, { readonly kind: "generated" }>,
  ): void {
    const manifest = this.#generatedVirtualTextureManifest(source.pageSource);
    state.stats.generatedManifestUses += 1;
    state.stats.generatedPagesTarget = generatedVirtualTexturePageCount(
      manifest.width,
      manifest.height,
      manifest.pageSize,
    );
    state.manifest = manifest;
    state.pageUrisByKey = new Map();
    state.status = "ready";
    this.invalidate();
  }

  #generatedVirtualTextureManifest(
    source: VirtualTextureGeneratedPageSource,
  ): VirtualTextureManifestModel {
    switch (source.kind) {
      case "raster":
        return generatedRasterVirtualTextureManifest(source.source);
      case "svg":
        return generatedSvgVirtualTextureManifest(
          source.source,
          this.#options.generatedSvgVirtualTextureRasterDensity,
        );
    }
  }

  #attemptVirtualTextureGpuAdmission(
    state: VirtualTextureRuntimeState,
    manifest: VirtualTextureManifestModel,
  ): "pressure" | "ready" | "terminal" {
    if (this.#context.lifecycle !== "active") return "pressure";
    const options = {
      ...(state.texture.sampler?.magFilter === undefined
        ? {}
        : { atlasMagFilter: state.texture.sampler.magFilter }),
      ...(state.texture.sampler?.minFilter === undefined
        ? {}
        : { atlasMinFilter: state.texture.sampler.minFilter }),
      colorSpace: state.texture.colorSpace ?? manifest.colorSpace ?? "srgb",
      manifest,
      sourceGeneration: state.sourceGeneration,
    } as const;
    let governorReservation: ResourceGovernorReservation | undefined;
    if (!this.#virtualTextureGovernorLeases.has(state.key)) {
      const gpuArena = virtualTextureGpuArenaSnapshot(this.#virtualTextureGpu);
      const admission = virtualTextureGpuAdmission(
        options,
        this.#maxTextureSize,
        gpuArena.budgetBytes - gpuArena.chargedBytes,
        this.#maxTextureImageUnits,
      );
      const persistentGpuMaximum = this.#maximumResourceClassPersistentGpuBytes("virtual-texture");
      if (admission.kind === "dormant" && admission.requiredBytes > persistentGpuMaximum) {
        state.stats.gpuAdmissionFailures += 1;
        this.#markVirtualTextureUnsupported(
          state,
          `resource allocation requires ${admission.requiredBytes} persistent GPU bytes, exceeding the virtual-texture limit ${persistentGpuMaximum}`,
        );
        return "terminal";
      }
      if (
        admission.kind === "dormant"
        && manifest.physicalByteBudget !== undefined
        && admission.requiredBytes > manifest.physicalByteBudget
      ) {
        state.stats.gpuAdmissionFailures += 1;
        this.#markVirtualTextureUnsupported(
          state,
          `resource allocation requires ${admission.requiredBytes} persistent GPU bytes, exceeding the manifest physical byte limit ${manifest.physicalByteBudget}`,
        );
        return "terminal";
      }
      if (admission.kind === "dormant") {
        state.stats.gpuAdmissionFailures += 1;
        return "pressure";
      }
      if (admission.kind === "supported") {
        const limits = this.#options.resourceGovernorPolicy.limits;
        if (admission.allocatedBytes > persistentGpuMaximum) {
          state.stats.gpuAdmissionFailures += 1;
          this.#markVirtualTextureUnsupported(
            state,
            `resource allocation requires ${admission.allocatedBytes} persistent GPU bytes, exceeding the virtual-texture limit ${persistentGpuMaximum}`,
          );
          return "terminal";
        }
        const pageUploadBytes = virtualTextureDecodedPageBytes(manifest);
        const largestUploadBytes = Math.max(
          pageUploadBytes,
          maxVirtualTexturePageTableUploadBytes(manifest, state.activeSource.kind === "generated"),
        );
        if (largestUploadBytes > limits.uploadBytes) {
          state.stats.gpuAdmissionFailures += 1;
          this.#markVirtualTextureUnsupported(
            state,
            `page or page-table upload requires up to ${largestUploadBytes} bytes, exceeding the configured per-frame upload limit ${limits.uploadBytes}`,
          );
          return "terminal";
        }
        const reserved = reserveResourceGovernor(this.#resourceGovernor, "virtual-texture", {
          persistentGpuBytes: admission.allocatedBytes,
        });
        if (typeof reserved === "string") {
          state.stats.gpuAdmissionFailures += 1;
          if (state.diagnosticsEnabled) {
            this.#recordDiagnostic(
              `Virtual texture ${state.activeSource.manifestUri} deferred by root resource governor: ${reserved}`,
              `virtual-texture-governor:${state.activeSource.manifestUri}:${reserved}`,
            );
          }
          return "pressure";
        }
        governorReservation = reserved;
      }
    }
    let result: ReturnType<typeof admitVirtualTextureGpuResource> | undefined;
    let admissionFailure: CapturedFailure | undefined;
    let reservationCancelled = false;
    const quarantineBeforeAdmission = virtualTextureGpuArenaSnapshot(this.#virtualTextureGpu).quarantinedBytes;
    const previouslySuppressed = this.#suppressPersistentGpuCapacityWake;
    this.#suppressPersistentGpuCapacityWake = true;
    try {
      result = admitVirtualTextureGpuResource(
        this.#virtualTextureGpu,
        state.key,
        this.#context.generation,
        options,
      );
      this.#synchronizeResourceGovernorObservations();
      if (result.kind === "ready" && governorReservation !== undefined) {
        this.#virtualTextureGovernorLeases.set(state.key, governorReservation.commit());
        governorReservation = undefined;
      } else if (governorReservation !== undefined) {
        reservationCancelled = governorReservation.cancel();
        governorReservation = undefined;
      }
    } catch (value) {
      admissionFailure = { value };
      // Failed allocation cleanup may have transferred bytes into quarantine.
      // Publish those bytes before the matching reservation releases capacity.
      admissionFailure = captureFirstFailure(
        admissionFailure,
        () => this.#synchronizeResourceGovernorObservations(),
      );
      if (governorReservation !== undefined) {
        const cancellationFailure = captureFailure(() => {
          reservationCancelled = governorReservation!.cancel();
        });
        admissionFailure ??= cancellationFailure;
        governorReservation = undefined;
      }
    } finally {
      this.#suppressPersistentGpuCapacityWake = previouslySuppressed;
    }
    const quarantineAfterAdmission = virtualTextureGpuArenaSnapshot(this.#virtualTextureGpu).quarantinedBytes;
    if (
      reservationCancelled
      && quarantineAfterAdmission === quarantineBeforeAdmission
      && !previouslySuppressed
    ) {
      this.#wakePersistentGpuCapacity();
    }
    if (admissionFailure !== undefined) throw admissionFailure.value;
    if (result === undefined) throw new Error("Virtual texture GPU admission did not produce a result");
    if (result.kind === "unsupported") {
      const reason = result.reason === "insufficient-texture-units"
        ? "requires at least two fragment texture units for atlas and page-table textures"
        : result.reason === "texture-size-exceeded"
          ? "atlas or page-table dimensions exceed WebGL2 texture limits"
          : result.reason;
      this.#markVirtualTextureUnsupported(state, reason);
      return "terminal";
    }
    if (result.kind === "failed") {
      state.status = "error";
      state.stats.gpuAdmissionFailures += 1;
      const reason = result.error instanceof Error ? result.error.message : String(result.error);
      if (state.diagnosticsEnabled) {
        this.#recordDiagnostic(
          `Virtual texture ${state.activeSource.manifestUri} GPU resource admission failed: ${reason}`,
          `virtual-texture-gpu-admission:${state.activeSource.manifestUri}`,
        );
      }
      return "terminal";
    }
    if (result.kind === "dormant") return "pressure";
    if (consumeVirtualTextureGpuWake(this.#virtualTextureGpu)) this.invalidate();
    return "ready";
  }

  #ensureVirtualTextureGpuResource(
    state: VirtualTextureRuntimeState,
    manifest: VirtualTextureManifestModel,
    demandedStates: ReadonlySet<VirtualTextureRuntimeState>,
  ): boolean {
    const firstAttempt = this.#attemptVirtualTextureGpuAdmission(state, manifest);
    if (firstAttempt !== "pressure") return firstAttempt === "ready";
    const reclamation = this.#oldestColdVirtualTextureAllocation(demandedStates);
    if (reclamation.state === undefined) {
      if (reclamation.graceBlocked) this.#scheduleVirtualTextureAllocationRetry();
      return false;
    }
    this.#releaseVirtualTextureGpuOwnership(reclamation.state, false);
    const secondAttempt = this.#attemptVirtualTextureGpuAdmission(state, manifest);
    if (secondAttempt === "pressure") {
      const remaining = this.#oldestColdVirtualTextureAllocation(demandedStates);
      if (remaining.state !== undefined || remaining.graceBlocked) {
        this.#scheduleVirtualTextureAllocationRetry();
      }
    }
    return secondAttempt === "ready";
  }

  #oldestColdVirtualTextureAllocation(
    demandedStates: ReadonlySet<VirtualTextureRuntimeState>,
  ): { readonly graceBlocked: boolean; readonly state?: VirtualTextureRuntimeState } {
    let graceBlocked = false;
    let oldest: VirtualTextureRuntimeState | undefined;
    for (const candidate of this.#virtualTextures.values()) {
      if (demandedStates.has(candidate)) continue;
      const resource = virtualTextureGpuResource(this.#virtualTextureGpu, candidate.key);
      if (resource === undefined || !virtualTextureGpuResourceSnapshot(resource).allocated) continue;
      const demandAge = this.#frame - candidate.lastDemandFrame;
      if (
        candidate.lastDemandFrame !== Number.NEGATIVE_INFINITY
        && demandAge <= VIRTUAL_TEXTURE_COLD_ALLOCATION_GRACE_FRAMES
      ) {
        graceBlocked = true;
        continue;
      }
      if (
        oldest === undefined
        || candidate.lastDemandFrame < oldest.lastDemandFrame
        || (
          candidate.lastDemandFrame === oldest.lastDemandFrame
          && candidate.admissionTicket < oldest.admissionTicket
        )
      ) oldest = candidate;
    }
    return oldest === undefined ? { graceBlocked } : { graceBlocked, state: oldest };
  }

  #scheduleVirtualTextureAllocationRetry(): void {
    if (this.#virtualTextureAllocationRetryFrame === this.#frame) return;
    this.#virtualTextureAllocationRetryFrame = this.#frame;
    this.invalidate();
  }

  #demandVirtualTexturePages(
    state: VirtualTextureRuntimeState,
    context?: VirtualTextureDrawDemandContext,
  ): void {
    const drawDemand = this.#virtualTextureDrawDemand(state, context);
    this.#demandVirtualTexturePageCandidates(
      state,
      drawDemand.demandCandidates,
      context !== undefined || state.activeSource.kind === "generated",
      drawDemand.preferredCandidates,
    );
  }

  #demandVirtualTexturePageCandidates(
    state: VirtualTextureRuntimeState,
    candidates: readonly VirtualTexturePageId[],
    preferTargetMip = false,
    preferredCandidates?: readonly VirtualTexturePageId[],
  ): void {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") return;
    const demandedPageKeys = state.demandedPageKeysScratch;
    if (!this.#virtualTextureFrameDemand.active) {
      demandedPageKeys.clear();
      for (const page of candidates) demandedPageKeys.add(virtualTexturePageKey(page));
      if (preferredCandidates !== undefined) {
        for (const page of preferredCandidates) demandedPageKeys.add(virtualTexturePageKey(page));
      }
    }
    const convergentCandidates = this.#convergentVirtualTextureCandidates(state, candidates);
    const convergentPreferredCandidates = preferredCandidates === undefined
      ? undefined
      : this.#convergentVirtualTextureCandidates(state, preferredCandidates);
    if (this.#virtualTextureFrameDemand.active) {
      const nonconvergentCandidates = convergentCandidates.length === candidates.length
        && (preferredCandidates === undefined
          || convergentPreferredCandidates?.length === preferredCandidates.length)
        ? []
        : [...candidates, ...(preferredCandidates ?? [])].filter((page) => (
            !this.#virtualTextureRequests.canBecomeResident(state, virtualTexturePageKey(page))
          ));
      submitVirtualTextureFrameDemand(
        this.#virtualTextureFrameDemand,
        state,
        state.admissionTicket,
        this.#virtualTextureDemandViewIndex,
        this.#virtualTextureFrameDemandCapacity(state),
        {
          candidates: convergentCandidates,
          preferTargetMip,
          ...(convergentPreferredCandidates === undefined
            ? {}
            : { preferredCandidates: convergentPreferredCandidates }),
        },
        nonconvergentCandidates,
      );
      return;
    }
    this.#applyVirtualTextureDemand(
      state,
      convergentPreferredCandidates === undefined
        ? selectVirtualTextureWorkingSet(
            convergentCandidates,
            this.#virtualTextureDemandCapacity(state),
            preferTargetMip,
          )
        : selectVirtualTextureFrameWorkingSet(
            [{
              candidates: convergentCandidates,
              preferTargetMip,
              preferredCandidates: convergentPreferredCandidates,
            }],
            this.#virtualTextureDemandCapacity(state),
          ),
      true,
    );
  }

  #convergentVirtualTextureCandidates(
    state: VirtualTextureRuntimeState,
    candidates: readonly VirtualTexturePageId[],
  ): readonly VirtualTexturePageId[] {
    let includesTerminalPage = false;
    for (const page of candidates) {
      if (!this.#virtualTextureRequests.canBecomeResident(state, virtualTexturePageKey(page))) {
        includesTerminalPage = true;
        break;
      }
    }
    if (!includesTerminalPage) return candidates;
    return candidates.filter((page) => this.#virtualTextureRequests.canBecomeResident(
      state,
      virtualTexturePageKey(page),
    ));
  }

  #virtualTextureDemandCapacity(state: VirtualTextureRuntimeState): number {
    const manifest = state.manifest;
    if (manifest === undefined) return 0;
    const resource = virtualTextureGpuResource(this.#virtualTextureGpu, state.key);
    const gpu = resource === undefined ? undefined : virtualTextureGpuResourceSnapshot(resource);
    return gpu?.allocated === true ? gpu.effectiveSlots : 0;
  }

  #virtualTextureFrameDemandCapacity(state: VirtualTextureRuntimeState): number {
    const manifest = state.manifest;
    if (manifest === undefined) return 1;
    const allocated = this.#virtualTextureDemandCapacity(state);
    if (allocated > 0) return allocated;
    return Math.min(
      manifest.physicalSlots ?? 4,
      generatedVirtualTexturePageCount(manifest.width, manifest.height, manifest.pageSize),
    );
  }

  #prepareVirtualTextureDemand(
    state: VirtualTextureRuntimeState,
    workingCandidates: readonly VirtualTexturePageId[],
  ): boolean {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") return false;
    const desiredPageKeys = state.desiredPageKeysScratch;
    const desiredPages = state.desiredPagesScratch;
    const capacity = this.#virtualTextureDemandCapacity(state);
    const resource = virtualTextureGpuResource(this.#virtualTextureGpu, state.key);
    const gpu = resource === undefined ? undefined : virtualTextureGpuResourceSnapshot(resource);
    const stabilized = stabilizeVirtualTextureDesiredPagesInto(
      workingCandidates,
      state.desiredPages,
      state.desiredPageKeys,
      gpu?.occupiedSlots ?? 0,
      (page) => virtualTextureGpuCachedResidency(this.#virtualTextureGpu, state.key, page) !== undefined,
      capacity,
      desiredPages,
      desiredPageKeys,
      (page) => this.#virtualTextureRequests.canBecomeResident(state, virtualTexturePageKey(page)),
    );
    state.stats.demandAdmissions += stabilized.admissions;
    state.stats.demandRetentions += stabilized.retentions;
    return true;
  }

  #commitPreparedVirtualTextureDemand(
    state: VirtualTextureRuntimeState,
    commitDemandedPageKeys = false,
  ): void {
    const previousPageKeys = state.desiredPageKeys;
    const previousPages = state.desiredPages;
    state.desiredPageKeys = state.desiredPageKeysScratch;
    state.desiredPages = state.desiredPagesScratch;
    state.desiredPageKeysScratch = previousPageKeys;
    state.desiredPagesScratch = previousPages;
    if (commitDemandedPageKeys) {
      const previousDemandedPageKeys = state.demandedPageKeys;
      state.demandedPageKeys = state.demandedPageKeysScratch;
      state.demandedPageKeysScratch = previousDemandedPageKeys;
    }
    state.demandPublished = true;
    const resource = virtualTextureGpuResource(this.#virtualTextureGpu, state.key);
    if (resource !== undefined) {
      setVirtualTextureGpuDesiredPageKeys(this.#virtualTextureGpu, resource, state.desiredPageKeys);
    }
    this.#virtualTextureRequests.reconcileDemand(state, previousPageKeys);
    // Convergence is woken by decode/upload settlement. Invalidating here
    // would repeatedly reconsider the same nonresident admissions and erode
    // transition coverage before any page can become drawable.
  }

  #touchPublishedVirtualTextureDemand(state: VirtualTextureRuntimeState): void {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") return;
    for (const page of state.desiredPages) {
      touchVirtualTextureGpuResidency(
        this.#virtualTextureGpu,
        state.key,
        page,
        virtualTextureDemandMipCount(manifest) - 1,
      );
    }
  }

  #applyVirtualTextureDemand(
    state: VirtualTextureRuntimeState,
    workingCandidates: readonly VirtualTexturePageId[],
    commitDemandedPageKeys = false,
  ): void {
    if (!this.#prepareVirtualTextureDemand(state, workingCandidates)) return;
    this.#commitPreparedVirtualTextureDemand(state, commitDemandedPageKeys);
    this.#touchPublishedVirtualTextureDemand(state);
    const closeFailure = captureFailure(() => this.#consumeVirtualTextureGpuOutcomes());
    this.#virtualTextureRequests.schedule();
    if (closeFailure !== undefined) throw closeFailure.value;
  }

  #finalizeVirtualTextureFrameDemand(commit: boolean): void {
    const commits = finalizeVirtualTextureFrameDemand(
      this.#virtualTextureFrameDemand,
      commit,
      (state) => this.#virtualTextureDemandCursors.get(state) ?? 0,
    );
    if (!commit) return;
    const commitsByState = this.#virtualTextureFrameCommits;
    commitsByState.clear();
    for (const entry of commits) commitsByState.set(entry.resource, entry);
    const demandedStates = this.#virtualTextureDemandedStates;
    demandedStates.clear();
    for (const entry of commits) {
      const demandedPageKeys = entry.resource.demandedPageKeysScratch;
      for (const page of entry.nonconvergentCandidates) {
        demandedPageKeys.add(virtualTexturePageKey(page));
      }
      for (const submission of entry.submissions) {
        for (const page of submission.candidates) demandedPageKeys.add(virtualTexturePageKey(page));
        for (const page of submission.preferredCandidates ?? []) {
          demandedPageKeys.add(virtualTexturePageKey(page));
        }
      }
      if (demandedPageKeys.size > 0) demandedStates.add(entry.resource);
    }
    const admissionStates = this.#virtualTextureAdmissionStates;
    admissionStates.length = 0;
    for (const state of demandedStates) {
      if (state.status === "ready" && state.manifest !== undefined) admissionStates.push(state);
    }
    admissionStates.sort((left, right) => left.admissionTicket - right.admissionTicket);
    let admissionStart = admissionStates.findIndex(
      (state) => state.admissionTicket >= this.#virtualTextureRetryTicket,
    );
    if (admissionStart < 0) admissionStart = 0;
    let commitFailure: CapturedFailure | undefined;
    for (let offset = 0; offset < admissionStates.length && commitFailure === undefined; offset += 1) {
      const state = admissionStates[(admissionStart + offset) % admissionStates.length]!;
      commitFailure = captureFirstFailure(commitFailure, () => {
        this.#ensureVirtualTextureGpuResource(state, state.manifest!, demandedStates);
      });
    }
    if (admissionStates.length > 0) {
      this.#virtualTextureRetryTicket = admissionStates[(admissionStart + 1) % admissionStates.length]!.admissionTicket;
    }
    const publicationStates = this.#virtualTextureDemandPublicationStates;
    const publicationCommits = this.#virtualTextureDemandPublicationCommits;
    publicationStates.length = 0;
    publicationCommits.length = 0;
    if (commitFailure === undefined) {
      for (const state of this.#virtualTextures.values()) {
        const entry = commitsByState.get(state);
        const submissions = entry?.submissions ?? [];
        const pages = selectVirtualTextureFrameWorkingSet(
          submissions,
          this.#virtualTextureDemandCapacity(state),
          entry?.startSubmission ?? 0,
        );
        if (!this.#prepareVirtualTextureDemand(state, pages)) continue;
        publicationStates.push(state);
        publicationCommits.push(entry);
      }
    }
    for (const state of publicationStates) {
      commitFailure = captureFirstFailure(
        commitFailure,
        () => this.#commitPreparedVirtualTextureDemand(state, true),
      );
    }
    for (const state of publicationStates) {
      commitFailure = captureFirstFailure(
        commitFailure,
        () => this.#touchPublishedVirtualTextureDemand(state),
      );
    }
    if (commitFailure === undefined) {
      for (const state of demandedStates) state.lastDemandFrame = this.#frame;
    }
    for (let index = 0; index < publicationStates.length; index += 1) {
      const entry = publicationCommits[index];
      if (entry !== undefined && entry.submissions.length > 1) {
        this.#virtualTextureDemandCursors.set(publicationStates[index]!, entry.nextStartSubmission);
      }
      if (entry !== undefined) advanceVirtualTextureFrameDemand(this.#virtualTextureFrameDemand, entry);
    }
    const closeFailure = captureFailure(() => this.#consumeVirtualTextureGpuOutcomes());
    this.#virtualTextureRequests.schedule();
    commitsByState.clear();
    demandedStates.clear();
    admissionStates.length = 0;
    publicationStates.length = 0;
    publicationCommits.length = 0;
    if (commitFailure !== undefined) throw commitFailure.value;
    if (closeFailure !== undefined) throw closeFailure.value;
  }

  #virtualTextureDrawDemand(
    state: VirtualTextureRuntimeState,
    context: VirtualTextureDrawDemandContext | undefined,
  ): VirtualTextureDrawDemand {
    const manifest = state.manifest;
    if (manifest === undefined) {
      return context === undefined
        ? { demandCandidates: [] }
        : { coverageCandidates: [], demandCandidates: [] };
    }

    const demand = planVirtualTextureDrawDemand({
      ...(context === undefined ? {} : { context }),
      flipY: state.texture.flipY ?? true,
      generated: state.activeSource.kind === "generated",
      manifest,
      workspace: this.#virtualTextureDemandPlanning,
      ...(state.pageUrisByKey === undefined ? {} : { pageUrisByKey: state.pageUrisByKey }),
    });
    if (demand.retentionOverflowed === true) {
      state.stats.demandRetentionOverflows += 1;
      if (state.stats.demandRetentionOverflows === 1 && state.diagnosticsEnabled) {
        this.#recordDiagnostic(
          `Virtual texture ${state.activeSource.manifestUri} exceeded the retained-polygon demand workspace; using bounded conservative refinement`,
          `virtual-texture-demand-retention-overflow:${state.activeSource.manifestUri}`,
        );
      }
    }
    return demand;
  }

  #maximumResourceClassCpuBytes(resourceClass: ResourceGovernorClass): number {
    const policy = this.#options.resourceGovernorPolicy;
    return maximumResourceGovernorClassDurableBytes(policy, resourceClass, "cpuDecodedBytes");
  }

  #maximumResourceClassPersistentGpuBytes(resourceClass: ResourceGovernorClass): number {
    const policy = this.#options.resourceGovernorPolicy;
    return maximumResourceGovernorClassDurableBytes(policy, resourceClass, "persistentGpuBytes");
  }

  #scheduleCpuCapacityWake(): void {
    if (this.#cpuCapacityWakeScheduled || this.#disposed) return;
    this.#cpuCapacityWakeScheduled = true;
    queueMicrotask(() => queueMicrotask(() => {
      this.#cpuCapacityWakeScheduled = false;
      if (this.#disposed) return;
      const ordinaryWake = this.#ordinaryTextures.wakeCpuCapacity();
      const preparedAssetWake = wakeResourceArenaPreparedAssetCpuCapacity(this.#resourceArena);
      const virtualTextureWake = this.#virtualTextureRequests.wakeDecodedCapacity();
      if (ordinaryWake || preparedAssetWake || virtualTextureWake) this.invalidate();
    }));
  }

  #virtualTexturePageImage(
    state: VirtualTextureRuntimeState,
    page: VirtualTexturePageId,
    signal: AbortSignal,
  ): Promise<TexImageSource> | undefined {
    const manifest = state.manifest;
    if (manifest === undefined) return undefined;
    if (state.activeSource.kind === "generated") {
      return this.#generatedVirtualTexturePageImage(
        state,
        state.activeSource.pageSource,
        manifest,
        page,
        signal,
      );
    }
    const uri = virtualTexturePageUri(manifest, page, state.pageUrisByKey);
    return uri === undefined
      ? undefined
      : loadImage(resolveResourceUri(state.activeSource.manifestUri, uri), signal);
  }

  #generatedVirtualTexturePageImage(
    state: VirtualTextureRuntimeState,
    source: VirtualTextureGeneratedPageSource,
    manifest: VirtualTextureManifestModel,
    page: VirtualTexturePageId,
    signal: AbortSignal,
  ): Promise<TexImageSource> {
    const started = virtualTextureNow();
    state.stats.generatedPageRequests += 1;
    const recordResult = (image: TexImageSource): TexImageSource => {
      const elapsed = Math.max(0, virtualTextureNow() - started);
      state.stats.generatedPageRasterizeMs += elapsed;
      state.stats.generatedPageRasterizeMaxMs = Math.max(state.stats.generatedPageRasterizeMaxMs, elapsed);
      return image;
    };
    const recordFailure = (error: unknown): never => {
      if (!signal.aborted) state.stats.generatedPageFailures += 1;
      throw error;
    };

    switch (source.kind) {
      case "raster":
        try {
          throwIfAborted(signal);
          return Promise.resolve(recordResult(generatedRasterVirtualTexturePageImage(source.source, manifest, page)));
        } catch (error) {
          if (!signal.aborted) state.stats.generatedPageFailures += 1;
          return Promise.reject(error);
        }
      case "svg":
        return loadGeneratedSvgVirtualTexturePageImage(source.source, manifest, page, signal)
          .then(recordResult, recordFailure);
    }
  }

  #isVirtualTextureDrawable(state: VirtualTextureRuntimeState): boolean {
    return state.status === "ready"
      && virtualTextureGpuDrawable(this.#virtualTextureGpu, state.key);
  }

  #isAutoVirtualTextureCoverageReady(
    state: VirtualTextureRuntimeState,
    drawDemand: VirtualTextureDrawDemand | undefined,
  ): boolean {
    if (!this.#isVirtualTextureDrawable(state)) return false;
    const candidates = drawDemand?.coverageCandidates;
    if (candidates === undefined) return true;

    return candidates.length > 0
      && candidates.every((page) => (
        virtualTextureGpuExactResidency(this.#virtualTextureGpu, state.key, page) !== undefined
      ));
  }

  #bindVirtualTexture(
    program: WebGLProgram,
    state: VirtualTextureRuntimeState,
    plan: SurfaceTextureBindingPlan,
  ): boolean {
    const manifest = state.manifest;
    if (manifest === undefined || !this.#isVirtualTextureDrawable(state)) return false;
    const atlasTextureUnit = plan.textureUnits.get("baseColorVirtualTextureAtlas");
    const pageTableTextureUnit = plan.textureUnits.get("baseColorVirtualTexturePageTable");
    if (atlasTextureUnit === undefined || pageTableTextureUnit === undefined) return false;

    const binding = bindVirtualTextureGpuResource(
      this.#virtualTextureGpu,
      state.key,
      atlasTextureUnit,
      pageTableTextureUnit,
    );
    if (binding === undefined) return false;
    uniform1i(this.#programArena, program, "u_vtAtlas", atlasTextureUnit);
    uniform1i(this.#programArena, program, "u_vtPageTable", pageTableTextureUnit);
    uniform2f(this.#programArena, program, "u_vtPageTableSize", binding.pageTableWidth, binding.pageTableHeight);
    uniform2f(this.#programArena, program, "u_vtAtlasGrid", binding.atlasGridColumns, binding.atlasGridRows);
    uniform2f(
      this.#programArena,
      program,
      "u_vtAtlasTexelSize",
      1 / (binding.atlasGridColumns * binding.atlasCellSize),
      1 / (binding.atlasGridRows * binding.atlasCellSize),
    );
    uniform1f(this.#programArena, program, "u_vtBorderTexels", binding.borderTexels);
    uniform1f(this.#programArena, program, "u_vtPageSize", manifest.pageSize);
    uniform2f(this.#programArena, program, "u_vtVirtualSize", manifest.width, manifest.height);
    uniform1i(this.#programArena, program, "u_vtFlipY", (state.texture.flipY ?? true) ? 1 : 0);
    uniform1i(this.#programArena, program, "u_vtWrapS", this.#virtualTextureWrapMode(state.texture.sampler?.wrapS));
    uniform1i(this.#programArena, program, "u_vtWrapT", this.#virtualTextureWrapMode(state.texture.sampler?.wrapT));
    state.stats.shaderBinds += 1;

    return true;
  }

  #virtualTextureWrapMode(wrap: TextureSampler["wrapS"] | undefined): number {
    switch (wrap) {
      case "repeat":
        return VT_WRAP_REPEAT;
      case "mirrored-repeat":
        return VT_WRAP_MIRRORED_REPEAT;
      case "clamp-to-edge":
      default:
        return VT_WRAP_CLAMP_TO_EDGE;
    }
  }

  #failVirtualTexture(state: VirtualTextureRuntimeState, reason: string): void {
    state.status = "error";
    state.stats.manifestFailures += 1;
    const message = `Virtual texture ${state.activeSource.manifestUri} failed: ${reason}`;
    if (state.diagnosticsEnabled) {
      this.#recordDiagnostic(message, `virtual-texture-failed:${state.activeSource.manifestUri}`);
    }
  }

  #markVirtualTextureUnsupported(state: VirtualTextureRuntimeState, reason: string): void {
    state.status = "unsupported";
    const message = `Virtual texture ${state.activeSource.manifestUri} unsupported: ${reason}. Rendering with material color only.`;
    if (state.diagnosticsEnabled) {
      this.#recordDiagnostic(message, `virtual-texture-unsupported:${state.activeSource.manifestUri}`);
    }
    this.invalidate();
  }

  #program(kind: ProgramKind, features?: SurfaceShaderFeatures, clusteredLights = false): ProgramArenaResource | undefined {
    try {
      return requestProgram(this.#programArena, this.#frame, kind, features, clusteredLights);
    } finally {
      if (consumeProgramArenaWake(this.#programArena)) this.invalidate();
    }
  }

  #meshGeometryRow(
    geometry: MeshNode["geometry"],
    material: Material,
  ): { readonly id: number; readonly recipe: CpuGeometry } {
    const declaration = directGeometryDeclaration(
      geometry,
      material.kind === "wireframe" ? "wireframe" : "surface",
    );
    const key = directGeometryDeclarationKey(declaration);
    const retained = this.#retainedGeometryRecipes.get(key);
    if (retained === undefined) {
      throw new Error(`Royal direct geometry ${key} was not semantically retained`);
    }
    return retained;
  }

  #meshGeometry(geometry: MeshNode["geometry"], material: Material): CpuGeometry {
    return this.#meshGeometryRow(geometry, material).recipe;
  }

  #localGeometryBounds(geometry: CpuGeometry): Bounds3 | undefined {
    if (this.#geometryLocalBounds.has(geometry.positions)) return this.#geometryLocalBounds.get(geometry.positions);
    const bounds = worldBounds(geometry.positions, identityMat4());
    this.#geometryLocalBounds.set(geometry.positions, bounds);
    return bounds;
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
      const state = this.#virtualTextures.get(outcome.key);
      if (state !== undefined && outcome.upload.sourceGeneration === state.sourceGeneration) {
        this.#virtualTextureRequests.settleGpuPage(state, outcome.upload.pageKey);
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
      processVirtualTextureGpuUploads(this.#virtualTextureGpu, this.#frame, {
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
    const previouslySuppressed = this.#suppressPersistentGpuCapacityWake;
    this.#suppressPersistentGpuCapacityWake = true;
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
      this.#suppressPersistentGpuCapacityWake = previouslySuppressed;
    }
    if (capacityReleased && !previouslySuppressed) this.#wakePersistentGpuCapacity();
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  #processOrdinaryTextureUploads(): void {
    const previouslySuppressed = this.#suppressPersistentGpuCapacityWake;
    this.#suppressPersistentGpuCapacityWake = true;
    const report = this.#ordinaryTextures.process(this.#frame, this.#context.generation, {
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
    });
    let processFailure = report.operationFailure === undefined
      ? undefined
      : { value: report.operationFailure.error };
    processFailure = captureFirstFailure(
      processFailure,
      () => this.#synchronizeResourceGovernorObservations(),
    );
    this.#suppressPersistentGpuCapacityWake = previouslySuppressed;
    if (
      processFailure !== undefined
      && report.quarantinedBytesAfter === report.quarantinedBytesBefore
      && !previouslySuppressed
    ) {
      this.#wakePersistentGpuCapacity();
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

  #gltfState(node: AnyGltfNode): GltfState {
    const nodeState = this.#gltfStatesByNode.get(node);
    if (nodeState !== undefined && this.#gltf.get(nodeState.key) === nodeState) return nodeState;

    const key = gltfRequestKey(node.asset.uri, node.asset.version);
    const cached = this.#gltf.get(key);
    if (cached !== undefined) {
      this.#gltfStatesByNode.set(node, cached);
      return cached;
    }

    const state = this.#gltf.get(key);
    if (state === undefined) throw new Error(`retained glTF request ${key} has no semantic arena state`);
    this.#gltfStatesByNode.set(node, state);
    return state;
  }

  #ensureGltfState(key: string, preparedGeneration: number): GltfState {
    const existing = this.#gltf.get(key);
    if (existing !== undefined) {
      if (existing.preparedGeneration !== preparedGeneration) {
        throw new Error(
          `retained glTF request ${key} generation ${preparedGeneration} conflicts with ${existing.preparedGeneration}`,
        );
      }
      return existing;
    }
    const state: GltfState = {
      hasMaterialLod: false,
      hasMaterialVariants: false,
      hasNodeLod: false,
      instanceKey: this.#gltfStateInstanceKey,
      key,
      preparedGeneration,
      lights: [],
      load: {
        imageFailures: 0,
        imageLoaded: 0,
        imageRequests: 0,
        startedAt: nowMs(),
      },
      materials: [],
      nodeCount: 0,
      primitives: [],
      status: "loading",
      variants: [],
    };
    this.#gltfStateInstanceKey += 1;
    this.#gltf.set(key, state);
    return state;
  }

  async #prepareGltfAsset(
    src: string,
    assetKey: string,
    signal: AbortSignal,
  ): Promise<PreparedGltfAsset> {
    try {
      const asset = await this.#gltfPreparationScheduler.run(
        signal,
        () => this.#prepareGltfAssetAdmitted(src, assetKey, signal),
      );
      throwIfAborted(signal);
      return asset;
    } catch (error) {
      // The admitted job installs its final leases immediately before return.
      // Abort may win between that return and this outer boundary.
      this.#releasePreparedAssetCpuLeases(assetKey);
      throw error;
    }
  }

  #reservePreparedAssetCpuAdmission(
    assetKey: string,
    estimate: GltfPreparationCpuEstimate,
  ): PreparedAssetCpuAdmission {
    if (this.#preparedAssetCpuGovernorLeases.has(assetKey)) {
      throw new Error(`Prepared glTF asset ${assetKey} already owns CPU resource leases`);
    }
    const policy = this.#options.resourceGovernorPolicy;
    const combinedMaximum = policy.limits.cpuDecodedBytes - RESOURCE_GOVERNOR_CLASSES
      .filter((resourceClass) => resourceClass !== "geometry" && resourceClass !== "asset-decode")
      .reduce((sum, resourceClass) =>
        sum + policy.classes[resourceClass].cpuDecodedBytes.mandatoryFloor, 0);
    if (estimate.geometry + estimate.assetDecode > combinedMaximum) {
      throw new ResourceGovernorCpuCapacityError(
        `glTF asset ${assetKey} declares up to ${estimate.geometry + estimate.assetDecode} prepared CPU bytes, exceeding its combined maximum ${combinedMaximum}`,
        true,
      );
    }
    if (estimate.transientPeak > policy.limits.transientPeakBytes) {
      throw new ResourceGovernorCpuCapacityError(
        `glTF asset ${assetKey} declares up to ${estimate.transientPeak} transient preparation bytes, exceeding the maximum ${policy.limits.transientPeakBytes}`,
        true,
      );
    }
    const admission: PreparedAssetCpuAdmission = {
      assetDecode: undefined,
      geometry: undefined,
      transient: undefined,
    };
    const release = (): void => {
      admission.transient?.cancel();
      admission.transient = undefined;
      admission.assetDecode?.release();
      admission.assetDecode = undefined;
      admission.geometry?.release();
      admission.geometry = undefined;
    };
    const reserveDurable = (
      resourceClass: "asset-decode" | "geometry",
      cpuDecodedBytes: number,
    ): void => {
      if (cpuDecodedBytes === 0) return;
      const reservation = reserveResourceGovernor(this.#resourceGovernor, resourceClass, {
        cpuDecodedBytes,
      });
      if (typeof reservation === "string") {
        this.#suppressCpuCapacityWake = true;
        try {
          release();
        } finally {
          this.#suppressCpuCapacityWake = false;
        }
        throw new ResourceGovernorCpuCapacityError(
          `glTF asset ${assetKey} pre-decode CPU admission denied by root resource governor: ${reservation}`,
          cpuDecodedBytes > this.#maximumResourceClassCpuBytes(resourceClass),
        );
      }
      admission[resourceClass === "asset-decode" ? "assetDecode" : "geometry"] = reservation.commit();
    };
    try {
      // Reserving geometry first consumes its own protected floor before the
      // asset-decode class attempts to borrow the remaining shared capacity.
      reserveDurable("geometry", estimate.geometry);
      reserveDurable("asset-decode", estimate.assetDecode);
      if (estimate.transientPeak > 0) {
        const transient = reserveResourceGovernor(this.#resourceGovernor, "asset-decode", {
          transientPeakBytes: estimate.transientPeak,
        });
        if (typeof transient === "string") {
          throw new ResourceGovernorCpuCapacityError(
            `glTF asset ${assetKey} transient preparation admission denied by root resource governor: ${transient}`,
            false,
          );
        }
        admission.transient = transient;
      }
      return admission;
    } catch (error) {
      this.#suppressCpuCapacityWake = true;
      try {
        release();
      } finally {
        this.#suppressCpuCapacityWake = false;
      }
      throw error;
    }
  }

  #finalizePreparedAssetCpuAdmission(
    assetKey: string,
    estimate: GltfPreparationCpuEstimate,
    asset: PreparedGltfAsset,
    admission: PreparedAssetCpuAdmission,
  ): void {
    const actual = preparedGltfAssetRetainedCpuBytes(asset);
    if (actual.assetDecode > estimate.assetDecode || actual.geometry > estimate.geometry) {
      throw new ResourceGovernorCpuCapacityError(
        `glTF asset ${assetKey} prepared bytes exceeded its pre-decode estimate `
        + `(asset-decode ${actual.assetDecode}/${estimate.assetDecode}, geometry ${actual.geometry}/${estimate.geometry})`,
        true,
      );
    }
    let capacityReleased = false;
    const resize = (
      resourceClass: "asset-decode" | "geometry",
      lease: ResourceGovernorLease | undefined,
      cpuDecodedBytes: number,
    ): ResourceGovernorLease | undefined => {
      if (lease === undefined) {
        if (cpuDecodedBytes !== 0) {
          throw new Error(`glTF ${resourceClass} estimate omitted ${cpuDecodedBytes} retained bytes`);
        }
        return undefined;
      }
      if (cpuDecodedBytes === 0) {
        lease.release();
        capacityReleased = true;
        return undefined;
      }
      const replacement = replaceResourceGovernorLease(this.#resourceGovernor, lease, {
        cpuDecodedBytes,
      });
      if (typeof replacement === "string") {
        throw new Error(`glTF ${resourceClass} estimate shrink was denied: ${replacement}`);
      }
      const resized = replacement.commit();
      if (cpuDecodedBytes < estimate[
        resourceClass === "asset-decode" ? "assetDecode" : "geometry"
      ]) capacityReleased = true;
      return resized;
    };
    const previouslySuppressed = this.#suppressCpuCapacityWake;
    this.#suppressCpuCapacityWake = true;
    try {
      admission.geometry = resize("geometry", admission.geometry, actual.geometry);
      admission.assetDecode = resize("asset-decode", admission.assetDecode, actual.assetDecode);
      admission.transient?.cancel();
      admission.transient = undefined;
    } finally {
      this.#suppressCpuCapacityWake = previouslySuppressed;
      if (capacityReleased && !previouslySuppressed) this.#scheduleCpuCapacityWake();
    }
    this.#preparedAssetCpuGovernorLeases.set(assetKey, {
      ...(admission.assetDecode === undefined ? {} : { assetDecode: admission.assetDecode }),
      ...(admission.geometry === undefined ? {} : { geometry: admission.geometry }),
    });
  }

  #releasePreparedAssetCpuLeases(assetKey: string): void {
    const leases = this.#preparedAssetCpuGovernorLeases.get(assetKey);
    if (leases === undefined) return;
    leases.assetDecode?.release();
    leases.geometry?.release();
    this.#preparedAssetCpuGovernorLeases.delete(assetKey);
  }

  #detachPreparedAssetImagePreparation(assetKey: string, generation: number): void {
    detachResourceArenaImagePreparation(this.#resourceArena, assetKey, generation);
  }

  #releasePreparedAssetDecodeLease(assetKey: string): void {
    const leases = this.#preparedAssetCpuGovernorLeases.get(assetKey);
    leases?.assetDecode?.release();
    if (leases !== undefined) delete leases.assetDecode;
  }

  #takePreparedAssetDecodeRecipeLease(
    assetKey: string,
    initialBytes: number,
  ): GltfImageRecipeLease {
    const leases = this.#preparedAssetCpuGovernorLeases.get(assetKey);
    let lease = leases?.assetDecode;
    if (leases !== undefined) delete leases.assetDecode;
    let released = false;
    let retainedBytes = initialBytes;
    if (lease === undefined && initialBytes !== 0) {
      throw new Error(`Prepared glTF asset ${assetKey} has ${initialBytes} recipe bytes without a CPU lease`);
    }
    return {
      release: () => {
        if (released) return;
        lease?.release();
        lease = undefined;
        retainedBytes = 0;
        released = true;
      },
      resize: (nextBytes) => {
        if (!Number.isSafeInteger(nextBytes) || nextBytes < 0) {
          throw new RangeError(`glTF image recipe bytes must be a non-negative safe integer, received ${nextBytes}`);
        }
        if (released) throw new Error(`glTF image recipe lease for ${assetKey} is released`);
        if (nextBytes > retainedBytes) {
          throw new Error(
            `glTF image recipe lease for ${assetKey} cannot grow from ${retainedBytes} to ${nextBytes} bytes`,
          );
        }
        if (nextBytes === retainedBytes) return;
        if (nextBytes === 0) {
          lease?.release();
          lease = undefined;
          retainedBytes = 0;
          return;
        }
        if (lease === undefined) {
          throw new Error(`glTF image recipe lease for ${assetKey} has no ownership to resize`);
        }
        const replacement = replaceResourceGovernorLease(this.#resourceGovernor, lease, {
          cpuDecodedBytes: nextBytes,
        });
        if (typeof replacement === "string") {
          throw new Error(`glTF image recipe lease shrink for ${assetKey} was denied: ${replacement}`);
        }
        try {
          lease = replacement.commit();
          retainedBytes = nextBytes;
        } catch (error) {
          replacement.cancel();
          throw error;
        }
      },
    };
  }

  async #prepareGltfAssetAdmitted(
    src: string,
    assetKey: string,
    signal: AbortSignal,
  ): Promise<PreparedGltfAsset> {
    const load: GltfLoadMetrics = {
      imageFailures: 0,
      imageLoaded: 0,
      imageRequests: 0,
      startedAt: nowMs(),
    };
    let cpuAdmission: PreparedAssetCpuAdmission | undefined;
    try {
      const { binaryChunk, document } = await loadGltfDocument(src, signal);
      load.documentLoadedAt = nowMs();
      throwIfAborted(signal);
      assertSupportedRequiredGltfExtensions(src, document);
      throwIfAborted(signal);
      const cpuEstimate = estimateGltfPreparationCpu(document);
      cpuAdmission = this.#reservePreparedAssetCpuAdmission(assetKey, cpuEstimate);
      throwIfAborted(signal);
      const codecs = importGltfCodecs(document);
      const loadedBuffers = await loadGltfBuffers(src, document, binaryChunk, signal);
      load.buffersLoadedAt = nowMs();
      throwIfAborted(signal);
      const { buffers, document: decodedDocument } = codecs.meshopt === undefined
        ? { buffers: loadedBuffers, document }
        : await (await codecs.meshopt).decodeGltfMeshoptBufferViews(document, loadedBuffers);
      load.meshoptDecodedAt = nowMs();
      throwIfAborted(signal);
      const dracoPrimitives = codecs.draco === undefined
        ? new Map<GltfMeshPrimitive, DecodedGltfDracoPrimitive>()
        : (await codecs.draco).decodeGltfDracoPrimitives(decodedDocument, buffers);
      load.dracoDecodedAt = nowMs();
      throwIfAborted(signal);
      const scene = readGltfScene({
        assetKey,
        buffers,
        diagnostics: {
          recordDiagnostic: (message, dedupeKey) => this.#recordDiagnostic(message, dedupeKey),
        },
        document: decodedDocument,
        dracoPrimitives,
        src,
      });
      load.sceneReadAt = nowMs();
      load.readyAt = nowMs();
      const materials = preparedPrimitiveMaterials(scene.primitives);
      const imageRecipes = createGltfImageSourceRecipes(
        assetKey,
        src,
        decodedDocument,
        buffers,
        gltfImageDemandKeys(materials, scene.imageBasedLight),
        codecs.basisu,
      );
      const asset: PreparedGltfAsset = {
        hasMaterialLod: scene.hasMaterialLod,
        hasMaterialVariants: scene.hasMaterialVariants,
        hasNodeLod: scene.hasNodeLod,
        ...(scene.imageBasedLight === undefined ? {} : { imageBasedLight: scene.imageBasedLight }),
        ...(imageRecipes.length === 0 ? {} : { imagePreparation: { recipes: imageRecipes } }),
        lights: scene.lights,
        load,
        nodeCount: decodedDocument.nodes?.length ?? 0,
        primitives: scene.primitives,
        variants: scene.variants,
      };
      this.#finalizePreparedAssetCpuAdmission(assetKey, cpuEstimate, asset, cpuAdmission);
      cpuAdmission = undefined;
      return asset;
    } catch (error) {
      load.readyAt = nowMs();
      if (cpuAdmission !== undefined) {
        this.#suppressCpuCapacityWake = true;
        try {
          cpuAdmission.transient?.cancel();
          cpuAdmission.assetDecode?.release();
          cpuAdmission.geometry?.release();
        } finally {
          this.#suppressCpuCapacityWake = false;
        }
      }
      throw error;
    }
  }

  #stageReadyGltfImages(): void {
    const outcomes = this.#gltfImages.pendingReadyOutcomes();
    if (outcomes.length === 0) return;
    for (const outcome of outcomes) {
      const state = this.#gltf.get(outcome.assetKey);
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
      for (const material of outcome.materials) {
        for (const primitive of this.#gltfMaterialPrimitives.get(material) ?? []) {
          this.#gltfPreparedPrimitiveMaterials.get(primitive)?.delete(material);
        }
      }
      outcome.acknowledge();
    }
  }
  #scheduleRender(): void {
    if (
      this.#disposed ||
      this.#context.lifecycle !== "active" ||
      !this.#renderDirty ||
      this.#externalRenderClocks.size > 0 ||
      this.#scheduledRenderGeneration !== 0 ||
      this.#latestScene === undefined
    ) return;
    const requestFrame = globalThis.requestAnimationFrame;
    const generation = this.#renderScheduleGeneration + 1;
    const contextGeneration = this.#context.generation;
    this.#renderScheduleGeneration = generation;
    this.#scheduledRenderGeneration = generation;
    const renderIfCurrent = (): void => {
      if (
        this.#scheduledRenderGeneration !== generation ||
        this.#context.generation !== contextGeneration ||
        this.#context.lifecycle !== "active" ||
        !this.#renderDirty ||
        this.#externalRenderClocks.size > 0
      ) return;
      this.#scheduledRenderGeneration = 0;
      if (!this.#disposed && this.#context.lifecycle === "active" && this.#latestScene !== undefined) {
        try {
          this.#renderLatestScene();
        } catch (failure) {
          this.#notifyRenderFailure(failure);
        }
      }
    };
    if (typeof requestFrame === "function") requestFrame(renderIfCurrent);
    else queueMicrotask(renderIfCurrent);
  }

  #renderLatestScene(): void {
    const plan = this.#framePlan;
    if (plan === undefined) return;

    const { height, width } = this.#resize();
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
    return { ...this.#gltfInstancingCounters };
  }

  #gltfLoadDiagnosticsSnapshot(): WebGlGltfLoadDiagnosticsSnapshot {
    const assets = [...this.#gltf.values()].map((state): WebGlGltfLoadDiagnosticsAssetSnapshot => {
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
        key: state.key,
        lightCount: state.lights.length,
        nodeCount: state.nodeCount,
        phaseMs,
        primitiveCount: state.primitives.length,
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

    for (const state of this.#virtualTextures.values()) {
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
      const requests = this.#virtualTextureRequests.snapshot(state);
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
