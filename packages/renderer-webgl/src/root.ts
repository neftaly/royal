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
  type Camera,
  type CameraViewReadTarget,
  type CameraViewResource,
  type DirectionalLightNode,
  type PointLightNode,
  type SpotLightNode,
  type EnvironmentLight,
  type EulerRads,
  type GltfInstanceTransforms,
  type GltfInstancesNode,
  type GltfNode,
  type Material,
  type MeshNode,
  type PickInput,
  type PickResult,
  type RenderToneMapping,
  type RenderObjectHandle,
  type RenderObjectRef,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type TextureContentKey,
  type TextureRef,
  type TextureSampler,
  type Transform,
  type Vec3,
} from "@royal/renderer-core";
import {
  createRenderObjectHandle,
  readRenderObjectHandleTransform,
} from "@royal/renderer-core/render-object";
import {
  gltfComponentCount,
  readGltfFloatAccessor,
  readGltfIndices,
} from "./gltf/accessors";
import {
  abortError,
  dataUriMediaType,
  decodeDataUri,
  gltfBufferViewBytes,
  loadGltfBuffers,
  loadGltfDocument,
  resolveResourceUri,
  throwIfAborted,
} from "./gltf/io";
import { canvasSupportsImageMimeType } from "./capabilities";
import { BoundedDiagnosticLog } from "./diagnostics";
import {
  applyPreparedAssetEvents,
  applyResourceDelta,
  abortResourceArenaImageWork,
  clearResourceArenaPreparedSources,
  createResourceArena,
  detachResourceArenaImagePreparation,
  disposeResourceArena,
  finishResourceArenaImageWork,
  publishResourceArenaContentKey,
  replaceResourceArenaImageAbortController,
  releaseResourceArenaPreparedSource,
  releaseResourceArenaAssetSource,
  resourceArenaContentKeys,
  resourceArenaCountersSnapshot,
  resourceArenaHasHdrReadyAsset,
  resourceArenaHasPendingAssetEvents,
  resourceArenaIblSources,
  resourceArenaOrdinaryTextureResidencySnapshot,
  resourceArenaPreparedSource,
  resourceArenaPreparedSourceKeys,
  resourceArenaPreparedSourceValues,
  resourceArenaSourceReferenceCount,
  rekeyPreparedAssetOrdinaryTextures,
  retainResourceArenaAssetSource,
  retainResourceArenaIblSource,
  retainResourceArenaPreparedSource,
  retainResourceArenaSourceLease,
  resourceArenaTextureReferenceCount,
  type PreparedAssetDependencyManifest,
  type PreparedAssetOrdinaryTextureRekey,
  type PreparedTextureSource,
  type ResourceArena,
  type ResourceArenaChanges,
} from "./resource-arena";
import {
  OrdinaryTextureSourceStore,
  type OrdinaryTextureSourceSubscription,
} from "./ordinary-texture-source-store";
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
  createOwnedTexture,
  createTextureHandleArena,
  dropTextureHandleContext,
  ownsTexture,
  releaseOwnedTexture,
  releaseTextureHandleContextHandles,
  type TextureHandleArena,
} from "./webgl/texture-handle-arena";
import {
  consumeOrdinaryTextureGpuWake,
  clearOrdinaryTextureGpuOutcomes,
  createOrdinaryTextureGpuArena,
  discardOrdinaryTexturePendingUpload,
  dropOrdinaryTextureGpuContext,
  ensureOrdinaryTextureGpuResource,
  ordinaryTextureGpuHasPendingUploads,
  ordinaryTextureGpuOutcome,
  ordinaryTextureGpuOutcomeCount,
  ordinaryTextureGpuPendingUpload,
  ordinaryTextureGpuResource,
  ordinaryTextureGpuResourceCount,
  processOrdinaryTextureUploads,
  queueOrdinaryTextureUpload,
  releaseOrdinaryTextureGpuResource,
  type OrdinaryTextureGpuArena,
  type OrdinaryTextureGpuResource,
} from "./webgl/ordinary-texture-gpu-arena";
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
import { rendererFrameViews } from "./webgl/frame-view-lane";
import type { DecodedGltfDracoPrimitive } from "./gltf/codecs/draco";
import { gltfCodecDemand } from "./gltf/codecs/demand";
import { assertSupportedRequiredGltfExtensions } from "./gltf/extensions";
import { GltfInstanceChangeTracker } from "./gltf/instance-changes";
import { readGltfSceneImageBasedLight } from "./gltf/image-based-light";
import { gltfImageLoadKey, type GltfImageKind } from "./gltf/image-keys";
import { generateGltfPrimitiveNormals } from "./gltf/normals";
import {
  type GltfContentExtras,
  type GltfDocument,
  type GltfImage,
  type GltfLodExtras,
  type GltfMaterial,
  type GltfMeshPrimitive,
  type GltfPunctualLight,
  type GltfSampler,
  type GltfSceneNode,
  type GltfTexture,
  type GltfTextureInfo,
} from "./gltf/schema";
import {
  gltfTextureCoordinates,
  IDENTITY_GLTF_TEXTURE_COORDINATES,
  type GltfTextureCoordinates,
} from "./gltf/texture-coordinates";
import {
  gltfInstanceTransformMat4,
  gltfInstancingAttributeCount,
  gltfNodeMat4,
} from "./gltf/transforms";
import {
  type GltfGeometryDrawMode,
  type GltfLoadMetrics,
  type GltfMaterialPrimitiveLod,
  type GltfNodePrimitiveLod,
  type LoadedGltfMaterial,
  type LoadedGltfMaterialExtensionTextures,
  type LoadedGltfMaterialTextureSlot,
  type LoadedGltfMaterialVariant,
  type LoadedGltfPrimitive,
  type LoadedGltfPrimitiveMaterial,
  type PreparedGltfAsset,
} from "./gltf/prepared-asset";
import { GltfPreparationScheduler } from "./gltf/preparation-scheduler";
import {
  beginSharedViewLodSelections,
  createSharedViewLodSelections,
  finalizeSharedViewLodSelection,
  finalizeUnobservedSharedViewLodFallback,
  observeSharedViewLodCoverage,
  reserveSharedViewLodSelections,
  sharedViewLodSelectedLevel,
  sharedViewLodWasObserved,
  validateSharedViewLodMetadata,
  type SharedViewLodMetadata,
  type SharedViewLodSelections,
} from "./gltf/shared-view-lod-selection";
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
  inverseMat4Into,
  multiplyMat4,
  multiplyMat4Into,
  projectionMat4Into,
  transformDirection,
  transformMat4,
  transformMat4Into,
  transformPoint,
  viewMat4Into,
  type Mat4,
  type MutableMat4,
} from "./math/mat4";
import {
  createRayGeometryScratch,
  isBoundsVisible,
  pointOnRay,
  rayAabbDistanceScalars,
  rayGeometryDistanceWithScratch,
  transformBoundsInto,
  worldBounds,
  type Bounds3,
  type MutableBounds3,
  type Ray,
  type RayGeometryScratch,
  type RayGeometryMode,
} from "./math/picking";
import {
  isDecodedRgbaTexture,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "./texture-sources";
import {
  generatedSvgVirtualTextureManifest,
  isSvgMimeType,
  isSvgUri,
  loadGeneratedSvgVirtualTexturePageImage,
  loadGltfSvgTexture,
  loadSvgTextureFromUri,
  svgVirtualTextureSourceForImage,
} from "./svg-texture";
import {
  encodeVirtualTexturePageTableRgba8,
  generatedVirtualTexturePageCount,
  parseVirtualTextureManifest,
  VirtualTextureAtlasPageTable,
  virtualTextureExplicitPageUrisByKey,
  virtualTexturePageKey,
  virtualTexturePageUri,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
  type VirtualTexturePageTableUpdate,
} from "./virtual-texturing";
import {
  GENERATED_RASTER_VIRTUAL_TEXTURE_MIN_DIMENSION,
  VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW,
  VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS,
  VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME,
  VIRTUAL_TEXTURE_MAX_PAGE_UPLOADS_PER_FRAME,
  autoVirtualTexturePlan,
  generatedRasterVirtualTextureManifest,
  generatedRasterVirtualTexturePageImage,
  normalizeVirtualTextureDemandUvRange,
  virtualTextureDemandPageDistance,
  virtualTextureNow,
  type AutoVirtualTexturePlan,
  type BaseColorTextureResidency,
  type VirtualTextureFallbackTrigger,
  type VirtualTextureDrawDemand,
  type VirtualTextureDrawDemandContext,
  type VirtualTextureDrawDemandModelSource,
  type VirtualTextureGeneratedPageSource,
  type VirtualTextureManifestSource,
  type VirtualTextureRef,
  type VirtualTextureResourceSet,
  type VirtualTextureRuntimeState,
  type VirtualTextureScreenFootprint,
  type ViewportSize,
} from "./virtual-texture-runtime";
import {
  DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS,
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
  type SurfaceMaterialAlphaMode,
  type SurfaceMaterialExtensionFactors,
  type SurfaceMaterialTextureCoordinates,
  type TextureAssetUploadRef,
} from "./webgl/materials";
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
import { rendererOwnedWebGl2Context } from "./webgl/context-lane";
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
  createIblTextureArena,
  dropIblTextureContext,
  ensureGltfIblSpecularTexture,
  ensureStudioEnvironmentSpecularTexture,
  IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT,
  IBL_SPECULAR_TEXTURE_UNIT,
  markGltfIblSpecularTextureDirty,
  releaseGltfIblSpecularTexture,
  releaseIblTextureContextHandles,
  type IblSpecularTextureResource,
  type IblTextureArena,
  type StudioEnvironmentSpecularResource,
} from "./webgl/ibl-texture-arena";
import { prepareFrameBaseline, prepareTextureUpload } from "./webgl/imperative-state";
import {
  textureUploadInternalFormat,
} from "./webgl/texture-upload";
import {
  STUDIO_ENVIRONMENT_IRRADIANCE,
} from "./webgl/studio-environment";
import type {
  NormalizedWebGlRootOptions,
  WebGlContextLifecycle,
  WebGlContextSnapshot,
  WebGlGltfInstancingSnapshot,
  WebGlGltfLoadDiagnosticsAssetSnapshot,
  WebGlGltfLoadDiagnosticsPhaseKey,
  WebGlGltfLoadDiagnosticsSnapshot,
  WebGlPickingSnapshot,
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

type PickCandidate = PickResult & {
  readonly drawOrdinal: number;
};

type PickScratchCandidate = {
  readonly bounds: MutableBounds3;
  boundsDistance: number;
  instanceIndex: number;
  localModel?: Mat4;
  ordinal: number;
  outerIndex: number;
  primitive?: LoadedGltfPrimitive;
  rootModel?: Mat4;
};

type GeometryDrawMode = GltfGeometryDrawMode;

type GeometryResource = VertexInputGeometry;

type TextureUnitAllocator = {
  readonly reserveClusterUnits: boolean;
  readonly used: Set<number>;
};

type SurfaceBaseColorTextureBinding =
  | { readonly kind: "none" }
  | { readonly kind: "ordinary"; readonly texture: TextureAssetUploadRef }
  | { readonly kind: "prepared-virtual"; readonly state: VirtualTextureRuntimeState };

type SurfaceTextureBindingPlan = {
  readonly baseColor: SurfaceBaseColorTextureBinding;
  readonly features: SurfaceShaderFeatures;
  readonly textureUnits: ReadonlyMap<SurfaceShaderTextureFeature, number>;
};

type LoadedGltfImageSource = {
  readonly contentKey?: TextureContentKey;
  readonly image: LoadedTextureSource;
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

const loadedGltfImageSource = (
  image: LoadedTextureSource,
  contentKey: TextureContentKey | undefined,
): LoadedGltfImageSource => ({
  ...(contentKey === undefined ? {} : { contentKey }),
  image,
});

const closeLoadedTextureSource = (source: LoadedTextureSource): void => {
  const ImageBitmapConstructor = globalThis.ImageBitmap;
  if (typeof ImageBitmapConstructor === "function" && source instanceof ImageBitmapConstructor) source.close();
};

const closeTexImageSource = (source: TexImageSource): void => {
  const ImageBitmapConstructor = globalThis.ImageBitmap;
  if (typeof ImageBitmapConstructor === "function" && source instanceof ImageBitmapConstructor) source.close();
};

const loadedGltfPrimitiveBaseMaterial = (
  material: LoadedGltfMaterial,
  materialLod: GltfMaterialPrimitiveLod | undefined,
): LoadedGltfPrimitiveMaterial => ({
  material,
  ...(materialLod === undefined ? {} : { materialLod }),
  selectionKey: "base",
});

type DrawSidedness = {
  readonly doubleSided: boolean;
  readonly frontFaceCcw: boolean;
};

type GltfTextureImageSelection = {
  readonly imageIndex: number;
  readonly kind: GltfImageKind;
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
type GltfMaterialExtensionTextureKey =
  & keyof LoadedGltfMaterialExtensionTextures
  & keyof LoadedGltfSurfaceTextures;

type GltfMaterialExtensionTextureDefinition = {
  readonly colorSpace: TextureColorSpace;
  readonly key: GltfMaterialExtensionTextureKey;
  readonly textureInfo: (material: GltfMaterial | undefined) => GltfTextureInfo | undefined;
};

const GLTF_MATERIAL_EXTENSION_TEXTURES = [
  {
    colorSpace: "linear",
    key: "clearcoatRoughnessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_clearcoat?.clearcoatRoughnessTexture,
  },
  {
    colorSpace: "linear",
    key: "clearcoatTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_clearcoat?.clearcoatTexture,
  },
  {
    colorSpace: "linear",
    key: "iridescenceTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_iridescence?.iridescenceTexture,
  },
  {
    colorSpace: "linear",
    key: "iridescenceThicknessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_iridescence?.iridescenceThicknessTexture,
  },
  {
    colorSpace: "linear",
    key: "materialTransmissionTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_transmission?.transmissionTexture,
  },
  {
    colorSpace: "srgb",
    key: "sheenColorTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_sheen?.sheenColorTexture,
  },
  {
    colorSpace: "linear",
    key: "sheenRoughnessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_sheen?.sheenRoughnessTexture,
  },
  {
    colorSpace: "srgb",
    key: "specularColorTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_specular?.specularColorTexture,
  },
  {
    colorSpace: "linear",
    key: "specularTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_specular?.specularTexture,
  },
  {
    colorSpace: "linear",
    key: "thicknessTexture",
    textureInfo: (material) => material?.extensions?.KHR_materials_volume?.thicknessTexture,
  },
] as const satisfies readonly GltfMaterialExtensionTextureDefinition[];

type GltfMaterialExtensionTextureBinding = {
  readonly key: GltfMaterialExtensionTextureKey;
  readonly samplerUniform: string;
  readonly textureUnit: number;
  readonly useUniform: string;
};

// Units 0-5 are reserved by base color, transmission screen, IBL, and core material maps.
// Keeping extension maps at 6-15 stays within WebGL2's guaranteed 16 fragment samplers.
// The optional BRDF LUT uses the same per-draw allocator and binds only when a unit is free.
const GLTF_MATERIAL_EXTENSION_TEXTURE_BINDINGS = [
  {
    key: "specularTexture",
    samplerUniform: "u_specularTexture",
    textureUnit: 6,
    useUniform: "u_useSpecularTexture",
  },
  {
    key: "specularColorTexture",
    samplerUniform: "u_specularColorTexture",
    textureUnit: 7,
    useUniform: "u_useSpecularColorTexture",
  },
  {
    key: "clearcoatTexture",
    samplerUniform: "u_clearcoatTexture",
    textureUnit: 8,
    useUniform: "u_useClearcoatTexture",
  },
  {
    key: "clearcoatRoughnessTexture",
    samplerUniform: "u_clearcoatRoughnessTexture",
    textureUnit: 9,
    useUniform: "u_useClearcoatRoughnessTexture",
  },
  {
    key: "sheenColorTexture",
    samplerUniform: "u_sheenColorTexture",
    textureUnit: 10,
    useUniform: "u_useSheenColorTexture",
  },
  {
    key: "sheenRoughnessTexture",
    samplerUniform: "u_sheenRoughnessTexture",
    textureUnit: 11,
    useUniform: "u_useSheenRoughnessTexture",
  },
  {
    key: "iridescenceTexture",
    samplerUniform: "u_iridescenceTexture",
    textureUnit: 12,
    useUniform: "u_useIridescenceTexture",
  },
  {
    key: "iridescenceThicknessTexture",
    samplerUniform: "u_iridescenceThicknessTexture",
    textureUnit: 13,
    useUniform: "u_useIridescenceThicknessTexture",
  },
  {
    key: "materialTransmissionTexture",
    samplerUniform: "u_materialTransmissionTexture",
    textureUnit: 14,
    useUniform: "u_useMaterialTransmissionTexture",
  },
  {
    key: "thicknessTexture",
    samplerUniform: "u_thicknessTexture",
    textureUnit: 15,
    useUniform: "u_useThicknessTexture",
  },
] as const satisfies readonly GltfMaterialExtensionTextureBinding[];

const SURFACE_SHADER_FEATURE_BY_EXTENSION_TEXTURE_KEY: Record<
  GltfMaterialExtensionTextureKey,
  SurfaceShaderTextureFeature
> = {
  clearcoatRoughnessTexture: "clearcoatRoughnessTexture",
  clearcoatTexture: "clearcoatTexture",
  iridescenceTexture: "iridescenceTexture",
  iridescenceThicknessTexture: "iridescenceThicknessTexture",
  materialTransmissionTexture: "materialTransmissionTexture",
  sheenColorTexture: "sheenColorTexture",
  sheenRoughnessTexture: "sheenRoughnessTexture",
  specularColorTexture: "specularColorTexture",
  specularTexture: "specularTexture",
  thicknessTexture: "thicknessTexture",
};

const SURFACE_TEXTURE_COORDINATE_BINDINGS = [
  ["baseColorTexture", "baseColorTexture", "u_baseColorUvSet", "u_baseColorUvRow0", "u_baseColorUvRow1"],
  ["emissiveTexture", "emissiveTexture", "u_emissiveUvSet", "u_emissiveUvRow0", "u_emissiveUvRow1"],
  ["metallicRoughnessTexture", "metallicRoughnessTexture", "u_metallicRoughnessUvSet", "u_metallicRoughnessUvRow0", "u_metallicRoughnessUvRow1"],
  ["normalTexture", "normalTexture", "u_normalUvSet", "u_normalUvRow0", "u_normalUvRow1"],
  ["occlusionTexture", "occlusionTexture", "u_occlusionUvSet", "u_occlusionUvRow0", "u_occlusionUvRow1"],
  ["specularTexture", "specularTexture", "u_specularUvSet", "u_specularUvRow0", "u_specularUvRow1"],
  ["specularColorTexture", "specularColorTexture", "u_specularColorUvSet", "u_specularColorUvRow0", "u_specularColorUvRow1"],
  ["clearcoatTexture", "clearcoatTexture", "u_clearcoatUvSet", "u_clearcoatUvRow0", "u_clearcoatUvRow1"],
  ["clearcoatRoughnessTexture", "clearcoatRoughnessTexture", "u_clearcoatRoughnessUvSet", "u_clearcoatRoughnessUvRow0", "u_clearcoatRoughnessUvRow1"],
  ["sheenColorTexture", "sheenColorTexture", "u_sheenColorUvSet", "u_sheenColorUvRow0", "u_sheenColorUvRow1"],
  ["sheenRoughnessTexture", "sheenRoughnessTexture", "u_sheenRoughnessUvSet", "u_sheenRoughnessUvRow0", "u_sheenRoughnessUvRow1"],
  ["iridescenceTexture", "iridescenceTexture", "u_iridescenceUvSet", "u_iridescenceUvRow0", "u_iridescenceUvRow1"],
  ["iridescenceThicknessTexture", "iridescenceThicknessTexture", "u_iridescenceThicknessUvSet", "u_iridescenceThicknessUvRow0", "u_iridescenceThicknessUvRow1"],
  ["materialTransmissionTexture", "materialTransmissionTexture", "u_materialTransmissionUvSet", "u_materialTransmissionUvRow0", "u_materialTransmissionUvRow1"],
  ["thicknessTexture", "thicknessTexture", "u_thicknessUvSet", "u_thicknessUvRow0", "u_thicknessUvRow1"],
] as const satisfies readonly (readonly [
  SurfaceShaderTextureFeature,
  keyof SurfaceMaterialTextureCoordinates,
  string, string, string,
])[];

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
  readonly imageRows: Map<string, GltfImageRow>;
  readonly instanceKey: number;
  readonly key: string;
  error?: string;
  lights: readonly SurfaceLight[];
  readonly load: GltfLoadMetrics;
  materials: readonly LoadedGltfMaterial[];
  nodeCount: number;
  primitives: readonly LoadedGltfPrimitive[];
  status: "loading" | "ready" | "error";
  variants: readonly string[];
};

const preparedAssetMaterials = (asset: PreparedGltfAsset): readonly LoadedGltfMaterial[] => {
  const materials = new Set<LoadedGltfMaterial>();
  for (const primitive of asset.primitives) {
    materials.add(primitive.material);
    for (const material of primitive.materialLod?.levels ?? []) materials.add(material);
    for (const variant of primitive.materialVariants ?? []) {
      materials.add(variant.material);
      for (const material of variant.materialLod?.levels ?? []) materials.add(material);
    }
  }
  return [...materials];
};

type GltfImageTextureBinding = {
  readonly baseColor: boolean;
  readonly colorSpace: TextureColorSpace;
  readonly contentKey?: TextureContentKey;
  readonly count: number;
  readonly material: LoadedGltfMaterial;
  readonly sampler?: TextureSampler;
  readonly sourceUri?: string;
  readonly textureUri: string;
};

type GltfImageRow = {
  readonly assetKey: string;
  readonly bindings: GltfImageTextureBinding[];
  contentKey?: TextureContentKey;
  error?: string;
  iblSpecular?: SurfaceImageBasedLightSpecular;
  readonly key: string;
  readonly materials: Set<LoadedGltfMaterial>;
  readonly stateInstanceKey: number;
  queued: boolean;
  revision: number;
  source?: LoadedTextureSource;
  status: "error" | "pending" | "ready";
};

// Fetch and decode are currently one job. Reserve one lane for environment
// lighting so a slow ordinary image cannot consume both A10/Quest-class lanes.
const GLTF_IMAGE_LANE_CONCURRENCY = 1;

type AnyGltfNode = GltfNode | GltfInstancesNode;

type GltfInstanceTransformViews = {
  activeApplied: boolean;
  readonly changes: GltfInstanceChangeTracker;
  framePoseVersion: number;
  frameScaleVersion: number;
  matrixPoseVersion: number;
  matrixScaleVersion: number;
  readonly rootModels: MutableMat4[];
  readonly source: GltfInstanceTransforms;
  readonly sourceKey: number;
  readonly transforms: Transform[];
};

type GltfInstanceTransformSubscription = {
  readonly unsubscribe: () => void;
  readonly views: GltfInstanceTransformViews;
};

type CameraViewResourceSubscription = {
  readonly resource: CameraViewResource;
  readonly unsubscribe: () => void;
};

type GltfPacketMaterialBinding = {
  readonly material: SurfaceMaterial;
};

type GltfPacketRootBinding = {
  readonly rootModel: Mat4;
  readonly rootInstanceViews?: GltfInstanceTransformViews;
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
  readonly rootInstanceViews: Array<GltfInstanceTransformViews | undefined>;
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

const FNV_1A_32_OFFSET = 0x811c9dc5;
const FNV_1A_32_PRIME = 0x01000193;
const DJB2_XOR_OFFSET = 5381;
const textureTextEncoder = new TextEncoder();

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

const hex32 = (value: number): string =>
  value.toString(16).padStart(8, "0");

const hashTextureBytes = (bytes: Uint8Array): string => {
  let fnv = FNV_1A_32_OFFSET;
  let djb = DJB2_XOR_OFFSET;
  for (const byte of bytes) {
    fnv ^= byte;
    fnv = Math.imul(fnv, FNV_1A_32_PRIME) >>> 0;
    djb = Math.imul(djb, 33) ^ byte;
    djb >>>= 0;
  }

  return `${hex32(fnv)}${hex32(djb)}`;
};

const byteContentKey = (bytes: ArrayBuffer, kind: string): TextureContentKey =>
  `royal-auto-bytes-v1:${kind}:${bytes.byteLength}:${hashTextureBytes(new Uint8Array(bytes))}`;

const svgTextContentKey = (svgText: string): TextureContentKey =>
  byteContentKey(textureTextEncoder.encode(svgText).buffer, "image/svg+xml;prepared");

type TransformableRenderNode = GltfNode | MeshNode;

type RenderObjectBinding = {
  attached: boolean;
  declarativeTransform: Transform;
  readonly handle: RenderObjectHandle;
  readonly invalidation: { suppress: boolean } | undefined;
  node: TransformableRenderNode;
};

const cloneEulerRads = (value: EulerRads): EulerRads => [value[0], value[1], value[2]];
const cloneVec3 = (value: Vec3): Vec3 => [value[0], value[1], value[2]];

const resolvedTransform = (transform: Transform | undefined): Transform => ({
  position: cloneVec3(transform?.position ?? IDENTITY_TRANSFORM.position),
  rotation: cloneEulerRads(transform?.rotation ?? IDENTITY_TRANSFORM.rotation),
  scale: cloneVec3(transform?.scale ?? IDENTITY_TRANSFORM.scale),
});

const sameVec3 = (left: Vec3, right: Vec3): boolean =>
  Object.is(left[0], right[0]) &&
  Object.is(left[1], right[1]) &&
  Object.is(left[2], right[2]);

const sameTransform = (left: Transform, right: Transform): boolean =>
  sameVec3(left.position, right.position) &&
  sameVec3(left.rotation, right.rotation) &&
  sameVec3(left.scale, right.scale);

const captureFirstError = (firstError: unknown, action: () => void): unknown => {
  try {
    action();
  } catch (error) {
    return firstError ?? error;
  }
  return firstError;
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

const assignRenderObjectRef = (
  ref: RenderObjectRef,
  handle: RenderObjectHandle | null,
): void => {
  if (typeof ref === "function") {
    ref(handle);
    return;
  }

  ref.current = handle;
};

const normalizeOptions = (options: WebGlRootOptions = {}): NormalizedWebGlRootOptions => {
  return {
    alpha: options.alpha ?? true,
    antialias: options.antialias ?? true,
    generatedRasterVirtualTextures: options.generatedRasterVirtualTextures ?? false,
  };
};

const gltfSamplerMagFilter = (value: number | undefined): NonNullable<TextureSampler["magFilter"]> => {
  switch (value) {
    case 9728:
      return "nearest";
    case 9729:
    default:
      return "linear";
  }
};

const gltfSamplerMinFilter = (value: number | undefined): NonNullable<TextureSampler["minFilter"]> => {
  switch (value) {
    case 9728:
      return "nearest";
    case 9729:
      return "linear";
    case 9984:
      return "nearest-mipmap-nearest";
    case 9985:
      return "linear-mipmap-nearest";
    case 9986:
      return "nearest-mipmap-linear";
    case 9987:
    default:
      return "linear-mipmap-linear";
  }
};

const gltfSamplerWrap = (value: number | undefined): NonNullable<TextureSampler["wrapS"]> => {
  switch (value) {
    case 33071:
      return "clamp-to-edge";
    case 33648:
      return "mirrored-repeat";
    case 10497:
    default:
      return "repeat";
  }
};

const gltfTextureSampler = (sampler: GltfSampler | undefined): TextureSampler => ({
  magFilter: gltfSamplerMagFilter(sampler?.magFilter),
  minFilter: gltfSamplerMinFilter(sampler?.minFilter),
  wrapS: gltfSamplerWrap(sampler?.wrapS),
  wrapT: gltfSamplerWrap(sampler?.wrapT),
});

const gltfTextureIdentity = (
  assetKey: string,
  src: string,
  textureIndex: number,
  imageIndex: number | undefined,
  image: GltfImage,
  kind: GltfImageKind,
): string => {
  if (image.uri !== undefined) {
    const prefix = kind === "basisu" ? "basisu-uri" : kind === "svg" ? "svg-uri" : "image-uri";
    return `${assetKey}:${prefix}:${resolveResourceUri(src, image.uri)}`;
  }
  if (image.bufferView !== undefined) {
    const prefix = kind === "basisu" ? "basisu-buffer-view" : kind === "svg" ? "svg-buffer-view" : "image-buffer-view";
    return `${assetKey}:${prefix}:${image.bufferView}:${image.mimeType ?? ""}`;
  }

  return `${assetKey}:texture-index:${textureIndex}:image-index:${imageIndex ?? ""}`;
};

const gltfContentKeyFromExtras = (extras: GltfContentExtras | undefined): TextureContentKey | undefined => {
  const contentKey = extras?.contentKey;
  return typeof contentKey === "number" || typeof contentKey === "string" ? contentKey : undefined;
};

const gltfTextureContentKey = (
  texture: GltfTexture | undefined,
  image: GltfImage | undefined,
): TextureContentKey | undefined =>
  gltfContentKeyFromExtras(texture?.extras) ?? gltfContentKeyFromExtras(image?.extras);

const gltfImageSourceUri = (src: string, image: GltfImage | undefined): string | undefined =>
  image?.uri === undefined ? undefined : resolveResourceUri(src, image.uri);

const gltfImageLooksSvg = (image: GltfImage | undefined): boolean => {
  if (image === undefined) return false;
  if (isSvgMimeType(image.mimeType)) return true;
  if (image.uri === undefined) return false;
  return isSvgUri(image.uri);
};

const gltfTextureImageSelection = (
  texture: GltfTexture | undefined,
  images: readonly GltfImage[] | undefined,
): GltfTextureImageSelection | undefined => {
  const svgSource = texture?.extensions?.GS_texture_svg?.source;
  if (svgSource !== undefined) return { imageIndex: svgSource, kind: "svg" };

  const basisuSource = texture?.extensions?.KHR_texture_basisu?.source;
  if (basisuSource !== undefined) return { imageIndex: basisuSource, kind: "basisu" };

  const webpSource = texture?.extensions?.EXT_texture_webp?.source;
  const imageIndex = webpSource !== undefined && canvasSupportsImageMimeType("image/webp")
    ? webpSource
    : texture?.source;
  return imageIndex === undefined
    ? undefined
    : { imageIndex, kind: gltfImageLooksSvg(images?.[imageIndex]) ? "svg" : "image" };
};

const gltfMaterialTextureSlot = (
  document: GltfDocument,
  assetKey: string,
  src: string,
  textureInfo: GltfTextureInfo | undefined,
): LoadedGltfMaterialTextureSlot | undefined => {
  if (textureInfo === undefined) return undefined;
  const textureIndex = textureInfo?.index;
  const texture = textureIndex === undefined ? undefined : document.textures?.[textureIndex];
  const imageSelection = gltfTextureImageSelection(texture, document.images);
  const imageIndex = imageSelection?.imageIndex;
  const imageKind = imageSelection?.kind ?? "image";
  const image = imageIndex === undefined ? undefined : document.images?.[imageIndex];
  const imageUri = image === undefined
    ? undefined
    : gltfImageLoadKey(assetKey, src, imageIndex, image, imageKind);
  const sampler = texture === undefined
    ? undefined
    : gltfTextureSampler(texture.sampler === undefined ? undefined : document.samplers?.[texture.sampler]);
  const textureUri = textureIndex === undefined || image === undefined
    ? undefined
    : gltfTextureIdentity(assetKey, src, textureIndex, imageIndex, image, imageKind);
  const contentKey = gltfTextureContentKey(texture, image);
  const sourceUri = gltfImageSourceUri(src, image);

  if (
    contentKey === undefined
    && imageUri === undefined
    && sampler === undefined
    && sourceUri === undefined
    && textureUri === undefined
  ) return undefined;

  return {
    ...(contentKey === undefined ? {} : { contentKey }),
    ...(imageUri === undefined ? {} : { imageUri }),
    ...(sampler === undefined ? {} : { sampler }),
    ...(sourceUri === undefined ? {} : { sourceUri }),
    ...(textureUri === undefined ? {} : { textureUri }),
    coordinates: gltfTextureCoordinates(textureInfo),
  };
};

const gltfMaterialExtensionTextureSlots = (
  document: GltfDocument,
  assetKey: string,
  src: string,
  material: GltfMaterial | undefined,
): LoadedGltfMaterialExtensionTextures | undefined => {
  const slots: Partial<Record<keyof LoadedGltfMaterialExtensionTextures, LoadedGltfMaterialTextureSlot>> = {};
  for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
    const slot = gltfMaterialTextureSlot(document, assetKey, src, texture.textureInfo(material));
    if (slot !== undefined) slots[texture.key] = slot;
  }

  return Object.keys(slots).length === 0 ? undefined : slots;
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
    closeLoadedTextureSource(image);
    reject(abortError());
  };
  const onLoad = (): void => {
    const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve();
    decoded.then(() => {
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

const loadImageBitmapFromBytes = (
  bytes: ArrayBuffer,
  mimeType: string | undefined,
  signal?: AbortSignal,
): Promise<ImageBitmap> => {
  const createBitmap = globalThis.createImageBitmap;
  if (typeof createBitmap !== "function") {
    return Promise.reject(new Error("ImageBitmap decoding is unavailable for glTF bufferView image"));
  }
  const blob = new Blob([bytes], {
    type: mimeType ?? "application/octet-stream",
  });

  return createBitmap(blob).then((bitmap) => {
    if (signal?.aborted !== true) return bitmap;
    bitmap.close();
    throw abortError();
  });
};

const loadBasisuBytesFromUri = async (
  src: string,
  image: GltfImage,
  signal?: AbortSignal,
): Promise<ArrayBuffer> => {
  if (image.uri === undefined) throw new Error("glTF KHR_texture_basisu image has no URI");
  if (image.uri.startsWith("data:")) return decodeDataUri(image.uri);

  const url = resolveResourceUri(src, image.uri);
  throwIfAborted(signal);
  const response = await fetch(url, signal === undefined ? undefined : { signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  return response.arrayBuffer();
};

const loadGltfImageSource = (
  src: string,
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  image: GltfImage,
  kind: GltfImageKind,
  basisuCodec: Promise<GltfBasisuCodecModule> | undefined,
  signal?: AbortSignal,
): Promise<LoadedGltfImageSource> => {
  if (kind === "svg") {
    return loadGltfSvgTexture(src, document, buffers, image, signal)
      .then((loadedImage) => loadedGltfImageSource(
        loadedImage.image,
        svgTextContentKey(loadedImage.text),
      )).then((loadedImage) => {
        if (signal?.aborted !== true) return loadedImage;
        closeLoadedTextureSource(loadedImage.image);
        throw abortError();
      });
  }

  if (kind === "basisu") {
    if (basisuCodec === undefined) {
      return Promise.reject(new Error("glTF KHR_texture_basisu decoder was not requested"));
    }
    const bytes = image.uri === undefined
      ? image.bufferView === undefined
        ? Promise.reject(new Error("glTF KHR_texture_basisu image has no URI or bufferView"))
        : Promise.resolve(gltfBufferViewBytes(document, buffers, image.bufferView))
      : loadBasisuBytesFromUri(src, image, signal);

    return Promise.all([bytes, basisuCodec]).then(async ([buffer, codec]) =>
      loadedGltfImageSource(
        await codec.decodeGltfBasisuRgba(buffer, image.uri ?? `bufferView ${image.bufferView ?? ""}`),
        byteContentKey(buffer, "KHR_texture_basisu"),
      ));
  }

  if (image.uri !== undefined) {
    if (image.uri.startsWith("data:")) {
      const bytes = decodeDataUri(image.uri);
      const contentKey = byteContentKey(
        bytes,
        (image.mimeType ?? dataUriMediaType(image.uri)) || "application/octet-stream",
      );
      return loadImageBitmapFromBytes(bytes, image.mimeType, signal)
        .then((loadedImage) => loadedGltfImageSource(loadedImage, contentKey));
    }

    return loadImage(resolveResourceUri(src, image.uri), signal).then((loadedImage) => ({ image: loadedImage }));
  }
  if (image.bufferView === undefined) return Promise.reject(new Error("glTF image has no URI or bufferView"));

  const bytes = gltfBufferViewBytes(document, buffers, image.bufferView);
  const contentKey = byteContentKey(bytes, image.mimeType ?? "application/octet-stream");
  return loadImageBitmapFromBytes(bytes, image.mimeType, signal)
    .then((loadedImage) => loadedGltfImageSource(loadedImage, contentKey));
};

const getNodeKind = (node: RenderNode): string =>
  typeof node === "object" && node !== null && "kind" in node && typeof node.kind === "string"
    ? node.kind
    : "unknown";

const gltfColor = (values: readonly number[] | undefined): Rgba | undefined => {
  if (values === undefined || values.length < 3) return undefined;

  return [
    values[0] ?? 1,
    values[1] ?? 1,
    values[2] ?? 1,
    values[3] ?? 1,
  ];
};

const finiteNumber = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const positiveFiniteNumber = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const clampedFiniteNumber = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number =>
  Math.min(max, Math.max(min, finiteNumber(value, fallback)));

const nonNegativeFiniteNumber = (value: number | undefined, fallback: number): number =>
  Math.max(0, finiteNumber(value, fallback));

const nowMs = (): number => globalThis.performance?.now?.() ?? Date.now();

const elapsedMs = (start: number | undefined, end: number | undefined): number | undefined =>
  start === undefined || end === undefined ? undefined : Math.max(0, end - start);

const gltfMetallicRoughnessFactor = (value: number | undefined, fallback: number): number =>
  clampedFiniteNumber(value, fallback, 0, 1);

const gltfOcclusionStrength = (value: number | undefined): number =>
  clampedFiniteNumber(value, 1, 0, 1);

const gltfMaterialAlphaMode = (mode: unknown): SurfaceMaterialAlphaMode => {
  switch (mode) {
    case "MASK":
      return "MASK";
    case "BLEND":
      return "BLEND";
    default:
      return "OPAQUE";
  }
};

const gltfMaterialAlphaCutoff = (value: number | undefined): number =>
  finiteNumber(value, 0.5);

const gltfIor = (value: number | undefined): number => {
  if (value === 0) return 0;
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) return value;

  return DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.ior;
};

const gltfIridescenceIor = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1
    ? value
    : DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.iridescenceIor;

const gltfSpecularColorFactor = (values: readonly number[] | undefined): Vec3 => [
  nonNegativeFiniteNumber(values?.[0], 1),
  nonNegativeFiniteNumber(values?.[1], 1),
  nonNegativeFiniteNumber(values?.[2], 1),
];

const gltfSheenColorFactor = (values: readonly number[] | undefined): Vec3 => [
  clampedFiniteNumber(values?.[0], 0, 0, 1),
  clampedFiniteNumber(values?.[1], 0, 0, 1),
  clampedFiniteNumber(values?.[2], 0, 0, 1),
];

const gltfDiffuseTransmissionColorFactor = (values: readonly number[] | undefined): Vec3 => [
  clampedFiniteNumber(values?.[0], 1, 0, 1),
  clampedFiniteNumber(values?.[1], 1, 0, 1),
  clampedFiniteNumber(values?.[2], 1, 0, 1),
];

const gltfAttenuationColor = (values: readonly number[] | undefined): Vec3 => [
  nonNegativeFiniteNumber(values?.[0], 1),
  nonNegativeFiniteNumber(values?.[1], 1),
  nonNegativeFiniteNumber(values?.[2], 1),
];

const gltfAttenuationDistance = (value: number | undefined): number =>
  positiveFiniteNumber(value) ?? DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.attenuationDistance;

const readGltfMaterialExtensionFactors = (
  material: GltfMaterial | undefined,
): SurfaceMaterialExtensionFactors | undefined => {
  const extensions = material?.extensions;
  const anisotropy = extensions?.KHR_materials_anisotropy;
  const specular = extensions?.KHR_materials_specular;
  const ior = extensions?.KHR_materials_ior;
  const sheen = extensions?.KHR_materials_sheen;
  const iridescence = extensions?.KHR_materials_iridescence;
  const clearcoat = extensions?.KHR_materials_clearcoat;
  const dispersion = extensions?.KHR_materials_dispersion;
  const diffuseTransmission = extensions?.KHR_materials_diffuse_transmission;
  const transmission = extensions?.KHR_materials_transmission;
  const volume = extensions?.KHR_materials_volume;
  if (
    anisotropy === undefined
    && specular === undefined
    && ior === undefined
    && sheen === undefined
    && iridescence === undefined
    && clearcoat === undefined
    && dispersion === undefined
    && diffuseTransmission === undefined
    && transmission === undefined
    && volume === undefined
  ) return undefined;

  return {
    anisotropyRotation: finiteNumber(anisotropy?.anisotropyRotation, 0),
    anisotropyStrength: clampedFiniteNumber(anisotropy?.anisotropyStrength, 0, 0, 1),
    attenuationColor: gltfAttenuationColor(volume?.attenuationColor),
    attenuationDistance: gltfAttenuationDistance(volume?.attenuationDistance),
    clearcoatFactor: clampedFiniteNumber(clearcoat?.clearcoatFactor, 0, 0, 1),
    clearcoatRoughnessFactor: clampedFiniteNumber(clearcoat?.clearcoatRoughnessFactor, 0, 0, 1),
    diffuseTransmissionColorFactor: gltfDiffuseTransmissionColorFactor(
      diffuseTransmission?.diffuseTransmissionColorFactor,
    ),
    diffuseTransmissionFactor: clampedFiniteNumber(
      diffuseTransmission?.diffuseTransmissionFactor,
      0,
      0,
      1,
    ),
    dispersionFactor: nonNegativeFiniteNumber(dispersion?.dispersion, 0),
    ior: gltfIor(ior?.ior),
    iridescenceFactor: clampedFiniteNumber(iridescence?.iridescenceFactor, 0, 0, 1),
    iridescenceIor: gltfIridescenceIor(iridescence?.iridescenceIor),
    iridescenceThicknessMaximum: nonNegativeFiniteNumber(
      iridescence?.iridescenceThicknessMaximum,
      DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.iridescenceThicknessMaximum,
    ),
    iridescenceThicknessMinimum: nonNegativeFiniteNumber(
      iridescence?.iridescenceThicknessMinimum,
      DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS.iridescenceThicknessMinimum,
    ),
    sheenColorFactor: gltfSheenColorFactor(sheen?.sheenColorFactor),
    sheenRoughnessFactor: clampedFiniteNumber(sheen?.sheenRoughnessFactor, 0, 0, 1),
    specularColorFactor: gltfSpecularColorFactor(specular?.specularColorFactor),
    specularFactor: clampedFiniteNumber(specular?.specularFactor, 1, 0, 1),
    thicknessFactor: nonNegativeFiniteNumber(volume?.thicknessFactor, 0),
    transmissionFactor: clampedFiniteNumber(transmission?.transmissionFactor, 0, 0, 1),
  };
};

const gltfLightColor = (light: GltfPunctualLight): Rgba => {
  const color = light.color;
  const intensity = Math.max(0, finiteNumber(light.intensity, 1));

  return [
    (color?.[0] ?? 1) * intensity,
    (color?.[1] ?? 1) * intensity,
    (color?.[2] ?? 1) * intensity,
    1,
  ];
};

const gltfSpotConeAngles = (light: GltfPunctualLight): {
  readonly innerConeAngle: number;
  readonly outerConeAngle: number;
} => {
  const outerConeAngle = Math.min(
    Math.PI / 2,
    Math.max(0.0001, finiteNumber(light.spot?.outerConeAngle, Math.PI / 4)),
  );
  const innerConeAngle = Math.min(
    outerConeAngle - 0.0001,
    Math.max(0, finiteNumber(light.spot?.innerConeAngle, 0)),
  );

  return { innerConeAngle, outerConeAngle };
};

const gltfEmissiveColor = (
  material: GltfMaterial | undefined,
): Rgba | undefined => {
  const factor = material?.emissiveFactor;
  const strength = Math.max(
    0,
    finiteNumber(material?.extensions?.KHR_materials_emissive_strength?.emissiveStrength, 1),
  );
  const emissive: Rgba = [
    (factor?.[0] ?? 0) * strength,
    (factor?.[1] ?? 0) * strength,
    (factor?.[2] ?? 0) * strength,
    1,
  ];

  return emissive[0] === 0 && emissive[1] === 0 && emissive[2] === 0
    ? undefined
    : emissive;
};

const gltfPrimitiveMode = (mode: number | undefined): GeometryDrawMode | undefined => {
  switch (mode ?? 4) {
    case 0:
      return "points";
    case 1:
      return "lines";
    case 2:
      return "line-loop";
    case 3:
      return "line-strip";
    case 4:
      return "triangles";
    case 5:
      return "triangle-strip";
    case 6:
      return "triangle-fan";
    default:
      return undefined;
  }
};


const isPickableDrawMode = (mode: GeometryDrawMode | undefined): boolean =>
  mode === undefined
  || mode === "triangles"
  || mode === "triangle-strip"
  || mode === "triangle-fan";

const gltfPrimitiveTexCoords = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  primitive: GltfMeshPrimitive,
  set: 0 | 1,
  decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
): Float32Array | undefined => {
  const semantic = `TEXCOORD_${set}`;
  const decodedTexCoords = decodedAttributes?.get(semantic);
  if (decodedTexCoords !== undefined) return decodedTexCoords;
  const texCoordAccessor = primitive.attributes?.[semantic];
  if (texCoordAccessor === undefined) return undefined;
  return readGltfFloatAccessor(document, buffers, texCoordAccessor);
};

const gltfVertexColors = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  primitive: GltfMeshPrimitive,
  positions: Float32Array,
  decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
): Float32Array | undefined => {
  const colorAccessor = primitive.attributes?.COLOR_0;
  const colors = decodedAttributes?.get("COLOR_0")
    ?? (colorAccessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, colorAccessor));
  if (colors === undefined) return undefined;

  const vertexCount = positions.length / 3;
  const accessorComponentCount = colorAccessor === undefined
    ? undefined
    : gltfComponentCount(document.accessors?.[colorAccessor]?.type ?? "VEC4");
  const componentCount = accessorComponentCount ?? colors.length / Math.max(vertexCount, 1);
  if (componentCount === 4 && colors.length === vertexCount * 4) return colors;
  if (componentCount !== 3 || colors.length !== vertexCount * 3) return undefined;

  const output = new Float32Array(vertexCount * 4);
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const sourceOffset = vertexIndex * 3;
    const outputOffset = vertexIndex * 4;
    output[outputOffset] = colors[sourceOffset] ?? 1;
    output[outputOffset + 1] = colors[sourceOffset + 1] ?? 1;
    output[outputOffset + 2] = colors[sourceOffset + 2] ?? 1;
    output[outputOffset + 3] = 1;
  }

  return output;
};

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

const fallbackLodThreshold = (level: number, levelCount: number): number =>
  level >= levelCount - 1 ? 0 : 0.2 / (4 ** level);

const gltfLodThresholds = (
  extras: GltfLodExtras | undefined,
  levelCount: number,
): readonly number[] => {
  const thresholds: number[] = [];
  let previous = 1;
  for (let level = 0; level < levelCount; level += 1) {
    const value = extras?.MSFT_screencoverage?.[level];
    const threshold = Number.isFinite(value)
      ? clamp01(value as number)
      : fallbackLodThreshold(level, levelCount);
    const ordered = Math.min(previous, threshold);
    thresholds.push(ordered);
    previous = ordered;
  }

  return thresholds;
};

const mat4OrientationDeterminant = (matrix: Mat4): number =>
  matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6])
  - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2])
  + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]);

