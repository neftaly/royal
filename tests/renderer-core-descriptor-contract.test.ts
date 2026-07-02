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
  type TextureRef,
  unlitMaterial,
  virtualTexture,
  type VirtualTextureAssetOptions,
  wireframeMaterial,
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
      clearColor: [0, 0, 0, 0],
      kind: "pass",
    });
  });

  it("normalizes transform scale when mesh and glTF transforms are present", () => {
    const transform = {
      position: [1, 2, 3] as const,
      rotation: [0.1, 0.2, 0.3] as const,
    };

    expect(
      mesh({
        geometry: boxGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
        transform,
      }).transform,
    ).toEqual({
      ...transform,
      scale: [1, 1, 1],
    });

    expect(gltf({ src: "/models/ship.gltf", transform }).transform).toEqual({
      ...transform,
      scale: [1, 1, 1],
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

  it("normalizes texture identity fields and fallback colors", () => {
    expect(imageTexture({
      fallbackColor: [1, 0, 1, 1],
      src: "/textures/albedo.png",
      version: "albedo-v2",
    })).toEqual({
      colorSpace: "srgb",
      fallback: {
        color: [1, 0, 1, 1],
        kind: "solid",
      },
      kind: "asset",
      sampler: {
        magFilter: "linear",
        minFilter: "linear-mipmap-linear",
        wrapS: "clamp-to-edge",
        wrapT: "clamp-to-edge",
      },
      uri: "/textures/albedo.png",
      version: "albedo-v2",
    });

    expect(textureAsset({
      fallbackColor: [0.5, 0.5, 0.5, 1],
      uri: "/textures/mask.ktx2",
      version: 3,
    })).toEqual({
      fallback: {
        color: [0.5, 0.5, 0.5, 1],
        kind: "solid",
      },
      kind: "asset",
      uri: "/textures/mask.ktx2",
      version: 3,
    });

    expect(virtualTexture({
      debugName: "terrain-vt",
      fallbackColor: [0.08, 0.1, 0.12, 1],
      src: "/textures/terrain.vt.json",
      version: "terrain-v1",
    })).toEqual({
      debugName: "terrain-vt",
      fallback: {
        color: [0.08, 0.1, 0.12, 1],
        kind: "solid",
      },
      kind: "virtual-asset",
      manifestUri: "/textures/terrain.vt.json",
      version: "terrain-v1",
    });
  });

  it("keeps virtual textures as texture refs without public preview fallbacks", () => {
    const options = {
      debugName: "contract terrain",
      fallbackColor: [0.08, 0.1, 0.12, 1],
      manifestUri: "/textures/terrain.vt.json",
    } satisfies VirtualTextureAssetOptions;
    const texture: TextureRef = virtualTexture(options);

    expect(standardMaterial({ texture }).baseColor).toBe(texture);
    expect(unlitMaterial({ texture }).baseColor).toBe(texture);
    expect(texture).toEqual({
      debugName: "contract terrain",
      fallback: {
        color: [0.08, 0.1, 0.12, 1],
        kind: "solid",
      },
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

      // @ts-expect-error virtual textures require exactly one public source field.
      virtualTexture({});

      // @ts-expect-error src and manifestUri are mutually exclusive.
      virtualTexture({
        manifestUri: "/textures/terrain-manifest.vt.json",
        src: "/textures/terrain.vt.json",
      });
    }
  });

  it("normalizes material baseColor from color or texture inputs", () => {
    const texture = imageTexture("/textures/panel.png");

    expect(standardMaterial({ color: [0.1, 0.2, 0.3, 1] })).toEqual({
      baseColor: {
        color: [0.1, 0.2, 0.3, 1],
        kind: "solid",
      },
      kind: "standard",
    });

    expect(standardMaterial({ texture })).toEqual({
      baseColor: texture,
      kind: "standard",
    });

    expect(unlitMaterial({ color: [0.9, 0.8, 0.7, 1] })).toEqual({
      baseColor: {
        color: [0.9, 0.8, 0.7, 1],
        kind: "solid",
      },
      kind: "unlit",
    });

    expect(unlitMaterial({ texture })).toEqual({
      baseColor: texture,
      kind: "unlit",
    });

    expect(wireframeMaterial({ color: [1, 0.8, 0.2, 1] })).toEqual({
      baseColor: {
        color: [1, 0.8, 0.2, 1],
        kind: "solid",
      },
      kind: "wireframe",
      width: 1.25,
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
