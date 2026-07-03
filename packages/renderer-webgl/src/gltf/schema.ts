export type GltfDocument = {
  readonly accessors?: readonly GltfAccessor[];
  readonly bufferViews?: readonly GltfBufferView[];
  readonly buffers?: readonly GltfBuffer[];
  readonly extensions?: {
    readonly EXT_lights_image_based?: {
      readonly lights?: readonly GltfImageBasedLight[];
    };
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

export type GltfImageBasedLight = {
  readonly intensity?: number;
  readonly irradianceCoefficients?: readonly (readonly number[])[];
  readonly name?: string;
  readonly rotation?: readonly number[];
  readonly specularImages?: readonly (readonly number[])[];
  readonly specularImageSize?: number;
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
  readonly emissiveTexture?: GltfTextureInfo;
  readonly extensions?: {
    readonly KHR_materials_clearcoat?: {
      readonly clearcoatFactor?: number;
      readonly clearcoatNormalTexture?: GltfNormalTextureInfo;
      readonly clearcoatRoughnessFactor?: number;
      readonly clearcoatRoughnessTexture?: GltfTextureInfo;
      readonly clearcoatTexture?: GltfTextureInfo;
    };
    readonly KHR_materials_dispersion?: {
      readonly dispersion?: number;
    };
    readonly KHR_materials_emissive_strength?: {
      readonly emissiveStrength?: number;
    };
    readonly KHR_materials_ior?: {
      readonly ior?: number;
    };
    readonly KHR_materials_iridescence?: {
      readonly iridescenceFactor?: number;
      readonly iridescenceIor?: number;
      readonly iridescenceTexture?: GltfTextureInfo;
      readonly iridescenceThicknessMaximum?: number;
      readonly iridescenceThicknessMinimum?: number;
      readonly iridescenceThicknessTexture?: GltfTextureInfo;
    };
    readonly KHR_materials_sheen?: {
      readonly sheenColorFactor?: readonly number[];
      readonly sheenColorTexture?: GltfTextureInfo;
      readonly sheenRoughnessFactor?: number;
      readonly sheenRoughnessTexture?: GltfTextureInfo;
    };
    readonly KHR_materials_specular?: {
      readonly specularColorFactor?: readonly number[];
      readonly specularColorTexture?: GltfTextureInfo;
      readonly specularFactor?: number;
      readonly specularTexture?: GltfTextureInfo;
    };
    readonly KHR_materials_transmission?: {
      readonly transmissionFactor?: number;
      readonly transmissionTexture?: GltfTextureInfo;
    };
    readonly KHR_materials_unlit?: Record<string, unknown>;
    readonly KHR_materials_volume?: {
      readonly attenuationColor?: readonly number[];
      readonly attenuationDistance?: number;
      readonly thicknessFactor?: number;
      readonly thicknessTexture?: GltfTextureInfo;
    };
    readonly MSFT_lod?: GltfLodExtension;
  };
  readonly extras?: GltfLodExtras;
  readonly pbrMetallicRoughness?: {
    readonly baseColorFactor?: readonly number[];
    readonly baseColorTexture?: GltfTextureInfo;
  };
};

export type GltfTextureInfo = {
  readonly extensions?: {
    readonly KHR_texture_transform?: GltfTextureTransformExtension;
  };
  readonly index?: number;
  readonly texCoord?: number;
};

export type GltfNormalTextureInfo = GltfTextureInfo & {
  readonly scale?: number;
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
    readonly KHR_draco_mesh_compression?: GltfDracoMeshCompressionExtension;
    readonly KHR_materials_variants?: {
      readonly mappings?: readonly {
        readonly material?: number;
        readonly variants?: readonly number[];
      }[];
    };
    readonly [name: string]: unknown;
  };
  readonly indices?: number;
  readonly material?: number;
  readonly mode?: number;
  readonly targets?: readonly unknown[];
};

export type GltfDracoMeshCompressionExtension = {
  readonly attributes?: {
    readonly NORMAL?: number;
    readonly POSITION?: number;
    readonly TEXCOORD_0?: number;
    readonly [semantic: string]: number | undefined;
  };
  readonly bufferView: number;
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
  readonly extensions?: {
    readonly EXT_lights_image_based?: {
      readonly light?: number;
    };
  };
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
