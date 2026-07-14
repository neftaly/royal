import {
  iblSpecularImageUris,
  instancedTriangleBinByteLength,
  triangleBinByteLength,
  triangleBinUri,
  triangleEmissiveImageUri,
  triangleImageUri,
  triangleMetallicRoughnessImageUri,
  triangleNormalImageUri,
  triangleOcclusionImageUri,
  triangleVariantImageUri,
} from "./renderer-webgl-scene-gltf-test-runtime";

export const triangleDocument = () => ({
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 3,
      max: [0.5, 0.5, 0],
      min: [-0.5, -0.5, 0],
      type: "VEC3",
    },
    {
      bufferView: 1,
      componentType: 5126,
      count: 3,
      type: "VEC3",
    },
    {
      bufferView: 2,
      componentType: 5126,
      count: 3,
      type: "VEC2",
    },
    {
      bufferView: 3,
      componentType: 5123,
      count: 3,
      type: "SCALAR",
    },
  ],
  asset: { version: "2.0" },
  bufferViews: [
    {
      buffer: 0,
      byteLength: 36,
      byteOffset: 0,
      target: 34962,
    },
    {
      buffer: 0,
      byteLength: 36,
      byteOffset: 36,
      target: 34962,
    },
    {
      buffer: 0,
      byteLength: 24,
      byteOffset: 72,
      target: 34962,
    },
    {
      buffer: 0,
      byteLength: 6,
      byteOffset: 96,
      target: 34963,
    },
  ],
  buffers: [
    {
      byteLength: triangleBinByteLength,
      uri: triangleBinUri,
    },
  ],
  images: [
    {
      mimeType: "image/png",
      uri: triangleImageUri,
    },
  ],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorTexture: {
          index: 0,
        },
      },
    },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            NORMAL: 1,
            POSITION: 0,
            TEXCOORD_0: 2,
          },
          indices: 3,
          material: 0,
          mode: 4,
        },
      ],
    },
  ],
  nodes: [
    {
      mesh: 0,
    },
  ],
  scene: 0,
  scenes: [
    {
      nodes: [0],
    },
  ],
  textures: [
    {
      sampler: 0,
      source: 0,
    },
  ],
  samplers: [
    {},
  ],
});

export const solidTriangleDocument = () => ({
  ...triangleDocument(),
  images: [],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0.8, 0.62, 0.36, 1],
      },
    },
  ],
  samplers: [],
  textures: [],
});

export const vertexColorTriangleDocument = () => {
  const base = solidTriangleDocument();
  const colorBufferViewIndex = base.bufferViews.length;
  const colorAccessorIndex = base.accessors.length;
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    accessors: [
      ...base.accessors,
      {
        bufferView: colorBufferViewIndex,
        componentType: 5121,
        count: 3,
        normalized: true,
        type: "VEC3",
      },
    ],
    bufferViews: [
      ...base.bufferViews,
      {
        buffer: 0,
        byteLength: 9,
        byteOffset: triangleBinByteLength,
        target: 34962,
      },
    ],
    buffers: [
      {
        byteLength: triangleBinByteLength + 9,
        uri: triangleBinUri,
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            attributes: {
              ...primitive.attributes,
              COLOR_0: colorAccessorIndex,
            },
          },
        ],
      },
    ],
  };
};

export const normalTextureTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    images: [
      {
        mimeType: "image/png",
        uri: triangleNormalImageUri,
      },
    ],
    materials: [
      {
        normalTexture: {
          index: 0,
          scale: 0.42,
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.25, 0.25, 1],
        },
      },
    ],
    textures: [
      {
        source: 0,
      },
    ],
  };
};

export const tangentTriangleDocument = () => {
  const base = normalTextureTriangleDocument();
  const tangentBufferViewIndex = base.bufferViews.length;
  const tangentAccessorIndex = base.accessors.length;
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    accessors: [
      ...base.accessors,
      {
        bufferView: tangentBufferViewIndex,
        componentType: 5126,
        count: 3,
        type: "VEC4",
      },
    ],
    bufferViews: [
      ...base.bufferViews,
      {
        buffer: 0,
        byteLength: 48,
        byteOffset: triangleBinByteLength,
        target: 34962,
      },
    ],
    buffers: [
      {
        byteLength: triangleBinByteLength + 48,
        uri: triangleBinUri,
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            attributes: {
              ...primitive.attributes,
              TANGENT: tangentAccessorIndex,
            },
          },
        ],
      },
    ],
  };
};

