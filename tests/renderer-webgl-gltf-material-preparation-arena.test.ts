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
    const firstPrimitive = primitive(loadedMaterial);
    const secondPrimitive = primitive(loadedMaterial);
    const contentKeys = new Map<string, TextureContentKey>();

    const pending = arena.prepare(firstPrimitive, loadedMaterial, contentKeys, false);
    expect(arena.prepare(firstPrimitive, loadedMaterial, contentKeys, true)).toBe(pending);
    expect(pending.material.baseColor).toMatchObject({ kind: "solid" });

    arena.invalidate([loadedMaterial]);
    const ready = arena.prepare(firstPrimitive, loadedMaterial, contentKeys, true);
    const otherPrimitiveReady = arena.prepare(secondPrimitive, loadedMaterial, contentKeys, true);
    expect(ready).not.toBe(pending);
    expect(ready.material.baseColor).toMatchObject({
      colorSpace: "srgb",
      kind: "asset",
      preparedOnly: true,
      uri: "texture:base",
    });
    expect(otherPrimitiveReady.materialBatchClassId).toBe(ready.materialBatchClassId);

    arena.clear();
    expect(arena.prepare(firstPrimitive, loadedMaterial, contentKeys, true)).not.toBe(ready);
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