const projectedBoundsScreenCoverage = (
  bounds: Bounds3 | undefined,
  viewProjectionModel: Mat4,
): number => {
  if (bounds === undefined) return 0;

  let minX = 1;
  let minY = 1;
  let maxX = -1;
  let maxY = -1;
  let projected = false;

  for (let xIndex = 0; xIndex < 2; xIndex += 1) {
    const x = xIndex === 0 ? bounds.min[0] : bounds.max[0];
    for (let yIndex = 0; yIndex < 2; yIndex += 1) {
      const y = yIndex === 0 ? bounds.min[1] : bounds.max[1];
      for (let zIndex = 0; zIndex < 2; zIndex += 1) {
        const z = zIndex === 0 ? bounds.min[2] : bounds.max[2];
        const clipX = viewProjectionModel[0] * x + viewProjectionModel[4] * y + viewProjectionModel[8] * z
          + viewProjectionModel[12];
        const clipY = viewProjectionModel[1] * x + viewProjectionModel[5] * y + viewProjectionModel[9] * z
          + viewProjectionModel[13];
        const clipW = viewProjectionModel[3] * x + viewProjectionModel[7] * y + viewProjectionModel[11] * z
          + viewProjectionModel[15];
        if (clipW === 0) continue;

        const ndcX = clamp01((clipX / clipW + 1) / 2);
        const ndcY = clamp01((clipY / clipW + 1) / 2);
        minX = Math.min(minX, ndcX);
        minY = Math.min(minY, ndcY);
        maxX = Math.max(maxX, ndcX);
        maxY = Math.max(maxY, ndcY);
        projected = true;
      }
    }
  }

  if (!projected) return 0;

  return clamp01((maxX - minX) * (maxY - minY));
};

/**
 * Minimal Royal WebGL2 renderer root. It implements the descriptor subset used
 * by the contracts while keeping all GPU ownership inside this root.
 */