export const multiUvEmissiveTriangleDocument = () => {
  const base = emissiveTextureTriangleDocument();
  const uv1BufferViewIndex = base.bufferViews.length;
  const uv1AccessorIndex = base.accessors.length;
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    accessors: [
      ...base.accessors,
      {
        bufferView: uv1BufferViewIndex,
        componentType: 5126,
        count: 3,
        type: "VEC2",
      },
    ],
    bufferViews: [
      ...base.bufferViews,
      {
        buffer: 0,
        byteLength: 24,
        byteOffset: triangleBinByteLength,
        target: 34962,
      },
    ],
    buffers: [
      {
        byteLength: triangleBinByteLength + 24,
        uri: triangleBinUri,
      },
    ],
    materials: [
      {
        ...base.materials[0],
        emissiveTexture: {
          index: 0,
          texCoord: 1,
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            attributes: {
              ...primitive.attributes,
              TEXCOORD_1: uv1AccessorIndex,
            },
          },
        ],
      },
    ],
  };
};

export const doubleSidedTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.62, 0.36, 1],
        },
      },
    ],
  };
};

export const alphaMaskTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    materials: [
      {
        alphaCutoff: 0.37,
        alphaMode: "MASK",
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.62, 0.36, 0.25],
        },
      },
    ],
  };
};

export const alphaBlendTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    materials: [
      {
        alphaMode: "BLEND",
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.2, 0.1, 0.4],
        },
      },
      {
        alphaMode: "OPAQUE",
        pbrMetallicRoughness: {
          baseColorFactor: [0.1, 0.8, 0.2, 0.25],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

export const mirroredTriangleNodesDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    nodes: [
      {
        mesh: 0,
      },
      {
        mesh: 0,
        scale: [-1, 1, 1],
      },
    ],
    scenes: [
      {
        nodes: [0, 1],
      },
    ],
  };
};

export const metallicRoughnessTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.62, 0.36, 1],
          metallicFactor: 0.75,
          roughnessFactor: 0.2,
        },
      },
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.3, 0.4, 1],
          metallicFactor: -2,
          roughnessFactor: 3,
        },
      },
    ],
    meshes: [
      {
        primitives: [
          ...(base.meshes[0]?.primitives ?? []),
          {
            attributes: {
              NORMAL: 1,
              POSITION: 0,
              TEXCOORD_0: 2,
            },
            indices: 3,
            material: 1,
            mode: 4,
          },
        ],
      },
    ],
  };
};

export const metallicRoughnessTextureTriangleDocument = () => {
  const base = triangleDocument();

  return {
    ...base,
    images: [
      ...(base.images ?? []),
      {
        mimeType: "image/png",
        uri: triangleMetallicRoughnessImageUri,
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: {
            index: 0,
          },
          metallicFactor: 0.8,
          metallicRoughnessTexture: {
            index: 1,
          },
          roughnessFactor: 0.6,
        },
      },
    ],
    textures: [
      ...(base.textures ?? []),
      {
        sampler: 0,
        source: 1,
      },
    ],
  };
};

export const instancedTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    accessors: [
      ...base.accessors,
      {
        bufferView: 4,
        componentType: 5126,
        count: 2,
        type: "VEC3",
      },
      {
        bufferView: 5,
        componentType: 5126,
        count: 2,
        type: "VEC3",
      },
    ],
    bufferViews: [
      ...base.bufferViews,
      {
        buffer: 0,
        byteLength: 24,
        byteOffset: triangleBinByteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteLength: 24,
        byteOffset: triangleBinByteLength + 24,
        target: 34962,
      },
    ],
    buffers: [
      {
        byteLength: instancedTriangleBinByteLength,
        uri: triangleBinUri,
      },
    ],
    extensionsRequired: ["EXT_mesh_gpu_instancing"],
    extensionsUsed: ["EXT_mesh_gpu_instancing"],
    nodes: [
      {
        extensions: {
          EXT_mesh_gpu_instancing: {
            attributes: {
              SCALE: 5,
              TRANSLATION: 4,
            },
          },
        },
        mesh: 0,
      },
    ],
  };
};

