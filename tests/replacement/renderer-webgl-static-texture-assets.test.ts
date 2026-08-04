import { describe, expect, it } from "vitest";
import { collectStaticTextureAssets } from "../../packages/renderer-webgl/src/gltf/static-texture-assets";
import type { CanonicalStandardMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import type { EmbeddedTextureAssetRef } from "../../packages/renderer-webgl/src/texture/asset-owner";

const asset = (
  contentKey: string,
  colorSpace: "linear" | "srgb" = "srgb",
): EmbeddedTextureAssetRef => ({
  bytes: new Uint8Array([1]),
  colorSpace,
  contentKey,
  kind: "embedded-asset",
  label: contentKey,
  mimeType: "image/png",
});

const material = (
  values: Partial<CanonicalStandardMaterial>,
): CanonicalStandardMaterial => ({
  baseColor: [1, 1, 1, 1],
  emissiveFactor: [0, 0, 0],
  kind: "standard",
  metallicFactor: 1,
  normalScale: 1,
  occlusionStrength: 1,
  requiresTextureCoordinates: true,
  roughnessFactor: 1,
  ...values,
});

describe("static texture asset collection", () => {
  it("prepares the lowest material LOD base presentation first", () => {
    const preferredA = asset("preferred-a");
    const preferredB = asset("preferred-b");
    const previewA = asset("preview-a");
    const previewB = asset("preview-b");
    const levelsA = [
      material({ baseColorAsset: preferredA }),
      material({ baseColorAsset: previewA }),
    ];
    const levelsB = [
      material({ baseColorAsset: preferredB }),
      material({ baseColorAsset: previewB }),
    ];

    expect(collectStaticTextureAssets([{
      material: levelsA[0]!,
      materialLod: { levels: levelsA },
    }, {
      material: levelsB[0]!,
      materialLod: { levels: levelsB },
    }])).toEqual([previewA, previewB, preferredA, preferredB]);
  });

  it("promotes shared content to its earliest visible contribution", () => {
    const shared = asset("shared");
    const base = asset("base");
    const detail = asset("detail", "linear");
    const primitives = [
      { material: material({ emissiveAsset: shared }) },
      { material: material({ baseColorAsset: base }) },
      { material: material({ baseColorAsset: shared, normalAsset: detail }) },
    ];

    expect(collectStaticTextureAssets(primitives)).toEqual([base, shared, detail]);
  });

  it("deduplicates repeated material graphs but keeps color-space storage distinct", () => {
    const srgb = asset("shared", "srgb");
    const linear = asset("shared", "linear");
    const source = material({ baseColorAsset: srgb, normalAsset: linear });
    const variant = material({ emissiveAsset: srgb });
    const primitives = [
      { material: source, materialVariants: new Map([["ruby", variant]]) },
      { material: source, materialVariants: new Map([["ruby", variant]]) },
    ];

    expect(collectStaticTextureAssets(primitives)).toEqual([srgb, linear]);
  });

  it("keeps atomically published detail maps adjacent by material", () => {
    const baseA = asset("base-a");
    const baseB = asset("base-b");
    const emissiveB = asset("emissive-b");
    const metallicRoughnessA = asset("metallic-roughness-a", "linear");
    const normalA = asset("normal-a", "linear");
    const occlusionA = asset("occlusion-a", "linear");
    const metallicRoughnessB = asset("metallic-roughness-b", "linear");
    const normalB = asset("normal-b", "linear");
    const primitives = [
      { material: material({
        baseColorAsset: baseA,
        metallicRoughnessAsset: metallicRoughnessA,
        normalAsset: normalA,
        occlusionAsset: occlusionA,
      }) },
      { material: material({
        baseColorAsset: baseB,
        emissiveAsset: emissiveB,
        metallicRoughnessAsset: metallicRoughnessB,
        normalAsset: normalB,
      }) },
    ];

    expect(collectStaticTextureAssets(primitives)).toEqual([
      baseA,
      baseB,
      emissiveB,
      metallicRoughnessA,
      normalA,
      occlusionA,
      metallicRoughnessB,
      normalB,
    ]);
  });
});
