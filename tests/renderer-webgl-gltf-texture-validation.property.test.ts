import { describe, expect, it } from "vitest";
import {
  assertSupportedRequiredGltfExtensions,
  unsupportedRequiredGltfExtensions,
} from "../packages/renderer-webgl/src/gltf/extensions";
import { gltfImageLoadKey, type GltfImageKind } from "../packages/renderer-webgl/src/gltf/image-keys";
import type { GltfDocument, GltfImage, GltfTexture, GltfTextureInfo } from "../packages/renderer-webgl/src/gltf/schema";
import {
  gltfTextureCoordinates,
  transformGltfTextureCoordinates,
} from "../packages/renderer-webgl/src/gltf/texture-coordinates";
import { forEachFuzzCase, type FuzzReplay, type SeededRandom } from "./fuzz";

const textureSourceExtensions = [
  "EXT_texture_webp",
  "KHR_texture_basisu",
] as const;

type TextureSourceExtension = typeof textureSourceExtensions[number];

type ValidationCounters = {
  readonly extensionBlockCount: number;
  readonly imageCount: number;
  readonly sourceMask: number;
  readonly textureCount: number;
  readonly validationOutcome: "accepted" | "rejected";
};

type GsSvgReplay = {
  readonly document: GltfDocument;
  readonly expectedMessage?: RegExp;
  readonly expectedPass: boolean;
};

type TextureSourceConflictReplay = {
  readonly document: GltfDocument;
  readonly extension: TextureSourceExtension;
  readonly conflictIndex: number;
};

type ImageLoadKeyExpectation = {
  readonly description: string;
  readonly image: GltfImage;
  readonly imageIndex?: number;
  readonly kind: GltfImageKind;
};

type ImageLoadKeyReplay = {
  readonly entries: readonly ImageLoadKeyExpectation[];
  readonly expectedEqualGroups: readonly (readonly number[])[];
  readonly expectedDistinctGroups: readonly (readonly number[])[];
};

type MaterialTextureSlotReplay = {
  readonly document: GltfDocument;
  readonly expectedMessage?: RegExp;
  readonly expectedPass: boolean;
};

const extensionPool = [
  "EXT_mesh_gpu_instancing",
  "EXT_texture_webp",
  "KHR_materials_unlit",
  "KHR_texture_basisu",
  "GS_texture_svg",
  "VENDOR_alpha",
  "VENDOR_beta",
  "VENDOR_gamma",
] as const;

const randomRequiredExtensions = (random: SeededRandom): readonly unknown[] => {
  const count = random.int(0, 14);
  const values: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    const extension = random.pick(extensionPool);
    values.push(extension);
    if (random.boolean(0.25)) values.push(extension);
    if (random.boolean(0.12)) values.push(random.int(-4, 4));
  }
  return values;
};

const expectedUnsupported = (
  required: readonly unknown[],
  supported: ReadonlySet<string>,
): readonly string[] => {
  const unique = new Set<string>();
  for (const value of required) {
    if (typeof value === "string") unique.add(value);
  }
  return [...unique].filter((extension) => !supported.has(extension));
};

const extensionBlock = (extension: TextureSourceExtension, source: number) => ({
  [extension]: { source },
}) as NonNullable<GltfTexture["extensions"]>;

const documentWithConflictingTextureSource = (
  extension: TextureSourceExtension,
  textureCount: number,
  conflictIndex: number,
): GltfDocument => ({
  extensionsRequired: [extension],
  extensionsUsed: [],
  images: [{ uri: "texture.svg" }],
  textures: Array.from({ length: textureCount }, (_, textureIndex): GltfTexture => ({
    ...(textureIndex === conflictIndex ? { source: 0 } : {}),
    ...(textureIndex === conflictIndex ? { extensions: extensionBlock(extension, 0) } : {}),
  })),
});

