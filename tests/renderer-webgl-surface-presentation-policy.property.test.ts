import type { RenderToneMapping } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  resolveSurfaceToneMapping,
  surfacePresentationRequiresHdr,
  toneMappingShaderMode,
} from "../packages/renderer-webgl/src/surface-presentation-policy";
import { forEachFuzzCase } from "./fuzz";

const toneMappings = ["linear-clamp", "pbr-neutral"] as const;

describe("surface presentation policy properties", () => {
  it("admits an HDR intermediate exactly for scene-linear composition", () => {
    forEachFuzzCase({ cases: 128, seed: 0x4852_4452 }, ({ random }) => {
      const hasHdrCompositionAsset = random.boolean();
      expect(surfacePresentationRequiresHdr(hasHdrCompositionAsset)).toBe(hasHdrCompositionAsset);
    });
  });

  it("resolves finite monotonic exposure and a closed shader-mode ABI", () => {
    const shaderModes = new Set<number>();
    forEachFuzzCase({ cases: 128, seed: 0x4556_3130 }, ({ random }) => {
      const lowEv100 = random.number(-128, 148);
      const highEv100 = random.number(lowEv100, 149);
      const toneMapping = random.pick(toneMappings) as RenderToneMapping;
      const low = resolveSurfaceToneMapping({ exposureEv100: lowEv100, toneMapping }, random.boolean());
      const high = resolveSurfaceToneMapping({ exposureEv100: highEv100, toneMapping }, random.boolean());

      expect(Number.isFinite(low.exposure)).toBe(true);
      expect(Number.isFinite(Math.fround(low.exposure))).toBe(true);
      expect(Math.fround(low.exposure)).toBeGreaterThan(0);
      expect(low.exposure).toBeGreaterThan(0);
      expect(high.exposure).toBeLessThan(low.exposure);
      expect(low.toneMapping).toBe(toneMapping);
      shaderModes.add(toneMappingShaderMode(toneMapping));
    });

    for (const toneMapping of toneMappings) shaderModes.add(toneMappingShaderMode(toneMapping));
    expect(shaderModes).toEqual(new Set([0, 1]));
    for (const exposureEv100 of [-128, 149]) {
      const exposure = resolveSurfaceToneMapping({ exposureEv100, toneMapping: undefined }, true).exposure;
      expect(Number.isFinite(Math.fround(exposure))).toBe(true);
      expect(Math.fround(exposure)).toBeGreaterThan(0);
    }
    expect(resolveSurfaceToneMapping({ exposureEv100: undefined, toneMapping: undefined }, false)).toEqual({
      exposure: 1 / 1.2,
      hdrOutput: false,
      toneMapping: "pbr-neutral",
    });
  });
});
