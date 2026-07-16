import { describe, expect, it } from "vitest";
import type { TextureContentKey } from "@royal/renderer-core";
import {
  GltfMaterialPreparationArena,
  gltfMaterialTextureRefs,
  gltfPrimitiveMaterialForVariant,
  selectedGltfVariantIndex,
} from "../packages/renderer-webgl/src/gltf/material-preparation-arena";
import type {
  LoadedGltfMaterial,
  LoadedGltfPrimitive,
} from "../packages/renderer-webgl/src/gltf/prepared-asset";
import { IDENTITY_GLTF_TEXTURE_COORDINATES } from "../packages/renderer-webgl/src/gltf/texture-coordinates";

const material = (textureUri = "texture:base"): LoadedGltfMaterial => ({
  alphaMode: "OPAQUE",
  baseColorTexture: {
    coordinates: IDENTITY_GLTF_TEXTURE_COORDINATES,
    imageUri: "image:base",
    textureUri,
  },
  doubleSided: false,
  emissiveTexture: {
    coordinates: IDENTITY_GLTF_TEXTURE_COORDINATES,
    textureUri: "texture:emissive",
  },
  extensionTextures: {
    anisotropyTexture: {
      coordinates: IDENTITY_GLTF_TEXTURE_COORDINATES,
      textureUri: "texture:anisotropy",
    },
    clearcoatTexture: {
      coordinates: IDENTITY_GLTF_TEXTURE_COORDINATES,
      textureUri: "texture:clearcoat",
    },
    diffuseTransmissionColorTexture: {
      coordinates: IDENTITY_GLTF_TEXTURE_COORDINATES,
      textureUri: "texture:diffuse-transmission-color",
    },
    diffuseTransmissionTexture: {
      coordinates: IDENTITY_GLTF_TEXTURE_COORDINATES,
      textureUri: "texture:diffuse-transmission-strength",
    },
  },
});

const primitive = (
  baseMaterial: LoadedGltfMaterial,
  variants: readonly LoadedGltfMaterial[] = [],
): LoadedGltfPrimitive => ({
  baseMaterial: { material: baseMaterial, selectionKey: "base" },
  material: baseMaterial,
  materialVariants: variants.map((entry, index) => ({
    material: entry,
    variants: [index],
  })),
} as unknown as LoadedGltfPrimitive);

describe("glTF material preparation arena", () => {
  it("normalizes every material texture dependency with stable upload semantics", () => {
    const loadedMaterial = material();
    const baseContentKey = "content:base" as TextureContentKey;
    const refs = gltfMaterialTextureRefs(loadedMaterial, new Map([
      ["texture:base", baseContentKey],
    ]));

    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        colorSpace: "srgb",
        contentKey: baseContentKey,
        kind: "asset",
        preparedOnly: true,
        uri: "texture:base",
      }),
      expect.objectContaining({ colorSpace: "srgb", uri: "texture:emissive" }),
      expect.objectContaining({ colorSpace: "linear", uri: "texture:clearcoat" }),
      expect.objectContaining({ colorSpace: "linear", uri: "texture:anisotropy" }),
      expect.objectContaining({
        colorSpace: "srgb",
        uri: "texture:diffuse-transmission-color",
      }),
      expect.objectContaining({
        colorSpace: "linear",
        uri: "texture:diffuse-transmission-strength",
      }),
    ]));
    expect(refs).toHaveLength(6);
  });

  it("owns cache identity, reverse invalidation, and material batch classes", () => {
    const arena = new GltfMaterialPreparationArena();
    const loadedMaterial = material();
    const contentKeys = new Map<string, TextureContentKey>();

    const pending = arena.prepare(loadedMaterial, contentKeys, new Set(), true);
    expect(arena.prepare(loadedMaterial, contentKeys, new Set(), true)).toBe(pending);
    expect(pending.material.baseColor).toMatchObject({ kind: "solid" });

    arena.invalidate([loadedMaterial]);
    const readyImages = new Set(["image:base"]);
    const ready = arena.prepare(loadedMaterial, contentKeys, readyImages, false);
    const otherPrimitiveReady = arena.prepare(loadedMaterial, contentKeys, readyImages, false);
    expect(ready).not.toBe(pending);
    expect(ready.material.baseColor).toMatchObject({
      colorSpace: "srgb",
      kind: "asset",
      preparedOnly: true,
      uri: "texture:base",
    });
    expect(otherPrimitiveReady.materialBatchClassId).toBe(ready.materialBatchClassId);

    arena.clear();
    expect(arena.prepare(loadedMaterial, contentKeys, readyImages, false)).not.toBe(ready);
  });

  it("publishes a gray degraded base with a ready normal after base-color failure", () => {
    const arena = new GltfMaterialPreparationArena();
    const loadedMaterial: LoadedGltfMaterial = {
      ...material(),
      normalTexture: {
        coordinates: IDENTITY_GLTF_TEXTURE_COORDINATES,
        imageUri: "image:normal",
        textureUri: "texture:normal",
      },
    };
    const prepared = arena.prepare(
      loadedMaterial,
      new Map(),
      new Set(["image:normal"]),
      false,
    );

    expect(prepared.material.baseColor).toEqual({
      color: [0.21404114, 0.21404114, 0.21404114, 1],
      kind: "solid",
    });
    expect(prepared.material.normalTexture).toMatchObject({
      kind: "asset",
      uri: "texture:normal",
    });
    expect(prepared.material.basePending).toBeUndefined();
  });

  it("resolves named and numeric variants without accepting invalid selections", () => {
    const base = material("texture:base");
    const red = material("texture:red");
    const blue = material("texture:blue");
    const loadedPrimitive = primitive(base, [red, blue]);

    expect(selectedGltfVariantIndex(["red", "blue"], "blue")).toBe(1);
    expect(selectedGltfVariantIndex(["red", "blue"], "missing")).toBeUndefined();
    expect(gltfPrimitiveMaterialForVariant(1, loadedPrimitive)).toMatchObject({
      material: blue,
      selectionKey: "variant:1",
    });
    expect(gltfPrimitiveMaterialForVariant(8, loadedPrimitive)).toBe(loadedPrimitive.baseMaterial);
  });
});
