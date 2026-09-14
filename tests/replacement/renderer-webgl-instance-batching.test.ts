import { describe, expect, it } from "vitest";
import { supportsInstanceBatching } from "../../packages/renderer-webgl/src/gltf/instance-batching";
import { prepareStaticGltfSource } from "../../packages/renderer-webgl/src/gltf/static-asset";
import { glbFromDocument, staticTriangleBinary, staticTriangleDocument, staticTriangleGlb } from "./support/static-glb";

const fixture = () => prepareStaticGltfSource(staticTriangleGlb(), "test", "test", "/test.glb", async () => { throw new Error("Unexpected resource"); });

describe("whole-asset instance batching eligibility", () => {
  it("accepts ordinary opaque and alpha-masked geometry", async () => {
    const prepared = await fixture();
    expect(supportsInstanceBatching(prepared)).toBe(true);
    expect(supportsInstanceBatching({...prepared, primitives: prepared.primitives.map(p => ({...p, material: {...p.material, alphaCutoff: .5}}))})).toBe(true);
  });
  it("rejects sorted materials, including unselected variants, and per-instance LOD", async () => {
    const prepared = await fixture();
    const primitive = prepared.primitives[0]!;
    const blended = {...primitive.material, alphaBlend: true as const};
    for (const modified of [
      {...primitive, material: blended},
      {...primitive, materialVariants: new Map([["glass", blended]])},
      {...primitive, lods: []},
      {...primitive, materialLod: {levels: [primitive.material], thresholds: []}},
      {...primitive, materialVariantLods: new Map([["lod", {levels: [primitive.material], thresholds: []}]])},
    ]) expect(supportsInstanceBatching({...prepared, primitives: [modified]})).toBe(false);
    const binary = new Uint8Array(44);
    binary.set(staticTriangleBinary());
    const glass = glbFromDocument({
      ...staticTriangleDocument(),
      extensionsUsed: ["KHR_materials_transmission"], extensionsRequired: [],
      materials: [{extensions: {KHR_materials_transmission: {transmissionFactor: .5}}}],
    }, binary);
    const transmitting = await prepareStaticGltfSource(glass, "glass", "glass", "/glass.glb", async () => { throw new Error("Unexpected resource"); });
    expect(supportsInstanceBatching(transmitting)).toBe(false);
    expect(supportsInstanceBatching({...prepared, primitives: []})).toBe(false);
    expect(supportsInstanceBatching({
      ...prepared,
      lights: [{
        kind: "directional", color: [1, 1, 1], intensity: 1,
        innerConeAngle: 0, outerConeAngle: Math.PI / 4, range: Infinity,
        localModel: primitive.localModel,
      }],
    })).toBe(false);
  });
});
