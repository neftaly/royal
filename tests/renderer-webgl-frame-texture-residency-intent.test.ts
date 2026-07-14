import { describe, expect, it } from "vitest";
import { FrameTextureResidencyIntent } from "../packages/renderer-webgl/src/frame-texture-residency-intent";
import { forEachFuzzCase } from "./fuzz";

describe("frame texture residency intent", () => {
  it("reuses the empty result when no virtual texture can be suppressed", () => {
    const intent = new FrameTextureResidencyIntent();
    const inactive = intent.finishFrame(true);
    intent.beginFrame();
    intent.requireOrdinary("ordinary-only");
    const ordinaryOnly = intent.finishFrame(true);
    intent.beginFrame();
    intent.recordVirtualBind("aborted");
    const aborted = intent.finishFrame(false);

    expect(ordinaryOnly).toBe(inactive);
    expect(aborted).toBe(inactive);
  });

  it.each([
    ["ordinary-first", ["ordinary", "virtual"]],
    ["virtual-first", ["virtual", "ordinary"]],
  ] as const)("makes ordinary use win in %s traversal", (_label, traversal) => {
    const intent = new FrameTextureResidencyIntent();
    intent.beginFrame();
    for (const use of traversal) {
      if (use === "ordinary") intent.requireOrdinary("shared");
      else intent.recordVirtualBind("shared");
    }

    expect(intent.finishFrame(true)).toEqual([]);
  });

  it("returns only successfully bound VT keys without ordinary consumers", () => {
    const intent = new FrameTextureResidencyIntent();
    intent.beginFrame();
    intent.recordVirtualBind("virtual-only");
    intent.recordVirtualBind("virtual-only");
    intent.recordVirtualBind("shared");
    intent.requireOrdinary("shared");

    expect(intent.finishFrame(true)).toEqual(["virtual-only"]);
  });

  it("rolls back a failed frame and starts the next frame clean", () => {
    const intent = new FrameTextureResidencyIntent();
    intent.beginFrame();
    intent.recordVirtualBind("failed");
    expect(intent.finishFrame(false)).toEqual([]);

    intent.beginFrame();
    intent.recordVirtualBind("next");
    expect(intent.finishFrame(true)).toEqual(["next"]);
    expect(intent.finishFrame(true)).toEqual([]);
  });

  it("matches frame-local set arbitration under seeded traces", () => {
    forEachFuzzCase({ cases: 48, seed: 0xf2a6_e17 }, ({ label, random }) => {
      const intent = new FrameTextureResidencyIntent();
      for (let frame = 0; frame < random.int(2, 9); frame += 1) {
        const ordinary = new Set<string>();
        const virtual = new Set<string>();
        intent.beginFrame();
        for (let operation = 0; operation < random.int(1, 33); operation += 1) {
          const key = `texture-${random.int(0, 6)}`;
          if (random.boolean()) {
            ordinary.add(key);
            intent.requireOrdinary(key);
          } else {
            virtual.add(key);
            intent.recordVirtualBind(key);
          }
        }
        const commit = random.boolean();
        const expected = commit
          ? [...virtual].filter((key) => !ordinary.has(key))
          : [];
        expect(intent.finishFrame(commit), `${label} frame=${frame}`).toEqual(expected);
        expect(intent.finishFrame(true), `${label} repeated finish frame=${frame}`).toEqual([]);
      }
    });
  });
});
