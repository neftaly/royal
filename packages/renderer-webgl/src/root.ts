import {
  type BoxGeometry,
  type DirectionalLightNode,
  type EnvironmentLight,
  type EulerRads,
  type GltfNode,
  type Material,
  type MeshNode,
  type PlaneGeometry,
  type PickInput,
  type PickResult,
  type PickTarget,
  type RenderPass,
  type RenderToneMapping,
  type RenderObjectHandle,
  type RenderObjectRef,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type TextureContentKey,
  type TextNode,
  type TextureRef,
  type TextureSampler,
  type Transform,
  type UnlitMaterial,
  type Vec3,
} from "@royal/renderer-core";
import {
  createRenderObjectHandle,
  readRenderObjectHandleTransform,
} from "@royal/renderer-core/render-object";
import { textMesh } from "@royal/renderer-core/text/mesh";
import {
  gltfComponentCount,
  readGltfFloatAccessor,
  readGltfIndices,
  type GltfIndexArray,
} from "./gltf/accessors";
import {
  gltfAnimationNodeTransformsAt,
  readGltfAnimationClips,
  selectGltfAnimationClip,
  type GltfAnimatedNodeTransform,
  type GltfAnimationClip,
} from "./gltf/animation";
import {
  dataUriMediaType,
  decodeDataUri,
  gltfBufferViewBytes,
  loadGltfBuffers,
  loadGltfDocument,
  resolveResourceUri,
} from "./gltf/io";
import { canvasSupportsImageMimeType } from "./capabilities";
import {
  decodeGltfBasisuRgba,
} from "./gltf/codecs/basisu";
import {
  decodeGltfDracoPrimitives,
  type DecodedGltfDracoPrimitive,
} from "./gltf/codecs/draco";
import { decodeGltfMeshoptBufferViews } from "./gltf/codecs/meshopt";
import { assertSupportedRequiredGltfExtensions } from "./gltf/extensions";
import { readGltfSceneImageBasedLight } from "./gltf/image-based-light";
import { gltfImageLoadKey, type GltfImageKind } from "./gltf/image-keys";
import {
  applyGltfMorphTargets,
  gltfMorphWeights,
} from "./gltf/morph";
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
  type GltfTextureTransformExtension,
} from "./gltf/schema";
import {
  gltfInstanceTransformMat4,
  gltfInstancingAttributeCount,
  gltfNodeMat4,
} from "./gltf/transforms";
import {
  identityMat4,
  inverseMat4,
  multiplyMat4,
  normalizeVec3,
  projectionMat4,
  transformDirection,
  transformMat4,
  transformPoint,
  transformVec4,
  viewMat4,
  type Mat4,
} from "./math/mat4";
import {
  pointOnRay,
  rayAabbDistance,
  rayGeometryDistance,
  worldBounds,
  type Bounds3,
  type Ray,
  type RayGeometryMode,
} from "./math/picking";
import {
  isDecodedRgbaTexture,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "./texture-sources";
import {
  encodeVirtualTexturePageTableRgba8,
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
  DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS,
  isBlendedSurfaceMaterial,
  isTransmissiveSurfaceMaterial,
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
  type TextureAssetUploadRef,
} from "./webgl/materials";
import {
  type SurfaceShaderFeatures,
  type SurfaceShaderTextureFeature,
  type ProgramKind,
  fragmentShaderSource,
  surfaceShaderFeatureKey,
  vertexShaderSource,
} from "./webgl/shaders";
import {
  combineSurfaceLightSets,
  DEFAULT_LIGHT_DIRECTION,
  DEFAULT_SURFACE_LIGHT_SET,
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
  ensureIblSpecularTexture,
  settleIblSpecularImage,
  type IblSpecularTextureContext,
  type IblSpecularTextureResource,
} from "./webgl/ibl-specular-textures";
import { createIblBrdfLutTexture, IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT } from "./webgl/ibl-brdf-lut";
import { bindSurfaceIblUniforms, IBL_SPECULAR_TEXTURE_UNIT } from "./webgl/ibl-uniforms";
import {
  createStudioEnvironmentSpecularTexture,
  STUDIO_ENVIRONMENT_IRRADIANCE,
  STUDIO_ENVIRONMENT_SPECULAR_KEY,
  type StudioEnvironmentSpecularResource,
} from "./webgl/studio-environment";

/** Renderer context options accepted by the WebGL2 backend. */
export interface WebGlRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

type NormalizedWebGlRootOptions = Required<WebGlRootOptions>;

/** Snapshot of renderer state, intended for tests and host diagnostics. */
export interface WebGlRootSnapshot {
  readonly diagnostics: readonly string[];
  readonly disposed: boolean;
  readonly frame: number;
  /** Renderer-owned glTF load timing, intended for tests, examples benchmarks, and host diagnostics. */
  readonly gltfLoadDiagnostics: WebGlGltfLoadDiagnosticsSnapshot;
  /** Renderer-owned counters for tests, examples benchmarks, and host diagnostics. */
  readonly gltfInstancing: WebGlGltfInstancingSnapshot;
  readonly latestScene: RenderRoot | undefined;
  readonly options: Required<WebGlRootOptions>;
  readonly virtualTexturing: WebGlVirtualTexturingSnapshot;
}

export interface WebGlGltfLoadDiagnosticsAssetSnapshot {
  readonly animationCount: number;
  readonly error?: string;
  readonly imageFailures: number;
  readonly imageLoaded: number;
  readonly imageRequests: number;
  readonly key: string;
  readonly lightCount: number;
  readonly nodeCount: number;
  readonly phaseMs: {
    readonly animations?: number;
    readonly buffers?: number;
    readonly document?: number;
    readonly draco?: number;
    readonly firstImageComplete?: number;
    readonly imagesComplete?: number;
    readonly meshopt?: number;
    readonly scene?: number;
    readonly toSceneReady?: number;
  };
  readonly primitiveCount: number;
  readonly status: "loading" | "sceneReady" | "error";
  readonly variantCount: number;
}

export interface WebGlGltfLoadDiagnosticsSnapshot {
  readonly assets: readonly WebGlGltfLoadDiagnosticsAssetSnapshot[];
  readonly errorAssets: number;
  readonly loadingAssets: number;
  readonly sceneReadyAssets: number;
}

type WebGlGltfLoadDiagnosticsPhaseKey = keyof WebGlGltfLoadDiagnosticsAssetSnapshot["phaseMs"];

export interface WebGlGltfInstancingSnapshot {
  /** Transient batch plans built while grouping compatible glTF draws. */
  readonly batchPlansBuilt: number;
  readonly batchInstancesTotal: number;
  readonly drawCalls: number;
  readonly instancesDrawn: number;
  readonly localModelUploadBytes: number;
  readonly localModelUploadCalls: number;
  readonly rootPoseUploadBytes: number;
  readonly rootPoseUploadCalls: number;
  readonly rootScaleUploadBytes: number;
  readonly rootScaleUploadCalls: number;
}

export interface WebGlVirtualTexturingSnapshot {
  readonly atlasTextures: number;
  readonly generatedManifestUses: number;
  readonly generatedPageFailures: number;
  readonly generatedPageRasterizeMaxMs: number;
  readonly generatedPageRasterizeMs: number;
  readonly generatedPageRequests: number;
  readonly generatedPagesTarget: number;
  readonly manifestFailures: number;
  readonly manifestRequests: number;
  readonly manifestsReady: number;
  readonly pageTableTextures: number;
  readonly pageTableUpdates: number;
  readonly pendingPages: number;
  readonly preparedResidencyResolutions: number;
  readonly requestedPages: number;
  readonly residentPages: number;
  readonly shaderBinds: number;
  readonly unreadyDraws: number;
  readonly unsupportedDraws: number;
  readonly uploadedPageBytes: number;
  readonly uploadedPages: number;
}

export interface WebGlRenderViewport {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface WebGlRenderView {
  readonly projectionMatrix: ArrayLike<number>;
  readonly viewMatrix: ArrayLike<number>;
  readonly viewport: WebGlRenderViewport;
}

export interface WebGlRenderViewsOptions {
  readonly framebuffer?: WebGLFramebuffer | null;
  readonly views: readonly WebGlRenderView[];
}

/** Imperative WebGL2 renderer root. */
export interface WebGlRoot {
  readonly canvas: HTMLCanvasElement;
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  readonly options: Required<WebGlRootOptions>;
  dispose(): void;
  /** Requests one render of the latest scene on the root's active render clock. */
  invalidate(): void;
  pick(input: PickInput): PickResult | undefined;
  render(scene: RenderRoot): void;
  renderViews(scene: RenderRoot, options: WebGlRenderViewsOptions): void;
  snapshot(): WebGlRootSnapshot;
}

type PickCandidate = PickResult & {
  readonly drawOrdinal: number;
  readonly passOrdinal: number;
};

type ProgramResource = {
  readonly fragmentShader: WebGLShader;
  readonly program: WebGLProgram;
  readonly vertexShader: WebGLShader;
};

type UniformValue = readonly number[];

type GeometryDrawMode =
  | "line-loop"
  | "line-strip"
  | "lines"
  | "points"
  | "triangle-fan"
  | "triangle-strip"
  | "triangles";

type GeometryProgramVertexArrays = {
  base?: WebGLVertexArrayObject;
  readonly instanced: Map<string, WebGLVertexArrayObject>;
};

type VertexAttribDefaultValue =
  | {
    readonly size: 2;
    readonly x: number;
    readonly y: number;
  }
  | {
    readonly size: 4;
    readonly w: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };

type GeometryResource = {
  readonly arrayBuffer: WebGLBuffer;
  readonly borrowedVertexBufferKey?: string;
  readonly colorBuffer?: WebGLBuffer;
  readonly drawCount: number;
  readonly emissiveTexCoordBuffer?: WebGLBuffer;
  readonly indexBuffer?: WebGLBuffer;
  readonly indexType?: number;
  readonly key: string;
  readonly mode: GeometryDrawMode;
  readonly normalBuffer?: WebGLBuffer;
  readonly tangentBuffer?: WebGLBuffer;
  readonly texCoordBuffer?: WebGLBuffer;
  readonly vertexArrays: Map<WebGLProgram, GeometryProgramVertexArrays>;
};

type CpuGeometry = {
  readonly colors?: Float32Array;
  readonly emissiveTexCoords?: Float32Array;
  readonly indices?: GltfIndexArray;
  readonly key: string;
  readonly mode: GeometryDrawMode;
  readonly normals?: Float32Array;
  readonly tangents?: Float32Array;
  readonly positions: Float32Array;
  readonly texCoords?: Float32Array;
  readonly vertexBufferKey?: string;
};

type TextureResource = {
  readonly key: string;
  pendingUpload?: TexturePendingUpload;
  readonly texture: WebGLTexture;
  uploaded: boolean;
};

type TexturePendingUpload = {
  readonly source: LoadedTextureSource;
  readonly texture: TextureAssetUploadRef;
};

type ScreenColorTextureResource = {
  height: number;
  readonly texture: WebGLTexture;
  uploaded: boolean;
  width: number;
};

type TextureLoadState = TextureResource & {
  error?: string;
  loading: boolean;
};

type TextureUnitAllocator = {
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

type VirtualTextureRef = Extract<TextureRef, { readonly kind: "virtual-asset" }>;

type VirtualTextureRuntimeStatus = "error" | "loading" | "ready" | "unsupported";

type VirtualTextureResourceSet = {
  readonly atlasTexture: WebGLTexture;
  readonly atlasGridColumns: number;
  readonly atlasGridRows: number;
  readonly pageTableTexture: WebGLTexture;
  readonly pageTableHeight: number;
  readonly pageTableWidth: number;
};

type VirtualTexturePendingUpload = {
  readonly image: TexImageSource;
  readonly page: VirtualTexturePageId;
  readonly pageKey: string;
};

type SvgVirtualTextureSource = {
  readonly height: number;
  readonly label: string;
  readonly text: string;
  readonly width: number;
};

type RasterVirtualTextureSource = {
  canvasSource?: CanvasImageSource;
  readonly colorSpace?: TextureColorSpace;
  readonly height: number;
  readonly label: string;
  readonly source: LoadedTextureSource;
  readonly width: number;
};

type VirtualTextureGeneratedPageSource =
  | { readonly kind: "raster"; readonly source: RasterVirtualTextureSource }
  | { readonly kind: "svg"; readonly source: SvgVirtualTextureSource };

type VirtualTextureManifestSource =
  | { readonly kind: "generated"; readonly manifestUri: string; readonly pageSource: VirtualTextureGeneratedPageSource }
  | { readonly kind: "sidecar"; readonly manifestUri: string };

type VirtualTextureFallbackTrigger =
  | "fetch-failed"
  | "late-generated-source"
  | "manifest-unsupported"
  | "parse-failed"
  | "runtime-unsupported";

type AutoVirtualTexturePlan = {
  readonly fallback?: Extract<VirtualTextureManifestSource, { readonly kind: "generated" }>;
  readonly fallbackTriggers: ReadonlySet<VirtualTextureFallbackTrigger>;
  readonly primary: VirtualTextureManifestSource;
};

type AutoVirtualTexturePlanInput = {
  readonly generatedPageSource?: VirtualTextureGeneratedPageSource;
  readonly sidecarManifestUri?: string;
  readonly textureKey: string;
};

type VirtualTextureRuntimeStats = {
  generatedManifestUses: number;
  generatedPageFailures: number;
  generatedPageRasterizeMaxMs: number;
  generatedPageRasterizeMs: number;
  generatedPageRequests: number;
  generatedPagesTarget: number;
  manifestFailures: number;
  manifestRequests: number;
  pageTableUpdates: number;
  preparedResidencyResolutions: number;
  shaderBinds: number;
  unreadyDraws: number;
  unsupportedDraws: number;
  uploadedPageBytes: number;
  uploadedPages: number;
};

type VirtualTextureRuntimeState = {
  activeSource: VirtualTextureManifestSource;
  autoPlan?: AutoVirtualTexturePlan;
  diagnostics: string[];
  diagnosticsEnabled: boolean;
  readonly key: string;
  loadingPages: Set<string>;
  manifest?: VirtualTextureManifestModel;
  pageUrisByKey?: ReadonlyMap<string, string>;
  pageTable?: VirtualTextureAtlasPageTable;
  pendingUploads: VirtualTexturePendingUpload[];
  readonly requestedPages: Set<string>;
  resources?: VirtualTextureResourceSet;
  stats: VirtualTextureRuntimeStats;
  status: VirtualTextureRuntimeStatus;
  readonly texture: VirtualTextureRef;
  readonly uploadedPages: Set<string>;
};

type BaseColorTextureResidency =
  | { readonly kind: "none" }
  | { readonly kind: "ordinary"; readonly texture: TextureAssetUploadRef }
  | {
      readonly kind: "prepared-virtual";
      readonly ordinaryFallback?: TextureAssetUploadRef;
      readonly state: VirtualTextureRuntimeState;
    };

type VirtualTextureDrawDemandModelSource =
  | { readonly kind: "composed"; readonly localModels: readonly Mat4[]; readonly rootModels: readonly Mat4[] }
  | { readonly kind: "single"; readonly model: Mat4 };

type VirtualTextureDrawDemandContext = {
  readonly modelSource: VirtualTextureDrawDemandModelSource;
  readonly positions: Float32Array;
  readonly projection: Mat4;
  readonly texCoords: Float32Array;
  readonly view: Mat4;
  readonly viewportSize: ViewportSize;
};

type VirtualTextureScreenFootprint = {
  readonly maxU: number;
  readonly maxV: number;
  readonly minU: number;
  readonly minV: number;
  readonly screenHeight: number;
  readonly screenWidth: number;
};

type VirtualTextureDrawDemand = {
  readonly coverageCandidates?: readonly VirtualTexturePageId[];
  readonly demandCandidates: readonly VirtualTexturePageId[];
};

type LoadedGltfPrimitive = {
  readonly baseMaterial: LoadedGltfPrimitiveMaterial;
  readonly colors?: Float32Array;
  readonly indices?: GltfIndexArray;
  readonly instanceTransforms: readonly Mat4[];
  readonly key: string;
  readonly localBounds: readonly (Bounds3 | undefined)[];
  readonly localModelDeterminants: readonly number[];
  readonly localModels: readonly Mat4[];
  readonly material: LoadedGltfMaterial;
  readonly materialLod?: GltfMaterialPrimitiveLod;
  readonly materialVariants?: readonly LoadedGltfMaterialVariant[];
  readonly mode: GeometryDrawMode;
  readonly nodePath: readonly number[];
  readonly nodeLod?: GltfNodePrimitiveLod;
  readonly normals?: Float32Array;
  readonly positions: Float32Array;
  readonly tangents?: Float32Array;
};

type LoadedGltfMaterial = {
  readonly alphaCutoff?: number;
  readonly alphaMode: SurfaceMaterialAlphaMode;
  readonly baseColorContentKey?: TextureContentKey;
  readonly baseColorImageUri?: string;
  readonly baseColorSourceUri?: string;
  readonly baseColorSvgVirtualTextureSource?: SvgVirtualTextureSource;
  readonly baseColorTextureUri?: string;
  readonly color?: Rgba;
  readonly doubleSided: boolean;
  readonly emissive?: Rgba;
  readonly emissiveContentKey?: TextureContentKey;
  readonly emissiveImage?: LoadedTextureSource;
  readonly emissiveImageFailed?: boolean;
  readonly emissiveImageUri?: string;
  readonly emissiveSampler?: TextureSampler;
  readonly emissiveSourceUri?: string;
  readonly emissiveTexCoords?: Float32Array;
  readonly emissiveTextureUri?: string;
  readonly image?: LoadedTextureSource;
  readonly imageFailed?: boolean;
  readonly extensionFactors?: SurfaceMaterialExtensionFactors;
  readonly metallicRoughnessContentKey?: TextureContentKey;
  readonly metallicRoughnessImage?: LoadedTextureSource;
  readonly metallicRoughnessImageFailed?: boolean;
  readonly metallicRoughnessImageUri?: string;
  readonly metallicRoughnessSampler?: TextureSampler;
  readonly metallicRoughnessSourceUri?: string;
  readonly metallicRoughnessTextureUri?: string;
  readonly metallicFactor?: number;
  readonly normalContentKey?: TextureContentKey;
  readonly normalImage?: LoadedTextureSource;
  readonly normalImageFailed?: boolean;
  readonly normalImageUri?: string;
  readonly normalSampler?: TextureSampler;
  readonly normalScale?: number;
  readonly normalSourceUri?: string;
  readonly normalTextureUri?: string;
  readonly occlusionContentKey?: TextureContentKey;
  readonly occlusionImage?: LoadedTextureSource;
  readonly occlusionImageFailed?: boolean;
  readonly occlusionImageUri?: string;
  readonly occlusionSampler?: TextureSampler;
  readonly occlusionSourceUri?: string;
  readonly occlusionStrength?: number;
  readonly occlusionTextureUri?: string;
  readonly roughnessFactor?: number;
  readonly sampler?: TextureSampler;
  readonly texCoords?: Float32Array;
  readonly unlit?: boolean;
  readonly extensionTextures?: LoadedGltfMaterialExtensionTextures;
};

type LoadedGltfMaterialTextureSlot = {
  readonly contentKey?: TextureContentKey;
  readonly image?: LoadedTextureSource;
  readonly imageFailed?: boolean;
  readonly imageUri?: string;
  readonly sampler?: TextureSampler;
  readonly sourceUri?: string;
  readonly textureUri?: string;
};

type LoadedGltfImageSource = {
  readonly contentKey?: TextureContentKey;
  readonly image: LoadedTextureSource;
};

const loadedGltfImageSource = (
  image: LoadedTextureSource,
  contentKey: TextureContentKey | undefined,
): LoadedGltfImageSource => ({
  ...(contentKey === undefined ? {} : { contentKey }),
  image,
});

const loadedGltfPrimitiveBaseMaterial = (
  material: LoadedGltfMaterial,
  materialLod: GltfMaterialPrimitiveLod | undefined,
): LoadedGltfPrimitiveMaterial => ({
  material,
  ...(materialLod === undefined ? {} : { materialLod }),
  selectionKey: "base",
});

type LoadedGltfMaterialExtensionTextures = {
  readonly clearcoatRoughnessTexture?: LoadedGltfMaterialTextureSlot;
  readonly clearcoatTexture?: LoadedGltfMaterialTextureSlot;
  readonly iridescenceTexture?: LoadedGltfMaterialTextureSlot;
  readonly iridescenceThicknessTexture?: LoadedGltfMaterialTextureSlot;
  readonly materialTransmissionTexture?: LoadedGltfMaterialTextureSlot;
  readonly sheenColorTexture?: LoadedGltfMaterialTextureSlot;
  readonly sheenRoughnessTexture?: LoadedGltfMaterialTextureSlot;
  readonly specularColorTexture?: LoadedGltfMaterialTextureSlot;
  readonly specularTexture?: LoadedGltfMaterialTextureSlot;
  readonly thicknessTexture?: LoadedGltfMaterialTextureSlot;
};

type DrawSidedness = {
  readonly doubleSided: boolean;
  readonly frontFaceCcw: boolean;
};

type GltfTextureImageSelection = {
  readonly imageIndex: number;
  readonly kind: GltfImageKind;
};

type GltfNodePrimitiveLod = {
  readonly group: string;
  readonly level: number;
  readonly levelCount: number;
  readonly thresholds: readonly number[];
};

type GltfMaterialPrimitiveLod = {
  readonly levels: readonly LoadedGltfMaterial[];
  readonly thresholds: readonly number[];
};

type LoadedGltfMaterialVariant = {
  readonly material: LoadedGltfMaterial;
  readonly materialLod?: GltfMaterialPrimitiveLod;
  readonly variants: readonly number[];
};

type LoadedGltfPrimitiveMaterial = {
  readonly material: LoadedGltfMaterial;
  readonly materialLod?: GltfMaterialPrimitiveLod;
  readonly selectionKey: string;
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

const loadedGltfSurfaceMaterial = (
  loadedMaterial: LoadedGltfMaterial,
  baseColor: TextureRef,
  textures: LoadedGltfSurfaceTextures,
): SurfaceMaterial => {
  const emissive = loadedMaterial.emissive;
  const extensionFactors = loadedMaterial.extensionFactors;
  const common = {
    baseColor,
    alphaMode: loadedMaterial.alphaMode,
    ...(loadedMaterial.alphaMode === "MASK" ? { alphaCutoff: loadedMaterial.alphaCutoff ?? 0.5 } : {}),
    doubleSided: loadedMaterial.doubleSided,
    ...(emissive === undefined ? {} : { emissive }),
    ...(textures.emissiveTexture === undefined ? {} : { emissiveTexture: textures.emissiveTexture }),
    ...(extensionFactors === undefined ? {} : { extensionFactors }),
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

type GltfLodSelectionState = {
  readonly level: number;
};

type GltfLoadMetrics = {
  animationsReadAt?: number;
  buffersLoadedAt?: number;
  documentLoadedAt?: number;
  dracoDecodedAt?: number;
  firstImageSettledAt?: number;
  imageFailures: number;
  imageLoaded: number;
  imageLoadStartedAt?: number;
  imageRequests: number;
  imagesSettledAt?: number;
  meshoptDecodedAt?: number;
  readyAt?: number;
  sceneReadAt?: number;
  readonly startedAt: number;
};

type GltfState = {
  animations: readonly GltfAnimationClip[];
  hasMaterialVariants: boolean;
  hasNodeLod: boolean;
  imageBasedLight?: SurfaceImageBasedLight;
  readonly instanceKey: number;
  readonly key: string;
  error?: string;
  lights: readonly SurfaceLight[];
  readonly load: GltfLoadMetrics;
  nodes: readonly GltfSceneNode[];
  primitives: readonly LoadedGltfPrimitive[];
  status: "loading" | "ready" | "error";
  variants: readonly string[];
};

type GltfPrimitiveDraw = {
  readonly geometry: CpuGeometry;
  readonly lights?: SurfaceLightSet;
  readonly localModel: Mat4;
  readonly material: SurfaceMaterial;
  readonly materialBatchKey: string;
  readonly modelSignatureInstanceIndex: number;
  readonly modelSignatureStateKey: number;
  readonly modelSignatureValues?: readonly number[];
  readonly rootModel: Mat4;
  readonly rootPositionSignatureVersion?: number;
  readonly rootRotationSignatureVersion?: number;
  readonly rootScaleSignatureVersion?: number;
  readonly rootTransform: Transform | undefined;
  readonly sidedness: DrawSidedness;
};

type GltfPrimitiveDrawBatch = {
  cpuGeometry: CpuGeometry;
  geometry: GeometryResource;
  readonly key: string;
  lights: SurfaceLightSet;
  readonly localModelSignature: number[];
  readonly localModels: Mat4[];
  material: SurfaceMaterial;
  readonly rootPositionSignature: number[];
  readonly rootRotationSignature: number[];
  readonly rootScaleSignature: number[];
  readonly rootModels: Mat4[];
  readonly rootTransforms: Array<Transform | undefined>;
  sidedness: DrawSidedness;
};

type GltfPrimitiveDrawBatchInput = {
  readonly draw: GltfPrimitiveDraw;
  readonly geometry: GeometryResource;
  readonly key: string;
  readonly lights: SurfaceLightSet;
};

type GltfPrimitiveDrawBatchPlanCacheEntry = {
  readonly batches: GltfPrimitiveDrawBatch[];
};

type GltfPreparedPrimitiveMaterial = {
  readonly geometry: CpuGeometry;
  readonly material: SurfaceMaterial;
  readonly materialBatchKey: string;
};

type GltfInstanceFloatBufferResource = {
  capacity: number;
  readonly buffer: WebGLBuffer;
  readonly data: Float32Array;
  dirty: boolean;
};

type GltfInstanceVectorBufferResource = GltfInstanceFloatBufferResource & {
  signature?: number[];
};

type GltfInstanceRootPoseBufferResource = GltfInstanceFloatBufferResource & {
  positionSignature?: number[];
  rotationSignature?: number[];
};

type GltfInstanceBufferResource = {
  localCapacity: number;
  readonly localBuffer: WebGLBuffer;
  readonly localData: Float32Array;
  localDirty: boolean;
  localSignature?: number[];
  instanceCount: number;
  readonly rootPose: GltfInstanceRootPoseBufferResource;
  readonly rootScale: GltfInstanceVectorBufferResource;
};

type WebGlGltfInstancingCounters = {
  -readonly [Key in keyof WebGlGltfInstancingSnapshot]: WebGlGltfInstancingSnapshot[Key];
};

type ViewportSize = readonly [width: number, height: number];

type SceneRenderView = {
  projection(renderPass: RenderPass): Mat4;
  readonly viewport: WebGlRenderViewport;
  view(renderPass: RenderPass): Mat4;
};
type PassToneMappingState = {
  readonly exposure: number;
  readonly toneMapping: RenderToneMapping;
};

const DEFAULT_COLOR: Rgba = [0.5, 0.5, 0.5, 1];
const TEXTURE_COLOR: Rgba = [1, 1, 1, 1];
const DEFAULT_TONE_MAPPING_STATE: PassToneMappingState = {
  exposure: 1,
  toneMapping: "none",
};
const GLTF_LOD_HYSTERESIS_RATIO = 0.15;
const VT_WRAP_CLAMP_TO_EDGE = 0;
const VT_WRAP_REPEAT = 1;
const VT_WRAP_MIRRORED_REPEAT = 2;
const GENERATED_SVG_VIRTUAL_TEXTURE_PAGE_SIZE = 256;
const GENERATED_SVG_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP = 64;
const GENERATED_RASTER_VIRTUAL_TEXTURE_PAGE_SIZE = 256;
const GENERATED_RASTER_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP = 64;
const GENERATED_RASTER_VIRTUAL_TEXTURE_MIN_DIMENSION = GENERATED_RASTER_VIRTUAL_TEXTURE_PAGE_SIZE + 1;
const GENERATED_VIRTUAL_TEXTURE_MANIFEST_URI_PREFIX = "royal-generated-vt:";
const VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME = 4;
const VIRTUAL_TEXTURE_MAX_PAGE_UPLOADS_PER_FRAME = 2;
const VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS = 4;
const VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW = 32;
const TEXTURE_MAX_UPLOADS_PER_FRAME = 1;
const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const TYPED_ARRAY_CONTENT_KEYS = new WeakMap<ArrayBufferView, string>();
const FNV_1A_32_OFFSET = 0x811c9dc5;
const FNV_1A_32_PRIME = 0x01000193;
const DJB2_XOR_OFFSET = 5381;

const passToneMappingState = (renderPass: RenderPass): PassToneMappingState => ({
  exposure: renderPass.exposure === undefined || !Number.isFinite(renderPass.exposure)
    ? DEFAULT_TONE_MAPPING_STATE.exposure
    : Math.max(0, renderPass.exposure),
  toneMapping: renderPass.toneMapping ?? DEFAULT_TONE_MAPPING_STATE.toneMapping,
});

const normalizeVirtualTextureDemandUvRange = (
  min: number,
  max: number,
): readonly [number, number] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max - min >= 1 || min < 0 || max > 1) return [0, 1];
  return [Math.max(0, min), Math.min(1, max)];
};

const virtualTextureDemandPageDistance = (
  page: VirtualTexturePageId,
  centerX: number,
  centerY: number,
): number => {
  const pageCenterX = page.x + 0.5;
  const pageCenterY = page.y + 0.5;
  return (pageCenterX - centerX) ** 2 + (pageCenterY - centerY) ** 2;
};

const hex32 = (value: number): string =>
  value.toString(16).padStart(8, "0");

const hashBytes = (bytes: Uint8Array): string => {
  let hash = FNV_1A_32_OFFSET;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_1A_32_PRIME) >>> 0;
  }

  return hex32(hash);
};

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
  byteContentKey(svgTextEncoder.encode(svgText).buffer, "image/svg+xml;prepared");

const typedArrayContentKey = (array: ArrayBufferView | undefined): string => {
  if (array === undefined) return "none";
  const cached = TYPED_ARRAY_CONTENT_KEYS.get(array);
  if (cached !== undefined) return cached;

  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  const key = [
    array.constructor.name,
    array.byteLength,
    hashBytes(bytes),
  ].join(":");
  TYPED_ARRAY_CONTENT_KEYS.set(array, key);
  return key;
};

const mat4FromArrayLike = (matrix: ArrayLike<number>): Mat4 => {
  if (matrix.length !== 16) throw new Error("Royal WebGL render views require 4x4 matrices");
  return [
    matrix[0]!, matrix[1]!, matrix[2]!, matrix[3]!,
    matrix[4]!, matrix[5]!, matrix[6]!, matrix[7]!,
    matrix[8]!, matrix[9]!, matrix[10]!, matrix[11]!,
    matrix[12]!, matrix[13]!, matrix[14]!, matrix[15]!,
  ];
};

const gltfPrimitiveNodePathModel = (
  nodes: readonly GltfSceneNode[],
  nodePath: readonly number[],
  animationTransforms: ReadonlyMap<number, GltfAnimatedNodeTransform> | undefined,
): Mat4 => {
  let model = identityMat4();
  for (const nodeIndex of nodePath) {
    model = multiplyMat4(model, gltfNodeMat4(nodes[nodeIndex], animationTransforms?.get(nodeIndex)));
  }

  return model;
};

const gltfPrimitiveAnimatedLocalModels = (
  nodes: readonly GltfSceneNode[],
  primitive: LoadedGltfPrimitive,
  animationTransforms: ReadonlyMap<number, GltfAnimatedNodeTransform>,
): readonly Mat4[] => {
  const pathModel = gltfPrimitiveNodePathModel(nodes, primitive.nodePath, animationTransforms);

  return primitive.instanceTransforms.map((instanceTransform) => multiplyMat4(pathModel, instanceTransform));
};

const gltfAnimationSelectionLabel = (selection: GltfNode["animation"]): string => {
  if (selection === undefined || selection.clip === undefined) return "default clip";

  return typeof selection.clip === "number" ? `clip index ${selection.clip}` : `clip "${selection.clip}"`;
};

const gltfGeometryContentKey = ({
  colors,
  emissiveTexCoords,
  indices,
  mode,
  normals,
  positions,
  tangents,
  texCoords,
}: {
  readonly colors?: Float32Array | undefined;
  readonly emissiveTexCoords?: Float32Array | undefined;
  readonly indices?: GltfIndexArray | undefined;
  readonly mode: GeometryDrawMode;
  readonly normals?: Float32Array | undefined;
  readonly positions: Float32Array;
  readonly tangents?: Float32Array | undefined;
  readonly texCoords?: Float32Array | undefined;
}): string => [
  "gltf-geometry",
  mode,
  typedArrayContentKey(positions),
  typedArrayContentKey(normals),
  typedArrayContentKey(tangents),
  typedArrayContentKey(colors),
  typedArrayContentKey(texCoords),
  typedArrayContentKey(emissiveTexCoords),
  typedArrayContentKey(indices),
].join("|");

type TransformableRenderNode = GltfNode | MeshNode;

type RenderObjectBinding = {
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

const appendTransformVectorSignatureValues = (
  signature: number[],
  transform: Transform | undefined,
  field: keyof Transform,
): void => {
  const resolved = transform ?? IDENTITY_TRANSFORM;
  signature.push(resolved[field][0], resolved[field][1], resolved[field][2]);
};

const appendGltfLocalModelSignature = (
  signature: number[],
  draw: GltfPrimitiveDraw,
): void => {
  if (draw.modelSignatureValues !== undefined) {
    signature.push(...draw.modelSignatureValues);
    return;
  }

  signature.push(draw.modelSignatureStateKey, draw.modelSignatureInstanceIndex);
};

const appendGltfRootSignatures = (
  positionSignature: number[],
  rotationSignature: number[],
  scaleSignature: number[],
  draw: GltfPrimitiveDraw,
): void => {
  if (draw.rootPositionSignatureVersion === undefined) {
    appendTransformVectorSignatureValues(positionSignature, draw.rootTransform, "position");
  } else {
    positionSignature.push(draw.rootPositionSignatureVersion);
  }
  if (draw.rootRotationSignatureVersion === undefined) {
    appendTransformVectorSignatureValues(rotationSignature, draw.rootTransform, "rotation");
  } else {
    rotationSignature.push(draw.rootRotationSignatureVersion);
  }
  if (draw.rootScaleSignatureVersion === undefined) {
    appendTransformVectorSignatureValues(scaleSignature, draw.rootTransform, "scale");
  } else {
    scaleSignature.push(draw.rootScaleSignatureVersion);
  }
};

const gltfInstanceSignatureStride = (
  instanceCount: number,
  modelSignature: readonly number[],
): number | undefined => {
  if (instanceCount <= 0) return undefined;
  const stride = modelSignature.length / instanceCount;

  return Number.isInteger(stride) && stride > 0 ? stride : undefined;
};

const sameGltfModelSignatureRange = (
  left: readonly number[],
  right: readonly number[],
  start: number,
  length: number,
): boolean => {
  for (let index = 0; index < length; index += 1) {
    if (!Object.is(left[start + index], right[start + index])) return false;
  }

  return true;
};

const copyGltfInstanceSignature = (
  target: number[] | undefined,
  source: readonly number[],
): number[] => {
  const next = target ?? [];
  next.length = source.length;
  for (let index = 0; index < source.length; index += 1) next[index] = source[index]!;
  return next;
};

const createGltfInstanceFloatBufferResource = (
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer,
  floatCount: number,
  existing?: GltfInstanceFloatBufferResource,
): GltfInstanceFloatBufferResource => {
  const data = new Float32Array(floatCount);
  if (existing !== undefined) {
    data.set(existing.data.subarray(0, Math.min(existing.data.length, data.length)));
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, floatCount * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);
  return {
    buffer,
    capacity: floatCount,
    data,
    dirty: true,
  };
};

const createGltfInstanceVectorBufferResource = (
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer,
  floatCount: number,
  existing?: GltfInstanceVectorBufferResource,
): GltfInstanceVectorBufferResource =>
  createGltfInstanceFloatBufferResource(gl, buffer, floatCount, existing);

const createGltfInstanceRootPoseBufferResource = (
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer,
  floatCount: number,
  existing?: GltfInstanceRootPoseBufferResource,
): GltfInstanceRootPoseBufferResource =>
  createGltfInstanceFloatBufferResource(gl, buffer, floatCount, existing);

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

const gltfPrimitiveDrawBatchPlanKey = (inputs: readonly GltfPrimitiveDrawBatchInput[]): string => {
  const parts: string[] = [];
  let currentKey: string | undefined;
  let runLength = 0;

  const flushRun = (): void => {
    if (currentKey === undefined) return;
    parts.push(`${runLength}x${currentKey.length}:${currentKey}`);
  };

  for (const input of inputs) {
    if (input.key === currentKey) {
      runLength += 1;
      continue;
    }

    flushRun();
    currentKey = input.key;
    runLength = 1;
  }
  flushRun();

  return parts.join("|");
};

const appendGltfPrimitiveDrawBatchInput = (
  batch: GltfPrimitiveDrawBatch,
  input: GltfPrimitiveDrawBatchInput,
): void => {
  const draw = input.draw;
  appendGltfLocalModelSignature(batch.localModelSignature, draw);
  appendGltfRootSignatures(
    batch.rootPositionSignature,
    batch.rootRotationSignature,
    batch.rootScaleSignature,
    draw,
  );
  batch.localModels.push(draw.localModel);
  batch.rootModels.push(draw.rootModel);
  batch.rootTransforms.push(draw.rootTransform);
};

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
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  };
};

const samplerConstant = (
  gl: WebGL2RenderingContext,
  value: string | undefined,
  fallback: number,
): number => {
  switch (value) {
    case "clamp-to-edge":
      return gl.CLAMP_TO_EDGE;
    case "linear":
      return gl.LINEAR;
    case "linear-mipmap-linear":
      return gl.LINEAR_MIPMAP_LINEAR;
    case "linear-mipmap-nearest":
      return gl.LINEAR_MIPMAP_NEAREST;
    case "mirrored-repeat":
      return gl.MIRRORED_REPEAT;
    case "nearest":
      return gl.NEAREST;
    case "nearest-mipmap-linear":
      return gl.NEAREST_MIPMAP_LINEAR;
    case "nearest-mipmap-nearest":
      return gl.NEAREST_MIPMAP_NEAREST;
    case "repeat":
      return gl.REPEAT;
    default:
      return fallback;
  }
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

const isSvgMimeType = (mimeType: string | undefined): boolean =>
  mimeType?.toLowerCase() === "image/svg+xml";

const isSvgUri = (uri: string): boolean =>
  uri.startsWith("data:")
    ? isSvgMimeType(dataUriMediaType(uri))
    : /\.svg(?:$|[?#])/iu.test(uri);

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

const usesMipmaps = (value: string | undefined): boolean =>
  value === "linear-mipmap-linear"
  || value === "linear-mipmap-nearest"
  || value === "nearest-mipmap-linear"
  || value === "nearest-mipmap-nearest";

const textureUploadInternalFormat = (
  gl: WebGL2RenderingContext,
  colorSpace: TextureColorSpace | undefined,
): number =>
  colorSpace === "srgb"
    ? gl.SRGB8_ALPHA8
    : gl.RGBA;

const disableBrowserUnpackColorConversion = (gl: WebGL2RenderingContext): void => {
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, 0);
};

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
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
  image.src = src;

  if (image.complete) onLoad();
});

const loadImageBitmapFromBytes = (
  bytes: ArrayBuffer,
  mimeType: string | undefined,
): Promise<ImageBitmap> => {
  const createBitmap = globalThis.createImageBitmap;
  if (typeof createBitmap !== "function") {
    return Promise.reject(new Error("ImageBitmap decoding is unavailable for glTF bufferView image"));
  }
  const blob = new Blob([bytes], {
    type: mimeType ?? "application/octet-stream",
  });

  return createBitmap(blob);
};

const loadImageFromBlob = async (blob: Blob, label: string): Promise<HTMLImageElement> => {
  if (
    typeof globalThis.URL?.createObjectURL !== "function"
    || typeof globalThis.URL.revokeObjectURL !== "function"
  ) {
    throw new Error(`Object URL loading is unavailable for ${label}`);
  }

  const url = globalThis.URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    globalThis.URL.revokeObjectURL(url);
  }
};

