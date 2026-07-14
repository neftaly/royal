import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  defineCoordinateSystem,
  imageTexture,
  linearRgbaFromSrgb,
  metresPerWorldUnit,
  mesh,
  orthographicCamera,
  perspectiveCamera,
  scene,
  standardMaterial,
  textureAsset,
  virtualTexture,
  type GltfInstancesPickTarget,
  type GltfPickTarget,
  type MeshPickTarget,
  type PickTarget,
  type VirtualTextureAssetRef,
} from "@royal/renderer-core";
import * as rendererCore from "@royal/renderer-core";
import * as webglApi from "@royal/renderer-webgl";
import * as reactRoyal from "@royal/react";
import * as reactSceneApi from "@royal/react/scene";

describe("renderer-core public API", () => {
  it("defines one Royal world unit as one metre", () => {
    expect(metresPerWorldUnit).toBe(1);

    const metreCube = boxGeometry(1);
    const camera = perspectiveCamera({
      far: 100,
      fovY: Math.PI / 4,
      near: 0.1,
      position: [0, 0, 5],
      rotation: [0, 0, 0],
    });

    expect(metreCube.size).toEqual([1, 1, 1]);
    expect(camera.position[2]).toBe(5);
    expect(camera.near).toBe(0.1);

    const orbitTarget: import("@royal/renderer-core").WorldPosition3 = [1, 2, 3];
    const reactOrbitTarget: import("@royal/react").WorldPosition3 = orbitTarget;
    expect(reactOrbitTarget).toEqual([1, 2, 3]);
  });

  it("accepts only metre coordinate systems", () => {
    expect(defineCoordinateSystem({
      forward: { axis: "z", sign: -1 },
      handedness: "right",
      unit: "meter",
      up: { axis: "y", sign: 1 },
    }).unit).toBe("meter");

    expect(() => defineCoordinateSystem({
      forward: { axis: "z", sign: -1 },
      handedness: "right",
      unit: "unit",
      up: { axis: "y", sign: 1 },
    } as unknown as import("@royal/renderer-core").CoordinateSystem))
      .toThrow("Coordinate system unit must be meter");
  });

  it("defaults orthographic camera pose and depth for flat UI scenes", () => {
    expect(orthographicCamera({
      bottom: -1,
      left: -2,
      right: 2,
      top: 1,
    })).toEqual({
      bottom: -1,
      far: 1000,
      kind: "orthographic-camera",
      left: -2,
      near: -1000,
      position: [0, 0, 0],
      right: 2,
      rotation: [0, 0, 0],
      top: 1,
    });
  });

  it("provides concise, normalized camera and transform defaults", () => {
    expect(perspectiveCamera({})).toEqual({
      far: 1000,
      fovY: Math.PI / 4,
      kind: "perspective-camera",
      near: 0.1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    });

    expect(mesh({
      geometry: boxGeometry(1),
      material: standardMaterial({ color: [1, 1, 1, 1] }),
      transform: { position: [2, 0, 0] },
    }).transform).toEqual({
      position: [2, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
  });

  it("makes conversion from artist-authored sRGB to scene-linear color explicit", () => {
    const color: import("@royal/renderer-core").LinearRgba = linearRgbaFromSrgb([0.5, 0.25, 1, 0.75]);
    expect(color[0]).toBeCloseTo(0.214041, 5);
    expect(color[1]).toBeCloseTo(0.050876, 5);
    expect(color[2]).toBe(1);
    expect(color[3]).toBe(0.75);
    expect(Object.isFrozen(color)).toBe(true);
  });

  it("builds plain render descriptors without backend state", () => {
    const camera = perspectiveCamera({
      far: 100,
      fovY: Math.PI / 4,
      near: 0.1,
      position: [0, 0, 5],
      rotation: [0, 0, 0],
    });
    const texture = imageTexture("/crate.png");
    const cube = mesh({
      geometry: boxGeometry(1),
      material: standardMaterial({ texture }),
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
    });
    const root = scene({
      camera,
      nodes: [cube],
    });

    expect(root).toEqual({
      camera,
      clearColor: [0, 0, 0, 0],
      kind: "scene",
      nodes: [cube],
    });
    expect(cube.material.baseColor).toMatchObject({
      kind: "asset",
      uri: "/crate.png",
    });
  });

  it("preserves public texture orientation and narrows virtual textures", () => {
    expect(textureAsset({ flipY: false, src: "/mask.png" })).toMatchObject({ flipY: false });
    expect(imageTexture({ flipY: false, src: "/albedo.png" })).toMatchObject({ flipY: false });
    const virtual: VirtualTextureAssetRef = virtualTexture({
      flipY: false,
      src: "/terrain.vt.json",
    });
    expect(virtual).toMatchObject({ flipY: false, kind: "virtual-asset" });
  });

  it("keeps React as an adapter instead of a renderer-core barrel", () => {
    expect(Object.keys(reactRoyal).sort()).toEqual([
      "Canvas",
      "DEFAULT_RESOURCE_GOVERNOR_POLICY",
      "OrbitControls",
      "createRendererRoot",
      "defineResourceGovernorPolicy",
      "useCanvasElement",
      "useCanvasPick",
      "useCanvasRoot",
      "useFrame",
      "useGltfAssetStatus",
      "useInvalidate",
      "useOrbitCamera",
      "useOrbitCameraView",
      "useRendererLifecycle",
    ]);
  });

  it("exposes scene primitives from the React scene subpath", () => {
    expect(reactSceneApi.metresPerWorldUnit).toBe(1);
    expect(reactSceneApi).toHaveProperty("boxGeometry");
    expect(reactSceneApi).toHaveProperty("linearRgbaFromSrgb");
    expect(reactSceneApi).toHaveProperty("mesh");
    expect(reactSceneApi).toHaveProperty("scene");
    expect(reactSceneApi).toHaveProperty("solidTexture");
    expect(reactSceneApi).toHaveProperty("textureAsset");
    expect(reactSceneApi).not.toHaveProperty("pass");
    expect(reactSceneApi).not.toHaveProperty("Canvas");
    expect(reactSceneApi).not.toHaveProperty("useInvalidate");

    const solid: import("@royal/react/scene").SolidTextureRef =
      reactSceneApi.solidTexture({ color: [1, 0, 0, 1] });
    const asset: import("@royal/react/scene").TextureAssetRef =
      reactSceneApi.textureAsset({ src: "/albedo.png" });
    expect([solid.kind, asset.kind]).toEqual(["solid", "asset"]);
  });

  it("keeps internal texture helpers out of the renderer-core barrel", () => {
    expect(rendererCore).not.toHaveProperty("virtualTextureAsset");

    if (false) {
      // @ts-expect-error virtualTextureAsset is an internal texture helper.
      rendererCore.virtualTextureAsset;
    }
  });

  it("keeps public facades narrow at package boundaries", () => {
    expect(webglApi).toHaveProperty("createWebGlRoot");
    expect(webglApi).not.toHaveProperty("WebGlRoot");

    if (false) {
      const root: import("@royal/renderer-webgl").WebGlRoot = webglApi.createWebGlRoot(
        null as unknown as HTMLCanvasElement,
      );
      const samePublicType: ReturnType<typeof webglApi.createWebGlRoot> = root;
      void samePublicType;
      // @ts-expect-error WebGlRoot is a factory-created handle type, not a public constructor.
      webglApi.WebGlRoot;
    }
  });

  it("narrows pick targets by kind", () => {
    const pickTargetKind = (target: PickTarget) => {
      if (target.kind === "mesh") {
        const meshTarget: MeshPickTarget = target;
        return meshTarget.node.geometry.kind;
      }

      if (target.kind === "gltf-instances") {
        const instancesTarget: GltfInstancesPickTarget = target;
        return `${instancesTarget.node.asset.uri}:${instancesTarget.instanceIndex}`;
      }

      const gltfTarget: GltfPickTarget = target;
      return gltfTarget.node.asset.uri;
    };

    expect(typeof pickTargetKind).toBe("function");
  });

});
