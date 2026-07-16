import { describe, expect, it } from "vitest";
import type { TextureContentKey } from "@royal/renderer-core";
import {
  planPreparedAssetDependencies,
} from "../packages/renderer-webgl/src/gltf/prepared-asset-dependencies";
import { preparedAssetMaterials } from "../packages/renderer-webgl/src/gltf/prepared-asset-materials";
import type {
  LoadedGltfMaterial,
  LoadedGltfPrimitive,
  PreparedGltfAsset,
} from "../packages/renderer-webgl/src/gltf/prepared-asset";
import { IDENTITY_GLTF_TEXTURE_COORDINATES } from "../packages/renderer-webgl/src/gltf/texture-coordinates";
import { identityMat4 } from "../packages/renderer-webgl/src/math/mat4";
import { DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS } from "../packages/renderer-webgl/src/webgl/materials";

const material = (textureUri: string): LoadedGltfMaterial => ({
  alphaMode: "OPAQUE",
  baseColorTexture: {
    coordinates: IDENTITY_GLTF_TEXTURE_COORDINATES,
    textureUri,
  },
  doubleSided: false,
});

const primitive = (
  key: string,
  base: LoadedGltfMaterial,
  lod: LoadedGltfMaterial,
  variant: LoadedGltfMaterial,
  variantLod: LoadedGltfMaterial,
): LoadedGltfPrimitive => ({
  baseMaterial: { material: base, selectionKey: "base" },
  instanceTransforms: [],
  key,
  localBounds: [],
  localModelDeterminants: [],
  localModels: [],
  material: base,
  materialLod: { levels: [lod, base], thresholds: [1, 2] },
  materialVariants: [{
    material: variant,
    materialLod: { levels: [variantLod, base], thresholds: [1, 2] },
    variants: [0],
  }],
  mode: "triangles",
  meshNodeIndex: 0,
  nodePath: [],
  objectBounds: undefined,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
});

const asset = (
  primitives: readonly LoadedGltfPrimitive[],
  withLighting = false,
): PreparedGltfAsset => ({
  hasMaterialLod: true,
  hasMaterialVariants: true,
  hasNodeLod: false,
  ...(withLighting ? {
    imageBasedLight: {
      coefficients: [],
      intensity: 1,
      rotation: identityMat4(),
      specular: {
        encoding: "linear" as const,
        imageLoadKeys: [],
        imageSize: 256,
        key: "ibl:studio",
      },
    },
  } : {}),
  lights: [],
  load: { imageFailures: 0, imageLoaded: 0, imageRequests: 0, startedAt: 0 },
  nodeCount: 1,
  primitives,
  variants: ["variant"],
});

describe("prepared glTF asset dependency core", () => {
  it("collects base, LOD, variant, and variant LOD materials once by identity", () => {
    const base = material("texture:shared");
    const lod = material("texture:shared");
    const variant = material("texture:shared");
    const variantLod = material("texture:shared");

    expect(preparedAssetMaterials(asset([
      primitive("primitive:0", base, lod, variant, variantLod),
      primitive("primitive:1", base, lod, variant, variantLod),
    ]))).toEqual([base, lod, variant, variantLod]);
  });

  it("returns deterministic geometry associations without mutating the asset", () => {
    const shared = material("texture:shared");
    const loadedPrimitive = primitive("primitive:0", shared, shared, shared, shared);
    const loadedAsset = asset([loadedPrimitive]);

    const first = planPreparedAssetDependencies(loadedAsset, new Map(), "asset:a");
    const repeated = planPreparedAssetDependencies(loadedAsset, new Map(), "asset:a");
    const otherAsset = planPreparedAssetDependencies(loadedAsset, new Map(), "asset:b");

    expect(repeated.manifest.geometries[0]?.key).toBe(first.manifest.geometries[0]?.key);
    expect(first.geometryAssociations).toEqual([{
      key: first.manifest.geometries[0]?.key,
      primitive: loadedPrimitive,
    }]);
    expect(otherAsset.manifest.geometries[0]?.key).not.toBe(first.manifest.geometries[0]?.key);
    expect(loadedPrimitive).not.toHaveProperty("geometryKey");
  });

  it("deduplicates texture cache identities while retaining material reference counts", () => {
    const base = material("texture:shared");
    const lod = material("texture:shared");
    const variant = material("texture:shared");
    const variantLod = material("texture:shared");
    const contentKey = "content:shared" as TextureContentKey;

    const plan = planPreparedAssetDependencies(
      asset([primitive("primitive:0", base, lod, variant, variantLod)], true),
      new Map([["texture:shared", contentKey]]),
      "asset:a",
    );

    expect(plan.manifest.ordinaryTextures).toHaveLength(1);
    expect(plan.manifest.ordinaryTextures[0]).toMatchObject({
      count: 4,
      texture: { contentKey, src: "texture:shared" },
    });
    expect(plan.manifest.iblKeys).toEqual([{ count: 1, key: "ibl:studio" }]);
    expect(plan.manifest.requiresHdrComposition).toBe(false);
    expect(plan.manifest.virtualTextures).toEqual([]);
  });

  it("requires an HDR intermediate only for scene-linear material composition", () => {
    const opaque = material("texture:opaque");
    const blended = { ...material("texture:blend"), alphaMode: "BLEND" as const };
    const transmissive = {
      ...material("texture:transmission"),
      extensionFactors: {
        ...DEFAULT_SURFACE_MATERIAL_EXTENSION_FACTORS,
        transmissionFactor: 0.5,
      },
    };
    const plan = (value: LoadedGltfMaterial) => planPreparedAssetDependencies(
      asset([primitive("primitive:0", value, value, value, value)]),
      new Map(),
      "asset:a",
    ).manifest.requiresHdrComposition;

    expect(plan(opaque)).toBe(false);
    expect(plan(blended)).toBe(true);
    expect(plan(transmissive)).toBe(true);
  });
});
