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
  it("defaults render pass clearColor for one-shot renderers", () => {
    expect(pass({ camera, children: [] })).toEqual({
      camera,
      children: [],
      clear: "color-depth",
      clearColor: [0, 0, 0, 0],
      depthTest: true,
      kind: "pass",
    });
  });

  it("preserves render pass clear and depth options for overlays", () => {
    expect(pass({
      camera,
      children: [],
      clear: "none",
      clearColor: [0.1, 0.2, 0.3, 1],
      depthTest: false,
    })).toEqual({
      camera,
      children: [],
      clear: "none",
      clearColor: [0.1, 0.2, 0.3, 1],
      depthTest: false,
      kind: "pass",
    });
  });

  it("preserves pass environment lighting descriptors", () => {
    const environment = studioEnvironment({
      intensity: 1.1,
      rotation: [0, Math.PI / 4, 0],
    });

    expect(environment).toEqual({
      intensity: 1.1,
      kind: "environment-light",
      preset: "studio",
      rotation: [0, Math.PI / 4, 0],
    });
    expect(pass({
      camera,
      children: [],
      environment,
    })).toEqual({
      camera,
      children: [],
      clear: "color-depth",
      clearColor: [0, 0, 0, 0],
      depthTest: true,
      environment,
      kind: "pass",
    });
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
      debugName: "contract terrain",
      manifestUri: "/textures/terrain.vt.json",
    } satisfies VirtualTextureAssetOptions;
    const texture: TextureRef = virtualTexture(options);

    expect(standardMaterial({ texture }).baseColor).toBe(texture);
    expect(unlitMaterial({ texture }).baseColor).toBe(texture);
    expect(texture).toEqual({
      debugName: "contract terrain",
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

  it("clamps standard material PBR factors", () => {
    expect(standardMaterial({
      color: [1, 1, 1, 1],
      metallic: 2,
      roughness: -1,
    })).toMatchObject({
      metallicFactor: 1,
      roughnessFactor: 0,
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
    expect(gltf({
      src: "/models/chair.gltf",
      variant: "walnut",
    })).toEqual({
      asset: {
        uri: "/models/chair.gltf",
      },
      kind: "gltf",
      src: "/models/chair.gltf",
      variant: "walnut",
    });

    expect(gltf({
      src: "/models/chair.gltf",
      variant: 2,
    })).toMatchObject({
      kind: "gltf",
      variant: 2,
    });
  });

  it("preserves controlled glTF animation clips and time", () => {
    expect(gltf({
      animation: {
        clip: "walk",
        timeSeconds: 1.25,
      },
      src: "/models/avatar.glb",
    })).toEqual({
      animation: {
        clip: "walk",
        timeSeconds: 1.25,
      },
      asset: {
        uri: "/models/avatar.glb",
      },
      kind: "gltf",
      src: "/models/avatar.glb",
    });

    expect(gltf({
      animation: {
        timeSeconds: 0,
      },
      src: "/models/avatar.glb",
    })).toEqual({
      animation: {
        timeSeconds: 0,
      },
      asset: {
        uri: "/models/avatar.glb",
      },
      kind: "gltf",
      src: "/models/avatar.glb",
    });
  });

  it("preserves directional light descriptor fields", () => {
    expect(directionalLight({
      color: [1, 0.95, 0.84, 1],
      direction: [0.2, -0.7, -1],
    })).toEqual({
      color: [1, 0.95, 0.84, 1],
      direction: [0.2, -0.7, -1],
      kind: "directional-light",
    });
  });

});
