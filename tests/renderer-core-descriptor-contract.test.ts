import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  createGltfInstanceTransforms,
  defaultImageTextureSampler,
  directionalLight,
  gltf,
  gltfInstances,
  imageTexture,
  mesh,
  orthographicCamera,
  perspectiveCamera,
  planeGeometry,
  pointLight,
  scene,
  solidTexture,
  spotLight,
  standardMaterial,
  studioEnvironment,
  textureAsset,
  type TextureRef,
  unlitMaterial,
  virtualTexture,
  wireframeMaterial,
  type VirtualTextureAssetOptions,
  type VirtualTextureInput,
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
      toneMapping: "pbr-neutral",
    })).toEqual({
      camera,
      clearColor: [0.1, 0.2, 0.3, 1],
      environment,
      exposureEv100: 1.25,
      kind: "scene",
      nodes: [],
      toneMapping: "pbr-neutral",
    });

    expect(() => scene({
      camera,
      nodes: [],
      exposureEv100: Number.NaN,
    })).toThrow(/exposureEv100/);
    expect(scene({ camera, exposureEv100: -128, nodes: [] }).exposureEv100).toBe(-128);
    expect(scene({ camera, exposureEv100: 149, nodes: [] }).exposureEv100).toBe(149);
    expect(() => scene({ camera, exposureEv100: -129, nodes: [] })).toThrow(/-128\.\.149/);
    expect(() => scene({ camera, exposureEv100: 150, nodes: [] })).toThrow(/-128\.\.149/);
    expect(() => scene({
      camera,
      nodes: [],
      clearColor: [0, Number.NaN, 0, 1],
    })).toThrow(/clearColor.*finite/);
  });

  it("preserves picking identity and geometry on every pickable descriptor", () => {
    const pickingGeometry = boxGeometry(0.5);
    expect(mesh({
      geometry: boxGeometry(1),
      material: unlitMaterial({ color: [1, 1, 1, 1] }),
      pickingGeometry,
      pickingId: "box-a",
    })).toEqual({
      geometry: boxGeometry(1),
      kind: "mesh",
      material: unlitMaterial({ color: [1, 1, 1, 1] }),
      pickingGeometry,
      pickingId: "box-a",
    });

    expect(gltf({
      pickingGeometry,
      pickingId: "helmet",
      src: "/models/helmet.gltf",
    })).toEqual({
      asset: {
        uri: "/models/helmet.gltf",
      },
      kind: "gltf",
      pickingGeometry,
      pickingId: "helmet",
    });

    const instances = createGltfInstanceTransforms({ count: 1 });
    expect(gltfInstances({
      instances,
      pickingGeometry,
      pickingId: "helmets",
      src: "/models/helmet.gltf",
    })).toEqual({
      asset: { uri: "/models/helmet.gltf" },
      instances,
      kind: "gltf-instances",
      pickingGeometry,
      pickingId: "helmets",
    });

    expect(() => mesh({
      geometry: boxGeometry(1),
      material: unlitMaterial({ color: [1, 1, 1, 1] }),
      pickingId: "",
    })).toThrow(/mesh pickingId must be a non-empty string/);
    expect(() => gltf({
      pickingId: 42 as unknown as string,
      src: "/models/helmet.gltf",
    })).toThrow(/glTF pickingId must be a non-empty string/);
    expect(() => gltfInstances({
      instances,
      pickingId: "",
      src: "/models/helmet.gltf",
    })).toThrow(/glTF instances pickingId must be a non-empty string/);
    expect(() => createGltfInstanceTransforms({
      count: 1,
      logicalIds: [""],
    })).toThrow(/glTF instance logicalIds\[0\] must be a non-empty string/);
    expect(() => mesh({
      geometry: null as unknown as ReturnType<typeof boxGeometry>,
      material: unlitMaterial({ color: [1, 1, 1, 1] }),
    })).toThrow(/mesh geometry must be a boxGeometry or planeGeometry descriptor/);
    expect(() => gltf({
      pickingGeometry: {
        kind: "sphere",
        size: [1, 1, 1],
      } as unknown as ReturnType<typeof boxGeometry>,
      src: "/models/helmet.gltf",
    })).toThrow(/glTF pickingGeometry must be a boxGeometry or planeGeometry descriptor/);
    expect(() => gltfInstances({
      instances,
      pickingGeometry: {
        kind: "box",
        radius: 1,
        size: [1, 1, 1],
      } as unknown as ReturnType<typeof boxGeometry>,
      src: "/models/helmet.gltf",
    })).toThrow(/glTF instances pickingGeometry contains unsupported field.*radius/i);
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
    const textureFromInput = (input: VirtualTextureInput): TextureRef => virtualTexture(input);
    expect(textureFromInput({ manifestUri: "/textures/terrain.vt.json" })).toEqual(stringTexture);

    expect(() => virtualTexture({} as VirtualTextureAssetOptions)).toThrow(
      'virtual texture "manifestUri" must be a non-empty string',
    );
    expect(() => virtualTexture({ manifestUri: "" })).toThrow(
      'virtual texture "manifestUri" must be a non-empty string',
    );

    if (false) {
      // @ts-expect-error preview is not a public render fallback for virtual textures.
      virtualTexture({
        manifestUri: "/textures/terrain.vt.json",
        preview: imageTexture("/textures/terrain-preview.png"),
      });

      // @ts-expect-error fallbackColor is not a public render fallback for image textures.
      imageTexture({ fallbackColor: [1, 0, 1, 1], src: "/textures/albedo.png" });

      // @ts-expect-error cross-URI identity is explicit through textureAsset.
      imageTexture({ contentKey: "sha256:albedo", src: "/textures/albedo.png" });

      // @ts-expect-error solid colors are already canonical linear RGBA values.
      solidTexture({ color: [1, 0, 1, 1], colorSpace: "srgb" });

      // @ts-expect-error solid colors have no external source bytes to version.
      solidTexture({ color: [1, 0, 1, 1], version: 2 });

      // @ts-expect-error fallback is not a public render fallback for texture assets.
      textureAsset({ fallback: { color: [1, 0, 1, 1], kind: "solid" }, src: "/textures/mask.ktx2" });

      // @ts-expect-error fallbackColor is not a public render fallback for virtual textures.
      virtualTexture({ fallbackColor: [1, 0, 1, 1], manifestUri: "/textures/terrain.vt.json" });

      // @ts-expect-error virtual textures require the explicit manifest URI field.
      virtualTexture({});

      // @ts-expect-error src is not an object-form alias for manifestUri.
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

  it("rejects ambiguous and misspelled material options", () => {
    expect(() => standardMaterial({
      color: [1, 1, 1, 1],
      texture: imageTexture("/textures/albedo.png"),
    } as unknown as Parameters<typeof standardMaterial>[0])).toThrow(/exactly one of color or texture/);
    expect(() => unlitMaterial({} as Parameters<typeof unlitMaterial>[0]))
      .toThrow(/exactly one of color or texture/);
    expect(() => standardMaterial({
      color: [1, 1, 1, 1],
      metalic: 0.5,
    } as unknown as Parameters<typeof standardMaterial>[0])).toThrow(/unsupported option "metalic"/);
    expect(() => wireframeMaterial({
      color: [1, 1, 1, 1],
      width: 2,
    } as unknown as Parameters<typeof wireframeMaterial>[0])).toThrow(/unsupported option "width"/);

    if (false) {
      // @ts-expect-error Native WebGL line width is not portable; wireframes are one device pixel.
      wireframeMaterial({ color: [1, 1, 1, 1], width: 2 });
    }
  });

  it("rejects unknown fields at public scene descriptor boundaries", () => {
    const material = unlitMaterial({ color: [1, 1, 1, 1] });
    const instances = createGltfInstanceTransforms({ count: 1 });
    const cases: readonly [label: string, create: () => unknown][] = [
      ['perspective camera', () => perspectiveCamera({
        nearClip: 0.1,
      } as unknown as Parameters<typeof perspectiveCamera>[0])],
      ['orthographic camera', () => orthographicCamera({
        bottom: -1, left: -1, right: 1, top: 1, zoom: 2,
      } as unknown as Parameters<typeof orthographicCamera>[0])],
      ['box geometry', () => boxGeometry({
        segments: 2, size: 1,
      } as unknown as Parameters<typeof boxGeometry>[0])],
      ['plane geometry', () => planeGeometry({
        segments: 2, size: 1,
      } as unknown as Parameters<typeof planeGeometry>[0])],
      ['directional light', () => directionalLight({
        direction: [0, -1, 0], intensityLux: 1,
      } as unknown as Parameters<typeof directionalLight>[0])],
      ['point light', () => pointLight({
        intensityCandela: 1, position: [0, 0, 0], radius: 2,
      } as unknown as Parameters<typeof pointLight>[0])],
      ['spot light', () => spotLight({
        direction: [0, -1, 0], intensityCandela: 1, position: [0, 0, 0], radius: 2,
      } as unknown as Parameters<typeof spotLight>[0])],
      ['studio environment', () => studioEnvironment({
        intensity: 2,
      } as unknown as Parameters<typeof studioEnvironment>[0])],
      ['mesh', () => mesh({
        geometry: boxGeometry(1), material, name: 'box',
      } as unknown as Parameters<typeof mesh>[0])],
      ['glTF', () => gltf({ name: 'helmet', src: '/helmet.glb' } as unknown as Parameters<typeof gltf>[0])],
      ['glTF instance transforms', () => createGltfInstanceTransforms({
        count: 1, ids: ['one'],
      } as unknown as Parameters<typeof createGltfInstanceTransforms>[0])],
      ['glTF instances', () => gltfInstances({
        instances, name: 'trees', src: '/tree.glb',
      } as unknown as Parameters<typeof gltfInstances>[0])],
      ['solid texture', () => solidTexture({
        color: [1, 1, 1, 1], colorSpace: 'linear',
      } as unknown as Parameters<typeof solidTexture>[0])],
      ['texture asset', () => textureAsset({
        flipY: false, src: '/albedo.png',
      } as unknown as Parameters<typeof textureAsset>[0])],
      ['image texture', () => imageTexture({
        flipY: false, src: '/albedo.png',
      } as unknown as Parameters<typeof imageTexture>[0])],
      ['virtual texture', () => virtualTexture({
        fallback: '/preview.png', manifestUri: '/terrain.vt.json',
      } as unknown as Parameters<typeof virtualTexture>[0])],
      ['texture sampler', () => imageTexture({
        sampler: { anisotropy: 4 }, src: '/albedo.png',
      } as unknown as Parameters<typeof imageTexture>[0])],
      ['transform', () => mesh({
        geometry: boxGeometry(1),
        material,
        transform: { quaternion: [0, 0, 0, 1] },
      } as unknown as Parameters<typeof mesh>[0])],
      ['scene', () => scene({
        camera, children: [], nodes: [],
      } as unknown as Parameters<typeof scene>[0])],
    ];

    for (const [label, create] of cases) {
      expect(create, label).toThrow(/unsupported option/);
    }
    expect(() => scene(null as unknown as Parameters<typeof scene>[0]))
      .toThrow('scene options must be an object');
  });

  it("rejects malformed fixed-size tuples with descriptor-local errors", () => {
    expect(() => perspectiveCamera({
      position: [1, 2] as unknown as readonly [number, number, number],
    })).toThrow('camera position must be an array of exactly 3 numbers');
    expect(() => pointLight({
      intensityCandela: 1,
      position: undefined as unknown as readonly [number, number, number],
    })).toThrow('point light position must be an array of exactly 3 numbers');
    expect(() => solidTexture({
      color: [1, 1, 1, 1, 1] as unknown as readonly [number, number, number, number],
    })).toThrow('solid texture color must be an array of exactly 4 numbers');
    expect(() => gltf({
      bounds: {
        max: [1, 1, 1],
        min: [0, 0] as unknown as readonly [number, number, number],
      },
      src: '/models/avatar.glb',
    })).toThrow('glTF asset bounds min must be an array of exactly 3 numbers');
  });

  it("preserves explicit texture content keys for renderer-level sharing", () => {
    expect(textureAsset({
      colorSpace: "srgb",
      contentKey: "sha256:albedo",
      sampler: defaultImageTextureSampler,
      src: "/textures/albedo-a.png",
    })).toEqual({
      colorSpace: "srgb",
      contentKey: "sha256:albedo",
      kind: "asset",
      sampler: defaultImageTextureSampler,
      uri: "/textures/albedo-a.png",
    });
    expect(imageTexture({ src: "/textures/albedo-a.png" })).not.toHaveProperty("contentKey");

    expect(virtualTexture({
      contentKey: "sha256:albedo-vt",
      manifestUri: "/textures/albedo-a.vt.json",
    })).toEqual({
      contentKey: "sha256:albedo-vt",
      kind: "virtual-asset",
      manifestUri: "/textures/albedo-a.vt.json",
    });

    expect(textureAsset({
      contentKey: "sha256:mask",
      src: "/textures/mask-a.ktx2",
    })).toEqual({
      contentKey: "sha256:mask",
      kind: "asset",
      uri: "/textures/mask-a.ktx2",
    });

    expect(() => textureAsset({ src: "/textures/a.png", version: Number.NaN }))
      .toThrow(/texture asset version must be finite/);
    expect(() => textureAsset({ contentKey: "", src: "/textures/a.png" }))
      .toThrow(/texture asset contentKey must be a non-empty string/);
    expect(() => virtualTexture({ manifestUri: "/textures/a.vt.json", version: Infinity }))
      .toThrow(/virtual texture version must be finite/);
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
    });

    expect(() => gltf({ src: "/models/avatar.glb", version: Number.NaN }))
      .toThrow(/glTF asset version must be finite/);
    expect(() => gltf({ src: "/models/avatar.glb", version: "" }))
      .toThrow(/glTF asset version must be a non-empty string/);
    expect(() => gltf({ src: 42 as unknown as string }))
      .toThrow(/glTF source must be a non-empty string/);
    expect(() => textureAsset({
      contentKey: false as unknown as string,
      src: "/textures/a.png",
    })).toThrow(/texture asset contentKey must be a non-empty string/);
  });

  it("preserves selected glTF material variants by exact name", () => {
    const src = "/models/chair.gltf";
    expect(gltf({ materialVariant: "walnut", src })).toMatchObject({
      asset: { uri: src },
      kind: "gltf",
      materialVariant: "walnut",
    });
    expect(() => gltf({ materialVariant: "", src })).toThrow(/materialVariant must be a non-empty string/);
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

  it("accepts zero-output lights while rejecting negative intensity", () => {
    expect(pointLight({ intensityCandela: 0, position: [0, 1, 0] }).intensityCandela).toBe(0);
    expect(spotLight({
      direction: [0, -1, 0],
      intensityCandela: 0,
      position: [0, 1, 0],
    }).intensityCandela).toBe(0);

    expect(() => pointLight({ intensityCandela: -1, position: [0, 1, 0] }))
      .toThrow(/intensityCandela must be non-negative/);
    expect(() => spotLight({
      direction: [0, -1, 0],
      intensityCandela: -1,
      position: [0, 1, 0],
    })).toThrow(/intensityCandela must be non-negative/);
  });

});