describe("glTF material texture coordinate preparation", () => {
  it("matches the KHR_texture_transform affine definition across both retained UV sets", () => {
    forEachFuzzCase({ cases: 128, seed: 0x7e8c_00ad }, ({ label, random }) => {
      const offset = [random.number(-4, 4), random.number(-4, 4)] as const;
      const scale = [random.number(-3, 3), random.number(-3, 3)] as const;
      const rotation = random.number(-Math.PI * 4, Math.PI * 4);
      const set = random.boolean() ? 0 : 1;
      const u = random.number(-2, 2);
      const v = random.number(-2, 2);
      const textureInfo: GltfTextureInfo = {
        extensions: { KHR_texture_transform: { offset, rotation, scale, texCoord: set } },
        index: 0,
      };
      const prepared = gltfTextureCoordinates(textureInfo);
      const actual = transformGltfTextureCoordinates(prepared, u, v);
      const scaledU = u * scale[0];
      const scaledV = v * scale[1];
      const expected = [
        offset[0] + Math.cos(rotation) * scaledU - Math.sin(rotation) * scaledV,
        offset[1] + Math.sin(rotation) * scaledU + Math.cos(rotation) * scaledV,
      ];

      expect(prepared.set, label).toBe(set);
      expect(actual[0], label).toBeCloseTo(expected[0]!, 12);
      expect(actual[1], label).toBeCloseTo(expected[1]!, 12);
    });
  });

  it("rejects unsupported sets and malformed authored affine values", () => {
    expect(() => gltfTextureCoordinates({ index: 0, texCoord: 2 })).toThrow(/TEXCOORD_2/u);
    expect(() => gltfTextureCoordinates({ index: 0, extensions: {
      KHR_texture_transform: { offset: [Number.NaN, 0] },
    } })).toThrow(/offset\.x must be finite/u);
    expect(() => gltfTextureCoordinates({ index: 0, extensions: {
      KHR_texture_transform: { rotation: Number.POSITIVE_INFINITY },
    } })).toThrow(/rotation must be finite/u);
  });
});

const randomSvgImage = (random: SeededRandom): GltfImage => {
  const variant = random.int(0, 10);
  switch (variant) {
    case 0:
      return { uri: "icon.svg" };
    case 1:
      return { mimeType: "image/svg+xml", uri: "icon.texture" };
    case 2:
      return { uri: "icon.png" };
    case 3:
      return { mimeType: "image/png", uri: "icon.svg" };
    case 4:
      return { mimeType: "image/svg+xml", bufferView: random.int(0, 4) };
    case 5:
      return { mimeType: "image/png", bufferView: random.int(0, 4) };
    case 6:
      return { uri: "data:image/svg+xml,%3Csvg/%3E" };
    case 7:
      return { uri: "data:image/png;base64,AAAA" };
    case 8:
      return { uri: "badge.svg?cache=1" };
    default:
      return {};
  }
};

const isDataUri = (uri: string): boolean => /^data:/iu.test(uri);

const dataUriMediaType = (uri: string): string | undefined => {
  const match = /^data:([^,]*),/isu.exec(uri);
  return match?.[1]?.split(";")[0]?.toLowerCase();
};

const isSvgMimeType = (value: string | undefined): boolean =>
  value?.toLowerCase() === "image/svg+xml";

