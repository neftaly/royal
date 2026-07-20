import { describe, expect, it } from "vitest";
import type { CanonicalSurfaceMaterial, CanonicalTextureBinding } from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  composeSurfaceTextureBindings,
  materialTextureBindingAt,
  presentableBaseColorInto,
  presentableOrdinaryTextureMask,
  residentOrdinaryTextureMask,
  surfaceTexturesUseIdentityCoordinates,
  surfaceTextureFeatureBits,
  surfaceTextureUnitMask,
} from "../../packages/renderer-webgl/src/surface/surface-texture-plan";
import {
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_DIRECTIONAL_LIGHTS,
  SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES,
  SURFACE_FEATURE_NORMAL_TEXTURE,
  SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
} from "../../packages/renderer-webgl/src/surface/surface-program-features";
import type { GpuTextureBinding } from "../../packages/renderer-webgl/src/texture/gpu-owner";
import type { VirtualTextureGpuBinding } from "../../packages/renderer-webgl/src/virtual-texture/runtime-contract";
import type { PrefilteredEnvironmentGpuBinding } from "../../packages/renderer-webgl/src/environment/gpu-owner";

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
      [resident, resident, resident, empty, empty, empty, empty, empty, empty],
      0,
    )).toBe(0b1);
    expect(presentableOrdinaryTextureMask(
      material,
      [resident, resident, empty, empty, empty, empty, empty, empty, empty],
      0,
    )).toBe(0b1);
    expect(presentableOrdinaryTextureMask(
      material,
      [resident, resident, resident, empty, empty, empty, empty, empty, empty],
      0,
    )).toBe(0b111);
  });

  it("selects every standard texture feature without aliasing shader units", () => {
    const material = standard({
      specularFactor: 1,
      thicknessFactor: 1,
      transmissionFactor: 1,
    });
    const features = surfaceTextureFeatureBits(
      material,
      true,
      true,
      SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
      true,
      true,
      false,
      0b1_1111_1111,
      true,
    );
    expect(surfaceTextureUnitMask(features)).toBe(0b1111_0111_1111);
    expect(features & SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES).not.toBe(0);
    expect(features & SURFACE_FEATURE_DIRECTIONAL_LIGHTS).not.toBe(0);

    const virtualFeatures = surfaceTextureFeatureBits(
      material,
      true,
      true,
      SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
      true,
      true,
      true,
      0b1_1111_1111,
      true,
    );
    expect(surfaceTextureUnitMask(virtualFeatures)).toBe(0b1111_1111_1111);
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
