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
  it("promotes shared content to its earliest visible contribution", () => {
    const shared = asset("shared");
    const base = asset("base");
    const detail = asset("detail", "linear");
    const primitives = [
      { material: material({ baseColorAsset: base, emissiveAsset: shared }) },
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
});