const isSvgUri = (uri: string): boolean => /\.svg(?:$|[?#])/iu.test(uri);

const imageLooksSvg = (image: GltfImage): boolean => {
  if (isSvgMimeType(image.mimeType)) return true;
  if (image.uri === undefined) return false;
  if (isDataUri(image.uri)) return isSvgMimeType(dataUriMediaType(image.uri));
  return isSvgUri(image.uri);
};

const gsSvgDocumentShouldPass = (document: GltfDocument): boolean => {
  for (const texture of document.textures ?? []) {
    const coreImage = texture.source === undefined ? undefined : document.images?.[texture.source];
    if (coreImage !== undefined && imageLooksSvg(coreImage)) return false;
  }
  if (!document.textures?.some((texture) => texture.extensions?.GS_texture_svg !== undefined)) return true;
  if (!document.extensionsUsed?.includes("GS_texture_svg")) return false;
  if (document.extensionsRequired?.includes("GS_texture_svg")) return false;

  for (const texture of document.textures) {
    const extension = texture.extensions?.GS_texture_svg;
    if (extension === undefined) continue;
    if (texture.extensions?.EXT_texture_webp !== undefined || texture.extensions?.KHR_texture_basisu !== undefined) {
      return false;
    }
    if (typeof texture.source !== "number" || !Number.isInteger(texture.source) || texture.source < 0) return false;
    const source = extension.source;
    if (typeof source !== "number" || !Number.isInteger(source) || source < 0) return false;

    const fallbackImage = document.images?.[texture.source];
    if (fallbackImage === undefined || texture.source === source || imageLooksSvg(fallbackImage)) return false;

    const image = document.images?.[source];
    if (image === undefined) return false;
    if (image.bufferView !== undefined && !isSvgMimeType(image.mimeType)) return false;
    if (image.uri !== undefined && isDataUri(image.uri) && !isSvgMimeType(dataUriMediaType(image.uri))) return false;
    if (image.uri !== undefined && !isDataUri(image.uri) && image.mimeType !== undefined && !isSvgMimeType(image.mimeType)) {
      return false;
    }
    if (image.uri !== undefined && !isDataUri(image.uri) && image.mimeType === undefined && !isSvgUri(image.uri)) {
      return false;
    }
  }
  return true;
};

const randomGsSvgDocument = (random: SeededRandom): GltfDocument => {
  const imageCount = random.int(0, 7);
  const textureCount = random.int(1, 6);
  const images = random.array(imageCount, () => randomSvgImage(random));
  const textures = random.array(textureCount, (): GltfTexture => {
    if (random.boolean(0.35)) return {};
    const sourceVariant = random.int(0, 6);
    const source = sourceVariant === 0
      ? undefined
      : sourceVariant === 1
        ? -1
        : sourceVariant === 2
        ? 0.5
        : random.int(0, Math.max(1, imageCount + 2));
    const fallbackVariant = random.int(0, 7);
    const fallbackSource = fallbackVariant === 0
      ? undefined
      : fallbackVariant === 1
        ? -1
        : fallbackVariant === 2
          ? 0.5
          : random.int(0, Math.max(1, imageCount + 2));
    return {
      ...(fallbackSource === undefined ? {} : { source: fallbackSource }),
      extensions: {
        ...(random.boolean(0.16) ? { EXT_texture_webp: { source: random.int(0, Math.max(1, imageCount + 1)) } } : {}),
        ...(random.boolean(0.16) ? { KHR_texture_basisu: { source: random.int(0, Math.max(1, imageCount + 1)) } } : {}),
        GS_texture_svg: source === undefined ? {} : { source },
      },
    };
  });

  return {
    extensionsRequired: random.boolean(0.22) ? ["GS_texture_svg"] : [],
    extensionsUsed: random.boolean(0.82) ? ["GS_texture_svg"] : [],
    images,
    textures,
  };
};

const validationCounters = (
  document: GltfDocument,
  validationOutcome: ValidationCounters["validationOutcome"],
): ValidationCounters => ({
  extensionBlockCount: document.textures?.filter((texture) => texture.extensions !== undefined).length ?? 0,
  imageCount: document.images?.length ?? 0,
  sourceMask: document.textures?.reduce((mask, texture, index) => {
    const hasCoreSource = texture.source !== undefined;
    const hasExtensionSource = Object.values(texture.extensions ?? {})
      .some((extension) => typeof extension === "object" && extension !== null && "source" in extension);
    return mask | ((hasCoreSource || hasExtensionSource) ? (1 << index) : 0);
  }, 0) ?? 0,
  textureCount: document.textures?.length ?? 0,
  validationOutcome,
});

const expectValidationOutcome = (
  document: GltfDocument,
  expectedPass: boolean,
  label: string,
  expectedMessage?: RegExp,
): void => {
  const outcome: ValidationCounters["validationOutcome"] = expectedPass ? "accepted" : "rejected";
  const counters = validationCounters(document, outcome);
  const counterLabel = `${label} counters=${JSON.stringify(counters)}`;
  if (expectedPass) {
    expect(() => assertSupportedRequiredGltfExtensions("fuzz.gltf", document), counterLabel).not.toThrow();
  } else {
    expect(() => assertSupportedRequiredGltfExtensions("fuzz.gltf", document), counterLabel)
      .toThrow(expectedMessage);
  }
};

const randomImageKind = (random: SeededRandom): GltfImageKind => {
  const kinds: readonly GltfImageKind[] = ["basisu", "image", "svg"];
  return random.pick(kinds);
};

const acceptedGsSvgDocument: GltfDocument = {
  extensionsUsed: ["GS_texture_svg"],
  images: [
    { mimeType: "image/jpeg", uri: "label-fallback.jpg" },
    { mimeType: "image/svg+xml", uri: "label.svg" },
  ],
  textures: [{ extensions: { GS_texture_svg: { source: 1 } }, source: 0 }],
};

const gsSvgReplays: readonly FuzzReplay[] = [
  {
    label: "accepted core raster fallback",
    value: { document: acceptedGsSvgDocument, expectedPass: true } satisfies GsSvgReplay,
  },
  {
    label: "plain core SVG texture",
    value: {
      document: {
        images: [{ mimeType: "image/svg+xml", uri: "label.svg" }],
        textures: [{ source: 0 }],
      },
      expectedMessage: /core texture 0 .*SVG image 0.*GS_texture_svg.*PNG or JPEG fallback/i,
      expectedPass: false,
    } satisfies GsSvgReplay,
  },
  {
    label: "unused SVG image",
    value: {
      document: {
        images: [{ uri: "unused.svg" }, { uri: "label.png" }],
        textures: [{ source: 1 }],
      },
      expectedPass: true,
    } satisfies GsSvgReplay,
  },
  {
    label: "missing core fallback",
    value: {
      document: {
        ...acceptedGsSvgDocument,
        textures: [{ extensions: { GS_texture_svg: { source: 1 } } }],
      },
      expectedMessage: /GS_texture_svg texture 0 .*core source fallback/i,
      expectedPass: false,
    } satisfies GsSvgReplay,
  },
  {
    label: "listed as required",
    value: {
      document: {
        ...acceptedGsSvgDocument,
        extensionsRequired: ["GS_texture_svg"],
      },
      expectedMessage: /GS_texture_svg .*must not be listed in extensionsRequired/i,
      expectedPass: false,
    } satisfies GsSvgReplay,
  },
  {
    label: "extra source extension fallback",
    value: {
      document: {
        ...acceptedGsSvgDocument,
        textures: [{
          extensions: {
            EXT_texture_webp: { source: 0 },
            GS_texture_svg: { source: 1 },
          },
          source: 0,
        }],
      },
      expectedMessage: /GS_texture_svg texture 0 .*additional texture source fallbacks/i,
      expectedPass: false,
    } satisfies GsSvgReplay,
  },
  {
    label: "extra webp and basisu source extension fallbacks",
    value: {
      document: {
        ...acceptedGsSvgDocument,
        extensionsUsed: ["EXT_texture_webp", "KHR_texture_basisu", "GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: "fallback.png" },
          { mimeType: "image/webp", uri: "texture.webp" },
          { mimeType: "image/ktx2", uri: "texture.ktx2" },
          { mimeType: "image/svg+xml", uri: "texture.svg" },
        ],
        textures: [{
          extensions: {
            EXT_texture_webp: { source: 1 },
            KHR_texture_basisu: { source: 2 },
            GS_texture_svg: { source: 3 },
          },
          source: 0,
        }],
      },
      expectedMessage: /GS_texture_svg texture 0 .*additional texture source fallbacks/i,
      expectedPass: false,
    } satisfies GsSvgReplay,
  },
  {
    label: "svg fallback image",
    value: {
      document: {
        ...acceptedGsSvgDocument,
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, source: 1 }],
      },
      expectedMessage: /GS_texture_svg texture 0 .*core source fallback must be a non-SVG image/i,
      expectedPass: false,
    } satisfies GsSvgReplay,
  },
  {
    label: "missing raster fallback image ref",
    value: {
      document: {
        ...acceptedGsSvgDocument,
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, source: 3 }],
      },
      expectedMessage: /GS_texture_svg texture 0 .*references missing fallback image 3/i,
      expectedPass: false,
    } satisfies GsSvgReplay,
  },
  {
    label: "missing svg source image ref",
    value: {
      document: {
        ...acceptedGsSvgDocument,
        textures: [{ extensions: { GS_texture_svg: { source: 4 } }, source: 0 }],
      },
      expectedMessage: /GS_texture_svg texture 0 .*references missing image 4/i,
      expectedPass: false,
    } satisfies GsSvgReplay,
  },
];

