import { describe, expect, it } from "vitest";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  canonicalSurfacePassKind,
  canonicalSurfaceIsDoubleSided,
  canonicalTransmissionNeedsMipmaps,
  planSurfacePasses,
} from "../../packages/renderer-webgl/src/surface/surface-pass-plan";
import {
  linearCompositeColorBytesPerPixel,
  terminalPresentationRequested,
} from "../../packages/renderer-webgl/src/surface/terminal-presentation-plan";
import { compositeTargetByteLength } from "../../packages/renderer-webgl/src/surface/surface-composite-owner";

const standard = (
  overrides: Partial<Extract<CanonicalSurfaceMaterial, { kind: "standard" }>> = {},
): CanonicalSurfaceMaterial => ({
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

describe("fixed surface pass planning", () => {
  it("accounts for target color, depth-stencil, and the complete source mip chain", () => {
    expect(compositeTargetByteLength(2, 2, 4)).toBe(52);
    expect(compositeTargetByteLength(2, 2, 4, { mipmappedSceneColor: false })).toBe(48);
    expect(compositeTargetByteLength(2, 2, 4, { sceneColor: false })).toBe(32);
    expect(compositeTargetByteLength(1, 1, 8)).toBe(20);
  });

  it("keeps ordinary scenes on the direct opaque/transparent path", () => {
    const opaque = { material: standard() };
    const transparent = { material: standard({ alphaBlend: true }) };
    const plan = planSurfacePasses([transparent, opaque], (surface) => surface.material);
    expect(plan).toEqual({
      opaque: [opaque],
      requiresSceneColor: false,
      transmission: [],
      transparent: [transparent],
    });
  });

  it("gives requested transmission its fixed pass even when alpha blend is authored", () => {
    const inactive = standard({ transmissionFactor: 0 });
    const active = standard({ alphaBlend: true, transmissionFactor: 0.5 });
    expect(canonicalSurfacePassKind(inactive)).toBe("opaque");
    expect(canonicalSurfacePassKind(active)).toBe("transmission");
    const surface = { material: active };
    expect(planSurfacePasses([surface], (entry) => entry.material)).toEqual({
      opaque: [],
      requiresSceneColor: true,
      transmission: [surface],
      transparent: [],
    });
  });

  it("requests source mipmaps only for active rough or roughness-textured transmission", () => {
    expect(canonicalTransmissionNeedsMipmaps(standard({ transmissionFactor: 0, roughnessFactor: 1 }))).toBe(false);
    expect(canonicalTransmissionNeedsMipmaps(standard({ transmissionFactor: 1, roughnessFactor: 0.099 }))).toBe(false);
    expect(canonicalTransmissionNeedsMipmaps(standard({ transmissionFactor: 1, roughnessFactor: 0.1 }))).toBe(true);
    expect(canonicalTransmissionNeedsMipmaps(standard({
      metallicRoughnessAsset: {
        bytes: new Uint8Array(),
        contentKey: "roughness",
        kind: "embedded-asset",
        label: "roughness",
        mimeType: "image/png",
      },
      transmissionFactor: 1,
      roughnessFactor: 0,
    }))).toBe(true);
  });

  it("ignores authored double-sided state for a nonzero-thickness volume boundary", () => {
    expect(canonicalSurfaceIsDoubleSided(standard({ doubleSided: true }))).toBe(true);
    expect(canonicalSurfaceIsDoubleSided(standard({
      doubleSided: true,
      thicknessFactor: 0,
    }))).toBe(true);
    expect(canonicalSurfaceIsDoubleSided(standard({
      doubleSided: true,
      thicknessFactor: 0.01,
      transmissionFactor: 1,
    }))).toBe(false);
  });
});

describe("terminal presentation planning", () => {
  const supported = {
    hasFloatBlendTarget: false,
    hasFloatColorTarget: true,
  };

  it("does not require float blending for an opaque HDR scene", () => {
    expect(terminalPresentationRequested("pbr-neutral", true, false, supported)).toBe(true);
    expect(linearCompositeColorBytesPerPixel(supported, false)).toBe(8);
  });

  it("requires float blending only when an alpha-blended draw exists", () => {
    expect(terminalPresentationRequested("pbr-neutral", true, true, supported)).toBe(false);
    expect(linearCompositeColorBytesPerPixel(supported, true)).toBe(4);
    const blended = {
      hasFloatBlendTarget: true,
      hasFloatColorTarget: true,
    };
    expect(terminalPresentationRequested("pbr-neutral", true, true, blended)).toBe(true);
    expect(linearCompositeColorBytesPerPixel(blended, true)).toBe(8);
  });

  it("preserves direct presentation for unsupported or mixed material output", () => {
    expect(terminalPresentationRequested(
      "pbr-neutral",
      true,
      false,
      { ...supported, hasFloatColorTarget: false },
    )).toBe(false);
    expect(terminalPresentationRequested("pbr-neutral", false, false, supported)).toBe(false);
    expect(terminalPresentationRequested("linear-clamp", true, false, supported)).toBe(false);
  });
});
