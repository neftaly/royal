import { describe, expect, it } from "vitest";
import {
  resolveCanonicalMaterialTexture,
  type CanonicalSurfaceMaterial,
  type CanonicalTextureBinding,
} from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  composeSurfaceTextureBindings,
  materialTextureBindingAt,
  presentableBaseColorInto,
  presentableOrdinaryTextureMask,
  residentOrdinaryTextureMask,
  surfaceTexturesUseIdentityCoordinates,
  surfaceProgramFeatureBits,
  surfaceTextureUnitMask,
} from "../../packages/renderer-webgl/src/surface/surface-texture-plan";
import {
  SURFACE_FEATURE_ALPHA_BLEND,
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_DIRECTIONAL_LIGHTS,
  SURFACE_FEATURE_EMISSIVE_TEXTURE,
  SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES,
  SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE,
  SURFACE_FEATURE_NORMAL_TEXTURE,
  SURFACE_FEATURE_OCCLUSION_TEXTURE,
  SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
  SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE,
  SURFACE_FEATURE_SPECULAR_TEXTURE,
  SURFACE_FEATURE_THICKNESS_TEXTURE,
  SURFACE_FEATURE_TRANSMISSION_MATERIAL,
  SURFACE_FEATURE_TRANSMISSION_TEXTURE,
  SURFACE_FEATURE_VERTEX_NORMAL,
  SURFACE_FEATURE_VOLUME_MATERIAL,
} from "../../packages/renderer-webgl/src/surface/surface-program-features";
import type { GpuTextureBinding } from "../../packages/renderer-webgl/src/texture/gpu-owner";
import type { VirtualTextureGpuBinding } from "../../packages/renderer-webgl/src/virtual-texture/runtime-contract";
import type { PrefilteredEnvironmentGpuBinding } from "../../packages/renderer-webgl/src/environment/gpu-owner";
import type {
  DecodedTextureSource,
  TextureSourceRef,
} from "../../packages/renderer-webgl/src/texture/asset-owner";

const gpuBinding = (label: string): GpuTextureBinding => ({
  sampler: { label: `${label}-sampler` } as unknown as WebGLSampler,
  target: "2d",
  texture: { label } as unknown as WebGLTexture,
});

const canonicalBinding = (label: string): CanonicalTextureBinding => ({
  colorSpace: "linear",
  decoded: { height: 1, source: {} as ImageBitmap, width: 1 },
  sampler: {
    magFilter: "linear",
    minFilter: "linear",
    wrapS: "clamp-to-edge",
    wrapT: "clamp-to-edge",
  },
  samplerKey: `${label}-sampler`,
  storageKey: label,
});

const standard = (
  overrides: Partial<Extract<CanonicalSurfaceMaterial, { kind: "standard" }>> = {},
): Extract<CanonicalSurfaceMaterial, { kind: "standard" }> => ({
  baseColor: [1, 1, 1, 1],
  emissiveFactor: [0, 0, 0],
  kind: "standard",
  metallicFactor: 0,
  normalScale: 1,
  occlusionStrength: 1,
  requiresTextureCoordinates: false,
  roughnessFactor: 1,
  ...overrides,
});

