import { describe, expect, it, vi } from "vitest";
import { prefilteredEnvironment, studioEnvironment } from "@royal/renderer-core";
import { identityMat4 } from "../packages/renderer-webgl/src/math/mat4";
import {
  hasGltfAssetLights,
  SurfaceLightResolver,
  type GltfSurfaceLightSource,
} from "../packages/renderer-webgl/src/surface-light-resolver";
import { surfaceLightSet, type SurfaceLight } from "../packages/renderer-webgl/src/webgl/lights";

const texture = {} as WebGLTexture;
const directional: SurfaceLight = {
  color: [1, 1, 1, 1],
  direction: [0, -1, 0],
  kind: "directional",
};

const state = (): GltfSurfaceLightSource => ({
  imageBasedLight: {
    coefficients: [[1, 0, 0]],
    intensity: 2,
    rotation: identityMat4(),
    specular: {
      encoding: "rgbd",
      imageLoadKeys: [],
      imageSize: 16,
      key: "ibl:gltf",
    },
  },
  lights: [directional],
});

describe("SurfaceLightResolver", () => {
  it("classifies optional glTF light content without resolving a root", () => {
    expect(hasGltfAssetLights({ lights: [] })).toBe(false);
    expect(hasGltfAssetLights({ lights: [directional] })).toBe(true);
    expect(hasGltfAssetLights(state())).toBe(true);
  });

  it("preserves compiled scene lights without an environment and resolves studio IBL", () => {
    const studioResource = {
      key: "ibl:studio",
      mipCount: 4,
      texture,
    };
    const studioSpecular = vi.fn(() => studioResource);
    const resolver = new SurfaceLightResolver({
      ensureGltfSpecular: vi.fn(),
      resolvePrefilteredEnvironment: vi.fn(),
      studioSpecular,
    });
    const compiled = surfaceLightSet([directional]);

    expect(resolver.resolveScene(undefined, compiled.lights, compiled)).toBe(compiled);
    expect(studioSpecular).not.toHaveBeenCalled();

    const environment = studioEnvironment({ radianceScaleNits: 3, rotation: [0, 0, 0] });
    const resolved = resolver.resolveScene(
      environment,
      compiled.lights,
      compiled,
    );
    expect(resolved).toMatchObject({
      directionals: [directional],
      irradiance: { intensity: 3 },
      specular: {
        encoding: "linear",
        intensity: 3,
        key: "ibl:studio",
        mipCount: 4,
        texture,
      },
    });
    expect(resolver.resolveScene(environment, compiled.lights, compiled)).toBe(resolved);
    expect(studioSpecular).toHaveBeenCalledTimes(2);

    resolver.clear();
    expect(resolver.resolveScene(environment, compiled.lights, compiled)).not.toBe(resolved);
  });

  it("uses a prefiltered artifact only after its diffuse data is available", () => {
    const environment = prefilteredEnvironment({ src: "/warehouse.royal.ktx" });
    const coefficients = [
      [0.5, 0.25, 0.125], [0, 0, 0], [0, 0, 0],
      [0, 0, 0], [0, 0, 0], [0, 0, 0],
      [0, 0, 0], [0, 0, 0], [0, 0, 0],
    ] as const;
    let ready = false;
    const resolvePrefilteredEnvironment = vi.fn(() => ready ? {
      coefficients,
      specular: { key: "environment:warehouse", mipCount: 9, texture },
    } : undefined);
    const studioSpecular = vi.fn();
    const compiled = surfaceLightSet([directional]);
    const resolver = new SurfaceLightResolver({
      ensureGltfSpecular: vi.fn(),
      resolvePrefilteredEnvironment,
      studioSpecular,
    });

    expect(resolver.resolveScene(environment, compiled.lights, compiled)).toBe(compiled);
    ready = true;
    expect(resolver.resolveScene(environment, compiled.lights, compiled)).toMatchObject({
      irradiance: { coefficients, intensity: 1 },
      specular: {
        encoding: "linear",
        key: "environment:warehouse",
        mipCount: 9,
        texture,
      },
    });
    expect(studioSpecular).not.toHaveBeenCalled();

    resolver.resolveScene(undefined, compiled.lights, compiled);
    expect(resolvePrefilteredEnvironment).toHaveBeenLastCalledWith(undefined);
  });

  it("resolves transformed glTF lights and exposes specular only after upload", () => {
    let uploaded = false;
    const ensureGltfSpecular = vi.fn(() => uploaded
      ? {
          imageSize: 16,
          key: "ibl:gltf",
          mipCount: 5,
          texture,
          uploadCursor: 6,
          uploaded: true as const,
        }
      : {
          imageSize: 16,
          key: "ibl:gltf",
          mipCount: 5,
          uploadCursor: 0,
          uploaded: false as const,
        });
    const resolver = new SurfaceLightResolver({
      ensureGltfSpecular,
      resolvePrefilteredEnvironment: vi.fn(),
      studioSpecular: vi.fn(),
    });
    const source = state();
    const rootModel = identityMat4();

    const pending = resolver.resolveGltfAsset(source, rootModel);
    expect(pending).toMatchObject({ irradiance: { intensity: 2 }, lights: [directional] });
    expect(pending?.specular).toBeUndefined();
    const transformedLight = pending?.lights[0];
    const worldToIbl = pending?.irradiance?.worldToIbl;

    uploaded = true;
    const ready = resolver.resolveGltfAsset(source, rootModel);
    expect(ready).toBe(pending);
    expect(ready?.lights[0]).toBe(transformedLight);
    expect(ready?.irradiance?.worldToIbl).toBe(worldToIbl);
    expect(ready?.specular).toMatchObject({
      encoding: "rgbd",
      intensity: 2,
      key: "ibl:gltf",
      mipCount: 5,
      texture,
    });
    expect(ensureGltfSpecular).toHaveBeenCalledTimes(2);
  });

  it("owns stable glTF light-scope identity and resets it on clear", () => {
    const resolver = new SurfaceLightResolver({
      ensureGltfSpecular: vi.fn(),
      resolvePrefilteredEnvironment: vi.fn(),
      studioSpecular: vi.fn(),
    });

    const first = surfaceLightSet([directional]);
    const second = surfaceLightSet([directional]);
    expect(resolver.gltfScopeId(first)).toBe(1);
    expect(resolver.gltfScopeId(first)).toBe(1);
    expect(resolver.gltfScopeId(second)).toBe(2);
    resolver.clear();
    expect(resolver.gltfScopeId(second)).toBe(1);
  });
});
