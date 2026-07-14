import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  directionalLight,
  gltf,
  imageTexture,
  mesh,
  perspectiveCamera,
  scene,
  standardMaterial,
  studioEnvironment,
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

const randomBounds = (random: SeededRandom): {
  readonly max: readonly [number, number, number];
  readonly min: readonly [number, number, number];
} => {
  const first = randomVec3(random);
  const second = randomVec3(random);
  return {
    max: [
      Math.max(first[0], second[0]),
      Math.max(first[1], second[1]),
      Math.max(first[2], second[2]),
    ],
    min: [
      Math.min(first[0], second[0]),
      Math.min(first[1], second[1]),
      Math.min(first[2], second[2]),
    ],
  };
};

describe("renderer-core descriptor properties", () => {
  it("normalizes pure descriptor defaults without mutating author inputs", () => {
    forEachFuzzCase({ cases: 24, seed: 0xd35c21b5 }, ({ label, random, seed }) => {
      const transform = {
        position: randomVec3(random),
        rotation: randomVec3(random),
      };
      const color = randomColor(random);
      const metallic = random.number(0, 1);
      const roughness = random.number(0, 1);
      const material = standardMaterial({ color, metallic, roughness });
      const geometry = boxGeometry(random.number(0.01, 10));
      const node = mesh({
        geometry,
        material,
        pickingId: `pick-${seed.toString(16)}`,
        transform,
      });
      const asset = gltf({
        bounds: randomBounds(random),
        src: `/models/${seed.toString(16)}.gltf`,
        transform,
        version: seed,
      });

      expect(material.metallicFactor, `${label} metallic factor`).toBe(metallic);
      expect(material.roughnessFactor, `${label} roughness factor`).toBe(roughness);
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
        contentKey: `sha256:${seed.toString(16)}`,
        sampler,
        src: `/textures/${seed.toString(16)}.png`,
        version: `v${random.int(1, 1000)}`,
      });
      const material = random.boolean()
        ? standardMaterial({ texture })
        : unlitMaterial({ texture });
      const virtualContentKey = `sha256:vt-${seed.toString(16)}`;
      const virtualSampler = {
        magFilter: sampler.magFilter,
        wrapT: sampler.wrapS,
      };
      const virtual = virtualTexture({
        contentKey: virtualContentKey,
        sampler: virtualSampler,
        manifestUri: `/textures/${seed.toString(16)}.vt.json`,
        version: `vt-${seed.toString(16)}`,
      });
      const virtualMaterial = random.boolean()
        ? standardMaterial({ texture: virtual })
        : unlitMaterial({ texture: virtual });

      expect(texture.colorSpace, `${label} image texture srgb default`).toBe("srgb");
      expect(texture.contentKey, `${label} image texture content key preserved`).toBe(`sha256:${seed.toString(16)}`);
      expect(texture.sampler, `${label} sampler default merge`).toEqual({
        magFilter: sampler.magFilter,
        minFilter: "linear-mipmap-linear",
        wrapS: sampler.wrapS,
        wrapT: "clamp-to-edge",
      });
      expect(material.baseColor, `${label} material keeps texture identity`).toBe(texture);

      expect(textureAsset({
        contentKey: `sha256:asset-${seed.toString(16)}`,
        src: `/textures/${seed.toString(16)}.ktx2`,
        version: seed,
      }), `${label} texture asset identity`).toEqual({
        contentKey: `sha256:asset-${seed.toString(16)}`,
        kind: "asset",
        uri: `/textures/${seed.toString(16)}.ktx2`,
        version: seed,
      });

      expect(virtual, `${label} virtual texture source alias`).toMatchObject({
        contentKey: virtualContentKey,
        kind: "virtual-asset",
        manifestUri: `/textures/${seed.toString(16)}.vt.json`,
        sampler: virtualSampler,
        version: `vt-${seed.toString(16)}`,
      });
      expect(virtualMaterial.baseColor, `${label} material keeps virtual texture identity`).toBe(virtual);
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
      const renderScene = scene({
        camera,
        nodes: [],
        clearColor,
      });
      const bounds = randomBounds(random);
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

      expect(renderScene, `${label} scene descriptor`).toMatchObject({
        camera,
        clearColor,
        kind: "scene",
        nodes: [],
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

  it("detaches pure descriptors from mutable author input", () => {
    forEachFuzzCase({ cases: 24, seed: 0x1a11_a51a }, ({ label, random, seed }) => {
      const size = randomVec3(random).map((value) => Math.abs(value) + 0.01) as [number, number, number];
      const color = [...randomColor(random)] as [number, number, number, number];
      const direction = [...randomVec3(random)] as [number, number, number];
      if (Math.hypot(...direction) === 0) direction[2] = -1;
      const position = [...randomVec3(random)] as [number, number, number];
      const rotation = [...randomVec3(random)] as [number, number, number];
      const bounds = randomBounds(random);
      const mutableBounds = {
        max: [...bounds.max] as [number, number, number],
        min: [...bounds.min] as [number, number, number],
      };
      const sampler: { wrapS: "mirrored-repeat" | "repeat" } = { wrapS: "repeat" };
      const clearColor = [...randomColor(random)] as [number, number, number, number];
      const geometry = boxGeometry(size);
      const texture = imageTexture({ sampler, src: `/texture-${seed}.png` });
      const material = standardMaterial({ color });
      const node = mesh({ geometry, material, transform: { position, rotation } });
      const model = gltf({ bounds: mutableBounds, src: `/model-${seed}.glb` });
      const light = directionalLight({ color, direction });
      const environment = studioEnvironment({ rotation });
      const nodes = [node, model, light];
      const renderScene = scene({ camera: perspectiveCamera({
        far: 100,
        fovY: 1,
        near: 0.1,
        position: [0, 0, 4],
        rotation: [0, 0, 0],
      }), clearColor, environment, nodes });
      const expected = {
        boundsMax: [...model.asset.bounds!.max],
        clearColor: [...renderScene.clearColor],
        color: material.baseColor.kind === "solid" ? [...material.baseColor.color] : [],
        direction: [...light.direction],
        position: [...node.transform!.position],
        rotation: [...environment.rotation],
        sampler: { ...texture.sampler },
        size: [...geometry.size],
      };

      size[0] += 1;
      color[0] += 1;
      direction[0] += 1;
      position[0] += 1;
      rotation[0] += 1;
      mutableBounds.max[0] += 1;
      sampler.wrapS = "mirrored-repeat";
      clearColor[0] += 1;
      nodes.length = 0;

      expect([...geometry.size], `${label} geometry`).toEqual(expected.size);
      expect(texture.sampler, `${label} sampler`).toEqual(expected.sampler);
      expect(material.baseColor.kind === "solid" ? [...material.baseColor.color] : [], `${label} color`)
        .toEqual(expected.color);
      expect([...node.transform!.position], `${label} transform`).toEqual(expected.position);
      expect([...model.asset.bounds!.max], `${label} bounds`).toEqual(expected.boundsMax);
      expect([...light.direction], `${label} direction`).toEqual(expected.direction);
      expect([...environment.rotation], `${label} environment`).toEqual(expected.rotation);
      expect([...renderScene.clearColor], `${label} clear`).toEqual(expected.clearColor);
      expect(renderScene.nodes, `${label} nodes`).toHaveLength(3);
      expect([
        geometry,
        geometry.size,
        texture,
        texture.sampler,
        material,
        node,
        node.transform,
        model,
        model.asset,
        model.asset.bounds,
        light,
        environment,
        renderScene,
        renderScene.nodes,
      ].every((value) => Object.isFrozen(value)), `${label} frozen graph`).toBe(true);
    });
  });

  it("rejects invalid pure descriptor values explicitly", () => {
    forEachFuzzCase({ cases: 16, seed: 0xbad_1dea }, ({ label, random }) => {
      const nonFinite = random.pick([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
      expect(() => boxGeometry(nonFinite), `${label} geometry`).toThrow(/finite/);
      expect(() => studioEnvironment({ radianceScaleNits: nonFinite }), `${label} environment`).toThrow(/finite/);
      expect(() => directionalLight({ direction: [0, 0, 0] }), `${label} direction`).toThrow(/non-zero/);
      expect(() => gltf(""), `${label} source`).toThrow(/must not be empty/);
      expect(() => gltf({ src: "/model.glb", variant: -1 }), `${label} variant`).toThrow(/non-negative integer/);
      expect(() => gltf({
        bounds: { max: [0, 0, 0], min: [1, 0, 0] },
        src: "/model.glb",
      }), `${label} bounds`).toThrow(/min must not exceed max/);
    });
  });
});
