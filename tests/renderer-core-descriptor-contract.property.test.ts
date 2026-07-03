import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  gltf,
  imageTexture,
  mesh,
  standardMaterial,
  unlitMaterial,
} from "@royal/renderer-core";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

const randomFinite = (random: SeededRandom): number =>
  random.number(-100, 100);

const randomVec3 = (random: SeededRandom): readonly [number, number, number] => [
  randomFinite(random),
  randomFinite(random),
  randomFinite(random),
];

const randomColor = (random: SeededRandom): readonly [number, number, number, number] => [
  random.number(0, 1),
  random.number(0, 1),
  random.number(0, 1),
  random.number(0, 1),
];

const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));

describe("renderer-core descriptor properties", () => {
  it("normalizes pure descriptor defaults without mutating author inputs", () => {
    forEachFuzzCase({ cases: 24, seed: 0xd35c21b5 }, ({ label, random, seed }) => {
      const transform = {
        position: randomVec3(random),
        rotation: randomVec3(random),
      };
      const color = randomColor(random);
      const metallic = random.number(-2, 3);
      const roughness = random.number(-2, 3);
      const material = standardMaterial({ color, metallic, roughness });
      const geometry = boxGeometry(random.number(0.01, 10));
      const node = mesh({
        geometry,
        material,
        pickingId: `pick-${seed.toString(16)}`,
        transform,
      });
      const asset = gltf({
        bounds: { max: randomVec3(random), min: randomVec3(random) },
        src: `/models/${seed.toString(16)}.gltf`,
        transform,
        version: seed,
      });

      expect(material.metallicFactor, `${label} metallic clamp`).toBe(clamp01(metallic));
      expect(material.roughnessFactor, `${label} roughness clamp`).toBe(clamp01(roughness));
      expect(material.baseColor, `${label} solid base color`).toEqual({
        color,
        kind: "solid",
      });
      expect(node.transform, `${label} mesh transform default scale`).toEqual({
        ...transform,
        scale: [1, 1, 1],
      });
      expect(asset.transform, `${label} gltf transform default scale`).toEqual({
        ...transform,
        scale: [1, 1, 1],
      });
      expect(transform, `${label} transform input unchanged`).toEqual({
        position: node.transform?.position,
        rotation: node.transform?.rotation,
      });
    });
  });

  it("keeps image texture defaults stable while preserving sampled descriptor identity", () => {
    forEachFuzzCase({ cases: 16, seed: 0x7e870a55 }, ({ label, random, seed }) => {
      const sampler = {
        magFilter: random.boolean() ? "nearest" as const : "linear" as const,
        wrapS: random.boolean() ? "repeat" as const : "mirrored-repeat" as const,
      };
      const texture = imageTexture({
        sampler,
        src: `/textures/${seed.toString(16)}.png`,
        version: `v${random.int(1, 1000)}`,
      });
      const material = random.boolean()
        ? standardMaterial({ texture })
        : unlitMaterial({ texture });

      expect(texture.colorSpace, `${label} image texture srgb default`).toBe("srgb");
      expect(texture.sampler, `${label} sampler default merge`).toEqual({
        magFilter: sampler.magFilter,
        minFilter: "linear-mipmap-linear",
        wrapS: sampler.wrapS,
        wrapT: "clamp-to-edge",
      });
      expect(material.baseColor, `${label} material keeps texture identity`).toBe(texture);
    });
  });
});
