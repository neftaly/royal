import { describe, expect, it } from "vitest";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  canonicalSurfacePassKind,
  canonicalSurfaceIsDoubleSided,
  canonicalTransmissionNeedsMipmaps,
  planGroupedSurfacePasses,
  planSurfacePasses,
  surfaceDrawPassNeedsDepthOrder,
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
  it("sorts view-dependent work only in passes that can draw it", () => {
    expect(surfaceDrawPassNeedsDepthOrder("opaque")).toBe(false);
    expect(surfaceDrawPassNeedsDepthOrder("all")).toBe(true);
    expect(surfaceDrawPassNeedsDepthOrder("remaining")).toBe(true);
  });

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

  it("groups opaque work by program and authored material without crossing pass order", () => {
    const programA = {};
    const programB = {};
    const materialA = standard();
    const materialB = standard();
    const transmissionMaterial = standard({ transmissionFactor: 1 });
    const transparentMaterial = standard({ alphaBlend: true });
    const surfaces = [
      { id: "a1", material: materialA, materialIdentity: materialA, program: programA },
      { id: "b1", material: materialB, materialIdentity: materialB, program: programA },
      { id: "a2", material: materialA, materialIdentity: materialA, program: programA },
      { id: "a-program-b", material: materialA, materialIdentity: materialA, program: programB },
      {
        id: "transmission",
        material: transmissionMaterial,
        materialIdentity: transmissionMaterial,
        program: programB,
      },
      {
        id: "transparent",
        material: transparentMaterial,
        materialIdentity: transparentMaterial,
        program: programA,
      },
    ];
    const plan = planGroupedSurfacePasses(
      surfaces,
      (surface) => surface.material,
      (surface) => surface.materialIdentity,
      (surface) => surface.program,
    );

    expect(plan.opaque.map((surface) => surface.id)).toEqual([
      "a1",
      "a2",
      "b1",
      "a-program-b",
    ]);
    expect(plan.transmission.map((surface) => surface.id)).toEqual(["transmission"]);
    expect(plan.transparent.map((surface) => surface.id)).toEqual(["transparent"]);
    expect(plan.requiresSceneColor).toBe(true);
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

  it("presents opaque scenes directly without retaining a full-screen target", () => {
    expect(terminalPresentationRequested(true, false, supported)).toBe(false);
    expect(linearCompositeColorBytesPerPixel(supported, false)).toBe(8);
  });

  it("retains a terminal target only for supported linear alpha blending", () => {
    expect(terminalPresentationRequested(true, true, supported)).toBe(false);
    expect(linearCompositeColorBytesPerPixel(supported, true)).toBe(4);
    const blended = {
      hasFloatBlendTarget: true,
      hasFloatColorTarget: true,
    };
    expect(terminalPresentationRequested(true, true, blended)).toBe(true);
    expect(linearCompositeColorBytesPerPixel(blended, true)).toBe(8);
  });

  it("preserves direct presentation for unsupported or mixed material output", () => {
    expect(terminalPresentationRequested(
      true,
      true,
      { hasFloatBlendTarget: true, hasFloatColorTarget: false },
    )).toBe(false);
    expect(terminalPresentationRequested(false, true, {
      hasFloatBlendTarget: true,
      hasFloatColorTarget: true,
    })).toBe(false);
  });
});
