import {
  lodAccessors,
  lodBufferViews,
} from "./renderer-webgl-scene-gltf-binary-fixtures";
import {
  lodBinByteLength,
  lodBinUri,
  lodImageUri,
} from "./renderer-webgl-scene-gltf-test-runtime";

export const nodeLodDocument = () => ({
  accessors: lodAccessors(),
  asset: { version: "2.0" },
  bufferViews: lodBufferViews(),
  buffers: [
    {
      byteLength: lodBinByteLength,
      uri: lodBinUri,
    },
  ],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0, 0, 1],
      },
    },
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0, 0, 1, 1],
      },
    },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            POSITION: 0,
          },
          indices: 1,
          material: 0,
          mode: 4,
        },
      ],
    },
    {
      primitives: [
        {
          attributes: {
            POSITION: 2,
          },
          indices: 3,
          material: 1,
          mode: 4,
        },
      ],
    },
  ],
  nodes: [
    {
      extensions: {
        MSFT_lod: {
          ids: [1],
        },
      },
      extras: {
        MSFT_screencoverage: [0.2, 0],
      },
      mesh: 0,
    },
    {
      mesh: 1,
    },
  ],
  scene: 0,
  scenes: [
    {
      nodes: [0, 1],
    },
  ],
});

export const nodeLodSeparatedBoundsDocument = () => {
  const document = nodeLodDocument();
  return {
    ...document,
    nodes: [
      {
        ...document.nodes[0],
        translation: [10, 0, 0],
      },
      {
        ...document.nodes[1],
      },
    ],
  };
};

export const materialLodDocument = () => ({
  accessors: lodAccessors(),
  asset: { version: "2.0" },
  bufferViews: lodBufferViews(),
  buffers: [
    {
      byteLength: lodBinByteLength,
      uri: lodBinUri,
    },
  ],
  materials: [
    {
      extensions: {
        MSFT_lod: {
          ids: [1],
        },
      },
      extras: {
        MSFT_screencoverage: [0.2, 0],
      },
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0, 0, 1],
      },
    },
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0, 0, 1, 1],
      },
    },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            POSITION: 0,
          },
          indices: 1,
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
});

export const materialTexturePendingLodDocument = () => ({
  accessors: lodAccessors(),
  asset: { version: "2.0" },
  bufferViews: lodBufferViews(),
  buffers: [
    {
      byteLength: lodBinByteLength,
      uri: lodBinUri,
    },
  ],
  images: [
    {
      uri: lodImageUri,
    },
  ],
  materials: [
    {
      extensions: {
        MSFT_lod: {
          ids: [1],
        },
      },
      extras: {
        MSFT_screencoverage: [0.2, 0],
      },
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0, 0, 1],
      },
    },
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
            POSITION: 0,
          },
          indices: 1,
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
  samplers: [
    {},
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
});

export const materialSecondaryTexturePendingLodDocument = () => {
  const base = materialTexturePendingLodDocument();

  return {
    ...base,
    extensionsRequired: ["KHR_materials_specular"],
    extensionsUsed: ["KHR_materials_specular"],
    materials: [
      base.materials[0],
      {
        emissiveFactor: [0.1, 0.2, 0.3],
        emissiveTexture: {
          index: 0,
        },
        extensions: {
          KHR_materials_specular: {
            specularTexture: {
              index: 0,
            },
          },
        },
        normalTexture: {
          index: 0,
        },
        occlusionTexture: {
          index: 0,
        },
        pbrMetallicRoughness: {
          baseColorFactor: [0, 1, 0, 1],
          metallicRoughnessTexture: {
            index: 0,
          },
        },
      },
    ],
  };
};

export const materialSharedTextureLodDocument = () => ({
  accessors: lodAccessors(),
  asset: { version: "2.0" },
  bufferViews: lodBufferViews(),
  buffers: [
    {
      byteLength: lodBinByteLength,
      uri: lodBinUri,
    },
  ],
  images: [
    {
      uri: lodImageUri,
    },
  ],
  materials: [
    {
      extensions: {
        MSFT_lod: {
          ids: [1],
        },
      },
      extras: {
        MSFT_screencoverage: [0.2, 0],
      },
      pbrMetallicRoughness: {
        baseColorTexture: {
          index: 0,
        },
      },
    },
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
            POSITION: 0,
          },
          indices: 1,
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
  samplers: [
    {},
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
});