describe("surface texture planning core", () => {
  it("selects alpha preservation only for blended surfaces", () => {
    const opaque = surfaceProgramFeatureBits({
      environmentFeatures: 0,
      hasDirectionalLights: false,
      hasPunctualLights: false,
      hasTangent: false,
      hasVertexColor: false,
      hasVertexNormal: false,
      hasVirtualBaseColor: false,
      linearOutput: false,
      material: standard(),
      ordinaryTextureMask: 0,
    });
    const blended = surfaceProgramFeatureBits({
      environmentFeatures: 0,
      hasDirectionalLights: false,
      hasPunctualLights: false,
      hasTangent: false,
      hasVertexColor: false,
      hasVertexNormal: false,
      hasVirtualBaseColor: false,
      linearOutput: false,
      material: standard({ alphaBlend: true }),
      ordinaryTextureMask: 0,
    });
    expect(opaque & SURFACE_FEATURE_ALPHA_BLEND).toBe(0);
    expect(blended & SURFACE_FEATURE_ALPHA_BLEND).toBe(SURFACE_FEATURE_ALPHA_BLEND);
  });

  it("selects authored vertex normals independently from normal textures", () => {
    const features = surfaceProgramFeatureBits({
      environmentFeatures: 0,
      hasDirectionalLights: false,
      hasPunctualLights: false,
      hasTangent: false,
      hasVertexColor: false,
      hasVertexNormal: true,
      hasVirtualBaseColor: false,
      linearOutput: false,
      material: standard(),
      ordinaryTextureMask: 0,
    });
    expect(features & SURFACE_FEATURE_VERTEX_NORMAL).toBe(SURFACE_FEATURE_VERTEX_NORMAL);
    expect(features & SURFACE_FEATURE_NORMAL_TEXTURE).toBe(0);
  });

  it("keeps one neutral fallback for ordinary and virtual base-color representations", () => {
    const output = new Float32Array(4);
    const solid = standard({ baseColor: [0.2, 0.4, 0.8, 0.6] });
    expect(presentableBaseColorInto(output, solid, false)).toBe(solid.baseColor);

    const ordinary = standard({
      baseColor: [0.5, 0.75, 1, 0.6],
      baseColorAsset: { kind: "asset", src: "/albedo.png" },
    });
    expect(Array.from(presentableBaseColorInto(output, ordinary, false))).toEqual([
      expect.closeTo(0.5 * 0.214_041, 6),
      expect.closeTo(0.75 * 0.214_041, 6),
      expect.closeTo(0.214_041, 6),
      expect.closeTo(0.6, 6),
    ]);
    expect(presentableBaseColorInto(output, ordinary, true)).toBe(ordinary.baseColor);

    const virtual = standard({
      baseColor: [0.5, 0.75, 1, 0.6],
      baseColorVirtualAsset: { kind: "virtual-asset", manifestUri: "/albedo.vt.json" },
    });
    expect(Array.from(presentableBaseColorInto(output, virtual, false))).toEqual([
      expect.closeTo(0.5 * 0.214_041, 6),
      expect.closeTo(0.75 * 0.214_041, 6),
      expect.closeTo(0.214_041, 6),
      expect.closeTo(0.6, 6),
    ]);
  });

  it("composes the fixed unit ABI without moving ordinary material slots", () => {
    const ordinary = Array.from({ length: 11 }, (_, index) => gpuBinding(`ordinary-${index}`));
    const atlas = gpuBinding("virtual-atlas");
    const pageTable = gpuBinding("virtual-page-table");
    const sceneColor = gpuBinding("scene-color");
    const environment = gpuBinding("environment");
    const virtualTexture = {
      atlas,
      pageTable,
      settings0: new Float32Array(),
      settings1: new Float32Array(),
      settings2: new Float32Array(),
    } satisfies VirtualTextureGpuBinding;
    const prefilteredEnvironment = {
      coefficients: new Float32Array(),
      mipCount: 1,
      texture: environment,
    } satisfies PrefilteredEnvironmentGpuBinding;
    const bindings = composeSurfaceTextureBindings(
      ordinary,
      2,
      virtualTexture,
      sceneColor,
      prefilteredEnvironment,
    );

    expect(bindings).toHaveLength(12);
    expect(bindings).toEqual([
      atlas,
      ordinary[3],
      ordinary[4],
      ordinary[5],
      ordinary[6],
      ordinary[7],
      ordinary[8],
      pageTable,
      ordinary[9],
      ordinary[10],
      sceneColor,
      environment,
    ]);
  });

  it("uses explicit null bindings for absent optional representations", () => {
    const ordinary = Array.from({ length: 9 }, (_, index) => gpuBinding(`ordinary-${index}`));
    const bindings = composeSurfaceTextureBindings(
      ordinary,
      0,
      undefined,
      undefined,
      undefined,
    );

    expect(bindings[0]).toBe(ordinary[0]);
    expect(bindings[7]).toEqual({ sampler: null, target: "2d", texture: null });
    expect(bindings[8]).toBe(ordinary[7]);
    expect(bindings[9]).toBe(ordinary[8]);
    expect(bindings[10]).toEqual({ sampler: null, target: "2d", texture: null });
    expect(bindings[11]).toEqual({ sampler: null, target: "2d", texture: null });
  });

  it("derives residency and material slots from their exact authored positions", () => {
    const empty: GpuTextureBinding = { sampler: null, target: "2d", texture: null };
    const resident = gpuBinding("resident");
    expect(residentOrdinaryTextureMask([
      resident,
      empty,
      resident,
      empty,
      resident,
      empty,
      resident,
      empty,
      resident,
      empty,
      resident,
    ], 2)).toBe(0b1_0101_0101);

    const authored = Array.from({ length: 9 }, (_, index) => canonicalBinding(`slot-${index}`));
    const material = standard({
      baseColorTexture: authored[0]!,
      emissiveTexture: authored[3]!,
      metallicRoughnessTexture: authored[1]!,
      normalTexture: authored[2]!,
      occlusionTexture: authored[4]!,
      specularColorTexture: authored[6]!,
      specularTexture: authored[5]!,
      thicknessTexture: authored[8]!,
      transmissionTexture: authored[7]!,
    });
    expect(Array.from({ length: 9 }, (_, unit) => materialTextureBindingAt(material, unit)))
      .toEqual(authored);
  });

  it("publishes paced lighting maps only as one coherent material set", () => {
    const empty: GpuTextureBinding = { sampler: null, target: "2d", texture: null };
    const resident = gpuBinding("resident");
    const metallicRoughnessTexture = canonicalBinding("metallic-roughness");
    const normalTexture = canonicalBinding("normal");
    const material = standard({
      metallicRoughnessAsset: { kind: "asset", src: "/metallic-roughness.png" },
      metallicRoughnessTexture,
      normalAsset: { kind: "asset", src: "/normal.png" },
      normalTexture,
    });

    expect(presentableOrdinaryTextureMask(
      { ...material, mapWaits: 1 },
      residentOrdinaryTextureMask(
        [resident, resident, resident, empty, empty, empty, empty, empty, empty], 0,
      ),
    )).toBe(0b1);
    expect(presentableOrdinaryTextureMask(
      material,
      residentOrdinaryTextureMask(
        [resident, resident, empty, empty, empty, empty, empty, empty, empty], 0,
      ),
    )).toBe(0b1);
    expect(presentableOrdinaryTextureMask(
      material,
      residentOrdinaryTextureMask(
        [resident, resident, resident, empty, empty, empty, empty, empty, empty], 0,
      ),
    )).toBe(0b111);

    const transmissionMaterial = standard({
      thicknessTexture: canonicalBinding("thickness"),
      transmissionTexture: canonicalBinding("transmission"),
    });
    expect(presentableOrdinaryTextureMask(
      transmissionMaterial,
      residentOrdinaryTextureMask(
        [resident, empty, empty, empty, empty, empty, empty, resident, empty], 0,
      ),
    )).toBe(0b1);
    expect(presentableOrdinaryTextureMask(
      transmissionMaterial,
      residentOrdinaryTextureMask(
        [resident, empty, empty, empty, empty, empty, empty, resident, resident], 0,
      ),
    )).toBe(0b1_1000_0001);
  });

  it("publishes successful maps after sibling failures settle to neutral semantics", () => {
    const asset = (name: string): TextureSourceRef => ({
      kind: "asset",
      src: `/${name}.png`,
    });
    const assets = {
      baseColor: asset("base-color"),
      emissive: asset("emissive"),
      metallicRoughness: asset("metallic-roughness"),
      normal: asset("normal"),
      occlusion: asset("occlusion"),
      specular: asset("specular"),
      specularColor: asset("specular-color"),
      thickness: asset("thickness"),
      transmission: asset("transmission"),
    };
    const source = standard({
      baseColor: [0.25, 0.5, 0.75, 0.8],
      baseColorAsset: assets.baseColor,
      emissiveAsset: assets.emissive,
      emissiveFactor: [0.2, 0.3, 0.4],
      metallicFactor: 0.6,
      metallicRoughnessAsset: assets.metallicRoughness,
      normalAsset: assets.normal,
      normalScale: 0.7,
      occlusionAsset: assets.occlusion,
      occlusionStrength: 0.5,
      roughnessFactor: 0.35,
      specularColorAsset: assets.specularColor,
      specularColorFactor: [0.8, 0.7, 0.6],
      specularFactor: 0.9,
      specularTextureAsset: assets.specular,
      thicknessAsset: assets.thickness,
      thicknessFactor: 0.4,
      transmissionAsset: assets.transmission,
      transmissionFactor: 0.75,
    });
    const decodedSource: DecodedTextureSource = {
      height: 1,
      source: {} as ImageBitmap,
      width: 1,
    };
    const successful = new Set<TextureSourceRef>([
      assets.baseColor,
      assets.emissive,
      assets.metallicRoughness,
      assets.transmission,
    ]);
    const pending = resolveCanonicalMaterialTexture(
      source,
      (candidate) => successful.has(candidate) ? decodedSource : undefined,
      () => true,
    );
    expect(pending.kind === "standard" && pending.mapWaits).toBe(0b11);

    const settled = resolveCanonicalMaterialTexture(
      source,
      (candidate) => successful.has(candidate) ? decodedSource : undefined,
      () => false,
    );
    expect(settled.kind).toBe("standard");
    if (settled.kind !== "standard") throw new Error("expected standard material");
    expect(settled.mapWaits).toBeUndefined();
    expect(settled).toMatchObject({
      baseColor: source.baseColor,
      emissiveFactor: source.emissiveFactor,
      metallicFactor: source.metallicFactor,
      normalScale: source.normalScale,
      occlusionStrength: source.occlusionStrength,
      roughnessFactor: source.roughnessFactor,
      specularColorFactor: source.specularColorFactor,
      specularFactor: source.specularFactor,
      thicknessFactor: source.thicknessFactor,
      transmissionFactor: source.transmissionFactor,
    });
    const residentMask = 1 << 0 | 1 << 1 | 1 << 3 | 1 << 7;
    const features = surfaceProgramFeatureBits({
      environmentFeatures: 0,
      hasDirectionalLights: false,
      hasPunctualLights: false,
      hasTangent: false,
      hasVertexColor: false,
      hasVertexNormal: true,
      hasVirtualBaseColor: false,
      linearOutput: true,
      material: settled,
      ordinaryTextureMask: presentableOrdinaryTextureMask(settled, residentMask),
    });
    expect(features & SURFACE_FEATURE_BASE_COLOR_TEXTURE).not.toBe(0);
    expect(features & SURFACE_FEATURE_EMISSIVE_TEXTURE).not.toBe(0);
    expect(features & SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE).not.toBe(0);
    expect(features & SURFACE_FEATURE_TRANSMISSION_TEXTURE).not.toBe(0);
    expect(features & SURFACE_FEATURE_NORMAL_TEXTURE).toBe(0);
    expect(features & SURFACE_FEATURE_OCCLUSION_TEXTURE).toBe(0);
    expect(features & SURFACE_FEATURE_SPECULAR_TEXTURE).toBe(0);
    expect(features & SURFACE_FEATURE_SPECULAR_COLOR_TEXTURE).toBe(0);
    expect(features & SURFACE_FEATURE_THICKNESS_TEXTURE).toBe(0);
  });

  it("selects every standard texture feature without aliasing shader units", () => {
    const material = standard({
      specularFactor: 1,
      thicknessFactor: 1,
      transmissionFactor: 1,
    });
    const features = surfaceProgramFeatureBits({
      environmentFeatures: SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
      hasDirectionalLights: true,
      hasPunctualLights: true,
      hasTangent: true,
      hasVertexColor: true,
      hasVertexNormal: true,
      hasVirtualBaseColor: false,
      linearOutput: true,
      material,
      ordinaryTextureMask: 0b1_1111_1111,
    });
    expect(surfaceTextureUnitMask(features)).toBe(0b1111_0111_1111);
    expect(features & SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES).not.toBe(0);
    expect(features & SURFACE_FEATURE_DIRECTIONAL_LIGHTS).not.toBe(0);
    expect(features & SURFACE_FEATURE_VOLUME_MATERIAL).toBe(SURFACE_FEATURE_VOLUME_MATERIAL);

    const virtualFeatures = surfaceProgramFeatureBits({
      environmentFeatures: SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
      hasDirectionalLights: true,
      hasPunctualLights: true,
      hasTangent: true,
      hasVertexColor: true,
      hasVertexNormal: true,
      hasVirtualBaseColor: true,
      linearOutput: true,
      material,
      ordinaryTextureMask: 0b1_1111_1111,
    });
    expect(surfaceTextureUnitMask(virtualFeatures)).toBe(0b1111_1111_1111);
  });

  it("specializes thin transmission separately from authored volume", () => {
    const thin = surfaceProgramFeatureBits({
      environmentFeatures: 0,
      hasDirectionalLights: false,
      hasPunctualLights: false,
      hasTangent: false,
      hasVertexColor: false,
      hasVertexNormal: false,
      hasVirtualBaseColor: false,
      linearOutput: true,
      material: standard({ transmissionFactor: 1 }),
      ordinaryTextureMask: 0,
    });
    const volume = surfaceProgramFeatureBits({
      environmentFeatures: 0,
      hasDirectionalLights: false,
      hasPunctualLights: false,
      hasTangent: false,
      hasVertexColor: false,
      hasVertexNormal: false,
      hasVirtualBaseColor: false,
      linearOutput: true,
      material: standard({ thicknessFactor: 0.5, transmissionFactor: 1 }),
      ordinaryTextureMask: 0,
    });

    expect(thin & SURFACE_FEATURE_TRANSMISSION_MATERIAL).not.toBe(0);
    expect(thin & SURFACE_FEATURE_VOLUME_MATERIAL).toBe(0);
    expect(volume & SURFACE_FEATURE_VOLUME_MATERIAL).not.toBe(0);
  });

  it("shares only the complete canonical identity coordinate lane", () => {
    const features = SURFACE_FEATURE_BASE_COLOR_TEXTURE | SURFACE_FEATURE_NORMAL_TEXTURE;
    expect(surfaceTexturesUseIdentityCoordinates(standard(), features)).toBe(true);
    expect(surfaceTexturesUseIdentityCoordinates(standard({
      normalTextureCoordinates: {
        row0: [1, 0, 0.25, 0],
        row1: [0, 1, 0, 0],
      },
    }), features)).toBe(false);
    expect(surfaceTexturesUseIdentityCoordinates(standard(), 0)).toBe(false);
  });
});