const textureSourceConflictReplays: readonly FuzzReplay[] = [
  {
    label: "required EXT_texture_webp conflicts with core fallback",
    value: {
      conflictIndex: 0,
      document: {
        extensionsRequired: ["EXT_texture_webp"],
        extensionsUsed: ["EXT_texture_webp"],
        images: [{ uri: "fallback.png" }, { uri: "texture.webp" }],
        textures: [{ extensions: { EXT_texture_webp: { source: 1 } }, source: 0 }],
      },
      extension: "EXT_texture_webp",
    } satisfies TextureSourceConflictReplay,
  },
  {
    label: "required KHR_texture_basisu conflicts after unrelated texture",
    value: {
      conflictIndex: 1,
      document: {
        extensionsRequired: ["KHR_texture_basisu"],
        extensionsUsed: ["KHR_texture_basisu"],
        images: [{ uri: "albedo.png" }, { uri: "albedo.ktx2" }],
        textures: [
          { source: 0 },
          { extensions: { KHR_texture_basisu: { source: 1 } }, source: 0 },
          { extensions: { KHR_texture_basisu: { source: 1 } } },
        ],
      },
      extension: "KHR_texture_basisu",
    } satisfies TextureSourceConflictReplay,
  },
];

const imageLoadKeyReplays: readonly FuzzReplay[] = [
  {
    label: "same URI and kind reuse one cache key across image indices",
    value: {
      entries: [
        { description: "first URI image", image: { uri: "textures/shared.png" }, imageIndex: 0, kind: "image" },
        { description: "second URI image", image: { uri: "textures/shared.png" }, imageIndex: 7, kind: "image" },
        { description: "same URI loaded as svg", image: { uri: "textures/shared.png" }, imageIndex: 7, kind: "svg" },
      ],
      expectedDistinctGroups: [[0, 2], [1, 2]],
      expectedEqualGroups: [[0, 1]],
    } satisfies ImageLoadKeyReplay,
  },
  {
    label: "same bufferView keeps image-index identity separate",
    value: {
      entries: [
        {
          description: "bufferView image index zero",
          image: { bufferView: 2, mimeType: "image/png" },
          imageIndex: 0,
          kind: "image",
        },
        {
          description: "bufferView image index one",
          image: { bufferView: 2, mimeType: "image/png" },
          imageIndex: 1,
          kind: "image",
        },
        {
          description: "bufferView image index one as basisu",
          image: { bufferView: 2, mimeType: "image/png" },
          imageIndex: 1,
          kind: "basisu",
        },
      ],
      expectedDistinctGroups: [[0, 1], [1, 2], [0, 2]],
      expectedEqualGroups: [],
    } satisfies ImageLoadKeyReplay,
  },
];

