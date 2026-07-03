import {
  createRenderObjectHandle,
  type BoxGeometry,
  type DirectionalLightNode,
  type EulerRads,
  type GltfNode,
  type Material,
  type MeshNode,
  type PlaneGeometry,
  type PickInput,
  type PickResult,
  type PickTarget,
  type RenderPass,
  type RenderObjectHandle,
  type RenderObjectRef,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type TextNode,
  type TextureRef,
  type TextureSampler,
  type Transform,
  type UnlitMaterial,
  type Vec3,
} from "@royal/renderer-core";
import { textMesh } from "@royal/renderer-core/text/mesh";
import {
  readGltfFloatAccessor,
  readGltfIndices,
  type GltfIndexArray,
} from "./gltf/accessors";
import {
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
  orientationPreservingMat4,
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
  type LoadedTextureSource,
} from "./texture-sources";
import {
  encodeVirtualTexturePageTableRgba8,
  parseVirtualTextureManifest,
  VirtualTextureAtlasPageTable,
  virtualTexturePageKey,
  virtualTexturePageUri,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
  type VirtualTexturePageTableUpdate,
} from "./virtual-texturing";
import {
  DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS,
  isTransmissiveSurfaceMaterial,
  materialColor,
  materialEmissiveColor,
  surfaceMaterialMetallicFactor,
  surfaceMaterialOcclusionStrength,
  surfaceMaterialRoughnessFactor,
  surfaceMaterialBatchKey,
  surfaceMaterialExtensionFactors,
  textureCacheKey,
  type SurfaceMaterial,
  type SurfaceMaterialExtensionFactors,
  type TextureAssetUploadRef,
} from "./webgl/materials";
import {
  type ProgramKind,
  fragmentShaderSource,
  vertexShaderSource,
} from "./webgl/shaders";
import {
  combineSurfaceLightSets,
  DEFAULT_LIGHT_DIRECTION,
  DEFAULT_SURFACE_LIGHT_SET,
  EMPTY_SURFACE_LIGHT_SET,
  MAX_SURFACE_LIGHTS,
  passSurfaceLightSet,
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
  createFallbackIblSpecularTexture,
  ensureIblSpecularTexture,
  settleIblSpecularImage,
  type IblSpecularTextureContext,
  type IblSpecularTextureResource,
} from "./webgl/ibl-specular-textures";
import { bindSurfaceIblUniforms } from "./webgl/ibl-uniforms";

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
  readonly latestScene: RenderRoot | undefined;
  readonly options: Required<WebGlRootOptions>;
  readonly virtualTexturing: WebGlVirtualTexturingSnapshot;
}