class WebGlRootImpl implements WebGlRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #options: NormalizedWebGlRootOptions;
  readonly #requestedContextOptions: WebGlRootOptions;
  readonly #cameraView: CameraViewReadTarget = {
    kind: 'perspective-camera',
    position: new Float64Array(3),
    rotation: new Float64Array(3),
    fovY: 1,
    left: -1,
    right: 1,
    bottom: -1,
    top: 1,
    near: 0.1,
    far: 100,
  };
  #cameraViewResourceSubscription: CameraViewResourceSubscription | undefined;
  readonly #frameViews = createFrameViews();
  readonly #renderProjection = identityMat4();
  readonly #renderView = identityMat4();
  readonly #renderViewProjection = identityMat4();
  readonly #renderViewportSize: [number, number] = [0, 0];
  readonly #meshModel = identityMat4();
  readonly #meshViewProjectionModel = identityMat4();
  readonly #contextLifecycleObservers = new Set<(snapshot: WebGlContextSnapshot) => void>();
  readonly #programArena: ProgramArena;
  readonly #geometryLocalBounds = new WeakMap<Float32Array, Bounds3 | undefined>();
  readonly #retainedGeometryRecipes = new Map<string, { readonly id: number; readonly recipe: CpuGeometry }>();
  readonly #gltfPrimitiveGeometryKeys = new WeakMap<LoadedGltfPrimitive, string>();
  readonly #gltfPacketPrimitivesByGeometryId = new Map<number, LoadedGltfPrimitive>();
  readonly #ordinaryTextureGpu: OrdinaryTextureGpuArena;
  readonly #ordinaryTextureSourceSubscriptions = new Map<string, OrdinaryTextureSourceSubscription>();
  readonly #ordinaryTextureSources: OrdinaryTextureSourceStore;
  readonly #closedTextureSources = new WeakSet<object>();
  readonly #pendingGltfImageRows: GltfImageRow[] = [];
  readonly #pendingGltfTextureRekeys = new Map<string, PreparedAssetOrdinaryTextureRekey[]>();
  #pendingGltfImageRowHead = 0;
  readonly #virtualTextures = new Map<string, VirtualTextureRuntimeState>();
  readonly #autoVirtualTextureRefs = new Map<string, VirtualTextureRef>();
  readonly #autoVirtualTextureManifestUris = new Map<string, string>();
  readonly #autoVirtualTextureGeneratedPageSources = new Map<string, VirtualTextureGeneratedPageSource>();
  readonly #gltf = new Map<string, GltfState>();
  readonly #resourceArena: ResourceArena;
  readonly #vertexInputs: VertexInputArena = createVertexInputArena();
  readonly #gltfPreparationScheduler = new GltfPreparationScheduler(2);
  readonly #gltfImageScheduler = new GltfPreparationScheduler(GLTF_IMAGE_LANE_CONCURRENCY);
  readonly #gltfIblImageScheduler = new GltfPreparationScheduler(GLTF_IMAGE_LANE_CONCURRENCY);
  readonly #gltfStatesByNode = new WeakMap<AnyGltfNode, GltfState>();
  readonly #gltfInstanceTransformViews = new WeakMap<GltfInstanceTransforms, GltfInstanceTransformViews>();
  readonly #gltfInstanceTransformSubscriptions =
    new Map<GltfInstanceTransforms, GltfInstanceTransformSubscription>();
  #gltfInstanceSourceKey = 1;
  #gltfInstanceFrameActive = false;
  readonly #gltfBatches: Array<GltfPrimitiveDrawBatch | undefined> = [];
  readonly #gltfInstanceBufferArena = createGltfInstanceBufferArena(this.#vertexInputs);
  #sharedViewLodSelections: SharedViewLodSelections = createSharedViewLodSelections();
  readonly #sharedViewLodSelectionIds = new Map<string, number>();
  #sharedViewLodSelectionIdCount = 0;
  readonly #sharedViewLodMetadata = new Map<string, SharedViewLodMetadata>();
  #sharedViewLodMetadataById: SharedViewLodMetadata[] = [];
  #sharedViewLodTouchEpochs = new Uint32Array(1);
  #sharedViewLodTouchPhases = new Uint8Array(1);
  #sharedViewNodeLodFallbackEpochs = new Uint32Array(1);
  #sharedViewNodeLodFallbackLevels = new Uint32Array(1);
  #sharedViewNodeLodIds = new Uint32Array(1);
  #sharedViewMaterialLodIds = new Uint32Array(1);
  #sharedViewNodeLodCount = 0;
  #sharedViewMaterialLodCount = 0;
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
  readonly #renderObjectBindings = new Map<RenderObjectRef, RenderObjectBinding>();
  readonly #renderObjectHandles = new WeakMap<TransformableRenderNode, RenderObjectHandle>();
  #dprMediaQuery: MediaQueryList | undefined;
  readonly #diagnostics = new BoundedDiagnosticLog();
  #contextError: string | undefined;
  #contextGeneration = 1;
  #contextLifecycle: WebGlContextLifecycle = "active";
  #contextLosses = 0;
  #contextNotificationVersion = 0;
  #contextRestores = 0;
  #disposed = false;
  #externalRenderClocks = 0;
  #frame = 0;
  #gltfRenderOrdinal = 0;
  #gltfStateInstanceKey = 1;
  readonly #iblTextures: IblTextureArena;
  #gltfInstancingCounters = createWebGlGltfInstancingCounters();
  readonly #surfaceRenderTargets = createSurfaceRenderTargetArena();
  #hdrSupported = false;
  readonly #clusteredLights: ClusteredLightArena;
  #framePlan: FramePlan | undefined;
  readonly #framePlanDiffScratch = createResourceManifestDiffScratch();
  #framePlanReconciliationInProgress = false;
  #framePlanReconciliationPending = false;
  #framePlanReconciliationPrevious: FramePlan | undefined;
  #framePlanSurfaceLights: readonly SurfaceLight[] = [];
  #framePlanSurfaceLightSet: SurfaceLightSet | undefined;
  #latestScene: RenderRoot | undefined;
  #planRevision = 0;
  #planCompiles = 0;
  #compileNodeVisits = 0;
  #sceneCommits = 0;
  #maxTextureImageUnits = 0;
  #maxTextureSize = 0;
  readonly #pickCandidates: PickScratchCandidate[] = [];
  #pickCandidateCount = 0;
  #pickCandidatesThisPick = 0;
  #pickExactTestsThisPick = 0;
  readonly #pickHeap: number[] = [];
  readonly #pickInverseViewProjection = identityMat4();
  readonly #pickProjection = identityMat4();
  readonly #pickView = identityMat4();
  readonly #pickModel = identityMat4();
  readonly #pickRootModel = identityMat4();
  readonly #pickRootViewProjection = identityMat4();
  readonly #pickRay: Ray = { direction: [0, 0, -1], origin: [0, 0, 0] };
  readonly #pickRayGeometryScratch: RayGeometryScratch = createRayGeometryScratch();
  readonly #pickViewProjection = identityMat4();
  #renderObjectInvalidationPending = false;
  #renderDirty = false;
  #renderScheduleGeneration = 0;
  #scheduledRenderGeneration = 0;
  #resizeObserver: ResizeObserver | undefined;
  readonly #geometryDrawArena: GeometryDrawArena;
  #virtualTextureRequestFrame = -1;
  #virtualTextureRequestsThisFrame = 0;
  #virtualTextureUploadFrame = -1;
  #virtualTextureUploadsThisFrame = 0;
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
    if (this.#contextLifecycle === "disposed" || this.#contextLifecycle === "lost") return;
    this.#contextLifecycle = "lost";
    this.#contextGeneration += 1;
    this.#contextLosses += 1;
    this.#renderDirty ||= this.#latestScene !== undefined;
    this.#scheduledRenderGeneration = 0;
    this.#dropGpuState(false);
    this.#notifyContextLifecycle();
  };
  readonly #contextRestoredListener = (): void => {
    if (this.#contextLifecycle !== "lost") return;
    this.#contextLifecycle = "restoring";
    this.#notifyContextLifecycle();
    if (this.#contextLifecycle !== "restoring") return;
    const restored = this.#canvas.getContext("webgl2", {
      alpha: this.#options.alpha,
      antialias: this.#options.antialias,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (restored === null || restored !== this.#gl) {
      this.#contextLifecycle = "lost";
      this.#contextError = "Royal WebGL context restoration did not return the renderer-owned WebGL2 context";
      this.#notifyContextLifecycle();
      return;
    }
    try {
      this.#validateRestoredContextAttributes();
      this.#probeContextCapabilities();
      restoreVertexInputArenaContext(this.#vertexInputs, this.#contextGeneration);
      this.#contextLifecycle = "active";
      this.#contextError = undefined;
      this.#contextRestores += 1;
      this.#restoreOrdinaryTextureResources();
      this.#restoreVirtualTextureResources();
      this.#renderDirty ||= this.#latestScene !== undefined;
      this.#scheduleRender();
      this.#notifyContextLifecycle();
    } catch (error) {
      let dropError: unknown;
      try {
        this.#dropGpuState(true);
      } catch (caught) {
        dropError = caught;
      }
      this.#contextLifecycle = "lost";
      const restoreMessage = error instanceof Error ? error.message : String(error);
      this.#contextError = dropError instanceof Error
        ? `${restoreMessage}; GPU cleanup also failed: ${dropError.message}`
        : restoreMessage;
      this.#notifyContextLifecycle();
    }
  };
  constructor(canvas: HTMLCanvasElement, options?: WebGlRootOptions) {
    this.#canvas = canvas;
    this.#requestedContextOptions = { ...options };
    const requestedOptions = normalizeOptions(options);
    this.#resourceArena = createResourceArena(
      (request, signal) => this.#prepareGltfAsset(request.src, request.key, signal),
      () => this.invalidate(),
    );
    this.#ordinaryTextureSources = new OrdinaryTextureSourceStore({
      close: (source) => this.#closeTextureSource(source),
      load: (request, signal) => isSvgUri(request.uri)
        ? loadSvgTextureFromUri(request.uri, signal).then((loadedImage) => loadedImage.image)
        : loadImage(request.uri, signal),
      retain: (source) => retainResourceArenaSourceLease(this.#resourceArena, source),
    });
    const gl = canvas.getContext("webgl2", {
      alpha: requestedOptions.alpha,
      antialias: requestedOptions.antialias,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (gl === null) {
      throw new Error("Royal WebGL renderer requires a WebGL2 context");
    }
    this.#gl = gl;
    this.#clusteredLights = createClusteredLightArena(gl);
    this.#iblTextures = createIblTextureArena(gl);
    this.#textureHandles = createTextureHandleArena(gl);
    this.#ordinaryTextureGpu = createOrdinaryTextureGpuArena(gl, this.#textureHandles);
    this.#geometryDrawArena = createGeometryDrawArena(gl, this.#vertexInputs);
    this.#programArena = createProgramArena(gl);
    this.#options = this.#validatedContextOptions(requestedOptions);
    this.#probeContextCapabilities();
    restoreVertexInputArenaContext(this.#vertexInputs, this.#contextGeneration);
    this.#canvas.addEventListener?.("webglcontextlost", this.#contextLostListener);
    this.#canvas.addEventListener?.("webglcontextrestored", this.#contextRestoredListener);
    this.#watchViewport();
  }

  #probeContextCapabilities(): void {
    const gl = this.#gl;
    configureProgramArenaParallelCompile(
      this.#programArena,
      gl.getExtension?.("KHR_parallel_shader_compile") ?? undefined,
    );
    this.#hdrSupported = gl.getExtension?.("EXT_color_buffer_float") != null;
    const maxTextureImageUnits = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    this.#maxTextureImageUnits = Number.isFinite(maxTextureImageUnits) ? maxTextureImageUnits : 0;
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.#maxTextureSize = Number.isFinite(maxTextureSize) ? maxTextureSize : 0;
    configureClusteredLightArena(this.#clusteredLights, this.#maxTextureImageUnits, this.#maxTextureSize);
  }

  #validatedContextOptions(fallback: NormalizedWebGlRootOptions): NormalizedWebGlRootOptions {
    const attributes = this.#gl.getContextAttributes?.();
    const alpha = attributes?.alpha ?? fallback.alpha;
    const antialias = attributes?.antialias ?? fallback.antialias;
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
    return {
      alpha,
      antialias,
      generatedRasterVirtualTextures: fallback.generatedRasterVirtualTextures,
    };
  }

  #validateRestoredContextAttributes(): void {
    const restored = this.#validatedContextOptions(this.#options);
    if (restored.alpha !== this.#options.alpha || restored.antialias !== this.#options.antialias) {
      throw new Error("Royal WebGL context restoration changed renderer context attributes");
    }
  }

  #contextLifecycleSnapshot(): WebGlContextSnapshot {
    return Object.freeze({
      generation: this.#contextGeneration,
      ...(this.#contextError === undefined ? {} : { lastError: this.#contextError }),
      lifecycle: this.#contextLifecycle,
      losses: this.#contextLosses,
      restores: this.#contextRestores,
    });
  }

  #notifyContextLifecycle(): void {
    const version = this.#contextNotificationVersion + 1;
    this.#contextNotificationVersion = version;
    const snapshot = this.#contextLifecycleSnapshot();
    for (const observer of this.#contextLifecycleObservers) {
      try {
        observer(snapshot);
      } catch (error) {
        console.error("Royal WebGL context lifecycle observer failed", error);
      }
      if (this.#contextNotificationVersion !== version) break;
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
    return this.#contextLifecycle;
  }

  contextSnapshot(): WebGlContextSnapshot {
    return this.#contextLifecycleSnapshot();
  }

  observeContextLifecycle(callback: (snapshot: WebGlContextSnapshot) => void): () => void {
    this.#contextLifecycleObservers.add(callback);
    try {
      callback(this.#contextLifecycleSnapshot());
    } catch (error) {
      this.#contextLifecycleObservers.delete(callback);
      throw error;
    }
    return () => {
      this.#contextLifecycleObservers.delete(callback);
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

  acquireExternalRenderClock(): () => void {
    if (this.#disposed) {
      throw new Error("Cannot acquire a render clock from a disposed Royal renderer root");
    }

    this.#externalRenderClocks += 1;
    this.#scheduledRenderGeneration = 0;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.#externalRenderClocks = Math.max(0, this.#externalRenderClocks - 1);
      if (this.#externalRenderClocks === 0) this.#scheduleRender();
    };
  }

  render(scene: RenderRoot): void {
    if (this.#disposed) {
      throw new Error("Cannot render with a disposed Royal renderer root");
    }
    const plan = this.#commitScene(scene);
    if (this.#contextLifecycle !== "active") {
      this.#retainPlanWhileContextUnavailable();
      return;
    }

    const { height, width } = this.#resize();
    const camera = this.#readCamera(plan.camera);
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
    if (this.#contextLifecycle !== "active") {
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
    if (this.#contextLifecycle !== "active") {
      this.#retainPlanWhileContextUnavailable();
      return;
    }
    this.#renderScene(plan, frameViews);
  }

  #renderScene(plan: FramePlan, frameViews: FrameViews): void {
    if (this.#contextLifecycle !== "active") {
      this.#retainPlanWhileContextUnavailable();
      return;
    }
    if (frameViews.count === 0) return;

    // An immediate render consumes any queued demand render. The queued
    // callback checks its generation before drawing.
    this.#renderDirty = false;
    this.#scheduledRenderGeneration = 0;
    this.#renderObjectInvalidationPending = false;
    this.#applyPendingResourceArenaEvents();
    this.#gltfRenderOrdinal = 0;
    const gl = this.#gl;
    try {
    gl.bindFramebuffer?.(gl.FRAMEBUFFER, frameViews.framebuffer);
    prepareFrameBaseline(gl, frameViews.scissor);
    this.#stagePendingGltfImageRows();
    this.#processOrdinaryTextureUploads();
    this.#processVirtualTexturePageUploads();

    this.#beginGltfInstanceFrame();
    try {
      const wantsHdr = this.#planWantsHdr(plan);
      const actualWebGl2 = (
        typeof globalThis.WebGL2RenderingContext === "function"
        && gl instanceof globalThis.WebGL2RenderingContext
      ) || Object.prototype.toString.call(gl) === "[object WebGL2RenderingContext]";
      if (wantsHdr && !this.#hdrSupported && actualWebGl2) {
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
        // A scene occurrence has the same resource identity in every view.
        // Resetting the ordinal across eyes avoids duplicate instance uploads
        // and other occurrence-owned resources in XR.
        this.#gltfRenderOrdinal = 0;
        gl.enable?.(gl.DEPTH_TEST);
        const viewportOffset = viewIndex * 4;
        const x = frameViews.viewports[viewportOffset]!;
        const y = frameViews.viewports[viewportOffset + 1]!;
        const width = frameViews.viewports[viewportOffset + 2]!;
        const height = frameViews.viewports[viewportOffset + 3]!;
        const hdrTarget = useHdr
          ? ensureHdrRenderTarget(this.#surfaceRenderTargets, gl, width, height)
          : undefined;
        gl.bindFramebuffer?.(gl.FRAMEBUFFER, hdrTarget?.framebuffer ?? frameViews.framebuffer);
        gl.viewport(useHdr ? 0 : x, useHdr ? 0 : y, width, height);
        if (frameViews.scissor) gl.scissor?.(useHdr ? 0 : x, useHdr ? 0 : y, width, height);
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
    } finally {
      this.#gltfInstanceFrameActive = false;
      if (frameViews.scissor) gl.disable?.(gl.SCISSOR_TEST);
      gl.bindFramebuffer?.(gl.FRAMEBUFFER, null);
    }

    this.#releaseUnusedGltfBatchResources();
    endClusteredLightFrame(this.#clusteredLights, this.#frame);
    this.#frame += 1;
    if (
      ordinaryTextureGpuHasPendingUploads(this.#ordinaryTextureGpu)
      || this.#hasPendingVirtualTextureUploads()
    ) this.invalidate();
    } finally {
      // The renderer exclusively owns its context, but leaving vertex-input
      // bindings neutral makes frame teardown explicit. The EAB is VAO state,
      // so select the default VAO before clearing it.
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    }
  }

  invalidate(): void {
    if (this.#disposed || this.#latestScene === undefined) return;

    this.#renderDirty = true;
    this.#scheduleRender();
  }

  flushInvalidated(): void {
    if (
      this.#disposed
      || this.#contextLifecycle !== "active"
      || !this.#renderDirty
      || this.#externalRenderClocks > 0
      || this.#latestScene === undefined
    ) return;
    this.#renderLatestScene();
  }

  flushInvalidatedFromExternalClock(): void {
    if (
      this.#disposed
      || this.#contextLifecycle !== "active"
      || !this.#renderDirty
      || this.#externalRenderClocks !== 1
      || this.#latestScene === undefined
    ) return;
    this.#renderLatestScene();
  }

  #invalidateRenderObjectMutation(): void {
    if (this.#renderObjectInvalidationPending) return;

    this.#renderObjectInvalidationPending = true;
    this.invalidate();
  }

  pick(input: PickInput): PickResult | undefined {
    if (this.#disposed) {
      throw new Error("Cannot pick with a disposed Royal renderer root");
    }
    if (this.#contextLifecycle !== "active") return undefined;
    const plan = this.#framePlan;
    if (plan === undefined) return undefined;

    const { height, width } = this.#resize();
    this.#pickCandidatesThisPick = 0;
    this.#pickExactTestsThisPick = 0;
    const camera = this.#readCamera(plan.camera);
    const projection = projectionMat4Into(this.#pickProjection, camera, width, height);
    const view = viewMat4Into(this.#pickView, camera);
    const viewProjection = multiplyMat4Into(this.#pickViewProjection, projection, view);
    const ray = this.#pickRayInto(input, viewProjection);
    if (ray === undefined) return undefined;

    let best: PickCandidate | undefined;
    let drawOrdinal = 0;
    for (const node of plan.nodes) {
      let hit: PickCandidate | undefined;
      if (node.kind === "mesh") {
        hit = this.#pickMesh(node, ray, viewProjection, input, drawOrdinal);
        drawOrdinal += 1;
      } else if (node.kind === "gltf") {
        hit = this.#pickGltf(node, ray, viewProjection, input, drawOrdinal);
        drawOrdinal += 1;
      } else if (node.kind === "gltf-instances") {
        hit = this.#pickGltfInstances(node, ray, viewProjection, input, drawOrdinal);
        drawOrdinal += 1;
      }
      if (hit !== undefined && this.#isBetterPick(hit, best)) best = hit;
    }

    if (best === undefined) return undefined;
    return {
      clientX: best.clientX,
      clientY: best.clientY,
      distance: best.distance,
      point: best.point,
      target: best.target,
    };
  }

  #retainPlanWhileContextUnavailable(): void {
    this.#applyPendingResourceArenaEvents();
    this.#renderDirty = true;
    this.#renderObjectInvalidationPending = false;
  }

  #dropGpuState(deleteResources: boolean): void {
    let releaseError: unknown;
    dropOrdinaryTextureGpuContext(this.#ordinaryTextureGpu);
    releaseError = captureFirstError(releaseError, () => this.#consumeOrdinaryTextureGpuOutcomes());
    if (deleteResources) {
      const gl = this.#gl;
      releaseError = captureFirstError(releaseError, () => {
        releaseVertexInputContextHandles(this.#vertexInputs, gl, this.#contextGeneration);
      });
      releaseError = captureFirstError(releaseError, () => {
        releaseSurfaceRenderTargetContextHandles(this.#surfaceRenderTargets, gl);
      });
      releaseError = captureFirstError(releaseError, () => releaseProgramArenaContextHandles(this.#programArena));
      releaseError = captureFirstError(releaseError, () => {
        releaseClusteredLightContextHandles(this.#clusteredLights);
      });
      releaseError = captureFirstError(releaseError, () => releaseIblTextureContextHandles(this.#iblTextures));
      releaseError = captureFirstError(releaseError, () => {
        releaseTextureHandleContextHandles(this.#textureHandles);
      });
    }
    // Active release APIs retain failed handles for direct retry. Root teardown
    // is terminal for this context generation, so always normalize every arena
    // after all release attempts before reporting the first driver failure.
    dropVertexInputArenaContext(this.#vertexInputs);
    dropSurfaceRenderTargetArenaContext(this.#surfaceRenderTargets);
    dropProgramArenaContext(this.#programArena);
    dropClusteredLightContext(this.#clusteredLights);
    dropIblTextureContext(this.#iblTextures);
    dropTextureHandleContext(this.#textureHandles);
    clearGeometryDrawArenaContext(this.#geometryDrawArena);
    this.#gltfBatches.length = 0;
    this.#gltfLiveBatchCount = 0;
    clearGltfPacketBatchSegmentGroups(this.#gltfPacketBatchSegmentGroups);
    this.#gltfInstanceFrameActive = false;

    for (const state of this.#virtualTextures.values()) {
      delete state.resources;
      delete state.pageTable;
      state.uploadedPages.clear();
      state.requestedPages.clear();
      for (const pageKey of state.loadingPages) state.requestedPages.add(pageKey);
      for (const upload of state.pendingUploads) {
        if (upload.sourceGeneration === state.sourceGeneration) state.requestedPages.add(upload.pageKey);
      }
    }
    this.#virtualTextureRequestFrame = -1;
    this.#virtualTextureRequestsThisFrame = 0;
    this.#virtualTextureUploadFrame = -1;
    this.#virtualTextureUploadsThisFrame = 0;
    if (releaseError !== undefined) throw releaseError;
  }

  #restoreVirtualTextureResources(): void {
    for (const state of this.#virtualTextures.values()) {
      if (state.status !== "ready" || state.manifest === undefined) continue;
      const unsupported = this.#unsupportedVirtualTextureRuntimeReason(state.manifest);
      if (unsupported !== undefined) {
        this.#markVirtualTextureUnsupported(state, unsupported);
        continue;
      }
      this.#allocateVirtualTextureResources(state, state.manifest);
      this.#demandVirtualTexturePages(state);
    }
  }

  #restoreOrdinaryTextureResources(): void {
    for (const key of resourceArenaPreparedSourceKeys(this.#resourceArena)) {
      if (resourceArenaTextureReferenceCount(this.#resourceArena, key) === 0) continue;
      const prepared = resourceArenaPreparedSource(this.#resourceArena, key);
      if (prepared === undefined) continue;
      const resource = ensureOrdinaryTextureGpuResource(
        this.#ordinaryTextureGpu,
        key,
        this.#contextGeneration,
      );
      this.#queueOrdinaryTextureUpload(resource, prepared.source, prepared.texture);
    }
  }

  dispose(): void {
    if (this.#framePlanReconciliationInProgress) {
      throw new Error("Cannot dispose while Royal is reconciling render-object refs");
    }
    if (this.#disposed) return;
    const canDeleteResources = this.#contextLifecycle === "active" || this.#contextLifecycle === "restoring";
    this.#disposed = true;
    this.#contextLifecycle = "disposed";
    this.#canvas.removeEventListener?.("webglcontextlost", this.#contextLostListener);
    this.#canvas.removeEventListener?.("webglcontextrestored", this.#contextRestoredListener);
    let gpuDropError: unknown;
    try {
      this.#dropGpuState(canDeleteResources);
    } catch (error) {
      gpuDropError = error;
    }
    this.#contextGeneration += 1;
    this.#notifyContextLifecycle();
    this.#contextLifecycleObservers.clear();

    this.#ordinaryTextureSources.dispose();
    this.#ordinaryTextureSourceSubscriptions.clear();
    this.#applyResourceArenaChanges(disposeResourceArena(this.#resourceArena));
    for (const key of resourceArenaPreparedSourceKeys(this.#resourceArena)) this.#releaseOrdinaryTexture(key);
    for (const state of this.#virtualTextures.values()) this.#releaseVirtualTextureState(state);
    this.#virtualTextures.clear();
    clearGeometryDrawArenaContext(this.#geometryDrawArena);
    this.#retainedGeometryRecipes.clear();
    this.#gltfPacketPrimitivesByGeometryId.clear();
    clearResourceArenaPreparedSources(this.#resourceArena);
    this.#virtualTextures.clear();
    this.#autoVirtualTextureRefs.clear();
    this.#autoVirtualTextureManifestUris.clear();
    this.#autoVirtualTextureGeneratedPageSources.clear();
    this.#gltf.clear();
    this.#gltfPreparationScheduler.dispose();
    this.#gltfImageScheduler.dispose();
    this.#gltfIblImageScheduler.dispose();
    this.#gltfBatches.length = 0;
    clearGltfInstanceBufferArena(this.#gltfInstanceBufferArena);
    this.#gltfLiveBatchCount = 0;
    clearGltfPacketBatchSegmentGroups(this.#gltfPacketBatchSegmentGroups);
    clearGltfPacketBatchRegistry(this.#gltfPacketBatchRegistry);
    clearGltfPacketSubmissionWorkspace(this.#gltfPacketSubmissionWorkspace);
    this.#gltfMaterialBatchClassIds.clear();
    this.#gltfMaterialBatchClassIdCount = 0;
    this.#gltfLightScopeIds.clear();
    this.#gltfLightScopeIdCount = 0;
    this.#pendingGltfImageRows.length = 0;
    this.#pendingGltfImageRowHead = 0;
    this.#cameraViewResourceSubscription?.unsubscribe();
    this.#cameraViewResourceSubscription = undefined;
    for (const [ref, binding] of this.#renderObjectBindings) {
      this.#renderObjectHandles.delete(binding.node);
      assignRenderObjectRef(ref, null);
    }
    this.#renderObjectBindings.clear();
    for (const subscription of this.#gltfInstanceTransformSubscriptions.values()) subscription.unsubscribe();
    this.#gltfInstanceTransformSubscriptions.clear();
    this.#renderDirty = false;
    this.#scheduledRenderGeneration = 0;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    this.#unwatchDevicePixelRatio();
    disposeVertexInputArena(this.#vertexInputs);
    if (gpuDropError !== undefined) throw gpuDropError;
  }

  snapshot(): WebGlRootSnapshot {
    const diagnostics = this.#diagnostics.snapshot();
    return {
      context: this.#contextLifecycleSnapshot(),
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
      options: { ...this.#options },
      planning: {
        compileNodeVisits: this.#compileNodeVisits,
        planCompiles: this.#planCompiles,
        planRevision: this.#planRevision,
        sceneCommits: this.#sceneCommits,
      },
      resourceLifetime: {
        ...resourceArenaCountersSnapshot(this.#resourceArena),
        gltfPreparationQueueHighWater: this.#gltfPreparationScheduler.snapshot().queueHighWater,
        imageQueueHighWater: this.#gltfImageScheduler.snapshot().queueHighWater,
        iblImageQueueHighWater: this.#gltfIblImageScheduler.snapshot().queueHighWater,
      },
      picking: this.#pickingWorkSnapshot(),
      textureResidency: this.#textureResidencySnapshot(),
      virtualTexturing: this.#virtualTexturingSnapshot(),
    };
  }

  #readCamera(source: Camera | CameraViewResource): Camera | CameraViewReadTarget {
    if (source.kind !== 'camera-view-resource') return source;
    source.read(this.#cameraView);
    return this.#cameraView;
  }

  #commitScene(scene: RenderRoot): FramePlan {
    if (this.#framePlanReconciliationInProgress) {
      throw new Error("Cannot render while Royal is reconciling render-object refs");
    }
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
    this.#applyResourceArenaChanges(applyResourceDelta(this.#resourceArena, resourceDelta));
    this.#framePlan = next;
    this.#sharedViewLodSelectionIds.clear();
    this.#sharedViewLodSelectionIdCount = 0;
    this.#sharedViewLodMetadata.clear();
    this.#sharedViewLodMetadataById = [];
    this.#sharedViewLodSelections = createSharedViewLodSelections();
    this.#sharedViewLodTouchEpochs = new Uint32Array(1);
    this.#sharedViewLodTouchPhases = new Uint8Array(1);
    this.#sharedViewNodeLodFallbackEpochs = new Uint32Array(1);
    this.#sharedViewNodeLodFallbackLevels = new Uint32Array(1);
    this.#sharedViewNodeLodIds = new Uint32Array(1);
    this.#sharedViewMaterialLodIds = new Uint32Array(1);
    this.#sharedViewNodeLodCount = 0;
    this.#sharedViewMaterialLodCount = 0;
    this.#framePlanSurfaceLights = surfaceLights;
    this.#framePlanSurfaceLightSet = surfaceLights.length === 0 ? undefined : surfaceLightSet(surfaceLights);
    this.#latestScene = scene;
    this.#planRevision = revision;
    this.#planCompiles += 1;
    this.#compileNodeVisits += next.nodes.length;
    this.#sceneCommits += 1;
    this.#framePlanReconciliationPending = true;
    this.#framePlanReconciliationPrevious = previous;
    this.#finishFramePlanReconciliation(resourceDelta);
    this.#rebuildGltfPacketTopology(next);
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
            return this.#sharedViewMaterialLodSelectionId(
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
              this.#sharedViewNodeLodSelectionId(
                state,
                `${state.key}:${renderInstanceKey(outerIndex)}:node:${primitive.nodeLod!.group}`,
                primitive.nodeLod!,
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

  #finishFramePlanReconciliation(initialDelta?: ResourceManifestDelta): void {
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
      let firstError = this.#reconcileCameraViewResource(next);
      firstError = this.#reconcileRenderObjectRefs(next, delta, firstError);
      firstError = this.#reconcileGltfInstanceTransforms(delta, firstError);
      if (firstError !== undefined) throw firstError;
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
    for (const { id, key, recipe } of changes.acquiredGeometryDeclarations) {
      retainVertexInputGeometry(this.#vertexInputs, { geometryId: id, recipe });
      this.#retainedGeometryRecipes.set(key, { id, recipe });
    }
    for (const { id, key } of changes.releasedGeometryDeclarations) {
      if (
        this.#contextLifecycle === "active"
        || this.#contextLifecycle === "restoring"
      ) {
        releaseVertexInputGeometry(
          this.#vertexInputs,
          this.#gl,
          this.#contextGeneration,
          id,
        );
      } else {
        releaseLostVertexInputGeometry(this.#vertexInputs, id);
      }
      if (this.#retainedGeometryRecipes.get(key)?.id === id) this.#retainedGeometryRecipes.delete(key);
      this.#gltfPacketPrimitivesByGeometryId.delete(id);
    }
    for (const request of changes.acquiredGltfRequests) this.#ensureGltfState(request.key);
    for (const key of changes.releasedGltfKeys) {
      abortResourceArenaImageWork(this.#resourceArena, key);
      this.#gltf.delete(key);
    }
    let textureReleaseError: unknown;
    for (const key of changes.releasedOrdinaryTextureKeys) {
      textureReleaseError = captureFirstError(textureReleaseError, () => this.#releaseOrdinaryTexture(key));
    }
    for (const key of changes.releasedVirtualTextureKeys) {
      textureReleaseError = captureFirstError(textureReleaseError, () => this.#releaseVirtualTexture(key));
    }
    for (const key of changes.releasedIblKeys) {
      textureReleaseError = captureFirstError(textureReleaseError, () => {
        releaseGltfIblSpecularTexture(this.#iblTextures, key);
      });
    }
    for (const source of changes.releasedSources) {
      if (resourceArenaSourceReferenceCount(this.#resourceArena, source) !== 0) continue;
      textureReleaseError = captureFirstError(textureReleaseError, () => this.#closeTextureSource(source));
    }
    if (textureReleaseError !== undefined) throw textureReleaseError;
  }

  #applyPendingResourceArenaEvents(): void {
    if (!resourceArenaHasPendingAssetEvents(this.#resourceArena)) return;
    const applied = applyPreparedAssetEvents(
      this.#resourceArena,
      (asset, contentKeys, assetKey) => this.#preparedAssetDependencyManifest(asset, contentKeys, assetKey),
    );
    this.#applyResourceArenaChanges(applied.changes);
    for (const event of applied.events) {
      const snapshot = event.snapshot;
      const state = this.#gltf.get(snapshot.key);
      if (state === undefined) continue;
      if (snapshot.status === "error") {
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
        continue;
      }
      if (snapshot.status !== "ready") continue;
      const asset = snapshot.asset;
      const replacesReadyAsset = state.status === "ready";
      if (replacesReadyAsset) this.#invalidateGltfPacketLodRegistry(state);
      state.hasMaterialLod = asset.hasMaterialLod;
      state.hasMaterialVariants = asset.hasMaterialVariants;
      state.hasNodeLod = asset.hasNodeLod;
      if (asset.imageBasedLight === undefined) delete state.imageBasedLight;
      else state.imageBasedLight = asset.imageBasedLight;
      state.lights = asset.lights;
      state.materials = preparedAssetMaterials(asset);
      Object.assign(state.load, asset.load);
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
          state.status = "error";
          state.error = error instanceof Error ? error.message : String(error);
          state.load.readyAt = nowMs();
          this.#recordDiagnostic(state.error, `gltf-packets:${state.key}`);
          if (asset.imagePreparation !== undefined) {
            detachResourceArenaImagePreparation(this.#resourceArena, snapshot.key, snapshot.generation);
          }
          continue;
        }
      }
      const images = asset.imagePreparation;
      if (images !== undefined) {
        this.#loadGltfImages(images.src, images.document, images.buffers, state, images.basisuCodec);
        detachResourceArenaImagePreparation(this.#resourceArena, snapshot.key, snapshot.generation);
      }
    }
  }

  #reconcileCameraViewResource(next: FramePlan): unknown {
    const resource = next.camera.kind === 'camera-view-resource' ? next.camera : undefined;
    if (this.#cameraViewResourceSubscription?.resource === resource) return undefined;
    const previousSubscription = this.#cameraViewResourceSubscription;
    if (previousSubscription !== undefined) {
      try {
        previousSubscription.unsubscribe();
      } catch (error) {
        return error;
      }
      this.#cameraViewResourceSubscription = undefined;
    }
    let firstError: unknown;
    if (resource !== undefined) {
      firstError = captureFirstError(firstError, () => {
        this.#cameraViewResourceSubscription = {
          resource,
          unsubscribe: resource.subscribe(() => this.invalidate()),
        };
      });
    }
    return firstError;
  }

  #reconcileRenderObjectRefs(
    next: FramePlan,
    delta: ResourceManifestDelta,
    initialError: unknown,
  ): unknown {
    let firstError = initialError;
    for (const row of next.renderObjectRefRows) {
      const node = next.nodes[row.nodeIndex];
      if (node?.kind === "mesh" || node?.kind === "gltf") {
        firstError = captureFirstError(firstError, () => this.#syncRenderObjectNodeRef(node));
      }
    }

    for (const row of delta.renderObjectRefs) {
      if (row.nextCount !== 0) continue;
      const ref = row.resource;
      const binding = this.#renderObjectBindings.get(ref);
      if (binding === undefined) continue;
      try {
        assignRenderObjectRef(ref, null);
        this.#renderObjectHandles.delete(binding.node);
        this.#renderObjectBindings.delete(ref);
      } catch (error) {
        firstError ??= error;
      }
    }
    return firstError;
  }

  #reconcileGltfInstanceTransforms(delta: ResourceManifestDelta, initialError: unknown): unknown {
    let firstError = initialError;
    for (const row of delta.bulkInstances) {
      const transforms = row.resource;
      if (row.previousCount !== 0 || row.nextCount === 0) continue;
      firstError = captureFirstError(firstError, () => {
        if (this.#gltfInstanceTransformSubscriptions.has(transforms)) return;
        const views = this.#gltfInstanceViews(transforms);
        const unsubscribe = transforms.subscribe((channel, startIndex, count) => {
          views.changes.commit(channel, startIndex, count);
          this.invalidate();
        });
        this.#gltfInstanceTransformSubscriptions.set(transforms, { unsubscribe, views });
      });
    }
    for (const row of delta.bulkInstances) {
      if (row.nextCount !== 0) continue;
      const transforms = row.resource;
      const subscription = this.#gltfInstanceTransformSubscriptions.get(transforms);
      if (subscription === undefined) continue;
      try {
        subscription.unsubscribe();
        this.#gltfInstanceTransformSubscriptions.delete(transforms);
      } catch (error) {
        firstError ??= error;
      }
    }
    return firstError;
  }

  #beginGltfInstanceFrame(): void {
    this.#gltfInstanceFrameActive = true;
    for (const subscription of this.#gltfInstanceTransformSubscriptions.values()) {
      const views = subscription.views;
      views.changes.beginFrame();
      views.framePoseVersion = views.source.poseVersion;
      views.frameScaleVersion = views.source.scaleVersion;
      views.activeApplied = views.matrixPoseVersion === views.framePoseVersion
        && views.matrixScaleVersion === views.frameScaleVersion;
    }
  }

  #releaseOrdinaryTexture(key: string): void {
    let releaseError: unknown;
    try {
      this.#releaseAutoVirtualTextures(key);
    } catch (error) {
      releaseError = error;
    }
    this.#autoVirtualTextureRefs.delete(`auto-base-color:${key}`);
    this.#autoVirtualTextureManifestUris.delete(key);
    this.#autoVirtualTextureGeneratedPageSources.delete(key);

    const sources = new Set<LoadedTextureSource>();
    const prepared = resourceArenaPreparedSource(this.#resourceArena, key);
    if (prepared !== undefined) sources.add(prepared.source);
    releaseResourceArenaPreparedSource(this.#resourceArena, key);
    this.#releaseOrdinaryTextureSourceSubscription(key);
    const gpuRelease = releaseOrdinaryTextureGpuResource(this.#ordinaryTextureGpu, key);
    releaseError ??= gpuRelease.releaseError;
    try {
      this.#consumeOrdinaryTextureGpuOutcomes();
    } catch (error) {
      releaseError ??= error;
    }
    for (const source of sources) {
      if (resourceArenaSourceReferenceCount(this.#resourceArena, source) !== 0) continue;
      try {
        this.#closeTextureSource(source);
      } catch (error) {
        releaseError ??= error;
      }
    }
    if (releaseError !== undefined) throw releaseError;
  }

  #releaseAutoVirtualTextures(textureKey: string): void {
    const prefix = `auto-base-color:${textureKey}:`;
    let releaseError: unknown;
    for (const [key, state] of this.#virtualTextures) {
      if (!key.startsWith(prefix)) continue;
      this.#virtualTextures.delete(key);
      try {
        this.#releaseVirtualTextureState(state);
      } catch (error) {
        releaseError ??= error;
      }
    }
    if (releaseError !== undefined) throw releaseError;
  }

  #releaseVirtualTexture(key: string): void {
    const state = this.#virtualTextures.get(key);
    if (state === undefined) return;
    this.#virtualTextures.delete(key);
    this.#releaseVirtualTextureState(state);
  }

  #releaseVirtualTextureState(state: VirtualTextureRuntimeState): void {
    state.sourceGeneration += 1;
    for (const upload of state.pendingUploads) closeTexImageSource(upload.image);
    state.pendingUploads.length = 0;
    state.loadingPages.clear();
    state.requestedPages.clear();
    state.uploadedPages.clear();
    const resources = state.resources;
    let releaseError: unknown;
    if (resources !== undefined) {
      for (const texture of [resources.atlasTexture, resources.pageTableTexture]) {
        try {
          releaseOwnedTexture(this.#textureHandles, texture);
        } catch (error) {
          releaseError ??= error;
        }
      }
    }
    delete state.resources;
    delete state.pageTable;
    if (releaseError !== undefined) throw releaseError;
  }

  #closeTextureSource(source: LoadedTextureSource): void {
    const identity = source as object;
    if (this.#closedTextureSources.has(identity)) return;
    this.#closedTextureSources.add(identity);
    closeLoadedTextureSource(source);
  }

  #releaseOrdinaryTextureSourceSubscription(key: string): void {
    this.#ordinaryTextureSourceSubscriptions.get(key)?.release();
    this.#ordinaryTextureSourceSubscriptions.delete(key);
  }

  #retainPreparedTextureUpload(key: string, upload: PreparedTextureSource): void {
    const previous = retainResourceArenaPreparedSource(this.#resourceArena, key, upload);
    if (
      previous !== undefined
      && previous.source !== upload.source
      && resourceArenaSourceReferenceCount(this.#resourceArena, previous.source) === 0
    ) this.#closeTextureSource(previous.source);
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

  #syncRenderObjectNodeRef(node: TransformableRenderNode): void {
    if (node.ref === undefined) return;

    const ref = node.ref;
    const declarativeTransform = resolvedTransform(node.transform);
    let binding = this.#renderObjectBindings.get(ref);
    if (binding === undefined) {
      const existingHandle = typeof ref === "function" ? null : ref.current;
      const invalidation = existingHandle === null ? { suppress: false } : undefined;
      const handle = existingHandle ?? createRenderObjectHandle(declarativeTransform, () => {
        if (invalidation?.suppress === true) return;

        this.#invalidateRenderObjectMutation();
      });
      binding = {
        attached: false,
        declarativeTransform,
        handle,
        invalidation,
        node,
      };
      this.#renderObjectBindings.set(ref, binding);
      this.#renderObjectHandles.set(node, binding.handle);
      assignRenderObjectRef(ref, binding.handle);
      binding.attached = true;
      return;
    } else {
      if (!sameTransform(binding.declarativeTransform, declarativeTransform)) {
        if (binding.invalidation !== undefined) binding.invalidation.suppress = true;
        try {
          binding.handle.setTransform(declarativeTransform);
        } finally {
          if (binding.invalidation !== undefined) binding.invalidation.suppress = false;
        }
        binding.declarativeTransform = declarativeTransform;
      }
      this.#renderObjectHandles.delete(binding.node);
      binding.node = node;
    }

    this.#renderObjectHandles.set(node, binding.handle);
    if (!binding.attached) {
      assignRenderObjectRef(ref, binding.handle);
      binding.attached = true;
    }
  }

  #renderObjectTransform(node: TransformableRenderNode): Transform | undefined {
    const handle = this.#renderObjectHandles.get(node);
    return handle === undefined ? node.transform : readRenderObjectHandleTransform(handle);
  }

  #pickRayInto(input: PickInput, viewProjection: Mat4): Ray | undefined {
    const rect = this.#canvas.getBoundingClientRect?.();
    const width = rect?.width ?? this.#canvas.clientWidth;
    const height = rect?.height ?? this.#canvas.clientHeight;
    if (width <= 0 || height <= 0) return undefined;

    const ndcX = ((input.clientX - (rect?.left ?? 0)) / width) * 2 - 1;
    const ndcY = 1 - ((input.clientY - (rect?.top ?? 0)) / height) * 2;
    const inverse = inverseMat4Into(this.#pickInverseViewProjection, viewProjection);
    if (inverse === undefined) return undefined;
    const nearW = inverse[3] * ndcX + inverse[7] * ndcY - inverse[11] + inverse[15];
    const farW = inverse[3] * ndcX + inverse[7] * ndcY + inverse[11] + inverse[15];
    if (nearW === 0 || farW === 0) return undefined;
    const origin = this.#pickRay.origin as [number, number, number];
    const direction = this.#pickRay.direction as [number, number, number];
    origin[0] = (inverse[0] * ndcX + inverse[4] * ndcY - inverse[8] + inverse[12]) / nearW;
    origin[1] = (inverse[1] * ndcX + inverse[5] * ndcY - inverse[9] + inverse[13]) / nearW;
    origin[2] = (inverse[2] * ndcX + inverse[6] * ndcY - inverse[10] + inverse[14]) / nearW;
    const farX = (inverse[0] * ndcX + inverse[4] * ndcY + inverse[8] + inverse[12]) / farW;
    const farY = (inverse[1] * ndcX + inverse[5] * ndcY + inverse[9] + inverse[13]) / farW;
    const farZ = (inverse[2] * ndcX + inverse[6] * ndcY + inverse[10] + inverse[14]) / farW;
    const x = farX - origin[0];
    const y = farY - origin[1];
    const z = farZ - origin[2];
    const length = Math.hypot(x, y, z);
    if (length === 0 || !Number.isFinite(length)) return undefined;
    direction[0] = x / length;
    direction[1] = y / length;
    direction[2] = z / length;
    return this.#pickRay;
  }

  #pickMesh(
    node: MeshNode,
    ray: Ray,
    viewProjection: Mat4,
    input: PickInput,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    const cpu = this.#meshGeometry(node.geometry, node.material);
    if (!isPickableDrawMode(cpu.mode)) return undefined;
    const model = transformMat4Into(this.#pickModel, this.#renderObjectTransform(node));
    const localBounds = this.#localGeometryBounds(cpu);
    if (localBounds === undefined) return undefined;
    if (!isBoundsVisible(localBounds, multiplyMat4Into(this.#pickRootViewProjection, viewProjection, model))) {
      return undefined;
    }
    const bounds = transformBoundsInto(
      this.#pickCandidates[0]?.bounds ?? { max: [0, 0, 0], min: [0, 0, 0] },
      localBounds,
      model,
    );
    if (this.#pickCandidates.length === 0) {
      this.#pickCandidates.push({
        bounds,
        boundsDistance: 0,
        instanceIndex: 0,
        ordinal: 0,
        outerIndex: 0,
      });
    }
    if (rayAabbDistanceScalars(
      ray,
      bounds.min[0], bounds.min[1], bounds.min[2],
      bounds.max[0], bounds.max[1], bounds.max[2],
    ) === undefined) return undefined;
    this.#pickCandidatesThisPick += 1;
    this.#pickExactTestsThisPick += 1;
    const mode = cpu.mode === "triangle-fan" || cpu.mode === "triangle-strip" ? cpu.mode : "triangles";
    const distance = rayGeometryDistanceWithScratch(
      cpu.positions, cpu.indices, mode, model, ray, this.#pickRayGeometryScratch,
    );
    if (distance === undefined) return undefined;
    return {
      clientX: input.clientX,
      clientY: input.clientY,
      distance,
      drawOrdinal,
      point: pointOnRay(ray, distance),
      target: { ...(node.pickingId === undefined ? {} : { id: node.pickingId }), kind: "mesh", node },
    };
  }

  #pickGltf(
    node: GltfNode,
    ray: Ray,
    viewProjection: Mat4,
    input: PickInput,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    const rootModel = transformMat4Into(this.#pickRootModel, this.#renderObjectTransform(node));
    const state = this.#gltf.get(gltfRequestKey(node.asset.uri, node.asset.version));
    if (state?.status === "ready") {
      this.#resetPickCandidates();
      const rootViewProjection = multiplyMat4Into(this.#pickRootViewProjection, viewProjection, rootModel);
      for (const primitive of state.primitives) {
        if (!isPickableDrawMode(primitive.mode)) continue;
        const localModels = primitive.localModels;
        for (let instanceIndex = 0; instanceIndex < localModels.length; instanceIndex += 1) {
          const localBounds = primitive.localBounds[instanceIndex];
          if (localBounds === undefined || !isBoundsVisible(localBounds, rootViewProjection)) continue;
          this.#addPickCandidate(localBounds, rootModel, localModels[instanceIndex]!, primitive, -1, instanceIndex, ray);
        }
      }
      return this.#pickNearestGltfCandidate(node, ray, input, drawOrdinal);
    }

    return undefined;
  }

  #pickGltfInstances(
    node: GltfInstancesNode,
    ray: Ray,
    viewProjection: Mat4,
    input: PickInput,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    const state = this.#gltf.get(gltfRequestKey(node.asset.uri, node.asset.version));
    if (state?.status !== "ready") return undefined;

    const views = this.#gltfInstanceViews(node.instances);
    this.#resetPickCandidates();
    for (const primitive of state.primitives) {
      if (!isPickableDrawMode(primitive.mode)) continue;
      const localModels = primitive.localModels;
      for (let outerIndex = 0; outerIndex < node.instances.count; outerIndex += 1) {
        const rootModel = views.rootModels[outerIndex]!;
        const rootViewProjection = multiplyMat4Into(this.#pickRootViewProjection, viewProjection, rootModel);
        for (let instanceIndex = 0; instanceIndex < localModels.length; instanceIndex += 1) {
          const localBounds = primitive.localBounds[instanceIndex];
          if (localBounds === undefined || !isBoundsVisible(localBounds, rootViewProjection)) continue;
          this.#addPickCandidate(
            localBounds, rootModel, localModels[instanceIndex]!, primitive, outerIndex, instanceIndex, ray,
          );
        }
      }
    }
    return this.#pickNearestGltfCandidate(node, ray, input, drawOrdinal);
  }

  #localGeometryBounds(geometry: CpuGeometry): Bounds3 | undefined {
    if (this.#geometryLocalBounds.has(geometry.positions)) return this.#geometryLocalBounds.get(geometry.positions);
    const bounds = worldBounds(geometry.positions, identityMat4());
    this.#geometryLocalBounds.set(geometry.positions, bounds);
    return bounds;
  }

  #resetPickCandidates(): void {
    this.#pickCandidateCount = 0;
    this.#pickHeap.length = 0;
  }

  #addPickCandidate(
    localBounds: Bounds3,
    rootModel: Mat4,
    localModel: Mat4,
    primitive: LoadedGltfPrimitive,
    outerIndex: number,
    instanceIndex: number,
    ray: Ray,
  ): void {
    const index = this.#pickCandidateCount;
    let candidate = this.#pickCandidates[index];
    if (candidate === undefined) {
      candidate = {
        bounds: { max: [0, 0, 0], min: [0, 0, 0] },
        boundsDistance: 0,
        instanceIndex: 0,
        ordinal: 0,
        outerIndex: 0,
      };
      this.#pickCandidates.push(candidate);
    }
    transformBoundsInto(candidate.bounds, localBounds, rootModel);
    const distance = rayAabbDistanceScalars(
      ray,
      candidate.bounds.min[0], candidate.bounds.min[1], candidate.bounds.min[2],
      candidate.bounds.max[0], candidate.bounds.max[1], candidate.bounds.max[2],
    );
    if (distance === undefined) return;
    candidate.boundsDistance = distance;
    candidate.instanceIndex = instanceIndex;
    candidate.localModel = localModel;
    candidate.ordinal = index;
    candidate.outerIndex = outerIndex;
    candidate.primitive = primitive;
    candidate.rootModel = rootModel;
    this.#pickCandidateCount += 1;
    this.#pickCandidatesThisPick += 1;
    this.#pushPickHeap(index);
  }

  #pickCandidateBefore(leftIndex: number, rightIndex: number): boolean {
    const left = this.#pickCandidates[leftIndex]!;
    const right = this.#pickCandidates[rightIndex]!;
    return left.boundsDistance < right.boundsDistance
      || (left.boundsDistance === right.boundsDistance && left.ordinal < right.ordinal);
  }

  #pushPickHeap(candidateIndex: number): void {
    let index = this.#pickHeap.length;
    this.#pickHeap.push(candidateIndex);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.#pickCandidateBefore(candidateIndex, this.#pickHeap[parent]!)) break;
      this.#pickHeap[index] = this.#pickHeap[parent]!;
      index = parent;
    }
    this.#pickHeap[index] = candidateIndex;
  }

  #popPickHeap(): number | undefined {
    const first = this.#pickHeap[0];
    const last = this.#pickHeap.pop();
    if (first === undefined || last === undefined || this.#pickHeap.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.#pickHeap.length) break;
      const right = left + 1;
      const child = right < this.#pickHeap.length
        && this.#pickCandidateBefore(this.#pickHeap[right]!, this.#pickHeap[left]!) ? right : left;
      if (!this.#pickCandidateBefore(this.#pickHeap[child]!, last)) break;
      this.#pickHeap[index] = this.#pickHeap[child]!;
      index = child;
    }
    this.#pickHeap[index] = last;
    return first;
  }

  #pickNearestGltfCandidate(
    node: GltfNode | GltfInstancesNode,
    ray: Ray,
    input: PickInput,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    let bestIndex = -1;
    let bestDistance = Infinity;
    let bestOrdinal = Infinity;
    while (this.#pickHeap.length > 0) {
      const index = this.#popPickHeap();
      if (index === undefined) break;
      const candidate = this.#pickCandidates[index]!;
      if (candidate.boundsDistance > bestDistance) break;
      const primitive = candidate.primitive;
      const rootModel = candidate.rootModel;
      const localModel = candidate.localModel;
      if (primitive === undefined || rootModel === undefined || localModel === undefined) continue;
      multiplyMat4Into(this.#pickModel, rootModel, localModel);
      this.#pickExactTestsThisPick += 1;
      const mode = primitive.mode as RayGeometryMode;
      const distance = rayGeometryDistanceWithScratch(
        primitive.positions,
        primitive.indices,
        mode,
        this.#pickModel,
        ray,
        this.#pickRayGeometryScratch,
      );
      if (
        distance !== undefined
        && (distance < bestDistance || (distance === bestDistance && candidate.ordinal < bestOrdinal))
      ) {
        bestDistance = distance;
        bestIndex = index;
        bestOrdinal = candidate.ordinal;
      }
    }
    if (bestIndex < 0) return undefined;
    const best = this.#pickCandidates[bestIndex]!;
    const primitive = best.primitive!;
    const primitiveKey = primitive.localModels.length === 1
      ? primitive.key
      : node.kind === "gltf"
        ? `${primitive.key}:instance:${best.instanceIndex}`
        : `${primitive.key}:asset-instance:${best.instanceIndex}`;
    return {
      clientX: input.clientX,
      clientY: input.clientY,
      distance: bestDistance,
      drawOrdinal,
      point: pointOnRay(ray, bestDistance),
      target: node.kind === "gltf"
        ? { ...(node.pickingId === undefined ? {} : { id: node.pickingId }), kind: "gltf", node, primitiveKey }
        : {
          ...(node.pickingId === undefined ? {} : { id: node.pickingId }),
          ...(node.instances.logicalIds?.[best.outerIndex] === undefined
            ? {}
            : { instanceId: node.instances.logicalIds[best.outerIndex] }),
          instanceIndex: best.outerIndex,
          kind: "gltf-instances",
          node,
          primitiveKey,
        },
    };
  }

  #isBetterPick(candidate: PickCandidate, current: PickCandidate | undefined): boolean {
    if (current === undefined) return true;
    if (candidate.distance !== current.distance) return candidate.distance < current.distance;

    return candidate.drawOrdinal > current.drawOrdinal;
  }

  #resize(): { readonly height: number; readonly width: number } {
    const rect = this.#canvas.getBoundingClientRect?.();
    const cssWidth = rect?.width ?? this.#canvas.clientWidth;
    const cssHeight = rect?.height ?? this.#canvas.clientHeight;
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

    if (typeof mediaQuery.removeEventListener === "function") {
      mediaQuery.removeEventListener("change", this.#dprChangeListener);
    } else {
      mediaQuery.removeListener?.(this.#dprChangeListener);
    }
    this.#dprMediaQuery = undefined;
  }

  #watchDevicePixelRatio(): void {
    this.#unwatchDevicePixelRatio();
    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia !== "function") return;

    const mediaQuery = matchMedia(`(resolution: ${globalThis.devicePixelRatio ?? 1}dppx)`);
    this.#dprMediaQuery = mediaQuery;
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", this.#dprChangeListener);
    } else {
      mediaQuery.addListener?.(this.#dprChangeListener);
    }
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
    const model = transformMat4Into(this.#meshModel, this.#renderObjectTransform(node));
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
      ? this.#gltfInstanceViews(node.instances)
      : undefined;
    const rootHandle = node.kind === "gltf" ? this.#renderObjectHandles.get(node) : undefined;
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

  #gltfInstanceViews(instances: GltfInstanceTransforms): GltfInstanceTransformViews {
    let views = this.#gltfInstanceTransformViews.get(instances);
    if (views === undefined) {
      const transforms: Transform[] = [];
      const rootModels: MutableMat4[] = [];
      for (let index = 0; index < instances.count; index += 1) {
        const offset = index * 3;
        transforms.push({
          position: instances.positions.subarray(offset, offset + 3) as unknown as Vec3,
          rotation: instances.rotations.subarray(offset, offset + 3) as unknown as EulerRads,
          scale: instances.scales.subarray(offset, offset + 3) as unknown as Vec3,
        });
        rootModels.push(identityMat4());
      }
      views = {
        activeApplied: false,
        changes: new GltfInstanceChangeTracker(instances.count),
        framePoseVersion: instances.poseVersion,
        frameScaleVersion: instances.scaleVersion,
        matrixPoseVersion: -1,
        matrixScaleVersion: -1,
        rootModels,
        source: instances,
        sourceKey: this.#gltfInstanceSourceKey++,
        transforms,
      };
      this.#gltfInstanceTransformViews.set(instances, views);
    }
    if (this.#gltfInstanceFrameActive && !views.activeApplied) {
      const pose = views.changes.activePose;
      const scale = views.changes.activeScale;
      const firstWord = Math.min(pose.minDirtyWord, scale.minDirtyWord);
      const lastWord = Math.max(pose.maxDirtyWord, scale.maxDirtyWord);
      for (let wordIndex = firstWord; wordIndex <= lastWord; wordIndex += 1) {
        let word = pose.words[wordIndex]! | scale.words[wordIndex]!;
        while (word !== 0) {
          const bit = 31 - Math.clz32(word & -word);
          const index = wordIndex * 32 + bit;
          if (index < views.transforms.length) {
            transformMat4Into(views.rootModels[index]!, views.transforms[index]);
          }
          word &= word - 1;
        }
      }
      views.activeApplied = true;
      views.matrixPoseVersion = views.framePoseVersion;
      views.matrixScaleVersion = views.frameScaleVersion;
    } else if (
      !this.#gltfInstanceFrameActive
      && (
        views.matrixPoseVersion !== instances.poseVersion
        || views.matrixScaleVersion !== instances.scaleVersion
      )
    ) {
      for (let index = 0; index < views.transforms.length; index += 1) {
        transformMat4Into(views.rootModels[index]!, views.transforms[index]);
      }
      views.matrixPoseVersion = instances.poseVersion;
      views.matrixScaleVersion = instances.scaleVersion;
    }
    return views;
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
      if (typeof gl.blendFuncSeparate === "function") {
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      } else {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
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
      specular: {
        encoding: "linear",
        intensity: environment.radianceScaleNits,
        key: specular.key,
        mipCount: specular.mipCount,
        texture: specular.texture,
        worldToIbl,
      },
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
    const previousEpoch = this.#sharedViewLodSelections.epoch;
    const epoch = beginSharedViewLodSelections(this.#sharedViewLodSelections);
    if (epoch <= previousEpoch) {
      this.#sharedViewLodTouchEpochs.fill(0);
      this.#sharedViewLodTouchPhases.fill(0);
      this.#sharedViewNodeLodFallbackEpochs.fill(0);
    }
    this.#sharedViewNodeLodCount = 0;
    this.#sharedViewMaterialLodCount = 0;

    for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
      copyFrameViewMatrixInto(this.#renderViewProjection, frameViews.viewProjections, viewIndex);
      this.#visitGltfLodRoots(plan, this.#renderViewProjection, 1);
    }
    this.#finalizeSharedViewNodeLodSelections();

    for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
      copyFrameViewMatrixInto(this.#renderViewProjection, frameViews.viewProjections, viewIndex);
      this.#visitGltfLodRoots(plan, this.#renderViewProjection, 2);
    }
    this.#finalizeSharedViewLodSelections(this.#sharedViewMaterialLodIds, this.#sharedViewMaterialLodCount);
  }

  #selectGltfFramePackets(plan: FramePlan, frameViews: FrameViews): void {
    const topology = this.#gltfPacketTopology;
    const selected = this.#selectedGltfFramePackets;
    beginSelectedFramePacketViews(selected, topology.catalog, frameViews.count);
    for (let viewIndex = 0; viewIndex < frameViews.count; viewIndex += 1) {
      beginSelectedFramePacketView(selected, topology.catalog, viewIndex);
      copyFrameViewMatrixInto(this.#renderViewProjection, frameViews.viewProjections, viewIndex);
      for (let occurrenceIndex = 0; occurrenceIndex < topology.occurrenceCount; occurrenceIndex += 1) {
        const requestRow = plan.gltfRequestRows[occurrenceIndex]!;
        const node = plan.nodes[requestRow.nodeIndex] as AnyGltfNode;
        const instanceViews = node.kind === "gltf-instances"
          ? this.#gltfInstanceViews(node.instances)
          : undefined;
        const rootHandle = node.kind === "gltf" ? this.#renderObjectHandles.get(node) : undefined;
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
            this.#sharedViewLodSelections.selectedLevels,
            this.#sharedViewLodSelections.selectionEpochs,
            this.#sharedViewLodSelections.epoch,
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
        const views = this.#gltfInstanceViews(node.instances);
        for (let outerIndex = 0; outerIndex < node.instances.count; outerIndex += 1) {
          const rootModel = views.rootModels[outerIndex]!;
          multiplyMat4Into(this.#sharedViewLodRootViewProjection, viewProjection, rootModel);
          this.#observeSharedViewGltfLodRoot(
            state, node, `instance:${ordinal}:${outerIndex}`, this.#sharedViewLodRootViewProjection, phase,
          );
        }
        continue;
      }
      const rootHandle = this.#renderObjectHandles.get(node);
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
        const id = this.#sharedViewNodeLodSelectionId(state, selectionKey, nodeLod);
        this.#touchSharedViewLodSelection(id, phase);
        if (nodeLod.level !== 0) {
          for (const bounds of primitive.localBounds) {
            if (!isBoundsVisible(bounds, rootViewProjectionModel)) continue;
            this.#observeSharedViewNodeLodFallback(id, nodeLod.level);
          }
          continue;
        }
        for (const bounds of primitive.localBounds) {
          if (!isBoundsVisible(bounds, rootViewProjectionModel)) continue;
          observeSharedViewLodCoverage(
            this.#sharedViewLodSelections,
            id,
            projectedBoundsScreenCoverage(bounds, rootViewProjectionModel),
          );
        }
        continue;
      }
      if (nodeLod !== undefined) {
        const nodeSelectionKey = `${state.key}:${renderInstanceKey}:node:${nodeLod.group}`;
        if (this.#sharedViewSelectedLodLevel(nodeSelectionKey) !== nodeLod.level) continue;
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
        const id = this.#sharedViewMaterialLodSelectionId(selectionKey, materialLod);
        this.#touchSharedViewLodSelection(id, phase);
        observeSharedViewLodCoverage(
          this.#sharedViewLodSelections,
          id,
          projectedBoundsScreenCoverage(bounds, rootViewProjectionModel),
        );
      }
    }
  }

  #sharedViewNodeLodSelectionId(
    state: GltfState,
    selectionKey: string,
    lod: GltfNodePrimitiveLod,
  ): number {
    const metadataKey = `${state.key}:node:${lod.group}`;
    let metadata = this.#sharedViewLodMetadata.get(metadataKey);
    if (metadata === undefined) {
      const drawableLevels = new Uint8Array(lod.levelCount);
      for (const primitive of state.primitives) {
        if (primitive.nodeLod?.group === lod.group) drawableLevels[primitive.nodeLod.level] = 1;
      }
      metadata = validateSharedViewLodMetadata({
        drawableLevels,
        levelCount: lod.levelCount,
        offset: 0,
        thresholds: Float64Array.from(lod.thresholds),
      });
      this.#sharedViewLodMetadata.set(metadataKey, metadata);
    }
    return this.#sharedViewLodSelectionId(selectionKey, metadata);
  }

  #sharedViewMaterialLodSelectionId(
    selectionKey: string,
    lod: GltfMaterialPrimitiveLod,
  ): number {
    const metadataKey = `material:${lod.thresholds.join(",")}:${lod.levels.length}`;
    let metadata = this.#sharedViewLodMetadata.get(metadataKey);
    if (metadata === undefined) {
      metadata = validateSharedViewLodMetadata({
        drawableLevels: new Uint8Array(lod.levels.length).fill(1),
        levelCount: lod.levels.length,
        offset: 0,
        thresholds: Float64Array.from(lod.thresholds),
      });
      this.#sharedViewLodMetadata.set(metadataKey, metadata);
    }
    return this.#sharedViewLodSelectionId(selectionKey, metadata);
  }

  #sharedViewLodSelectionId(selectionKey: string, metadata: SharedViewLodMetadata): number {
    const existing = this.#sharedViewLodSelectionIds.get(selectionKey);
    if (existing !== undefined) return existing;
    const id = this.#sharedViewLodSelectionIdCount;
    this.#sharedViewLodSelectionIdCount += 1;
    reserveSharedViewLodSelections(this.#sharedViewLodSelections, id + 1);
    this.#reserveSharedViewLodScratch(id + 1);
    this.#sharedViewLodSelectionIds.set(selectionKey, id);
    this.#sharedViewLodMetadataById[id] = metadata;
    return id;
  }

  #invalidateGltfPacketLodRegistry(state: GltfState): void {
    const selectionPrefix = `${state.key}:`;
    for (const selectionKey of this.#sharedViewLodSelectionIds.keys()) {
      if (selectionKey.startsWith(selectionPrefix)) this.#sharedViewLodSelectionIds.delete(selectionKey);
    }
    const nodeMetadataPrefix = `${state.key}:node:`;
    for (const metadataKey of this.#sharedViewLodMetadata.keys()) {
      if (metadataKey.startsWith(nodeMetadataPrefix)) this.#sharedViewLodMetadata.delete(metadataKey);
    }
  }

  #reserveSharedViewLodScratch(minimumCapacity: number): void {
    if (minimumCapacity <= this.#sharedViewLodTouchEpochs.length) return;
    const capacity = this.#sharedViewLodSelections.capacity;
    const touchEpochs = new Uint32Array(capacity);
    touchEpochs.set(this.#sharedViewLodTouchEpochs);
    this.#sharedViewLodTouchEpochs = touchEpochs;
    const touchPhases = new Uint8Array(capacity);
    touchPhases.set(this.#sharedViewLodTouchPhases);
    this.#sharedViewLodTouchPhases = touchPhases;
    const fallbackEpochs = new Uint32Array(capacity);
    fallbackEpochs.set(this.#sharedViewNodeLodFallbackEpochs);
    this.#sharedViewNodeLodFallbackEpochs = fallbackEpochs;
    const fallbackLevels = new Uint32Array(capacity);
    fallbackLevels.set(this.#sharedViewNodeLodFallbackLevels);
    this.#sharedViewNodeLodFallbackLevels = fallbackLevels;
    const nodeIds = new Uint32Array(capacity);
    nodeIds.set(this.#sharedViewNodeLodIds);
    this.#sharedViewNodeLodIds = nodeIds;
    const materialIds = new Uint32Array(capacity);
    materialIds.set(this.#sharedViewMaterialLodIds);
    this.#sharedViewMaterialLodIds = materialIds;
  }

  #observeSharedViewNodeLodFallback(id: number, level: number): void {
    const epoch = this.#sharedViewLodSelections.epoch;
    if (this.#sharedViewNodeLodFallbackEpochs[id] !== epoch) {
      this.#sharedViewNodeLodFallbackEpochs[id] = epoch;
      this.#sharedViewNodeLodFallbackLevels[id] = level;
      return;
    }
    if (level < this.#sharedViewNodeLodFallbackLevels[id]!) {
      this.#sharedViewNodeLodFallbackLevels[id] = level;
    }
  }

  #finalizeSharedViewNodeLodSelections(): void {
    const epoch = this.#sharedViewLodSelections.epoch;
    for (let index = 0; index < this.#sharedViewNodeLodCount; index += 1) {
      const id = this.#sharedViewNodeLodIds[index]!;
      const metadata = this.#sharedViewLodMetadataById[id];
      if (metadata === undefined) throw new Error("Royal shared-view LOD selection is missing metadata");
      if (
        !sharedViewLodWasObserved(this.#sharedViewLodSelections, id)
        && this.#sharedViewNodeLodFallbackEpochs[id] === epoch
      ) {
        // LOD0 coverage remains authoritative. With no visible LOD0 in any
        // view, select the finest visible drawable lower member exactly.
        finalizeUnobservedSharedViewLodFallback(
          this.#sharedViewLodSelections,
          id,
          metadata,
          this.#sharedViewNodeLodFallbackLevels[id]!,
        );
      } else {
        finalizeSharedViewLodSelection(this.#sharedViewLodSelections, id, metadata);
      }
    }
  }

  #touchSharedViewLodSelection(id: number, phase: 1 | 2): void {
    const epoch = this.#sharedViewLodSelections.epoch;
    if (this.#sharedViewLodTouchEpochs[id] === epoch && this.#sharedViewLodTouchPhases[id] === phase) return;
    this.#sharedViewLodTouchEpochs[id] = epoch;
    this.#sharedViewLodTouchPhases[id] = phase;
    if (phase === 1) {
      this.#sharedViewNodeLodIds[this.#sharedViewNodeLodCount] = id;
      this.#sharedViewNodeLodCount += 1;
    } else {
      this.#sharedViewMaterialLodIds[this.#sharedViewMaterialLodCount] = id;
      this.#sharedViewMaterialLodCount += 1;
    }
  }

  #finalizeSharedViewLodSelections(ids: Uint32Array, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const id = ids[index]!;
      const metadata = this.#sharedViewLodMetadataById[id];
      if (metadata === undefined) throw new Error("Royal shared-view LOD selection is missing metadata");
      finalizeSharedViewLodSelection(this.#sharedViewLodSelections, id, metadata);
    }
  }

  #sharedViewSelectedLodLevel(selectionKey: string): number | undefined {
    const id = this.#sharedViewLodSelectionIds.get(selectionKey);
    return id === undefined ? undefined : sharedViewLodSelectedLevel(this.#sharedViewLodSelections, id);
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
        && state.imageRows.get(loadedMaterial.baseColorTexture.imageUri)?.status === "ready"
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
    this.#registerAutoBaseColorVirtualTextureManifest(texture, slot?.sourceUri);
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
    cpuGeometry?: CpuGeometry,
  ): void {
    const baseColorResidency = this.#resolveBaseColorTextureResidency(
      geometry,
      material,
      this.#virtualTextureDrawDemandContext(
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
      this.#contextGeneration,
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
    rootInstanceViews: readonly (GltfInstanceTransformViews | undefined)[],
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
      this.#virtualTextureInstancedDrawDemandContext(
        cpuGeometry,
        material,
        localModels,
        rootModels,
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
      this.#contextGeneration,
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
      this.#contextGeneration,
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
    this.#bindEmissiveTexture(program, material, plan);
    this.#bindMetallicRoughnessTexture(program, material, plan);
    this.#bindNormalTexture(program, material, plan);
    this.#bindOcclusionTexture(program, material, plan);
    this.#bindMaterialExtensionTextures(program, material, plan);
  }

  #bindSurfaceTextureCoordinates(
    program: WebGLProgram,
    material: SurfaceMaterial,
    plan: SurfaceTextureBindingPlan,
  ): void {
    for (const [feature, key, setUniform, row0Uniform, row1Uniform] of SURFACE_TEXTURE_COORDINATE_BINDINGS) {
      const preparedCoordinates = material.textureCoordinates?.[key];
      const active = preparedCoordinates !== undefined
        || plan.features.has(feature)
        || (feature === "baseColorTexture" && (
          plan.features.has("baseColorVirtualTextureAtlas")
          || plan.features.has("baseColorVirtualTexturePageTable")
      ));
      if (!active) continue;
      const coordinates = preparedCoordinates ?? IDENTITY_GLTF_TEXTURE_COORDINATES;
      uniform1i(this.#programArena, program, setUniform, coordinates.set);
      uniformColor(this.#programArena, program, row0Uniform, coordinates.row0);
      uniformColor(this.#programArena, program, row1Uniform, coordinates.row1);
    }
  }

  #surfaceTextureUnitAllocator(reserveClusterUnits: boolean): TextureUnitAllocator {
    return { reserveClusterUnits, used: new Set() };
  }

  #surfaceTextureBindingPlan(
    material: SurfaceMaterial,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    lightSet: SurfaceLightSet,
    baseColorResidency: BaseColorTextureResidency,
  ): SurfaceTextureBindingPlan {
    const features = new Set<SurfaceShaderTextureFeature>();
    const textureUnits = new Map<SurfaceShaderTextureFeature, number>();
    const allocator = this.#surfaceTextureUnitAllocator(
      lightSet.punctuals.length > 0,
    );
    const reserveTextureUnit = (
      feature: SurfaceShaderTextureFeature,
      preferred: number,
    ): number | undefined => {
      const unit = this.#allocateTextureUnit(allocator, preferred);
      if (unit === undefined) return undefined;
      features.add(feature);
      textureUnits.set(feature, unit);
      return unit;
    };
    const releaseTextureUnit = (feature: SurfaceShaderTextureFeature): void => {
      const unit = textureUnits.get(feature);
      if (unit === undefined) return;
      textureUnits.delete(feature);
      features.delete(feature);
      allocator.used.delete(unit);
    };
    const reserveTextureUnits = (
      requested: readonly (readonly [feature: SurfaceShaderTextureFeature, preferred: number])[],
    ): boolean => {
      const reserved: SurfaceShaderTextureFeature[] = [];
      for (const [feature, preferred] of requested) {
        if (reserveTextureUnit(feature, preferred) === undefined) {
          for (const reservedFeature of reserved) releaseTextureUnit(reservedFeature);
          return false;
        }
        reserved.push(feature);
      }
      return true;
    };
    const reserveMaterialTexture = (
      feature: SurfaceShaderTextureFeature,
      preferred: number,
      texture: TextureAssetUploadRef | undefined,
    ): void => {
      if (texture === undefined) return;
      reserveTextureUnit(feature, preferred);
    };
    const reserveOrdinaryBaseColor = (
      texture: TextureAssetUploadRef,
    ): SurfaceBaseColorTextureBinding | undefined =>
      reserveTextureUnit("baseColorTexture", 0) === undefined
        ? undefined
        : { kind: "ordinary", texture };
    const reserveVirtualBaseColor = (
      state: VirtualTextureRuntimeState,
    ): SurfaceBaseColorTextureBinding | undefined => {
      if (!this.#isVirtualTextureDrawable(state)) return undefined;
      return reserveTextureUnits([
        ["baseColorVirtualTextureAtlas", 0],
        ["baseColorVirtualTexturePageTable", 1],
      ])
        ? { kind: "prepared-virtual", state }
        : undefined;
    };
    const reserveBaseColor = (): SurfaceBaseColorTextureBinding => {
      switch (baseColorResidency.kind) {
        case "none":
          return { kind: "none" };
        case "ordinary":
          return reserveOrdinaryBaseColor(baseColorResidency.texture) ?? { kind: "none" };
        case "prepared-virtual": {
          const virtualBaseColor = reserveVirtualBaseColor(baseColorResidency.state);
          if (virtualBaseColor !== undefined) return virtualBaseColor;
          if (!this.#isVirtualTextureDrawable(baseColorResidency.state)) {
            baseColorResidency.state.stats.unreadyDraws += 1;
          }
          const fallback = baseColorResidency.ordinaryFallback;
          return fallback === undefined
            ? { kind: "none" }
            : reserveOrdinaryBaseColor(fallback) ?? { kind: "none" };
        }
      }
    };

    const baseColor = reserveBaseColor();
    if (lightSet.specular !== undefined && IBL_SPECULAR_TEXTURE_UNIT < this.#maxTextureImageUnits) {
      features.add("iblSpecularCube");
      textureUnits.set("iblSpecularCube", IBL_SPECULAR_TEXTURE_UNIT);
      allocator.used.add(IBL_SPECULAR_TEXTURE_UNIT);
    }
    if (transmissionScreenColorTexture?.uploaded === true) {
      reserveTextureUnit("transmissionScreenTexture", 1);
    }

    reserveMaterialTexture("emissiveTexture", 4, material.emissiveTexture);
    reserveMaterialTexture(
      "metallicRoughnessTexture",
      3,
      material.kind === "standard" ? material.metallicRoughnessTexture : undefined,
    );
    reserveMaterialTexture(
      "normalTexture",
      1,
      material.kind === "standard" ? material.normalTexture : undefined,
    );
    reserveMaterialTexture(
      "occlusionTexture",
      5,
      material.kind === "standard" ? material.occlusionTexture : undefined,
    );
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURE_BINDINGS) {
      reserveMaterialTexture(
        SURFACE_SHADER_FEATURE_BY_EXTENSION_TEXTURE_KEY[texture.key],
        texture.textureUnit,
        material.kind === "standard" ? material[texture.key] : undefined,
      );
    }
    if (lightSet.specular !== undefined && features.has("iblSpecularCube")) {
      const clusterUnits = clusteredLightTextureUnits(this.#clusteredLights);
      reserveTextureUnit(
        "iblBrdfLut",
        allocator.reserveClusterUnits && clusterUnits.grid > 0
          ? clusterUnits.grid - 1
          : IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT,
      );
    }

    return { baseColor, features, textureUnits };
  }

  #bindSurfaceToneMapping(program: WebGLProgram, toneMapping: SceneToneMappingState): void {
    uniformColor(this.#programArena, program, "u_toneMappingSettings", [
      toneMapping.toneMapping === "aces-fitted" ? 1 : toneMapping.toneMapping === "pbr-neutral" ? 2 : 0,
      toneMapping.exposure,
      toneMapping.hdrOutput ? 1 : 0,
      0,
    ]);
  }

  #allocateTextureUnit(allocator: TextureUnitAllocator, preferred: number): number | undefined {
    const maxTextureImageUnits = this.#maxTextureImageUnits;
    const clusterUnits = clusteredLightTextureUnits(this.#clusteredLights);
    if (maxTextureImageUnits <= 0) return undefined;
    const reservedForClusters = (unit: number): boolean => allocator.reserveClusterUnits && (
      unit === clusterUnits.grid
      || unit === clusterUnits.indices
      || unit === clusterUnits.lights
    );
    if (preferred < maxTextureImageUnits && !reservedForClusters(preferred) && !allocator.used.has(preferred)) {
      allocator.used.add(preferred);
      return preferred;
    }
    for (let unit = 0; unit < maxTextureImageUnits; unit += 1) {
      if (reservedForClusters(unit) || allocator.used.has(unit)) continue;
      allocator.used.add(unit);
      return unit;
    }

    return undefined;
  }

  #bindEmissiveTexture(
    program: WebGLProgram,
    material: SurfaceMaterial,
    plan: SurfaceTextureBindingPlan,
  ): void {
    this.#bindCachedTexture2d(
      program,
      "u_useEmissiveTexture",
      "u_emissiveTexture",
      "emissiveTexture",
      material.emissiveTexture,
      plan,
    );
  }

  #bindMetallicRoughnessTexture(
    program: WebGLProgram,
    material: SurfaceMaterial,
    plan: SurfaceTextureBindingPlan,
  ): void {
    this.#bindCachedTexture2d(
      program,
      "u_useMetallicRoughnessTexture",
      "u_metallicRoughnessTexture",
      "metallicRoughnessTexture",
      material.kind === "standard" ? material.metallicRoughnessTexture : undefined,
      plan,
    );
  }

  #bindNormalTexture(
    program: WebGLProgram,
    material: SurfaceMaterial,
    plan: SurfaceTextureBindingPlan,
  ): void {
    uniformColor(this.#programArena, program, "u_normalTextureSettings", [
      material.kind === "standard" ? material.normalScale ?? 1 : 1,
      0,
      0,
      0,
    ]);
    this.#bindCachedTexture2d(
      program,
      "u_useNormalTexture",
      "u_normalTexture",
      "normalTexture",
      material.kind === "standard" ? material.normalTexture : undefined,
      plan,
    );
  }

  #bindOcclusionTexture(
    program: WebGLProgram,
    material: SurfaceMaterial,
    plan: SurfaceTextureBindingPlan,
  ): void {
    uniformColor(this.#programArena, program, "u_occlusionSettings", [
      surfaceMaterialOcclusionStrength(material),
      0,
      0,
      0,
    ]);
    this.#bindCachedTexture2d(
      program,
      "u_useOcclusionTexture",
      "u_occlusionTexture",
      "occlusionTexture",
      material.kind === "standard" ? material.occlusionTexture : undefined,
      plan,
    );
  }

  #bindMaterialExtensionTextures(
    program: WebGLProgram,
    material: SurfaceMaterial,
    plan: SurfaceTextureBindingPlan,
  ): void {
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURE_BINDINGS) {
      this.#bindCachedTexture2d(
        program,
        texture.useUniform,
        texture.samplerUniform,
        SURFACE_SHADER_FEATURE_BY_EXTENSION_TEXTURE_KEY[texture.key],
        material.kind === "standard" ? material[texture.key] : undefined,
        plan,
      );
    }
  }

  #bindCachedTexture2d(
    program: WebGLProgram,
    useUniform: string,
    samplerUniform: string,
    feature: SurfaceShaderTextureFeature,
    texture: TextureAssetUploadRef | undefined,
    plan: SurfaceTextureBindingPlan,
  ): void {
    if (texture === undefined) {
      uniform1i(this.#programArena, program, useUniform, 0);
      return;
    }

    const resource = this.#texture(texture);
    if (!resource.uploaded) {
      uniform1i(this.#programArena, program, useUniform, 0);
      return;
    }

    const gl = this.#gl;
    const allocatedUnit = plan.textureUnits.get(feature);
    if (allocatedUnit === undefined) {
      uniform1i(this.#programArena, program, useUniform, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE0 + allocatedUnit);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    uniform1i(this.#programArena, program, samplerUniform, allocatedUnit);
    uniform1i(this.#programArena, program, useUniform, 1);
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
    bindSurfaceIbl(
      this.#iblTextures,
      this.#programArena,
      program,
      lightSet,
      plan.textureUnits.get("iblBrdfLut"),
    );

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
      this.#contextGeneration,
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
      case "prepared-virtual":
        return this.#bindVirtualTexture(program, binding.state, plan)
          ? binding
          : { kind: "none" };
      case "none":
        return { kind: "none" };
    }
  }

  #bindOrdinaryBaseColorTexture(
    program: WebGLProgram,
    binding: Extract<SurfaceBaseColorTextureBinding, { readonly kind: "ordinary" }>,
    plan: SurfaceTextureBindingPlan,
  ): boolean {
    const textureUnit = plan.textureUnits.get("baseColorTexture");
    if (textureUnit === undefined) return false;
    const resource = this.#texture(binding.texture);
    if (!resource.uploaded) return false;
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    uniform1i(this.#programArena, program, "u_texture", textureUnit);
    return true;
  }

  #virtualTextureDrawDemandContext(
    geometry: CpuGeometry | undefined,
    material: Material,
    modelSource: VirtualTextureDrawDemandModelSource,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
  ): VirtualTextureDrawDemandContext | undefined {
    if (
      geometry?.texCoords0 === undefined
      || geometry.mode !== "triangles"
      || this.#virtualTextureDrawDemandModelCount(modelSource) === 0
    ) {
      return undefined;
    }
    const baseColorCoordinates = material.kind === "wireframe"
      ? undefined
      : (material as SurfaceMaterial).textureCoordinates?.baseColorTexture;
    return {
      modelSource,
      positions: geometry.positions,
      projection,
      texCoords: baseColorCoordinates?.set === 1
          ? geometry.texCoords1 ?? geometry.texCoords0
          : geometry.texCoords0,
      ...(baseColorCoordinates === undefined ? {} : { textureCoordinates: baseColorCoordinates }),
      view,
      viewportSize,
    };
  }

  #virtualTextureInstancedDrawDemandContext(
    geometry: CpuGeometry | undefined,
    material: Material,
    localModels: readonly Mat4[],
    rootModels: readonly Mat4[],
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
  ): VirtualTextureDrawDemandContext | undefined {
    if (material.baseColor.kind === "solid") return undefined;
    if (geometry?.texCoords0 === undefined || geometry.mode !== "triangles" || localModels.length === 0) return undefined;
    return this.#virtualTextureDrawDemandContext(
      geometry,
      material,
      { kind: "composed", localModels, rootModels },
      projection,
      view,
      viewportSize,
    );
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
    const plan = this.#autoBaseColorVirtualTexturePlan(texture);
    if (plan === undefined) return ordinary;

    const virtualTexture = this.#autoBaseColorVirtualTextureRef(texture, plan);
    const state = this.#virtualTexture(virtualTexture, {
      autoPlan: plan,
      cacheNamespace: `auto-base-color:${textureKey}`,
      diagnosticsEnabled: false,
    });
    state.stats.preparedResidencyResolutions += 1;
    const drawDemand = state.status === "ready"
      ? this.#virtualTextureDrawDemand(state, demandContext)
      : undefined;
    if (drawDemand !== undefined) this.#demandVirtualTexturePageCandidates(state, drawDemand.demandCandidates);

    return this.#isAutoVirtualTextureCoverageReady(state, drawDemand)
      ? { kind: "prepared-virtual", ordinaryFallback: texture, state }
      : ordinary;
  }

  #autoBaseColorVirtualTextureRef(
    texture: TextureAssetUploadRef,
    plan: AutoVirtualTexturePlan,
  ): VirtualTextureRef {
    const key = `auto-base-color:${textureCacheKey(texture)}`;
    const cached = this.#autoVirtualTextureRefs.get(key);
    if (cached !== undefined) return cached;

    const virtualTexture: VirtualTextureRef = {
      kind: "virtual-asset",
      ...(texture.colorSpace === undefined ? {} : { colorSpace: texture.colorSpace }),
      ...(texture.contentKey === undefined ? {} : { contentKey: texture.contentKey }),
      debugName: `auto:${texture.uri}`,
      manifestUri: plan.primary.manifestUri,
      ...(texture.sampler === undefined ? {} : { sampler: texture.sampler }),
      ...(texture.version === undefined ? {} : { version: texture.version }),
    };
    this.#autoVirtualTextureRefs.set(key, virtualTexture);
    return virtualTexture;
  }

  #autoBaseColorVirtualTexturePlan(texture: TextureAssetUploadRef): AutoVirtualTexturePlan | undefined {
    const textureKey = textureCacheKey(texture);
    const generatedPageSource = this.#autoBaseColorVirtualTextureGeneratedPageSource(texture);
    const sidecarManifestUri = this.#autoVirtualTextureManifestUris.get(textureKey)
      ?? this.#autoBaseColorVirtualTextureSidecarManifestUriForUri(texture.uri);
    return autoVirtualTexturePlan({
      ...(generatedPageSource === undefined ? {} : { generatedPageSource }),
      ...(sidecarManifestUri === undefined ? {} : { sidecarManifestUri }),
      textureKey,
    });
  }

  #registerAutoBaseColorVirtualTextureManifest(
    texture: TextureAssetUploadRef,
    sourceUri: string | undefined,
  ): void {
    if (sourceUri === undefined) return;
    const manifestUri = this.#autoBaseColorVirtualTextureSidecarManifestUriForUri(sourceUri);
    if (manifestUri === undefined) return;
    this.#autoVirtualTextureManifestUris.set(textureCacheKey(texture), manifestUri);
  }

  #registerAutoBaseColorVirtualTextureGeneratedPageSource(
    texture: TextureAssetUploadRef,
    source: VirtualTextureGeneratedPageSource | undefined,
  ): void {
    if (source === undefined) return;
    this.#autoVirtualTextureGeneratedPageSources.set(textureCacheKey(texture), source);
  }

  #registerAutoBaseColorVirtualTextureRasterPageSource(
    texture: TextureAssetUploadRef,
    source: LoadedTextureSource,
  ): void {
    if (!this.#options.generatedRasterVirtualTextures) return;
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

  #autoBaseColorVirtualTextureGeneratedPageSource(
    texture: TextureAssetUploadRef,
  ): VirtualTextureGeneratedPageSource | undefined {
    return this.#autoVirtualTextureGeneratedPageSources.get(textureCacheKey(texture));
  }

  #autoBaseColorVirtualTextureSidecarManifestUriForUri(uriInput: string): string | undefined {
    const uri = uriInput.trim();
    if (uri.length === 0) return undefined;

    const schemeSeparator = uri.indexOf(":");
    if (schemeSeparator >= 0) {
      const scheme = uri.slice(0, schemeSeparator).toLowerCase();
      if (scheme !== "http" && scheme !== "https") return undefined;
    }

    const queryIndex = uri.search(/[?#]/u);
    return queryIndex < 0
      ? `${uri}.vt.json`
      : `${uri.slice(0, queryIndex)}.vt.json${uri.slice(queryIndex)}`;
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
      readonly autoPlan?: AutoVirtualTexturePlan;
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
      if (options.autoPlan !== undefined) cached.autoPlan = options.autoPlan;
      if (
        (cached.status === "error" || cached.status === "unsupported")
        && cached.activeSource.kind !== "generated"
      ) {
        this.#fallbackVirtualTextureSource(cached, "late-generated-source");
      }
      return cached;
    }
    const activeSource = options.autoPlan?.primary ?? {
      kind: "sidecar" as const,
      manifestUri: texture.manifestUri,
    };

    const state: VirtualTextureRuntimeState = {
      activeSource,
      ...(options.autoPlan === undefined ? {} : { autoPlan: options.autoPlan }),
      diagnosticsEnabled,
      key,
      loadingPages: new Set(),
      pendingUploads: [],
      requestedPages: new Set(),
      sourceGeneration: 1,
      stats: {
        generatedManifestUses: 0,
        generatedPageFailures: 0,
        generatedPageRasterizeMaxMs: 0,
        generatedPageRasterizeMs: 0,
        generatedPageRequests: 0,
        generatedPagesTarget: 0,
        manifestFailures: 0,
        manifestRequests: activeSource.kind === "sidecar" ? 1 : 0,
        pageTableUpdates: 0,
        preparedResidencyResolutions: 0,
        shaderBinds: 0,
        unreadyDraws: 0,
        unsupportedDraws: 0,
        uploadedPageBytes: 0,
        uploadedPages: 0,
      },
      status: "loading",
      texture,
      uploadedPages: new Set(),
    };
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
        void this.#loadVirtualTextureManifest(state);
        return;
    }
  }

  async #loadVirtualTextureManifest(state: VirtualTextureRuntimeState): Promise<void> {
    const source = state.activeSource;
    if (source.kind !== "sidecar") return;
    const sourceGeneration = state.sourceGeneration;
    try {
      const response = await fetch(source.manifestUri);
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
      ) return;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const payload = await response.json() as unknown;
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
      ) return;

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
        if (this.#fallbackVirtualTextureSource(state, "parse-failed")) return;
        this.#failVirtualTexture(state, "manifest parse failed");
        return;
      }

      const manifestUnsupported = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "unsupported");
      if (manifestUnsupported !== undefined) {
        if (this.#fallbackVirtualTextureSource(state, "manifest-unsupported")) return;
        this.#markVirtualTextureUnsupported(
          state,
          manifestUnsupported.message,
        );
        return;
      }
      const runtimeUnsupported = this.#contextLifecycle === "active"
        ? this.#unsupportedVirtualTextureRuntimeReason(parsed.manifest)
        : undefined;
      if (this.#contextLifecycle === "active" && runtimeUnsupported !== undefined) {
        if (this.#fallbackVirtualTextureSource(state, "runtime-unsupported")) return;
        this.#markVirtualTextureUnsupported(state, runtimeUnsupported);
        return;
      }

      state.manifest = parsed.manifest;
      state.pageUrisByKey = virtualTextureExplicitPageUrisByKey(parsed.manifest);
      state.status = "ready";
      if (this.#contextLifecycle === "active") {
        this.#allocateVirtualTextureResources(state, parsed.manifest);
        this.#demandVirtualTexturePages(state);
      }
      this.invalidate();
    } catch (error) {
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
      ) return;
      if (this.#fallbackVirtualTextureSource(state, "fetch-failed")) return;
      this.#failVirtualTexture(state, error instanceof Error ? error.message : String(error));
    }
  }

  #fallbackVirtualTextureSource(
    state: VirtualTextureRuntimeState,
    trigger: VirtualTextureFallbackTrigger,
  ): boolean {
    const plan = state.autoPlan;
    if (
      plan?.fallback === undefined
      || state.activeSource.kind === "generated"
      || !plan.fallbackTriggers.has(trigger)
    ) return false;

    state.activeSource = plan.fallback;
    state.sourceGeneration += 1;
    state.loadingPages.clear();
    state.requestedPages.clear();
    state.uploadedPages.clear();
    for (const upload of state.pendingUploads) closeTexImageSource(upload.image);
    state.pendingUploads.length = 0;
    state.status = "loading";
    delete state.manifest;
    delete state.pageUrisByKey;
    this.#useGeneratedVirtualTextureManifest(state, plan.fallback);
    return true;
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
    const unsupported = this.#contextLifecycle === "active"
      ? this.#unsupportedVirtualTextureRuntimeReason(manifest)
      : undefined;
    if (unsupported !== undefined) {
      this.#markVirtualTextureUnsupported(state, unsupported);
      return;
    }

    state.status = "ready";
    if (this.#contextLifecycle === "active") {
      this.#allocateVirtualTextureResources(state, manifest);
      this.#demandVirtualTexturePages(state);
    }
    this.invalidate();
  }

  #generatedVirtualTextureManifest(
    source: VirtualTextureGeneratedPageSource,
  ): VirtualTextureManifestModel {
    switch (source.kind) {
      case "raster":
        return generatedRasterVirtualTextureManifest(source.source);
      case "svg":
        return generatedSvgVirtualTextureManifest(source.source);
    }
  }

  #unsupportedVirtualTextureRuntimeReason(manifest: VirtualTextureManifestModel): string | undefined {
    const gl = this.#gl;
    const textureUnits = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    if (!Number.isFinite(textureUnits) || textureUnits < 2) {
      return "requires at least two fragment texture units for atlas and page-table textures";
    }

    const pageTableWidth = Math.ceil(manifest.width / manifest.pageSize);
    const pageTableHeight = Math.ceil(manifest.height / manifest.pageSize);
    const physicalSlots = this.#virtualTexturePhysicalSlots(manifest);
    const atlasColumns = Math.ceil(Math.sqrt(physicalSlots));
    const atlasRows = Math.ceil(physicalSlots / atlasColumns);
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if (
      !Number.isFinite(maxTextureSize)
      || pageTableWidth > maxTextureSize
      || pageTableHeight > maxTextureSize
      || atlasColumns * manifest.pageSize > maxTextureSize
      || atlasRows * manifest.pageSize > maxTextureSize
    ) {
      return "atlas or page-table dimensions exceed WebGL2 texture limits";
    }

    return undefined;
  }

  #virtualTexturePhysicalSlots(manifest: VirtualTextureManifestModel): number {
    return Math.max(1, manifest.physicalSlots ?? 4);
  }

  #allocateVirtualTextureResources(
    state: VirtualTextureRuntimeState,
    manifest: VirtualTextureManifestModel,
  ): void {
    if (this.#contextLifecycle !== "active") return;
    const gl = this.#gl;
    const physicalSlots = this.#virtualTexturePhysicalSlots(manifest);
    const atlasGridColumns = Math.ceil(Math.sqrt(physicalSlots));
    const atlasGridRows = Math.ceil(physicalSlots / atlasGridColumns);
    const pageTableWidth = Math.ceil(manifest.width / manifest.pageSize);
    const pageTableHeight = Math.ceil(manifest.height / manifest.pageSize);
    let atlasTexture: WebGLTexture | undefined;
    let pageTableTexture: WebGLTexture | undefined;
    try {
      atlasTexture = createOwnedTexture(this.#textureHandles);
      pageTableTexture = createOwnedTexture(this.#textureHandles);

      prepareTextureUpload(gl, false);
      gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        textureUploadInternalFormat(gl, state.texture.colorSpace),
        atlasGridColumns * manifest.pageSize,
        atlasGridRows * manifest.pageSize,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      this.#setVirtualTextureSampler(
        this.#virtualTextureAtlasMagFilter(state.texture.sampler),
        this.#virtualTextureAtlasMinFilter(state.texture.sampler),
        gl.CLAMP_TO_EDGE,
        gl.CLAMP_TO_EDGE,
      );

      gl.bindTexture(gl.TEXTURE_2D, pageTableTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        pageTableWidth,
        pageTableHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(pageTableWidth * pageTableHeight * 4),
      );
      this.#setVirtualTextureSampler(gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);

      const pageTable = new VirtualTextureAtlasPageTable({ slotCount: physicalSlots });
      state.pageTable = pageTable;
      state.resources = {
        atlasGridColumns,
        atlasGridRows,
        atlasTexture,
        pageTableHeight,
        pageTableTexture,
        pageTableWidth,
      };
    } catch (error) {
      if (pageTableTexture !== undefined) {
        try { releaseOwnedTexture(this.#textureHandles, pageTableTexture); } catch { /* Retry during context release. */ }
      }
      if (atlasTexture !== undefined) {
        try { releaseOwnedTexture(this.#textureHandles, atlasTexture); } catch { /* Retry during context release. */ }
      }
      throw error;
    }
  }

  #setVirtualTextureSampler(magFilter: number, minFilter: number, wrapS: number, wrapT: number): void {
    const gl = this.#gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  }

  #virtualTextureAtlasMagFilter(sampler: TextureSampler | undefined): number {
    return sampler?.magFilter === "nearest" ? this.#gl.NEAREST : this.#gl.LINEAR;
  }

  #virtualTextureAtlasMinFilter(sampler: TextureSampler | undefined): number {
    switch (sampler?.minFilter) {
      case "nearest":
      case "nearest-mipmap-linear":
      case "nearest-mipmap-nearest":
        return this.#gl.NEAREST;
      case "linear":
      case "linear-mipmap-linear":
      case "linear-mipmap-nearest":
      default:
        return this.#gl.LINEAR;
    }
  }

  #demandVirtualTexturePages(
    state: VirtualTextureRuntimeState,
    context?: VirtualTextureDrawDemandContext,
  ): void {
    this.#demandVirtualTexturePageCandidates(state, this.#virtualTextureDemandCandidates(state, context));
  }

  #demandVirtualTexturePageCandidates(
    state: VirtualTextureRuntimeState,
    candidates: readonly VirtualTexturePageId[],
  ): void {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") return;

    const demandBudget = Math.min(
      this.#virtualTexturePhysicalSlots(manifest),
      VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME,
    );
    let requested = 0;
    for (const page of candidates) {
      if (requested >= demandBudget) break;
      if (!this.#canRequestVirtualTexturePage(state)) break;
      if (this.#requestVirtualTexturePage(state, page)) requested += 1;
    }
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

    if (context === undefined) return { demandCandidates: this.#allVirtualTextureDemandCandidates(state) };

    const footprint = this.#virtualTextureScreenFootprint(context);
    if (footprint === undefined) {
      const candidates = this.#allVirtualTextureDemandCandidates(state);
      return { coverageCandidates: candidates, demandCandidates: candidates };
    }

    const targetMip = this.#virtualTextureTargetMip(manifest, footprint);
    const coverageCandidates = this.#virtualTexturePagesForFootprint(manifest, targetMip, footprint)
      .filter((page) => this.#isVirtualTexturePageAvailable(state, page));
    return {
      coverageCandidates,
      demandCandidates: this.#virtualTextureDemandCandidatesForFootprint(
        state,
        manifest,
        targetMip,
        footprint,
        coverageCandidates,
      ),
    };
  }

  #virtualTextureDemandCandidates(
    state: VirtualTextureRuntimeState,
    context: VirtualTextureDrawDemandContext | undefined,
  ): readonly VirtualTexturePageId[] {
    const manifest = state.manifest;
    if (manifest === undefined) return [];
    if (context === undefined) return this.#allVirtualTextureDemandCandidates(state);

    const footprint = this.#virtualTextureScreenFootprint(context);
    if (footprint === undefined) return this.#allVirtualTextureDemandCandidates(state);

    return this.#virtualTextureDemandCandidatesForFootprint(
      state,
      manifest,
      this.#virtualTextureTargetMip(manifest, footprint),
      footprint,
    );
  }

  #virtualTextureDemandCandidatesForFootprint(
    state: VirtualTextureRuntimeState,
    manifest: VirtualTextureManifestModel,
    targetMip: number,
    footprint: VirtualTextureScreenFootprint,
    targetMipPages?: readonly VirtualTexturePageId[],
  ): readonly VirtualTexturePageId[] {
    const mipCount = this.#virtualTextureMipCount(manifest);
    const candidates: VirtualTexturePageId[] = [];
    for (let mip = mipCount - 1; mip >= targetMip; mip -= 1) {
      const pages = mip === targetMip && targetMipPages !== undefined
        ? targetMipPages
        : this.#virtualTexturePagesForFootprint(manifest, mip, footprint);
      for (const page of pages) {
        if (!this.#isVirtualTexturePageAvailable(state, page)) continue;
        candidates.push(page);
        if (candidates.length >= VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW) return candidates;
      }
    }

    return candidates;
  }

  #allVirtualTextureDemandCandidates(state: VirtualTextureRuntimeState): readonly VirtualTexturePageId[] {
    const manifest = state.manifest;
    if (manifest === undefined) return [];

    const candidates = new Map<string, VirtualTexturePageId>();
    for (const page of manifest.pages) {
      if (this.#isVirtualTexturePageAvailable(state, page)) {
        candidates.set(virtualTexturePageKey(page), page);
      }
    }
    if (manifest.uriTemplate !== undefined || state.activeSource.kind === "generated") {
      const mipCount = this.#virtualTextureMipCount(manifest);
      const baseWidth = Math.ceil(manifest.width / manifest.pageSize);
      const baseHeight = Math.ceil(manifest.height / manifest.pageSize);
      for (let mip = 0; mip < mipCount; mip += 1) {
        const width = Math.max(1, Math.ceil(baseWidth / (2 ** mip)));
        const height = Math.max(1, Math.ceil(baseHeight / (2 ** mip)));
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const page = { mip, x, y };
            candidates.set(virtualTexturePageKey(page), page);
          }
        }
      }
    }

    return [...candidates.values()].sort((left, right) =>
      right.mip - left.mip
      || left.y - right.y
      || left.x - right.x);
  }

  #isVirtualTexturePageAvailable(
    state: VirtualTextureRuntimeState,
    page: VirtualTexturePageId,
  ): boolean {
    const manifest = state.manifest;
    if (manifest === undefined) return false;
    if (state.activeSource.kind === "generated") return true;
    return virtualTexturePageUri(manifest, page, state.pageUrisByKey) !== undefined;
  }

  #virtualTextureDrawDemandModelCount(source: VirtualTextureDrawDemandModelSource): number {
    switch (source.kind) {
      case "single":
        return 1;
      case "composed":
        return Math.min(source.localModels.length, source.rootModels.length);
    }
  }

  #virtualTextureScreenFootprint(
    context: VirtualTextureDrawDemandContext,
  ): VirtualTextureScreenFootprint | undefined {
    const [viewportWidth, viewportHeight] = context.viewportSize;
    const modelCount = this.#virtualTextureDrawDemandModelCount(context.modelSource);
    if (viewportWidth <= 0 || viewportHeight <= 0 || context.positions.length === 0 || modelCount === 0) {
      return undefined;
    }

    let minScreenX = Number.POSITIVE_INFINITY;
    let maxScreenX = Number.NEGATIVE_INFINITY;
    let minScreenY = Number.POSITIVE_INFINITY;
    let maxScreenY = Number.NEGATIVE_INFINITY;
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    const vertexCount = Math.min(Math.floor(context.positions.length / 3), Math.floor(context.texCoords.length / 2));
    const projectionView = multiplyMat4(context.projection, context.view);

    for (let modelIndex = 0; modelIndex < modelCount; modelIndex += 1) {
      const source = context.modelSource;
      const model = source.kind === "single"
        ? source.model
        : multiplyMat4(source.rootModels[modelIndex]!, source.localModels[modelIndex]!);
      const mvp = multiplyMat4(projectionView, model);
      for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
        const positionOffset = vertexIndex * 3;
        const x = context.positions[positionOffset]!;
        const y = context.positions[positionOffset + 1]!;
        const z = context.positions[positionOffset + 2]!;
        const clipX = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
        const clipY = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
        const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
        if (Math.abs(clipW) < 0.000001) continue;

        const ndcX = clipX / clipW;
        const ndcY = clipY / clipW;
        if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) continue;

        const screenX = Math.min(viewportWidth, Math.max(0, (ndcX * 0.5 + 0.5) * viewportWidth));
        const screenY = Math.min(viewportHeight, Math.max(0, (ndcY * 0.5 + 0.5) * viewportHeight));
        minScreenX = Math.min(minScreenX, screenX);
        maxScreenX = Math.max(maxScreenX, screenX);
        minScreenY = Math.min(minScreenY, screenY);
        maxScreenY = Math.max(maxScreenY, screenY);

        const texCoordOffset = vertexIndex * 2;
        const sourceU = context.texCoords[texCoordOffset]!;
        const sourceV = context.texCoords[texCoordOffset + 1]!;
        const coordinates = context.textureCoordinates;
        const u = coordinates === undefined
          ? sourceU
          : coordinates.row0[0] * sourceU + coordinates.row0[1] * sourceV + coordinates.row0[2];
        const v = coordinates === undefined
          ? sourceV
          : coordinates.row1[0] * sourceU + coordinates.row1[1] * sourceV + coordinates.row1[2];
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
    }

    if (
      !Number.isFinite(minScreenX)
      || !Number.isFinite(maxScreenX)
      || !Number.isFinite(minU)
      || !Number.isFinite(maxU)
    ) {
      return undefined;
    }

    const normalizedU = normalizeVirtualTextureDemandUvRange(minU, maxU);
    const normalizedV = normalizeVirtualTextureDemandUvRange(minV, maxV);
    return {
      maxU: normalizedU[1],
      maxV: normalizedV[1],
      minU: normalizedU[0],
      minV: normalizedV[0],
      screenHeight: Math.max(1, maxScreenY - minScreenY),
      screenWidth: Math.max(1, maxScreenX - minScreenX),
    };
  }

  #virtualTextureTargetMip(
    manifest: VirtualTextureManifestModel,
    footprint: VirtualTextureScreenFootprint,
  ): number {
    const uvWidth = Math.max(1 / Math.max(1, manifest.width), footprint.maxU - footprint.minU);
    const uvHeight = Math.max(1 / Math.max(1, manifest.height), footprint.maxV - footprint.minV);
    const texelsPerScreenX = (uvWidth * manifest.width) / Math.max(1, footprint.screenWidth);
    const texelsPerScreenY = (uvHeight * manifest.height) / Math.max(1, footprint.screenHeight);
    const texelsPerScreenPixel = Math.max(1, texelsPerScreenX, texelsPerScreenY);
    return Math.min(
      this.#virtualTextureMipCount(manifest) - 1,
      Math.max(0, Math.floor(Math.log2(texelsPerScreenPixel))),
    );
  }

  #virtualTexturePagesForFootprint(
    manifest: VirtualTextureManifestModel,
    mip: number,
    footprint: VirtualTextureScreenFootprint,
  ): readonly VirtualTexturePageId[] {
    const grid = this.#virtualTexturePageGrid(manifest, mip);
    const minX = Math.max(0, Math.min(grid.width - 1, Math.floor(footprint.minU * grid.width)));
    const maxX = Math.max(minX, Math.min(grid.width - 1, Math.ceil(footprint.maxU * grid.width) - 1));
    const minY = Math.max(0, Math.min(grid.height - 1, Math.floor(footprint.minV * grid.height)));
    const maxY = Math.max(minY, Math.min(grid.height - 1, Math.ceil(footprint.maxV * grid.height) - 1));
    const centerX = (footprint.minU + footprint.maxU) * 0.5 * grid.width;
    const centerY = (footprint.minV + footprint.maxV) * 0.5 * grid.height;
    const pages: VirtualTexturePageId[] = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) pages.push({ mip, x, y });
    }

    return pages.sort((left, right) =>
      virtualTextureDemandPageDistance(left, centerX, centerY)
      - virtualTextureDemandPageDistance(right, centerX, centerY)
      || left.y - right.y
      || left.x - right.x);
  }

  #virtualTexturePageGrid(
    manifest: VirtualTextureManifestModel,
    mip: number,
  ): { readonly height: number; readonly width: number } {
    const baseWidth = Math.ceil(manifest.width / manifest.pageSize);
    const baseHeight = Math.ceil(manifest.height / manifest.pageSize);
    return {
      height: Math.max(1, Math.ceil(baseHeight / (2 ** mip))),
      width: Math.max(1, Math.ceil(baseWidth / (2 ** mip))),
    };
  }

  #virtualTextureMipCount(manifest: VirtualTextureManifestModel): number {
    if (manifest.mipCount !== undefined) return manifest.mipCount;
    const baseWidth = Math.ceil(manifest.width / manifest.pageSize);
    const baseHeight = Math.ceil(manifest.height / manifest.pageSize);
    return Math.max(1, Math.floor(Math.log2(Math.max(baseWidth, baseHeight))) + 1);
  }

  #canRequestVirtualTexturePage(state: VirtualTextureRuntimeState): boolean {
    const manifest = state.manifest;
    const maxInFlight = manifest === undefined
      ? VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS
      : Math.min(this.#virtualTexturePhysicalSlots(manifest), VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS);
    if (state.loadingPages.size + state.pendingUploads.length >= maxInFlight) return false;
    if (this.#virtualTextureRequestFrame !== this.#frame) {
      this.#virtualTextureRequestFrame = this.#frame;
      this.#virtualTextureRequestsThisFrame = 0;
    }
    return this.#virtualTextureRequestsThisFrame < VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME;
  }

  #requestVirtualTexturePage(state: VirtualTextureRuntimeState, page: VirtualTexturePageId): boolean {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") return false;
    if (!this.#canRequestVirtualTexturePage(state)) return false;
    const pageKey = virtualTexturePageKey(page);
    if (
      state.requestedPages.has(pageKey)
      || state.loadingPages.has(pageKey)
      || state.uploadedPages.has(pageKey)
    ) {
      return false;
    }

    const pageImage = this.#virtualTexturePageImage(state, page);
    if (pageImage === undefined) return false;

    state.requestedPages.add(pageKey);
    state.loadingPages.add(pageKey);
    const sourceGeneration = state.sourceGeneration;
    this.#virtualTextureRequestsThisFrame += 1;
    pageImage.then((image) => {
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
        || state.status !== "ready"
      ) {
        closeTexImageSource(image);
        return;
      }
      state.loadingPages.delete(pageKey);
      state.pendingUploads.push({ image, page, pageKey, sourceGeneration });
      this.invalidate();
    }, (error: unknown) => {
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
      ) return;
      state.loadingPages.delete(pageKey);
      const message = `Virtual texture page load failed for ${state.activeSource.manifestUri} ${pageKey}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      if (state.diagnosticsEnabled) {
        this.#recordDiagnostic(message, `virtual-texture-page:${state.activeSource.manifestUri}`);
      }
    });

    return true;
  }

  #virtualTexturePageImage(
    state: VirtualTextureRuntimeState,
    page: VirtualTexturePageId,
  ): Promise<TexImageSource> | undefined {
    const manifest = state.manifest;
    if (manifest === undefined) return undefined;
    if (state.activeSource.kind === "generated") {
      return this.#generatedVirtualTexturePageImage(state, state.activeSource.pageSource, manifest, page);
    }

    const uri = virtualTexturePageUri(manifest, page, state.pageUrisByKey);
    return uri === undefined
      ? undefined
      : loadImage(resolveResourceUri(state.activeSource.manifestUri, uri));
  }

  #generatedVirtualTexturePageImage(
    state: VirtualTextureRuntimeState,
    source: VirtualTextureGeneratedPageSource,
    manifest: VirtualTextureManifestModel,
    page: VirtualTexturePageId,
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
      state.stats.generatedPageFailures += 1;
      throw error;
    };

    switch (source.kind) {
      case "raster":
        try {
          return Promise.resolve(recordResult(generatedRasterVirtualTexturePageImage(source.source, manifest, page)));
        } catch (error) {
          state.stats.generatedPageFailures += 1;
          return Promise.reject(error);
        }
      case "svg":
        return loadGeneratedSvgVirtualTexturePageImage(source.source, manifest, page)
          .then(recordResult, recordFailure);
    }
  }

  #canUploadVirtualTexturePage(): boolean {
    if (this.#virtualTextureUploadFrame !== this.#frame) {
      this.#virtualTextureUploadFrame = this.#frame;
      this.#virtualTextureUploadsThisFrame = 0;
    }
    return this.#virtualTextureUploadsThisFrame < VIRTUAL_TEXTURE_MAX_PAGE_UPLOADS_PER_FRAME;
  }

  #processVirtualTexturePageUploads(): void {
    for (const state of this.#virtualTextures.values()) {
      while (state.pendingUploads.length > 0 && this.#canUploadVirtualTexturePage()) {
        const upload = state.pendingUploads.shift();
        if (upload === undefined) break;
        if (
          this.#disposed
          || this.#virtualTextures.get(state.key) !== state
          || upload.sourceGeneration !== state.sourceGeneration
          || state.status !== "ready"
          || state.uploadedPages.has(upload.pageKey)
        ) {
          closeTexImageSource(upload.image);
          continue;
        }

        this.#uploadVirtualTexturePage(state, upload.page, upload.image);
        this.#virtualTextureUploadsThisFrame += 1;
      }
      if (!this.#canUploadVirtualTexturePage()) break;
    }
  }

  #hasPendingVirtualTextureUploads(): boolean {
    for (const state of this.#virtualTextures.values()) {
      if (state.pendingUploads.length > 0) return true;
    }
    return false;
  }

  #uploadVirtualTexturePage(
    state: VirtualTextureRuntimeState,
    page: VirtualTexturePageId,
    image: TexImageSource,
  ): void {
    const manifest = state.manifest;
    const resources = state.resources;
    const pageTable = state.pageTable;
    if (
      manifest === undefined
      || resources === undefined
      || pageTable === undefined
      || !ownsTexture(this.#textureHandles, resources.atlasTexture)
      || !ownsTexture(this.#textureHandles, resources.pageTableTexture)
    ) {
      return;
    }

    const assignment = pageTable.ensureResident(page, {
      protectedPages: this.#protectedVirtualTextureParentPages(manifest, page),
    });
    if (assignment.evicted !== undefined) {
      state.uploadedPages.delete(assignment.evicted.pageKey);
      state.requestedPages.delete(assignment.evicted.pageKey);
      state.loadingPages.delete(assignment.evicted.pageKey);
    }
    const slotX = assignment.slot % resources.atlasGridColumns;
    const slotY = Math.floor(assignment.slot / resources.atlasGridColumns);
    const gl = this.#gl;
    prepareTextureUpload(gl, false);
    gl.bindTexture(gl.TEXTURE_2D, resources.atlasTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      slotX * manifest.pageSize,
      slotY * manifest.pageSize,
      manifest.pageSize,
      manifest.pageSize,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image,
    );
    state.uploadedPages.add(virtualTexturePageKey(page));
    state.stats.uploadedPageBytes += manifest.pageSize * manifest.pageSize * 4;
    state.stats.uploadedPages += 1;
    this.#flushVirtualTexturePageTableUpdates(state);
  }

  #flushVirtualTexturePageTableUpdates(state: VirtualTextureRuntimeState): void {
    const resources = state.resources;
    const pageTable = state.pageTable;
    if (
      resources === undefined
      || pageTable === undefined
      || !ownsTexture(this.#textureHandles, resources.pageTableTexture)
    ) {
      return;
    }

    const gl = this.#gl;
    prepareTextureUpload(gl, false);
    gl.bindTexture(gl.TEXTURE_2D, resources.pageTableTexture);
    for (const update of pageTable.takeDirtyPageTableUpdates()) {
      const region = this.#virtualTexturePageTableUpdateRegion(resources, update);
      if (region === undefined) continue;
      const texel = encodeVirtualTexturePageTableRgba8({
        residentMip: region.residentMip,
        ...(update.slot === undefined ? {} : { slot: update.slot }),
      });
      const cellCount = region.width * region.height;
      const payload = new Uint8Array(cellCount * 4);
      for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
        payload.set(texel, cellIndex * 4);
      }
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        region.x,
        region.y,
        region.width,
        region.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        payload,
      );
      state.stats.pageTableUpdates += cellCount;
    }
  }

  #protectedVirtualTextureParentPages(
    manifest: VirtualTextureManifestModel,
    page: VirtualTexturePageId,
  ): ReadonlySet<string> {
    const protectedPages = new Set<string>();
    const mipCount = this.#virtualTextureMipCount(manifest);
    let parent = {
      mip: page.mip + 1,
      x: Math.floor(page.x / 2),
      y: Math.floor(page.y / 2),
    };
    while (parent.mip < mipCount) {
      protectedPages.add(virtualTexturePageKey(parent));
      parent = {
        mip: parent.mip + 1,
        x: Math.floor(parent.x / 2),
        y: Math.floor(parent.y / 2),
      };
    }

    return protectedPages;
  }

  #virtualTexturePageTableUpdateRegion(
    resources: VirtualTextureResourceSet,
    update: VirtualTexturePageTableUpdate,
  ): {
    readonly height: number;
    readonly residentMip: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  } | undefined {
    const coverage = 2 ** update.page.mip;
    const minX = update.page.x * coverage;
    const minY = update.page.y * coverage;
    const maxX = Math.min(resources.pageTableWidth, minX + coverage);
    const maxY = Math.min(resources.pageTableHeight, minY + coverage);
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 0 || height <= 0) return undefined;
    const residentMip = update.slot === undefined
      ? 0
      : update.residentMip ?? update.page.mip;
    return { height, residentMip, width, x: minX, y: minY };
  }

  #isVirtualTextureDrawable(state: VirtualTextureRuntimeState): boolean {
    return state.status === "ready"
      && state.resources !== undefined
      && state.pageTable !== undefined
      && state.uploadedPages.size > 0;
  }

  #isAutoVirtualTextureCoverageReady(
    state: VirtualTextureRuntimeState,
    drawDemand: VirtualTextureDrawDemand | undefined,
  ): boolean {
    if (!this.#isVirtualTextureDrawable(state)) return false;
    const candidates = drawDemand?.coverageCandidates;
    if (candidates === undefined) return true;

    return candidates.length > 0
      && candidates.every((page) => state.uploadedPages.has(virtualTexturePageKey(page)));
  }

  #bindVirtualTexture(
    program: WebGLProgram,
    state: VirtualTextureRuntimeState,
    plan: SurfaceTextureBindingPlan,
  ): boolean {
    const resources = state.resources;
    const manifest = state.manifest;
    if (resources === undefined || manifest === undefined || !this.#isVirtualTextureDrawable(state)) return false;
    const atlasTextureUnit = plan.textureUnits.get("baseColorVirtualTextureAtlas");
    const pageTableTextureUnit = plan.textureUnits.get("baseColorVirtualTexturePageTable");
    if (atlasTextureUnit === undefined || pageTableTextureUnit === undefined) return false;

    this.#flushVirtualTexturePageTableUpdates(state);
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0 + atlasTextureUnit);
    gl.bindTexture(gl.TEXTURE_2D, resources.atlasTexture);
    uniform1i(this.#programArena, program, "u_vtAtlas", atlasTextureUnit);
    gl.activeTexture(gl.TEXTURE0 + pageTableTextureUnit);
    gl.bindTexture(gl.TEXTURE_2D, resources.pageTableTexture);
    uniform1i(this.#programArena, program, "u_vtPageTable", pageTableTextureUnit);
    uniform2fv(this.#programArena, program, "u_vtPageTableSize", [resources.pageTableWidth, resources.pageTableHeight]);
    uniform2fv(this.#programArena, program, "u_vtAtlasGrid", [resources.atlasGridColumns, resources.atlasGridRows]);
    uniform2fv(this.#programArena, program, "u_vtAtlasTexelSize", [
      1 / (resources.atlasGridColumns * manifest.pageSize),
      1 / (resources.atlasGridRows * manifest.pageSize),
    ]);
    uniform1f(this.#programArena, program, "u_vtPageSize", manifest.pageSize);
    uniform2fv(this.#programArena, program, "u_vtVirtualSize", [manifest.width, manifest.height]);
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
      state.stats.unsupportedDraws += 1;
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


  #geometryResource(geometryId: number): GeometryResource {
    return vertexInputGeometry(
      this.#vertexInputs,
      this.#gl,
      this.#contextGeneration,
      geometryId,
    );
  }

  #consumeOrdinaryTextureGpuOutcomes(): void {
    let firstError: unknown;
    const outcomeCount = ordinaryTextureGpuOutcomeCount(this.#ordinaryTextureGpu);
    for (let outcomeIndex = 0; outcomeIndex < outcomeCount; outcomeIndex += 1) {
      const outcome = ordinaryTextureGpuOutcome(this.#ordinaryTextureGpu, outcomeIndex);
      if (outcome === undefined) continue;
      if (outcome.kind === "retained") {
        firstError = captureFirstError(firstError, () => {
          this.#retainPreparedTextureUpload(outcome.key, outcome.upload);
        });
        continue;
      }
      if (resourceArenaSourceReferenceCount(this.#resourceArena, outcome.upload.source) !== 0) continue;
      firstError = captureFirstError(firstError, () => this.#closeTextureSource(outcome.upload.source));
    }
    clearOrdinaryTextureGpuOutcomes(this.#ordinaryTextureGpu);
    if (firstError !== undefined) throw firstError;
  }

  #queueOrdinaryTextureUpload(
    resource: OrdinaryTextureGpuResource,
    source: LoadedTextureSource,
    texture: TextureAssetUploadRef,
  ): void {
    this.#retainPreparedTextureUpload(resource.key, { source, texture });
    if (
      this.#disposed
      || this.#contextLifecycle !== "active"
      || resource.generation !== this.#contextGeneration
      || resource.uploaded
    ) return;
    queueOrdinaryTextureUpload(this.#ordinaryTextureGpu, resource, { source, texture });
    if (consumeOrdinaryTextureGpuWake(this.#ordinaryTextureGpu)) this.invalidate();
  }

  #processOrdinaryTextureUploads(): void {
    let processError: unknown;
    try {
      processOrdinaryTextureUploads(
        this.#ordinaryTextureGpu,
        this.#frame,
        this.#contextGeneration,
      );
    } catch (error) {
      processError = error;
    }
    let outcomeError: unknown;
    try {
      this.#consumeOrdinaryTextureGpuOutcomes();
    } catch (error) {
      outcomeError = error;
    }
    if (consumeOrdinaryTextureGpuWake(this.#ordinaryTextureGpu)) this.invalidate();
    if (processError !== undefined) throw processError;
    if (outcomeError !== undefined) throw outcomeError;
  }

  #texture(texture: TextureAssetUploadRef): OrdinaryTextureGpuResource {
    const key = textureCacheKey(texture);
    const cached = ordinaryTextureGpuResource(this.#ordinaryTextureGpu, key);
    if (cached !== undefined) return cached;

    const prepared = resourceArenaPreparedSource(this.#resourceArena, key);
    const resource = ensureOrdinaryTextureGpuResource(
      this.#ordinaryTextureGpu,
      key,
      this.#contextGeneration,
    );

    if (prepared !== undefined) {
      this.#queueOrdinaryTextureUpload(resource, prepared.source, prepared.texture);
      return resource;
    }
    if (texture.preparedOnly === true) return resource;
    if (this.#ordinaryTextureSourceSubscriptions.has(key)) return resource;

    const subscription = this.#ordinaryTextureSources.acquire(texture, (result) => {
      if (result.kind === "error") {
        const current = ordinaryTextureGpuResource(this.#ordinaryTextureGpu, key);
        if (this.#disposed || current?.uploaded === true) return;
        const message = `Texture image load failed for ${texture.uri}: ${result.error instanceof Error ? result.error.message : String(result.error)}`;
        this.#recordDiagnostic(message, `texture-image:${key}`);
        return;
      }
      const image = result.source;
      if (this.#disposed) {
        return;
      }
      this.#registerAutoBaseColorVirtualTextureDecodedPageSource(texture, image);
      if (resourceArenaTextureReferenceCount(this.#resourceArena, key) === 0) {
        return;
      }
      this.#retainPreparedTextureUpload(key, { source: image, texture });
      if (this.#contextLifecycle !== "active") return;
      const current = ordinaryTextureGpuResource(this.#ordinaryTextureGpu, key);
      if (current !== undefined && current.generation === this.#contextGeneration) {
        if (!current.uploaded) this.#queueOrdinaryTextureUpload(current, image, texture);
      }
    });
    this.#ordinaryTextureSourceSubscriptions.set(key, subscription);

    return resource;
  }

  #settleDecodedTextureSource(texture: TextureAssetUploadRef | undefined, image: LoadedTextureSource): void {
    if (texture === undefined) return;
    const key = textureCacheKey(texture);
    if (resourceArenaTextureReferenceCount(this.#resourceArena, key) === 0) return;
    const cached = ordinaryTextureGpuResource(this.#ordinaryTextureGpu, key);
    const cachedPending = cached === undefined ? undefined : ordinaryTextureGpuPendingUpload(cached);
    if (cached !== undefined && cachedPending !== undefined && cachedPending.source !== image) {
      discardOrdinaryTexturePendingUpload(this.#ordinaryTextureGpu, cached);
      this.#consumeOrdinaryTextureGpuOutcomes();
    }
    // A prepared asset source supersedes equivalent direct URI work. Keeping
    // that job alive would retain a redundant decode until scene removal.
    this.#releaseOrdinaryTextureSourceSubscription(key);
    this.#retainPreparedTextureUpload(key, { source: image, texture });
    this.#registerAutoBaseColorVirtualTextureDecodedPageSource(texture, image);
    if (this.#contextLifecycle !== "active") return;
    if (cached !== undefined && cached.uploaded) return;

    const resource = cached ?? ensureOrdinaryTextureGpuResource(
      this.#ordinaryTextureGpu,
      key,
      this.#contextGeneration,
    );
    this.#queueOrdinaryTextureUpload(resource, image, texture);
  }

  #ensureIblSpecularTexture(specular: SurfaceImageBasedLightSpecular): IblSpecularTextureResource {
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
    ) this.#closeTextureSource(previous);
    if (this.#contextLifecycle !== "active") return;
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
    }
  }

  #studioEnvironmentSpecularTexture(): StudioEnvironmentSpecularResource {
    return ensureStudioEnvironmentSpecularTexture(this.#iblTextures);
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

  #ensureGltfState(key: string): GltfState {
    const existing = this.#gltf.get(key);
    if (existing !== undefined) return existing;
    const state: GltfState = {
      hasMaterialLod: false,
      hasMaterialVariants: false,
      hasNodeLod: false,
      instanceKey: this.#gltfStateInstanceKey,
      imageRows: new Map(),
      key,
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
    return this.#gltfPreparationScheduler.run(
      signal,
      () => this.#prepareGltfAssetAdmitted(src, assetKey, signal),
    );
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
    try {
      const { binaryChunk, document } = await loadGltfDocument(src, signal);
      load.documentLoadedAt = nowMs();
      throwIfAborted(signal);
      assertSupportedRequiredGltfExtensions(src, document);
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
        const scene = this.#readGltfScene(decodedDocument, buffers, dracoPrimitives, src, assetKey);
        load.sceneReadAt = nowMs();
        load.readyAt = nowMs();
      return {
          hasMaterialLod: scene.hasMaterialLod,
          hasMaterialVariants: scene.hasMaterialVariants,
          hasNodeLod: scene.hasNodeLod,
          ...(scene.imageBasedLight === undefined ? {} : { imageBasedLight: scene.imageBasedLight }),
          imagePreparation: {
            ...(codecs.basisu === undefined ? {} : { basisuCodec: codecs.basisu }),
            buffers,
            document: decodedDocument,
            src,
          },
          lights: scene.lights,
          load,
          nodeCount: decodedDocument.nodes?.length ?? 0,
          primitives: scene.primitives,
          variants: scene.variants,
      };
    } catch (error) {
      load.readyAt = nowMs();
      throw error;
    }
  }

  #readGltfScene(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    dracoPrimitives: ReadonlyMap<GltfMeshPrimitive, DecodedGltfDracoPrimitive>,
    src: string,
    assetKey: string,
  ): {
    readonly hasMaterialLod: boolean;
    readonly hasMaterialVariants: boolean;
    readonly hasNodeLod: boolean;
    readonly imageBasedLight?: SurfaceImageBasedLight;
    readonly lights: readonly SurfaceLight[];
    readonly primitives: readonly LoadedGltfPrimitive[];
    readonly variants: readonly string[];
  } {
    const lights: SurfaceLight[] = [];
    const primitives: LoadedGltfPrimitive[] = [];
    const variants = (document.extensions?.KHR_materials_variants?.variants ?? [])
      .map((variant) => variant.name)
      .map((name, index) => typeof name === "string" ? name : String(index));
    const sceneIndex = document.scene ?? 0;
    const scene = document.scenes?.[sceneIndex];
    const imageBasedLight = readGltfSceneImageBasedLight(document, src, assetKey, sceneIndex, {
      recordDiagnostic: (message) => this.#recordDiagnostic(message),
      recordUnsupportedGltfImageBasedLight: (message) => this.#recordUnsupportedGltfImageBasedLight(message),
    });
    const referencedLodNodes = new Set<number>();
    for (const node of document.nodes ?? []) {
      for (const id of node.extensions?.MSFT_lod?.ids ?? []) {
        if (Number.isInteger(id) && id >= 0) referencedLodNodes.add(id);
      }
    }

    for (const nodeIndex of scene?.nodes ?? []) {
      if (referencedLodNodes.has(nodeIndex)) continue;
      this.#appendGltfNodeTreePrimitives(
        document,
        buffers,
        dracoPrimitives,
        src,
        assetKey,
        primitives,
        lights,
        nodeIndex,
        identityMat4(),
        [],
        referencedLodNodes,
        variants.length,
      );
    }

    return {
      hasMaterialLod: primitives.some((primitive) =>
        primitive.materialLod !== undefined
        || primitive.materialVariants?.some((variant) => variant.materialLod !== undefined) === true),
      hasMaterialVariants: primitives.some((primitive) => primitive.materialVariants !== undefined),
      hasNodeLod: primitives.some((primitive) => primitive.nodeLod !== undefined),
      ...(imageBasedLight === undefined ? {} : { imageBasedLight }),
      lights,
      primitives,
      variants,
    };
  }

  #recordUnsupportedGltfImageBasedLight(message: string): void {
    this.#recordDiagnostic(message, `gltf-image-based-light:${message}`);
  }

  #appendGltfNodeTreePrimitives(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    dracoPrimitives: ReadonlyMap<GltfMeshPrimitive, DecodedGltfDracoPrimitive>,
    src: string,
    assetKey: string,
    primitives: LoadedGltfPrimitive[],
    lights: SurfaceLight[],
    nodeIndex: number,
    parentModel: Mat4,
    parentPath: readonly number[],
    referencedLodNodes: ReadonlySet<number>,
    variantCount: number,
    nodeLod?: GltfNodePrimitiveLod,
    applyOwnLod = true,
  ): void {
    const sceneNode = document.nodes?.[nodeIndex];
    if (sceneNode === undefined) return;
    if (sceneNode.extensions?.KHR_node_visibility?.visible === false) return;

    const lodIds = applyOwnLod
      ? (sceneNode.extensions?.MSFT_lod?.ids ?? [])
        .filter((id) => Number.isInteger(id) && id >= 0 && document.nodes?.[id] !== undefined)
      : [];
    if (lodIds.length > 0) {
      const levelCount = lodIds.length + 1;
      const thresholds = gltfLodThresholds(sceneNode.extras, levelCount);
      const group = `node:${nodeIndex}`;
      this.#appendGltfNodeTreePrimitives(
        document,
        buffers,
        dracoPrimitives,
        src,
        assetKey,
        primitives,
        lights,
        nodeIndex,
        parentModel,
        parentPath,
        referencedLodNodes,
        variantCount,
        {
          group,
          level: 0,
          levelCount,
          thresholds,
        },
        false,
      );
      for (const [lodIndex, lodNodeIndex] of lodIds.entries()) {
        this.#appendGltfNodeTreePrimitives(
          document,
          buffers,
          dracoPrimitives,
          src,
          assetKey,
          primitives,
          lights,
          lodNodeIndex,
          parentModel,
          parentPath,
          referencedLodNodes,
          variantCount,
          {
            group,
            level: lodIndex + 1,
            levelCount,
            thresholds,
          },
          false,
        );
      }
      return;
    }

    const nodePath = [...parentPath, nodeIndex];
    const nodeModel = multiplyMat4(parentModel, gltfNodeMat4(sceneNode));
    this.#appendGltfNodeLight(document, lights, sceneNode, nodeIndex, nodeModel);
    const instanceTransforms = this.#gltfNodeInstanceTransforms(document, buffers, sceneNode, nodeIndex);
    const localModels = instanceTransforms.map((instanceTransform) => multiplyMat4(nodeModel, instanceTransform));
    const localModelDeterminants = localModels.map(mat4OrientationDeterminant);
    const mesh = sceneNode?.mesh === undefined ? undefined : document.meshes?.[sceneNode.mesh];
    for (const [primitiveIndex, primitive] of (mesh?.primitives ?? []).entries()) {
      const dracoPrimitive = dracoPrimitives.get(primitive);
      const decodedAttributes = dracoPrimitive?.attributes;
      const positionAccessor = primitive.attributes?.POSITION;
      const normalAccessor = primitive.attributes?.NORMAL;
      const tangentAccessor = primitive.attributes?.TANGENT;
      const indexAccessor = primitive.indices;
      const positions = decodedAttributes?.get("POSITION")
        ?? (positionAccessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, positionAccessor));
      if (positions === undefined) continue;
      const mode = gltfPrimitiveMode(primitive.mode);
      if (mode === undefined) {
        const unsupportedMode = primitive.mode ?? 4;
        this.#recordDiagnostic(
          `glTF primitive ${nodeIndex}:${primitiveIndex} skipped: unsupported primitive mode ${unsupportedMode}`,
          `gltf-primitive-mode:${assetKey}:${unsupportedMode}`,
        );
        continue;
      }
      const baseNormals = decodedAttributes?.get("NORMAL")
        ?? (normalAccessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, normalAccessor));
      const baseTangents = decodedAttributes?.get("TANGENT")
        ?? (tangentAccessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, tangentAccessor));
      const colors = gltfVertexColors(document, buffers, primitive, positions, decodedAttributes);
      const texCoords0 = gltfPrimitiveTexCoords(document, buffers, primitive, 0, decodedAttributes);
      const texCoords1 = gltfPrimitiveTexCoords(document, buffers, primitive, 1, decodedAttributes);
      const indices = dracoPrimitive?.indices
        ?? (indexAccessor === undefined ? undefined : readGltfIndices(document, buffers, indexAccessor));
      const normals = baseNormals ?? generateGltfPrimitiveNormals(positions, indices, mode);
      const material = this.#readGltfMaterial(
        document,
        src,
        assetKey,
        primitive.material,
      );
      const materialLod = this.#readGltfMaterialLod(
        document,
        src,
        assetKey,
        primitive.material,
      );
      const materialVariants = this.#readGltfMaterialVariants(
        document,
        src,
        assetKey,
        primitive,
        variantCount,
      );
      const baseMaterial = loadedGltfPrimitiveBaseMaterial(material, materialLod);
      const key = `node:${nodeIndex}:primitive:${primitiveIndex}`;
      primitives.push({
        baseMaterial,
        ...(colors === undefined ? {} : { colors }),
        ...(indices === undefined ? {} : { indices }),
        instanceTransforms,
        key,
        localBounds: localModels.map((localModel) => worldBounds(positions, localModel)),
        localModelDeterminants,
        localModels,
        material,
        ...(materialLod === undefined ? {} : { materialLod }),
        ...(materialVariants.length === 0 ? {} : { materialVariants }),
        mode,
        meshNodeIndex: nodeIndex,
        nodePath,
        ...(nodeLod === undefined ? {} : { nodeLod }),
        ...(normals === undefined ? {} : { normals }),
        objectBounds: worldBounds(positions, identityMat4()),
        positions,
        ...(baseTangents === undefined ? {} : { tangents: baseTangents }),
        ...(texCoords0 === undefined ? {} : { texCoords0 }),
        ...(texCoords1 === undefined ? {} : { texCoords1 }),
      });
    }

    for (const childIndex of sceneNode.children ?? []) {
      if (referencedLodNodes.has(childIndex)) continue;
      this.#appendGltfNodeTreePrimitives(
        document,
        buffers,
        dracoPrimitives,
        src,
        assetKey,
        primitives,
        lights,
        childIndex,
        nodeModel,
        nodePath,
        referencedLodNodes,
        variantCount,
        nodeLod,
        nodeLod === undefined,
      );
    }
  }

  #appendGltfNodeLight(
    document: GltfDocument,
    lights: SurfaceLight[],
    sceneNode: GltfSceneNode,
    nodeIndex: number,
    nodeModel: Mat4,
  ): void {
    const lightIndex = sceneNode.extensions?.KHR_lights_punctual?.light;
    if (lightIndex === undefined) return;
    if (!Number.isInteger(lightIndex) || lightIndex < 0) {
      this.#recordDiagnostic(`glTF node ${nodeIndex} KHR_lights_punctual skipped: invalid light index ${lightIndex}`);
      return;
    }

    const light = document.extensions?.KHR_lights_punctual?.lights?.[lightIndex];
    if (light === undefined) {
      this.#recordDiagnostic(`glTF node ${nodeIndex} KHR_lights_punctual skipped: missing light ${lightIndex}`);
      return;
    }

    const color = gltfLightColor(light);
    const direction = transformDirection(nodeModel, [0, 0, -1]);
    const position = transformPoint(nodeModel, [0, 0, 0]);
    const range = positiveFiniteNumber(light.range);
    switch (light.type) {
      case "directional":
        lights.push({
          color,
          direction,
          kind: "directional",
        });
        return;
      case "point":
        lights.push({
          color,
          kind: "point",
          position,
          ...(range === undefined ? {} : { range }),
        });
        return;
      case "spot":
        {
          const { innerConeAngle, outerConeAngle } = gltfSpotConeAngles(light);
          lights.push({
            color,
            direction,
            innerConeAngle,
            kind: "spot",
            outerConeAngle,
            position,
            ...(range === undefined ? {} : { range }),
          });
        }
        return;
      default:
        this.#recordDiagnostic(`glTF node ${nodeIndex} KHR_lights_punctual skipped: unsupported light type ${light.type ?? "missing"}`);
    }
  }

  #gltfNodeInstanceTransforms(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    sceneNode: GltfSceneNode,
    nodeIndex: number,
  ): readonly Mat4[] {
    const attributes = sceneNode.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (attributes === undefined) return [identityMat4()];

    const supportedSemantics = new Set(["ROTATION", "SCALE", "TRANSLATION"]);
    const rawAttributeEntries = Object.entries(attributes);
    if (rawAttributeEntries.length === 0) throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing has no attributes`);
    for (const [semantic, accessorIndex] of rawAttributeEntries) {
      if (typeof accessorIndex !== "number" || !Number.isInteger(accessorIndex) || accessorIndex < 0
        || document.accessors?.[accessorIndex] === undefined) {
        throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ${semantic} references invalid accessor ${accessorIndex}`);
      }
    }
    const attributeEntries = rawAttributeEntries as [string, number][];
    const counts = attributeEntries.map(([, accessorIndex]) => gltfInstancingAttributeCount(document, accessorIndex)!);
    if (new Set(counts).size !== 1) {
      throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing attributes must have matching counts`);
    }
    const instanceCount = counts[0]!;

    const unsupportedSemantics = attributeEntries
      .map(([semantic]) => semantic)
      .filter((semantic) => !supportedSemantics.has(semantic));
    if (unsupportedSemantics.length > 0) {
      this.#recordDiagnostic(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ignored custom attributes: ${unsupportedSemantics.join(", ")}`);
    }

    const validateTransformAccessor = (semantic: "ROTATION" | "SCALE" | "TRANSLATION"): void => {
      const accessorIndex = attributes[semantic];
      if (accessorIndex === undefined) return;
      const accessor = document.accessors![accessorIndex]!;
      const valid = semantic === "ROTATION"
        ? accessor.type === "VEC4" && (
          accessor.componentType === 5126
          || ((accessor.componentType === 5120 || accessor.componentType === 5122) && accessor.normalized === true)
        )
        : accessor.type === "VEC3" && accessor.componentType === 5126 && accessor.normalized !== true;
      if (!valid) {
        throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ${semantic} has an invalid accessor format`);
      }
    };
    validateTransformAccessor("TRANSLATION");
    validateTransformAccessor("ROTATION");
    validateTransformAccessor("SCALE");

    const translations = attributes.TRANSLATION === undefined
      ? undefined
      : readGltfFloatAccessor(document, buffers, attributes.TRANSLATION);
    const rotations = attributes.ROTATION === undefined
      ? undefined
      : readGltfFloatAccessor(document, buffers, attributes.ROTATION);
    const scales = attributes.SCALE === undefined
      ? undefined
      : readGltfFloatAccessor(document, buffers, attributes.SCALE);

    for (const [semantic, values] of [["TRANSLATION", translations], ["ROTATION", rotations], ["SCALE", scales]] as const) {
      if (values !== undefined && values.some((value) => !Number.isFinite(value))) {
        throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ${semantic} contains non-finite values`);
      }
    }
    if (rotations !== undefined) {
      for (let index = 0; index < instanceCount; index += 1) {
        const offset = index * 4;
        const lengthSquared = rotations[offset]! ** 2 + rotations[offset + 1]! ** 2
          + rotations[offset + 2]! ** 2 + rotations[offset + 3]! ** 2;
        if (!(lengthSquared > 1e-12)) {
          throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ROTATION ${index} is a zero quaternion`);
        }
      }
    }

    return Array.from({ length: instanceCount }, (_, index) =>
      gltfInstanceTransformMat4(translations, rotations, scales, index));
  }

  #readGltfMaterialVariants(
    document: GltfDocument,
    src: string,
    assetKey: string,
    primitive: GltfMeshPrimitive,
    variantCount: number,
  ): readonly LoadedGltfMaterialVariant[] {
    return (primitive.extensions?.KHR_materials_variants?.mappings ?? [])
      .map((mapping): LoadedGltfMaterialVariant | undefined => {
        const materialIndex = mapping.material;
        const variants = (mapping.variants ?? [])
          .filter((variant) => Number.isInteger(variant) && variant >= 0 && variant < variantCount);
        if (
          materialIndex === undefined
          || !Number.isInteger(materialIndex)
          || materialIndex < 0
          || document.materials?.[materialIndex] === undefined
          || variants.length === 0
        ) {
          return undefined;
        }

        const material = this.#readGltfMaterial(
          document,
          src,
          assetKey,
          materialIndex,
        );
        const materialLod = this.#readGltfMaterialLod(
          document,
          src,
          assetKey,
          materialIndex,
        );

        return {
          material,
          ...(materialLod === undefined ? {} : { materialLod }),
          variants,
        };
      })
      .filter((mapping): mapping is LoadedGltfMaterialVariant => mapping !== undefined);
  }

  #diagnoseUnsupportedGltfMaterialExtensionTextures(
    material: GltfMaterial | undefined,
    materialIndex: number | undefined,
  ): void {
    const anisotropy = material?.extensions?.KHR_materials_anisotropy;
    if (anisotropy?.anisotropyTexture !== undefined) {
      this.#recordUnsupportedGltfMaterialExtensionFeature(
        materialIndex,
        "KHR_materials_anisotropy.anisotropyTexture",
        "Royal supports anisotropy factor and rotation, but anisotropy textures are not yet supported.",
      );
    }
    const clearcoat = material?.extensions?.KHR_materials_clearcoat;
    if (clearcoat?.clearcoatNormalTexture !== undefined) {
      this.#recordUnsupportedGltfMaterialExtensionFeature(
        materialIndex,
        "KHR_materials_clearcoat.clearcoatNormalTexture",
        "Royal does not yet support extension normal maps; clearcoat normals require tangent-space normal-map support.",
      );
    }
    const diffuseTransmission = material?.extensions?.KHR_materials_diffuse_transmission;
    if (diffuseTransmission?.diffuseTransmissionTexture !== undefined) {
      this.#recordUnsupportedGltfMaterialExtensionFeature(
        materialIndex,
        "KHR_materials_diffuse_transmission.diffuseTransmissionTexture",
        "Royal supports diffuse transmission factor and color factor, but diffuse transmission textures are not yet supported.",
      );
    }
    if (diffuseTransmission?.diffuseTransmissionColorTexture !== undefined) {
      this.#recordUnsupportedGltfMaterialExtensionFeature(
        materialIndex,
        "KHR_materials_diffuse_transmission.diffuseTransmissionColorTexture",
        "Royal supports diffuse transmission factor and color factor, but diffuse transmission textures are not yet supported.",
      );
    }
  }

  #recordUnsupportedGltfMaterialExtensionFeature(
    materialIndex: number | undefined,
    field: string,
    reason: string,
  ): void {
    const materialLabel = materialIndex === undefined ? "default material" : `material ${materialIndex}`;
    const message = `glTF ${materialLabel} ${field} is ignored: ${reason}`;
    this.#recordDiagnostic(message, `gltf-material-extension:${field}`);
  }

  #readGltfMaterial(
    document: GltfDocument,
    src: string,
    assetKey: string,
    materialIndex: number | undefined,
  ): LoadedGltfMaterial {
    const material = materialIndex === undefined ? undefined : document.materials?.[materialIndex];
    this.#diagnoseUnsupportedGltfMaterialExtensionTextures(material, materialIndex);
    const baseColorTextureSlot = gltfMaterialTextureSlot(
      document,
      assetKey,
      src,
      material?.pbrMetallicRoughness?.baseColorTexture,
    );
    const metallicRoughnessTextureSlot = gltfMaterialTextureSlot(
      document,
      assetKey,
      src,
      material?.pbrMetallicRoughness?.metallicRoughnessTexture,
    );
    const normalTextureSlot = gltfMaterialTextureSlot(document, assetKey, src, material?.normalTexture);
    const emissiveTextureSlot = gltfMaterialTextureSlot(document, assetKey, src, material?.emissiveTexture);
    const occlusionTextureSlot = gltfMaterialTextureSlot(document, assetKey, src, material?.occlusionTexture);
    const color = gltfColor(material?.pbrMetallicRoughness?.baseColorFactor);
    const emissive = gltfEmissiveColor(material);
    const extensionFactors = readGltfMaterialExtensionFactors(material);
    const extensionTextures = gltfMaterialExtensionTextureSlots(document, assetKey, src, material);
    const metallicFactor = gltfMetallicRoughnessFactor(material?.pbrMetallicRoughness?.metallicFactor, 1);
    const occlusionStrength = gltfOcclusionStrength(material?.occlusionTexture?.strength);
    const roughnessFactor = gltfMetallicRoughnessFactor(material?.pbrMetallicRoughness?.roughnessFactor, 1);
    const alphaMode = gltfMaterialAlphaMode(material?.alphaMode);
    const alphaCutoff = gltfMaterialAlphaCutoff(material?.alphaCutoff);
    return {
      alphaMode,
      ...(alphaMode === "MASK" ? { alphaCutoff } : {}),
      ...(baseColorTextureSlot === undefined ? {} : { baseColorTexture: baseColorTextureSlot }),
      ...(emissiveTextureSlot === undefined ? {} : { emissiveTexture: emissiveTextureSlot }),
      ...(metallicRoughnessTextureSlot === undefined ? {} : { metallicRoughnessTexture: metallicRoughnessTextureSlot }),
      ...(normalTextureSlot === undefined ? {} : { normalTexture: normalTextureSlot }),
      ...(occlusionTextureSlot === undefined ? {} : { occlusionTexture: occlusionTextureSlot }),
      ...(color === undefined ? {} : { color }),
      ...(emissive === undefined ? {} : { emissive }),
      ...(extensionFactors === undefined ? {} : { extensionFactors }),
      ...(extensionTextures === undefined ? {} : { extensionTextures }),
      doubleSided: material?.doubleSided === true,
      metallicFactor,
      normalScale: material?.normalTexture?.scale ?? 1,
      occlusionStrength,
      roughnessFactor,
      ...(materialIndex === undefined ? {} : { sourceMaterialIndex: materialIndex }),
      ...(material?.extensions?.KHR_materials_unlit === undefined ? {} : { unlit: true }),
    };
  }

  #readGltfMaterialLod(
    document: GltfDocument,
    src: string,
    assetKey: string,
    materialIndex: number | undefined,
  ): GltfMaterialPrimitiveLod | undefined {
    const material = materialIndex === undefined ? undefined : document.materials?.[materialIndex];
    const lodIds = (material?.extensions?.MSFT_lod?.ids ?? [])
      .filter((id) => Number.isInteger(id) && id >= 0 && document.materials?.[id] !== undefined);
    if (materialIndex === undefined || lodIds.length === 0) return undefined;

    const levels = [
      this.#readGltfMaterial(document, src, assetKey, materialIndex),
      ...lodIds.map((id) =>
        this.#readGltfMaterial(document, src, assetKey, id)),
    ];

    return {
      levels,
      thresholds: gltfLodThresholds(material?.extras, levels.length),
    };
  }

  #initializeGltfImageRows(state: GltfState): void {
    const iblRows = new Map<string, SurfaceImageBasedLightSpecular>();
    const specular = state.imageBasedLight?.specular;
    if (specular !== undefined) {
      for (const mip of specular.imageLoadKeys) {
        for (const key of mip) iblRows.set(key, specular);
      }
    }
    for (const key of this.#usedGltfImageLoadKeys(state)) {
      const iblSpecular = iblRows.get(key);
      const row: GltfImageRow = {
        assetKey: state.key,
        bindings: [],
        ...(iblSpecular === undefined ? {} : { iblSpecular }),
        key,
        materials: new Set(),
        stateInstanceKey: state.instanceKey,
        queued: false,
        revision: 0,
        status: "pending",
      };
      state.imageRows.set(key, row);
    }

    const bind = (
      imageUri: string | undefined,
      binding: Omit<GltfImageTextureBinding, "count" | "material">,
      material: LoadedGltfMaterial,
    ): void => {
      if (imageUri === undefined) return;
      const row = state.imageRows.get(imageUri);
      if (row === undefined) return;
      row.materials.add(material);
      row.bindings.push({ ...binding, count: 1, material });
    };
    for (const material of state.materials) {
      const baseColor = material.baseColorTexture;
      if (baseColor?.textureUri !== undefined) bind(baseColor.imageUri, {
        baseColor: true,
        colorSpace: "srgb",
        ...(baseColor.contentKey === undefined ? {} : { contentKey: baseColor.contentKey }),
        ...(baseColor.sampler === undefined ? {} : { sampler: baseColor.sampler }),
        ...(baseColor.sourceUri === undefined ? {} : { sourceUri: baseColor.sourceUri }),
        textureUri: baseColor.textureUri,
      }, material);
      const emissive = material.emissiveTexture;
      if (emissive?.textureUri !== undefined) bind(emissive.imageUri, {
        baseColor: false,
        colorSpace: "srgb",
        ...(emissive.contentKey === undefined ? {} : { contentKey: emissive.contentKey }),
        ...(emissive.sampler === undefined ? {} : { sampler: emissive.sampler }),
        ...(emissive.sourceUri === undefined ? {} : { sourceUri: emissive.sourceUri }),
        textureUri: emissive.textureUri,
      }, material);
      for (const slot of [material.metallicRoughnessTexture, material.normalTexture, material.occlusionTexture]) {
        if (slot?.textureUri === undefined) continue;
        bind(slot.imageUri, {
          baseColor: false,
          colorSpace: "linear",
          ...(slot.contentKey === undefined ? {} : { contentKey: slot.contentKey }),
          ...(slot.sampler === undefined ? {} : { sampler: slot.sampler }),
          ...(slot.sourceUri === undefined ? {} : { sourceUri: slot.sourceUri }),
          textureUri: slot.textureUri,
        }, material);
      }
      for (const definition of GLTF_MATERIAL_EXTENSION_TEXTURES) {
        const slot = material.extensionTextures?.[definition.key];
        if (slot?.textureUri === undefined) continue;
        bind(slot.imageUri, {
          baseColor: false,
          colorSpace: definition.colorSpace,
          ...(slot.contentKey === undefined ? {} : { contentKey: slot.contentKey }),
          ...(slot.sampler === undefined ? {} : { sampler: slot.sampler }),
          ...(slot.sourceUri === undefined ? {} : { sourceUri: slot.sourceUri }),
          textureUri: slot.textureUri,
        }, material);
      }
    }
  }

  #loadGltfImages(
    src: string,
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    state: GltfState,
    basisuCodec: Promise<GltfBasisuCodecModule> | undefined,
  ): void {
    this.#initializeGltfImageRows(state);
    const controller = replaceResourceArenaImageAbortController(this.#resourceArena, state.key);
    const usedImageKeys = this.#usedGltfImageLoadKeys(state);
    const startedImageKeys = new Set<string>();
    const ordinaryJobs: Array<{ readonly imageIndex: number; readonly key: string; readonly kind: GltfImageKind }> = [];
    const iblJobs: Array<{ readonly imageIndex: number; readonly key: string; readonly kind: GltfImageKind }> = [];
    for (const [imageIndex, image] of (document.images ?? []).entries()) {
      for (const kind of ["image", "basisu", "svg"] as const) {
        const key = gltfImageLoadKey(state.key, src, imageIndex, image, kind);
        if (key === undefined) continue;
        if (!usedImageKeys.has(key)) continue;
        if (startedImageKeys.has(key)) continue;
        startedImageKeys.add(key);
        this.#recordGltfImageLoadStarted(state);
        const row = state.imageRows.get(key);
        if (row === undefined) continue;
        (row.iblSpecular === undefined ? ordinaryJobs : iblJobs).push({ imageIndex, key, kind });
      }
    }
    const pump = (
      jobs: readonly { readonly imageIndex: number; readonly key: string; readonly kind: GltfImageKind }[],
      scheduler: GltfPreparationScheduler,
    ): void => {
      let index = 0;
      const next = (): void => {
        if (controller.signal.aborted || index >= jobs.length) return;
        const job = jobs[index++]!;
        const image = document.images?.[job.imageIndex];
        const row = state.imageRows.get(job.key);
        if (image === undefined || row === undefined) {
          next();
          return;
        }
        scheduler.run(controller.signal, () =>
          loadGltfImageSource(src, document, buffers, image, job.kind, basisuCodec, controller.signal)).then((loadedImage) => {
          if (
            this.#disposed
            || state.status !== "ready"
            || this.#gltf.get(state.key) !== state
            || state.imageRows.get(job.key) !== row
          ) {
            this.#closeTextureSource(loadedImage.image);
            return;
          }
          this.#recordGltfImageLoadSettled(state, false);
          const previousSource = retainResourceArenaAssetSource(
            this.#resourceArena,
            state.key,
            row.key,
            loadedImage.image,
          );
          if (
            previousSource !== undefined
            && previousSource !== loadedImage.image
            && resourceArenaSourceReferenceCount(this.#resourceArena, previousSource) === 0
          ) this.#closeTextureSource(previousSource);
          row.source = loadedImage.image;
          row.status = "ready";
          row.revision += 1;
          if (loadedImage.contentKey !== undefined) {
            row.contentKey = loadedImage.contentKey;
            for (const binding of row.bindings) {
              if (binding.contentKey === undefined) {
                publishResourceArenaContentKey(
                  this.#resourceArena,
                  state.key,
                  binding.textureUri,
                  loadedImage.contentKey,
                );
              }
            }
          }
          if (!row.queued) {
            row.queued = true;
            this.#pendingGltfImageRows.push(row);
          }
          this.invalidate();
        }, (error: unknown) => {
          if (
            this.#disposed
            || this.#gltf.get(state.key) !== state
            || state.imageRows.get(job.key) !== row
          ) return;
          this.#recordGltfImageLoadSettled(state, true);
          row.error = error instanceof Error ? error.message : String(error);
          row.status = "error";
          row.revision += 1;
          this.invalidate();
          this.#recordDiagnostic(`glTF image load failed for ${job.key}: ${row.error}`);
        }).finally(next);
      };
      next();
    };
    pump(ordinaryJobs, this.#gltfImageScheduler);
    pump(iblJobs, this.#gltfIblImageScheduler);
    if (state.load.imageRequests === 0) {
      state.load.imagesSettledAt = nowMs();
      finishResourceArenaImageWork(this.#resourceArena, state.key);
    }
  }

  #recordGltfImageLoadStarted(state: GltfState): void {
    state.load.imageLoadStartedAt ??= nowMs();
    state.load.imageRequests += 1;
  }

  #recordGltfImageLoadSettled(state: GltfState, failed: boolean): void {
    const load = state.load;
    if (failed) load.imageFailures += 1;
    else load.imageLoaded += 1;
    load.firstImageSettledAt ??= nowMs();
    if (load.imageLoaded + load.imageFailures >= load.imageRequests) {
      load.imagesSettledAt = nowMs();
      finishResourceArenaImageWork(this.#resourceArena, state.key);
    }
  }

  #usedGltfImageLoadKeys(state: GltfState): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const primitive of state.primitives) {
      this.#addGltfMaterialImageLoadKeys(keys, primitive.material);
      for (const material of primitive.materialLod?.levels ?? []) this.#addGltfMaterialImageLoadKeys(keys, material);
      for (const variant of primitive.materialVariants ?? []) {
        this.#addGltfMaterialImageLoadKeys(keys, variant.material);
        for (const material of variant.materialLod?.levels ?? []) this.#addGltfMaterialImageLoadKeys(keys, material);
      }
    }
    for (const mip of state.imageBasedLight?.specular?.imageLoadKeys ?? []) {
      for (const key of mip) keys.add(key);
    }

    return keys;
  }

  #addGltfMaterialImageLoadKeys(keys: Set<string>, material: LoadedGltfMaterial): void {
    for (const slot of [
      material.baseColorTexture,
      material.emissiveTexture,
      material.metallicRoughnessTexture,
      material.normalTexture,
      material.occlusionTexture,
    ]) this.#addGltfMaterialTextureSlotImageLoadKey(keys, slot);
    const extensionTextures = material.extensionTextures;
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      this.#addGltfMaterialTextureSlotImageLoadKey(keys, extensionTextures?.[texture.key]);
    }
  }

  #addGltfMaterialTextureSlotImageLoadKey(
    keys: Set<string>,
    slot: LoadedGltfMaterialTextureSlot | undefined,
  ): void {
    if (slot?.imageUri !== undefined) keys.add(slot.imageUri);
  }

  #stagePendingGltfImageRows(): void {
    if (this.#pendingGltfImageRowHead >= this.#pendingGltfImageRows.length) return;
    const rekeysByAsset = this.#pendingGltfTextureRekeys;
    rekeysByAsset.clear();
    for (let index = this.#pendingGltfImageRowHead; index < this.#pendingGltfImageRows.length; index += 1) {
      const row = this.#pendingGltfImageRows[index];
      if (row?.status !== "ready" || row.contentKey === undefined || row.source === undefined) continue;
      const state = this.#gltf.get(row.assetKey);
      if (
        state === undefined
        || state.instanceKey !== row.stateInstanceKey
        || state.imageRows.get(row.key) !== row
      ) continue;
      let rekeys = rekeysByAsset.get(row.assetKey);
      if (rekeys === undefined) {
        rekeys = [];
        rekeysByAsset.set(row.assetKey, rekeys);
      }
      for (const binding of row.bindings) {
        if (binding.contentKey !== undefined) continue;
        const previousTexture: TextureAssetUploadRef = {
          colorSpace: binding.colorSpace,
          flipY: false,
          kind: "asset",
          ...(binding.sampler === undefined ? {} : { sampler: binding.sampler }),
          uri: binding.textureUri,
        };
        const nextTexture: TextureAssetUploadRef = { ...previousTexture, contentKey: row.contentKey };
        rekeys.push({
          next: { count: binding.count, key: textureCacheKey(nextTexture), texture: nextTexture },
          previous: { count: binding.count, key: textureCacheKey(previousTexture), texture: previousTexture },
        });
      }
    }
    for (const [key, rekeys] of rekeysByAsset) {
      this.#applyResourceArenaChanges(rekeyPreparedAssetOrdinaryTextures(this.#resourceArena, key, rekeys));
    }
    while (this.#pendingGltfImageRowHead < this.#pendingGltfImageRows.length) {
      const row = this.#pendingGltfImageRows[this.#pendingGltfImageRowHead];
      this.#pendingGltfImageRowHead += 1;
      if (row === undefined) continue;
      row.queued = false;
      const state = this.#gltf.get(row.assetKey);
      if (
        state === undefined
        || state.instanceKey !== row.stateInstanceKey
        || state.imageRows.get(row.key) !== row
        || row.status !== "ready"
        || row.source === undefined
      ) {
        if (row.source !== undefined) {
          const source = row.source;
          delete row.source;
          releaseResourceArenaAssetSource(this.#resourceArena, row.assetKey, row.key);
          if (resourceArenaSourceReferenceCount(this.#resourceArena, source) === 0) this.#closeTextureSource(source);
        }
        continue;
      }
      const source = row.source;

      for (const binding of row.bindings) {
        const contentKey = binding.contentKey ?? row.contentKey;
        const texture: TextureAssetUploadRef = {
          colorSpace: binding.colorSpace,
          ...(contentKey === undefined ? {} : { contentKey }),
          flipY: false,
          kind: "asset",
          ...(binding.sampler === undefined ? {} : { sampler: binding.sampler }),
          uri: binding.textureUri,
        };
        if (binding.baseColor) {
          this.#registerAutoBaseColorVirtualTextureManifest(texture, binding.sourceUri);
        }
        this.#settleDecodedTextureSource(texture, source);
      }
      if (row.iblSpecular !== undefined) {
        this.#settleIblSpecularImage(row.iblSpecular, row.key, source);
      }
      if (row.bindings.length === 0 && row.iblSpecular === undefined) this.#closeTextureSource(source);
      delete row.source;
      releaseResourceArenaAssetSource(this.#resourceArena, row.assetKey, row.key);
      if (resourceArenaSourceReferenceCount(this.#resourceArena, source) === 0) this.#closeTextureSource(source);
      for (const material of row.materials) {
        for (const primitive of this.#gltfMaterialPrimitives.get(material) ?? []) {
          this.#gltfPreparedPrimitiveMaterials.get(primitive)?.delete(material);
        }
      }
    }
    this.#pendingGltfImageRows.length = 0;
    this.#pendingGltfImageRowHead = 0;
    rekeysByAsset.clear();
  }

  #scheduleRender(): void {
    if (
      this.#disposed ||
      this.#contextLifecycle !== "active" ||
      !this.#renderDirty ||
      this.#externalRenderClocks > 0 ||
      this.#scheduledRenderGeneration !== 0 ||
      this.#latestScene === undefined
    ) return;
    const requestFrame = globalThis.requestAnimationFrame;
    const generation = this.#renderScheduleGeneration + 1;
    const contextGeneration = this.#contextGeneration;
    this.#renderScheduleGeneration = generation;
    this.#scheduledRenderGeneration = generation;
    const renderIfCurrent = (): void => {
      if (
        this.#scheduledRenderGeneration !== generation ||
        this.#contextGeneration !== contextGeneration ||
        this.#contextLifecycle !== "active" ||
        !this.#renderDirty ||
        this.#externalRenderClocks > 0
      ) return;
      this.#scheduledRenderGeneration = 0;
      if (!this.#disposed && this.#contextLifecycle === "active" && this.#latestScene !== undefined) {
        this.#renderLatestScene();
      }
    };
    if (typeof requestFrame === "function") requestFrame(renderIfCurrent);
    else queueMicrotask(renderIfCurrent);
  }

  #renderLatestScene(): void {
    const plan = this.#framePlan;
    if (plan === undefined) return;

    const { height, width } = this.#resize();
    const camera = this.#readCamera(plan.camera);
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

  #pickingWorkSnapshot(): WebGlPickingSnapshot {
    return {
      candidateHighWater: this.#pickCandidates.length,
      candidates: this.#pickCandidatesThisPick,
      exactTests: this.#pickExactTestsThisPick,
    };
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
      resources: ordinaryTextureGpuResourceCount(this.#ordinaryTextureGpu),
    };
  }

  #virtualTexturingSnapshot(): WebGlVirtualTexturingSnapshot {
    let atlasTextures = 0;
    let generatedManifestUses = 0;
    let generatedPageFailures = 0;
    let generatedPageRasterizeMaxMs = 0;
    let generatedPageRasterizeMs = 0;
    let generatedPageRequests = 0;
    let generatedPagesTarget = 0;
    let manifestFailures = 0;
    let manifestRequests = 0;
    let manifestsReady = 0;
    let pageTableTextures = 0;
    let pageTableUpdates = 0;
    let pendingPages = 0;
    let preparedResidencyResolutions = 0;
    let requestedPages = 0;
    let residentPages = 0;
    let shaderBinds = 0;
    let unreadyDraws = 0;
    let unsupportedDraws = this.#unsupportedVirtualTextureDraws;
    let uploadedPageBytes = 0;
    let uploadedPages = 0;

    for (const state of this.#virtualTextures.values()) {
      if (state.resources !== undefined) {
        atlasTextures += 1;
        pageTableTextures += 1;
      }
      generatedManifestUses += state.stats.generatedManifestUses;
      generatedPageFailures += state.stats.generatedPageFailures;
      generatedPageRasterizeMaxMs = Math.max(generatedPageRasterizeMaxMs, state.stats.generatedPageRasterizeMaxMs);
      generatedPageRasterizeMs += state.stats.generatedPageRasterizeMs;
      generatedPageRequests += state.stats.generatedPageRequests;
      generatedPagesTarget += state.stats.generatedPagesTarget;
      manifestFailures += state.stats.manifestFailures;
      manifestRequests += state.stats.manifestRequests;
      if (state.status === "ready") manifestsReady += 1;
      pageTableUpdates += state.stats.pageTableUpdates;
      pendingPages += state.loadingPages.size + state.pendingUploads.length;
      preparedResidencyResolutions += state.stats.preparedResidencyResolutions;
      requestedPages += state.requestedPages.size;
      residentPages += state.pageTable?.residentCount ?? 0;
      shaderBinds += state.stats.shaderBinds;
      unreadyDraws += state.stats.unreadyDraws;
      unsupportedDraws += state.stats.unsupportedDraws;
      uploadedPageBytes += state.stats.uploadedPageBytes;
      uploadedPages += state.uploadedPages.size;
    }

    return {
      atlasTextures,
      generatedManifestUses,
      generatedPageFailures,
      generatedPageRasterizeMaxMs,
      generatedPageRasterizeMs,
      generatedPageRequests,
      generatedPagesTarget,
      manifestFailures,
      manifestRequests,
      manifestsReady,
      pageTableTextures,
      pageTableUpdates,
      pendingPages,
      preparedResidencyResolutions,
      requestedPages,
      residentPages,
      shaderBinds,
      unreadyDraws,
      unsupportedDraws,
      uploadedPageBytes,
      uploadedPages,
    };
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
