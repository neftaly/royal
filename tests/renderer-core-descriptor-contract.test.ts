import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  defaultImageTextureSampler,
  directionalLight,
  gltf,
  imageTexture,
  mesh,
  perspectiveCamera,
  scene,
  standardMaterial,
  studioEnvironment,
  textureAsset,
  type TextureRef,
  unlitMaterial,
  virtualTexture,
  type VirtualTextureAssetOptions,
} from "@royal/renderer-core";

const camera = perspectiveCamera({
  far: 100,
  fovY: Math.PI / 4,
  near: 0.1,
  position: [0, 0, 6],
  rotation: [0, 0, 0],
});

describe("renderer-core descriptor contract", () => {
  it("builds one direct scene with authored presentation", () => {
    const environment = studioEnvironment({
      radianceScaleNits: 80,
      rotation: [0, Math.PI / 4, 0],
    });

    expect(environment).toEqual({
      kind: "environment-light",
      preset: "studio",
      radianceScaleNits: 80,
      rotation: [0, Math.PI / 4, 0],
    });
    expect(scene({
      camera,
      nodes: [],
      clearColor: [0.1, 0.2, 0.3, 1],
      environment,
      exposureEv100: 1.25,
      toneMapping: "aces-fitted",
    })).toEqual({
      camera,
      clearColor: [0.1, 0.2, 0.3, 1],
      environment,
      exposureEv100: 1.25,
      kind: "scene",
      nodes: [],
      toneMapping: "aces-fitted",
    });

    expect(() => scene({
      camera,
      nodes: [],
      exposureEv100: Number.NaN,
    })).toThrow(/exposureEv100/);
    expect(() => scene({
      camera,
      nodes: [],
      clearColor: [0, Number.NaN, 0, 1],
    })).toThrow(/clearColor.*finite/);
  });

  it("preserves picking ids on pickable mesh and glTF descriptors", () => {
    expect(mesh({
      geometry: boxGeometry(1),
      material: unlitMaterial({ color: [1, 1, 1, 1] }),
      pickingId: "box-a",
    })).toEqual({
      geometry: boxGeometry(1),
      kind: "mesh",
      material: unlitMaterial({ color: [1, 1, 1, 1] }),
      pickingId: "box-a",
    });

    expect(gltf({
      pickingId: "helmet",
      src: "/models/helmet.gltf",
    })).toEqual({
      asset: {
        uri: "/models/helmet.gltf",
      },
      kind: "gltf",
      pickingId: "helmet",
      src: "/models/helmet.gltf",
    });
  });

  it("keeps virtual textures as texture refs without public preview fallbacks", () => {
    const options = {
      contentKey: "sha256:terrain",
      manifestUri: "/textures/terrain.vt.json",
    } satisfies VirtualTextureAssetOptions;
    const texture: TextureRef = virtualTexture(options);

    expect(standardMaterial({ texture }).baseColor).toBe(texture);
    expect(unlitMaterial({ texture }).baseColor).toBe(texture);
    expect(texture).toEqual({
      contentKey: "sha256:terrain",
      kind: "virtual-asset",
      manifestUri: "/textures/terrain.vt.json",
    });

    const stringTexture: TextureRef = virtualTexture("/textures/terrain.vt.json");
    expect(standardMaterial({ texture: stringTexture }).baseColor).toBe(stringTexture);

    if (false) {
      // @ts-expect-error preview is not a public render fallback for virtual textures.
      virtualTexture({
        preview: imageTexture("/textures/terrain-preview.png"),
        src: "/textures/terrain.vt.json",
      });

      // @ts-expect-error fallbackColor is not a public render fallback for image textures.
      imageTexture({ fallbackColor: [1, 0, 1, 1], src: "/textures/albedo.png" });

      // @ts-expect-error fallback is not a public render fallback for texture assets.
      textureAsset({ fallback: { color: [1, 0, 1, 1], kind: "solid" }, uri: "/textures/mask.ktx2" });

      // @ts-expect-error fallbackColor is not a public render fallback for virtual textures.
      virtualTexture({ fallbackColor: [1, 0, 1, 1], src: "/textures/terrain.vt.json" });

      // @ts-expect-error virtual textures require exactly one public source field.
      virtualTexture({});

      // @ts-expect-error src and manifestUri are mutually exclusive.
      virtualTexture({
        manifestUri: "/textures/terrain-manifest.vt.json",
        src: "/textures/terrain.vt.json",
      });
    }
  });

  it("rejects invalid standard material PBR factors", () => {
    expect(() => standardMaterial({
      color: [1, 1, 1, 1],
      metallic: 2,
      roughness: -1,
    })).toThrow(/within 0\.\.1/);
    expect(() => standardMaterial({
      color: [1, 1, 1, 1],
      metallic: Number.NaN,
    })).toThrow(/finite/);
  });

  it("preserves explicit texture content keys for renderer-level sharing", () => {
    expect(imageTexture({
      contentKey: "sha256:albedo",
      src: "/textures/albedo-a.png",
    })).toEqual({
      colorSpace: "srgb",
      contentKey: "sha256:albedo",
      kind: "asset",
      sampler: defaultImageTextureSampler,
      uri: "/textures/albedo-a.png",
    });

    expect(virtualTexture({
      contentKey: "sha256:albedo-vt",
      src: "/textures/albedo-a.vt.json",
    })).toEqual({
      contentKey: "sha256:albedo-vt",
      kind: "virtual-asset",
      manifestUri: "/textures/albedo-a.vt.json",
    });

    expect(textureAsset({
      contentKey: "sha256:mask",
      uri: "/textures/mask-a.ktx2",
    })).toEqual({
      contentKey: "sha256:mask",
      kind: "asset",
      uri: "/textures/mask-a.ktx2",
    });
  });

  it("normalizes glTF source, version, and bounds into asset identity", () => {
    const bounds = {
      max: [2, 3, 4] as const,
      min: [-2, -3, -4] as const,
    };

    expect(gltf({
      bounds,
      src: "/models/avatar.glb",
      version: 12,
    })).toEqual({
      asset: {
        bounds,
        uri: "/models/avatar.glb",
        version: 12,
      },
      kind: "gltf",
      src: "/models/avatar.glb",
    });
  });

  it("preserves selected glTF material variants by name or index", () => {
    const src = "/models/chair.gltf";
    const cases: Array<[string, NonNullable<Parameters<typeof gltf>[0]["variant"]>, object]> = [
      ["named variant", "walnut", { asset: { uri: src }, kind: "gltf", src, variant: "walnut" }],
      ["indexed variant", 2, { kind: "gltf", variant: 2 }],
    ];

    for (const [label, variant, expected] of cases) {
      expect(gltf({ src, variant }), label).toMatchObject(expected);
    }
  });

  it("preserves directional light descriptor fields", () => {
    expect(directionalLight({
      color: [1, 0.95, 0.84, 1],
      direction: [0.2, -0.7, -1],
    })).toEqual({
      color: [1, 0.95, 0.84, 1],
      direction: [0.2, -0.7, -1],
      illuminanceLux: 1,
      kind: "directional-light",
    });
  });

});
