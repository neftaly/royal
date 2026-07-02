export type GltfDocument = {
  readonly accessors?: readonly GltfAccessor[];
  readonly bufferViews?: readonly GltfBufferView[];
  readonly buffers?: readonly GltfBuffer[];
  readonly extensions?: {
    readonly KHR_lights_punctual?: {
      readonly lights?: readonly GltfPunctualLight[];
    };
    readonly KHR_materials_variants?: {
      readonly variants?: readonly {
        readonly name?: string;
      }[];
    };
  };
  readonly extensionsRequired?: readonly string[];
  readonly extensionsUsed?: readonly string[];
  readonly images?: readonly GltfImage[];
  readonly materials?: readonly GltfMaterial[];
  readonly meshes?: readonly GltfMesh[];
  readonly nodes?: readonly GltfSceneNode[];
  readonly samplers?: readonly GltfSampler[];
  readonly scene?: number;
  readonly scenes?: readonly GltfScene[];
  readonly textures?: readonly GltfTexture[];
};

export type GltfAccessor = {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly normalized?: boolean;
  readonly sparse?: {
    readonly count: number;
    readonly indices: {
      readonly bufferView: number;
      readonly byteOffset?: number;
      readonly componentType: number;
    };
    readonly values: {
      readonly bufferView: number;
      readonly byteOffset?: number;
    };
  };
  readonly type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
};

export type GltfBufferView = {
  readonly buffer?: number;
  readonly byteLength: number;
  readonly byteOffset?: number;
  readonly byteStride?: number;
  readonly extensions?: {
    readonly EXT_meshopt_compression?: GltfMeshoptCompressionExtension;
    readonly [name: string]: unknown;
  };
  readonly target?: number;
};

export type GltfMeshoptCompressionExtension = {
  readonly buffer: number;
  readonly byteLength: number;
  readonly byteOffset?: number;
  readonly byteStride: number;
  readonly count: number;
  readonly filter?: string;
  readonly mode: string;
};

export type GltfMeshGpuInstancingExtension = {
  readonly attributes?: {
    readonly ROTATION?: number;
    readonly SCALE?: number;
    readonly TRANSLATION?: number;
    readonly [semantic: string]: number | undefined;
  };
};

export type GltfBuffer = {
  readonly byteLength?: number;
  readonly extensions?: {
    readonly EXT_meshopt_compression?: {
      readonly fallback?: boolean;
    };
  };
  readonly uri?: string;
};

export type GltfPunctualLight = {
  readonly color?: readonly number[];
  readonly intensity?: number;
  readonly name?: string;
  readonly range?: number;
  readonly spot?: {
    readonly innerConeAngle?: number;
    readonly outerConeAngle?: number;
  };
  readonly type?: "directional" | "point" | "spot";
};

export type GltfImage = {
  readonly bufferView?: number;
  readonly mimeType?: string;
  readonly uri?: string;
};

export type GltfSampler = {
  readonly magFilter?: number;
  readonly minFilter?: number;
  readonly wrapS?: number;
  readonly wrapT?: number;
};

export type GltfMaterial = {
  readonly emissiveFactor?: readonly number[];
  readonly emissiveTexture?: {
    readonly index?: number;
    readonly texCoord?: number;
  };
  readonly extensions?: {
    readonly KHR_materials_emissive_strength?: {
      readonly emissiveStrength?: number;
    };
    readonly KHR_materials_unlit?: Record<string, unknown>;
    readonly MSFT_lod?: GltfLodExtension;
  };
  readonly extras?: GltfLodExtras;
  readonly pbrMetallicRoughness?: {
    readonly baseColorFactor?: readonly number[];
    readonly baseColorTexture?: {
      readonly extensions?: {
        readonly KHR_texture_transform?: GltfTextureTransformExtension;
      };
      readonly index?: number;
      readonly texCoord?: number;
    };
  };
};

export type GltfMesh = {
  readonly primitives?: readonly GltfMeshPrimitive[];
  readonly weights?: readonly number[];
};

export type GltfMeshPrimitive = {
  readonly attributes?: {
    readonly NORMAL?: number;
    readonly POSITION?: number;
    readonly TEXCOORD_0?: number;
    readonly [semantic: string]: number | undefined;
  };
  readonly extensions?: {
    readonly KHR_materials_variants?: {
      readonly mappings?: readonly {
        readonly material?: number;
        readonly variants?: readonly number[];
      }[];
    };
  };
  readonly indices?: number;
  readonly material?: number;
  readonly mode?: number;
  readonly targets?: readonly unknown[];
};

export type GltfSceneNode = {
  readonly children?: readonly number[];
  readonly extensions?: {
    readonly EXT_mesh_gpu_instancing?: GltfMeshGpuInstancingExtension;
    readonly KHR_lights_punctual?: {
      readonly light?: number;
    };
    readonly KHR_node_visibility?: {
      readonly visible?: boolean;
    };
    readonly MSFT_lod?: GltfLodExtension;
  };
  readonly extras?: GltfLodExtras;
  readonly matrix?: readonly number[];
  readonly mesh?: number;
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly skin?: number;
  readonly translation?: readonly number[];
};

export type GltfLodExtension = {
  readonly ids?: readonly number[];
};

export type GltfLodExtras = {
  readonly MSFT_screencoverage?: readonly number[];
};

export type GltfScene = {
  readonly nodes?: readonly number[];
};

export type GltfTexture = {
  readonly extensions?: {
    readonly EXT_texture_webp?: {
      readonly source?: number;
    };
    readonly KHR_texture_basisu?: {
      readonly source?: number;
    };
  };
  readonly sampler?: number;
  readonly source?: number;
};

export type GltfTextureTransformExtension = {
  readonly offset?: readonly number[];
  readonly rotation?: number;
  readonly scale?: readonly number[];
  readonly texCoord?: number;
};

export const supportedGltfExtensions = new Set<string>([
  "EXT_meshopt_compression",
  "EXT_mesh_gpu_instancing",
  "EXT_texture_webp",
  "KHR_texture_basisu",
  "KHR_lights_punctual",
  "KHR_materials_emissive_strength",
  "KHR_materials_unlit",
  "KHR_materials_variants",
  "KHR_mesh_quantization",
  "KHR_node_visibility",
  "KHR_texture_transform",
  "MSFT_lod",
]);

export class UnsupportedRequiredGltfExtensionError extends Error {
  readonly extensions: readonly string[];
  readonly src: string;

  constructor(src: string, extensions: readonly string[]) {
    const formatted = extensions.join(", ");
    super(`unsupported required glTF extension${extensions.length === 1 ? "" : "s"} for ${src}: ${formatted}`);
    this.name = "UnsupportedRequiredGltfExtensionError";
    this.extensions = extensions;
    this.src = src;
  }
}

const uniqueStrings = (values: readonly string[] | undefined): readonly string[] =>
  [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string"))];

export const unsupportedRequiredGltfExtensions = (
  document: GltfDocument,
  supportedExtensions: ReadonlySet<string> = supportedGltfExtensions,
): readonly string[] =>
  uniqueStrings(document.extensionsRequired)
    .filter((extension) => !supportedExtensions.has(extension));

export const assertSupportedRequiredGltfExtensions = (
  src: string,
  document: GltfDocument,
  supportedExtensions: ReadonlySet<string> = supportedGltfExtensions,
): void => {
  const unsupported = unsupportedRequiredGltfExtensions(document, supportedExtensions);
  if (unsupported.length > 0) throw new UnsupportedRequiredGltfExtensionError(src, unsupported);
};
