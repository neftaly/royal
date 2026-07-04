import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  directionalLight,
  gltf,
  imageTexture,
  mesh,
  pass,
  perspectiveCamera,
  standardMaterial,
  textureAsset,
  unlitMaterial,
  virtualTexture,
  wireframeMaterial,
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

const randomString = (random: SeededRandom, prefix: string): string =>
  `${prefix}-${random.int(0, 0xffff_ffff).toString(16)}`;

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

  it("keeps texture defaults stable while preserving sampled descriptor identity", () => {
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

      expect(textureAsset({
        uri: `/textures/${seed.toString(16)}.ktx2`,
        version: seed,
      }), `${label} texture asset identity`).toEqual({
        kind: "asset",
        uri: `/textures/${seed.toString(16)}.ktx2`,
        version: seed,
      });

      expect(virtualTexture({
        debugName: randomString(random, "vt"),
        src: `/textures/${seed.toString(16)}.vt.json`,
        version: `vt-${seed.toString(16)}`,
      }), `${label} virtual texture source alias`).toMatchObject({
        kind: "virtual-asset",
        manifestUri: `/textures/${seed.toString(16)}.vt.json`,
        version: `vt-${seed.toString(16)}`,
      });
    });
  });

  it("preserves public render descriptor identity fields", () => {
    forEachFuzzCase({ cases: 24, seed: 0x39b7c5a2 }, ({ label, random, seed }) => {
      const camera = perspectiveCamera({
        far: random.number(20, 200),
        fovY: random.number(0.2, 1.4),
        near: random.number(0.01, 1),
        position: randomVec3(random),
        rotation: randomVec3(random),
      });
      const clearColor = randomColor(random);
      const renderPass = pass({
        camera,
        children: [],
        clear: random.pick(["none", "color", "depth", "color-depth"] as const),
        clearColor,
        depthTest: random.boolean(),
      });
      const bounds = {
        max: randomVec3(random),
        min: randomVec3(random),
      };
      const variant = random.boolean() ? randomString(random, "variant") : random.int(0, 8);
      const model = gltf({
        bounds,
        pickingId: randomString(random, "pick"),
        src: `/models/${seed.toString(16)}.glb`,
        variant,
        version: seed,
      });
      const light = directionalLight({
        color: randomColor(random),
        direction: randomVec3(random),
      });
      const wireColor = randomColor(random);

      expect(renderPass, `${label} pass descriptor`).toMatchObject({
        camera,
        clearColor,
        depthTest: renderPass.depthTest,
        kind: "pass",
      });
      expect(model.asset, `${label} glTF asset identity`).toEqual({
        bounds,
        uri: `/models/${seed.toString(16)}.glb`,
        version: seed,
      });
      expect(model.variant, `${label} glTF variant`).toBe(variant);
      expect(light.kind, `${label} directional light kind`).toBe("directional-light");
      expect(wireframeMaterial({ color: wireColor }), `${label} wireframe defaults`).toEqual({
        baseColor: { color: wireColor, kind: "solid" },
        kind: "wireframe",
        width: 1.25,
      });
    });
  });
});
