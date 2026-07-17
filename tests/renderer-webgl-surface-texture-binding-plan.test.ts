import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import {
  SURFACE_MATERIAL_TEXTURE_BINDINGS,
  createSurfaceTextureBindingWorkspace,
  planSurfaceTextureBindings,
  resolveAdmittedSurfaceTextureBindings,
  type SurfaceTextureBindingPlanInput,
} from "../packages/renderer-webgl/src/webgl/surface-texture-binding-plan";
import {
  SURFACE_SHADER_TEXTURE_FEATURES,
  surfaceShaderFeatureMask,
} from "../packages/renderer-webgl/src/webgl/shaders";
import { assertFuzz, assertFuzzEqual, forEachFuzzCase } from "./fuzz";

const input = (overrides: Partial<SurfaceTextureBindingPlanInput> = {}): SurfaceTextureBindingPlanInput => ({
  baseColor: { kind: "none" },
  brdfLutPreferredUnit: 15,
  candidates: {},
  maxTextureUnits: 16,
  reservedTextureUnits: new Set(),
  ...overrides,
});

describe("surface texture binding planner", () => {
  it("reuses caller-owned plan and omission storage without retaining stale values", () => {
    const workspace = createSurfaceTextureBindingWorkspace();
    const first = planSurfaceTextureBindings(input({
      candidates: { emissiveTexture: "ready" },
      maxTextureUnits: 0,
    }), workspace);
    const omission = first.omissions[0];
    expect(first.omissions).toEqual([{ feature: "emissiveTexture", reason: "unit-exhausted" }]);

    const second = planSurfaceTextureBindings(input({
      candidates: { normalTexture: "unavailable" },
    }), workspace);
    expect(second).toBe(first);
    expect(second.omissions[0]).toBe(omission);
    expect(second.omissions).toEqual([{ feature: "normalTexture", reason: "unavailable" }]);
    expect(second.features.size).toBe(0);
    expect(second.textureUnits.size).toBe(0);
  });

  it("keeps material descriptors exhaustive and unambiguous", () => {
    const unique = <Value>(values: readonly Value[]): boolean => new Set(values).size === values.length;
    expect(unique(SURFACE_MATERIAL_TEXTURE_BINDINGS.map(({ feature }) => feature))).toBe(true);
    expect(unique(SURFACE_MATERIAL_TEXTURE_BINDINGS.map(({ key }) => key))).toBe(true);
    expect(unique(SURFACE_MATERIAL_TEXTURE_BINDINGS.map(({ samplerUniform }) => samplerUniform))).toBe(true);
    expect(unique(SURFACE_MATERIAL_TEXTURE_BINDINGS.map(({ uvUniformStem }) => uvUniformStem))).toBe(true);
  });

  it("preserves documented priority under sampler pressure", () => {
    const candidates = Object.fromEntries(SURFACE_SHADER_TEXTURE_FEATURES.map((feature) => [feature, "ready"]));
    const plan = planSurfaceTextureBindings(input({
      baseColor: { kind: "ordinary", ordinary: "ready" },
      candidates,
      maxTextureUnits: 5,
    }));

    expect([...plan.textureUnits]).toEqual([
      ["baseColorTexture", 0],
      ["iblSpecularCube", 2],
      ["transmissionScreenTexture", 1],
      ["emissiveTexture", 4],
      ["metallicRoughnessTexture", 3],
    ]);
    expect([...plan.features]).toEqual([...plan.textureUnits.keys()]);
    expect(plan.featureMask).toBe(surfaceShaderFeatureMask(plan.features));
    expect(plan.omissions.filter(({ reason }) => reason === "unit-exhausted").map(({ feature }) => feature))
      .toEqual([
        "normalTexture",
        "occlusionTexture",
        ...SURFACE_MATERIAL_TEXTURE_BINDINGS.slice(4).map(({ feature }) => feature),
        "iblBrdfLut",
      ]);
  });

  it("does not let unavailable high-priority requests suppress ready lower-priority maps", () => {
    const plan = planSurfaceTextureBindings(input({
      candidates: {
        emissiveTexture: "unavailable",
        metallicRoughnessTexture: "ready",
        normalTexture: "ready",
        specularTexture: "unavailable",
      },
      maxTextureUnits: 2,
    }));
    expect(plan.textureUnits).toEqual(new Map([
      ["metallicRoughnessTexture", 0],
      ["normalTexture", 1],
    ]));
    expect(plan.omissions).toContainEqual({ feature: "emissiveTexture", reason: "unavailable" });
    expect(plan.omissions).toContainEqual({ feature: "specularTexture", reason: "unavailable" });
  });

  it("resolves readiness within admission without backfilling sampler holes", () => {
    const admission = planSurfaceTextureBindings(input({
      candidates: {
        emissiveTexture: "ready",
        metallicRoughnessTexture: "ready",
        normalTexture: "ready",
      },
      maxTextureUnits: 2,
    }));
    const resolved = resolveAdmittedSurfaceTextureBindings(admission, {
      baseColor: { kind: "none" },
      candidates: {
        emissiveTexture: "unavailable",
        metallicRoughnessTexture: "ready",
      },
    });

    expect([...admission.textureUnits]).toEqual([
      ["emissiveTexture", 0],
      ["metallicRoughnessTexture", 1],
    ]);
    expect([...resolved.textureUnits]).toEqual([["metallicRoughnessTexture", 1]]);
    expect(resolved.features.has("normalTexture")).toBe(false);
    expect(resolved.omissions).toContainEqual({ feature: "emissiveTexture", reason: "unavailable" });
    expect(resolved.omissions).toContainEqual({ feature: "normalTexture", reason: "unit-exhausted" });
  });

  it("keeps VT admission stable while resolving its ordinary fallback", () => {
    const admission = planSurfaceTextureBindings(input({
      baseColor: { fallback: "ready", kind: "virtual", virtual: "ready" },
      candidates: { emissiveTexture: "ready" },
      maxTextureUnits: 2,
    }));
    const pending = resolveAdmittedSurfaceTextureBindings(admission, {
      baseColor: { fallback: "unavailable", kind: "virtual", virtual: "unavailable" },
      candidates: {},
    });
    const fallback = resolveAdmittedSurfaceTextureBindings(admission, {
      baseColor: { fallback: "ready", kind: "virtual", virtual: "unavailable" },
      candidates: {},
    });
    const virtual = resolveAdmittedSurfaceTextureBindings(admission, {
      baseColor: { fallback: "ready", kind: "virtual", virtual: "ready" },
      candidates: {},
    });

    expect(admission.omissions).toContainEqual({ feature: "emissiveTexture", reason: "unit-exhausted" });
    expect(pending.baseColor).toEqual({ kind: "none" });
    expect(fallback.baseColor).toEqual({ kind: "ordinary" });
    expect(fallback.textureUnits).toEqual(new Map([["baseColorTexture", 0]]));
    expect(virtual.baseColor).toEqual({ fallback: "atlas-unit", kind: "virtual" });
    expect(virtual.textureUnits.get("baseColorTexture")).toBe(0);
  });

  it("allocates VT atomically, falls back when it cannot, and aliases a ready defensive fallback", () => {
    const constrained = planSurfaceTextureBindings(input({
      baseColor: { fallback: "ready", kind: "virtual", virtual: "ready" },
      maxTextureUnits: 1,
    }));
    expect(constrained.baseColor).toEqual({ kind: "ordinary" });
    expect(constrained.textureUnits).toEqual(new Map([["baseColorTexture", 0]]));
    expect(constrained.features.has("baseColorVirtualTextureAtlas")).toBe(false);
    expect(constrained.features.has("baseColorVirtualTexturePageTable")).toBe(false);

    const ready = planSurfaceTextureBindings(input({
      baseColor: { fallback: "ready", kind: "virtual", virtual: "ready" },
      maxTextureUnits: 2,
    }));
    expect(ready.baseColor).toEqual({ fallback: "atlas-unit", kind: "virtual" });
    expect(ready.textureUnits.get("baseColorVirtualTextureAtlas")).toBe(0);
    expect(ready.textureUnits.get("baseColorVirtualTexturePageTable")).toBe(1);
    expect(ready.textureUnits.get("baseColorTexture")).toBe(0);
  });

  it("respects cluster reservations and plans BRDF only with planned specular IBL", () => {
    const plan = planSurfaceTextureBindings(input({
      brdfLutPreferredUnit: 3,
      candidates: { iblBrdfLut: "ready", iblSpecularCube: "ready", transmissionScreenTexture: "ready" },
      maxTextureUnits: 6,
      reservedTextureUnits: new Set([3, 4, 5]),
    }));
    expect(plan.textureUnits).toEqual(new Map([
      ["iblSpecularCube", 2],
      ["transmissionScreenTexture", 1],
      ["iblBrdfLut", 0],
    ]));
    expect(resolveAdmittedSurfaceTextureBindings(plan, {
      baseColor: { kind: "none" },
      candidates: {
        iblBrdfLut: "ready",
        iblSpecularCube: "ready",
        transmissionScreenTexture: "ready",
      },
    }).textureUnits).toEqual(new Map([
      ["iblSpecularCube", 2],
      ["transmissionScreenTexture", 1],
      ["iblBrdfLut", 0],
    ]));
    for (const unit of plan.textureUnits.values()) expect([3, 4, 5]).not.toContain(unit);

    const noSpecular = planSurfaceTextureBindings(input({
      candidates: { iblBrdfLut: "ready", iblSpecularCube: "unavailable" },
    }));
    expect(noSpecular.textureUnits.has("iblBrdfLut")).toBe(false);
    expect(noSpecular.omissions).toContainEqual({ feature: "iblBrdfLut", reason: "dependency-omitted" });

    const reservedSpecularUnit = planSurfaceTextureBindings(input({
      candidates: { iblBrdfLut: "ready", iblSpecularCube: "ready", metallicRoughnessTexture: "ready" },
      maxTextureUnits: 4,
      reservedTextureUnits: new Set([2]),
    }));
    expect(reservedSpecularUnit.textureUnits.has("iblSpecularCube")).toBe(false);
    expect(reservedSpecularUnit.textureUnits.has("iblBrdfLut")).toBe(false);
    expect(reservedSpecularUnit.textureUnits.has("metallicRoughnessTexture")).toBe(true);
  });

  it("maintains allocation invariants across seeded readiness and capacity profiles", () => {
    forEachFuzzCase({ cases: 1_000, seed: 0x6d2b_79f5 }, ({ random }) => {
      const maxTextureUnits = random.int(0, 20);
      const reserved = new Set<number>();
      for (let unit = 0; unit < maxTextureUnits; unit += 1) if (random.boolean(0.2)) reserved.add(unit);
      const candidates = Object.fromEntries(SURFACE_SHADER_TEXTURE_FEATURES.flatMap((feature) => {
        const roll = random.float();
        return roll < 0.35 ? [] : [[feature, roll < 0.6 ? "unavailable" : "ready"]];
      }));
      const baseRoll = random.float();
      const baseColor = baseRoll < 0.33
        ? { kind: "none" } as const
        : baseRoll < 0.66
          ? { kind: "ordinary", ordinary: random.boolean() ? "ready" : "unavailable" } as const
          : {
              fallback: random.boolean() ? "ready" : "unavailable",
              kind: "virtual",
              virtual: random.boolean() ? "ready" : "unavailable",
            } as const;
      const plannerInput = input({
        baseColor,
        brdfLutPreferredUnit: random.int(0, 20),
        candidates,
        maxTextureUnits,
        reservedTextureUnits: reserved,
      });
      const candidateSnapshot = { ...candidates };
      const baseColorSnapshot = { ...baseColor };
      const reservedSnapshot = [...reserved];
      const plan = planSurfaceTextureBindings(plannerInput);
      assertFuzz(isDeepStrictEqual(planSurfaceTextureBindings(plannerInput), plan), "plan is not deterministic");
      assertFuzz(isDeepStrictEqual(candidates, candidateSnapshot), "planner mutated candidates");
      assertFuzz(isDeepStrictEqual(baseColor, baseColorSnapshot), "planner mutated base color");
      assertFuzz(isDeepStrictEqual([...reserved], reservedSnapshot), "planner mutated reservations");

      const reverseCandidates = Object.fromEntries(Object.entries(candidates).reverse());
      assertFuzz(
        isDeepStrictEqual(planSurfaceTextureBindings({ ...plannerInput, candidates: reverseCandidates }), plan),
        "candidate insertion order changed the plan",
      );

      const expanded = planSurfaceTextureBindings({ ...plannerInput, maxTextureUnits: maxTextureUnits + 1 });
      if (plan.baseColor.kind === expanded.baseColor.kind) {
        for (const feature of plan.features) {
          assertFuzz(expanded.features.has(feature), JSON.stringify({
            baseColor,
            candidates,
            expanded: [...expanded.textureUnits],
            feature,
            maxTextureUnits,
            plan: [...plan.textureUnits],
            reserved: [...reserved],
          }));
        }
      }

      assertFuzz(
        isDeepStrictEqual([...plan.features], [...plan.textureUnits.keys()]),
        "plan features and texture units differ",
      );
      const readinessCandidates = Object.fromEntries(
        Object.keys(candidates).map((feature) => [feature, random.boolean() ? "ready" : "unavailable"]),
      );
      const resolved = resolveAdmittedSurfaceTextureBindings(plan, {
        baseColor,
        candidates: readinessCandidates,
      });
      for (const [feature, unit] of resolved.textureUnits) {
        assertFuzzEqual(plan.textureUnits.get(feature), unit, `resolved ${feature}`);
      }
      for (const feature of resolved.features) {
        assertFuzz(plan.features.has(feature), `resolved unplanned feature ${feature}`);
      }
      const allocated = [...plan.textureUnits.entries()];
      for (const [, unit] of allocated) {
        assertFuzz(unit >= 0, `allocated negative unit ${unit}`);
        assertFuzz(unit < maxTextureUnits, `allocated out-of-range unit ${unit}`);
        assertFuzz(!reserved.has(unit), `allocated reserved unit ${unit}`);
      }
      const units = allocated.map(([, unit]) => unit);
      const permittedAlias = plan.baseColor.kind === "virtual" && plan.baseColor.fallback === "atlas-unit"
        ? plan.textureUnits.get("baseColorVirtualTextureAtlas")
        : undefined;
      for (const unit of new Set(units)) {
        const count = units.filter((candidate) => candidate === unit).length;
        assertFuzz(count <= (unit === permittedAlias ? 2 : 1), `unit ${unit} has ${count} owners`);
      }
      assertFuzzEqual(
        plan.features.has("baseColorVirtualTextureAtlas"),
        plan.features.has("baseColorVirtualTexturePageTable"),
        "partial VT allocation",
      );
      if (plan.features.has("iblBrdfLut")) {
        assertFuzz(plan.features.has("iblSpecularCube"), "BRDF LUT allocated without specular IBL");
      }

      const prefixLength = random.int(0, SURFACE_MATERIAL_TEXTURE_BINDINGS.length + 1);
      const higherPriorityCandidates = Object.fromEntries(
        SURFACE_MATERIAL_TEXTURE_BINDINGS.slice(0, prefixLength).map(({ feature }) => [feature, "ready"]),
      );
      const beforeLowerPriority = planSurfaceTextureBindings(input({
        candidates: higherPriorityCandidates,
        maxTextureUnits,
        reservedTextureUnits: reserved,
      }));
      const lowerPriorityFeature = SURFACE_MATERIAL_TEXTURE_BINDINGS[prefixLength]?.feature;
      if (lowerPriorityFeature !== undefined) {
        const afterLowerPriority = planSurfaceTextureBindings(input({
          candidates: { ...higherPriorityCandidates, [lowerPriorityFeature]: "ready" },
          maxTextureUnits,
          reservedTextureUnits: reserved,
        }));
        for (const [feature, unit] of beforeLowerPriority.textureUnits) {
          assertFuzzEqual(afterLowerPriority.textureUnits.get(feature), unit, `${feature} priority unit`);
        }
      }
    });
  });
});