const materialTextureSlotExtensionNames = [
  "KHR_materials_anisotropy",
  "KHR_materials_clearcoat",
  "KHR_materials_diffuse_transmission",
  "KHR_materials_iridescence",
  "KHR_materials_sheen",
  "KHR_materials_specular",
  "KHR_materials_transmission",
  "KHR_materials_volume",
] as const;

const materialTextureSlotReplays: readonly FuzzReplay[] = [
  {
    label: "required anisotropy texture is accepted",
    value: {
      document: {
        extensionsRequired: ["KHR_materials_anisotropy"],
        extensionsUsed: ["KHR_materials_anisotropy"],
        materials: [{
          extensions: {
            KHR_materials_anisotropy: {
              anisotropyTexture: { index: 0 },
            },
          },
        }],
      },
      expectedPass: true,
    } satisfies MaterialTextureSlotReplay,
  },
  {
    label: "optional anisotropy texture is accepted",
    value: {
      document: {
        extensionsUsed: ["KHR_materials_anisotropy"],
        materials: [{
          extensions: {
            KHR_materials_anisotropy: {
              anisotropyStrength: 0.7,
              anisotropyTexture: { index: 0 },
            },
          },
        }],
      },
      expectedPass: true,
    } satisfies MaterialTextureSlotReplay,
  },
  {
    label: "required clearcoat normal map is accepted",
    value: {
      document: {
        extensionsRequired: ["KHR_materials_clearcoat"],
        extensionsUsed: ["KHR_materials_clearcoat"],
        materials: [{
          extensions: {
            KHR_materials_clearcoat: {
              clearcoatNormalTexture: { index: 0 },
            },
          },
        }],
      },
      expectedPass: true,
    } satisfies MaterialTextureSlotReplay,
  },
  {
    label: "required diffuse transmission textures are accepted",
    value: {
      document: {
        extensionsRequired: ["KHR_materials_diffuse_transmission"],
        extensionsUsed: ["KHR_materials_diffuse_transmission"],
        materials: [{
          extensions: {
            KHR_materials_diffuse_transmission: {
              diffuseTransmissionColorTexture: { index: 1 },
              diffuseTransmissionTexture: { index: 0 },
            },
          },
        }],
      },
      expectedPass: true,
    } satisfies MaterialTextureSlotReplay,
  },
  {
    label: "optional clearcoat normal map remains a fallback-compatible diagnostic path",
    value: {
      document: {
        extensionsUsed: ["KHR_materials_clearcoat"],
        materials: [{
          extensions: {
            KHR_materials_clearcoat: {
              clearcoatNormalTexture: { index: 0 },
            },
          },
        }],
      },
      expectedPass: true,
    } satisfies MaterialTextureSlotReplay,
  },
  {
    label: "required supported material texture slots are accepted",
    value: {
      document: {
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
        materials: [{
          extensions: {
            KHR_materials_clearcoat: {
              clearcoatRoughnessTexture: { index: 1 },
              clearcoatTexture: { index: 0 },
            },
            KHR_materials_iridescence: {
              iridescenceTexture: { index: 4 },
              iridescenceThicknessTexture: { index: 5 },
            },
            KHR_materials_sheen: {
              sheenColorTexture: { index: 2 },
              sheenRoughnessTexture: { index: 3 },
            },
            KHR_materials_specular: {
              specularColorTexture: { index: 7 },
              specularTexture: { index: 6 },
            },
            KHR_materials_transmission: {
              transmissionTexture: { index: 8 },
            },
            KHR_materials_volume: {
              thicknessTexture: { index: 9 },
            },
          },
        }],
      },
      expectedPass: true,
    } satisfies MaterialTextureSlotReplay,
  },
];