export const punctualLightTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      KHR_lights_punctual: {
        lights: [
          {
            color: [0.5, 0.5, 1],
            intensity: 2,
            type: "directional",
          },
          {
            color: [1, 0.5, 0.25],
            intensity: 3,
            range: 5,
            type: "point",
          },
          {
            color: [0.25, 1, 0.5],
            intensity: 4,
            range: 6,
            spot: {
              innerConeAngle: 0.1,
              outerConeAngle: 0.5,
            },
            type: "spot",
          },
        ],
      },
    },
    extensionsRequired: ["KHR_lights_punctual"],
    extensionsUsed: ["KHR_lights_punctual"],
    nodes: [
      {
        extensions: {
          KHR_lights_punctual: {
            light: 0,
          },
        },
      },
      {
        extensions: {
          KHR_lights_punctual: {
            light: 1,
          },
        },
        translation: [1, 2, 3],
      },
      {
        extensions: {
          KHR_lights_punctual: {
            light: 2,
          },
        },
        translation: [-1, -2, -3],
      },
      {
        mesh: 0,
      },
    ],
    scenes: [
      {
        nodes: [0, 1, 2, 3],
      },
    ],
  };
};

export const iblCoefficients = (
  c0: readonly [number, number, number],
  c8: readonly [number, number, number] = [0, 0, 0],
): readonly (readonly [number, number, number])[] =>
  Array.from({ length: 9 }, (_unused, index) =>
    index === 0 ? c0 : index === 8 ? c8 : [0, 0, 0] as const);

export const sceneSelectedImageBasedLightTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      EXT_lights_image_based: {
        lights: [
          {
            intensity: 4,
            irradianceCoefficients: iblCoefficients([9, 9, 9]),
            specularImages: [
              [0, 1, 2, 3, 4, 5],
            ],
            specularImageSize: 4,
          },
          {
            irradianceCoefficients: iblCoefficients([0.7, 0.6, 0.5]),
            specularImages: [
              [0, 1, 2, 3, 4, 5],
            ],
            specularImageSize: 4,
          },
        ],
      },
    },
    extensionsUsed: ["EXT_lights_image_based"],
    images: iblSpecularImageUris.map((uri) => ({ mimeType: "image/png", uri })),
    scene: 1,
    scenes: [
      {
        extensions: {
          EXT_lights_image_based: {
            light: 0,
          },
        },
        nodes: [0],
      },
      {
        extensions: {
          EXT_lights_image_based: {
            light: 1,
          },
        },
        nodes: [0],
      },
    ],
  };
};

export const invalidImageBasedLightReferenceTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      EXT_lights_image_based: {
        lights: [
          {
            irradianceCoefficients: iblCoefficients([0.5, 0.5, 0.5]),
            specularImages: [
              [0, 1, 2, 3, 4, 5],
            ],
            specularImageSize: 4,
          },
        ],
      },
    },
    extensionsUsed: ["EXT_lights_image_based"],
    images: iblSpecularImageUris.map((uri) => ({ mimeType: "image/png", uri })),
    scenes: [
      {
        extensions: {
          EXT_lights_image_based: {
            light: 5,
          },
        },
        nodes: [0],
      },
    ],
  };
};

export const emissiveStrengthTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_emissive_strength"],
    extensionsUsed: ["KHR_materials_emissive_strength"],
    materials: [
      {
        emissiveFactor: [0.4, 0.1, 0.2],
        extensions: {
          KHR_materials_emissive_strength: {
            emissiveStrength: 5,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.25, 0.25, 1],
        },
      },
    ],
  };
};

export const emissiveTextureTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    images: [
      {
        mimeType: "image/png",
        uri: triangleEmissiveImageUri,
      },
    ],
    materials: [
      {
        emissiveFactor: [0.4, 0.5, 0.6],
        emissiveTexture: {
          index: 0,
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.25, 0.25, 1],
        },
      },
    ],
    samplers: [
      {},
    ],
    textures: [
      {
        sampler: 0,
        source: 0,
      },
    ],
  };
};

