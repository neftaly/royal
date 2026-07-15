import { describe, expect, it } from "vitest";
import {
  SURFACE_MATERIAL_TEXTURE_BINDINGS,
  createSurfaceTextureBindingWorkspace,
  planSurfaceTextureBindings,
  resolveAdmittedSurfaceTextureBindings,
  type SurfaceTextureBindingPlanInput,
} from "../packages/renderer-webgl/src/webgl/surface-texture-binding-plan";
import { SURFACE_SHADER_TEXTURE_FEATURES } from "../packages/renderer-webgl/src/webgl/shaders";

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
    expect(unique(SURFACE_MATERIAL_TEXTURE_BINDINGS.map(({ useUniform }) => useUniform))).toBe(true);
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
    let state = 0x6d2b79f5;
    const random = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 1_000; sample += 1) {
      const maxTextureUnits = Math.floor(random() * 20);
      const reserved = new Set<number>();
      for (let unit = 0; unit < maxTextureUnits; unit += 1) if (random() < 0.2) reserved.add(unit);
      const candidates = Object.fromEntries(SURFACE_SHADER_TEXTURE_FEATURES.flatMap((feature) => {
        const roll = random();
        return roll < 0.35 ? [] : [[feature, roll < 0.6 ? "unavailable" : "ready"]];
      }));
      const baseRoll = random();
      const baseColor = baseRoll < 0.33
        ? { kind: "none" } as const
        : baseRoll < 0.66
          ? { kind: "ordinary", ordinary: random() < 0.5 ? "ready" : "unavailable" } as const
          : {
              fallback: random() < 0.5 ? "ready" : "unavailable",
              kind: "virtual",
              virtual: random() < 0.5 ? "ready" : "unavailable",
            } as const;
      const plannerInput = input({
        baseColor,
        brdfLutPreferredUnit: Math.floor(random() * 20),
        candidates,
        maxTextureUnits,
        reservedTextureUnits: reserved,
      });
      const candidateSnapshot = { ...candidates };
      const baseColorSnapshot = { ...baseColor };
      const reservedSnapshot = [...reserved];
      const plan = planSurfaceTextureBindings(plannerInput);
      expect(planSurfaceTextureBindings(plannerInput)).toEqual(plan);
      expect(candidates).toEqual(candidateSnapshot);
      expect(baseColor).toEqual(baseColorSnapshot);
      expect([...reserved]).toEqual(reservedSnapshot);

      const reverseCandidates = Object.fromEntries(Object.entries(candidates).reverse());
      expect(planSurfaceTextureBindings({ ...plannerInput, candidates: reverseCandidates })).toEqual(plan);

      const expanded = planSurfaceTextureBindings({ ...plannerInput, maxTextureUnits: maxTextureUnits + 1 });
      if (plan.baseColor.kind === expanded.baseColor.kind) {
        for (const feature of plan.features) {
          expect(expanded.features.has(feature), JSON.stringify({
            baseColor,
            candidates,
            expanded: [...expanded.textureUnits],
            feature,
            maxTextureUnits,
            plan: [...plan.textureUnits],
            reserved: [...reserved],
          })).toBe(true);
        }
      }

      expect([...plan.features]).toEqual([...plan.textureUnits.keys()]);
      const readinessCandidates = Object.fromEntries(
        Object.keys(candidates).map((feature) => [feature, random() < 0.5 ? "ready" : "unavailable"]),
      );
      const resolved = resolveAdmittedSurfaceTextureBindings(plan, {
        baseColor,
        candidates: readinessCandidates,
      });
      for (const [feature, unit] of resolved.textureUnits) {
        expect(plan.textureUnits.get(feature), `resolved ${feature}`).toBe(unit);
      }
      for (const feature of resolved.features) expect(plan.features.has(feature)).toBe(true);
      const allocated = [...plan.textureUnits.entries()];
      for (const [, unit] of allocated) {
        expect(unit).toBeGreaterThanOrEqual(0);
        expect(unit).toBeLessThan(maxTextureUnits);
        expect(reserved.has(unit)).toBe(false);
      }
      const units = allocated.map(([, unit]) => unit);
      const permittedAlias = plan.baseColor.kind === "virtual" && plan.baseColor.fallback === "atlas-unit"
        ? plan.textureUnits.get("baseColorVirtualTextureAtlas")
        : undefined;
      for (const unit of new Set(units)) {
        const count = units.filter((candidate) => candidate === unit).length;
        expect(count).toBeLessThanOrEqual(unit === permittedAlias ? 2 : 1);
      }
      expect(plan.features.has("baseColorVirtualTextureAtlas"))
        .toBe(plan.features.has("baseColorVirtualTexturePageTable"));
      if (plan.features.has("iblBrdfLut")) expect(plan.features.has("iblSpecularCube")).toBe(true);

      const prefixLength = Math.floor(random() * SURFACE_MATERIAL_TEXTURE_BINDINGS.length);
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
          expect(afterLowerPriority.textureUnits.get(feature)).toBe(unit);
        }
      }
    }
  });
});