const svgRootPattern = /<svg\b([^>]*)>/iu;
const svgViewBoxPattern = /\bviewBox\s*=\s*(["'])(.*?)\1/iu;
const svgWidthPattern = /\bwidth\s*=\s*(["'])(.*?)\1/iu;
const svgHeightPattern = /\bheight\s*=\s*(["'])(.*?)\1/iu;
const svgXmlBasePattern = /\bxml:base\s*=\s*(["'])(.*?)\1/iu;
const svgImageElementPattern = /<image\b[^>]*>/giu;
const svgHrefAttributePattern = /\b((?:xlink:)?href)\s*=\s*(["'])(.*?)\2/giu;
const svgDimensionPattern = /^\s*([+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?)\s*(?:px|pt|pc|mm|cm|in)?\s*$/iu;
const svgExternalReferenceMaxDepth = 8;
const svgTextDecoder = new TextDecoder();
const svgTextEncoder = new TextEncoder();
const svgVirtualTextureSourceSymbol = Symbol("royal.svgVirtualTextureSource");

type SvgTextureViewport = {
  readonly fromViewBox: boolean;
  readonly height: number;
  readonly width: number;
};

type SvgVirtualTextureSourceCarrier = {
  [svgVirtualTextureSourceSymbol]?: SvgVirtualTextureSource;
};

type SvgImageReferenceContext = {
  readonly active: Set<string>;
  readonly cache: Map<string, Promise<SvgImageReferenceValue>>;
  readonly depth: number;
};

type SvgImageReferenceValue = {
  readonly kind: "data-uri";
  readonly value: string;
};

const positiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

const parseSvgDimension = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const match = svgDimensionPattern.exec(value);
  if (match === null) return undefined;
  const parsed = Number.parseFloat(match[1] ?? "");

  return positiveFinite(parsed) ? parsed : undefined;
};

const svgTextureViewport = (svgText: string): SvgTextureViewport | undefined => {
  const svgRoot = svgRootPattern.exec(svgText);
  if (svgRoot === null) return undefined;

  const attributes = svgRoot[1] ?? "";
  const width = parseSvgDimension(svgWidthPattern.exec(attributes)?.[2]);
  const height = parseSvgDimension(svgHeightPattern.exec(attributes)?.[2]);
  if (width !== undefined && height !== undefined) {
    return {
      fromViewBox: false,
      height,
      width,
    };
  }

  const viewBox = svgViewBoxPattern.exec(attributes)?.[2];
  if (viewBox !== undefined) {
    const values = viewBox.trim().split(/[\s,]+/u).map((value) => Number(value));
    if (
      values.length === 4
      && values.every((value) => Number.isFinite(value))
      && positiveFinite(values[2] ?? Number.NaN)
      && positiveFinite(values[3] ?? Number.NaN)
    ) {
      return {
        fromViewBox: true,
        height: values[3]!,
        width: values[2]!,
      };
    }
  }

  return undefined;
};

const svgNumberAttribute = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));

const escapeSvgAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const absoluteSvgBaseUrl = (url: string, baseUrl?: string): string => {
  try {
    const base = globalThis.document?.baseURI ?? globalThis.location?.href;
    return new URL(url, baseUrl ?? base).href;
  } catch {
    return url;
  }
};

const svgRootBaseUrl = (attributes: string, documentBaseUrl: string): string => {
  const authoredBase = svgXmlBasePattern.exec(attributes)?.[2];
  return authoredBase === undefined
    ? documentBaseUrl
    : absoluteSvgBaseUrl(authoredBase, documentBaseUrl);
};

const svgRootBaseUrlForText = (svgText: string, documentBaseUrl: string): string => {
  const svgRoot = svgRootPattern.exec(svgText);
  return svgRoot === null ? documentBaseUrl : svgRootBaseUrl(svgRoot[1] ?? "", documentBaseUrl);
};

const shouldInlineSvgImageReference = (href: string): boolean =>
  href.trim() !== ""
  && !href.startsWith("#")
  && !/^(?:about|blob|data|javascript|mailto):/iu.test(href);

const responseContentMimeType = (response: Response): string | undefined => {
  const header = (response as { readonly headers?: Headers }).headers?.get("content-type");
  const mediaType = header?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "" ? undefined : mediaType;
};

const imageMimeTypeForUrl = (url: string, response: Response): string => {
  const contentType = responseContentMimeType(response);
  if (contentType !== undefined) return contentType;
  if (/\.svg(?:$|[?#])/iu.test(url)) return "image/svg+xml";
  if (/\.avif(?:$|[?#])/iu.test(url)) return "image/avif";
  if (/\.webp(?:$|[?#])/iu.test(url)) return "image/webp";
  if (/\.jpe?g(?:$|[?#])/iu.test(url)) return "image/jpeg";
  if (/\.png(?:$|[?#])/iu.test(url)) return "image/png";
  if (/\.gif(?:$|[?#])/iu.test(url)) return "image/gif";
  return "application/octet-stream";
};

const base64Bytes = (bytes: Uint8Array): string => {
  const encode = globalThis.btoa;
  if (typeof encode !== "function") throw new Error("Base64 encoding is unavailable for SVG image reference");

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return encode(binary);
};

const bytesDataUri = (bytes: Uint8Array, mimeType: string): string =>
  `data:${mimeType};base64,${base64Bytes(bytes)}`;

const setSvgAttribute = (attributes: string, name: string, value: string): string => {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["']).*?\\1`, "iu");
  const attribute = `${name}="${escapeSvgAttribute(value)}"`;
  if (pattern.test(attributes)) return attributes.replace(pattern, attribute);

  return `${attributes} ${attribute}`;
};

const svgTextWithFiniteImageDimensions = (
  svgText: string,
  label: string,
  baseUrl?: string,
  { requireViewport = true }: { readonly requireViewport?: boolean } = {},
): string => {
  const viewport = svgTextureViewport(svgText);
  if (viewport === undefined) {
    if (!requireViewport && baseUrl === undefined) return svgText;
    if (!requireViewport && baseUrl !== undefined) {
      const svgRoot = svgRootPattern.exec(svgText);
      if (svgRoot === null) return svgText;
      const attributes = setSvgAttribute(svgRoot[1] ?? "", "xml:base", svgRootBaseUrl(svgRoot[1] ?? "", baseUrl));
      return `${svgText.slice(0, svgRoot.index)}<svg${attributes}>${svgText.slice(svgRoot.index + svgRoot[0].length)}`;
    }
    throw new Error(`${label} requires a finite viewBox or finite width and height`);
  }
  if (!viewport.fromViewBox && baseUrl === undefined) return svgText;

  const svgRoot = svgRootPattern.exec(svgText);
  if (svgRoot === null) return svgText;

  let attributes = svgRoot[1] ?? "";
  if (viewport.fromViewBox) {
    attributes = setSvgAttribute(attributes, "width", svgNumberAttribute(viewport.width));
    attributes = setSvgAttribute(attributes, "height", svgNumberAttribute(viewport.height));
  }
  if (baseUrl !== undefined) attributes = setSvgAttribute(attributes, "xml:base", svgRootBaseUrl(attributes, baseUrl));

  return `${svgText.slice(0, svgRoot.index)}<svg${attributes}>${svgText.slice(svgRoot.index + svgRoot[0].length)}`;
};

const fetchSvgImageReferenceValue = (
  href: string,
  baseUrl: string,
  label: string,
  context: SvgImageReferenceContext,
): Promise<SvgImageReferenceValue> => {
  if (context.depth >= svgExternalReferenceMaxDepth) {
    return Promise.reject(new Error(`${label} exceeds nested SVG image reference depth ${svgExternalReferenceMaxDepth}`));
  }

  const url = absoluteSvgBaseUrl(href, baseUrl);
  const cached = context.cache.get(url);
  if (cached !== undefined) return cached;

  const request = (async (): Promise<SvgImageReferenceValue> => {
    if (context.active.has(url)) throw new Error(`${label} contains a cyclic SVG image reference to ${url}`);
    context.active.add(url);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const responseUrl = absoluteSvgBaseUrl(response.url || url, baseUrl);
      const mimeType = imageMimeTypeForUrl(responseUrl, response);
      if (mimeType === "image/svg+xml") {
        const preparedText = await prepareSvgTextForImage(
          await response.text(),
          `SVG image reference ${responseUrl}`,
          responseUrl,
          {
            context: {
              active: context.active,
              cache: context.cache,
              depth: context.depth + 1,
            },
            requireViewport: false,
          },
        );

        return {
          kind: "data-uri",
          value: bytesDataUri(svgTextEncoder.encode(preparedText), "image/svg+xml"),
        };
      }

      return {
        kind: "data-uri",
        value: bytesDataUri(new Uint8Array(await response.arrayBuffer()), mimeType),
      };
    } finally {
      context.active.delete(url);
    }
  })();
  context.cache.set(url, request);
  return request;
};

const svgHrefValueForImageTag = (
  imageTag: string,
  resolved: ReadonlyMap<string, SvgImageReferenceValue>,
): SvgImageReferenceValue | undefined => {
  for (const hrefMatch of imageTag.matchAll(svgHrefAttributePattern)) {
    const value = resolved.get(hrefMatch[3] ?? "");
    if (value !== undefined) return value;
  }
  return undefined;
};

const inlineSvgImageReferences = async (
  svgText: string,
  label: string,
  baseUrl: string,
  context: SvgImageReferenceContext,
): Promise<string> => {
  const rootBaseUrl = svgRootBaseUrlForText(svgText, baseUrl);
  const replacements = new Map<string, Promise<SvgImageReferenceValue>>();

  for (const imageMatch of svgText.matchAll(svgImageElementPattern)) {
    const imageTag = imageMatch[0];
    for (const hrefMatch of imageTag.matchAll(svgHrefAttributePattern)) {
      const href = hrefMatch[3] ?? "";
      if (!shouldInlineSvgImageReference(href)) continue;
      replacements.set(href, fetchSvgImageReferenceValue(href, rootBaseUrl, label, context));
    }
  }

  if (replacements.size === 0) return svgText;

  const resolved = new Map<string, SvgImageReferenceValue>();
  await Promise.all([...replacements].map(async ([href, value]) => {
    resolved.set(href, await value);
  }));

  return svgText.replace(svgImageElementPattern, (imageTag) => {
    const value = svgHrefValueForImageTag(imageTag, resolved);
    if (value === undefined) return imageTag;

    return imageTag.replace(svgHrefAttributePattern, (attribute, name: string, quote: string, href: string) => {
      const replacement = resolved.get(href);
      return replacement === undefined ? attribute : `${name}=${quote}${replacement.value}${quote}`;
    });
  });
};

const prepareSvgTextForImage = async (
  svgText: string,
  label: string,
  baseUrl: string | undefined,
  {
    context = { active: new Set<string>(), cache: new Map<string, Promise<SvgImageReferenceValue>>(), depth: 0 },
    requireViewport = true,
  }: {
    readonly context?: SvgImageReferenceContext;
    readonly requireViewport?: boolean;
  } = {},
): Promise<string> => {
  const normalizedText = svgTextWithFiniteImageDimensions(svgText, label, baseUrl, { requireViewport });
  return baseUrl === undefined
    ? normalizedText
    : inlineSvgImageReferences(normalizedText, label, baseUrl, context);
};

const attachSvgVirtualTextureSource = (
  image: HTMLImageElement,
  source: SvgVirtualTextureSource,
): HTMLImageElement => {
  (image as SvgVirtualTextureSourceCarrier)[svgVirtualTextureSourceSymbol] = source;
  return image;
};

const svgVirtualTextureSourceForImage = (
  image: LoadedTextureSource,
): SvgVirtualTextureSource | undefined =>
  typeof image === "object" && image !== null
    ? (image as SvgVirtualTextureSourceCarrier)[svgVirtualTextureSourceSymbol]
    : undefined;

type LoadedSvgTextImage = {
  readonly image: HTMLImageElement;
  readonly text: string;
};

const loadSvgTextImage = async (svgText: string, label: string, baseUrl?: string): Promise<LoadedSvgTextImage> => {
  const normalizedText = await prepareSvgTextForImage(svgText, label, baseUrl);
  const viewport = svgTextureViewport(normalizedText);
  const image = await loadImageFromBlob(new Blob([normalizedText], { type: "image/svg+xml" }), label);

  return {
    image: viewport === undefined
      ? image
      : attachSvgVirtualTextureSource(image, {
      height: viewport.height,
      label,
      text: normalizedText,
      width: viewport.width,
    }),
    text: normalizedText,
  };
};

const generatedVirtualTextureManifestUri = (key: string): string =>
  `${GENERATED_VIRTUAL_TEXTURE_MANIFEST_URI_PREFIX}${encodeURIComponent(key)}`;

const virtualTextureNow = (): number =>
  typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();

const AUTO_VIRTUAL_TEXTURE_GENERATED_FALLBACK_TRIGGERS: ReadonlySet<VirtualTextureFallbackTrigger> = new Set([
  "fetch-failed",
  "late-generated-source",
  "manifest-unsupported",
  "parse-failed",
  "runtime-unsupported",
]);

// Today authored sidecars are preferred when usable; generated VT remains attached
// as a candidate so later resolution policy can choose or promote it centrally.
const autoVirtualTexturePlan = ({
  generatedPageSource,
  sidecarManifestUri,
  textureKey,
}: AutoVirtualTexturePlanInput): AutoVirtualTexturePlan | undefined => {
  const generatedSource = generatedPageSource === undefined
    ? undefined
    : {
      kind: "generated" as const,
      manifestUri: generatedVirtualTextureManifestUri(textureKey),
      pageSource: generatedPageSource,
    };
  if (sidecarManifestUri !== undefined) {
    return {
      ...(generatedSource === undefined ? {} : { fallback: generatedSource }),
      fallbackTriggers: AUTO_VIRTUAL_TEXTURE_GENERATED_FALLBACK_TRIGGERS,
      primary: {
        kind: "sidecar",
        manifestUri: sidecarManifestUri,
      },
    };
  }
  if (generatedSource === undefined) return undefined;

  return {
    fallbackTriggers: AUTO_VIRTUAL_TEXTURE_GENERATED_FALLBACK_TRIGGERS,
    primary: generatedSource,
  };
};

const generatedVirtualTexturePageCount = (
  width: number,
  height: number,
  pageSize: number,
): number => {
  let pages = 0;
  let mipWidth = Math.ceil(width / pageSize);
  let mipHeight = Math.ceil(height / pageSize);
  while (true) {
    pages += Math.max(1, mipWidth) * Math.max(1, mipHeight);
    if (mipWidth <= 1 && mipHeight <= 1) return pages;
    mipWidth = Math.ceil(mipWidth / 2);
    mipHeight = Math.ceil(mipHeight / 2);
  }
};

const generatedSvgVirtualTextureManifest = (
  source: SvgVirtualTextureSource,
): VirtualTextureManifestModel => {
  const width = Math.max(1, Math.ceil(source.width));
  const height = Math.max(1, Math.ceil(source.height));
  const pageSize = Math.min(GENERATED_SVG_VIRTUAL_TEXTURE_PAGE_SIZE, Math.max(width, height));
  const physicalSlots = Math.min(
    GENERATED_SVG_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP,
    generatedVirtualTexturePageCount(width, height, pageSize),
  );

  return {
    colorSpace: "srgb",
    height,
    pageSize,
    pages: [],
    physicalSlots,
    width,
  };
};

const generatedSvgVirtualTexturePageText = (
  source: SvgVirtualTextureSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): string => {
  const mipScale = 2 ** page.mip;
  const sourceX = page.x * manifest.pageSize * mipScale;
  const sourceY = page.y * manifest.pageSize * mipScale;
  const sourceWidth = Math.max(1, Math.min(manifest.pageSize * mipScale, manifest.width - sourceX));
  const sourceHeight = Math.max(1, Math.min(manifest.pageSize * mipScale, manifest.height - sourceY));
  const href = bytesDataUri(svgTextEncoder.encode(source.text), "image/svg+xml");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.pageSize}" height="${manifest.pageSize}"`,
    ` viewBox="${svgNumberAttribute(sourceX)} ${svgNumberAttribute(sourceY)} ${svgNumberAttribute(sourceWidth)} ${svgNumberAttribute(sourceHeight)}"`,
    " preserveAspectRatio=\"none\">",
    `<image href="${escapeSvgAttribute(href)}" x="0" y="0" width="${svgNumberAttribute(source.width)}"`,
    ` height="${svgNumberAttribute(source.height)}" preserveAspectRatio="none"/>`,
    "</svg>",
  ].join("");
};

const loadGeneratedSvgVirtualTexturePageImage = (
  source: SvgVirtualTextureSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): Promise<HTMLImageElement> =>
  loadImageFromBlob(
    new Blob([generatedSvgVirtualTexturePageText(source, manifest, page)], { type: "image/svg+xml" }),
    `generated SVG virtual texture page ${source.label} ${virtualTexturePageKey(page)}`,
  );

const generatedRasterVirtualTextureManifest = (
  source: RasterVirtualTextureSource,
): VirtualTextureManifestModel => {
  const width = Math.max(1, Math.ceil(source.width));
  const height = Math.max(1, Math.ceil(source.height));
  const pageSize = Math.min(GENERATED_RASTER_VIRTUAL_TEXTURE_PAGE_SIZE, Math.max(width, height));
  const physicalSlots = Math.min(
    GENERATED_RASTER_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP,
    generatedVirtualTexturePageCount(width, height, pageSize),
  );

  return {
    ...(source.colorSpace === undefined ? {} : { colorSpace: source.colorSpace }),
    height,
    pageSize,
    pages: [],
    physicalSlots,
    width,
  };
};

const createVirtualTextureCanvas = (
  width: number,
  height: number,
  label: string,
): HTMLCanvasElement | OffscreenCanvas => {
  const document = globalThis.document;
  if (typeof document?.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  if (typeof globalThis.OffscreenCanvas === "function") {
    return new globalThis.OffscreenCanvas(width, height);
  }

  throw new Error(`Canvas 2D rendering is unavailable for ${label}`);
};

const virtualTextureCanvasContext = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  label: string,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D => {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error(`Canvas 2D rendering is unavailable for ${label}`);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
};

const rasterVirtualTextureCanvasSource = (
  source: RasterVirtualTextureSource,
): CanvasImageSource => {
  if (source.canvasSource !== undefined) return source.canvasSource;
  if (!isDecodedRgbaTexture(source.source)) {
    source.canvasSource = source.source;
    return source.canvasSource;
  }

  const canvas = createVirtualTextureCanvas(source.width, source.height, source.label);
  const context = virtualTextureCanvasContext(canvas, source.label);
  if (typeof globalThis.ImageData !== "function") {
    throw new Error(`ImageData is unavailable for ${source.label}`);
  }
  const imageData = new globalThis.ImageData(
    new Uint8ClampedArray(source.source.data),
    source.source.width,
    source.source.height,
  );
  context.putImageData(imageData, 0, 0);
  source.canvasSource = canvas;
  return source.canvasSource;
};

const generatedRasterVirtualTexturePageImage = (
  source: RasterVirtualTextureSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): TexImageSource => {
  const mipScale = 2 ** page.mip;
  const sourceX = page.x * manifest.pageSize * mipScale;
  const sourceY = page.y * manifest.pageSize * mipScale;
  const sourceWidth = Math.max(1, Math.min(manifest.pageSize * mipScale, manifest.width - sourceX));
  const sourceHeight = Math.max(1, Math.min(manifest.pageSize * mipScale, manifest.height - sourceY));
  const canvas = createVirtualTextureCanvas(
    manifest.pageSize,
    manifest.pageSize,
    `generated raster virtual texture page ${source.label} ${virtualTexturePageKey(page)}`,
  );
  const context = virtualTextureCanvasContext(canvas, source.label);
  context.clearRect(0, 0, manifest.pageSize, manifest.pageSize);
  context.drawImage(
    rasterVirtualTextureCanvasSource(source),
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    manifest.pageSize,
    manifest.pageSize,
  );
  return canvas;
};

const loadSvgUriImageSource = async (url: string): Promise<LoadedGltfImageSource> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const label = `glTF GS_texture_svg image ${url}`;
  const loadedImage = await loadSvgTextImage(
    await response.text(),
    label,
    absoluteSvgBaseUrl(response.url || url),
  );
  return loadedGltfImageSource(
    loadedImage.image,
    svgTextContentKey(loadedImage.text),
  );
};

const loadSvgImageSource = async (
  src: string,
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  image: GltfImage,
): Promise<LoadedGltfImageSource> => {
  if (image.uri !== undefined) {
    if (image.uri.startsWith("data:")) {
      const bytes = decodeDataUri(image.uri);
      const loadedImage = await loadSvgTextImage(
        svgTextDecoder.decode(bytes),
        `glTF GS_texture_svg data URI ${image.uri.slice(0, 48)}`,
        absoluteSvgBaseUrl(src),
      );
      return loadedGltfImageSource(
        loadedImage.image,
        svgTextContentKey(loadedImage.text),
      );
    }

    return loadSvgUriImageSource(resolveResourceUri(src, image.uri));
  }
  if (image.bufferView === undefined) {
    throw new Error("glTF GS_texture_svg image has no URI or bufferView");
  }
  const bytes = gltfBufferViewBytes(document, buffers, image.bufferView);
  const loadedImage = await loadSvgTextImage(
    svgTextDecoder.decode(bytes),
    `glTF GS_texture_svg bufferView ${image.bufferView}`,
    absoluteSvgBaseUrl(src),
  );

  return loadedGltfImageSource(
    loadedImage.image,
    svgTextContentKey(loadedImage.text),
  );
};

const loadBasisuBytesFromUri = async (
  src: string,
  image: GltfImage,
): Promise<ArrayBuffer> => {
  if (image.uri === undefined) throw new Error("glTF KHR_texture_basisu image has no URI");
  if (image.uri.startsWith("data:")) return decodeDataUri(image.uri);

  const url = resolveResourceUri(src, image.uri);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  return response.arrayBuffer();
};

const loadGltfImageSource = (
  src: string,
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  image: GltfImage,
  kind: GltfImageKind,
): Promise<LoadedGltfImageSource> => {
  if (kind === "svg") {
    return loadSvgImageSource(src, document, buffers, image);
  }

  if (kind === "basisu") {
    const bytes = image.uri === undefined
      ? image.bufferView === undefined
        ? Promise.reject(new Error("glTF KHR_texture_basisu image has no URI or bufferView"))
        : Promise.resolve(gltfBufferViewBytes(document, buffers, image.bufferView))
      : loadBasisuBytesFromUri(src, image);

    return bytes.then(async (buffer) => loadedGltfImageSource(
      await decodeGltfBasisuRgba(buffer, image.uri ?? `bufferView ${image.bufferView ?? ""}`),
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
      return loadImageBitmapFromBytes(bytes, image.mimeType)
        .then((loadedImage) => loadedGltfImageSource(loadedImage, contentKey));
    }

    return loadImage(resolveResourceUri(src, image.uri)).then((loadedImage) => ({ image: loadedImage }));
  }
  if (image.bufferView === undefined) return Promise.reject(new Error("glTF image has no URI or bufferView"));

  const bytes = gltfBufferViewBytes(document, buffers, image.bufferView);
  const contentKey = byteContentKey(bytes, image.mimeType ?? "application/octet-stream");
  return loadImageBitmapFromBytes(bytes, image.mimeType)
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

const webGlDrawMode = (gl: WebGL2RenderingContext, mode: GeometryDrawMode): number => {
  switch (mode) {
    case "line-loop":
      return gl.LINE_LOOP;
    case "line-strip":
      return gl.LINE_STRIP;
    case "lines":
      return gl.LINES;
    case "points":
      return gl.POINTS;
    case "triangle-fan":
      return gl.TRIANGLE_FAN;
    case "triangle-strip":
      return gl.TRIANGLE_STRIP;
    case "triangles":
      return gl.TRIANGLES;
  }
};

const isPickableDrawMode = (mode: GeometryDrawMode | undefined): boolean =>
  mode === undefined
  || mode === "triangles"
  || mode === "triangle-strip"
  || mode === "triangle-fan";

const gltfBaseColorTextureInfo = (
  document: GltfDocument,
  materialIndex: number | undefined,
) => materialIndex === undefined
  ? undefined
  : document.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorTexture;

const gltfMetallicRoughnessTextureInfo = (
  document: GltfDocument,
  materialIndex: number | undefined,
) => materialIndex === undefined
  ? undefined
  : document.materials?.[materialIndex]?.pbrMetallicRoughness?.metallicRoughnessTexture;

const gltfEmissiveTextureInfo = (
  document: GltfDocument,
  materialIndex: number | undefined,
) => materialIndex === undefined
  ? undefined
  : document.materials?.[materialIndex]?.emissiveTexture;

const gltfOcclusionTextureInfo = (
  document: GltfDocument,
  materialIndex: number | undefined,
) => materialIndex === undefined
  ? undefined
  : document.materials?.[materialIndex]?.occlusionTexture;

const gltfMaterialPrimaryTextureInfo = (
  document: GltfDocument,
  materialIndex: number | undefined,
): GltfTextureInfo | undefined =>
  gltfBaseColorTextureInfo(document, materialIndex)
    ?? gltfMetallicRoughnessTextureInfo(document, materialIndex)
    ?? gltfEmissiveTextureInfo(document, materialIndex)
    ?? gltfOcclusionTextureInfo(document, materialIndex);

const transformGltfTexCoords = (
  texCoords: Float32Array,
  transform: GltfTextureTransformExtension | undefined,
): Float32Array => {
  if (transform === undefined) return texCoords;
  const offsetX = transform.offset?.[0] ?? 0;
  const offsetY = transform.offset?.[1] ?? 0;
  const scaleX = transform.scale?.[0] ?? 1;
  const scaleY = transform.scale?.[1] ?? 1;
  const rotation = transform.rotation ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const output = new Float32Array(texCoords.length);

  for (let index = 0; index + 1 < texCoords.length; index += 2) {
    const u = texCoords[index]! * scaleX;
    const v = texCoords[index + 1]! * scaleY;
    output[index] = offsetX + cos * u - sin * v;
    output[index + 1] = offsetY + sin * u + cos * v;
  }

  return output;
};

const gltfTextureInfoTexCoords = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  primitive: GltfMeshPrimitive,
  textureInfo: GltfTextureInfo | undefined,
  decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
): Float32Array | undefined => {
  if (textureInfo?.index === undefined) return undefined;
  const texCoordSet = textureInfo.extensions?.KHR_texture_transform?.texCoord
    ?? textureInfo.texCoord
    ?? 0;
  const decodedTexCoords = decodedAttributes?.get(`TEXCOORD_${texCoordSet}`);
  if (decodedTexCoords !== undefined) {
    return transformGltfTexCoords(decodedTexCoords, textureInfo.extensions?.KHR_texture_transform);
  }

  const texCoordAccessor = primitive.attributes?.[`TEXCOORD_${texCoordSet}`];
  if (texCoordAccessor === undefined) return undefined;
  return transformGltfTexCoords(
    readGltfFloatAccessor(document, buffers, texCoordAccessor),
    textureInfo.extensions?.KHR_texture_transform,
  );
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

const selectedLodLevel = (
  coverage: number,
  levelCount: number,
  thresholds: readonly number[],
): number | undefined => {
  for (let level = 0; level < levelCount; level += 1) {
    if (coverage >= (thresholds[level] ?? fallbackLodThreshold(level, levelCount))) return level;
  }

  return undefined;
};

const hystereticLodLevel = (
  coverage: number,
  levelCount: number,
  thresholds: readonly number[],
  previousLevel: number | undefined,
): number => {
  const stateless = selectedLodLevel(coverage, levelCount, thresholds) ?? levelCount - 1;
  if (
    previousLevel === undefined
    || previousLevel < 0
    || previousLevel >= levelCount
  ) {
    return stateless;
  }

  let level = previousLevel;
  while (level > 0) {
    const threshold = thresholds[level - 1] ?? fallbackLodThreshold(level - 1, levelCount);
    if (coverage < Math.min(1, threshold * (1 + GLTF_LOD_HYSTERESIS_RATIO))) break;
    level -= 1;
  }
  while (level < levelCount - 1) {
    const threshold = thresholds[level] ?? fallbackLodThreshold(level, levelCount);
    if (coverage >= threshold * (1 - GLTF_LOD_HYSTERESIS_RATIO)) break;
    level += 1;
  }

  return level;
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

const isBoundsVisible = (
  bounds: Bounds3 | undefined,
  viewProjectionModel: Mat4,
): boolean => {
  if (bounds === undefined) return false;

  const outside = [true, true, true, true, true, true];
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
        const clipZ = viewProjectionModel[2] * x + viewProjectionModel[6] * y + viewProjectionModel[10] * z
          + viewProjectionModel[14];
        const clipW = viewProjectionModel[3] * x + viewProjectionModel[7] * y + viewProjectionModel[11] * z
          + viewProjectionModel[15];
        outside[0] &&= clipX < -clipW;
        outside[1] &&= clipX > clipW;
        outside[2] &&= clipY < -clipW;
        outside[3] &&= clipY > clipW;
        outside[4] &&= clipZ < -clipW;
        outside[5] &&= clipZ > clipW;
      }
    }
  }

  return !outside.some(Boolean);
};

/**
 * Minimal Royal WebGL2 renderer root. It implements the descriptor subset used
 * by the contracts while keeping all GPU ownership inside this root.
 */
class WebGlRootImpl implements WebGlRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #options: NormalizedWebGlRootOptions;
  readonly #programs = new Map<string, ProgramResource>();
  readonly #programAttributeLocations = new Map<WebGLProgram, Map<string, number>>();
  readonly #programUniformLocations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  readonly #programUniformValues = new Map<WebGLProgram, Map<string, UniformValue>>();
  readonly #geometry = new Map<string, GeometryResource>();
  readonly #textures = new Map<string, TextureResource | TextureLoadState>();
  readonly #iblSpecularTextures = new Map<string, IblSpecularTextureResource>();
  readonly #studioEnvironmentSpecularTextures = new Map<string, StudioEnvironmentSpecularResource>();
  readonly #virtualTextures = new Map<string, VirtualTextureRuntimeState>();
  readonly #pendingTextureUploads: TextureResource[] = [];
  readonly #autoVirtualTextureRefs = new Map<string, VirtualTextureRef>();
  readonly #autoVirtualTextureManifestUris = new Map<string, string>();
  readonly #autoVirtualTextureGeneratedPageSources = new Map<string, VirtualTextureGeneratedPageSource>();
  readonly #gltf = new Map<string, GltfState>();
  readonly #gltfBatchPlanCache = new Map<string, GltfPrimitiveDrawBatchPlanCacheEntry>();
  readonly #gltfInstanceBuffers = new Map<string, GltfInstanceBufferResource>();
  readonly #gltfLodSelections = new Map<string, GltfLodSelectionState>();
  readonly #gltfPreparedPrimitiveMaterials =
    new WeakMap<LoadedGltfPrimitive, WeakMap<LoadedGltfMaterial, GltfPreparedPrimitiveMaterial>>();
  readonly #ownedBuffers = new Set<WebGLBuffer>();
  readonly #ownedPrograms = new Set<WebGLProgram>();
  readonly #ownedShaders = new Set<WebGLShader>();
  readonly #ownedTextures = new Set<WebGLTexture>();
  readonly #ownedVertexArrays = new Set<WebGLVertexArrayObject>();
  readonly #renderObjectBindings = new Map<RenderObjectRef, RenderObjectBinding>();
  readonly #renderObjectHandles = new WeakMap<TransformableRenderNode, RenderObjectHandle>();
  readonly #unsupportedGltfAnimationDiagnostics = new Set<string>();
  readonly #unsupportedGltfImageBasedLightDiagnostics = new Set<string>();
  readonly #unsupportedGltfMaterialExtensionDiagnostics = new Set<string>();
  readonly #unsupportedVirtualTextureDiagnostics = new Set<string>();
  #activeGltfBatchPlanCacheKeys = new Set<string>();
  #activeGltfInstanceBufferKeys = new Set<string>();
  #activeGltfLodSelectionKeys = new Set<string>();
  #dprMediaQuery: MediaQueryList | undefined;
  #diagnostics: string[] = [];
  #disposed = false;
  #frame = 0;
  #gltfRenderOrdinal = 0;
  #gltfStateInstanceKey = 1;
  #activeProgram: WebGLProgram | undefined;
  #iblBrdfLutTexture: WebGLTexture | undefined;
  #gltfInstancingCounters = createWebGlGltfInstancingCounters();
  #latestScene: RenderRoot | undefined;
  #maxTextureImageUnits = 0;
  #renderObjectInvalidationPending = false;
  #renderScheduled = false;
  #resizeObserver: ResizeObserver | undefined;
  #transmissionScreenColorTexture: ScreenColorTextureResource | undefined;
  #vertexAttribDefaults = new Map<number, VertexAttribDefaultValue>();
  #textureUploadFrame = -1;
  #textureUploadHead = 0;
  #textureUploadsThisFrame = 0;
  #virtualTextureRequestFrame = -1;
  #virtualTextureRequestsThisFrame = 0;
  #virtualTextureUploadFrame = -1;
  #virtualTextureUploadsThisFrame = 0;
  #unsupportedVirtualTextureDraws = 0;
  readonly #viewportInvalidationListener = (): void => {
    this.invalidate();
  };

  constructor(canvas: HTMLCanvasElement, options?: WebGlRootOptions) {
    this.#canvas = canvas;
    this.#options = normalizeOptions(options);
    const gl = canvas.getContext("webgl2", this.#options) as WebGL2RenderingContext | null;
    if (gl === null) {
      throw new Error("Royal WebGL renderer requires a WebGL2 context");
    }
    this.#gl = gl;
    const maxTextureImageUnits = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    this.#maxTextureImageUnits = Number.isFinite(maxTextureImageUnits) ? maxTextureImageUnits : 0;
    this.#watchViewport();
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

  get options(): NormalizedWebGlRootOptions {
    return this.#options;
  }

  render(scene: RenderRoot): void {
    if (this.#disposed) {
      throw new Error("Cannot render with a disposed Royal renderer root");
    }

    const { height, width } = this.#resize();
    this.#renderScene(scene, {
      framebuffer: null,
      scissor: false,
      syncRenderObjectRefs: true,
      views: [{
        projection: (renderPass) => projectionMat4(renderPass.camera, width, height),
        view: (renderPass) => viewMat4(renderPass.camera),
        viewport: { height, width, x: 0, y: 0 },
      }],
    });
  }

  renderViews(scene: RenderRoot, options: WebGlRenderViewsOptions): void {
    if (this.#disposed) {
      throw new Error("Cannot render views with a disposed Royal renderer root");
    }

    this.#renderScene(scene, {
      framebuffer: options.framebuffer ?? null,
      scissor: true,
      syncRenderObjectRefs: true,
      views: options.views.map((view) => ({
        projection: () => mat4FromArrayLike(view.projectionMatrix),
        view: () => mat4FromArrayLike(view.viewMatrix),
        viewport: view.viewport,
      })),
    });
  }

  #renderScene(
    scene: RenderRoot,
    options: {
      readonly framebuffer: WebGLFramebuffer | null;
      readonly scissor: boolean;
      readonly syncRenderObjectRefs: boolean;
      readonly views: readonly SceneRenderView[];
    },
  ): void {
    if (options.views.length === 0) return;

    this.#latestScene = scene;
    this.#renderObjectInvalidationPending = false;
    if (options.syncRenderObjectRefs) this.#syncRenderObjectRefs(scene);
    this.#activeGltfBatchPlanCacheKeys = new Set();
    this.#activeGltfInstanceBufferKeys = new Set();
    this.#activeGltfLodSelectionKeys = new Set();
    this.#gltfRenderOrdinal = 0;
    const gl = this.#gl;
    gl.bindFramebuffer?.(gl.FRAMEBUFFER, options.framebuffer);
    gl.clearDepth?.(1);
    gl.enable?.(gl.DEPTH_TEST);
    gl.depthFunc?.(gl.LEQUAL);
    gl.disable?.(gl.BLEND);
    if (options.scissor) gl.enable?.(gl.SCISSOR_TEST);
    this.#processTextureUploads();
    this.#processVirtualTexturePageUploads();

    const usedGeometry = new Set<string>();
    try {
      for (const renderPass of scene.children) {
        if (renderPass.depthTest) {
          gl.enable?.(gl.DEPTH_TEST);
        } else {
          gl.disable?.(gl.DEPTH_TEST);
        }

        for (const renderView of options.views) {
          const { height, width, x, y } = renderView.viewport;
          gl.viewport(x, y, width, height);
          if (options.scissor) gl.scissor?.(x, y, width, height);
          const clearMask =
            renderPass.clear === "none"
              ? 0
              : renderPass.clear === "color"
                ? gl.COLOR_BUFFER_BIT
                : renderPass.clear === "depth"
                  ? gl.DEPTH_BUFFER_BIT
                  : gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;

          if (clearMask !== 0) {
            if (renderPass.clear === "color" || renderPass.clear === "color-depth") {
              const [r, g, b, a] = renderPass.clearColor;
              gl.clearColor(r, g, b, a);
            }
            gl.clear(clearMask);
          }

          const projection = renderView.projection(renderPass);
          const view = renderView.view(renderPass);
          const lights = this.#directionalLights(renderPass.children);
          const passLights = this.#passSurfaceLightSet(lights[0], renderPass.environment);
          const toneMapping = passToneMappingState(renderPass);
          const viewportSize: ViewportSize = [width, height];
          const gltfDraws: GltfPrimitiveDraw[] = [];
          const flushGltfDraws = (): void => {
            if (gltfDraws.length === 0) return;
            this.#drawGltfPrimitiveDraws(gltfDraws, projection, view, passLights, toneMapping, viewportSize, usedGeometry);
            gltfDraws.length = 0;
          };

          for (const child of renderPass.children) {
            if (child.kind === "directional-light") continue;
            if (child.kind === "gltf") {
              this.#appendGltfPrimitiveDraws(child, projection, view, gltfDraws);
              continue;
            }
            flushGltfDraws();
            this.#drawNode(child, projection, view, passLights, toneMapping, viewportSize, usedGeometry);
          }
          flushGltfDraws();
        }
      }
    } finally {
      if (options.scissor) gl.disable?.(gl.SCISSOR_TEST);
      gl.bindFramebuffer?.(gl.FRAMEBUFFER, null);
    }

    this.#releaseUnusedGeometry(usedGeometry);
    this.#releaseUnusedGltfBatchPlans();
    this.#releaseUnusedGltfInstanceBuffers();
    this.#pruneGltfLodSelections();
    this.#frame += 1;
    if (this.#hasPendingTextureUploads() || this.#hasPendingVirtualTextureUploads()) this.invalidate();
  }

  invalidate(): void {
    this.#scheduleRender();
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
    const scene = this.#latestScene;
    if (scene === undefined) return undefined;

    const { height, width } = this.#resize();
    let best: PickCandidate | undefined;
    for (const [passOrdinal, renderPass] of scene.children.entries()) {
      const projection = projectionMat4(renderPass.camera, width, height);
      const view = viewMat4(renderPass.camera);
      const ray = this.#pickRay(input, projection, view);
      if (ray === undefined) continue;

      let drawOrdinal = 0;
      for (const child of renderPass.children) {
        const result = this.#pickNode(child, ray, projection, view, input, passOrdinal, drawOrdinal);
        drawOrdinal = result.nextDrawOrdinal;
        if (result.hit !== undefined && this.#isBetterPick(result.hit, best)) best = result.hit;
      }
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

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    const gl = this.#gl;
    for (const vertexArray of Array.from(this.#ownedVertexArrays)) this.#deleteVertexArray(vertexArray);
    for (const buffer of Array.from(this.#ownedBuffers)) this.#deleteBuffer(buffer);
    for (const texture of Array.from(this.#ownedTextures)) {
      gl.deleteTexture(texture);
      this.#ownedTextures.delete(texture);
    }
    for (const program of Array.from(this.#ownedPrograms)) this.#deleteProgram(program);
    for (const shader of Array.from(this.#ownedShaders)) {
      gl.deleteShader(shader);
      this.#ownedShaders.delete(shader);
    }

    this.#activeProgram = undefined;
    this.#vertexAttribDefaults.clear();
    this.#programs.clear();
    this.#geometry.clear();
    this.#textures.clear();
    this.#pendingTextureUploads.length = 0;
    this.#textureUploadHead = 0;
    this.#studioEnvironmentSpecularTextures.clear();
    this.#virtualTextures.clear();
    this.#autoVirtualTextureRefs.clear();
    this.#autoVirtualTextureManifestUris.clear();
    this.#autoVirtualTextureGeneratedPageSources.clear();
    this.#gltf.clear();
    this.#gltfBatchPlanCache.clear();
    this.#gltfInstanceBuffers.clear();
    this.#gltfLodSelections.clear();
    this.#iblBrdfLutTexture = undefined;
    this.#transmissionScreenColorTexture = undefined;
    this.#activeGltfInstanceBufferKeys.clear();
    this.#activeGltfLodSelectionKeys.clear();
    for (const [ref, binding] of this.#renderObjectBindings) {
      this.#renderObjectHandles.delete(binding.node);
      assignRenderObjectRef(ref, null);
    }
    this.#renderObjectBindings.clear();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    this.#dprMediaQuery?.removeEventListener?.("change", this.#viewportInvalidationListener);
    this.#dprMediaQuery?.removeListener?.(this.#viewportInvalidationListener);
    this.#dprMediaQuery = undefined;
  }

  snapshot(): WebGlRootSnapshot {
    return {
      diagnostics: [...this.#diagnostics],
      disposed: this.#disposed,
      frame: this.#frame,
      gltfLoadDiagnostics: this.#gltfLoadDiagnosticsSnapshot(),
      gltfInstancing: this.#gltfInstancingSnapshot(),
      latestScene: this.#latestScene,
      options: { ...this.#options },
      virtualTexturing: this.#virtualTexturingSnapshot(),
    };
  }

  #syncRenderObjectRefs(scene: RenderRoot): void {
    const activeRefs = new Set<RenderObjectRef>();

    for (const renderPass of scene.children) {
      for (const child of renderPass.children) {
        this.#syncRenderObjectNodeRefs(child, activeRefs);
      }
    }

    for (const [ref, binding] of Array.from(this.#renderObjectBindings)) {
      if (activeRefs.has(ref)) continue;

      this.#renderObjectHandles.delete(binding.node);
      this.#renderObjectBindings.delete(ref);
      assignRenderObjectRef(ref, null);
    }
  }

  #syncRenderObjectNodeRefs(node: RenderNode, activeRefs: Set<RenderObjectRef>): void {
    if (node.kind !== "mesh" && node.kind !== "gltf") return;
    if (node.ref === undefined) return;

    const ref = node.ref;
    activeRefs.add(ref);
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
        declarativeTransform,
        handle,
        invalidation,
        node,
      };
      this.#renderObjectBindings.set(ref, binding);
      assignRenderObjectRef(ref, binding.handle);
    } else {
      this.#renderObjectHandles.delete(binding.node);
      if (!sameTransform(binding.declarativeTransform, declarativeTransform)) {
        if (binding.invalidation !== undefined) binding.invalidation.suppress = true;
        try {
          binding.handle.setTransform(declarativeTransform);
        } finally {
          if (binding.invalidation !== undefined) binding.invalidation.suppress = false;
        }
        binding.declarativeTransform = declarativeTransform;
      }
      binding.node = node;
    }

    this.#renderObjectHandles.set(node, binding.handle);
  }

  #renderObjectTransform(node: TransformableRenderNode): Transform | undefined {
    const handle = this.#renderObjectHandles.get(node);
    return handle === undefined ? node.transform : readRenderObjectHandleTransform(handle);
  }

  #pickRay(input: PickInput, projection: Mat4, view: Mat4): Ray | undefined {
    const rect = this.#canvas.getBoundingClientRect?.();
    const width = rect?.width ?? this.#canvas.clientWidth;
    const height = rect?.height ?? this.#canvas.clientHeight;
    if (width <= 0 || height <= 0) return undefined;

    const ndcX = ((input.clientX - (rect?.left ?? 0)) / width) * 2 - 1;
    const ndcY = 1 - ((input.clientY - (rect?.top ?? 0)) / height) * 2;
    const inverse = inverseMat4(multiplyMat4(projection, view));
    if (inverse === undefined) return undefined;

    const near = transformVec4(inverse, [ndcX, ndcY, -1, 1]);
    const far = transformVec4(inverse, [ndcX, ndcY, 1, 1]);
    if (near[3] === 0 || far[3] === 0) return undefined;

    const origin: Vec3 = [near[0] / near[3], near[1] / near[3], near[2] / near[3]];
    const farPoint: Vec3 = [far[0] / far[3], far[1] / far[3], far[2] / far[3]];
    const direction = normalizeVec3([
      farPoint[0] - origin[0],
      farPoint[1] - origin[1],
      farPoint[2] - origin[2],
    ]);

    return { direction, origin };
  }

  #pickNode(
    node: RenderNode,
    ray: Ray,
    projection: Mat4,
    view: Mat4,
    input: PickInput,
    passOrdinal: number,
    drawOrdinal: number,
  ): { readonly hit: PickCandidate | undefined; readonly nextDrawOrdinal: number } {
    switch (node.kind) {
      case "mesh": {
        const hit = this.#pickMesh(node, ray, projection, view, input, passOrdinal, drawOrdinal);
        const nextDrawOrdinal = drawOrdinal + 1;
        return { hit, nextDrawOrdinal };
      }
      case "gltf": {
        const hit = this.#pickGltf(node, ray, projection, view, input, passOrdinal, drawOrdinal);
        const nextDrawOrdinal = drawOrdinal + 1;
        return { hit, nextDrawOrdinal };
      }
      case "directional-light":
      case "text":
        return { hit: undefined, nextDrawOrdinal: drawOrdinal };
      default:
        return { hit: undefined, nextDrawOrdinal: drawOrdinal };
    }
  }

  #pickMesh(
    node: MeshNode,
    ray: Ray,
    projection: Mat4,
    view: Mat4,
    input: PickInput,
    passOrdinal: number,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    const cpu = this.#meshGeometry(node.geometry, node.material);
    const model = transformMat4(this.#renderObjectTransform(node));
    if (!this.#isVisible(cpu.positions, model, projection, view)) return undefined;

    return this.#pickGeometry({
      bounds: worldBounds(cpu.positions, model),
      drawOrdinal,
      geometry: cpu,
      input,
      model,
      passOrdinal,
      ray,
      target: {
        ...(node.pickingId === undefined ? {} : { id: node.pickingId }),
        kind: "mesh",
        node,
      },
    });
  }

  #gltfAnimationTransforms(
    state: GltfState,
    node: GltfNode,
  ): ReadonlyMap<number, GltfAnimatedNodeTransform> | undefined {
    if (node.animation === undefined) return undefined;

    const clip = selectGltfAnimationClip(state.animations, node.animation.clip);
    if (clip === undefined) {
      this.#recordUnsupportedGltfAnimation(
        `glTF ${state.key} ${gltfAnimationSelectionLabel(node.animation)} is unavailable; rendering static pose`,
      );
      return undefined;
    }

    return gltfAnimationNodeTransformsAt(clip, node.animation.timeSeconds);
  }

  #pickGltf(
    node: GltfNode,
    ray: Ray,
    projection: Mat4,
    view: Mat4,
    input: PickInput,
    passOrdinal: number,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    const rootModel = transformMat4(this.#renderObjectTransform(node));
    const state = this.#gltf.get(`gltf:${node.asset.uri}:${node.asset.version ?? ""}`);
    if (state?.status === "ready") {
      const animationTransforms = this.#gltfAnimationTransforms(state, node);
      let best: PickCandidate | undefined;
      for (const primitive of state.primitives) {
        if (!isPickableDrawMode(primitive.mode)) continue;
        const localModels = animationTransforms === undefined
          ? primitive.localModels
          : gltfPrimitiveAnimatedLocalModels(state.nodes, primitive, animationTransforms);
        for (const [instanceIndex, localModel] of localModels.entries()) {
          const model = multiplyMat4(rootModel, localModel);
          if (!this.#isVisible(primitive.positions, model, projection, view)) continue;
          const hit = this.#pickGeometry({
            bounds: worldBounds(primitive.positions, model),
            drawOrdinal,
            geometry: primitive,
            input,
            model,
            passOrdinal,
            ray,
            target: {
              ...(node.pickingId === undefined ? {} : { id: node.pickingId }),
              kind: "gltf",
              node,
              primitiveKey: localModels.length === 1
                ? primitive.key
                : `${primitive.key}:instance:${instanceIndex}`,
            },
          });
          if (hit !== undefined && this.#isBetterPick(hit, best)) best = hit;
        }
      }

      return best;
    }

    return undefined;
  }

  #pickGeometry({
    bounds,
    drawOrdinal,
    geometry,
    input,
    model,
    passOrdinal,
    ray,
    target,
  }: {
    readonly bounds: Bounds3 | undefined;
    readonly drawOrdinal: number;
    readonly geometry: {
      readonly indices?: Uint16Array | Uint32Array | Uint8Array;
      readonly mode?: GeometryDrawMode;
      readonly positions: Float32Array;
    };
    readonly input: PickInput;
    readonly model: Mat4;
    readonly passOrdinal: number;
    readonly ray: Ray;
    readonly target: PickTarget;
  }): PickCandidate | undefined {
    if (!isPickableDrawMode(geometry.mode)) return undefined;
    if (bounds === undefined) return undefined;
    if (rayAabbDistance(ray, bounds) === undefined) return undefined;
    const mode = geometry.mode as RayGeometryMode | undefined;
    const distance = rayGeometryDistance({
      ...(geometry.indices === undefined ? {} : { indices: geometry.indices }),
      ...(mode === undefined ? {} : { mode }),
      model,
      positions: geometry.positions,
      ray,
    });
    if (distance === undefined) return undefined;

    return {
      clientX: input.clientX,
      clientY: input.clientY,
      distance,
      drawOrdinal,
      passOrdinal,
      point: pointOnRay(ray, distance),
      target,
    };
  }

  #isBetterPick(candidate: PickCandidate, current: PickCandidate | undefined): boolean {
    if (current === undefined) return true;
    if (candidate.passOrdinal !== current.passOrdinal) return candidate.passOrdinal > current.passOrdinal;
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

    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia === "function") {
      this.#dprMediaQuery = matchMedia(`(resolution: ${globalThis.devicePixelRatio ?? 1}dppx)`);
      this.#dprMediaQuery.addEventListener?.("change", this.#viewportInvalidationListener);
      this.#dprMediaQuery.addListener?.(this.#viewportInvalidationListener);
    }
  }

  #drawNode(
    node: RenderNode,
    projection: Mat4,
    view: Mat4,
    passLights: SurfaceLightSet | undefined,
    toneMapping: PassToneMappingState,
    viewportSize: ViewportSize,
    usedGeometry: Set<string>,
  ): void {
    switch (node.kind) {
      case "directional-light":
        return;
      case "mesh":
        this.#drawMesh(node, projection, view, passLights, toneMapping, viewportSize, usedGeometry);
        return;
      case "text":
        this.#drawText(node, projection, view, toneMapping, viewportSize, usedGeometry);
        return;
      case "gltf":
        {
          const draws: GltfPrimitiveDraw[] = [];
          this.#appendGltfPrimitiveDraws(node, projection, view, draws);
          this.#drawGltfPrimitiveDraws(
            draws,
            projection,
            view,
            passLights,
            toneMapping,
            viewportSize,
            usedGeometry,
          );
        }
        return;
      default:
        this.#recordDiagnostic(`Unsupported render node kind "${getNodeKind(node)}"`);
    }
  }

  #directionalLights(nodes: readonly RenderNode[]): readonly DirectionalLightNode[] {
    const lights: DirectionalLightNode[] = [];
    for (const node of nodes) {
      if (node.kind === "directional-light") {
        lights.push(node);
      }
    }

    return lights;
  }

  #drawMesh(
    node: MeshNode,
    projection: Mat4,
    view: Mat4,
    lights: SurfaceLightSet | undefined,
    toneMapping: PassToneMappingState,
    viewportSize: ViewportSize,
    usedGeometry: Set<string>,
  ): void {
    const cpu = this.#meshGeometry(node.geometry, node.material);
    const model = transformMat4(this.#renderObjectTransform(node));
    if (!this.#isVisible(cpu.positions, model, projection, view)) return;
    if (node.material.kind === "standard" && lights === undefined) {
      throw new Error("standardMaterial meshes require a directionalLight or environment in the render pass");
    }
    const gpu = this.#geometryResource(cpu);
    usedGeometry.add(gpu.key);
    this.#applyDrawAlphaState(node.material);
    try {
      this.#drawGeometry(gpu, node.material, model, projection, view, viewportSize, lights, toneMapping, undefined, cpu);
    } finally {
      this.#resetDrawAlphaState();
    }
  }

  #drawText(
    node: TextNode,
    projection: Mat4,
    view: Mat4,
    toneMapping: PassToneMappingState,
    viewportSize: ViewportSize,
    usedGeometry: Set<string>,
  ): void {
    const mesh = textMesh(node);
    if (mesh.vertices.length === 0 || mesh.indices.length === 0) return;

    const positions = new Float32Array(mesh.vertices.length * 3);
    const texCoords = new Float32Array(mesh.vertices.length * 2);
    for (const [index, vertex] of mesh.vertices.entries()) {
      positions[index * 3] = vertex.position[0];
      positions[index * 3 + 1] = vertex.position[1];
      positions[index * 3 + 2] = vertex.position[2];
      texCoords[index * 2] = vertex.glyphCoord[0];
      texCoords[index * 2 + 1] = vertex.glyphCoord[1];
    }
    const indices = mesh.vertices.length > 65535
      ? new Uint32Array(mesh.indices)
      : new Uint16Array(mesh.indices);
    const cpu: CpuGeometry = {
      indices,
      key: `text:${node.layout.source}:${node.layout.font.metrics.size}:${mesh.vertices.length}:${mesh.indices.length}`,
      mode: "triangles",
      positions,
      texCoords,
    };
    const gpu = this.#geometryResource(cpu);
    const material: UnlitMaterial = {
      baseColor: { color: node.color, kind: "solid" },
      kind: "unlit",
    };
    usedGeometry.add(gpu.key);
    this.#applyDrawAlphaState(material);
    try {
      this.#drawGeometry(gpu, material, identityMat4(), projection, view, viewportSize, undefined, toneMapping, undefined, cpu);
    } finally {
      this.#resetDrawAlphaState();
    }
  }

  #appendGltfPrimitiveDraws(
    node: GltfNode,
    projection: Mat4,
    view: Mat4,
    draws: GltfPrimitiveDraw[],
  ): void {
    const renderInstanceOrdinal = this.#gltfRenderOrdinal;
    const renderInstanceKey = `instance:${renderInstanceOrdinal}`;
    this.#gltfRenderOrdinal += 1;
    const state = this.#gltfState(node);
    if (state.status !== "ready") return;

    const rootHandle = this.#renderObjectHandles.get(node);
    const rootTransform = rootHandle === undefined ? node.transform : readRenderObjectHandleTransform(rootHandle);
    const rootModel = transformMat4(rootTransform);
    const rootDeterminant = mat4OrientationDeterminant(rootModel);
    const rootViewProjectionModel = multiplyMat4(projection, multiplyMat4(view, rootModel));
    const assetLights = this.#gltfAssetLightSet(state, rootModel);
    const animationTransforms = this.#gltfAnimationTransforms(state, node);
    const selectedNodeLevels = state.hasNodeLod
      ? this.#selectedGltfNodeLodLevels(state, renderInstanceKey, rootViewProjectionModel)
      : undefined;
    const selectedVariantIndex = state.hasMaterialVariants
      ? this.#selectedGltfVariantIndex(state, node)
      : undefined;
    for (const primitive of state.primitives) {
      const nodeLod = primitive.nodeLod;
      if (selectedNodeLevels !== undefined && nodeLod !== undefined) {
        const selectedLevel = selectedNodeLevels.get(nodeLod.group);
        if (selectedLevel !== nodeLod.level) continue;
      }

      const primitiveMaterial = selectedVariantIndex === undefined
        ? primitive.baseMaterial
        : this.#gltfPrimitiveMaterialForVariant(selectedVariantIndex, primitive);
      const localModels = animationTransforms === undefined
        ? primitive.localModels
        : gltfPrimitiveAnimatedLocalModels(state.nodes, primitive, animationTransforms);
      const localModelDeterminants = animationTransforms === undefined
        ? primitive.localModelDeterminants
        : localModels.map(mat4OrientationDeterminant);
      const localBounds = animationTransforms === undefined
        ? primitive.localBounds
        : localModels.map((localModel) => worldBounds(primitive.positions, localModel));
      for (const [instanceIndex, localModel] of localModels.entries()) {
        const instanceBounds = localBounds[instanceIndex];
        const loadedMaterial = primitiveMaterial.materialLod === undefined
          ? primitiveMaterial.material
          : this.#selectedGltfMaterialLod(
            state,
            renderInstanceKey,
            primitive,
            primitiveMaterial,
            instanceIndex,
            instanceBounds,
            rootViewProjectionModel,
          );
        if (!isBoundsVisible(instanceBounds, rootViewProjectionModel)) {
          continue;
        }
        const prepared = this.#preparedGltfPrimitiveMaterial(primitive, loadedMaterial);
        draws.push({
          geometry: prepared.geometry,
          ...(assetLights === undefined ? {} : { lights: assetLights }),
          localModel,
          material: prepared.material,
          materialBatchKey: prepared.materialBatchKey,
          modelSignatureInstanceIndex: instanceIndex,
          modelSignatureStateKey: state.instanceKey,
          ...(animationTransforms === undefined ? {} : { modelSignatureValues: localModel }),
          rootModel,
          ...(rootHandle === undefined ? {} : { rootPositionSignatureVersion: rootHandle.positionVersion }),
          ...(rootHandle === undefined ? {} : { rootRotationSignatureVersion: rootHandle.rotationVersion }),
          ...(rootHandle === undefined ? {} : { rootScaleSignatureVersion: rootHandle.scaleVersion }),
          rootTransform,
          sidedness: {
            doubleSided: loadedMaterial.doubleSided,
            frontFaceCcw: rootDeterminant * (localModelDeterminants[instanceIndex] ?? 1) >= 0,
          },
        });
      }
    }
  }

  #drawGltfPrimitiveDraws(
    draws: readonly GltfPrimitiveDraw[],
    projection: Mat4,
    view: Mat4,
    passLights: SurfaceLightSet | undefined,
    toneMapping: PassToneMappingState,
    viewportSize: ViewportSize,
    usedGeometry: Set<string>,
  ): void {
    if (draws.length === 0) return;

    const batchInputs: GltfPrimitiveDrawBatchInput[] = [];
    for (const draw of draws) {
      const geometry = this.#geometryResource(draw.geometry);
      usedGeometry.add(geometry.key);
      const lights = combineSurfaceLightSets(passLights, draw.lights);
      const sidednessKey = draw.sidedness.doubleSided
        ? "double-sided"
        : draw.sidedness.frontFaceCcw ? "front-ccw" : "front-cw";
      const batchKey = `${geometry.key}|${draw.materialBatchKey}|${sidednessKey}|${lights.key}`;
      batchInputs.push({ draw, geometry, key: batchKey, lights });
    }
    const batches = this.#gltfPrimitiveDrawBatches(batchInputs);
    for (const batch of batches) {
      this.#gltfInstancingCounters.batchInstancesTotal += batch.localModels.length;
    }

    const blendedBatches: GltfPrimitiveDrawBatch[] = [];
    const transmissiveBatches: GltfPrimitiveDrawBatch[] = [];
    for (const batch of batches) {
      if (isBlendedSurfaceMaterial(batch.material)) {
        blendedBatches.push(batch);
      } else if (isTransmissiveSurfaceMaterial(batch.material)) {
        transmissiveBatches.push(batch);
      } else {
        this.#drawGltfPrimitiveDrawBatch(batch, projection, view, toneMapping, viewportSize, undefined);
      }
    }

    if (transmissiveBatches.length > 0) {
      const screenColorTexture = this.#copyTransmissionScreenColorTexture(viewportSize);
      for (const batch of transmissiveBatches) {
        this.#drawGltfPrimitiveDrawBatch(batch, projection, view, toneMapping, viewportSize, screenColorTexture);
      }
    }
    for (const batch of blendedBatches) {
      this.#drawGltfPrimitiveDrawBatch(batch, projection, view, toneMapping, viewportSize, undefined);
    }
  }

  #gltfPrimitiveDrawBatches(inputs: readonly GltfPrimitiveDrawBatchInput[]): readonly GltfPrimitiveDrawBatch[] {
    const planKey = gltfPrimitiveDrawBatchPlanKey(inputs);
    this.#activeGltfBatchPlanCacheKeys.add(planKey);
    const cached = this.#gltfBatchPlanCache.get(planKey);
    if (cached !== undefined) {
      this.#refreshGltfPrimitiveDrawBatchPlan(cached.batches, inputs);

      return cached.batches;
    }

    const batchesByKey = new Map<string, GltfPrimitiveDrawBatch>();
    for (const input of inputs) {
      let batch = batchesByKey.get(input.key);
      if (batch === undefined) {
        batch = {
          cpuGeometry: input.draw.geometry,
          geometry: input.geometry,
          key: input.key,
          lights: input.lights,
          localModelSignature: [],
          localModels: [],
          material: input.draw.material,
          rootPositionSignature: [],
          rootRotationSignature: [],
          rootScaleSignature: [],
          rootModels: [],
          rootTransforms: [],
          sidedness: input.draw.sidedness,
        };
        batchesByKey.set(input.key, batch);
      }
      appendGltfPrimitiveDrawBatchInput(batch, input);
    }

    const batches = Array.from(batchesByKey.values());
    this.#gltfBatchPlanCache.set(planKey, { batches });
    this.#gltfInstancingCounters.batchPlansBuilt += batches.length;

    return batches;
  }

  #refreshGltfPrimitiveDrawBatchPlan(
    batches: readonly GltfPrimitiveDrawBatch[],
    inputs: readonly GltfPrimitiveDrawBatchInput[],
  ): void {
    const batchesByKey = new Map<string, GltfPrimitiveDrawBatch>();
    for (const batch of batches) {
      batch.localModelSignature.length = 0;
      batch.localModels.length = 0;
      batch.rootPositionSignature.length = 0;
      batch.rootRotationSignature.length = 0;
      batch.rootScaleSignature.length = 0;
      batch.rootModels.length = 0;
      batch.rootTransforms.length = 0;
      batchesByKey.set(batch.key, batch);
    }

    for (const input of inputs) {
      const batch = batchesByKey.get(input.key);
      if (batch === undefined) continue;
      if (batch.localModels.length === 0) {
        batch.cpuGeometry = input.draw.geometry;
        batch.geometry = input.geometry;
        batch.lights = input.lights;
        batch.material = input.draw.material;
        batch.sidedness = input.draw.sidedness;
      }
      appendGltfPrimitiveDrawBatchInput(batch, input);
    }
  }

  #drawGltfPrimitiveDrawBatch(
    batch: GltfPrimitiveDrawBatch,
    projection: Mat4,
    view: Mat4,
    toneMapping: PassToneMappingState,
    viewportSize: ViewportSize,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    this.#applyDrawSidedness(batch.sidedness);
    this.#applyDrawAlphaState(batch.material);
    try {
      if (batch.localModels.length === 1) {
        this.#drawGeometry(
          batch.geometry,
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
          batch.cpuGeometry,
          batch.key,
          batch.material,
          batch.localModels,
          batch.localModelSignature,
          batch.rootModels,
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
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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

  #passSurfaceLightSet(
    light: DirectionalLightNode | undefined,
    environment: EnvironmentLight | undefined,
  ): SurfaceLightSet | undefined {
    if (light === undefined && environment === undefined) return undefined;
    const environmentLights = environment === undefined ? undefined : this.#environmentLightSet(environment);

    return surfaceLightSet(
      light === undefined
        ? []
        : [{
            color: light.color,
            direction: light.direction,
            kind: "directional",
          }],
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
        intensity: environment.irradianceIntensity,
        worldToIbl,
      },
      specular: {
        encoding: "ldr",
        intensity: environment.specularIntensity,
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

  #selectedGltfNodeLodLevels(
    state: GltfState,
    renderInstanceKey: string,
    rootViewProjectionModel: Mat4,
  ): Map<string, number> {
    const coverages = new Map<string, number>();
    const lods = new Map<string, GltfNodePrimitiveLod>();
    const levelPrimitives = new Map<string, LoadedGltfPrimitive[]>();

    for (const primitive of state.primitives) {
      const lod = primitive.nodeLod;
      if (lod === undefined) continue;
      lods.set(lod.group, lod);
      const levelKey = `${lod.group}:${lod.level}`;
      levelPrimitives.set(levelKey, [...(levelPrimitives.get(levelKey) ?? []), primitive]);
      if (lod.level !== 0) continue;

      for (const localBounds of primitive.localBounds) {
        const coverage = projectedBoundsScreenCoverage(localBounds, rootViewProjectionModel);
        coverages.set(lod.group, Math.max(coverages.get(lod.group) ?? 0, coverage));
      }
    }

    const selected = new Map<string, number>();
    for (const [group, lod] of lods) {
      const selectionKey = `${state.key}:${renderInstanceKey}:node:${group}`;
      const level = this.#selectGltfLodLevel(
        selectionKey,
        coverages.get(group) ?? 0,
        lod.levelCount,
        lod.thresholds,
        (level) => (levelPrimitives.get(`${group}:${level}`) ?? []).length > 0,
      );
      selected.set(group, level);
    }

    return selected;
  }

  #selectedGltfMaterialLod(
    state: GltfState,
    renderInstanceKey: string,
    primitive: LoadedGltfPrimitive,
    primitiveMaterial: LoadedGltfPrimitiveMaterial,
    instanceIndex: number,
    localBounds: Bounds3 | undefined,
    rootViewProjectionModel: Mat4,
  ): LoadedGltfMaterial {
    const lod = primitiveMaterial.materialLod;
    if (lod === undefined) return primitiveMaterial.material;
    const coverage = projectedBoundsScreenCoverage(localBounds, rootViewProjectionModel);
    const level = this.#selectGltfLodLevel(
      `${state.key}:${renderInstanceKey}:material:${primitive.key}:${primitiveMaterial.selectionKey}:instance:${instanceIndex}`,
      coverage,
      lod.levels.length,
      lod.thresholds,
      (level) => lod.levels[level] !== undefined,
    );
    return lod.levels[level] ?? primitiveMaterial.material;
  }

  #preparedGltfPrimitiveMaterial(
    primitive: LoadedGltfPrimitive,
    loadedMaterial: LoadedGltfMaterial,
  ): GltfPreparedPrimitiveMaterial {
    let primitiveCache = this.#gltfPreparedPrimitiveMaterials.get(primitive);
    if (primitiveCache === undefined) {
      primitiveCache = new WeakMap();
      this.#gltfPreparedPrimitiveMaterials.set(primitive, primitiveCache);
    }

    const cached = primitiveCache.get(loadedMaterial);
    if (cached !== undefined) return cached;

    const baseColor = this.#gltfMaterialTextureRef(loadedMaterial);
    const surfaceTextures = this.#gltfMaterialSurfaceTextures(loadedMaterial);
    const geometry: CpuGeometry = {
      ...(primitive.colors === undefined ? {} : { colors: primitive.colors }),
      ...(loadedMaterial.emissiveTexCoords === undefined ? {} : { emissiveTexCoords: loadedMaterial.emissiveTexCoords }),
      ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
      key: gltfGeometryContentKey({
        ...(primitive.colors === undefined ? {} : { colors: primitive.colors }),
        ...(loadedMaterial.emissiveTexCoords === undefined ? {} : { emissiveTexCoords: loadedMaterial.emissiveTexCoords }),
        ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
        mode: primitive.mode,
        ...(primitive.normals === undefined ? {} : { normals: primitive.normals }),
        positions: primitive.positions,
        ...(primitive.tangents === undefined ? {} : { tangents: primitive.tangents }),
        ...(loadedMaterial.texCoords === undefined ? {} : { texCoords: loadedMaterial.texCoords }),
      }),
      mode: primitive.mode,
      ...(primitive.normals === undefined ? {} : { normals: primitive.normals }),
      positions: primitive.positions,
      ...(primitive.tangents === undefined ? {} : { tangents: primitive.tangents }),
      ...(loadedMaterial.emissiveTexCoords === undefined ? {} : { emissiveTexCoords: loadedMaterial.emissiveTexCoords }),
      ...(loadedMaterial.texCoords === undefined ? {} : { texCoords: loadedMaterial.texCoords }),
    };
    const material = loadedGltfSurfaceMaterial(
      loadedMaterial,
      loadedMaterial.image !== undefined && baseColor !== undefined
        ? baseColor
        : { color: loadedMaterial.color ?? DEFAULT_COLOR, kind: "solid" },
      surfaceTextures,
    );
    const prepared: GltfPreparedPrimitiveMaterial = {
      geometry,
      material,
      materialBatchKey: surfaceMaterialBatchKey(material),
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

  #selectedGltfVariantIndex(state: GltfState, node: GltfNode): number | undefined {
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

  #selectGltfLodLevel(
    selectionKey: string,
    coverage: number,
    levelCount: number,
    thresholds: readonly number[],
    isDrawable: (level: number) => boolean,
  ): number {
    const previous = this.#gltfLodSelections.get(selectionKey)?.level;
    const target = hystereticLodLevel(coverage, levelCount, thresholds, previous);
    const selected = this.#drawableGltfLodLevel(target, previous, levelCount, isDrawable);
    this.#activeGltfLodSelectionKeys.add(selectionKey);
    this.#gltfLodSelections.set(selectionKey, {
      level: selected,
    });
    return selected;
  }

  #drawableGltfLodLevel(
    target: number,
    previous: number | undefined,
    levelCount: number,
    isDrawable: (level: number) => boolean,
  ): number {
    if (isDrawable(target)) return target;
    if (previous !== undefined && previous >= 0 && previous < levelCount && isDrawable(previous)) {
      return previous;
    }
    for (let level = 0; level < levelCount; level += 1) {
      if (isDrawable(level)) return level;
    }
    return target;
  }

  #pruneGltfLodSelections(): void {
    for (const key of this.#gltfLodSelections.keys()) {
      if (!this.#activeGltfLodSelectionKeys.has(key)) this.#gltfLodSelections.delete(key);
    }
  }

  #gltfMaterialTextureRef(material: LoadedGltfMaterial): TextureAssetUploadRef | undefined {
    if (material.baseColorTextureUri === undefined) return undefined;
    const texture = {
      colorSpace: "srgb",
      ...(material.baseColorContentKey === undefined ? {} : { contentKey: material.baseColorContentKey }),
      flipY: false,
      kind: "asset",
      ...(material.sampler === undefined ? {} : { sampler: material.sampler }),
      uri: material.baseColorTextureUri,
    } satisfies TextureAssetUploadRef;
    this.#registerAutoBaseColorVirtualTextureManifest(texture, material.baseColorSourceUri);
    this.#registerAutoBaseColorVirtualTextureGeneratedPageSource(
      texture,
      material.baseColorSvgVirtualTextureSource === undefined
        ? undefined
        : { kind: "svg", source: material.baseColorSvgVirtualTextureSource },
    );
    return texture;
  }

  #gltfMaterialMetallicRoughnessTextureRef(material: LoadedGltfMaterial): TextureAssetUploadRef | undefined {
    if (material.metallicRoughnessTextureUri === undefined) return undefined;
    return {
      colorSpace: "linear",
      ...(material.metallicRoughnessContentKey === undefined
        ? {}
        : { contentKey: material.metallicRoughnessContentKey }),
      flipY: false,
      kind: "asset",
      ...(material.metallicRoughnessSampler === undefined ? {} : { sampler: material.metallicRoughnessSampler }),
      uri: material.metallicRoughnessTextureUri,
    };
  }

  #gltfMaterialNormalTextureRef(material: LoadedGltfMaterial): TextureAssetUploadRef | undefined {
    if (material.normalTextureUri === undefined) return undefined;
    return {
      colorSpace: "linear",
      ...(material.normalContentKey === undefined ? {} : { contentKey: material.normalContentKey }),
      flipY: false,
      kind: "asset",
      ...(material.normalSampler === undefined ? {} : { sampler: material.normalSampler }),
      uri: material.normalTextureUri,
    };
  }

  #gltfMaterialEmissiveTextureRef(material: LoadedGltfMaterial): TextureAssetUploadRef | undefined {
    if (material.emissiveTextureUri === undefined) return undefined;
    return {
      colorSpace: "srgb",
      ...(material.emissiveContentKey === undefined ? {} : { contentKey: material.emissiveContentKey }),
      flipY: false,
      kind: "asset",
      ...(material.emissiveSampler === undefined ? {} : { sampler: material.emissiveSampler }),
      uri: material.emissiveTextureUri,
    };
  }

  #gltfMaterialOcclusionTextureRef(material: LoadedGltfMaterial): TextureAssetUploadRef | undefined {
    if (material.occlusionTextureUri === undefined) return undefined;
    return {
      colorSpace: "linear",
      ...(material.occlusionContentKey === undefined ? {} : { contentKey: material.occlusionContentKey }),
      flipY: false,
      kind: "asset",
      ...(material.occlusionSampler === undefined ? {} : { sampler: material.occlusionSampler }),
      uri: material.occlusionTextureUri,
    };
  }

  #gltfTextureSlotRef(
    slot: LoadedGltfMaterialTextureSlot | undefined,
    colorSpace: TextureColorSpace,
  ): TextureAssetUploadRef | undefined {
    if (slot?.textureUri === undefined) return undefined;
    return {
      colorSpace,
      ...(slot.contentKey === undefined ? {} : { contentKey: slot.contentKey }),
      flipY: false,
      kind: "asset",
      ...(slot.sampler === undefined ? {} : { sampler: slot.sampler }),
      uri: slot.textureUri,
    };
  }

  #gltfMaterialSurfaceTextures(material: LoadedGltfMaterial): LoadedGltfSurfaceTextures {
    const extensionTextures = material.extensionTextures;
    const textures: Partial<Record<keyof LoadedGltfSurfaceTextures, TextureAssetUploadRef>> = {};
    const setTexture = (
      key: keyof LoadedGltfSurfaceTextures,
      texture: TextureAssetUploadRef | undefined,
    ): void => {
      if (texture !== undefined) textures[key] = texture;
    };

    setTexture("emissiveTexture", this.#gltfMaterialEmissiveTextureRef(material));
    setTexture("metallicRoughnessTexture", this.#gltfMaterialMetallicRoughnessTextureRef(material));
    setTexture("normalTexture", this.#gltfMaterialNormalTextureRef(material));
    setTexture("occlusionTexture", this.#gltfMaterialOcclusionTextureRef(material));
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      setTexture(texture.key, this.#gltfTextureSlotRef(extensionTextures?.[texture.key], texture.colorSpace));
    }

    return textures;
  }

  #drawGeometry(
    geometry: GeometryResource,
    material: Material,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
    lights: SurfaceLightSet | undefined,
    toneMapping: PassToneMappingState,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    cpuGeometry?: CpuGeometry,
  ): void {
    const gl = this.#gl;
    const baseColorResidency = this.#resolveBaseColorTextureResidency(
      geometry,
      material,
      this.#virtualTextureDrawDemandContext(
        cpuGeometry,
        { kind: "single", model },
        projection,
        view,
        viewportSize,
      ),
    );
    const programKind: ProgramKind = material.kind === "wireframe"
      ? "wireframe"
      : "surface";
    const surfaceMaterial: SurfaceMaterial | undefined =
      programKind === "surface" && material.kind !== "wireframe" ? material : undefined;
    const surfaceLights = surfaceMaterial?.kind === "standard"
      ? lights ?? DEFAULT_SURFACE_LIGHT_SET
      : surfaceMaterial === undefined ? undefined : EMPTY_SURFACE_LIGHT_SET;
    const surfaceTexturePlan = surfaceMaterial === undefined || surfaceLights === undefined
      ? undefined
      : this.#surfaceTextureBindingPlan(
        surfaceMaterial,
        transmissionScreenColorTexture,
        surfaceLights,
        baseColorResidency,
      );
    const programResource = this.#program(programKind, surfaceTexturePlan?.features);
    const program = programResource.program;
    this.#useProgram(program);

    this.#uniformMatrix(program, "u_projection", projection);
    this.#uniformMatrix(program, "u_view", view);
    this.#uniformMatrix(program, "u_model", model);
    this.#uniformColor(
      program,
      "u_color",
      surfaceTexturePlan?.baseColor.kind === "prepared-virtual" ? TEXTURE_COLOR : materialColor(material),
    );
    this.#uniform1i(program, "u_unlit", material.kind === "standard" ? 0 : 1);
    if (surfaceTexturePlan !== undefined && surfaceLights !== undefined && surfaceMaterial !== undefined) {
      this.#uniformColor(program, "u_emissiveColor", materialEmissiveColor(surfaceMaterial));
      this.#bindSurfaceMaterialFactors(program, surfaceMaterial, transmissionScreenColorTexture, surfaceTexturePlan);
      this.#bindSurfaceToneMapping(program, toneMapping);
      this.#bindSurfaceLights(program, surfaceLights, surfaceTexturePlan);
    }

    const baseColorBinding = this.#bindSurfaceBaseColorTexture(program, surfaceTexturePlan);
    this.#uniform1i(program, "u_useTexture", baseColorBinding.kind === "ordinary" ? 1 : 0);
    this.#uniform1i(program, "u_useVirtualTexture", baseColorBinding.kind === "prepared-virtual" ? 1 : 0);
    this.#bindGeometryAttributes(program, geometry);

    if (material.kind === "wireframe") gl.lineWidth?.(material.width);

    const mode = webGlDrawMode(gl, geometry.mode);
    if (geometry.indexBuffer === undefined || geometry.indexType === undefined) {
      gl.drawArrays(mode, 0, geometry.drawCount);
    } else {
      gl.drawElements(mode, geometry.drawCount, geometry.indexType, 0);
    }
  }

  #drawGeometryInstanced(
    geometry: GeometryResource,
    cpuGeometry: CpuGeometry,
    instanceBufferKey: string,
    material: SurfaceMaterial,
    localModels: readonly Mat4[],
    localModelSignature: readonly number[],
    rootModels: readonly Mat4[],
    rootTransforms: readonly (Transform | undefined)[],
    rootPositionSignature: readonly number[],
    rootRotationSignature: readonly number[],
    rootScaleSignature: readonly number[],
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
    lights: SurfaceLightSet,
    toneMapping: PassToneMappingState,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    const gl = this.#gl;
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
    const programResource = this.#program("surface-instanced-split", surfaceTexturePlan.features);
    const program = programResource.program;
    this.#useProgram(program);

    this.#uniformMatrix(program, "u_projection", projection);
    this.#uniformMatrix(program, "u_view", view);
    this.#uniformColor(
      program,
      "u_color",
      surfaceTexturePlan.baseColor.kind === "prepared-virtual" ? TEXTURE_COLOR : materialColor(material),
    );
    this.#uniformColor(program, "u_emissiveColor", materialEmissiveColor(material));
    this.#uniform1i(program, "u_unlit", material.kind === "standard" ? 0 : 1);
    this.#bindSurfaceMaterialFactors(program, material, transmissionScreenColorTexture, surfaceTexturePlan);
    this.#bindSurfaceToneMapping(program, toneMapping);
    this.#bindSurfaceLights(program, surfaceLights, surfaceTexturePlan);

    const baseColorBinding = this.#bindSurfaceBaseColorTexture(program, surfaceTexturePlan);
    this.#uniform1i(program, "u_useTexture", baseColorBinding.kind === "ordinary" ? 1 : 0);
    this.#uniform1i(program, "u_useVirtualTexture", baseColorBinding.kind === "prepared-virtual" ? 1 : 0);
    const instanceResource = this.#bindGltfInstanceModels(
      instanceBufferKey,
      localModels,
      localModelSignature,
      rootTransforms,
      rootPositionSignature,
      rootRotationSignature,
      rootScaleSignature,
    );
    this.#bindGltfInstancedAttributes(program, geometry, instanceBufferKey, instanceResource);

    const mode = webGlDrawMode(gl, geometry.mode);
    this.#gltfInstancingCounters.drawCalls += 1;
    this.#gltfInstancingCounters.instancesDrawn += localModels.length;
    if (geometry.indexBuffer === undefined || geometry.indexType === undefined) {
      gl.drawArraysInstanced(mode, 0, geometry.drawCount, localModels.length);
    } else {
      gl.drawElementsInstanced(mode, geometry.drawCount, geometry.indexType, 0, localModels.length);
    }
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
    this.#uniformColor(program, "u_alphaSettings", [
      alphaMode === "MASK" ? 1 : alphaMode === "BLEND" ? 2 : 0,
      surfaceMaterialAlphaCutoff(material),
      0,
      0,
    ]);
    this.#uniformColor(program, "u_materialPbrFactors", [
      surfaceMaterialMetallicFactor(material),
      surfaceMaterialRoughnessFactor(material),
      0,
      0,
    ]);
    this.#uniformColor(program, "u_specularColorFactor", [
      factors.specularColorFactor[0],
      factors.specularColorFactor[1],
      factors.specularColorFactor[2],
      1,
    ]);
    this.#uniformColor(program, "u_materialExtensionFactors", [
      factors.specularFactor,
      factors.ior,
      factors.clearcoatFactor,
      factors.clearcoatRoughnessFactor,
    ]);
    this.#uniformColor(program, "u_anisotropyFactors", [
      factors.anisotropyStrength,
      factors.anisotropyRotation,
      0,
      0,
    ]);
    this.#uniformColor(program, "u_diffuseTransmissionFactors", [
      factors.diffuseTransmissionColorFactor[0],
      factors.diffuseTransmissionColorFactor[1],
      factors.diffuseTransmissionColorFactor[2],
      factors.diffuseTransmissionFactor,
    ]);
    this.#uniformColor(program, "u_sheenColorFactor", [
      factors.sheenColorFactor[0],
      factors.sheenColorFactor[1],
      factors.sheenColorFactor[2],
      factors.sheenRoughnessFactor,
    ]);
    this.#uniformColor(program, "u_iridescenceFactors", [
      factors.iridescenceFactor,
      factors.iridescenceIor,
      factors.iridescenceThicknessMinimum,
      factors.iridescenceThicknessMaximum,
    ]);
    this.#uniformColor(program, "u_dispersionFactors", [
      factors.dispersionFactor,
      0,
      0,
      0,
    ]);
    this.#uniformColor(program, "u_attenuationColorFactor", [
      factors.attenuationColor[0],
      factors.attenuationColor[1],
      factors.attenuationColor[2],
      1,
    ]);
    this.#uniformColor(program, "u_transmissionVolumeFactors", [
      factors.transmissionFactor,
      factors.thicknessFactor,
      hasFiniteAttenuationDistance ? factors.attenuationDistance : 0,
      hasFiniteAttenuationDistance ? 1 : 0,
    ]);
    this.#bindTransmissionScreenColorTexture(program, transmissionScreenColorTexture, plan);
    this.#bindEmissiveTexture(program, material, plan);
    this.#bindMetallicRoughnessTexture(program, material, plan);
    this.#bindNormalTexture(program, material, plan);
    this.#bindOcclusionTexture(program, material, plan);
    this.#bindMaterialExtensionTextures(program, material, plan);
  }

  #surfaceTextureUnitAllocator(): TextureUnitAllocator {
    return { used: new Set() };
  }

  #surfaceTextureBindingPlan(
    material: SurfaceMaterial,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    lightSet: SurfaceLightSet,
    baseColorResidency: BaseColorTextureResidency,
  ): SurfaceTextureBindingPlan {
    const features = new Set<SurfaceShaderTextureFeature>();
    const textureUnits = new Map<SurfaceShaderTextureFeature, number>();
    const allocator = this.#surfaceTextureUnitAllocator();
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
      reserveTextureUnit("iblBrdfLut", IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT);
    }

    return { baseColor, features, textureUnits };
  }

  #bindSurfaceToneMapping(program: WebGLProgram, toneMapping: PassToneMappingState): void {
    this.#uniformColor(program, "u_toneMappingSettings", [
      toneMapping.toneMapping === "aces" ? 1 : 0,
      toneMapping.exposure,
      0,
      0,
    ]);
  }

  #allocateTextureUnit(allocator: TextureUnitAllocator, preferred: number): number | undefined {
    const maxTextureImageUnits = this.#maxTextureImageUnits;
    if (maxTextureImageUnits <= 0) return undefined;
    if (preferred < maxTextureImageUnits && !allocator.used.has(preferred)) {
      allocator.used.add(preferred);
      return preferred;
    }
    for (let unit = 0; unit < maxTextureImageUnits; unit += 1) {
      if (allocator.used.has(unit)) continue;
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
    this.#uniformColor(program, "u_normalTextureSettings", [
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
    this.#uniformColor(program, "u_occlusionSettings", [
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
      this.#uniform1i(program, useUniform, 0);
      return;
    }

    const resource = this.#textures.get(textureCacheKey(texture));
    if (resource === undefined || !resource.uploaded) {
      this.#uniform1i(program, useUniform, 0);
      return;
    }

    const gl = this.#gl;
    const allocatedUnit = plan.textureUnits.get(feature);
    if (allocatedUnit === undefined) {
      this.#uniform1i(program, useUniform, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE0 + allocatedUnit);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    this.#uniform1i(program, samplerUniform, allocatedUnit);
    this.#uniform1i(program, useUniform, 1);
  }

  #bindTransmissionScreenColorTexture(
    program: WebGLProgram,
    resource: ScreenColorTextureResource | undefined,
    plan: SurfaceTextureBindingPlan,
  ): void {
    if (resource === undefined || !resource.uploaded) {
      this.#uniform1i(program, "u_useTransmissionTexture", 0);
      return;
    }

    const gl = this.#gl;
    const textureUnit = plan.textureUnits.get("transmissionScreenTexture");
    if (textureUnit === undefined) {
      this.#uniform1i(program, "u_useTransmissionTexture", 0);
      return;
    }
    this.#uniform1i(program, "u_useTransmissionTexture", 1);
    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    this.#uniform1i(program, "u_transmissionScreenTexture", textureUnit);
    this.#uniform2fv(program, "u_viewportSize", [resource.width, resource.height]);
  }

  #bindSurfaceLights(
    program: WebGLProgram,
    lightSet: SurfaceLightSet,
    plan: SurfaceTextureBindingPlan,
  ): void {
    bindSurfaceIblUniforms({
      brdfLutTexture: () => {
        const brdfLutTextureUnit = plan.textureUnits.get("iblBrdfLut");
        if (brdfLutTextureUnit === undefined) return undefined;

        return {
          texture: this.#iblBrdfLutTextureResource(brdfLutTextureUnit),
          textureUnit: brdfLutTextureUnit,
        };
      },
      gl: this.#gl,
      uniform1i: (uniformProgram, name, value) => this.#uniform1i(uniformProgram, name, value),
      uniformColor: (uniformProgram, name, color) => this.#uniformColor(uniformProgram, name, color),
      uniformMatrix: (uniformProgram, name, matrix) => this.#uniformMatrix(uniformProgram, name, matrix),
    }, program, lightSet);

    const lights = lightSet.lights.slice(0, MAX_SURFACE_LIGHTS);
    this.#uniform1i(program, "u_surfaceLightCount", lights.length);

    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      if (light === undefined) continue;

      const range = light.kind === "directional" ? 0 : light.range ?? 0;
      const direction = light.kind === "point" ? DEFAULT_LIGHT_DIRECTION : light.direction;
      const position = light.kind === "directional" ? [0, 0, 0] as const : light.position;
      const cone = light.kind === "spot"
        ? [Math.cos(light.innerConeAngle), Math.cos(light.outerConeAngle), 0, 0] as const
        : [1, 0, 0, 0] as const;
      const kind = light.kind === "directional" ? 0 : light.kind === "point" ? 1 : 2;

      this.#uniform1i(program, `u_surfaceLightKind[${index}]`, kind);
      this.#uniformColor(program, `u_surfaceLightColor[${index}]`, light.color);
      this.#uniformColor(program, `u_surfaceLightDirection[${index}]`, [
        direction[0],
        direction[1],
        direction[2],
        range,
      ]);
      this.#uniformColor(program, `u_surfaceLightPosition[${index}]`, [
        position[0],
        position[1],
        position[2],
        0,
      ]);
      this.#uniformColor(program, `u_surfaceLightCone[${index}]`, cone);
    }

  }

  #bindGeometryAttributes(program: WebGLProgram, geometry: GeometryResource): void {
    const gl = this.#gl;
    gl.bindVertexArray(this.#geometryVertexArray(program, geometry));
    this.#bindGeometryDefaultAttributeValues(program, geometry);
  }

  #bindGltfInstancedAttributes(
    program: WebGLProgram,
    geometry: GeometryResource,
    instanceBufferKey: string,
    instanceResource: GltfInstanceBufferResource,
  ): void {
    const gl = this.#gl;
    gl.bindVertexArray(this.#gltfInstancedVertexArray(program, geometry, instanceBufferKey, instanceResource));
    this.#bindGeometryDefaultAttributeValues(program, geometry);
  }

  #geometryProgramVertexArrays(
    program: WebGLProgram,
    geometry: GeometryResource,
  ): GeometryProgramVertexArrays {
    let vertexArrays = geometry.vertexArrays.get(program);
    if (vertexArrays === undefined) {
      vertexArrays = { instanced: new Map() };
      geometry.vertexArrays.set(program, vertexArrays);
    }
    return vertexArrays;
  }

  #geometryVertexArray(program: WebGLProgram, geometry: GeometryResource): WebGLVertexArrayObject {
    const vertexArrays = this.#geometryProgramVertexArrays(program, geometry);
    if (vertexArrays.base !== undefined) return vertexArrays.base;

    const gl = this.#gl;
    const vertexArray = this.#createVertexArray();
    gl.bindVertexArray(vertexArray);
    this.#configureGeometryVertexAttributes(program, geometry);
    vertexArrays.base = vertexArray;
    return vertexArray;
  }

  #gltfInstancedVertexArray(
    program: WebGLProgram,
    geometry: GeometryResource,
    instanceBufferKey: string,
    instanceResource: GltfInstanceBufferResource,
  ): WebGLVertexArrayObject {
    const vertexArrays = this.#geometryProgramVertexArrays(program, geometry);
    const cached = vertexArrays.instanced.get(instanceBufferKey);
    if (cached !== undefined) return cached;

    const gl = this.#gl;
    const vertexArray = this.#createVertexArray();
    gl.bindVertexArray(vertexArray);
    this.#configureGeometryVertexAttributes(program, geometry);
    this.#configureGltfInstanceVertexAttributes(instanceResource);
    vertexArrays.instanced.set(instanceBufferKey, vertexArray);
    return vertexArray;
  }

  #configureGeometryVertexAttributes(program: WebGLProgram, geometry: GeometryResource): void {
    const gl = this.#gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.arrayBuffer);
    const positionLocation = this.#attribLocation(program, "a_position");
    if (positionLocation >= 0) {
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    }
    const uvLocation = this.#attribLocation(program, "a_uv");
    if (uvLocation >= 0) {
      if (geometry.texCoordBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.texCoordBuffer);
        gl.enableVertexAttribArray(uvLocation);
        gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(uvLocation);
      }
    }
    const emissiveUvLocation = this.#attribLocation(program, "a_emissive_uv");
    if (emissiveUvLocation >= 0) {
      if (geometry.emissiveTexCoordBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.emissiveTexCoordBuffer);
        gl.enableVertexAttribArray(emissiveUvLocation);
        gl.vertexAttribPointer(emissiveUvLocation, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(emissiveUvLocation);
      }
    }
    const normalLocation = this.#attribLocation(program, "a_normal");
    if (normalLocation >= 0) {
      if (geometry.normalBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normalBuffer);
        gl.enableVertexAttribArray(normalLocation);
        gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(normalLocation);
      }
    }
    const tangentLocation = this.#attribLocation(program, "a_tangent");
    if (tangentLocation >= 0) {
      if (geometry.tangentBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.tangentBuffer);
        gl.enableVertexAttribArray(tangentLocation);
        gl.vertexAttribPointer(tangentLocation, 4, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(tangentLocation);
      }
    }
    const colorLocation = this.#attribLocation(program, "a_color");
    if (colorLocation >= 0) {
      if (geometry.colorBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.colorBuffer);
        gl.enableVertexAttribArray(colorLocation);
        gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(colorLocation);
      }
    }
    if (geometry.indexBuffer !== undefined && geometry.indexType !== undefined) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
    } else {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    }
  }

  #bindGeometryDefaultAttributeValues(program: WebGLProgram, geometry: GeometryResource): void {
    const emissiveUvLocation = this.#attribLocation(program, "a_emissive_uv");
    if (emissiveUvLocation >= 0 && geometry.emissiveTexCoordBuffer === undefined) {
      this.#vertexAttrib2f(emissiveUvLocation, 0, 0);
    }
    const tangentLocation = this.#attribLocation(program, "a_tangent");
    if (tangentLocation >= 0 && geometry.tangentBuffer === undefined) {
      this.#vertexAttrib4f(tangentLocation, 0, 0, 0, 0);
    }
    const colorLocation = this.#attribLocation(program, "a_color");
    if (colorLocation >= 0 && geometry.colorBuffer === undefined) {
      this.#vertexAttrib4f(colorLocation, 1, 1, 1, 1);
    }
  }

  #configureGltfInstanceVertexAttributes(resource: GltfInstanceBufferResource): void {
    const gl = this.#gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, resource.localBuffer);
    for (let column = 0; column < 4; column += 1) {
      const location = 3 + column;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 64, column * 16);
      gl.vertexAttribDivisor(location, 1);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, resource.rootPose.buffer);
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(7, 1);
    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 3, gl.FLOAT, false, 24, 12);
    gl.vertexAttribDivisor(8, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, resource.rootScale.buffer);
    gl.enableVertexAttribArray(9);
    gl.vertexAttribPointer(9, 3, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(9, 1);
  }

  #recordGltfInstanceLocalBufferUpload(floatCount: number): void {
    this.#gltfInstancingCounters.localModelUploadCalls += 1;
    this.#gltfInstancingCounters.localModelUploadBytes += floatCount * Float32Array.BYTES_PER_ELEMENT;
  }

  #recordGltfInstanceRootScaleBufferUpload(floatCount: number): void {
    this.#gltfInstancingCounters.rootScaleUploadCalls += 1;
    this.#gltfInstancingCounters.rootScaleUploadBytes += floatCount * Float32Array.BYTES_PER_ELEMENT;
  }

  #recordGltfInstanceRootPoseBufferUpload(floatCount: number): void {
    this.#gltfInstancingCounters.rootPoseUploadCalls += 1;
    this.#gltfInstancingCounters.rootPoseUploadBytes += floatCount * Float32Array.BYTES_PER_ELEMENT;
  }

  #bindGltfInstanceModels(
    key: string,
    localModels: readonly Mat4[],
    localModelSignature: readonly number[],
    rootTransforms: readonly (Transform | undefined)[],
    rootPositionSignature: readonly number[],
    rootRotationSignature: readonly number[],
    rootScaleSignature: readonly number[],
  ): GltfInstanceBufferResource {
    const gl = this.#gl;
    const instanceCount = localModels.length;
    const localFloatCount = instanceCount * 16;
    const rootVectorFloatCount = instanceCount * 3;
    const rootPoseFloatCount = instanceCount * 6;
    const resource = this.#gltfInstanceBufferResource(
      key,
      localFloatCount,
      rootPoseFloatCount,
      rootVectorFloatCount,
    );
    const previousInstanceCount = resource.instanceCount;

    const previousLocalSignature = resource.localSignature;
    const previousLocalStride = previousLocalSignature === undefined
      ? undefined
      : gltfInstanceSignatureStride(previousInstanceCount, previousLocalSignature);
    const nextLocalStride = gltfInstanceSignatureStride(instanceCount, localModelSignature);
    const localFullUpload = resource.localDirty
      || previousLocalSignature === undefined
      || previousLocalStride === undefined
      || nextLocalStride === undefined
      || previousLocalStride !== nextLocalStride
      || previousLocalSignature.length !== localModelSignature.length
      || previousInstanceCount !== instanceCount;
    const localChangedRanges: Array<{ readonly start: number; end: number }> = [];
    let activeLocalRange: { readonly start: number; end: number } | undefined;

    for (let modelIndex = 0; modelIndex < localModels.length; modelIndex += 1) {
      const signatureOffset = modelIndex * (nextLocalStride ?? 0);
      const changed = localFullUpload
        || previousLocalSignature === undefined
        || nextLocalStride === undefined
        || !sameGltfModelSignatureRange(
          previousLocalSignature,
          localModelSignature,
          signatureOffset,
          nextLocalStride,
        );
      if (!changed) continue;

      const model = localModels[modelIndex]!;
      const offset = modelIndex * 16;
      for (let elementIndex = 0; elementIndex < 16; elementIndex += 1) {
        resource.localData[offset + elementIndex] = model[elementIndex]!;
      }
      if (activeLocalRange !== undefined && activeLocalRange.end === modelIndex) {
        activeLocalRange.end = modelIndex + 1;
      } else {
        activeLocalRange = { start: modelIndex, end: modelIndex + 1 };
        localChangedRanges.push(activeLocalRange);
      }
    }

    if (localFullUpload) {
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.localBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, resource.localData, 0, localFloatCount);
      this.#recordGltfInstanceLocalBufferUpload(localFloatCount);
      resource.localDirty = false;
      resource.localSignature = copyGltfInstanceSignature(resource.localSignature, localModelSignature);
    } else if (localChangedRanges.length > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.localBuffer);
      for (const range of localChangedRanges) {
        const startFloat = range.start * 16;
        const rangeFloatCount = (range.end - range.start) * 16;
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          startFloat * Float32Array.BYTES_PER_ELEMENT,
          resource.localData,
          startFloat,
          rangeFloatCount,
        );
        this.#recordGltfInstanceLocalBufferUpload(rangeFloatCount);
      }
      resource.localSignature = copyGltfInstanceSignature(resource.localSignature, localModelSignature);
    }
    this.#bindGltfInstanceRootPoseBuffer(
      resource.rootPose,
      rootTransforms,
      rootPositionSignature,
      rootRotationSignature,
      previousInstanceCount,
      instanceCount,
    );
    this.#bindGltfInstanceVectorBuffer(
      resource.rootScale,
      rootTransforms,
      rootScaleSignature,
      "scale",
      previousInstanceCount,
      instanceCount,
    );
    resource.instanceCount = instanceCount;
    return resource;
  }

  #bindGltfInstanceRootPoseBuffer(
    resource: GltfInstanceRootPoseBufferResource,
    rootTransforms: readonly (Transform | undefined)[],
    nextPositionSignature: readonly number[],
    nextRotationSignature: readonly number[],
    previousInstanceCount: number,
    instanceCount: number,
  ): void {
    const gl = this.#gl;
    const floatCount = instanceCount * 6;
    const previousPositionSignature = resource.positionSignature;
    const previousRotationSignature = resource.rotationSignature;
    const previousPositionStride = previousPositionSignature === undefined
      ? undefined
      : gltfInstanceSignatureStride(previousInstanceCount, previousPositionSignature);
    const previousRotationStride = previousRotationSignature === undefined
      ? undefined
      : gltfInstanceSignatureStride(previousInstanceCount, previousRotationSignature);
    const nextPositionStride = gltfInstanceSignatureStride(instanceCount, nextPositionSignature);
    const nextRotationStride = gltfInstanceSignatureStride(instanceCount, nextRotationSignature);
    const fullUpload = resource.dirty
      || previousPositionSignature === undefined
      || previousRotationSignature === undefined
      || previousPositionStride === undefined
      || previousRotationStride === undefined
      || nextPositionStride === undefined
      || nextRotationStride === undefined
      || previousPositionStride !== nextPositionStride
      || previousRotationStride !== nextRotationStride
      || previousPositionSignature.length !== nextPositionSignature.length
      || previousRotationSignature.length !== nextRotationSignature.length
      || previousInstanceCount !== instanceCount;
    const changedRanges: Array<{ readonly start: number; end: number }> = [];
    let activeRange: { readonly start: number; end: number } | undefined;

    for (let transformIndex = 0; transformIndex < rootTransforms.length; transformIndex += 1) {
      const positionSignatureOffset = transformIndex * (nextPositionStride ?? 0);
      const rotationSignatureOffset = transformIndex * (nextRotationStride ?? 0);
      const changed = fullUpload
        || previousPositionSignature === undefined
        || previousRotationSignature === undefined
        || nextPositionStride === undefined
        || nextRotationStride === undefined
        || !sameGltfModelSignatureRange(
          previousPositionSignature,
          nextPositionSignature,
          positionSignatureOffset,
          nextPositionStride,
        )
        || !sameGltfModelSignatureRange(
          previousRotationSignature,
          nextRotationSignature,
          rotationSignatureOffset,
          nextRotationStride,
        );
      if (!changed) continue;

      const transform = rootTransforms[transformIndex] ?? IDENTITY_TRANSFORM;
      const offset = transformIndex * 6;
      const position = transform.position;
      const rotation = transform.rotation;
      resource.data[offset] = position[0];
      resource.data[offset + 1] = position[1];
      resource.data[offset + 2] = position[2];
      resource.data[offset + 3] = rotation[0];
      resource.data[offset + 4] = rotation[1];
      resource.data[offset + 5] = rotation[2];
      if (activeRange !== undefined && activeRange.end === transformIndex) {
        activeRange.end = transformIndex + 1;
      } else {
        activeRange = { start: transformIndex, end: transformIndex + 1 };
        changedRanges.push(activeRange);
      }
    }

    if (fullUpload) {
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, resource.data, 0, floatCount);
      this.#recordGltfInstanceRootPoseBufferUpload(floatCount);
      resource.dirty = false;
      resource.positionSignature = copyGltfInstanceSignature(resource.positionSignature, nextPositionSignature);
      resource.rotationSignature = copyGltfInstanceSignature(resource.rotationSignature, nextRotationSignature);
    } else if (changedRanges.length > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.buffer);
      for (const range of changedRanges) {
        const startFloat = range.start * 6;
        const rangeFloatCount = (range.end - range.start) * 6;
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          startFloat * Float32Array.BYTES_PER_ELEMENT,
          resource.data,
          startFloat,
          rangeFloatCount,
        );
        this.#recordGltfInstanceRootPoseBufferUpload(rangeFloatCount);
      }
      resource.positionSignature = copyGltfInstanceSignature(resource.positionSignature, nextPositionSignature);
      resource.rotationSignature = copyGltfInstanceSignature(resource.rotationSignature, nextRotationSignature);
    }
  }

  #bindGltfInstanceVectorBuffer(
    resource: GltfInstanceVectorBufferResource,
    rootTransforms: readonly (Transform | undefined)[],
    nextSignature: readonly number[],
    field: keyof Transform,
    previousInstanceCount: number,
    instanceCount: number,
  ): void {
    const gl = this.#gl;
    const floatCount = instanceCount * 3;
    const previousSignature = resource.signature;
    const previousStride = previousSignature === undefined
      ? undefined
      : gltfInstanceSignatureStride(previousInstanceCount, previousSignature);
    const nextStride = gltfInstanceSignatureStride(instanceCount, nextSignature);
    const fullUpload = resource.dirty
      || previousSignature === undefined
      || previousStride === undefined
      || nextStride === undefined
      || previousStride !== nextStride
      || previousSignature.length !== nextSignature.length
      || previousInstanceCount !== instanceCount;
    const changedRanges: Array<{ readonly start: number; end: number }> = [];
    let activeRange: { readonly start: number; end: number } | undefined;

    for (let transformIndex = 0; transformIndex < rootTransforms.length; transformIndex += 1) {
      const signatureOffset = transformIndex * (nextStride ?? 0);
      const changed = fullUpload
        || previousSignature === undefined
        || nextStride === undefined
        || !sameGltfModelSignatureRange(previousSignature, nextSignature, signatureOffset, nextStride);
      if (!changed) continue;

      const value = (rootTransforms[transformIndex] ?? IDENTITY_TRANSFORM)[field];
      const offset = transformIndex * 3;
      resource.data[offset] = value[0];
      resource.data[offset + 1] = value[1];
      resource.data[offset + 2] = value[2];
      if (activeRange !== undefined && activeRange.end === transformIndex) {
        activeRange.end = transformIndex + 1;
      } else {
        activeRange = { start: transformIndex, end: transformIndex + 1 };
        changedRanges.push(activeRange);
      }
    }

    if (fullUpload) {
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, resource.data, 0, floatCount);
      this.#recordGltfInstanceRootScaleBufferUpload(floatCount);
      resource.dirty = false;
      resource.signature = copyGltfInstanceSignature(resource.signature, nextSignature);
    } else if (changedRanges.length > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.buffer);
      for (const range of changedRanges) {
        const startFloat = range.start * 3;
        const rangeFloatCount = (range.end - range.start) * 3;
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          startFloat * Float32Array.BYTES_PER_ELEMENT,
          resource.data,
          startFloat,
          rangeFloatCount,
        );
        this.#recordGltfInstanceRootScaleBufferUpload(rangeFloatCount);
      }
      resource.signature = copyGltfInstanceSignature(resource.signature, nextSignature);
    }
  }

  #gltfInstanceBufferResource(
    key: string,
    requiredLocalFloatCount: number,
    requiredRootPoseFloatCount: number,
    requiredRootVectorFloatCount: number,
  ): GltfInstanceBufferResource {
    this.#activeGltfInstanceBufferKeys.add(key);
    const existing = this.#gltfInstanceBuffers.get(key);
    if (
      existing !== undefined
      && existing.localCapacity >= requiredLocalFloatCount
      && existing.rootPose.capacity >= requiredRootPoseFloatCount
      && existing.rootScale.capacity >= requiredRootVectorFloatCount
    ) {
      return existing;
    }

    const gl = this.#gl;
    const localBuffer = existing?.localBuffer ?? this.#createBuffer();
    const localData = new Float32Array(requiredLocalFloatCount);
    if (existing !== undefined) {
      localData.set(existing.localData.subarray(0, Math.min(existing.localData.length, localData.length)));
    }
    const rootPose = createGltfInstanceRootPoseBufferResource(
      gl,
      existing?.rootPose.buffer ?? this.#createBuffer(),
      requiredRootPoseFloatCount,
      existing?.rootPose,
    );
    const rootScale = createGltfInstanceVectorBufferResource(
      gl,
      existing?.rootScale.buffer ?? this.#createBuffer(),
      requiredRootVectorFloatCount,
      existing?.rootScale,
    );

    const resource: GltfInstanceBufferResource = {
      localBuffer,
      localCapacity: requiredLocalFloatCount,
      localData,
      localDirty: true,
      instanceCount: 0,
      rootPose,
      rootScale,
    };
    this.#gltfInstanceBuffers.set(key, resource);

    gl.bindBuffer(gl.ARRAY_BUFFER, localBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, requiredLocalFloatCount * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);
    return resource;
  }

  #releaseUnusedGltfBatchPlans(): void {
    for (const key of this.#gltfBatchPlanCache.keys()) {
      if (!this.#activeGltfBatchPlanCacheKeys.has(key)) this.#gltfBatchPlanCache.delete(key);
    }
  }

  #releaseUnusedGltfInstanceBuffers(): void {
    for (const [key, resource] of this.#gltfInstanceBuffers) {
      if (this.#activeGltfInstanceBufferKeys.has(key)) continue;
      this.#deleteBuffer(resource.localBuffer);
      this.#deleteBuffer(resource.rootPose.buffer);
      this.#deleteBuffer(resource.rootScale.buffer);
      this.#gltfInstanceBuffers.delete(key);
    }
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
    this.#uniform1i(program, "u_texture", textureUnit);
    return true;
  }

  #virtualTextureDrawDemandContext(
    geometry: CpuGeometry | undefined,
    modelSource: VirtualTextureDrawDemandModelSource,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
  ): VirtualTextureDrawDemandContext | undefined {
    if (
      geometry?.texCoords === undefined
      || geometry.mode !== "triangles"
      || this.#virtualTextureDrawDemandModelCount(modelSource) === 0
    ) {
      return undefined;
    }
    return {
      modelSource,
      positions: geometry.positions,
      projection,
      texCoords: geometry.texCoords,
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
    if (geometry?.texCoords === undefined || geometry.mode !== "triangles" || localModels.length === 0) return undefined;
    return this.#virtualTextureDrawDemandContext(
      geometry,
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
    if (material.kind === "wireframe" || geometry.mode !== "triangles" || geometry.texCoordBuffer === undefined) {
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
    if (geometry.mode !== "triangles" || geometry.texCoordBuffer === undefined) {
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
      diagnostics: [],
      diagnosticsEnabled,
      key,
      loadingPages: new Set(),
      pendingUploads: [],
      requestedPages: new Set(),
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
    try {
      const response = await fetch(source.manifestUri);
      if (this.#disposed || this.#virtualTextures.get(state.key) !== state) return;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const payload = await response.json() as unknown;
      if (this.#disposed || this.#virtualTextures.get(state.key) !== state) return;

      const parsed = parseVirtualTextureManifest(payload);
      for (const diagnostic of parsed.diagnostics) {
        const message = `Virtual texture ${source.manifestUri}: ${diagnostic.message}`;
        if (state.diagnosticsEnabled) {
          state.diagnostics.push(message);
          this.#recordDiagnostic(message);
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
      const runtimeUnsupported = this.#unsupportedVirtualTextureRuntimeReason(parsed.manifest);
      if (runtimeUnsupported !== undefined) {
        if (this.#fallbackVirtualTextureSource(state, "runtime-unsupported")) return;
        this.#markVirtualTextureUnsupported(state, runtimeUnsupported);
        return;
      }

      state.manifest = parsed.manifest;
      state.pageUrisByKey = virtualTextureExplicitPageUrisByKey(parsed.manifest);
      this.#allocateVirtualTextureResources(state, parsed.manifest);
      state.status = "ready";
      this.#demandVirtualTexturePages(state);
      this.invalidate();
    } catch (error) {
      if (this.#disposed || this.#virtualTextures.get(state.key) !== state) return;
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
    const unsupported = this.#unsupportedVirtualTextureRuntimeReason(manifest);
    state.manifest = manifest;
    state.pageUrisByKey = new Map();
    if (unsupported !== undefined) {
      this.#markVirtualTextureUnsupported(state, unsupported);
      return;
    }

    this.#allocateVirtualTextureResources(state, manifest);
    state.status = "ready";
    this.#demandVirtualTexturePages(state);
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
    const gl = this.#gl;
    const physicalSlots = this.#virtualTexturePhysicalSlots(manifest);
    const atlasGridColumns = Math.ceil(Math.sqrt(physicalSlots));
    const atlasGridRows = Math.ceil(physicalSlots / atlasGridColumns);
    const pageTableWidth = Math.ceil(manifest.width / manifest.pageSize);
    const pageTableHeight = Math.ceil(manifest.height / manifest.pageSize);
    const atlasTexture = this.#createTexture();
    const pageTableTexture = this.#createTexture();

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

    state.pageTable = new VirtualTextureAtlasPageTable({ slotCount: physicalSlots });
    state.resources = {
      atlasGridColumns,
      atlasGridRows,
      atlasTexture,
      pageTableHeight,
      pageTableTexture,
      pageTableWidth,
    };
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
        const u = context.texCoords[texCoordOffset]!;
        const v = context.texCoords[texCoordOffset + 1]!;
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
    this.#virtualTextureRequestsThisFrame += 1;
    pageImage.then((image) => {
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.status !== "ready"
      ) {
        return;
      }
      state.loadingPages.delete(pageKey);
      state.pendingUploads.push({ image, page, pageKey });
      this.invalidate();
    }, (error: unknown) => {
      if (this.#disposed || this.#virtualTextures.get(state.key) !== state) return;
      state.loadingPages.delete(pageKey);
      const message = `Virtual texture page load failed for ${state.activeSource.manifestUri} ${pageKey}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      if (state.diagnosticsEnabled) {
        state.diagnostics.push(message);
        this.#recordDiagnostic(message);
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
          || state.status !== "ready"
          || state.uploadedPages.has(upload.pageKey)
        ) {
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
      || !this.#ownedTextures.has(resources.atlasTexture)
      || !this.#ownedTextures.has(resources.pageTableTexture)
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
    gl.bindTexture(gl.TEXTURE_2D, resources.atlasTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
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
    if (resources === undefined || pageTable === undefined || !this.#ownedTextures.has(resources.pageTableTexture)) {
      return;
    }

    const gl = this.#gl;
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
    this.#uniform1i(program, "u_vtAtlas", atlasTextureUnit);
    gl.activeTexture(gl.TEXTURE0 + pageTableTextureUnit);
    gl.bindTexture(gl.TEXTURE_2D, resources.pageTableTexture);
    this.#uniform1i(program, "u_vtPageTable", pageTableTextureUnit);
    this.#uniform2fv(program, "u_vtPageTableSize", [resources.pageTableWidth, resources.pageTableHeight]);
    this.#uniform2fv(program, "u_vtAtlasGrid", [resources.atlasGridColumns, resources.atlasGridRows]);
    this.#uniform2fv(program, "u_vtAtlasTexelSize", [
      1 / (resources.atlasGridColumns * manifest.pageSize),
      1 / (resources.atlasGridRows * manifest.pageSize),
    ]);
    this.#uniform1f(program, "u_vtPageSize", manifest.pageSize);
    this.#uniform2fv(program, "u_vtVirtualSize", [manifest.width, manifest.height]);
    this.#uniform1i(program, "u_vtWrapS", this.#virtualTextureWrapMode(state.texture.sampler?.wrapS));
    this.#uniform1i(program, "u_vtWrapT", this.#virtualTextureWrapMode(state.texture.sampler?.wrapT));
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
      state.diagnostics.push(message);
      this.#recordDiagnostic(message);
    }
  }

  #markVirtualTextureUnsupported(state: VirtualTextureRuntimeState, reason: string): void {
    state.status = "unsupported";
    const message = `Virtual texture ${state.activeSource.manifestUri} unsupported: ${reason}. Rendering with material color only.`;
    if (state.diagnosticsEnabled) {
      state.stats.unsupportedDraws += 1;
      state.diagnostics.push(message);
      this.#recordDiagnostic(message);
    }
    this.invalidate();
  }

  #uniformMatrix(program: WebGLProgram, name: string, matrix: Mat4): void {
    if (this.#uniformValueCached(program, name, matrix, 16)) return;
    const location = this.#uniformLocation(program, name);
    if (location !== null) {
      this.#gl.uniformMatrix4fv(location, false, matrix);
      this.#cacheUniformValue(program, name, matrix, 16);
    }
  }

  #uniformColor(program: WebGLProgram, name: string, color: Rgba): void {
    if (this.#uniformValueCached(program, name, color, 4)) return;
    const location = this.#uniformLocation(program, name);
    if (location !== null) {
      this.#gl.uniform4fv(location, color);
      this.#cacheUniformValue(program, name, color, 4);
    }
  }

  #uniform1i(program: WebGLProgram, name: string, value: number): void {
    if (this.#uniformNumberCached(program, name, value)) return;
    const location = this.#uniformLocation(program, name);
    if (location !== null) {
      this.#gl.uniform1i(location, value);
      this.#cacheUniformNumber(program, name, value);
    }
  }

  #uniform1f(program: WebGLProgram, name: string, value: number): void {
    if (this.#uniformNumberCached(program, name, value)) return;
    const location = this.#uniformLocation(program, name);
    if (location !== null) {
      this.#gl.uniform1f(location, value);
      this.#cacheUniformNumber(program, name, value);
    }
  }

  #uniform2fv(program: WebGLProgram, name: string, value: readonly [number, number]): void {
    if (this.#uniformValueCached(program, name, value, 2)) return;
    const location = this.#uniformLocation(program, name);
    if (location !== null) {
      this.#gl.uniform2fv(location, value);
      this.#cacheUniformValue(program, name, value, 2);
    }
  }

  #uniformValueCached(
    program: WebGLProgram,
    name: string,
    value: ArrayLike<number>,
    length: number,
  ): boolean {
    const cached = this.#programUniformValues.get(program)?.get(name);
    if (cached === undefined || cached.length !== length) return false;

    for (let index = 0; index < length; index += 1) {
      if (!Object.is(cached[index], value[index])) return false;
    }

    return true;
  }

  #uniformNumberCached(program: WebGLProgram, name: string, value: number): boolean {
    const cached = this.#programUniformValues.get(program)?.get(name);
    return cached?.length === 1 && Object.is(cached[0], value);
  }

  #cacheUniformValue(
    program: WebGLProgram,
    name: string,
    value: ArrayLike<number>,
    length: number,
  ): void {
    let values = this.#programUniformValues.get(program);
    if (values === undefined) {
      values = new Map();
      this.#programUniformValues.set(program, values);
    }
    values.set(name, Array.from({ length }, (_unused, index) => value[index] as number));
  }

  #cacheUniformNumber(program: WebGLProgram, name: string, value: number): void {
    let values = this.#programUniformValues.get(program);
    if (values === undefined) {
      values = new Map();
      this.#programUniformValues.set(program, values);
    }
    values.set(name, [value]);
  }

  #attribLocation(program: WebGLProgram, name: string): number {
    let locations = this.#programAttributeLocations.get(program);
    if (locations === undefined) {
      locations = new Map();
      this.#programAttributeLocations.set(program, locations);
    }

    const cached = locations.get(name);
    if (cached !== undefined) return cached;

    const location = this.#gl.getAttribLocation(program, name);
    locations.set(name, location);
    return location;
  }

  #uniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    let locations = this.#programUniformLocations.get(program);
    if (locations === undefined) {
      locations = new Map();
      this.#programUniformLocations.set(program, locations);
    }
    if (locations.has(name)) return locations.get(name) ?? null;

    const location = this.#gl.getUniformLocation(program, name);
    locations.set(name, location);
    return location;
  }

  #useProgram(program: WebGLProgram): void {
    if (this.#activeProgram === program) return;
    this.#gl.useProgram(program);
    this.#activeProgram = program;
  }

  #vertexAttrib2f(location: number, x: number, y: number): void {
    const cached = this.#vertexAttribDefaults.get(location);
    if (cached?.size === 2 && Object.is(cached.x, x) && Object.is(cached.y, y)) return;

    this.#gl.vertexAttrib2f(location, x, y);
    this.#vertexAttribDefaults.set(location, { size: 2, x, y });
  }

  #vertexAttrib4f(location: number, x: number, y: number, z: number, w: number): void {
    const cached = this.#vertexAttribDefaults.get(location);
    if (
      cached?.size === 4
      && Object.is(cached.x, x)
      && Object.is(cached.y, y)
      && Object.is(cached.z, z)
      && Object.is(cached.w, w)
    ) {
      return;
    }

    this.#gl.vertexAttrib4f(location, x, y, z, w);
    this.#vertexAttribDefaults.set(location, { size: 4, w, x, y, z });
  }

  #program(kind: ProgramKind, features?: SurfaceShaderFeatures): ProgramResource {
    const key = features === undefined ? kind : `${kind}:${surfaceShaderFeatureKey(features)}`;
    const cached = this.#programs.get(key);
    if (cached !== undefined) return cached;

    const program = this.#compileProgram(kind, features);
    this.#programs.set(key, program);
    return program;
  }

  #compileProgram(kind: ProgramKind, features?: SurfaceShaderFeatures): ProgramResource {
    const gl = this.#gl;
    const program = gl.createProgram();
    if (program === null) throw new Error("WebGL program creation failed");
    this.#ownedPrograms.add(program);

    let vertexShader: WebGLShader | undefined;
    let fragmentShader: WebGLShader | undefined;

    try {
      vertexShader = this.#compileShader(gl.VERTEX_SHADER, vertexShaderSource(kind));
      fragmentShader = this.#compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource(kind, features));
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.bindAttribLocation?.(program, 0, "a_position");
      gl.bindAttribLocation?.(program, 1, "a_normal");
      gl.bindAttribLocation?.(program, 2, "a_uv");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`WebGL program link failed: ${gl.getProgramInfoLog(program) ?? "unknown link error"}`);
      }

      return { fragmentShader, program, vertexShader };
    } catch (error) {
      if (vertexShader !== undefined) this.#deleteShader(vertexShader);
      if (fragmentShader !== undefined) this.#deleteShader(fragmentShader);
      this.#deleteProgram(program);
      throw error;
    }
  }

  #compileShader(type: number, source: string): WebGLShader {
    const gl = this.#gl;
    const shader = gl.createShader(type);
    if (shader === null) throw new Error("WebGL shader creation failed");
    this.#ownedShaders.add(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? "unknown compile error";
      this.#deleteShader(shader);
      throw new Error(`WebGL shader compile failed: ${info}`);
    }

    return shader;
  }



  #meshGeometry(geometry: MeshNode["geometry"], material: Material): CpuGeometry {
    if (material.kind === "wireframe") return this.#wireGeometry(geometry);

    switch (geometry.kind) {
      case "box":
        return this.#boxGeometry(geometry as BoxGeometry);
      case "plane":
        return this.#planeGeometry(geometry as PlaneGeometry);
      default:
        throw new Error(`Unsupported geometry kind "${geometry.kind}"`);
    }
  }

  #wireGeometry(geometry: MeshNode["geometry"]): CpuGeometry {
    if (geometry.kind === "plane") {
      const plane = geometry as PlaneGeometry;
      const [width, height] = plane.size;
      const x = width / 2;
      const y = height / 2;
      return {
        indices: new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]),
        key: `wire:plane:${width},${height}`,
        mode: "lines",
        positions: new Float32Array([
          -x, -y, 0,
          x, -y, 0,
          x, y, 0,
          -x, y, 0,
        ]),
        texCoords: new Float32Array([
          0, 0,
          1, 0,
          1, 1,
          0, 1,
        ]),
      };
    }
    if (geometry.kind === "box") {
      const box = geometry as BoxGeometry;
      const [width, height, depth] = box.size;
      const x = width / 2;
      const y = height / 2;
      const z = depth / 2;
      return {
        indices: new Uint16Array([
          0, 1, 1, 2, 2, 3, 3, 0,
          4, 5, 5, 6, 6, 7, 7, 4,
          0, 4, 1, 5, 2, 6, 3, 7,
        ]),
        key: `wire:box:${width},${height},${depth}`,
        mode: "lines",
        positions: new Float32Array([
          -x, -y, z,
          x, -y, z,
          x, y, z,
          -x, y, z,
          -x, -y, -z,
          x, -y, -z,
          x, y, -z,
          -x, y, -z,
        ]),
      };
    }

    throw new Error(`Unsupported geometry kind "${geometry.kind}"`);
  }

  #planeGeometry(geometry: PlaneGeometry): CpuGeometry {
    const [width, height] = geometry.size;
    const x = width / 2;
    const y = height / 2;
    return {
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        key: `plane:${width},${height}`,
        mode: "triangles",
        normals: new Float32Array([
          0, 0, 1,
          0, 0, 1,
          0, 0, 1,
          0, 0, 1,
        ]),
        positions: new Float32Array([
          -x, -y, 0,
          x, -y, 0,
          x, y, 0,
          -x, y, 0,
        ]),
        texCoords: new Float32Array([
          0, 0,
          1, 0,
          1, 1,
          0, 1,
        ]),
      };
  }

  #boxGeometry(geometry: BoxGeometry): CpuGeometry {
    const [width, height, depth] = geometry.size;
    const x = width / 2;
    const y = height / 2;
    const z = depth / 2;
    return {
      indices: new Uint16Array([
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11,
        12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19,
        20, 21, 22, 20, 22, 23,
      ]),
      key: `box:${width},${height},${depth}`,
      mode: "triangles",
      normals: new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
        -1, 0, 0,
        -1, 0, 0,
        -1, 0, 0,
        -1, 0, 0,
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, -1, 0,
        0, -1, 0,
        0, -1, 0,
        0, -1, 0,
      ]),
      positions: new Float32Array([
        -x, -y, z,
        x, -y, z,
        x, y, z,
        -x, y, z,
        x, -y, -z,
        -x, -y, -z,
        -x, y, -z,
        x, y, -z,
        -x, -y, -z,
        -x, -y, z,
        -x, y, z,
        -x, y, -z,
        x, -y, z,
        x, -y, -z,
        x, y, -z,
        x, y, z,
        -x, y, z,
        x, y, z,
        x, y, -z,
        -x, y, -z,
        -x, -y, -z,
        x, -y, -z,
        x, -y, z,
        -x, -y, z,
      ]),
      texCoords: new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
      ]),
    };
  }

  #isVisible(
    positions: Float32Array,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
  ): boolean {
    if (positions.length === 0) return false;

    const mvp = multiplyMat4(projection, multiplyMat4(view, model));
    const outside = [true, true, true, true, true, true];
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index]!;
      const y = positions[index + 1]!;
      const z = positions[index + 2]!;
      const clipX = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
      const clipY = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
      const clipZ = mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14];
      const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      outside[0] &&= clipX < -clipW;
      outside[1] &&= clipX > clipW;
      outside[2] &&= clipY < -clipW;
      outside[3] &&= clipY > clipW;
      outside[4] &&= clipZ < -clipW;
      outside[5] &&= clipZ > clipW;
    }

    return !outside.some(Boolean);
  }

  #geometryResource(cpu: CpuGeometry): GeometryResource {
    const cached = this.#geometry.get(cpu.key);
    if (cached !== undefined) return cached;

    const gl = this.#gl;
    gl.bindVertexArray(null);
    const borrowedVertexResource = cpu.vertexBufferKey === undefined
      ? undefined
      : this.#geometry.get(cpu.vertexBufferKey);
    const arrayBuffer = borrowedVertexResource?.arrayBuffer ?? this.#createBuffer();
    if (borrowedVertexResource === undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, arrayBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.positions, gl.STATIC_DRAW);
    }

    let normalBuffer: WebGLBuffer | undefined;
    if (borrowedVertexResource !== undefined) {
      normalBuffer = borrowedVertexResource.normalBuffer;
    } else if (cpu.normals !== undefined) {
      normalBuffer = this.#createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.normals, gl.STATIC_DRAW);
    }

    let texCoordBuffer: WebGLBuffer | undefined;
    if (borrowedVertexResource !== undefined) {
      texCoordBuffer = borrowedVertexResource.texCoordBuffer;
    } else if (cpu.texCoords !== undefined) {
      texCoordBuffer = this.#createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.texCoords, gl.STATIC_DRAW);
    }

    let emissiveTexCoordBuffer: WebGLBuffer | undefined;
    if (borrowedVertexResource !== undefined) {
      emissiveTexCoordBuffer = borrowedVertexResource.emissiveTexCoordBuffer;
    } else if (cpu.emissiveTexCoords !== undefined) {
      emissiveTexCoordBuffer = this.#createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, emissiveTexCoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.emissiveTexCoords, gl.STATIC_DRAW);
    } else {
      emissiveTexCoordBuffer = texCoordBuffer;
    }

    let tangentBuffer: WebGLBuffer | undefined;
    if (borrowedVertexResource !== undefined) {
      tangentBuffer = borrowedVertexResource.tangentBuffer;
    } else if (cpu.tangents !== undefined) {
      tangentBuffer = this.#createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, tangentBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.tangents, gl.STATIC_DRAW);
    }

    let colorBuffer: WebGLBuffer | undefined;
    if (borrowedVertexResource !== undefined) {
      colorBuffer = borrowedVertexResource.colorBuffer;
    } else if (cpu.colors !== undefined) {
      colorBuffer = this.#createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.colors, gl.STATIC_DRAW);
    }

    let indexBuffer: WebGLBuffer | undefined;
    let indexType: number | undefined;
    if (cpu.indices !== undefined) {
      indexBuffer = this.#createBuffer();
      indexType = cpu.indices instanceof Uint32Array
        ? gl.UNSIGNED_INT
        : cpu.indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cpu.indices, gl.STATIC_DRAW);
    }

    const resource: GeometryResource = {
      arrayBuffer,
      ...(borrowedVertexResource === undefined ? {} : { borrowedVertexBufferKey: borrowedVertexResource.key }),
      ...(colorBuffer === undefined ? {} : { colorBuffer }),
      drawCount: cpu.indices?.length ?? cpu.positions.length / 3,
      ...(emissiveTexCoordBuffer === undefined ? {} : { emissiveTexCoordBuffer }),
      ...(indexBuffer === undefined ? {} : { indexBuffer }),
      ...(indexType === undefined ? {} : { indexType }),
      key: cpu.key,
      mode: cpu.mode,
      ...(normalBuffer === undefined ? {} : { normalBuffer }),
      ...(tangentBuffer === undefined ? {} : { tangentBuffer }),
      ...(texCoordBuffer === undefined ? {} : { texCoordBuffer }),
      vertexArrays: new Map(),
    };
    this.#geometry.set(cpu.key, resource);
    return resource;
  }

  #releaseUnusedGeometry(used: Set<string>): void {
    for (const [key, resource] of this.#geometry) {
      if (used.has(key)) continue;
      this.#deleteGeometryVertexArrays(resource);
      if (resource.borrowedVertexBufferKey === undefined) {
        this.#deleteBuffer(resource.arrayBuffer);
        if (resource.colorBuffer !== undefined) this.#deleteBuffer(resource.colorBuffer);
        if (
          resource.emissiveTexCoordBuffer !== undefined
          && resource.emissiveTexCoordBuffer !== resource.texCoordBuffer
        ) this.#deleteBuffer(resource.emissiveTexCoordBuffer);
        if (resource.normalBuffer !== undefined) this.#deleteBuffer(resource.normalBuffer);
        if (resource.tangentBuffer !== undefined) this.#deleteBuffer(resource.tangentBuffer);
        if (resource.texCoordBuffer !== undefined) this.#deleteBuffer(resource.texCoordBuffer);
      }
      if (resource.indexBuffer !== undefined) this.#deleteBuffer(resource.indexBuffer);
      this.#geometry.delete(key);
    }
  }

  #deleteGeometryVertexArrays(resource: GeometryResource): void {
    for (const vertexArrays of resource.vertexArrays.values()) {
      if (vertexArrays.base !== undefined) this.#deleteVertexArray(vertexArrays.base);
      for (const vertexArray of vertexArrays.instanced.values()) this.#deleteVertexArray(vertexArray);
    }
    resource.vertexArrays.clear();
  }

  #queueTextureUpload(
    resource: TextureResource,
    source: LoadedTextureSource,
    texture: TextureAssetUploadRef,
  ): void {
    if (this.#disposed || resource.uploaded || !this.#ownedTextures.has(resource.texture)) return;
    if (resource.pendingUpload !== undefined) return;

    resource.pendingUpload = { source, texture };
    this.#pendingTextureUploads.push(resource);
    this.invalidate();
  }

  #canUploadTexture(): boolean {
    if (this.#textureUploadFrame !== this.#frame) {
      this.#textureUploadFrame = this.#frame;
      this.#textureUploadsThisFrame = 0;
    }
    return this.#textureUploadsThisFrame < TEXTURE_MAX_UPLOADS_PER_FRAME;
  }

  #processTextureUploads(): void {
    while (this.#textureUploadHead < this.#pendingTextureUploads.length && this.#canUploadTexture()) {
      const resource = this.#pendingTextureUploads[this.#textureUploadHead];
      this.#textureUploadHead += 1;
      if (resource === undefined) continue;
      const pending = resource.pendingUpload;
      if (pending === undefined) continue;
      if (
        this.#disposed
        || this.#textures.get(resource.key) !== resource
        || resource.uploaded
        || !this.#ownedTextures.has(resource.texture)
      ) {
        delete resource.pendingUpload;
        continue;
      }

      this.#uploadTexture(resource, pending.source, pending.texture);
      delete resource.pendingUpload;
      resource.uploaded = true;
      this.#textureUploadsThisFrame += 1;
    }
    if (this.#textureUploadHead >= this.#pendingTextureUploads.length) {
      this.#pendingTextureUploads.length = 0;
      this.#textureUploadHead = 0;
    }
  }

  #hasPendingTextureUploads(): boolean {
    return this.#textureUploadHead < this.#pendingTextureUploads.length;
  }

  #texture(texture: TextureAssetUploadRef): TextureResource | TextureLoadState {
    const key = textureCacheKey(texture);
    const cached = this.#textures.get(key);
    if (cached !== undefined) return cached;

    const glTexture = this.#createTexture();
    const state: TextureLoadState = {
      key,
      loading: true,
      texture: glTexture,
      uploaded: false,
    };
    this.#textures.set(key, state);

    const imageSource = isSvgUri(texture.uri)
      ? loadSvgUriImageSource(texture.uri)
        .then((loadedImage) => loadedImage.image)
      : loadImage(texture.uri);

    imageSource.then((image) => {
      if (this.#disposed) return;
      if (state.uploaded) return;
      state.loading = false;
      this.#registerAutoBaseColorVirtualTextureDecodedPageSource(texture, image);
      this.#queueTextureUpload(state, image, texture);
    }, (error: unknown) => {
      if (this.#disposed) return;
      if (state.uploaded) return;
      state.loading = false;
      state.error = `Texture image load failed for ${texture.uri}: ${error instanceof Error ? error.message : String(error)}`;
      this.#recordDiagnostic(state.error);
    });

    return state;
  }

  #settleDecodedTextureSource(texture: TextureAssetUploadRef | undefined, image: LoadedTextureSource): void {
    if (texture === undefined) return;
    const key = textureCacheKey(texture);
    const cached = this.#textures.get(key);
    if (cached !== undefined && cached.uploaded) return;

    const resource: TextureResource | TextureLoadState = cached ?? {
      key,
      texture: this.#createTexture(),
      uploaded: false,
    };
    this.#textures.set(key, resource);
    this.#registerAutoBaseColorVirtualTextureDecodedPageSource(texture, image);
    this.#queueTextureUpload(resource, image, texture);
    if ("loading" in resource) resource.loading = false;
  }

  #iblSpecularTextureContext(): IblSpecularTextureContext {
    return {
      createTexture: () => this.#createTexture(),
      gl: this.#gl,
      isDisposed: () => this.#disposed,
      isTextureOwned: (texture) => this.#ownedTextures.has(texture),
      recordUnsupportedGltfImageBasedLight: (message) => this.#recordUnsupportedGltfImageBasedLight(message),
      textures: this.#iblSpecularTextures,
    };
  }

  #ensureIblSpecularTexture(specular: SurfaceImageBasedLightSpecular): IblSpecularTextureResource {
    return ensureIblSpecularTexture(this.#iblSpecularTextureContext(), specular);
  }

  #settleIblSpecularImage(
    specular: SurfaceImageBasedLightSpecular,
    key: string,
    image: LoadedTextureSource,
  ): void {
    settleIblSpecularImage(this.#iblSpecularTextureContext(), specular, key, image);
  }

  #iblBrdfLutTextureResource(textureUnit: number): WebGLTexture {
    if (this.#iblBrdfLutTexture !== undefined) return this.#iblBrdfLutTexture;

    const texture = createIblBrdfLutTexture({
      createTexture: () => this.#createTexture(),
      gl: this.#gl,
      textureUnit,
    });
    this.#iblBrdfLutTexture = texture;

    return texture;
  }

  #studioEnvironmentSpecularTexture(): StudioEnvironmentSpecularResource {
    const cached = this.#studioEnvironmentSpecularTextures.get(STUDIO_ENVIRONMENT_SPECULAR_KEY);
    if (cached !== undefined) return cached;

    const resource = createStudioEnvironmentSpecularTexture({
      createTexture: () => this.#createTexture(),
      gl: this.#gl,
    });
    this.#studioEnvironmentSpecularTextures.set(STUDIO_ENVIRONMENT_SPECULAR_KEY, resource);

    return resource;
  }

  #copyTransmissionScreenColorTexture(viewportSize: ViewportSize): ScreenColorTextureResource {
    const [width, height] = viewportSize;
    const resource = this.#transmissionScreenColorTextureResource();
    const gl = this.#gl;
    const needsAllocation = !resource.uploaded || resource.width !== width || resource.height !== height;

    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    if (needsAllocation) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
    resource.width = width;
    resource.height = height;
    resource.uploaded = true;

    return resource;
  }

  #transmissionScreenColorTextureResource(): ScreenColorTextureResource {
    if (this.#transmissionScreenColorTexture !== undefined) return this.#transmissionScreenColorTexture;

    const gl = this.#gl;
    const texture = this.#createTexture();
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.#transmissionScreenColorTexture = {
      height: 0,
      texture,
      uploaded: false,
      width: 0,
    };
    return this.#transmissionScreenColorTexture;
  }

  #uploadTexture(
    resource: TextureResource,
    source: LoadedTextureSource,
    texture: TextureAssetUploadRef,
  ): void {
    if (this.#disposed || !this.#ownedTextures.has(resource.texture)) return;

    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY ?? true);
    disableBrowserUnpackColorConversion(gl);
    const internalFormat = textureUploadInternalFormat(gl, texture.colorSpace);
    if (isDecodedRgbaTexture(source)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    const sampler = texture.sampler;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, samplerConstant(gl, sampler?.magFilter, gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, samplerConstant(gl, sampler?.minFilter, gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, samplerConstant(gl, sampler?.wrapS, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, samplerConstant(gl, sampler?.wrapT, gl.CLAMP_TO_EDGE));
    if (usesMipmaps(sampler?.minFilter)) gl.generateMipmap(gl.TEXTURE_2D);
  }

  #gltfState(node: GltfNode): GltfState {
    const key = `gltf:${node.asset.uri}:${node.asset.version ?? ""}`;
    const cached = this.#gltf.get(key);
    if (cached !== undefined) return cached;

    const state: GltfState = {
      animations: [],
      hasMaterialVariants: false,
      hasNodeLod: false,
      instanceKey: this.#gltfStateInstanceKey,
      key,
      lights: [],
      load: {
        imageFailures: 0,
        imageLoaded: 0,
        imageRequests: 0,
        startedAt: nowMs(),
      },
      nodes: [],
      primitives: [],
      status: "loading",
      variants: [],
    };
    this.#gltfStateInstanceKey += 1;
    this.#gltf.set(key, state);

    void this.#loadGltf(node.src, state);
    return state;
  }

  async #loadGltf(src: string, state: GltfState): Promise<void> {
    try {
      const { binaryChunk, document } = await loadGltfDocument(src);
      state.load.documentLoadedAt = nowMs();
      if (this.#disposed) return;
      assertSupportedRequiredGltfExtensions(src, document);
      if (this.#disposed) return;
      const loadedBuffers = await loadGltfBuffers(src, document, binaryChunk);
      state.load.buffersLoadedAt = nowMs();
      if (this.#disposed) return;
      const { buffers, document: decodedDocument } = await decodeGltfMeshoptBufferViews(document, loadedBuffers);
      state.load.meshoptDecodedAt = nowMs();
      if (this.#disposed) return;
      const dracoPrimitives = decodeGltfDracoPrimitives(decodedDocument, buffers);
      state.load.dracoDecodedAt = nowMs();
      if (this.#disposed) return;
      const scene = this.#readGltfScene(decodedDocument, buffers, dracoPrimitives, src, state.key);
      state.load.sceneReadAt = nowMs();
      if (scene.imageBasedLight === undefined) {
        delete state.imageBasedLight;
      } else {
        state.imageBasedLight = scene.imageBasedLight;
      }
      state.animations = readGltfAnimationClips(decodedDocument, buffers);
      state.load.animationsReadAt = nowMs();
      state.hasMaterialVariants = scene.hasMaterialVariants;
      state.hasNodeLod = scene.hasNodeLod;
      state.lights = scene.lights;
      state.nodes = decodedDocument.nodes ?? [];
      state.primitives = scene.primitives;
      state.variants = scene.variants;
      state.status = "ready";
      state.load.readyAt = nowMs();
      this.invalidate();
      this.#loadGltfImages(src, decodedDocument, buffers, state);
    } catch (error) {
      if (this.#disposed) return;
      state.status = "error";
      state.load.readyAt = nowMs();
      state.error = `glTF load failed for ${src}: ${error instanceof Error ? error.message : String(error)}`;
      this.#recordDiagnostic(state.error);
    }
  }

  #readGltfScene(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    dracoPrimitives: ReadonlyMap<GltfMeshPrimitive, DecodedGltfDracoPrimitive>,
    src: string,
    assetKey: string,
  ): {
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
      hasMaterialVariants: primitives.some((primitive) => primitive.materialVariants !== undefined),
      hasNodeLod: primitives.some((primitive) => primitive.nodeLod !== undefined),
      ...(imageBasedLight === undefined ? {} : { imageBasedLight }),
      lights,
      primitives,
      variants,
    };
  }

  #recordUnsupportedGltfImageBasedLight(message: string): void {
    if (this.#unsupportedGltfImageBasedLightDiagnostics.has(message)) return;

    this.#unsupportedGltfImageBasedLightDiagnostics.add(message);
    this.#recordDiagnostic(message);
  }

  #recordUnsupportedGltfAnimation(message: string): void {
    if (this.#unsupportedGltfAnimationDiagnostics.has(message)) return;

    this.#unsupportedGltfAnimationDiagnostics.add(message);
    this.#recordDiagnostic(message);
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
        this.#recordDiagnostic(`glTF primitive ${nodeIndex}:${primitiveIndex} skipped: unsupported primitive mode ${primitive.mode ?? 4}`);
        continue;
      }
      const baseNormals = decodedAttributes?.get("NORMAL")
        ?? (normalAccessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, normalAccessor));
      const baseTangents = decodedAttributes?.get("TANGENT")
        ?? (tangentAccessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, tangentAccessor));
      const morphed = applyGltfMorphTargets(
        document,
        buffers,
        primitive,
        gltfMorphWeights(mesh, sceneNode),
        {
          ...(baseNormals === undefined ? {} : { normals: baseNormals }),
          positions,
          ...(baseTangents === undefined ? {} : { tangents: baseTangents }),
        },
      );
      const colors = gltfVertexColors(document, buffers, primitive, morphed.positions, decodedAttributes);
      const indices = dracoPrimitive?.indices
        ?? (indexAccessor === undefined ? undefined : readGltfIndices(document, buffers, indexAccessor));
      const material = this.#readGltfMaterial(
        document,
        buffers,
        src,
        assetKey,
        primitive.material,
        primitive,
        decodedAttributes,
      );
      const materialLod = this.#readGltfMaterialLod(
        document,
        buffers,
        src,
        assetKey,
        primitive.material,
        primitive,
        decodedAttributes,
      );
      const materialVariants = this.#readGltfMaterialVariants(
        document,
        buffers,
        src,
        assetKey,
        primitive,
        variantCount,
        decodedAttributes,
      );
      const baseMaterial = loadedGltfPrimitiveBaseMaterial(material, materialLod);
      const key = `node:${nodeIndex}:primitive:${primitiveIndex}`;
      primitives.push({
        baseMaterial,
        ...(colors === undefined ? {} : { colors }),
        ...(indices === undefined ? {} : { indices }),
        instanceTransforms,
        key,
        localBounds: localModels.map((localModel) => worldBounds(morphed.positions, localModel)),
        localModelDeterminants,
        localModels,
        material,
        ...(materialLod === undefined ? {} : { materialLod }),
        ...(materialVariants.length === 0 ? {} : { materialVariants }),
        mode,
        nodePath,
        ...(nodeLod === undefined ? {} : { nodeLod }),
        ...(morphed.normals === undefined ? {} : { normals: morphed.normals }),
        positions: morphed.positions,
        ...(morphed.tangents === undefined ? {} : { tangents: morphed.tangents }),
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
    const attributeEntries = Object.entries(attributes)
      .filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] >= 0);
    const counts = attributeEntries
      .map(([, accessorIndex]) => gltfInstancingAttributeCount(document, accessorIndex))
      .filter((count): count is number => count !== undefined && Number.isFinite(count));
    if (counts.length === 0) {
      this.#recordDiagnostic(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing skipped: no instance attribute accessors`);
      return [];
    }

    const instanceCount = Math.min(...counts);
    if (new Set(counts).size > 1) {
      this.#recordDiagnostic(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing has mismatched attribute counts; using ${instanceCount} instances`);
    }

    const unsupportedSemantics = attributeEntries
      .map(([semantic]) => semantic)
      .filter((semantic) => !supportedSemantics.has(semantic));
    if (unsupportedSemantics.length > 0) {
      this.#recordDiagnostic(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ignored custom attributes: ${unsupportedSemantics.join(", ")}`);
    }

    const translations = attributes.TRANSLATION === undefined
      ? undefined
      : readGltfFloatAccessor(document, buffers, attributes.TRANSLATION);
    const rotations = attributes.ROTATION === undefined
      ? undefined
      : readGltfFloatAccessor(document, buffers, attributes.ROTATION);
    const scales = attributes.SCALE === undefined
      ? undefined
      : readGltfFloatAccessor(document, buffers, attributes.SCALE);

    return Array.from({ length: instanceCount }, (_, index) =>
      gltfInstanceTransformMat4(translations, rotations, scales, index));
  }

  #readGltfMaterialVariants(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    src: string,
    assetKey: string,
    primitive: GltfMeshPrimitive,
    variantCount: number,
    decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
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
          buffers,
          src,
          assetKey,
          materialIndex,
          primitive,
          decodedAttributes,
        );
        const materialLod = this.#readGltfMaterialLod(
          document,
          buffers,
          src,
          assetKey,
          materialIndex,
          primitive,
          decodedAttributes,
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
    if (this.#unsupportedGltfMaterialExtensionDiagnostics.has(message)) return;

    this.#unsupportedGltfMaterialExtensionDiagnostics.add(message);
    this.#recordDiagnostic(message);
  }

  #readGltfMaterial(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    src: string,
    assetKey: string,
    materialIndex: number | undefined,
    primitive: GltfMeshPrimitive,
    decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
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
    const texCoords = gltfTextureInfoTexCoords(
      document,
      buffers,
      primitive,
      gltfMaterialPrimaryTextureInfo(document, materialIndex),
      decodedAttributes,
    );
    const emissiveTexCoords = gltfTextureInfoTexCoords(
      document,
      buffers,
      primitive,
      material?.emissiveTexture,
      decodedAttributes,
    );

    return {
      alphaMode,
      ...(alphaMode === "MASK" ? { alphaCutoff } : {}),
      ...(baseColorTextureSlot?.contentKey === undefined ? {} : { baseColorContentKey: baseColorTextureSlot.contentKey }),
      ...(baseColorTextureSlot?.imageUri === undefined ? {} : { baseColorImageUri: baseColorTextureSlot.imageUri }),
      ...(baseColorTextureSlot?.sourceUri === undefined ? {} : { baseColorSourceUri: baseColorTextureSlot.sourceUri }),
      ...(baseColorTextureSlot?.textureUri === undefined
        ? {}
        : { baseColorTextureUri: baseColorTextureSlot.textureUri }),
      ...(metallicRoughnessTextureSlot?.contentKey === undefined
        ? {}
        : { metallicRoughnessContentKey: metallicRoughnessTextureSlot.contentKey }),
      ...(metallicRoughnessTextureSlot?.imageUri === undefined
        ? {}
        : { metallicRoughnessImageUri: metallicRoughnessTextureSlot.imageUri }),
      ...(metallicRoughnessTextureSlot?.sourceUri === undefined
        ? {}
        : { metallicRoughnessSourceUri: metallicRoughnessTextureSlot.sourceUri }),
      ...(metallicRoughnessTextureSlot?.textureUri === undefined
        ? {}
        : { metallicRoughnessTextureUri: metallicRoughnessTextureSlot.textureUri }),
      ...(normalTextureSlot?.contentKey === undefined ? {} : { normalContentKey: normalTextureSlot.contentKey }),
      ...(normalTextureSlot?.imageUri === undefined ? {} : { normalImageUri: normalTextureSlot.imageUri }),
      ...(normalTextureSlot?.sourceUri === undefined ? {} : { normalSourceUri: normalTextureSlot.sourceUri }),
      ...(normalTextureSlot?.textureUri === undefined ? {} : { normalTextureUri: normalTextureSlot.textureUri }),
      ...(emissiveTextureSlot?.contentKey === undefined ? {} : { emissiveContentKey: emissiveTextureSlot.contentKey }),
      ...(emissiveTextureSlot?.imageUri === undefined ? {} : { emissiveImageUri: emissiveTextureSlot.imageUri }),
      ...(emissiveTextureSlot?.sourceUri === undefined ? {} : { emissiveSourceUri: emissiveTextureSlot.sourceUri }),
      ...(emissiveTextureSlot?.textureUri === undefined
        ? {}
        : { emissiveTextureUri: emissiveTextureSlot.textureUri }),
      ...(occlusionTextureSlot?.contentKey === undefined ? {} : { occlusionContentKey: occlusionTextureSlot.contentKey }),
      ...(occlusionTextureSlot?.imageUri === undefined ? {} : { occlusionImageUri: occlusionTextureSlot.imageUri }),
      ...(occlusionTextureSlot?.sourceUri === undefined ? {} : { occlusionSourceUri: occlusionTextureSlot.sourceUri }),
      ...(occlusionTextureSlot?.textureUri === undefined
        ? {}
        : { occlusionTextureUri: occlusionTextureSlot.textureUri }),
      ...(color === undefined ? {} : { color }),
      ...(emissive === undefined ? {} : { emissive }),
      ...(emissiveTexCoords === undefined ? {} : { emissiveTexCoords }),
      ...(extensionFactors === undefined ? {} : { extensionFactors }),
      ...(extensionTextures === undefined ? {} : { extensionTextures }),
      doubleSided: material?.doubleSided === true,
      metallicFactor,
      normalScale: material?.normalTexture?.scale ?? 1,
      occlusionStrength,
      roughnessFactor,
      ...(emissiveTextureSlot?.sampler === undefined ? {} : { emissiveSampler: emissiveTextureSlot.sampler }),
      ...(metallicRoughnessTextureSlot?.sampler === undefined
        ? {}
        : { metallicRoughnessSampler: metallicRoughnessTextureSlot.sampler }),
      ...(normalTextureSlot?.sampler === undefined ? {} : { normalSampler: normalTextureSlot.sampler }),
      ...(occlusionTextureSlot?.sampler === undefined ? {} : { occlusionSampler: occlusionTextureSlot.sampler }),
      ...(baseColorTextureSlot?.sampler === undefined ? {} : { sampler: baseColorTextureSlot.sampler }),
      ...(texCoords === undefined ? {} : { texCoords }),
      ...(material?.extensions?.KHR_materials_unlit === undefined ? {} : { unlit: true }),
    };
  }

  #readGltfMaterialLod(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    src: string,
    assetKey: string,
    materialIndex: number | undefined,
    primitive: GltfMeshPrimitive,
    decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
  ): GltfMaterialPrimitiveLod | undefined {
    const material = materialIndex === undefined ? undefined : document.materials?.[materialIndex];
    const lodIds = (material?.extensions?.MSFT_lod?.ids ?? [])
      .filter((id) => Number.isInteger(id) && id >= 0 && document.materials?.[id] !== undefined);
    if (materialIndex === undefined || lodIds.length === 0) return undefined;

    const levels = [
      this.#readGltfMaterial(document, buffers, src, assetKey, materialIndex, primitive, decodedAttributes),
      ...lodIds.map((id) =>
        this.#readGltfMaterial(document, buffers, src, assetKey, id, primitive, decodedAttributes)),
    ];

    return {
      levels,
      thresholds: gltfLodThresholds(material?.extras, levels.length),
    };
  }

  #loadGltfImages(
    src: string,
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    state: GltfState,
  ): void {
    const usedImageKeys = this.#usedGltfImageLoadKeys(state);
    const startedImageKeys = new Set<string>();
    for (const [imageIndex, image] of (document.images ?? []).entries()) {
      for (const kind of ["image", "basisu", "svg"] as const) {
        const key = gltfImageLoadKey(state.key, src, imageIndex, image, kind);
        if (key === undefined) continue;
        if (!usedImageKeys.has(key)) continue;
        if (startedImageKeys.has(key)) continue;
        startedImageKeys.add(key);
        this.#recordGltfImageLoadStarted(state);
        loadGltfImageSource(src, document, buffers, image, kind).then((loadedImage) => {
          if (this.#disposed || state.status !== "ready") return;
          this.#recordGltfImageLoadSettled(state, false);
          state.primitives = state.primitives.map((primitive) =>
            this.#mapGltfPrimitiveMaterials(primitive, (material) =>
              this.#settleGltfMaterialImage(material, key, loadedImage)));
          if (kind === "image" && state.imageBasedLight?.specular !== undefined) {
            this.#settleIblSpecularImage(state.imageBasedLight.specular, key, loadedImage.image);
          }
          this.invalidate();
        }, (error: unknown) => {
          if (this.#disposed) return;
          this.#recordGltfImageLoadSettled(state, true);
          if (state.status === "ready") {
            state.primitives = state.primitives.map((primitive) =>
              this.#mapGltfPrimitiveMaterials(primitive, (material) =>
                this.#failGltfMaterialImage(material, key)));
            this.invalidate();
          }
          this.#recordDiagnostic(`glTF image load failed for ${key}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
    if (state.load.imageRequests === 0) state.load.imagesSettledAt = nowMs();
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
    if (material.baseColorImageUri !== undefined) keys.add(material.baseColorImageUri);
    if (material.emissiveImageUri !== undefined) keys.add(material.emissiveImageUri);
    if (material.metallicRoughnessImageUri !== undefined) keys.add(material.metallicRoughnessImageUri);
    if (material.normalImageUri !== undefined) keys.add(material.normalImageUri);
    if (material.occlusionImageUri !== undefined) keys.add(material.occlusionImageUri);
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

  #mapGltfPrimitiveMaterials(
    primitive: LoadedGltfPrimitive,
    mapMaterial: (material: LoadedGltfMaterial) => LoadedGltfMaterial,
  ): LoadedGltfPrimitive {
    const material = mapMaterial(primitive.material);
    const materialLod = primitive.materialLod === undefined
      ? undefined
      : {
        ...primitive.materialLod,
        levels: primitive.materialLod.levels.map(mapMaterial),
      };
    return {
      ...primitive,
      baseMaterial: loadedGltfPrimitiveBaseMaterial(material, materialLod),
      material,
      ...(materialLod === undefined ? {} : { materialLod }),
      ...(primitive.materialVariants === undefined
        ? {}
        : {
          materialVariants: primitive.materialVariants.map((variant) => ({
            ...variant,
            material: mapMaterial(variant.material),
            ...(variant.materialLod === undefined
              ? {}
              : {
                materialLod: {
                  ...variant.materialLod,
                  levels: variant.materialLod.levels.map(mapMaterial),
                },
              }),
          })),
        }),
    };
  }

  #settleGltfMaterialImage(
    material: LoadedGltfMaterial,
    uri: string,
    loadedImage: LoadedGltfImageSource,
  ): LoadedGltfMaterial {
    const image = loadedImage.image;
    const computedContentKey = loadedImage.contentKey;
    const baseColorContentKey = material.baseColorContentKey ?? (
      material.baseColorImageUri === uri ? computedContentKey : undefined
    );
    const emissiveContentKey = material.emissiveContentKey ?? (
      material.emissiveImageUri === uri ? computedContentKey : undefined
    );
    const metallicRoughnessContentKey = material.metallicRoughnessContentKey ?? (
      material.metallicRoughnessImageUri === uri ? computedContentKey : undefined
    );
    const normalContentKey = material.normalContentKey ?? (
      material.normalImageUri === uri ? computedContentKey : undefined
    );
    const occlusionContentKey = material.occlusionContentKey ?? (
      material.occlusionImageUri === uri ? computedContentKey : undefined
    );
    const extensionTexturesWithContentKey = computedContentKey === undefined
      ? material.extensionTextures
      : this.#contentKeyGltfMaterialExtensionTextureImages(
        material.extensionTextures,
        uri,
        computedContentKey,
      );
    const contentMaterial: LoadedGltfMaterial = {
      ...material,
      ...(baseColorContentKey === undefined ? {} : { baseColorContentKey }),
      ...(emissiveContentKey === undefined ? {} : { emissiveContentKey }),
      ...(metallicRoughnessContentKey === undefined ? {} : { metallicRoughnessContentKey }),
      ...(normalContentKey === undefined ? {} : { normalContentKey }),
      ...(occlusionContentKey === undefined ? {} : { occlusionContentKey }),
      ...(extensionTexturesWithContentKey === undefined ? {} : { extensionTextures: extensionTexturesWithContentKey }),
    };
    if (material.baseColorImageUri === uri) {
      this.#settleDecodedTextureSource(this.#gltfMaterialTextureRef(contentMaterial), image);
    }
    if (material.emissiveImageUri === uri) {
      this.#settleDecodedTextureSource(this.#gltfMaterialEmissiveTextureRef(contentMaterial), image);
    }
    if (material.metallicRoughnessImageUri === uri) {
      this.#settleDecodedTextureSource(this.#gltfMaterialMetallicRoughnessTextureRef(contentMaterial), image);
    }
    if (material.normalImageUri === uri) {
      this.#settleDecodedTextureSource(this.#gltfMaterialNormalTextureRef(contentMaterial), image);
    }
    if (material.occlusionImageUri === uri) {
      this.#settleDecodedTextureSource(this.#gltfMaterialOcclusionTextureRef(contentMaterial), image);
    }
    const existingExtensionTextures = contentMaterial.extensionTextures;
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      const slot = existingExtensionTextures?.[texture.key];
      if (slot?.imageUri === uri) {
        this.#settleDecodedTextureSource(this.#gltfTextureSlotRef(slot, texture.colorSpace), image);
      }
    }

    const extensionTextures = this.#settleGltfMaterialExtensionTextureImages(contentMaterial.extensionTextures, uri, image);
    const baseColorSvgVirtualTextureSource = contentMaterial.baseColorImageUri === uri
      ? svgVirtualTextureSourceForImage(image)
      : undefined;
    return {
      ...contentMaterial,
      ...(contentMaterial.baseColorImageUri === uri
        ? {
          ...(baseColorSvgVirtualTextureSource === undefined ? {} : { baseColorSvgVirtualTextureSource }),
          image,
        }
        : {}),
      ...(contentMaterial.emissiveImageUri === uri ? { emissiveImage: image } : {}),
      ...(contentMaterial.metallicRoughnessImageUri === uri ? { metallicRoughnessImage: image } : {}),
      ...(contentMaterial.normalImageUri === uri ? { normalImage: image } : {}),
      ...(contentMaterial.occlusionImageUri === uri ? { occlusionImage: image } : {}),
      ...(extensionTextures === undefined ? {} : { extensionTextures }),
    };
  }

  #failGltfMaterialImage(
    material: LoadedGltfMaterial,
    uri: string,
  ): LoadedGltfMaterial {
    const extensionTextures = this.#failGltfMaterialExtensionTextureImages(material.extensionTextures, uri);
    return {
      ...material,
      ...(material.baseColorImageUri === uri ? { imageFailed: true } : {}),
      ...(material.emissiveImageUri === uri ? { emissiveImageFailed: true } : {}),
      ...(material.metallicRoughnessImageUri === uri ? { metallicRoughnessImageFailed: true } : {}),
      ...(material.normalImageUri === uri ? { normalImageFailed: true } : {}),
      ...(material.occlusionImageUri === uri ? { occlusionImageFailed: true } : {}),
      ...(extensionTextures === undefined ? {} : { extensionTextures }),
    };
  }

  #settleGltfMaterialExtensionTextureImages(
    textures: LoadedGltfMaterialExtensionTextures | undefined,
    uri: string,
    image: LoadedTextureSource,
  ): LoadedGltfMaterialExtensionTextures | undefined {
    return this.#mapGltfMaterialExtensionTextureSlots(
      textures,
      (slot) => this.#settleGltfMaterialTextureSlot(slot, uri, image),
    );
  }

  #contentKeyGltfMaterialExtensionTextureImages(
    textures: LoadedGltfMaterialExtensionTextures | undefined,
    uri: string,
    contentKey: TextureContentKey,
  ): LoadedGltfMaterialExtensionTextures | undefined {
    return this.#mapGltfMaterialExtensionTextureSlots(
      textures,
      (slot) => this.#contentKeyGltfMaterialTextureSlot(slot, uri, contentKey),
    );
  }

  #settleGltfMaterialTextureSlot(
    slot: LoadedGltfMaterialTextureSlot | undefined,
    uri: string,
    image: LoadedTextureSource,
  ): LoadedGltfMaterialTextureSlot | undefined {
    if (slot === undefined) return undefined;
    return slot.imageUri === uri ? { ...slot, image } : slot;
  }

  #contentKeyGltfMaterialTextureSlot(
    slot: LoadedGltfMaterialTextureSlot | undefined,
    uri: string,
    contentKey: TextureContentKey,
  ): LoadedGltfMaterialTextureSlot | undefined {
    if (slot === undefined || slot.imageUri !== uri || slot.contentKey !== undefined) return slot;
    return { ...slot, contentKey };
  }

  #failGltfMaterialExtensionTextureImages(
    textures: LoadedGltfMaterialExtensionTextures | undefined,
    uri: string,
  ): LoadedGltfMaterialExtensionTextures | undefined {
    return this.#mapGltfMaterialExtensionTextureSlots(
      textures,
      (slot) => this.#failGltfMaterialTextureSlot(slot, uri),
    );
  }

  #mapGltfMaterialExtensionTextureSlots(
    textures: LoadedGltfMaterialExtensionTextures | undefined,
    mapSlot: (slot: LoadedGltfMaterialTextureSlot | undefined) => LoadedGltfMaterialTextureSlot | undefined,
  ): LoadedGltfMaterialExtensionTextures | undefined {
    if (textures === undefined) return undefined;

    const mapped: Partial<Record<keyof LoadedGltfMaterialExtensionTextures, LoadedGltfMaterialTextureSlot>> = {};
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      const slot = mapSlot(textures[texture.key]);
      if (slot !== undefined) mapped[texture.key] = slot;
    }

    return mapped;
  }

  #failGltfMaterialTextureSlot(
    slot: LoadedGltfMaterialTextureSlot | undefined,
    uri: string,
  ): LoadedGltfMaterialTextureSlot | undefined {
    if (slot === undefined) return undefined;
    return slot.imageUri === uri ? { ...slot, imageFailed: true } : slot;
  }

  #scheduleRender(): void {
    if (this.#disposed || this.#renderScheduled || this.#latestScene === undefined) return;
    const requestFrame = globalThis.requestAnimationFrame;
    if (typeof requestFrame !== "function") {
      this.render(this.#latestScene);
      return;
    }

    this.#renderScheduled = true;
    requestFrame(() => {
      this.#renderScheduled = false;
      if (!this.#disposed && this.#latestScene !== undefined) this.#renderLatestScene();
    });
  }

  #renderLatestScene(): void {
    const scene = this.#latestScene;
    if (scene === undefined) return;

    const { height, width } = this.#resize();
    this.#renderScene(scene, {
      framebuffer: null,
      scissor: false,
      syncRenderObjectRefs: false,
      views: [{
        projection: (renderPass) => projectionMat4(renderPass.camera, width, height),
        view: (renderPass) => viewMat4(renderPass.camera),
        viewport: { height, width, x: 0, y: 0 },
      }],
    });
  }

  #createBuffer(): WebGLBuffer {
    const buffer = this.#gl.createBuffer();
    if (buffer === null) throw new Error("WebGL buffer creation failed");
    this.#ownedBuffers.add(buffer);
    return buffer;
  }

  #createVertexArray(): WebGLVertexArrayObject {
    const vertexArray = this.#gl.createVertexArray();
    if (vertexArray === null) throw new Error("WebGL vertex array creation failed");
    this.#ownedVertexArrays.add(vertexArray);
    return vertexArray;
  }

  #createTexture(): WebGLTexture {
    const texture = this.#gl.createTexture();
    if (texture === null) throw new Error("WebGL texture creation failed");
    this.#ownedTextures.add(texture);
    return texture;
  }

  #deleteBuffer(buffer: WebGLBuffer): void {
    if (!this.#ownedBuffers.has(buffer)) return;
    this.#gl.deleteBuffer(buffer);
    this.#ownedBuffers.delete(buffer);
  }

  #deleteVertexArray(vertexArray: WebGLVertexArrayObject): void {
    if (!this.#ownedVertexArrays.has(vertexArray)) return;
    this.#gl.deleteVertexArray(vertexArray);
    this.#ownedVertexArrays.delete(vertexArray);
  }

  #deleteShader(shader: WebGLShader): void {
    if (!this.#ownedShaders.has(shader)) return;
    this.#gl.deleteShader(shader);
    this.#ownedShaders.delete(shader);
  }

  #deleteProgram(program: WebGLProgram): void {
    if (!this.#ownedPrograms.has(program)) return;
    if (this.#activeProgram === program) this.#activeProgram = undefined;
    this.#gl.deleteProgram(program);
    this.#ownedPrograms.delete(program);
    this.#programAttributeLocations.delete(program);
    this.#programUniformLocations.delete(program);
    this.#programUniformValues.delete(program);
  }

  #recordDiagnostic(message: string): void {
    this.#diagnostics = [...this.#diagnostics, message];
    console.warn(message);
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
      addPhase("animations", load.sceneReadAt, load.animationsReadAt);
      addPhase("buffers", load.documentLoadedAt, load.buffersLoadedAt);
      addPhase("document", load.startedAt, load.documentLoadedAt);
      addPhase("draco", load.meshoptDecodedAt, load.dracoDecodedAt);
      addPhase("firstImageComplete", load.imageLoadStartedAt, load.firstImageSettledAt);
      addPhase("imagesComplete", load.imageLoadStartedAt, load.imagesSettledAt);
      addPhase("meshopt", load.buffersLoadedAt, load.meshoptDecodedAt);
      addPhase("scene", load.dracoDecodedAt, load.sceneReadAt);
      addPhase("toSceneReady", load.startedAt, load.readyAt);

      return {
        animationCount: state.animations.length,
        ...(state.error === undefined ? {} : { error: state.error }),
        imageFailures: load.imageFailures,
        imageLoaded: load.imageLoaded,
        imageRequests: load.imageRequests,
        key: state.key,
        lightCount: state.lights.length,
        nodeCount: state.nodes.length,
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
    if (this.#unsupportedVirtualTextureDiagnostics.has(message)) return;
    this.#unsupportedVirtualTextureDiagnostics.add(message);
    this.#recordDiagnostic(message);
  }
}

/** Creates an imperative WebGL2 renderer root. */
export const createWebGlRoot = (
  canvas: HTMLCanvasElement,
  options?: WebGlRootOptions,
): WebGlRoot => new WebGlRootImpl(canvas, options);