export const occlusionTextureTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    images: [
      {
        mimeType: "image/png",
        uri: triangleOcclusionImageUri,
      },
    ],
    materials: [
      {
        occlusionTexture: {
          index: 0,
          strength: 0.35,
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.25, 0.25, 1],
        },
      },
    ],
    samplers: [
      {},
    ],
    textures: [
      {
        sampler: 0,
        source: 0,
      },
    ],
  };
};

export const materialPbrExtensionFactorsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_specular", "KHR_materials_ior", "KHR_materials_clearcoat"],
    extensionsUsed: ["KHR_materials_specular", "KHR_materials_ior", "KHR_materials_clearcoat"],
    materials: [
      {
        extensions: {
          KHR_materials_clearcoat: {
            clearcoatFactor: 0.75,
            clearcoatRoughnessFactor: 0.2,
          },
          KHR_materials_ior: {
            ior: 1.33,
          },
          KHR_materials_specular: {
            specularColorFactor: [1.4, 0.5, 0.25],
            specularFactor: 0.35,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

export const materialPbrExtensionDefaultsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_specular", "KHR_materials_ior", "KHR_materials_clearcoat"],
    extensionsUsed: ["KHR_materials_specular", "KHR_materials_ior", "KHR_materials_clearcoat"],
    materials: [
      {
        extensions: {
          KHR_materials_clearcoat: {},
          KHR_materials_ior: {},
          KHR_materials_specular: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

export const materialPbrExtensionTextureDiagnosticTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_specular"],
    extensionsUsed: ["KHR_materials_specular", "KHR_materials_clearcoat"],
    images: [
      {
        mimeType: "image/png",
        uri: triangleImageUri,
      },
    ],
    materials: [
      {
        extensions: {
          KHR_materials_clearcoat: {
            clearcoatNormalTexture: { index: 4, scale: 0.35 },
            clearcoatRoughnessTexture: { index: 3 },
            clearcoatTexture: { index: 2 },
          },
          KHR_materials_specular: {
            specularColorTexture: { index: 1 },
            specularTexture: { index: 0 },
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    samplers: [{}],
    textures: Array.from({ length: 5 }, () => ({
      sampler: 0,
      source: 0,
    })),
  };
};

export const materialSheenIridescenceFactorsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    extensionsUsed: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    materials: [
      {
        extensions: {
          KHR_materials_iridescence: {
            iridescenceFactor: 0.65,
            iridescenceIor: 1.8,
            iridescenceThicknessMaximum: 620,
            iridescenceThicknessMinimum: 120,
          },
          KHR_materials_sheen: {
            sheenColorFactor: [1.4, 0.2, 0.1],
            sheenRoughnessFactor: 0.55,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

export const materialSheenIridescenceDefaultsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    extensionsUsed: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    materials: [
      {
        extensions: {
          KHR_materials_iridescence: {},
          KHR_materials_sheen: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

export const materialSheenIridescenceTextureDiagnosticTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    extensionsUsed: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    images: [
      {
        mimeType: "image/png",
        uri: triangleImageUri,
      },
    ],
    materials: [
      {
        extensions: {
          KHR_materials_iridescence: {
            iridescenceTexture: { index: 2 },
            iridescenceThicknessTexture: { index: 3 },
          },
          KHR_materials_sheen: {
            sheenColorTexture: { index: 0 },
            sheenRoughnessTexture: { index: 1 },
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    samplers: [{}],
    textures: Array.from({ length: 4 }, () => ({
      sampler: 0,
      source: 0,
    })),
  };
};

export const materialSheenIridescenceBatchKeyTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    extensionsUsed: ["KHR_materials_sheen", "KHR_materials_iridescence"],
    materials: [
      {
        extensions: {
          KHR_materials_iridescence: {
            iridescenceFactor: 0.15,
            iridescenceThicknessMaximum: 300,
          },
          KHR_materials_sheen: {
            sheenColorFactor: [0.1, 0.2, 0.3],
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
      {
        extensions: {
          KHR_materials_iridescence: {
            iridescenceFactor: 0.85,
            iridescenceThicknessMaximum: 700,
          },
          KHR_materials_sheen: {
            sheenColorFactor: [0.3, 0.2, 0.1],
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

export const materialTransmissionVolumeTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: ["KHR_materials_transmission", "KHR_materials_volume"],
    extensionsUsed: ["KHR_materials_transmission", "KHR_materials_volume"],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.3, 0.35, 1],
        },
      },
      {
        extensions: {
          KHR_materials_transmission: {
            transmissionFactor: 0.65,
          },
          KHR_materials_volume: {
            attenuationColor: [0.8, 0.6, 0.4],
            attenuationDistance: 2,
            thicknessFactor: 0.4,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.95, 1, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

export const materialTransmissionVolumeDefaultsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_transmission", "KHR_materials_volume"],
    extensionsUsed: ["KHR_materials_transmission", "KHR_materials_volume"],
    materials: [
      {
        extensions: {
          KHR_materials_transmission: {},
          KHR_materials_volume: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
  };
};

export const materialDispersionTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: [
      "KHR_materials_ior",
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    extensionsUsed: [
      "KHR_materials_ior",
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.25, 0.3, 0.35, 1],
        },
      },
      {
        extensions: {
          KHR_materials_dispersion: {
            dispersion: 0.8,
          },
          KHR_materials_ior: {
            ior: 1.6,
          },
          KHR_materials_transmission: {
            transmissionFactor: 0.7,
          },
          KHR_materials_volume: {
            attenuationColor: [0.9, 0.8, 0.7],
            attenuationDistance: 3,
            thicknessFactor: 0.5,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.95, 1, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

export const materialDispersionDefaultsClampingTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: [
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    extensionsUsed: [
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    materials: [
      {
        extensions: {
          KHR_materials_dispersion: {},
          KHR_materials_transmission: {},
          KHR_materials_volume: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.45, 0.5, 0.55, 1],
        },
      },
      {
        extensions: {
          KHR_materials_dispersion: {
            dispersion: -0.5,
          },
          KHR_materials_transmission: {},
          KHR_materials_volume: {},
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.65, 0.7, 0.75, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

export const materialTransmissionVolumeTextureDiagnosticTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_transmission", "KHR_materials_volume"],
    extensionsUsed: ["KHR_materials_transmission", "KHR_materials_volume"],
    images: [
      {
        mimeType: "image/png",
        uri: triangleImageUri,
      },
    ],
    materials: [
      {
        extensions: {
          KHR_materials_transmission: {
            transmissionTexture: { index: 0 },
          },
          KHR_materials_volume: {
            thicknessTexture: { index: 1 },
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    samplers: [{}],
    textures: Array.from({ length: 2 }, () => ({
      sampler: 0,
      source: 0,
    })),
  };
};

export const materialOverfullTextureUnitTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensionsRequired: [
      "KHR_materials_clearcoat",
      "KHR_materials_iridescence",
      "KHR_materials_sheen",
      "KHR_materials_specular",
      "KHR_materials_transmission",
      "KHR_materials_volume",
    ],
    extensionsUsed: [
      "KHR_materials_clearcoat",
      "KHR_materials_iridescence",
      "KHR_materials_sheen",
      "KHR_materials_specular",
      "KHR_materials_transmission",
      "KHR_materials_volume",
    ],
    images: [
      {
        mimeType: "image/png",
        uri: triangleImageUri,
      },
    ],
    materials: [
      {
        emissiveFactor: [0.2, 0.3, 0.4],
        emissiveTexture: { index: 4 },
        extensions: {
          KHR_materials_clearcoat: {
            clearcoatFactor: 0.75,
            clearcoatRoughnessTexture: { index: 8 },
            clearcoatTexture: { index: 7 },
          },
          KHR_materials_iridescence: {
            iridescenceFactor: 0.5,
            iridescenceTexture: { index: 11 },
            iridescenceThicknessTexture: { index: 12 },
          },
          KHR_materials_sheen: {
            sheenColorTexture: { index: 9 },
            sheenRoughnessTexture: { index: 10 },
          },
          KHR_materials_specular: {
            specularColorTexture: { index: 6 },
            specularTexture: { index: 5 },
          },
          KHR_materials_transmission: {
            transmissionFactor: 1,
            transmissionTexture: { index: 13 },
          },
          KHR_materials_volume: {
            thicknessFactor: 1,
            thicknessTexture: { index: 14 },
          },
        },
        normalTexture: { index: 2 },
        occlusionTexture: { index: 3 },
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicRoughnessTexture: { index: 1 },
        },
      },
    ],
    samplers: [{}],
    textures: Array.from({ length: 15 }, () => ({
      sampler: 0,
      source: 0,
    })),
  };
};

export const materialOverfullSolidBaseImageBasedLightTriangleDocument = () => {
  const base = materialOverfullTextureUnitTriangleDocument();
  const material = base.materials[0]!;

  return {
    ...base,
    extensions: {
      EXT_lights_image_based: {
        lights: [
          {
            intensity: 1,
            irradianceCoefficients: iblCoefficients([0.4, 0.4, 0.4]),
            specularImages: [
              [1, 2, 3, 4, 5, 6],
            ],
            specularImageSize: 4,
          },
        ],
      },
    },
    extensionsUsed: [
      ...base.extensionsUsed,
      "EXT_lights_image_based",
    ],
    images: [
      ...base.images,
      ...iblSpecularImageUris.map((uri) => ({ mimeType: "image/png", uri })),
    ],
    materials: [
      {
        ...material,
        pbrMetallicRoughness: {
          baseColorFactor: [0.42, 0.42, 0.42, 1],
          metallicRoughnessTexture: material.pbrMetallicRoughness.metallicRoughnessTexture,
        },
      },
    ],
    scenes: [
      {
        ...base.scenes[0],
        extensions: {
          EXT_lights_image_based: {
            light: 0,
          },
        },
      },
    ],
  };
};

export const materialTransmissionBatchKeyTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: ["KHR_materials_transmission"],
    extensionsUsed: ["KHR_materials_transmission"],
    materials: [
      {
        extensions: {
          KHR_materials_transmission: {
            transmissionFactor: 0.2,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
      {
        extensions: {
          KHR_materials_transmission: {
            transmissionFactor: 0.8,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

export const materialDispersionBatchKeyTriangleDocument = () => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    extensionsRequired: [
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    extensionsUsed: [
      "KHR_materials_transmission",
      "KHR_materials_volume",
      "KHR_materials_dispersion",
    ],
    materials: [
      {
        extensions: {
          KHR_materials_dispersion: {
            dispersion: 0.2,
          },
          KHR_materials_transmission: {
            transmissionFactor: 0.6,
          },
          KHR_materials_volume: {
            thicknessFactor: 0.5,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
      {
        extensions: {
          KHR_materials_dispersion: {
            dispersion: 0.8,
          },
          KHR_materials_transmission: {
            transmissionFactor: 0.6,
          },
          KHR_materials_volume: {
            thicknessFactor: 0.5,
          },
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            ...primitive,
            material: 0,
          },
          {
            ...primitive,
            material: 1,
          },
        ],
      },
    ],
  };
};

export const materialVariantsTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      KHR_materials_variants: {
        variants: [
          { name: "ruby" },
          { name: "mint" },
        ],
      },
    },
    extensionsRequired: ["KHR_materials_variants"],
    extensionsUsed: ["KHR_materials_variants"],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.22, 0.24, 0.28, 1],
        },
      },
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.1, 0.08, 1],
        },
      },
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.1, 0.72, 0.46, 1],
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              NORMAL: 1,
              POSITION: 0,
              TEXCOORD_0: 2,
            },
            extensions: {
              KHR_materials_variants: {
                mappings: [
                  { material: 1, variants: [0] },
                  { material: 2, variants: [1] },
                ],
              },
            },
            indices: 3,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
  };
};

export const materialVariantTextureTriangleDocument = () => {
  const base = solidTriangleDocument();

  return {
    ...base,
    extensions: {
      KHR_materials_variants: {
        variants: [
          { name: "textured" },
        ],
      },
    },
    extensionsRequired: ["KHR_materials_variants"],
    extensionsUsed: ["KHR_materials_variants"],
    images: [
      {
        uri: triangleVariantImageUri,
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.24, 0.3, 1],
        },
      },
      {
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          baseColorTexture: {
            index: 0,
          },
        },
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              NORMAL: 1,
              POSITION: 0,
              TEXCOORD_0: 2,
            },
            extensions: {
              KHR_materials_variants: {
                mappings: [
                  { material: 1, variants: [0] },
                ],
              },
            },
            indices: 3,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    samplers: [
      {},
    ],
    textures: [
      {
        sampler: 0,
        source: 0,
      },
    ],
  };
};
