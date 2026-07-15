import type { RenderToneMapping } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  resolveSurfaceToneMapping,
  surfacePresentationRequiresHdr,
  toneMappingShaderMode,
  type SurfacePresentationPlan,
} from "../packages/renderer-webgl/src/surface-presentation-policy";
import { forEachFuzzCase } from "./fuzz";

const toneMappings = ["linear-clamp", "aces-fitted", "pbr-neutral"] as const;

describe("surface presentation policy properties", () => {
  it("keeps HDR admission equivalent to its independent inputs", () => {
    forEachFuzzCase({ cases: 128, seed: 0x4852_4452 }, ({ random }) => {
      const plan: SurfacePresentationPlan = {
        environment: random.boolean() ? {} : undefined,
        exposureEv100: random.boolean() ? random.number(-24, 24) : undefined,
        lightNodes: random.boolean() ? [{}] : [],
        toneMapping: random.boolean() ? random.pick(toneMappings) : undefined,
      };
      const hasHdrReadyAsset = random.boolean();
      const expected = plan.environment !== undefined
        || plan.exposureEv100 !== undefined
        || plan.toneMapping === "aces-fitted"
        || plan.toneMapping === "pbr-neutral"
        || plan.lightNodes.length > 0
        || hasHdrReadyAsset;

      expect(surfacePresentationRequiresHdr(plan, hasHdrReadyAsset)).toBe(expected);
    });
  });

  it("resolves finite monotonic exposure and a closed shader-mode ABI", () => {
    const shaderModes = new Set<number>();
    forEachFuzzCase({ cases: 128, seed: 0x4556_3130 }, ({ random }) => {
      const lowEv100 = random.number(-24, 23);
      const highEv100 = random.number(lowEv100, 24);
      const toneMapping = random.pick(toneMappings) as RenderToneMapping;
      const low = resolveSurfaceToneMapping({ exposureEv100: lowEv100, toneMapping }, random.boolean());
      const high = resolveSurfaceToneMapping({ exposureEv100: highEv100, toneMapping }, random.boolean());

      expect(Number.isFinite(low.exposure)).toBe(true);
      expect(low.exposure).toBeGreaterThan(0);
      expect(high.exposure).toBeLessThan(low.exposure);
      expect(low.toneMapping).toBe(toneMapping);
      shaderModes.add(toneMappingShaderMode(toneMapping));
    });

    for (const toneMapping of toneMappings) shaderModes.add(toneMappingShaderMode(toneMapping));
    expect(shaderModes).toEqual(new Set([0, 1, 2]));
    expect(resolveSurfaceToneMapping({ exposureEv100: undefined, toneMapping: undefined }, false)).toEqual({
      exposure: 1 / 1.2,
      hdrOutput: false,
      toneMapping: "linear-clamp",
    });
  });
});
