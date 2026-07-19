import {
  boxGeometry,
  directionalLight,
  gltf,
  imageTexture,
  mesh,
  perspectiveCamera,
  planeGeometry,
  pointLight,
  prefilteredEnvironment,
  scene,
  standardMaterial,
  spotLight,
  studioEnvironment,
  unlitMaterial,
  virtualTexture,
} from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import { prepareCanonicalGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import {
  collectCanonicalSurfaceTextureAssets,
  prepareCanonicalSurfaceScene,
  refreshCanonicalSurfaceTexture,
} from "../../packages/renderer-webgl/src/surface/scene-lowering";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { dielectricF0FromIndexOfRefraction } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { decodedTextureKey } from "../../packages/renderer-webgl/src/texture/asset-owner";
import { prepareStaticGlb } from "../../packages/renderer-webgl/src/gltf/static-asset";
import {
  staticTexturedTriangleGlb,
  staticTriangleDocument,
  staticTriangleGlb,
} from "./support/static-glb";

describe("canonical direct surface lowering", () => {
  it("computes authored dielectric F0 in the functional material core", () => {
    expect(dielectricF0FromIndexOfRefraction(1.5)).toBeCloseTo(0.04);
    expect(dielectricF0FromIndexOfRefraction(1.33)).toBeCloseTo(0.020_059, 5);
    expect(dielectricF0FromIndexOfRefraction(0)).toBe(1);
  });
  it("queues every base color before secondary material images", () => {
    const firstBase = imageTexture("/first-base.png");
    const firstEmissive = imageTexture("/first-emissive.png");
    const firstMetallicRoughness = imageTexture("/first-metallic-roughness.png");
    const firstNormal = imageTexture("/first-normal.png");
    const firstOcclusion = imageTexture("/first-occlusion.png");
    const secondBase = imageTexture("/second-base.png");
    const secondEmissive = imageTexture("/second-emissive.png");
    const firstBaseSamplerAlias = imageTexture({
      sampler: { minFilter: "nearest" },
      src: "/first-base.png",
    });
    const firstBaseLinear = imageTexture({
      colorSpace: "linear",
      src: "/first-base.png",
    });
    const material = (
      baseColorAsset: typeof firstBase,
      emissiveAsset: typeof firstEmissive,
      details = false,
    ): CanonicalSurfaceMaterial => ({
      baseColor: [1, 1, 1, 1],
      baseColorAsset,
      emissiveAsset,
      emissiveFactor: [1, 1, 1],
      kind: "standard",
      metallicFactor: 0,
      ...(details ? {
        metallicRoughnessAsset: firstMetallicRoughness,
        normalAsset: firstNormal,
        occlusionAsset: firstOcclusion,
      } : {}),
      normalScale: 1,
      occlusionStrength: 1,
      requiresTextureCoordinates: true,
      roughnessFactor: 1,
    });

    expect(collectCanonicalSurfaceTextureAssets([
      { materialSource: material(firstBase, firstEmissive, true) },
      { materialSource: material(secondBase, secondEmissive) },
      { materialSource: material(firstBaseSamplerAlias, firstEmissive) },
      { materialSource: material(firstBaseLinear, firstEmissive) },
    ])).toEqual([
      firstBase,
      secondBase,
      firstBaseLinear,
      firstEmissive,
      firstMetallicRoughness,
      firstNormal,
      firstOcclusion,
      secondEmissive,
    ]);
  });

  it("lowers planes and boxes to the same indexed triangle ABI", () => {
    const plane = prepareCanonicalGeometry(planeGeometry([2, 4]));
    const box = prepareCanonicalGeometry(boxGeometry([2, 4, 6]));
    expect(plane.positions).toEqual(new Float32Array([
      -1, -2, 0, 1, -2, 0, 1, 2, 0, -1, 2, 0,
    ]));
    expect(plane.indices).toHaveLength(6);
    expect(box.positions).toHaveLength(24);
    expect(box.indices).toHaveLength(36);
    expect(box.bounds).toEqual({ max: [1, 2, 3], min: [-1, -2, -3] });
  });

  it("uses one upper-left UV convention and retains textured geometry during fallback", () => {
    const texture = imageTexture("/checker.png");
    const renderScene = scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ texture }),
      })],
    });
    const pending = prepareCanonicalSurfaceScene(renderScene);
    expect(pending.surfaces[0]!.geometry.textureCoordinates0).toEqual(
      new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    );
    expect(pending.surfaces[0]!.material).toMatchObject({
      baseColor: [0.214_041, 0.214_041, 0.214_041, 1],
      requiresTextureCoordinates: true,
    });

    const source = { height: 8, source: {} as ImageBitmap, width: 16 };
    const ready = prepareCanonicalSurfaceScene(
      renderScene,
      undefined,
      undefined,
      () => source,
    );
    expect(ready.surfaces[0]!.geometry.key).toBe(pending.surfaces[0]!.geometry.key);
    expect(ready.surfaces[0]!.material.baseColorTexture?.decoded).toBe(source);
  });

  it("carries one glTF MASK material and decoded-alpha demand into exact picking", () => {
    const asset = prepareStaticGlb(staticTexturedTriangleGlb(
      undefined,
      "cutout.png",
      "core",
      (document) => {
        const materials = document.materials as Array<Record<string, unknown>>;
        materials[0]!.alphaMode = "MASK";
        materials[0]!.alphaCutoff = 0.5;
        document.nodes = [{ mesh: 0 }];
        document.scenes = [{ nodes: [0] }];
      },
    ), "cutout");
    const prepared = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [gltf("/cutout.glb")] }),
      () => asset,
    );

    expect(prepared.pickSurfaces).toHaveLength(1);
    expect(prepared.pickSurfaces[0]).toMatchObject({
      alphaMaskSampler: { magFilter: "linear" },
      materialSource: {
        alphaCutoff: 0.5,
        baseColorAsset: { kind: "asset", src: "/cutout.png" },
      },
    });
    expect(prepared.alphaMaskTextureAssets).toEqual([
      expect.objectContaining({ kind: "asset", src: "/cutout.png" }),
    ]);

    const proxyNode = gltf({
      pickingGeometry: planeGeometry(2),
      src: "/cutout.glb",
    });
    const proxied = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [proxyNode] }),
      () => asset,
    );
    expect(proxied.pickSurfaces).toHaveLength(1);
    expect(proxied.pickSurfaces[0]).not.toHaveProperty("materialSource");
    expect(proxied.alphaMaskTextureAssets).toEqual([]);
  });

  it("retains authored virtual textures as an optional canonical binding", () => {
    const texture = virtualTexture({
      manifestUri: "/map.vt.json",
      sampler: { wrapS: "repeat", wrapT: "mirrored-repeat" },
    });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture }),
      })],
    }));
    expect(prepared.textureAssets).toEqual([]);
    expect(prepared.virtualTextureAssets).toEqual([texture]);
    expect(prepared.surfaces[0]!.material).toMatchObject({
      baseColorVirtualAsset: texture,
      requiresTextureCoordinates: true,
    });
    expect(prepared.surfaces[0]!.geometry.textureCoordinates0).toBeInstanceOf(Float32Array);
  });

  it("publishes one decoded texture without rebuilding unrelated scene structure", () => {
    const firstTexture = imageTexture("/first.png");
    const secondTexture = imageTexture("/second.png");
    const pending = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [
        mesh({
          geometry: planeGeometry(1),
          material: unlitMaterial({ texture: firstTexture }),
        }),
        mesh({
          geometry: planeGeometry(2),
          material: unlitMaterial({ texture: secondTexture }),
        }),
        mesh({
          geometry: planeGeometry(3),
          material: unlitMaterial({ texture: firstTexture }),
        }),
      ],
    }));
    const firstSurface = pending.surfaces[0]!;
    const secondSurface = pending.surfaces[1]!;
    const thirdSurface = pending.surfaces[2]!;
    expect(pending.textureSurfaceIndices.get(decodedTextureKey(firstTexture))).toEqual([0, 2]);
    expect(pending.textureSurfaceIndices.get(decodedTextureKey(secondTexture))).toEqual([1]);
    const decoded = { height: 8, source: {} as ImageBitmap, width: 16 };
    const ready = refreshCanonicalSurfaceTexture(
      pending,
      decodedTextureKey(firstTexture),
      (asset) => decodedTextureKey(asset) === decodedTextureKey(firstTexture)
        ? decoded
        : undefined,
    );

    expect(ready).not.toBe(pending);
    expect(ready.pickSurfaces).toBe(pending.pickSurfaces);
    expect(ready.textureSurfaceIndices).toBe(pending.textureSurfaceIndices);
    expect(ready.surfaces[0]).not.toBe(firstSurface);
    expect(ready.surfaces[0]!.geometry).toBe(firstSurface.geometry);
    expect(ready.surfaces[0]!.model).toBe(firstSurface.model);
    expect(ready.surfaces[0]!.normalTransform).toBe(firstSurface.normalTransform);
    expect(ready.surfaces[0]!.material.baseColorTexture?.decoded).toBe(decoded);
    expect(ready.surfaces[1]).toBe(secondSurface);
    expect(ready.surfaces[2]).not.toBe(thirdSurface);
    expect(ready.surfaces[2]!.material.baseColorTexture?.decoded).toBe(decoded);
  });

  it("keeps one node transform and identity while replacing only exact pick triangles", () => {
    const node = mesh({
      geometry: boxGeometry(2),
      material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      pickingGeometry: planeGeometry([4, 1]),
      pickingId: "hero",
      transform: { position: [1, 2, -3], rotation: [0.1, 0.2, 0.3] },
    });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      nodes: [node],
    }));
    const surface = prepared.surfaces[0]!;
    expect(surface.node).toBe(node);
    expect(surface.node.pickingId).toBe("hero");
    expect(surface.geometry.indices).toHaveLength(36);
    expect(surface.model.slice(12, 15)).toEqual([1, 2, -3]);
    expect(prepared.pickSurfaces[0]!.pickingGeometry.indices).toHaveLength(6);
    expect(prepared.pickSurfaces[0]!.node).toBe(surface.node);
  });

  it("prepares a glTF picking proxy without waiting for visible asset geometry", () => {
    const node = gltf({
      pickingGeometry: planeGeometry([4, 1]),
      pickingId: "loading-asset",
      src: "/model.glb",
      transform: { position: [1, 2, -3] },
    });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      nodes: [node],
    }));
    expect(prepared.surfaces).toHaveLength(0);
    expect(prepared.pickSurfaces).toHaveLength(1);
    expect(prepared.pickSurfaces[0]).toMatchObject({
      modelHandedness: 1,
      node,
    });
    expect(prepared.pickSurfaces[0]!.pickingGeometry.indices).toHaveLength(6);
  });

  it("selects an exact glTF material variant and falls back to the base material", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "KHR_materials_variants"];
    document.extensionsUsed = ["KHR_materials_unlit", "KHR_materials_variants"];
    document.extensions = {
      KHR_materials_variants: { variants: [{ name: "Ruby" }] },
    };
    const materials = document.materials as Array<Record<string, unknown>>;
    materials.push({
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [0.9, 0.01, 0.03, 1] },
    });
    const meshes = document.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    meshes[0]!.primitives[0]!.extensions = {
      KHR_materials_variants: { mappings: [{ material: 1, variants: [0] }] },
    };
    const asset = prepareStaticGlb(staticTriangleGlb(document), "variant-asset");
    const ruby = gltf({ materialVariant: "Ruby", src: "/variant.glb" });
    const unknown = gltf({ materialVariant: "Unknown", src: "/variant.glb" });
    const render = (node: typeof ruby) => prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [node] }),
      () => asset,
    );

    expect(render(ruby).surfaces[0]!.material.baseColor).toEqual([0.9, 0.01, 0.03, 1]);
    expect(render(unknown).surfaces[0]!.material.baseColor).toEqual([0.2, 0.4, 0.8, 1]);
  });

  it("shares one world-space LOD selection bound across authored levels", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "MSFT_lod"];
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { MSFT_lod: { ids: [2] } };
    nodes[1]!.extras = { MSFT_screencoverage: [0.5, 0] };
    nodes.push({ mesh: 0, translation: [0, 2, -2] });
    const asset = prepareStaticGlb(staticTriangleGlb(document), "lod-asset");
    const node = gltf({ src: "/lod.glb", transform: { position: [10, 0, 0] } });
    const prepared = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [node] }),
      () => asset,
    );

    expect(prepared.surfaces.map((surface) => surface.lods?.[0]?.level)).toEqual([0, 1]);
    expect(prepared.surfaces[0]!.lods?.[0]?.selectionBounds)
      .toBe(prepared.surfaces[1]!.lods?.[0]?.selectionBounds);
    expect(prepared.surfaces[0]!.lods?.[0]?.selectionBounds).toEqual({
      max: [12, 3, 0],
      min: [10, 1, -2],
    });
    expect(prepared.lodGroups).toEqual([{
      group: "lod-asset:node:1:lod",
      levels: [0, 1],
      selectionBounds: { max: [12, 3, 0], min: [10, 1, -2] },
      surfaceIndices: [0, 1],
      thresholds: [0.5, 0],
    }]);
  });

  it("lowers selected material LOD levels onto the same geometry and selector ABI", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "MSFT_lod"];
    const materials = document.materials as Array<Record<string, unknown>>;
    materials[0]!.extensions = { KHR_materials_unlit: {}, MSFT_lod: { ids: [1] } };
    materials[0]!.extras = { MSFT_screencoverage: [0.5, 0] };
    materials.push({
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [0.05, 0.1, 0.2, 1] },
    });
    const asset = prepareStaticGlb(staticTriangleGlb(document), "material-lod-asset");
    const node = gltf({ src: "/material-lod.glb" });
    const prepared = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [node] }),
      () => asset,
    );

    expect(prepared.surfaces).toHaveLength(2);
    expect(prepared.surfaces[0]!.geometry).toBe(prepared.surfaces[1]!.geometry);
    expect(prepared.surfaces.map((surface) => surface.lods?.[0]?.level)).toEqual([0, 1]);
    expect(prepared.surfaces.map((surface) => surface.material.baseColor)).toEqual([
      [0.2, 0.4, 0.8, 1],
      [0.05, 0.1, 0.2, 1],
    ]);
    expect(prepared.lodGroups).toMatchObject([{
      levels: [0, 1],
      surfaceIndices: [0, 1],
      thresholds: [0.5, 0],
    }]);
    expect(prepared.pickSurfaces).toHaveLength(2);
    expect(prepared.pickSurfaces.map((surface) => surface.lods?.[0]?.level)).toEqual([0, 1]);
  });

  it("normalizes standard material and directional-light state before touching WebGL", () => {
    const renderScene = scene({
      camera: perspectiveCamera({}),
      exposureEv100: 2,
      nodes: [
        {
          kind: "directional-light",
          color: [0.5, 0.25, 1, 1],
          direction: [0, -2, 0],
          illuminanceLux: 8,
        },
        mesh({
          geometry: planeGeometry(1),
          material: standardMaterial({
            color: [1, 0.5, 0.25, 1],
            metallic: 0.2,
            roughness: 0.7,
          }),
        }),
      ],
    });
    const prepared = prepareCanonicalSurfaceScene(renderScene);
    expect(prepared.directionalLights).toEqual([{
      color: [4, 2, 8, 1],
      direction: [0, -1, 0],
    }]);
    expect(prepared.exposure).toBeCloseTo(1 / 4.8);
    expect(prepared.surfaces[0]!.material).toMatchObject({
      baseColor: [1, 0.5, 0.25, 1],
      emissiveFactor: [0, 0, 0],
      kind: "standard",
      metallicFactor: 0.2,
      normalScale: 1,
      occlusionStrength: 1,
      requiresTextureCoordinates: false,
      roughnessFactor: 0.7,
    });
  });

  it("erases inert lighting state from unlit-only scenes", () => {
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      environment: studioEnvironment(),
      nodes: [
        directionalLight({ direction: [0, -1, 0], illuminanceLux: 100 }),
        mesh({
          geometry: planeGeometry(1),
          material: unlitMaterial({ color: [1, 1, 1, 1] }),
        }),
      ],
    }));
    expect(prepared.directionalLights).toEqual([]);
    expect(prepared.surfaces[0]!.material.kind).toBe("unlit");
  });

  it("normalizes point and spot lights to one bounded punctual-light ABI", () => {
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [
        pointLight({
          color: [0.5, 1, 0.25, 1],
          intensityCandela: 12,
          position: [1, 2, 3],
          range: 8,
        }),
        spotLight({
          direction: [0, -2, 0],
          innerConeAngle: 0.2,
          intensityCandela: 5,
          outerConeAngle: 0.5,
          position: [-1, 4, 2],
        }),
        mesh({
          geometry: planeGeometry(1),
          material: standardMaterial({ color: [1, 1, 1, 1] }),
        }),
      ],
    }));
    expect(prepared.punctualLights).toEqual([
      {
        color: [6, 12, 3, 1],
        direction: [0, 0, -1],
        innerConeCosine: 1,
        kind: "point",
        outerConeCosine: -1,
        position: [1, 2, 3],
        range: 8,
      },
      {
        color: [5, 5, 5, 1],
        direction: [0, -1, 0],
        innerConeCosine: Math.cos(0.2),
        kind: "spot",
        outerConeCosine: Math.cos(0.5),
        position: [-1, 4, 2],
        range: 0,
      },
    ]);
  });

  it("composes authored glTF punctual lights through the same scene ABI", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "KHR_lights_punctual"];
    document.extensionsUsed = ["KHR_materials_unlit", "KHR_lights_punctual"];
    document.extensions = {
      KHR_lights_punctual: { lights: [{ intensity: 3, type: "point" }] },
    };
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { KHR_lights_punctual: { light: 0 } };
    const asset = prepareStaticGlb(staticTriangleGlb(document), "lit-asset");
    const node = gltf({ src: "/lit.glb", transform: { position: [10, 0, 0] } });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [node],
    }), (candidate) => candidate === node ? asset : undefined);
    expect(prepared.punctualLights).toMatchObject([{
      color: [3, 3, 3, 1],
      kind: "point",
      position: [11, 2, 0],
    }]);
  });

  it("normalizes the built-in studio environment only when a lit surface demands it", () => {
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      environment: studioEnvironment({ radianceScaleNits: 25, rotation: [0, 0.5, 0] }),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
      })],
    }));
    expect(prepared.environment?.radianceScaleNits).toBe(25);
    expect(prepared.environment?.rotation).toHaveLength(16);
  });

  it("fails a prefiltered environment before publishing known-wrong lighting", () => {
    expect(() => prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      environment: prefilteredEnvironment({ src: "/studio.ktx" }),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
      })],
    }))).toThrow("does not yet support prefiltered environments");
  });
});