const randomTextureInfo = (random: SeededRandom): { readonly index: number; readonly texCoord?: number } => ({
  index: random.int(0, 12),
  ...(random.boolean(0.35) ? { texCoord: random.int(0, 4) } : {}),
});

const randomMaterialTextureSlotDocument = (random: SeededRandom): GltfDocument => {
  const requiredExtensions = materialTextureSlotExtensionNames.filter(() => random.boolean(0.55));
  const usedExtensions = materialTextureSlotExtensionNames.filter((extension) =>
    requiredExtensions.includes(extension) || random.boolean(0.55));
  const materialCount = random.int(1, 5);
  return {
    extensionsRequired: requiredExtensions,
    extensionsUsed: usedExtensions,
    materials: random.array(materialCount, () => ({
      extensions: {
        ...(usedExtensions.includes("KHR_materials_anisotropy") ? {
          KHR_materials_anisotropy: {
            ...(random.boolean(0.55) ? { anisotropyTexture: randomTextureInfo(random) } : {}),
          },
        } : {}),
        ...(usedExtensions.includes("KHR_materials_clearcoat") ? {
          KHR_materials_clearcoat: {
            ...(random.boolean(0.55) ? { clearcoatTexture: randomTextureInfo(random) } : {}),
            ...(random.boolean(0.55) ? { clearcoatRoughnessTexture: randomTextureInfo(random) } : {}),
            ...(random.boolean(0.22) ? { clearcoatNormalTexture: randomTextureInfo(random) } : {}),
          },
        } : {}),
        ...(usedExtensions.includes("KHR_materials_diffuse_transmission") ? {
          KHR_materials_diffuse_transmission: {
            ...(random.boolean(0.55) ? { diffuseTransmissionColorTexture: randomTextureInfo(random) } : {}),
            ...(random.boolean(0.55) ? { diffuseTransmissionTexture: randomTextureInfo(random) } : {}),
          },
        } : {}),
        ...(usedExtensions.includes("KHR_materials_iridescence") ? {
          KHR_materials_iridescence: {
            ...(random.boolean(0.55) ? { iridescenceTexture: randomTextureInfo(random) } : {}),
            ...(random.boolean(0.55) ? { iridescenceThicknessTexture: randomTextureInfo(random) } : {}),
          },
        } : {}),
        ...(usedExtensions.includes("KHR_materials_sheen") ? {
          KHR_materials_sheen: {
            ...(random.boolean(0.55) ? { sheenColorTexture: randomTextureInfo(random) } : {}),
            ...(random.boolean(0.55) ? { sheenRoughnessTexture: randomTextureInfo(random) } : {}),
          },
        } : {}),
        ...(usedExtensions.includes("KHR_materials_specular") ? {
          KHR_materials_specular: {
            ...(random.boolean(0.55) ? { specularTexture: randomTextureInfo(random) } : {}),
            ...(random.boolean(0.55) ? { specularColorTexture: randomTextureInfo(random) } : {}),
          },
        } : {}),
        ...(usedExtensions.includes("KHR_materials_transmission") ? {
          KHR_materials_transmission: {
            ...(random.boolean(0.55) ? { transmissionTexture: randomTextureInfo(random) } : {}),
          },
        } : {}),
        ...(usedExtensions.includes("KHR_materials_volume") ? {
          KHR_materials_volume: {
            ...(random.boolean(0.55) ? { thicknessTexture: randomTextureInfo(random) } : {}),
          },
        } : {}),
      },
    })),
  };
};