export interface WebGlVirtualTexturingSnapshot {
  readonly atlasTextures: number;
  readonly manifestFailures: number;
  readonly manifestRequests: number;
  readonly manifestsReady: number;
  readonly pageTableTextures: number;
  readonly pageTableUpdates: number;
  readonly pendingPages: number;
  readonly requestedPages: number;
  readonly residentPages: number;
  readonly shaderBinds: number;
  readonly unreadyDraws: number;
  readonly unsupportedDraws: number;
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

type GeometryDrawMode =
  | "line-loop"
  | "line-strip"
  | "lines"
  | "points"
  | "triangle-fan"
  | "triangle-strip"
  | "triangles";

type GeometryResource = {
  readonly arrayBuffer: WebGLBuffer;
  readonly borrowedVertexBufferKey?: string;
  readonly drawCount: number;
  readonly indexBuffer?: WebGLBuffer;
  readonly indexType?: number;
  readonly key: string;
  readonly mode: GeometryDrawMode;
  readonly normalBuffer?: WebGLBuffer;
  readonly texCoordBuffer?: WebGLBuffer;
};

type CpuGeometry = {
  readonly indices?: GltfIndexArray;
  readonly key: string;
  readonly mode: GeometryDrawMode;
  readonly normals?: Float32Array;
  readonly positions: Float32Array;
  readonly texCoords?: Float32Array;
  readonly vertexBufferKey?: string;
};

type TextureResource = {
  readonly key: string;
  readonly texture: WebGLTexture;
  uploaded: boolean;
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

type VirtualTextureRuntimeStats = {
  manifestFailures: number;
  manifestRequests: number;
  pageTableUpdates: number;
  shaderBinds: number;
  unreadyDraws: number;
  unsupportedDraws: number;
  uploadedPages: number;
};

type VirtualTextureRuntimeState = {
  diagnostics: string[];
  readonly key: string;
  loadingPages: Set<string>;
  manifest?: VirtualTextureManifestModel;
  pageTable?: VirtualTextureAtlasPageTable;
  readonly requestedPages: Set<string>;
  resources?: VirtualTextureResourceSet;
  stats: VirtualTextureRuntimeStats;
  status: VirtualTextureRuntimeStatus;
  readonly texture: VirtualTextureRef;
  readonly uploadedPages: Set<string>;
};

type LoadedGltfPrimitive = {
  readonly indices?: GltfIndexArray;
  readonly key: string;
  readonly localModels: readonly Mat4[];
  readonly material: LoadedGltfMaterial;
  readonly materialLod?: GltfMaterialPrimitiveLod;
  readonly materialVariants?: readonly LoadedGltfMaterialVariant[];
  readonly mode: GeometryDrawMode;
  readonly nodeLod?: GltfNodePrimitiveLod;
  readonly normals?: Float32Array;
  readonly positions: Float32Array;
};

type LoadedGltfMaterial = {
  readonly baseColorImageUri?: string;
  readonly baseColorTextureUri?: string;
  readonly color?: Rgba;
  readonly doubleSided: boolean;
  readonly emissive?: Rgba;
  readonly emissiveImage?: LoadedTextureSource;
  readonly emissiveImageFailed?: boolean;
  readonly emissiveImageUri?: string;
  readonly emissiveSampler?: TextureSampler;
  readonly emissiveTextureUri?: string;
  readonly image?: LoadedTextureSource;
  readonly imageFailed?: boolean;
  readonly extensionFactors?: SurfaceMaterialExtensionFactors;
  readonly metallicRoughnessImage?: LoadedTextureSource;
  readonly metallicRoughnessImageFailed?: boolean;
  readonly metallicRoughnessImageUri?: string;
  readonly metallicRoughnessSampler?: TextureSampler;
  readonly metallicRoughnessTextureUri?: string;
  readonly metallicFactor?: number;
  readonly occlusionImage?: LoadedTextureSource;
  readonly occlusionImageFailed?: boolean;
  readonly occlusionImageUri?: string;
  readonly occlusionSampler?: TextureSampler;
  readonly occlusionStrength?: number;
  readonly occlusionTextureUri?: string;
  readonly roughnessFactor?: number;
  readonly sampler?: TextureSampler;
  readonly texCoords?: Float32Array;
  readonly unlit?: boolean;
  readonly extensionTextures?: LoadedGltfMaterialExtensionTextures;
};

type LoadedGltfMaterialTextureSlot = {
  readonly image?: LoadedTextureSource;
  readonly imageFailed?: boolean;
  readonly imageUri?: string;
  readonly sampler?: TextureSampler;
  readonly textureUri?: string;
};

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

const loadedGltfSurfaceMaterial = (
  loadedMaterial: LoadedGltfMaterial,
  baseColor: TextureRef,
  textures: LoadedGltfSurfaceTextures,
): SurfaceMaterial => {
  const emissive = loadedMaterial.emissive;
  const extensionFactors = loadedMaterial.extensionFactors;
  const common = {
    baseColor,
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

type GltfState = {
  imageBasedLight?: SurfaceImageBasedLight;
  readonly key: string;
  error?: string;
  lights: readonly SurfaceLight[];
  primitives: readonly LoadedGltfPrimitive[];
  status: "loading" | "ready" | "error";
  variants: readonly string[];
};

type GltfPrimitiveDraw = {
  readonly geometry: CpuGeometry;
  readonly lights?: SurfaceLightSet;
  readonly material: SurfaceMaterial;
  readonly model: Mat4;
  readonly sidedness: DrawSidedness;
};

type GltfPrimitiveDrawBatch = {
  readonly geometry: GeometryResource;
  readonly key: string;
  readonly lights: SurfaceLightSet;
  readonly material: SurfaceMaterial;
  readonly models: Mat4[];
  readonly sidedness: DrawSidedness;
};

type GltfInstanceBufferResource = {
  capacity: number;
  readonly buffer: WebGLBuffer;
  readonly data: Float32Array;
  dirty: boolean;
};

type ViewportSize = readonly [width: number, height: number];

type SceneRenderView = {
  projection(renderPass: RenderPass): Mat4;
  readonly viewport: WebGlRenderViewport;
  view(renderPass: RenderPass): Mat4;
};

const DEFAULT_COLOR: Rgba = [1, 1, 1, 1];
const GLTF_LOD_HYSTERESIS_RATIO = 0.15;
const VT_WRAP_CLAMP_TO_EDGE = 0;
const VT_WRAP_REPEAT = 1;
const VT_WRAP_MIRRORED_REPEAT = 2;
const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const TYPED_ARRAY_CONTENT_KEYS = new WeakMap<ArrayBufferView, string>();
const FNV_1A_32_OFFSET = 0x811c9dc5;
const FNV_1A_32_PRIME = 0x01000193;

const hashBytes = (bytes: Uint8Array): string => {
  let hash = FNV_1A_32_OFFSET;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_1A_32_PRIME) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
};

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

const gltfGeometryContentKey = ({
  indices,
  mode,
  normals,
  positions,
  texCoords,
}: {
  readonly indices?: GltfIndexArray | undefined;
  readonly mode: GeometryDrawMode;
  readonly normals?: Float32Array | undefined;
  readonly positions: Float32Array;
  readonly texCoords?: Float32Array | undefined;
}): string => [
  "gltf-geometry",
  mode,
  typedArrayContentKey(positions),
  typedArrayContentKey(normals),
  typedArrayContentKey(texCoords),
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

const gltfTextureImageSelection = (texture: GltfTexture | undefined): GltfTextureImageSelection | undefined => {
  const svgSource = texture?.extensions?.GS_texture_svg?.source;
  if (svgSource !== undefined) return { imageIndex: svgSource, kind: "svg" };

  const basisuSource = texture?.extensions?.KHR_texture_basisu?.source;
  if (basisuSource !== undefined) return { imageIndex: basisuSource, kind: "basisu" };

  const webpSource = texture?.extensions?.EXT_texture_webp?.source;
  const imageIndex = webpSource !== undefined && canvasSupportsImageMimeType("image/webp")
    ? webpSource
    : texture?.source;
  return imageIndex === undefined ? undefined : { imageIndex, kind: "image" };
};

const gltfMaterialTextureSlot = (
  document: GltfDocument,
  assetKey: string,
  src: string,
  textureInfo: GltfTextureInfo | undefined,
): LoadedGltfMaterialTextureSlot | undefined => {
  const textureIndex = textureInfo?.index;
  const texture = textureIndex === undefined ? undefined : document.textures?.[textureIndex];
  const imageSelection = gltfTextureImageSelection(texture);
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

  if (imageUri === undefined && sampler === undefined && textureUri === undefined) return undefined;

  return {
    ...(imageUri === undefined ? {} : { imageUri }),
    ...(sampler === undefined ? {} : { sampler }),
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

const loadImageBitmapFromBufferView = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  image: GltfImage,
): Promise<ImageBitmap> => {
  const createBitmap = globalThis.createImageBitmap;
  if (typeof createBitmap !== "function") {
    return Promise.reject(new Error("ImageBitmap decoding is unavailable for glTF bufferView image"));
  }
  if (image.bufferView === undefined) {
    return Promise.reject(new Error("glTF image has no bufferView"));
  }
  const blob = new Blob([gltfBufferViewBytes(document, buffers, image.bufferView)], {
    type: image.mimeType ?? "application/octet-stream",
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
const svgAttributePattern = /\b([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/giu;
const svgDimensionPattern = /^\s*([+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?)\s*(?:px|pt|pc|mm|cm|in)?\s*$/iu;
const svgExternalReferenceMaxDepth = 8;
const svgTextDecoder = new TextDecoder();

type SvgTextureViewport = {
  readonly fromViewBox: boolean;
  readonly height: number;
  readonly width: number;
};

type SvgImageReferenceContext = {
  readonly active: Set<string>;
  readonly cache: Map<string, Promise<SvgImageReferenceValue>>;
  readonly depth: number;
};

type SvgImageReferenceValue =
  | {
    readonly kind: "data-uri";
    readonly value: string;
  }
  | {
    readonly kind: "svg";
    readonly text: string;
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
        return {
          kind: "svg",
          text: await prepareSvgTextForImage(await response.text(), `SVG image reference ${responseUrl}`, responseUrl, {
            context: {
              active: context.active,
              cache: context.cache,
              depth: context.depth + 1,
            },
            requireViewport: false,
          }),
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

const svgImageAttributes = (imageTag: string): readonly (readonly [name: string, value: string])[] => {
  const attributes: Array<readonly [string, string]> = [];
  for (const match of imageTag.matchAll(svgAttributePattern)) {
    const name = match[1] ?? "";
    if (/^(?:xlink:)?href$/iu.test(name)) continue;
    attributes.push([name, match[3] ?? ""]);
  }
  return attributes;
};

const inlineNestedSvgImageElement = (imageTag: string, value: SvgImageReferenceValue): string | undefined => {
  if (value.kind !== "svg") return undefined;

  const svgRoot = svgRootPattern.exec(value.text);
  if (svgRoot === null) throw new Error("Nested SVG image reference has no root <svg> element");

  let attributes = svgRoot[1] ?? "";
  for (const [name, attributeValue] of svgImageAttributes(imageTag)) {
    attributes = setSvgAttribute(attributes, name, attributeValue);
  }

  return `<svg${attributes}>${value.text.slice(svgRoot.index + svgRoot[0].length)}`;
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

    const nestedSvg = inlineNestedSvgImageElement(imageTag, value);
    if (nestedSvg !== undefined) return nestedSvg;

    return imageTag.replace(svgHrefAttributePattern, (attribute, name: string, quote: string, href: string) => {
      const replacement = resolved.get(href);
      return replacement?.kind === "data-uri" ? `${name}=${quote}${replacement.value}${quote}` : attribute;
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

const loadSvgTextImage = async (svgText: string, label: string, baseUrl?: string): Promise<HTMLImageElement> => {
  const normalizedText = await prepareSvgTextForImage(svgText, label, baseUrl);

  return loadImageFromBlob(new Blob([normalizedText], { type: "image/svg+xml" }), label);
};

const loadSvgUriImage = async (url: string): Promise<HTMLImageElement> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  return loadSvgTextImage(
    await response.text(),
    `glTF GS_texture_svg image ${url}`,
    absoluteSvgBaseUrl(response.url || url),
  );
};

const loadSvgImageSource = async (
  src: string,
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  image: GltfImage,
): Promise<HTMLImageElement> => {
  if (image.uri !== undefined) {
    if (image.uri.startsWith("data:")) {
      const svgText = svgTextDecoder.decode(decodeDataUri(image.uri));
      return loadSvgTextImage(svgText, `glTF GS_texture_svg data URI ${image.uri.slice(0, 48)}`, absoluteSvgBaseUrl(src));
    }

    return loadSvgUriImage(resolveResourceUri(src, image.uri));
  }
  if (image.bufferView === undefined) {
    throw new Error("glTF GS_texture_svg image has no URI or bufferView");
  }

  return loadSvgTextImage(
    svgTextDecoder.decode(gltfBufferViewBytes(document, buffers, image.bufferView)),
    `glTF GS_texture_svg bufferView ${image.bufferView}`,
    absoluteSvgBaseUrl(src),
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
): Promise<LoadedTextureSource> => {
  if (kind === "svg") {
    return loadSvgImageSource(src, document, buffers, image);
  }

  if (kind === "basisu") {
    const bytes = image.uri === undefined
      ? image.bufferView === undefined
        ? Promise.reject(new Error("glTF KHR_texture_basisu image has no URI or bufferView"))
        : Promise.resolve(gltfBufferViewBytes(document, buffers, image.bufferView))
      : loadBasisuBytesFromUri(src, image);

    return bytes.then((buffer) => decodeGltfBasisuRgba(buffer, image.uri ?? `bufferView ${image.bufferView ?? ""}`));
  }

  return image.uri === undefined
    ? loadImageBitmapFromBufferView(document, buffers, image)
    : loadImage(resolveResourceUri(src, image.uri));
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

const gltfMetallicRoughnessFactor = (value: number | undefined, fallback: number): number =>
  clampedFiniteNumber(value, fallback, 0, 1);

const gltfOcclusionStrength = (value: number | undefined): number =>
  clampedFiniteNumber(value, 1, 0, 1);

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
  const specular = extensions?.KHR_materials_specular;
  const ior = extensions?.KHR_materials_ior;
  const sheen = extensions?.KHR_materials_sheen;
  const iridescence = extensions?.KHR_materials_iridescence;
  const clearcoat = extensions?.KHR_materials_clearcoat;
  const dispersion = extensions?.KHR_materials_dispersion;
  const transmission = extensions?.KHR_materials_transmission;
  const volume = extensions?.KHR_materials_volume;
  if (
    specular === undefined
    && ior === undefined
    && sheen === undefined
    && iridescence === undefined
    && clearcoat === undefined
    && dispersion === undefined
    && transmission === undefined
    && volume === undefined
  ) return undefined;

  return {
    attenuationColor: gltfAttenuationColor(volume?.attenuationColor),
    attenuationDistance: gltfAttenuationDistance(volume?.attenuationDistance),
    clearcoatFactor: clampedFiniteNumber(clearcoat?.clearcoatFactor, 0, 0, 1),
    clearcoatRoughnessFactor: clampedFiniteNumber(clearcoat?.clearcoatRoughnessFactor, 0, 0, 1),
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

const gltfBaseColorTexCoordSet = (
  document: GltfDocument,
  materialIndex: number | undefined,
): number => {
  const textureInfo = gltfMaterialPrimaryTextureInfo(document, materialIndex);

  return textureInfo?.extensions?.KHR_texture_transform?.texCoord
    ?? textureInfo?.texCoord
    ?? 0;
};

const gltfBaseColorTextureTransform = (
  document: GltfDocument,
  materialIndex: number | undefined,
): GltfTextureTransformExtension | undefined =>
  gltfMaterialPrimaryTextureInfo(document, materialIndex)?.extensions?.KHR_texture_transform;

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

const gltfTexCoordAccessor = (
  document: GltfDocument,
  primitive: GltfMeshPrimitive,
  materialIndex: number | undefined,
): number | undefined => {
  if (gltfMaterialPrimaryTextureInfo(document, materialIndex)?.index === undefined) return undefined;
  const texCoordSet = gltfBaseColorTexCoordSet(document, materialIndex);

  return primitive.attributes?.[`TEXCOORD_${texCoordSet}`];
};

const gltfMaterialTexCoords = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  primitive: GltfMeshPrimitive,
  materialIndex: number | undefined,
  decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
): Float32Array | undefined => {
  if (gltfMaterialPrimaryTextureInfo(document, materialIndex)?.index === undefined) return undefined;

  const texCoordSet = gltfBaseColorTexCoordSet(document, materialIndex);
  const decodedTexCoords = decodedAttributes?.get(`TEXCOORD_${texCoordSet}`);
  if (decodedTexCoords !== undefined) {
    return transformGltfTexCoords(decodedTexCoords, gltfBaseColorTextureTransform(document, materialIndex));
  }

  const texCoordAccessor = gltfTexCoordAccessor(document, primitive, materialIndex);
  if (texCoordAccessor === undefined) return undefined;
  return transformGltfTexCoords(
    readGltfFloatAccessor(document, buffers, texCoordAccessor),
    gltfBaseColorTextureTransform(document, materialIndex),
  );
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

const adjacentLodLevels = (level: number, levelCount: number): readonly number[] => {
  const levels: number[] = [];
  if (level > 0) levels.push(level - 1);
  if (level + 1 < levelCount) levels.push(level + 1);
  return levels;
};

const projectedScreenCoverage = (
  positions: Float32Array,
  model: Mat4,
  projection: Mat4,
  view: Mat4,
): number => {
  if (positions.length === 0) return 0;

  const mvp = multiplyMat4(projection, multiplyMat4(view, model));
  let minX = 1;
  let minY = 1;
  let maxX = -1;
  let maxY = -1;
  let projected = false;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    const clipX = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
    const clipY = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
    const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    if (clipW === 0) continue;

    const ndcX = clamp01((clipX / clipW + 1) / 2);
    const ndcY = clamp01((clipY / clipW + 1) / 2);
    minX = Math.min(minX, ndcX);
    minY = Math.min(minY, ndcY);
    maxX = Math.max(maxX, ndcX);
    maxY = Math.max(maxY, ndcY);
    projected = true;
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
  readonly #programs = new Map<ProgramKind, ProgramResource>();
  readonly #geometry = new Map<string, GeometryResource>();
  readonly #textures = new Map<string, TextureResource | TextureLoadState>();
  readonly #iblSpecularTextures = new Map<string, IblSpecularTextureResource>();
  readonly #virtualTextures = new Map<string, VirtualTextureRuntimeState>();
  readonly #gltf = new Map<string, GltfState>();
  readonly #gltfInstanceBuffers = new Map<string, GltfInstanceBufferResource>();
  readonly #gltfLodSelections = new Map<string, GltfLodSelectionState>();
  readonly #ownedBuffers = new Set<WebGLBuffer>();
  readonly #ownedPrograms = new Set<WebGLProgram>();
  readonly #ownedShaders = new Set<WebGLShader>();
  readonly #ownedTextures = new Set<WebGLTexture>();
  readonly #renderObjectBindings = new Map<RenderObjectRef, RenderObjectBinding>();
  readonly #renderObjectHandles = new WeakMap<TransformableRenderNode, RenderObjectHandle>();
  readonly #unsupportedGltfImageBasedLightDiagnostics = new Set<string>();
  readonly #unsupportedGltfMaterialExtensionDiagnostics = new Set<string>();
  readonly #unsupportedVirtualTextureDiagnostics = new Set<string>();
  #activeGltfInstanceBufferKeys = new Set<string>();
  #activeGltfLodSelectionKeys = new Set<string>();
  #dprMediaQuery: MediaQueryList | undefined;
  #diagnostics: string[] = [];
  #disposed = false;
  #frame = 0;
  #gltfRenderOrdinal = 0;
  #iblFallbackSpecularTexture: WebGLTexture | undefined;
  #latestScene: RenderRoot | undefined;
  #renderScheduled = false;
  #resizeObserver: ResizeObserver | undefined;
  #transmissionScreenColorTexture: ScreenColorTextureResource | undefined;
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
      readonly views: readonly SceneRenderView[];
    },
  ): void {
    if (options.views.length === 0) return;

    this.#latestScene = scene;
    this.#syncRenderObjectRefs(scene);
    this.#activeGltfInstanceBufferKeys = new Set();
    this.#activeGltfLodSelectionKeys = new Set();
    this.#gltfRenderOrdinal = 0;
    const gl = this.#gl;
    gl.bindFramebuffer?.(gl.FRAMEBUFFER, options.framebuffer);
    gl.clearDepth?.(1);
    gl.enable?.(gl.DEPTH_TEST);
    gl.depthFunc?.(gl.LEQUAL);
    gl.enable?.(gl.BLEND);
    gl.blendFunc?.(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (options.scissor) gl.enable?.(gl.SCISSOR_TEST);

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
          const passLights = passSurfaceLightSet(lights[0]);
          const viewportSize: ViewportSize = [width, height];
          const gltfDraws: GltfPrimitiveDraw[] = [];
          const flushGltfDraws = (): void => {
            if (gltfDraws.length === 0) return;
            this.#drawGltfPrimitiveDraws(gltfDraws, projection, view, passLights, viewportSize, usedGeometry);
            gltfDraws.length = 0;
          };

          for (const child of renderPass.children) {
            if (child.kind === "directional-light") continue;
            if (child.kind === "gltf") {
              this.#appendGltfPrimitiveDraws(child, projection, view, gltfDraws);
              continue;
            }
            flushGltfDraws();
            this.#drawNode(child, projection, view, lights[0], viewportSize, usedGeometry);
          }
          flushGltfDraws();
        }
      }
    } finally {
      if (options.scissor) gl.disable?.(gl.SCISSOR_TEST);
      gl.bindFramebuffer?.(gl.FRAMEBUFFER, null);
    }

    this.#releaseUnusedGeometry(usedGeometry);
    this.#releaseUnusedGltfInstanceBuffers();
    this.#pruneGltfLodSelections();
    this.#frame += 1;
  }

  invalidate(): void {
    this.#scheduleRender();
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
    for (const buffer of Array.from(this.#ownedBuffers)) this.#deleteBuffer(buffer);
    for (const texture of Array.from(this.#ownedTextures)) {
      gl.deleteTexture(texture);
      this.#ownedTextures.delete(texture);
    }
    for (const program of Array.from(this.#ownedPrograms)) {
      gl.deleteProgram(program);
      this.#ownedPrograms.delete(program);
    }
    for (const shader of Array.from(this.#ownedShaders)) {
      gl.deleteShader(shader);
      this.#ownedShaders.delete(shader);
    }

    this.#programs.clear();
    this.#geometry.clear();
    this.#textures.clear();
    this.#virtualTextures.clear();
    this.#gltf.clear();
    this.#gltfInstanceBuffers.clear();
    this.#gltfLodSelections.clear();
    this.#iblFallbackSpecularTexture = undefined;
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
      binding = {
        declarativeTransform,
        handle: existingHandle ?? createRenderObjectHandle(declarativeTransform, () => {
          if (invalidation?.suppress === true) return;

          this.invalidate();
        }),
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
    return this.#renderObjectHandles.get(node)?.getTransform() ?? node.transform;
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
      let best: PickCandidate | undefined;
      for (const primitive of state.primitives) {
        if (!isPickableDrawMode(primitive.mode)) continue;
        for (const [instanceIndex, localModel] of primitive.localModels.entries()) {
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
              primitiveKey: primitive.localModels.length === 1
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
    light: DirectionalLightNode | undefined,
    viewportSize: ViewportSize,
    usedGeometry: Set<string>,
  ): void {
    switch (node.kind) {
      case "directional-light":
        return;
      case "mesh":
        this.#drawMesh(node, projection, view, light, usedGeometry);
        return;
      case "text":
        this.#drawText(node, projection, view, usedGeometry);
        return;
      case "gltf":
        {
          const draws: GltfPrimitiveDraw[] = [];
          this.#appendGltfPrimitiveDraws(node, projection, view, draws);
          this.#drawGltfPrimitiveDraws(
            draws,
            projection,
            view,
            passSurfaceLightSet(light),
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
    light: DirectionalLightNode | undefined,
    usedGeometry: Set<string>,
  ): void {
    const cpu = this.#meshGeometry(node.geometry, node.material);
    const model = transformMat4(this.#renderObjectTransform(node));
    if (!this.#isVisible(cpu.positions, model, projection, view)) return;
    if (node.material.kind === "standard" && light === undefined) {
      throw new Error("standardMaterial meshes require a directionalLight in the render pass");
    }
    const gpu = this.#geometryResource(cpu);
    usedGeometry.add(gpu.key);
    this.#drawGeometry(gpu, node.material, model, projection, view, passSurfaceLightSet(light), undefined);
  }

  #drawText(
    node: TextNode,
    projection: Mat4,
    view: Mat4,
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
    this.#drawGeometry(gpu, material, identityMat4(), projection, view, undefined, undefined);
  }

  #appendGltfPrimitiveDraws(
    node: GltfNode,
    projection: Mat4,
    view: Mat4,
    draws: GltfPrimitiveDraw[],
  ): void {
    const renderInstanceKey = `instance:${this.#gltfRenderOrdinal}`;
    this.#gltfRenderOrdinal += 1;
    const state = this.#gltfState(node);
    if (state.status !== "ready") return;

    const rootModel = transformMat4(this.#renderObjectTransform(node));
    const assetLights = this.#gltfAssetLightSet(state, rootModel);
    const selectedNodeLevels = this.#selectedGltfNodeLodLevels(
      state,
      renderInstanceKey,
      rootModel,
      projection,
      view,
    );
    this.#preloadAdjacentGltfNodeLodTextures(state.primitives, selectedNodeLevels);
    for (const primitive of state.primitives) {
      const nodeLod = primitive.nodeLod;
      if (nodeLod !== undefined) {
        const selectedLevel = selectedNodeLevels.get(nodeLod.group);
        if (selectedLevel !== nodeLod.level) continue;
      }

      const primitiveMaterial = this.#gltfPrimitiveMaterialForVariant(state, node, primitive);
      for (const [instanceIndex, localModel] of primitive.localModels.entries()) {
        const model = multiplyMat4(rootModel, localModel);
        const materialSelection = this.#selectedGltfMaterial(
          state,
          renderInstanceKey,
          primitive,
          primitiveMaterial,
          instanceIndex,
          model,
          projection,
          view,
        );
        const loadedMaterial = materialSelection.material;
        this.#preloadAdjacentGltfMaterialLodTextures(primitiveMaterial.materialLod, materialSelection.level);

        const baseColor = this.#gltfMaterialTextureRef(loadedMaterial);
        const textures = this.#gltfMaterialSurfaceTextures(loadedMaterial);
        if (loadedMaterial.image !== undefined && baseColor !== undefined) {
          this.#ensureImmediateTexture(baseColor, loadedMaterial.image);
        }
        this.#ensureLoadedGltfMaterialSurfaceTextures(loadedMaterial, textures);
        const material = loadedGltfSurfaceMaterial(
          loadedMaterial,
          loadedMaterial.image !== undefined && baseColor !== undefined
            ? baseColor
            : { color: loadedMaterial.color ?? DEFAULT_COLOR, kind: "solid" },
          textures,
        );
        const cpu: CpuGeometry = {
          ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
          key: gltfGeometryContentKey({
            ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
            mode: primitive.mode,
            ...(primitive.normals === undefined ? {} : { normals: primitive.normals }),
            positions: primitive.positions,
            ...(loadedMaterial.texCoords === undefined ? {} : { texCoords: loadedMaterial.texCoords }),
          }),
          mode: primitive.mode,
          ...(primitive.normals === undefined ? {} : { normals: primitive.normals }),
          positions: primitive.positions,
          ...(loadedMaterial.texCoords === undefined ? {} : { texCoords: loadedMaterial.texCoords }),
        };
        if (!this.#isVisible(cpu.positions, model, projection, view)) {
          continue;
        }
        draws.push({
          geometry: cpu,
          ...(assetLights === undefined ? {} : { lights: assetLights }),
          material,
          model,
          sidedness: {
            doubleSided: loadedMaterial.doubleSided,
            frontFaceCcw: orientationPreservingMat4(model),
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
    viewportSize: ViewportSize,
    usedGeometry: Set<string>,
  ): void {
    const batches = new Map<string, GltfPrimitiveDrawBatch>();
    for (const draw of draws) {
      const geometry = this.#geometryResource(draw.geometry);
      usedGeometry.add(geometry.key);
      const lights = combineSurfaceLightSets(passLights, draw.lights);
      const sidednessKey = draw.sidedness.doubleSided
        ? "double-sided"
        : draw.sidedness.frontFaceCcw ? "front-ccw" : "front-cw";
      const batchKey = `${geometry.key}|${surfaceMaterialBatchKey(draw.material)}|${sidednessKey}|${lights.key}`;
      const batch = batches.get(batchKey);
      if (batch === undefined) {
        batches.set(batchKey, {
          geometry,
          key: batchKey,
          lights,
          material: draw.material,
          models: [draw.model],
          sidedness: draw.sidedness,
        });
      } else {
        batch.models.push(draw.model);
      }
    }

    const opaqueBatches: GltfPrimitiveDrawBatch[] = [];
    const transmissiveBatches: GltfPrimitiveDrawBatch[] = [];
    for (const batch of batches.values()) {
      if (isTransmissiveSurfaceMaterial(batch.material)) {
        transmissiveBatches.push(batch);
      } else {
        opaqueBatches.push(batch);
      }
    }

    for (const batch of opaqueBatches) this.#drawGltfPrimitiveDrawBatch(batch, projection, view, undefined);

    if (transmissiveBatches.length === 0) return;
    const screenColorTexture = this.#copyTransmissionScreenColorTexture(viewportSize);
    for (const batch of transmissiveBatches) {
      this.#drawGltfPrimitiveDrawBatch(batch, projection, view, screenColorTexture);
    }
  }

  #drawGltfPrimitiveDrawBatch(
    batch: GltfPrimitiveDrawBatch,
    projection: Mat4,
    view: Mat4,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    this.#applyDrawSidedness(batch.sidedness);
    try {
      if (batch.models.length === 1) {
        this.#drawGeometry(
          batch.geometry,
          batch.material,
          batch.models[0]!,
          projection,
          view,
          batch.lights,
          transmissionScreenColorTexture,
        );
      } else {
        this.#drawGeometryInstanced(
          batch.geometry,
          batch.key,
          batch.material,
          batch.models,
          projection,
          view,
          batch.lights,
          transmissionScreenColorTexture,
        );
      }
    } finally {
      this.#resetDrawSidedness();
    }
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
    rootModel: Mat4,
    projection: Mat4,
    view: Mat4,
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

      for (const localModel of primitive.localModels) {
        const model = multiplyMat4(rootModel, localModel);
        const coverage = projectedScreenCoverage(primitive.positions, model, projection, view);
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
        (level) => {
          const primitives = levelPrimitives.get(`${group}:${level}`) ?? [];
          return primitives.length > 0
            && primitives.every((primitive) => this.#isGltfPrimitiveReadyForLod(primitive));
        },
        (level) => (levelPrimitives.get(`${group}:${level}`) ?? []).length > 0,
      );
      selected.set(group, level);
    }

    return selected;
  }

  #selectedGltfMaterial(
    state: GltfState,
    renderInstanceKey: string,
    primitive: LoadedGltfPrimitive,
    primitiveMaterial: LoadedGltfPrimitiveMaterial,
    instanceIndex: number,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
  ): { readonly level: number; readonly material: LoadedGltfMaterial } {
    const lod = primitiveMaterial.materialLod;
    if (lod === undefined) return { level: 0, material: primitiveMaterial.material };

    const coverage = projectedScreenCoverage(primitive.positions, model, projection, view);
    const level = this.#selectGltfLodLevel(
      `${state.key}:${renderInstanceKey}:material:${primitive.key}:${primitiveMaterial.selectionKey}:instance:${instanceIndex}`,
      coverage,
      lod.levels.length,
      lod.thresholds,
      (level) => {
        const material = lod.levels[level];
        return material !== undefined && this.#isGltfMaterialReadyForLod(material);
      },
      (level) => lod.levels[level] !== undefined,
    );
    return { level, material: lod.levels[level] ?? primitiveMaterial.material };
  }

  #gltfPrimitiveMaterialForVariant(
    state: GltfState,
    node: GltfNode,
    primitive: LoadedGltfPrimitive,
  ): LoadedGltfPrimitiveMaterial {
    const variantIndex = this.#selectedGltfVariantIndex(state, node);
    if (variantIndex !== undefined) {
      const variant = primitive.materialVariants?.find((mapping) => mapping.variants.includes(variantIndex));
      if (variant !== undefined) {
        return {
          material: variant.material,
          ...(variant.materialLod === undefined ? {} : { materialLod: variant.materialLod }),
          selectionKey: `variant:${variantIndex}`,
        };
      }
    }

    return {
      material: primitive.material,
      ...(primitive.materialLod === undefined ? {} : { materialLod: primitive.materialLod }),
      selectionKey: "base",
    };
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
    isReady: (level: number) => boolean,
    isDrawable: (level: number) => boolean,
  ): number {
    const previous = this.#gltfLodSelections.get(selectionKey)?.level;
    const target = hystereticLodLevel(coverage, levelCount, thresholds, previous);
    const selected = this.#drawableGltfLodLevel(target, previous, levelCount, isReady, isDrawable);
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
    isReady: (level: number) => boolean,
    isDrawable: (level: number) => boolean,
  ): number {
    if (isReady(target)) return target;
    if (previous !== undefined && previous >= 0 && previous < levelCount && isDrawable(previous)) {
      return previous;
    }
    for (let level = 0; level < levelCount; level += 1) {
      if (isReady(level)) return level;
    }
    if (isDrawable(target)) return target;
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

  #isGltfPrimitiveReadyForLod(primitive: LoadedGltfPrimitive): boolean {
    const materials = primitive.materialLod?.levels ?? [primitive.material];
    return materials.some((material) => this.#isGltfMaterialReadyForLod(material));
  }

  #isGltfMaterialReadyForLod(material: LoadedGltfMaterial): boolean {
    return this.#isGltfMaterialTextureReady(this.#gltfMaterialTextureRef(material), material.image)
      && this.#isGltfMaterialTextureReady(
        this.#gltfMaterialMetallicRoughnessTextureRef(material),
        material.metallicRoughnessImage,
      )
      && this.#isGltfMaterialTextureReady(
        this.#gltfMaterialEmissiveTextureRef(material),
        material.emissiveImage,
      )
      && this.#isGltfMaterialTextureReady(
        this.#gltfMaterialOcclusionTextureRef(material),
        material.occlusionImage,
      )
      && this.#isGltfMaterialExtensionTexturesReady(material.extensionTextures);
  }

  #isGltfMaterialTextureReady(
    texture: TextureAssetUploadRef | undefined,
    image: LoadedTextureSource | undefined,
  ): boolean {
    if (texture === undefined) return true;
    if (image !== undefined) return true;
    return this.#textures.get(textureCacheKey(texture))?.uploaded === true;
  }

  #gltfMaterialTextureRef(material: LoadedGltfMaterial): TextureAssetUploadRef | undefined {
    if (material.baseColorTextureUri === undefined) return undefined;
    return {
      colorSpace: "srgb",
      flipY: false,
      kind: "asset",
      ...(material.sampler === undefined ? {} : { sampler: material.sampler }),
      uri: material.baseColorTextureUri,
    };
  }

  #gltfMaterialMetallicRoughnessTextureRef(material: LoadedGltfMaterial): TextureAssetUploadRef | undefined {
    if (material.metallicRoughnessTextureUri === undefined) return undefined;
    return {
      colorSpace: "linear",
      flipY: false,
      kind: "asset",
      ...(material.metallicRoughnessSampler === undefined ? {} : { sampler: material.metallicRoughnessSampler }),
      uri: material.metallicRoughnessTextureUri,
    };
  }

  #gltfMaterialEmissiveTextureRef(material: LoadedGltfMaterial): TextureAssetUploadRef | undefined {
    if (material.emissiveTextureUri === undefined) return undefined;
    return {
      colorSpace: "srgb",
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
    setTexture("occlusionTexture", this.#gltfMaterialOcclusionTextureRef(material));
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      setTexture(texture.key, this.#gltfTextureSlotRef(extensionTextures?.[texture.key], texture.colorSpace));
    }

    return textures;
  }

  #isGltfMaterialTextureSlotReady(
    slot: LoadedGltfMaterialTextureSlot | undefined,
    colorSpace: TextureColorSpace,
  ): boolean {
    return this.#isGltfMaterialTextureReady(this.#gltfTextureSlotRef(slot, colorSpace), slot?.image);
  }

  #isGltfMaterialExtensionTexturesReady(
    textures: LoadedGltfMaterialExtensionTextures | undefined,
  ): boolean {
    return GLTF_MATERIAL_EXTENSION_TEXTURES.every((texture) =>
      this.#isGltfMaterialTextureSlotReady(textures?.[texture.key], texture.colorSpace)
    );
  }

  #preloadAdjacentGltfNodeLodTextures(
    primitives: readonly LoadedGltfPrimitive[],
    selectedLevels: ReadonlyMap<string, number>,
  ): void {
    for (const [group, level] of selectedLevels) {
      const lod = primitives.find((primitive) => primitive.nodeLod?.group === group)?.nodeLod;
      if (lod === undefined) continue;
      for (const adjacentLevel of adjacentLodLevels(level, lod.levelCount)) {
        for (const primitive of primitives) {
          if (primitive.nodeLod?.group === group && primitive.nodeLod.level === adjacentLevel) {
            this.#preloadGltfPrimitiveTextures(primitive);
          }
        }
      }
    }
  }

  #preloadAdjacentGltfMaterialLodTextures(
    lod: GltfMaterialPrimitiveLod | undefined,
    selectedLevel: number,
  ): void {
    if (lod === undefined) return;
    for (const level of adjacentLodLevels(selectedLevel, lod.levels.length)) {
      const material = lod.levels[level];
      if (material !== undefined) this.#preloadGltfMaterialTexture(material);
    }
  }

  #preloadGltfPrimitiveTextures(primitive: LoadedGltfPrimitive): void {
    this.#preloadGltfMaterialTexture(primitive.material);
    for (const material of primitive.materialLod?.levels ?? []) {
      this.#preloadGltfMaterialTexture(material);
    }
    for (const variant of primitive.materialVariants ?? []) {
      this.#preloadGltfMaterialTexture(variant.material);
      for (const material of variant.materialLod?.levels ?? []) {
        this.#preloadGltfMaterialTexture(material);
      }
    }
  }

  #preloadGltfMaterialTexture(material: LoadedGltfMaterial): void {
    const texture = this.#gltfMaterialTextureRef(material);
    if (texture !== undefined && material.image !== undefined) this.#ensureImmediateTexture(texture, material.image);
    this.#ensureLoadedGltfMaterialSurfaceTextures(material, this.#gltfMaterialSurfaceTextures(material));
  }

  #ensureLoadedGltfMaterialSurfaceTextures(
    material: LoadedGltfMaterial,
    textures: LoadedGltfSurfaceTextures,
  ): void {
    this.#ensureLoadedGltfTexture(textures.metallicRoughnessTexture, material.metallicRoughnessImage);
    this.#ensureLoadedGltfTexture(textures.emissiveTexture, material.emissiveImage);
    this.#ensureLoadedGltfTexture(textures.occlusionTexture, material.occlusionImage);

    const extensionTextures = material.extensionTextures;
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURES) {
      this.#ensureLoadedGltfTexture(textures[texture.key], extensionTextures?.[texture.key]?.image);
    }
  }

  #ensureLoadedGltfTexture(
    texture: TextureAssetUploadRef | undefined,
    image: LoadedTextureSource | undefined,
  ): void {
    if (texture !== undefined && image !== undefined) this.#ensureImmediateTexture(texture, image);
  }

  #drawGeometry(
    geometry: GeometryResource,
    material: Material,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
    lights: SurfaceLightSet | undefined,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    const gl = this.#gl;
    const virtualTexture = this.#virtualTextureDrawState(geometry, material);
    const useVirtualTexture = virtualTexture !== undefined && this.#isVirtualTextureDrawable(virtualTexture);
    const programKind: ProgramKind = material.kind === "wireframe"
      ? "wireframe"
      : useVirtualTexture ? "surface-vt-base-color" : "surface";
    const programResource = this.#program(programKind);
    const program = programResource.program;
    gl.useProgram(program);

    this.#uniformMatrix(program, "u_projection", projection);
    this.#uniformMatrix(program, "u_view", view);
    this.#uniformMatrix(program, "u_model", model);
    this.#uniformColor(program, "u_color", materialColor(material));
    this.#uniform1i(program, "u_unlit", material.kind === "standard" ? 0 : 1);
    if (programKind === "surface" && material.kind !== "wireframe") {
      this.#uniformColor(program, "u_emissiveColor", materialEmissiveColor(material));
      this.#bindSurfaceMaterialFactors(program, material, transmissionScreenColorTexture);
      this.#bindSurfaceLights(program, material.kind === "standard"
        ? lights ?? DEFAULT_SURFACE_LIGHT_SET
        : EMPTY_SURFACE_LIGHT_SET);
    }

    const useTexture = useVirtualTexture
      ? this.#bindVirtualTexture(program, virtualTexture)
      : material.baseColor.kind === "virtual-asset"
        ? false
        : this.#bindMaterialTexture(program, material);
    if (material.baseColor.kind === "virtual-asset" && !useVirtualTexture && virtualTexture !== undefined) {
      virtualTexture.stats.unreadyDraws += 1;
    }
    this.#uniform1i(program, "u_useTexture", useTexture ? 1 : 0);
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
    instanceBufferKey: string,
    material: SurfaceMaterial,
    models: readonly Mat4[],
    projection: Mat4,
    view: Mat4,
    lights: SurfaceLightSet,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    const gl = this.#gl;
    const programResource = this.#program("surface-instanced");
    const program = programResource.program;
    gl.useProgram(program);

    this.#uniformMatrix(program, "u_projection", projection);
    this.#uniformMatrix(program, "u_view", view);
    this.#uniformColor(program, "u_color", materialColor(material));
    this.#uniformColor(program, "u_emissiveColor", materialEmissiveColor(material));
    this.#uniform1i(program, "u_unlit", material.kind === "standard" ? 0 : 1);
    this.#bindSurfaceMaterialFactors(program, material, transmissionScreenColorTexture);
    this.#bindSurfaceLights(program, material.kind === "standard" ? lights : EMPTY_SURFACE_LIGHT_SET);

    const useTexture = this.#bindMaterialTexture(program, material);
    this.#uniform1i(program, "u_useTexture", useTexture ? 1 : 0);
    this.#bindGeometryAttributes(program, geometry);
    this.#bindGltfInstanceModels(instanceBufferKey, models);

    const mode = webGlDrawMode(gl, geometry.mode);
    if (geometry.indexBuffer === undefined || geometry.indexType === undefined) {
      gl.drawArraysInstanced(mode, 0, geometry.drawCount, models.length);
    } else {
      gl.drawElementsInstanced(mode, geometry.drawCount, geometry.indexType, 0, models.length);
    }

    this.#unbindGltfInstanceModels();
  }

  #bindSurfaceMaterialFactors(
    program: WebGLProgram,
    material: SurfaceMaterial,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
  ): void {
    const factors = surfaceMaterialExtensionFactors(material);
    const hasFiniteAttenuationDistance = Number.isFinite(factors.attenuationDistance);
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
    this.#bindTransmissionScreenColorTexture(program, transmissionScreenColorTexture);
    this.#bindEmissiveTexture(program, material);
    this.#bindMetallicRoughnessTexture(program, material);
    this.#bindOcclusionTexture(program, material);
    this.#bindMaterialExtensionTextures(program, material);
  }

  #bindEmissiveTexture(program: WebGLProgram, material: SurfaceMaterial): void {
    this.#bindCachedTexture2d(
      program,
      "u_useEmissiveTexture",
      "u_emissiveTexture",
      4,
      material.emissiveTexture,
    );
  }

  #bindMetallicRoughnessTexture(program: WebGLProgram, material: SurfaceMaterial): void {
    this.#bindCachedTexture2d(
      program,
      "u_useMetallicRoughnessTexture",
      "u_metallicRoughnessTexture",
      3,
      material.kind === "standard" ? material.metallicRoughnessTexture : undefined,
    );
  }

  #bindOcclusionTexture(program: WebGLProgram, material: SurfaceMaterial): void {
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
      5,
      material.kind === "standard" ? material.occlusionTexture : undefined,
    );
  }

  #bindMaterialExtensionTextures(program: WebGLProgram, material: SurfaceMaterial): void {
    for (const texture of GLTF_MATERIAL_EXTENSION_TEXTURE_BINDINGS) {
      this.#bindCachedTexture2d(
        program,
        texture.useUniform,
        texture.samplerUniform,
        texture.textureUnit,
        material.kind === "standard" ? material[texture.key] : undefined,
      );
    }
  }

  #bindCachedTexture2d(
    program: WebGLProgram,
    useUniform: string,
    samplerUniform: string,
    textureUnit: number,
    texture: TextureAssetUploadRef | undefined,
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
    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    this.#uniform1i(program, samplerUniform, textureUnit);
    this.#uniform1i(program, useUniform, 1);
  }

  #bindTransmissionScreenColorTexture(
    program: WebGLProgram,
    resource: ScreenColorTextureResource | undefined,
  ): void {
    if (resource === undefined || !resource.uploaded) {
      this.#uniform1i(program, "u_useTransmissionTexture", 0);
      return;
    }

    const gl = this.#gl;
    this.#uniform1i(program, "u_useTransmissionTexture", 1);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    this.#uniform1i(program, "u_transmissionScreenTexture", 1);
    this.#uniform2fv(program, "u_viewportSize", [resource.width, resource.height]);
  }

  #bindSurfaceLights(program: WebGLProgram, lightSet: SurfaceLightSet): void {
    bindSurfaceIblUniforms({
      fallbackSpecularTexture: () => this.#fallbackIblSpecularTexture(),
      gl: this.#gl,
      uniform1i: (uniformProgram, name, value) => this.#uniform1i(uniformProgram, name, value),
      uniformColor: (uniformProgram, name, color) => this.#uniformColor(uniformProgram, name, color),
      uniformMatrix: (uniformProgram, name, matrix) => this.#uniformMatrix(uniformProgram, name, matrix),
    }, program, lightSet);

    const lights = lightSet.lights.slice(0, MAX_SURFACE_LIGHTS);
    this.#uniform1i(program, "u_surfaceLightCount", lights.length);

    for (let index = 0; index < MAX_SURFACE_LIGHTS; index += 1) {
      const light = lights[index];
      if (light === undefined) {
        this.#uniform1i(program, `u_surfaceLightKind[${index}]`, 0);
        this.#uniformColor(program, `u_surfaceLightColor[${index}]`, [0, 0, 0, 1]);
        this.#uniformColor(program, `u_surfaceLightDirection[${index}]`, [0, -1, 0, 0]);
        this.#uniformColor(program, `u_surfaceLightPosition[${index}]`, [0, 0, 0, 0]);
        this.#uniformColor(program, `u_surfaceLightCone[${index}]`, [1, 0, 0, 0]);
        continue;
      }

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
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.arrayBuffer);
    const positionLocation = gl.getAttribLocation(program, "a_position");
    if (positionLocation >= 0) {
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    }
    const uvLocation = gl.getAttribLocation(program, "a_uv");
    if (uvLocation >= 0) {
      if (geometry.texCoordBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.texCoordBuffer);
        gl.enableVertexAttribArray(uvLocation);
        gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray?.(uvLocation);
      }
    }
    const normalLocation = gl.getAttribLocation(program, "a_normal");
    if (normalLocation >= 0) {
      if (geometry.normalBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normalBuffer);
        gl.enableVertexAttribArray(normalLocation);
        gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray?.(normalLocation);
      }
    }
    if (geometry.indexBuffer !== undefined && geometry.indexType !== undefined) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
    }
  }

  #bindGltfInstanceModels(key: string, models: readonly Mat4[]): void {
    const gl = this.#gl;
    const floatCount = models.length * 16;
    const resource = this.#gltfInstanceBufferResource(key, floatCount);
    const { data } = resource;
    let changed = resource.dirty;
    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const model = models[modelIndex]!;
      const offset = modelIndex * 16;
      for (let elementIndex = 0; elementIndex < 16; elementIndex += 1) {
        const value = model[elementIndex]!;
        if (data[offset + elementIndex] !== value) {
          changed = true;
          data[offset + elementIndex] = value;
        }
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, resource.buffer);
    if (changed) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, floatCount);
      resource.dirty = false;
    }
    for (let column = 0; column < 4; column += 1) {
      const location = 3 + column;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 64, column * 16);
      gl.vertexAttribDivisor(location, 1);
    }
  }

  #unbindGltfInstanceModels(): void {
    const gl = this.#gl;
    for (let column = 0; column < 4; column += 1) {
      const location = 3 + column;
      gl.vertexAttribDivisor(location, 0);
      gl.disableVertexAttribArray?.(location);
    }
  }

  #gltfInstanceBufferResource(key: string, requiredFloatCount: number): GltfInstanceBufferResource {
    this.#activeGltfInstanceBufferKeys.add(key);
    const existing = this.#gltfInstanceBuffers.get(key);
    if (existing !== undefined && existing.capacity >= requiredFloatCount) return existing;

    const buffer = existing?.buffer ?? this.#createBuffer();
    const data = new Float32Array(requiredFloatCount);
    if (existing !== undefined) {
      data.set(existing.data.subarray(0, Math.min(existing.data.length, data.length)));
    }

    const resource: GltfInstanceBufferResource = {
      buffer,
      capacity: requiredFloatCount,
      data,
      dirty: true,
    };
    this.#gltfInstanceBuffers.set(key, resource);

    const gl = this.#gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, requiredFloatCount * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);
    return resource;
  }

  #releaseUnusedGltfInstanceBuffers(): void {
    for (const [key, resource] of this.#gltfInstanceBuffers) {
      if (this.#activeGltfInstanceBufferKeys.has(key)) continue;
      this.#deleteBuffer(resource.buffer);
      this.#gltfInstanceBuffers.delete(key);
    }
  }

  #bindMaterialTexture(program: WebGLProgram, material: Material): boolean {
    if (material.baseColor.kind === "solid") return false;
    let resource: TextureResource | TextureLoadState;
    if (material.baseColor.kind === "virtual-asset") {
      this.#recordUnsupportedVirtualTexture(material.baseColor, "only unlit base-color virtual textures on UV geometry are supported");
      return false;
    } else {
      resource = this.#texture(material.baseColor);
    }
    if (!resource.uploaded) return false;
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    const location = gl.getUniformLocation(program, "u_texture");
    if (location !== null) gl.uniform1i(location, 0);
    return true;
  }

  #virtualTextureDrawState(
    geometry: GeometryResource,
    material: Material,
  ): VirtualTextureRuntimeState | undefined {
    if (material.baseColor.kind !== "virtual-asset") return undefined;
    if (material.kind !== "unlit") {
      this.#recordUnsupportedVirtualTexture(material.baseColor, "only unlit base-color virtual textures are supported");
      return undefined;
    }
    if (geometry.mode !== "triangles" || geometry.texCoordBuffer === undefined) {
      this.#recordUnsupportedVirtualTexture(material.baseColor, "virtual textures require triangle geometry with UVs");
      return undefined;
    }

    const state = this.#virtualTexture(material.baseColor);
    if (state.status === "ready" && state.loadingPages.size === 0) {
      this.#demandVirtualTexturePages(state);
    }
    return state;
  }

  #virtualTexture(texture: VirtualTextureRef): VirtualTextureRuntimeState {
    const key = textureCacheKey(texture);
    const cached = this.#virtualTextures.get(key);
    if (cached !== undefined) return cached;

    const state: VirtualTextureRuntimeState = {
      diagnostics: [],
      key,
      loadingPages: new Set(),
      requestedPages: new Set(),
      stats: {
        manifestFailures: 0,
        manifestRequests: 1,
        pageTableUpdates: 0,
        shaderBinds: 0,
        unreadyDraws: 0,
        unsupportedDraws: 0,
        uploadedPages: 0,
      },
      status: "loading",
      texture,
      uploadedPages: new Set(),
    };
    this.#virtualTextures.set(key, state);
    void this.#loadVirtualTextureManifest(state);

    return state;
  }

  async #loadVirtualTextureManifest(state: VirtualTextureRuntimeState): Promise<void> {
    try {
      const response = await fetch(state.texture.manifestUri);
      if (this.#disposed || this.#virtualTextures.get(state.key) !== state) return;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const payload = await response.json() as unknown;
      if (this.#disposed || this.#virtualTextures.get(state.key) !== state) return;

      const parsed = parseVirtualTextureManifest(payload);
      for (const diagnostic of parsed.diagnostics) {
        const message = `Virtual texture ${state.texture.manifestUri}: ${diagnostic.message}`;
        state.diagnostics.push(message);
        this.#recordDiagnostic(message);
      }
      if (parsed.manifest === undefined) {
        this.#failVirtualTexture(state, "manifest parse failed");
        return;
      }

      state.manifest = parsed.manifest;
      const unsupported = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "unsupported")
        ?? this.#unsupportedVirtualTextureRuntimeReason(parsed.manifest);
      if (unsupported !== undefined) {
        this.#markVirtualTextureUnsupported(
          state,
          typeof unsupported === "string" ? unsupported : unsupported.message,
        );
        return;
      }

      this.#allocateVirtualTextureResources(state, parsed.manifest);
      state.status = "ready";
      this.#demandVirtualTexturePages(state);
      this.invalidate();
    } catch (error) {
      if (this.#disposed || this.#virtualTextures.get(state.key) !== state) return;
      this.#failVirtualTexture(state, error instanceof Error ? error.message : String(error));
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
      gl.RGBA8,
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

  #demandVirtualTexturePages(state: VirtualTextureRuntimeState): void {
    const manifest = state.manifest;
    if (manifest === undefined) return;

    const budget = this.#virtualTexturePhysicalSlots(manifest);
    let requested = 0;
    for (const page of this.#virtualTextureDemandCandidates(manifest)) {
      if (requested >= budget) break;
      if (this.#requestVirtualTexturePage(state, page)) requested += 1;
    }
  }

  #virtualTextureDemandCandidates(manifest: VirtualTextureManifestModel): readonly VirtualTexturePageId[] {
    const candidates = new Map<string, VirtualTexturePageId>();
    for (const page of manifest.pages) {
      if (virtualTexturePageUri(manifest, page) !== undefined) {
        candidates.set(virtualTexturePageKey(page), page);
      }
    }

    if (manifest.uriTemplate !== undefined) {
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

  #virtualTextureMipCount(manifest: VirtualTextureManifestModel): number {
    if (manifest.mipCount !== undefined) return manifest.mipCount;
    const baseWidth = Math.ceil(manifest.width / manifest.pageSize);
    const baseHeight = Math.ceil(manifest.height / manifest.pageSize);
    return Math.max(1, Math.floor(Math.log2(Math.max(baseWidth, baseHeight))) + 1);
  }

  #requestVirtualTexturePage(state: VirtualTextureRuntimeState, page: VirtualTexturePageId): boolean {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") return false;
    const pageKey = virtualTexturePageKey(page);
    if (
      state.requestedPages.has(pageKey)
      || state.loadingPages.has(pageKey)
      || state.uploadedPages.has(pageKey)
    ) {
      return false;
    }

    const uri = virtualTexturePageUri(manifest, page);
    if (uri === undefined) return false;

    state.requestedPages.add(pageKey);
    state.loadingPages.add(pageKey);
    loadImage(resolveResourceUri(state.texture.manifestUri, uri)).then((image) => {
      if (
        this.#disposed
        || this.#virtualTextures.get(state.key) !== state
        || state.status !== "ready"
      ) {
        return;
      }
      state.loadingPages.delete(pageKey);
      this.#uploadVirtualTexturePage(state, page, image);
      this.invalidate();
    }, (error: unknown) => {
      if (this.#disposed || this.#virtualTextures.get(state.key) !== state) return;
      state.loadingPages.delete(pageKey);
      const message = `Virtual texture page load failed for ${state.texture.manifestUri} ${pageKey}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      state.diagnostics.push(message);
      this.#recordDiagnostic(message);
    });

    return true;
  }

  #uploadVirtualTexturePage(
    state: VirtualTextureRuntimeState,
    page: VirtualTexturePageId,
    image: HTMLImageElement | ImageBitmap,
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
    const slotX = assignment.slot % resources.atlasGridColumns;
    const slotY = Math.floor(assignment.slot / resources.atlasGridColumns);
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, resources.atlasTexture);
    if (typeof gl.pixelStorei === "function" && gl.UNPACK_FLIP_Y_WEBGL !== undefined) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
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
      for (const cell of this.#expandedVirtualTexturePageTableCells(resources, update)) {
        const payload = new Uint8Array(encodeVirtualTexturePageTableRgba8({
          fallbackMipOffset: cell.fallbackMipOffset,
          ...(update.slot === undefined ? {} : { slot: update.slot }),
        }));
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          cell.x,
          cell.y,
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          payload,
        );
        state.stats.pageTableUpdates += 1;
      }
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

  #expandedVirtualTexturePageTableCells(
    resources: VirtualTextureResourceSet,
    update: VirtualTexturePageTableUpdate,
  ): readonly { readonly fallbackMipOffset: number; readonly x: number; readonly y: number }[] {
    const coverage = 2 ** update.page.mip;
    const minX = update.page.x * coverage;
    const minY = update.page.y * coverage;
    const maxX = Math.min(resources.pageTableWidth, minX + coverage);
    const maxY = Math.min(resources.pageTableHeight, minY + coverage);
    const fallbackMipOffset = update.slot === undefined
      ? 0
      : update.fallbackMipOffset === undefined
        ? update.page.mip
        : update.page.mip + update.fallbackMipOffset;
    const cells: { readonly fallbackMipOffset: number; readonly x: number; readonly y: number }[] = [];
    for (let y = minY; y < maxY; y += 1) {
      for (let x = minX; x < maxX; x += 1) {
        cells.push({ fallbackMipOffset, x, y });
      }
    }

    return cells;
  }

  #isVirtualTextureDrawable(state: VirtualTextureRuntimeState): boolean {
    return state.status === "ready"
      && state.resources !== undefined
      && state.pageTable !== undefined
      && state.uploadedPages.size > 0;
  }

  #bindVirtualTexture(program: WebGLProgram, state: VirtualTextureRuntimeState): boolean {
    const resources = state.resources;
    const manifest = state.manifest;
    if (resources === undefined || manifest === undefined || !this.#isVirtualTextureDrawable(state)) return false;

    this.#flushVirtualTexturePageTableUpdates(state);
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resources.atlasTexture);
    this.#uniform1i(program, "u_vtAtlas", 0);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, resources.pageTableTexture);
    this.#uniform1i(program, "u_vtPageTable", 1);
    this.#uniform2fv(program, "u_vtPageTableSize", [resources.pageTableWidth, resources.pageTableHeight]);
    this.#uniform2fv(program, "u_vtAtlasGrid", [resources.atlasGridColumns, resources.atlasGridRows]);
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
    const message = `Virtual texture ${state.texture.manifestUri} failed: ${reason}`;
    state.diagnostics.push(message);
    this.#recordDiagnostic(message);
  }

  #markVirtualTextureUnsupported(state: VirtualTextureRuntimeState, reason: string): void {
    state.status = "unsupported";
    state.stats.unsupportedDraws += 1;
    const message = `Virtual texture ${state.texture.manifestUri} unsupported: ${reason}. Rendering with material color only.`;
    state.diagnostics.push(message);
    this.#recordDiagnostic(message);
    this.invalidate();
  }

  #uniformMatrix(program: WebGLProgram, name: string, matrix: Mat4): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniformMatrix4fv(location, false, new Float32Array(matrix));
  }

  #uniformColor(program: WebGLProgram, name: string, color: Rgba): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniform4fv(location, new Float32Array(color));
  }

  #uniform1i(program: WebGLProgram, name: string, value: number): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniform1i(location, value);
  }

  #uniform2fv(program: WebGLProgram, name: string, value: readonly [number, number]): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniform2fv(location, new Float32Array(value));
  }

  #program(kind: ProgramKind): ProgramResource {
    const cached = this.#programs.get(kind);
    if (cached !== undefined) return cached;

    const program = this.#compileProgram(kind);
    this.#programs.set(kind, program);
    return program;
  }

  #compileProgram(kind: ProgramKind): ProgramResource {
    const gl = this.#gl;
    const program = gl.createProgram();
    if (program === null) throw new Error("WebGL program creation failed");
    this.#ownedPrograms.add(program);

    let vertexShader: WebGLShader | undefined;
    let fragmentShader: WebGLShader | undefined;

    try {
      vertexShader = this.#compileShader(gl.VERTEX_SHADER, vertexShaderSource(kind));
      fragmentShader = this.#compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource(kind));
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.bindAttribLocation?.(program, 0, "a_position");
      gl.bindAttribLocation?.(program, 1, "a_normal");
      gl.bindAttribLocation?.(program, 2, "a_uv");
      gl.bindAttribLocation?.(program, 3, "a_instanceModel");
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
      drawCount: cpu.indices?.length ?? cpu.positions.length / 3,
      ...(indexBuffer === undefined ? {} : { indexBuffer }),
      ...(indexType === undefined ? {} : { indexType }),
      key: cpu.key,
      mode: cpu.mode,
      ...(normalBuffer === undefined ? {} : { normalBuffer }),
      ...(texCoordBuffer === undefined ? {} : { texCoordBuffer }),
    };
    this.#geometry.set(cpu.key, resource);
    return resource;
  }

  #releaseUnusedGeometry(used: Set<string>): void {
    for (const [key, resource] of this.#geometry) {
      if (used.has(key)) continue;
      if (resource.borrowedVertexBufferKey === undefined) {
        this.#deleteBuffer(resource.arrayBuffer);
        if (resource.normalBuffer !== undefined) this.#deleteBuffer(resource.normalBuffer);
        if (resource.texCoordBuffer !== undefined) this.#deleteBuffer(resource.texCoordBuffer);
      }
      if (resource.indexBuffer !== undefined) this.#deleteBuffer(resource.indexBuffer);
      this.#geometry.delete(key);
    }
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

    loadImage(texture.uri).then((image) => {
      if (this.#disposed) return;
      state.loading = false;
      this.#uploadTexture(state, image, texture);
      this.invalidate();
    }, (error: unknown) => {
      if (this.#disposed) return;
      state.loading = false;
      state.error = `Texture image load failed for ${texture.uri}: ${error instanceof Error ? error.message : String(error)}`;
      this.#recordDiagnostic(state.error);
    });

    return state;
  }

  #ensureImmediateTexture(texture: TextureAssetUploadRef, image: LoadedTextureSource): TextureResource {
    const key = textureCacheKey(texture);
    const cached = this.#textures.get(key);
    if (cached !== undefined && cached.uploaded) return cached;

    const resource: TextureResource = cached ?? {
      key,
      texture: this.#createTexture(),
      uploaded: false,
    };
    this.#textures.set(key, resource);
    this.#uploadTexture(resource, image, texture);
    return resource;
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

  #fallbackIblSpecularTexture(): WebGLTexture {
    if (this.#iblFallbackSpecularTexture !== undefined) return this.#iblFallbackSpecularTexture;

    const texture = createFallbackIblSpecularTexture({
      createTexture: () => this.#createTexture(),
      gl: this.#gl,
    });
    this.#iblFallbackSpecularTexture = texture;

    return texture;
  }

  #copyTransmissionScreenColorTexture(viewportSize: ViewportSize): ScreenColorTextureResource {
    const [width, height] = viewportSize;
    const resource = this.#transmissionScreenColorTextureResource();
    const gl = this.#gl;

    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
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
    if (typeof gl.pixelStorei === "function" && gl.UNPACK_FLIP_Y_WEBGL !== undefined) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY ?? true);
    }
    if (isDecodedRgbaTexture(source)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    const sampler = texture.sampler;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, samplerConstant(gl, sampler?.magFilter, gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, samplerConstant(gl, sampler?.minFilter, gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, samplerConstant(gl, sampler?.wrapS, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, samplerConstant(gl, sampler?.wrapT, gl.CLAMP_TO_EDGE));
    if (usesMipmaps(sampler?.minFilter)) gl.generateMipmap(gl.TEXTURE_2D);
    resource.uploaded = true;
  }

  #gltfState(node: GltfNode): GltfState {
    const key = `gltf:${node.asset.uri}:${node.asset.version ?? ""}`;
    const cached = this.#gltf.get(key);
    if (cached !== undefined) return cached;

    const state: GltfState = {
      key,
      lights: [],
      primitives: [],
      status: "loading",
      variants: [],
    };
    this.#gltf.set(key, state);

    void this.#loadGltf(node.src, state);
    return state;
  }

  async #loadGltf(src: string, state: GltfState): Promise<void> {
    try {
      const { binaryChunk, document } = await loadGltfDocument(src);
      if (this.#disposed) return;
      assertSupportedRequiredGltfExtensions(src, document);
      if (this.#disposed) return;
      const loadedBuffers = await loadGltfBuffers(src, document, binaryChunk);
      if (this.#disposed) return;
      const { buffers, document: decodedDocument } = await decodeGltfMeshoptBufferViews(document, loadedBuffers);
      if (this.#disposed) return;
      const dracoPrimitives = await decodeGltfDracoPrimitives(decodedDocument, buffers);
      if (this.#disposed) return;
      const scene = this.#readGltfScene(decodedDocument, buffers, dracoPrimitives, src, state.key);
      if (scene.imageBasedLight === undefined) {
        delete state.imageBasedLight;
      } else {
        state.imageBasedLight = scene.imageBasedLight;
      }
      state.lights = scene.lights;
      state.primitives = scene.primitives;
      state.variants = scene.variants;
      state.status = "ready";
      this.invalidate();
      this.#loadGltfImages(src, decodedDocument, buffers, state);
    } catch (error) {
      if (this.#disposed) return;
      state.status = "error";
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
        referencedLodNodes,
        variants.length,
      );
    }

    return {
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

    const nodeModel = multiplyMat4(parentModel, gltfNodeMat4(sceneNode));
    this.#appendGltfNodeLight(document, lights, sceneNode, nodeIndex, nodeModel);
    const localModels = this.#gltfNodeInstanceModels(document, buffers, sceneNode, nodeIndex, nodeModel);
    const mesh = sceneNode?.mesh === undefined ? undefined : document.meshes?.[sceneNode.mesh];
    for (const [primitiveIndex, primitive] of (mesh?.primitives ?? []).entries()) {
      const dracoPrimitive = dracoPrimitives.get(primitive);
      const decodedAttributes = dracoPrimitive?.attributes;
      const positionAccessor = primitive.attributes?.POSITION;
      const normalAccessor = primitive.attributes?.NORMAL;
      const indexAccessor = primitive.indices;
      const positions = decodedAttributes?.get("POSITION")
        ?? (positionAccessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, positionAccessor));
      if (positions === undefined) continue;
      const mode = gltfPrimitiveMode(primitive.mode);
      if (mode === undefined) {
        this.#recordDiagnostic(`glTF primitive ${nodeIndex}:${primitiveIndex} skipped: unsupported primitive mode ${primitive.mode ?? 4}`);
        continue;
      }
      const normals = decodedAttributes?.get("NORMAL")
        ?? (normalAccessor === undefined ? undefined : readGltfFloatAccessor(document, buffers, normalAccessor));
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
      const key = `node:${nodeIndex}:primitive:${primitiveIndex}`;
      primitives.push({
        ...(indices === undefined ? {} : { indices }),
        key,
        localModels,
        material,
        ...(materialLod === undefined ? {} : { materialLod }),
        ...(materialVariants.length === 0 ? {} : { materialVariants }),
        mode,
        ...(nodeLod === undefined ? {} : { nodeLod }),
        ...(normals === undefined ? {} : { normals }),
        positions,
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

  #gltfNodeInstanceModels(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    sceneNode: GltfSceneNode,
    nodeIndex: number,
    nodeModel: Mat4,
  ): readonly Mat4[] {
    const attributes = sceneNode.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (attributes === undefined) return [nodeModel];

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
      multiplyMat4(nodeModel, gltfInstanceTransformMat4(translations, rotations, scales, index)));
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
    const clearcoat = material?.extensions?.KHR_materials_clearcoat;
    if (clearcoat?.clearcoatNormalTexture !== undefined) {
      this.#recordUnsupportedGltfMaterialExtensionTexture(materialIndex, "KHR_materials_clearcoat.clearcoatNormalTexture");
    }
  }

  #recordUnsupportedGltfMaterialExtensionTexture(
    materialIndex: number | undefined,
    field: string,
  ): void {
    const materialLabel = materialIndex === undefined ? "default material" : `material ${materialIndex}`;
    const message = `glTF ${materialLabel} ${field} is ignored: Royal does not yet support extension normal maps; clearcoat normals require tangent-space normal-map support.`;
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
    const baseColorTextureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    const baseColorTexture = baseColorTextureIndex === undefined ? undefined : document.textures?.[baseColorTextureIndex];
    const baseColorImageSelection = gltfTextureImageSelection(baseColorTexture);
    const baseColorImageIndex = baseColorImageSelection?.imageIndex;
    const baseColorImageKind = baseColorImageSelection?.kind ?? "image";
    const baseColorImage = baseColorImageIndex === undefined ? undefined : document.images?.[baseColorImageIndex];
    const baseColorImageLoadKey = baseColorImage === undefined
      ? undefined
      : gltfImageLoadKey(assetKey, src, baseColorImageIndex, baseColorImage, baseColorImageKind);
    const sampler = baseColorTexture === undefined
      ? undefined
      : gltfTextureSampler(baseColorTexture.sampler === undefined ? undefined : document.samplers?.[baseColorTexture.sampler]);
    const metallicRoughnessTextureIndex = material?.pbrMetallicRoughness?.metallicRoughnessTexture?.index;
    const metallicRoughnessTexture = metallicRoughnessTextureIndex === undefined
      ? undefined
      : document.textures?.[metallicRoughnessTextureIndex];
    const metallicRoughnessImageSelection = gltfTextureImageSelection(metallicRoughnessTexture);
    const metallicRoughnessImageIndex = metallicRoughnessImageSelection?.imageIndex;
    const metallicRoughnessImageKind = metallicRoughnessImageSelection?.kind ?? "image";
    const metallicRoughnessImage = metallicRoughnessImageIndex === undefined
      ? undefined
      : document.images?.[metallicRoughnessImageIndex];
    const metallicRoughnessImageLoadKey = metallicRoughnessImage === undefined
      ? undefined
      : gltfImageLoadKey(
        assetKey,
        src,
        metallicRoughnessImageIndex,
        metallicRoughnessImage,
        metallicRoughnessImageKind,
      );
    const metallicRoughnessSampler = metallicRoughnessTexture === undefined
      ? undefined
      : gltfTextureSampler(
        metallicRoughnessTexture.sampler === undefined
          ? undefined
          : document.samplers?.[metallicRoughnessTexture.sampler],
      );
    const emissiveTextureIndex = material?.emissiveTexture?.index;
    const emissiveTexture = emissiveTextureIndex === undefined ? undefined : document.textures?.[emissiveTextureIndex];
    const emissiveImageSelection = gltfTextureImageSelection(emissiveTexture);
    const emissiveImageIndex = emissiveImageSelection?.imageIndex;
    const emissiveImageKind = emissiveImageSelection?.kind ?? "image";
    const emissiveImage = emissiveImageIndex === undefined ? undefined : document.images?.[emissiveImageIndex];
    const emissiveImageLoadKey = emissiveImage === undefined
      ? undefined
      : gltfImageLoadKey(assetKey, src, emissiveImageIndex, emissiveImage, emissiveImageKind);
    const emissiveSampler = emissiveTexture === undefined
      ? undefined
      : gltfTextureSampler(
        emissiveTexture.sampler === undefined
          ? undefined
          : document.samplers?.[emissiveTexture.sampler],
      );
    const occlusionTextureIndex = material?.occlusionTexture?.index;
    const occlusionTexture = occlusionTextureIndex === undefined ? undefined : document.textures?.[occlusionTextureIndex];
    const occlusionImageSelection = gltfTextureImageSelection(occlusionTexture);
    const occlusionImageIndex = occlusionImageSelection?.imageIndex;
    const occlusionImageKind = occlusionImageSelection?.kind ?? "image";
    const occlusionImage = occlusionImageIndex === undefined ? undefined : document.images?.[occlusionImageIndex];
    const occlusionImageLoadKey = occlusionImage === undefined
      ? undefined
      : gltfImageLoadKey(assetKey, src, occlusionImageIndex, occlusionImage, occlusionImageKind);
    const occlusionSampler = occlusionTexture === undefined
      ? undefined
      : gltfTextureSampler(
        occlusionTexture.sampler === undefined
          ? undefined
          : document.samplers?.[occlusionTexture.sampler],
      );
    const color = gltfColor(material?.pbrMetallicRoughness?.baseColorFactor);
    const emissive = gltfEmissiveColor(material);
    const extensionFactors = readGltfMaterialExtensionFactors(material);
    const extensionTextures = gltfMaterialExtensionTextureSlots(document, assetKey, src, material);
    const metallicFactor = gltfMetallicRoughnessFactor(material?.pbrMetallicRoughness?.metallicFactor, 1);
    const occlusionStrength = gltfOcclusionStrength(material?.occlusionTexture?.strength);
    const roughnessFactor = gltfMetallicRoughnessFactor(material?.pbrMetallicRoughness?.roughnessFactor, 1);
    const texCoords = gltfMaterialTexCoords(document, buffers, primitive, materialIndex, decodedAttributes);

    return {
      ...(baseColorImageLoadKey === undefined ? {} : { baseColorImageUri: baseColorImageLoadKey }),
      ...(baseColorTextureIndex === undefined || baseColorImage === undefined
        ? {}
        : {
          baseColorTextureUri: gltfTextureIdentity(
            assetKey,
            src,
            baseColorTextureIndex,
            baseColorImageIndex,
            baseColorImage,
            baseColorImageKind,
          ),
        }),
      ...(metallicRoughnessImageLoadKey === undefined
        ? {}
        : { metallicRoughnessImageUri: metallicRoughnessImageLoadKey }),
      ...(metallicRoughnessTextureIndex === undefined || metallicRoughnessImage === undefined
        ? {}
        : {
          metallicRoughnessTextureUri: gltfTextureIdentity(
            assetKey,
            src,
            metallicRoughnessTextureIndex,
            metallicRoughnessImageIndex,
            metallicRoughnessImage,
            metallicRoughnessImageKind,
          ),
        }),
      ...(emissiveImageLoadKey === undefined ? {} : { emissiveImageUri: emissiveImageLoadKey }),
      ...(emissiveTextureIndex === undefined || emissiveImage === undefined
        ? {}
        : {
          emissiveTextureUri: gltfTextureIdentity(
            assetKey,
            src,
            emissiveTextureIndex,
            emissiveImageIndex,
            emissiveImage,
            emissiveImageKind,
          ),
        }),
      ...(occlusionImageLoadKey === undefined ? {} : { occlusionImageUri: occlusionImageLoadKey }),
      ...(occlusionTextureIndex === undefined || occlusionImage === undefined
        ? {}
        : {
          occlusionTextureUri: gltfTextureIdentity(
            assetKey,
            src,
            occlusionTextureIndex,
            occlusionImageIndex,
            occlusionImage,
            occlusionImageKind,
          ),
        }),
      ...(color === undefined ? {} : { color }),
      ...(emissive === undefined ? {} : { emissive }),
      ...(extensionFactors === undefined ? {} : { extensionFactors }),
      ...(extensionTextures === undefined ? {} : { extensionTextures }),
      doubleSided: material?.doubleSided === true,
      metallicFactor,
      occlusionStrength,
      roughnessFactor,
      ...(emissiveSampler === undefined ? {} : { emissiveSampler }),
      ...(metallicRoughnessSampler === undefined ? {} : { metallicRoughnessSampler }),
      ...(occlusionSampler === undefined ? {} : { occlusionSampler }),
      ...(sampler === undefined ? {} : { sampler }),
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
    for (const [imageIndex, image] of (document.images ?? []).entries()) {
      for (const kind of ["image", "basisu", "svg"] as const) {
        const key = gltfImageLoadKey(state.key, src, imageIndex, image, kind);
        if (key === undefined) continue;
        if (!usedImageKeys.has(key)) continue;
        loadGltfImageSource(src, document, buffers, image, kind).then((loadedImage) => {
          if (this.#disposed || state.status !== "ready") return;
          state.primitives = state.primitives.map((primitive) =>
            this.#mapGltfPrimitiveMaterials(primitive, (material) =>
              this.#settleGltfMaterialImage(material, key, loadedImage)));
          if (kind === "image" && state.imageBasedLight?.specular !== undefined) {
            this.#settleIblSpecularImage(state.imageBasedLight.specular, key, loadedImage);
          }
          this.invalidate();
        }, (error: unknown) => {
          if (this.#disposed) return;
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
    return {
      ...primitive,
      material: mapMaterial(primitive.material),
      ...(primitive.materialLod === undefined
        ? {}
        : {
          materialLod: {
            ...primitive.materialLod,
            levels: primitive.materialLod.levels.map(mapMaterial),
          },
        }),
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
    image: LoadedTextureSource,
  ): LoadedGltfMaterial {
    const extensionTextures = this.#settleGltfMaterialExtensionTextureImages(material.extensionTextures, uri, image);
    return {
      ...material,
      ...(material.baseColorImageUri === uri ? { image } : {}),
      ...(material.emissiveImageUri === uri ? { emissiveImage: image } : {}),
      ...(material.metallicRoughnessImageUri === uri ? { metallicRoughnessImage: image } : {}),
      ...(material.occlusionImageUri === uri ? { occlusionImage: image } : {}),
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

  #settleGltfMaterialTextureSlot(
    slot: LoadedGltfMaterialTextureSlot | undefined,
    uri: string,
    image: LoadedTextureSource,
  ): LoadedGltfMaterialTextureSlot | undefined {
    if (slot === undefined) return undefined;
    return slot.imageUri === uri ? { ...slot, image } : slot;
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
      if (!this.#disposed && this.#latestScene !== undefined) this.render(this.#latestScene);
    });
  }

  #createBuffer(): WebGLBuffer {
    const buffer = this.#gl.createBuffer();
    if (buffer === null) throw new Error("WebGL buffer creation failed");
    this.#ownedBuffers.add(buffer);
    return buffer;
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

  #deleteShader(shader: WebGLShader): void {
    if (!this.#ownedShaders.has(shader)) return;
    this.#gl.deleteShader(shader);
    this.#ownedShaders.delete(shader);
  }

  #deleteProgram(program: WebGLProgram): void {
    if (!this.#ownedPrograms.has(program)) return;
    this.#gl.deleteProgram(program);
    this.#ownedPrograms.delete(program);
  }

  #recordDiagnostic(message: string): void {
    this.#diagnostics = [...this.#diagnostics, message];
    console.warn(message);
  }

  #virtualTexturingSnapshot(): WebGlVirtualTexturingSnapshot {
    let atlasTextures = 0;
    let manifestFailures = 0;
    let manifestRequests = 0;
    let manifestsReady = 0;
    let pageTableTextures = 0;
    let pageTableUpdates = 0;
    let pendingPages = 0;
    let requestedPages = 0;
    let residentPages = 0;
    let shaderBinds = 0;
    let unreadyDraws = 0;
    let unsupportedDraws = this.#unsupportedVirtualTextureDraws;
    let uploadedPages = 0;

    for (const state of this.#virtualTextures.values()) {
      if (state.resources !== undefined) {
        atlasTextures += 1;
        pageTableTextures += 1;
      }
      manifestFailures += state.stats.manifestFailures;
      manifestRequests += state.stats.manifestRequests;
      if (state.status === "ready") manifestsReady += 1;
      pageTableUpdates += state.stats.pageTableUpdates;
      pendingPages += state.loadingPages.size;
      requestedPages += state.requestedPages.size;
      residentPages += state.pageTable?.residentCount ?? 0;
      shaderBinds += state.stats.shaderBinds;
      unreadyDraws += state.stats.unreadyDraws;
      unsupportedDraws += state.stats.unsupportedDraws;
      uploadedPages += state.uploadedPages.size;
    }

    return {
      atlasTextures,
      manifestFailures,
      manifestRequests,
      manifestsReady,
      pageTableTextures,
      pageTableUpdates,
      pendingPages,
      requestedPages,
      residentPages,
      shaderBinds,
      unreadyDraws,
      unsupportedDraws,
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
