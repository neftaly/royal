import {
  boxGeometry,
  createGltfInstanceTransforms,
  directionalLight,
  gltf,
  gltfInstances,
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
  triangleGeometry,
  unlitMaterial,
  virtualTexture,
  wireframeMaterial,
  type RenderObjectHandle,
} from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import { prepareCanonicalGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import {
  collectCanonicalSurfaceTextureAssets,
  prepareCanonicalSurfaceScene,
  refreshCanonicalSurfaceTextures,
} from "../../packages/renderer-webgl/src/surface/scene-lowering";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { dielectricF0FromIndexOfRefraction } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { baseColorTextureFeatureBits } from "../../packages/renderer-webgl/src/surface/surface-texture-plan";
import {
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE,
} from "../../packages/renderer-webgl/src/surface/surface-program-features";
import { decodedTextureKey } from "../../packages/renderer-webgl/src/texture/asset-owner";
import { prepareStaticGlb } from "../../packages/renderer-webgl/src/gltf/static-asset";
import {
  staticTexturedTriangleGlb,
  staticTriangleDocument,
  staticTriangleGlb,
} from "./support/static-glb";
import {
  createCanonicalRenderObjectUpdateWorkspace,
  updateCanonicalRenderObjectTransform,
} from "../../packages/renderer-webgl/src/surface/render-object-scene-update";

describe("canonical direct surface lowering", () => {
  it("selects exactly one resident base-color representation", () => {
    expect(baseColorTextureFeatureBits(false, false)).toBe(0);
    expect(baseColorTextureFeatureBits(true, false)).toBe(SURFACE_FEATURE_BASE_COLOR_TEXTURE);
    expect(baseColorTextureFeatureBits(false, true)).toBe(SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE);
    expect(baseColorTextureFeatureBits(true, true)).toBe(SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE);
  });

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

  it("coalesces overlapping texture publications into one surface refresh", () => {
    const texture = imageTexture("/batched.png");
    const pending = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: unlitMaterial({ texture }),
      })],
    }));
    const key = decodedTextureKey(texture);
    const decoded = { height: 8, source: {} as ImageBitmap, width: 8 };
    let resolves = 0;
    const ready = refreshCanonicalSurfaceTextures({
      ...pending,
      textureSurfaceIndices: new Map([
        [key, [0]],
        ["alias", [0]],
      ]),
    }, [key, "alias"], () => {
      resolves += 1;
      return decoded;
    });

    expect(resolves).toBe(1);
    expect(ready.surfaces[0]!.material.baseColorTexture?.decoded).toBe(decoded);
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

  it("does not prepare or retain picking-only geometry when picking is disabled", () => {
    const visualGeometry = planeGeometry(2);
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: visualGeometry,
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        pickingGeometry: boxGeometry(10),
      })],
    }), undefined, undefined, undefined, undefined, { includePicking: false });

    expect(prepared.pickSurfaces).toEqual([]);
    expect(prepared.surfaces[0]).not.toHaveProperty("pickingGeometry");
    expect(prepared.surfaces[0]!.geometry.bounds).toEqual({
      max: [1, 1, 0],
      min: [-1, -1, 0],
    });
  });

  it("canonicalizes shared direct descriptors once per scene lowering", () => {
    const geometry = boxGeometry(2);
    const material = unlitMaterial({ color: [0.2, 0.4, 0.8, 1] });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      nodes: [
        mesh({ geometry, material, transform: { position: [-1, 0, 0] } }),
        mesh({ geometry, material, transform: { position: [1, 0, 0] } }),
      ],
    }));

    expect(prepared.surfaces[1]!.geometry).toBe(prepared.surfaces[0]!.geometry);
    expect(prepared.surfaces[1]!.materialSource).toBe(prepared.surfaces[0]!.materialSource);
  });

  it("retains one authored triangle record across visual and picking uses", () => {
    const geometry = triangleGeometry({
      positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
      textureCoordinates: [0, 1, 1, 1, 0.5, 0],
    });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      nodes: [
        mesh({
          geometry,
          material: unlitMaterial({ texture: imageTexture("/triangle.png") }),
          pickingGeometry: geometry,
        }),
      ],
    }));

    expect(prepared.pickSurfaces[0]!.pickingGeometry).toBe(prepared.surfaces[0]!.geometry);
  });

  it("owns canonical triangle bytes instead of aliasing public descriptors", () => {
    const geometry = triangleGeometry({
      indices: [0, 1, 2],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      textureCoordinates: [0, 0, 1, 0, 0, 1],
    });
    const canonical = prepareCanonicalGeometry(geometry);

    expect(canonical.indices).not.toBe(geometry.indices);
    expect(canonical.normals).not.toBe(geometry.normals);
    expect(canonical.positions).not.toBe(geometry.positions);
    expect(canonical.textureCoordinates0).not.toBe(geometry.textureCoordinates);

    geometry.indices[1] = 0;
    geometry.normals![2] = -1;
    geometry.positions[3] = 9;
    geometry.textureCoordinates![2] = 0.5;
    expect([...canonical.indices]).toEqual([0, 1, 2]);
    expect([...canonical.normals!]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect([...canonical.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect([...canonical.textureCoordinates0!]).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("lowers wireframes to shared unlit lines while retaining triangle picking", () => {
    const geometry = boxGeometry(2);
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      nodes: [mesh({
        geometry,
        material: wireframeMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      })],
    }));
    const surface = prepared.surfaces[0]!;
    const pickSurface = prepared.pickSurfaces[0]!;

    expect(surface).toMatchObject({
      material: { baseColor: [0.2, 0.4, 0.8, 1], kind: "unlit" },
      topology: "lines",
    });
    expect(surface.geometry.indices).toHaveLength(72);
    expect(pickSurface.pickingGeometry.indices).toHaveLength(36);
    expect(surface.geometry.positions).toBe(pickSurface.pickingGeometry.positions);
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
      baseColor: [1, 1, 1, 1],
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

  it("lowers a direct texture tint through the existing canonical base-color factor", () => {
    const texture = imageTexture("/tinted.png");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({
          metallic: 0.2,
          roughness: 0.7,
          texture,
          tint: [0.25, 0.5, 0.75, 0.5],
        }),
      })],
    }));

    expect(prepared.surfaces[0]!.material).toMatchObject({
      alphaBlend: true,
      baseColor: [0.25, 0.5, 0.75, 0.5],
      baseColorAsset: texture,
      metallicFactor: 0.2,
      roughnessFactor: 0.7,
    });
  });

  it("carries one glTF MASK material and decoded-alpha demand into exact picking", () => {
    const asset = prepareStaticGlb(staticTexturedTriangleGlb(
      undefined,
      "cutout.png",
      (document) => {
        const materials = document.materials as Array<Record<string, unknown>>;
        materials[0]!.alphaMode = "MASK";
        materials[0]!.alphaCutoff = 0.5;
        materials[0]!.doubleSided = true;
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
      doubleSided: true,
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

  it("keeps glTF BLEND picking on triangles without retaining alpha-mask data", () => {
    const asset = prepareStaticGlb(staticTexturedTriangleGlb(
      undefined,
      "transparent.png",
      (document) => {
        const materials = document.materials as Array<Record<string, unknown>>;
        materials[0]!.alphaMode = "BLEND";
        document.nodes = [{ mesh: 0 }];
        document.scenes = [{ nodes: [0] }];
      },
    ), "transparent");
    const prepared = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [gltf("/transparent.glb")] }),
      () => asset,
    );

    expect(prepared.surfaces[0]!.material.alphaBlend).toBe(true);
    expect(prepared.pickSurfaces[0]).not.toHaveProperty("materialSource");
    expect(prepared.pickSurfaces[0]).not.toHaveProperty("alphaMaskSampler");
    expect(prepared.alphaMaskTextureAssets).toEqual([]);
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
    const ready = refreshCanonicalSurfaceTextures(
      pending,
      [decodedTextureKey(firstTexture)],
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
    const pickingGeometry = triangleGeometry({
      indices: [0, 1, 2, 0, 2, 3],
      positions: [-2, -0.5, 0, 2, -0.5, 0, 1, 0.5, 0, -1, 0.5, 0],
    });
    const node = mesh({
      geometry: boxGeometry(2),
      material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      pickingGeometry,
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
    expect(prepared.pickSurfaces[0]!.pickingGeometry.indices).toEqual(pickingGeometry.indices);
    expect(prepared.pickSurfaces[0]!.pickingGeometry.positions).toEqual(pickingGeometry.positions);
    expect(prepared.pickSurfaces[0]!.pickingGeometry.bounds).toEqual({
      max: [2, 0.5, 0],
      min: [-2, -0.5, 0],
    });
    expect(prepared.pickSurfaces[0]!.node).toBe(surface.node);
  });

  it("prepares a glTF picking proxy without waiting for visible asset geometry", () => {
    const pickingGeometry = triangleGeometry({
      positions: [-2, -0.5, 0, 2, -0.5, 0, 0, 0.5, 0],
    });
    const node = gltf({
      pickingGeometry,
      pickingId: "loading-asset",
      src: "/model.glb",
      transform: { position: [1, 2, -3] },
    });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      environment: studioEnvironment(),
      nodes: [node],
    }));
    expect(prepared.surfaces).toHaveLength(0);
    expect(prepared.pickSurfaces).toHaveLength(1);
    expect(prepared.pickSurfaces[0]).toMatchObject({
      node,
      source: "picking-proxy",
    });
    expect(prepared.pickSurfaces[0]!.pickingGeometry.indices).toEqual(pickingGeometry.indices);
    expect(prepared.pickSurfaces[0]!.pickingGeometry.positions).toEqual(pickingGeometry.positions);
    expect(prepared.environment).toBeDefined();
  });

  it("selects an exact glTF material variant and falls back to the base material", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "KHR_materials_variants"];
    document.extensionsUsed = ["KHR_materials_unlit", "KHR_materials_variants"];
    document.extensions = {
      KHR_materials_variants: { variants: [{ name: "Ruby" }] },
    };
    const materials = document.materials as Array<Record<string, unknown>>;
    delete materials[0]!.extensions;
    materials.push({
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [0.9, 0.01, 0.03, 1] },
    });
    const meshes = document.meshes as Array<{ primitives: Array<Record<string, unknown>> }>;
    meshes[0]!.primitives[0]!.extensions = {
      KHR_materials_variants: { mappings: [{ material: 1, variants: [0] }] },
    };
    const asset = prepareStaticGlb(staticTriangleGlb(document), "variant-asset");
    const ruby = gltf({
      materialVariant: "Ruby",
      src: "/variant.glb",
      tint: [0.5, 1, 1, 1],
    });
    const unknown = gltf({ materialVariant: "Unknown", src: "/variant.glb" });
    const render = (node: typeof ruby) => prepareCanonicalSurfaceScene(
      scene({
        camera: perspectiveCamera({}),
        environment: studioEnvironment(),
        nodes: [node],
      }),
      () => asset,
    );

    expect(render(ruby).surfaces[0]!.material.baseColor).toEqual([0.45, 0.01, 0.03, 1]);
    expect(render(ruby).environment).toBeUndefined();
    expect(render(unknown).surfaces[0]!.material.baseColor).toEqual([0.2, 0.4, 0.8, 1]);
    expect(render(unknown).environment).toBeDefined();
  });

  it("applies equal glTF presentation tints through one shared material path", () => {
    const asset = prepareStaticGlb(staticTriangleGlb(), "tinted-asset");
    const first = gltf({ src: "/tinted.glb", tint: [0.5, 0.25, 2, 0.5] });
    const second = gltf({ src: "/tinted.glb", tint: [0.5, 0.25, 2, 0.5] });
    const prepared = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [first, second] }),
      () => asset,
    );

    expect(first.asset).toEqual(second.asset);
    expect(prepared.surfaces).toHaveLength(2);
    expect(prepared.surfaces[0]!.material).toMatchObject({
      alphaBlend: true,
      baseColor: [0.1, 0.1, 1.6, 0.5],
    });
    expect(prepared.surfaces[0]!.materialSource)
      .toBe(prepared.surfaces[1]!.materialSource);
  });

  it("shares one world-space LOD selection bound across authored levels", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "MSFT_lod"];
    document.extensionsUsed = ["KHR_materials_unlit", "MSFT_lod"];
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
      group: 0,
      levels: [0, 1],
      selectionBounds: { max: [12, 3, 0], min: [10, 1, -2] },
      surfaceIndices: [0, 1],
      thresholds: [0.5, 0],
    }]);
  });

  it("gives repeated mounts independent LOD occurrence identities", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "MSFT_lod"];
    document.extensionsUsed = ["KHR_materials_unlit", "MSFT_lod"];
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { MSFT_lod: { ids: [2] } };
    nodes[1]!.extras = { MSFT_screencoverage: [0.5, 0] };
    nodes.push({ mesh: 0, translation: [0, 2, -2] });
    const asset = prepareStaticGlb(staticTriangleGlb(document), "repeated-lod-asset");
    const left = gltf({ src: "/lod.glb" });
    const right = gltf({ src: "/lod.glb", transform: { position: [10, 0, 0] } });
    const prepared = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [left, right] }),
      () => asset,
    );

    expect(prepared.surfaces.map((surface) => surface.lods?.[0]?.group))
      .toEqual([
        0,
        0,
        1,
        1,
      ]);
    expect(prepared.lodGroups.map(({ group }) => group)).toEqual([0, 1]);
    expect(prepared.lodGroups.map((group) => group.selectionBounds)).toEqual([
      { max: [2, 3, 0], min: [0, 1, -2] },
      { max: [12, 3, 0], min: [10, 1, -2] },
    ]);
  });

  it("lowers selected material LOD levels onto the same geometry and selector ABI", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "MSFT_lod"];
    document.extensionsUsed = ["KHR_materials_unlit", "MSFT_lod"];
    const materials = document.materials as Array<Record<string, unknown>>;
    materials[0]!.extensions = { KHR_materials_unlit: {}, MSFT_lod: { ids: [1] } };
    materials[0]!.extras = { MSFT_screencoverage: [0.5, 0] };
    materials.push({
      pbrMetallicRoughness: { baseColorFactor: [0.05, 0.1, 0.2, 1] },
    });
    const asset = prepareStaticGlb(staticTriangleGlb(document), "material-lod-asset");
    const node = gltf({ src: "/material-lod.glb" });
    const prepared = prepareCanonicalSurfaceScene(
      scene({
        camera: perspectiveCamera({}),
        environment: studioEnvironment(),
        nodes: [node],
      }),
      () => asset,
    );

    expect(prepared.surfaces).toHaveLength(2);
    expect(prepared.surfaces[0]!.geometry).toBe(prepared.surfaces[1]!.geometry);
    expect(prepared.surfaces.map((surface) => surface.materialLodLevel))
      .toEqual([true, true]);
    expect(prepared.surfaces.map((surface) => surface.lods?.[0]?.level)).toEqual([0, 1]);
    expect(prepared.surfaces.map((surface) => surface.material.baseColor)).toEqual([
      [0.2, 0.4, 0.8, 1],
      [0.05, 0.1, 0.2, 1],
    ]);
    expect(prepared.surfaces.map((surface) => surface.material.kind))
      .toEqual(["unlit", "standard"]);
    expect(prepared.environment).toBeDefined();
    expect(prepared.lodGroups).toMatchObject([{
      group: 0,
      levels: [0, 1],
      surfaceIndices: [0, 1],
      thresholds: [0.5, 0],
    }]);
    expect(prepared.pickSurfaces).toHaveLength(2);
    expect(prepared.pickSurfaces.map((surface) => surface.lods?.[0]?.level)).toEqual([0, 1]);
    expect(prepared.pickSurfaces.map((surface) => surface.lods?.[0]?.group)).toEqual([0, 0]);
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
    expect(prepared.environment).toBeUndefined();
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
    document.extensionsRequired = ["KHR_lights_punctual"];
    document.extensionsUsed = ["KHR_lights_punctual"];
    const materials = document.materials as Array<Record<string, unknown>>;
    delete materials[0]!.extensions;
    document.extensions = {
      KHR_lights_punctual: { lights: [{ intensity: 3, type: "point" }] },
    };
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { KHR_lights_punctual: { light: 0 } };
    const asset = prepareStaticGlb(staticTriangleGlb(document), "lit-asset");
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const node = gltf({
      ref,
      src: "/lit.glb",
      transform: { position: [10, 0, 0] },
    });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [node],
    }), (candidate) => candidate === node ? asset : undefined);
    expect(prepared.punctualLights).toMatchObject([{
      color: [3, 3, 3, 1],
      kind: "point",
      position: [11, 2, 0],
    }]);

    const binding = updateCanonicalRenderObjectTransform(
      prepared,
      node,
      {
        position: [20, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      createCanonicalRenderObjectUpdateWorkspace(),
    );
    expect(binding?.lights).toHaveLength(1);
    expect(prepared.punctualLights[0]!.position).toEqual([21, 2, 0]);
    expect(prepared.surfaces[0]!.model[12]).toBe(21);
  });

  it("retains the instance sources whose pose changes require light relowering", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_lights_punctual"];
    document.extensionsUsed = ["KHR_lights_punctual"];
    const materials = document.materials as Array<Record<string, unknown>>;
    delete materials[0]!.extensions;
    document.extensions = {
      KHR_lights_punctual: { lights: [{ intensity: 3, type: "point" }] },
    };
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { KHR_lights_punctual: { light: 0 } };
    const asset = prepareStaticGlb(staticTriangleGlb(document), "instanced-light-asset");
    const transforms = createGltfInstanceTransforms({ count: 2 });
    const node = gltfInstances({
      instances: transforms,
      src: "/instanced-light.glb",
    });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [node],
    }), () => asset);

    expect(prepared.instanceLightSources.has(transforms)).toBe(true);
  });

  it("erases glTF lights and environment state when selected materials are unlit", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "KHR_lights_punctual"];
    document.extensionsUsed = ["KHR_materials_unlit", "KHR_lights_punctual"];
    document.extensions = {
      KHR_lights_punctual: { lights: [{ intensity: 3, type: "point" }] },
    };
    const nodes = document.nodes as Array<Record<string, unknown>>;
    nodes[1]!.extensions = { KHR_lights_punctual: { light: 0 } };
    const asset = prepareStaticGlb(staticTriangleGlb(document), "unlit-light-asset");
    const node = gltf({ src: "/unlit-light.glb" });
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      environment: studioEnvironment(),
      nodes: [node],
    }), () => asset);

    expect(prepared.surfaces[0]!.material.kind).toBe("unlit");
    expect(prepared.environment).toBeUndefined();
    expect(prepared.punctualLights).toEqual([]);
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
    expect(prepared.environment?.rotated).toBe(true);
    expect(prepared.environment?.radianceScaleNits).toBe(25);
    expect(prepared.environment?.rotation).toHaveLength(16);
  });

  it("retains prefiltered environment identity without transport or GL work", () => {
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      environment: prefilteredEnvironment({ src: "/studio.ktx", version: "v2" }),
      nodes: [mesh({
        geometry: planeGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
      })],
    }));

    expect(prepared.environment).toMatchObject({
      source: "royal-prefiltered-v1",
      src: "/studio.ktx",
      rotated: false,
      version: "v2",
    });
    expect(prepared.environment?.rotation).toHaveLength(16);
  });
});