describe("renderer-webgl glTF texture validation properties", () => {
  it("reports unsupported required extensions uniquely and in source order", () => {
    forEachFuzzCase({ cases: 32, seed: 0x7a9f5c31 }, ({ label, random }) => {
      const required = randomRequiredExtensions(random);
      const supportedValues = extensionPool.filter(() => random.boolean(0.55));
      const supported = new Set<string>(supportedValues);
      const document = { extensionsRequired: required } as GltfDocument;

      const unsupported = unsupportedRequiredGltfExtensions(document, supported);
      expect(unsupported, `${label} filtered unsupported`).toEqual(expectedUnsupported(required, supported));
      expect(new Set(unsupported).size, `${label} unique unsupported`).toBe(unsupported.length);

      const documentWithDifferentIrrelevantFields = {
        ...document,
        images: random.array(random.int(0, 4), () => randomSvgImage(random)),
        textures: random.array(random.int(0, 4), () => ({})),
      } as GltfDocument;
      expect(
        unsupportedRequiredGltfExtensions(documentWithDifferentIrrelevantFields, supported),
        `${label} only required/supported sets matter`,
      ).toEqual(unsupported);
    });
  });

  it("rejects required texture source extensions when the texture also has a core source", () => {
    forEachFuzzCase({ cases: 24, replays: textureSourceConflictReplays, seed: 0x2190a7e4 }, ({
      label,
      random,
      replay,
    }) => {
      const replayValue = replay as TextureSourceConflictReplay | undefined;
      const extension = replayValue?.extension ?? random.pick(textureSourceExtensions);
      const textureCount = random.int(1, 6);
      const conflictIndex = replayValue?.conflictIndex ?? random.int(0, textureCount);
      const document = replayValue?.document
        ?? documentWithConflictingTextureSource(extension, textureCount, conflictIndex);
      const counters = validationCounters(document, "rejected");

      expect(
        () => assertSupportedRequiredGltfExtensions("conflict.gltf", document),
        `${label} extension=${extension} conflict=${conflictIndex} counters=${JSON.stringify(counters)}`,
      ).toThrow(/must omit core source/);
    });
  });

  it("keeps required material texture slot validation aligned with implemented renderer support", () => {
    forEachFuzzCase({ cases: 40, replays: materialTextureSlotReplays, seed: 0x4e8a2f19 }, ({
      label,
      random,
      replay,
    }) => {
      const replayValue = replay as MaterialTextureSlotReplay | undefined;
      const document = replayValue?.document ?? randomMaterialTextureSlotDocument(random);
      expectValidationOutcome(
        document,
        replayValue?.expectedPass ?? true,
        label,
        replayValue?.expectedMessage,
      );
    });
  });

  it("validates GS_texture_svg extension usage and SVG image reference coherence", () => {
    forEachFuzzCase({ cases: 48, replays: gsSvgReplays, seed: 0x56bd49e2 }, ({ label, random, replay }) => {
      const replayValue = replay as GsSvgReplay | undefined;
      const document = replayValue?.document ?? randomGsSvgDocument(random);
      expectValidationOutcome(
        document,
        replayValue?.expectedPass ?? gsSvgDocumentShouldPass(document),
        label,
        replayValue?.expectedMessage,
      );
    });
  });

  it("keeps generated image load keys distinct across source kind and backing source identity", () => {
    forEachFuzzCase({ cases: 32, replays: imageLoadKeyReplays, seed: 0x91e0f3c6 }, ({
      label,
      random,
      replay,
      seed,
    }) => {
      const assetKey = `asset-${seed.toString(16)}`;
      const src = `https://example.test/models/${seed.toString(16)}/scene.gltf`;
      const replayValue = replay as ImageLoadKeyReplay | undefined;
      if (replayValue !== undefined) {
        const keys = replayValue.entries.map((entry) => ({
          description: entry.description,
          key: gltfImageLoadKey(assetKey, src, entry.imageIndex, entry.image, entry.kind),
        }));
        for (const group of replayValue.expectedEqualGroups) {
          const expected = keys[group[0] ?? 0]?.key;
          expect(
            group.map((index) => keys[index]?.key),
            `${label} equal group=${JSON.stringify(group)} keys=${JSON.stringify(keys)}`,
          ).toEqual(group.map(() => expected));
        }
        for (const group of replayValue.expectedDistinctGroups) {
          const groupKeys = group.map((index) => keys[index]?.key);
          expect(
            new Set(groupKeys).size,
            `${label} distinct group=${JSON.stringify(group)} keys=${JSON.stringify(keys)}`,
          ).toBe(groupKeys.length);
        }
        return;
      }

      const entries: { readonly key: string; readonly summary: string }[] = [];

      const uriCount = random.int(1, 5);
      for (let index = 0; index < uriCount; index += 1) {
        const kind = randomImageKind(random);
        const image = { uri: `textures/${index}-${kind}.ktx2` };
        const key = gltfImageLoadKey(assetKey, src, index, image, kind);
        if (key !== undefined) entries.push({ key, summary: `uri:${index}:${kind}` });
      }

      const bufferViewCount = random.int(1, 5);
      for (let index = 0; index < bufferViewCount; index += 1) {
        const kind = randomImageKind(random);
        const image = {
          bufferView: index,
          mimeType: kind === "svg" ? "image/svg+xml" : kind === "basisu" ? "image/ktx2" : "image/png",
        };
        const key = gltfImageLoadKey(assetKey, src, index + uriCount, image, kind);
        if (key !== undefined) entries.push({ key, summary: `bufferView:${index}:${kind}` });
      }

      const keys = entries.map((entry) => entry.key);
      expect(new Set(keys).size, `${label} entries=${JSON.stringify(entries)}`).toBe(keys.length);
    });
  });
});
