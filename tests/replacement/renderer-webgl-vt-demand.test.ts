import { describe, expect, it } from "vitest";
import { perspectiveCamera } from "../../packages/renderer-core/src/camera";
import { IDENTITY_TEXTURE_COORDINATES } from "../../packages/renderer-webgl/src/gltf/texture-coordinates";
import {
  identityMat4,
  projectionMat4,
} from "../../packages/renderer-webgl/src/math/mat4";
import { prepareCanonicalGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import type { CanonicalTextureSampler } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { transformedWorldBounds } from "../../packages/renderer-webgl/src/surface/surface-visibility";
import {
  collectVirtualTextureDemand,
  createVirtualTextureDemandWorkspace,
  resetVirtualTextureDemand,
  truncateVirtualTextureDemand,
} from "../../packages/renderer-webgl/src/virtual-texture/demand";
import { parseVirtualTextureManifest } from "../../packages/renderer-webgl/src/virtual-texture/manifest";

const manifest = parseVirtualTextureManifest({
  borderTexels: 1,
  contractVersion: 2,
  mipCount: 3,
  pageSize: 256,
  pages: { uriTemplate: "{mip}/{x}/{y}.png" },
  virtualSize: [1024, 1024],
});
const sampler: CanonicalTextureSampler = {
  magFilter: "linear",
  minFilter: "linear-mipmap-linear",
  wrapS: "clamp-to-edge",
  wrapT: "clamp-to-edge",
};
const surfaceGeometry = prepareCanonicalGeometry({ kind: "plane", size: [1, 1] }, true);
const surfaceModel = identityMat4();
const surface = {
  geometry: surfaceGeometry,
  model: surfaceModel,
  textureCoordinates: IDENTITY_TEXTURE_COORDINATES,
  worldBounds: transformedWorldBounds(surfaceGeometry.bounds, surfaceModel),
};
const view = (projection = identityMat4()) => ({
  viewProjection: projection,
  viewport: { height: 1024, width: 1024, x: 0, y: 0 },
});

describe("VT2 clipped projected demand", () => {
  it("requests finer pages as visible texel density increases", () => {
    const workspace = createVirtualTextureDemandWorkspace(64);
    collectVirtualTextureDemand(workspace, manifest, [surface], [view()], sampler);
    const ordinaryCount = workspace.count;
    resetVirtualTextureDemand(workspace);
    const close = identityMat4();
    close[0] = 2;
    close[5] = 2;
    collectVirtualTextureDemand(workspace, manifest, [surface], [view(close)], sampler);
    expect(workspace.count).toBeGreaterThan(ordinaryCount);
    expect(Array.from(workspace.mips.slice(0, workspace.count))).toContain(0);
    expect(workspace.overflow).toBe(false);
  });

  it("unions stereo demand and keeps every capacity prefix ancestor-first", () => {
    const mono = createVirtualTextureDemandWorkspace(64);
    const left = identityMat4();
    left[12] = -0.8;
    collectVirtualTextureDemand(mono, manifest, [surface], [view(left)], sampler);
    const monoCount = mono.count;
    const stereo = createVirtualTextureDemandWorkspace(64);
    const right = identityMat4();
    right[12] = 0.8;
    collectVirtualTextureDemand(stereo, manifest, [surface], [view(left), view(right)], sampler);
    expect(stereo.count).toBeGreaterThanOrEqual(monoCount);
    expect(stereo.mips[0]).toBe(manifest.mipCount - 1);
  });

  it("bounds close and repeated demand without losing the coarsest fallback", () => {
    const workspace = createVirtualTextureDemandWorkspace(3);
    const repeating: CanonicalTextureSampler = { ...sampler, wrapS: "repeat", wrapT: "repeat" };
    const coordinates = {
      row0: [8, 0, 0, 0] as const,
      row1: [0, 8, 0, 0] as const,
    };
    const close = identityMat4();
    close[0] = 16;
    close[5] = 16;
    collectVirtualTextureDemand(
      workspace,
      manifest,
      [{ ...surface, textureCoordinates: coordinates }],
      [view(close)],
      repeating,
    );
    expect(workspace.count).toBe(3);
    expect(workspace.overflow).toBe(true);
    expect(workspace.mips[0]).toBe(manifest.mipCount - 1);
  });

  it("localizes fine demand on a large oblique ground plane", () => {
    const groundManifest = parseVirtualTextureManifest({
      borderTexels: 1,
      contractVersion: 2,
      mipCount: 4,
      pageSize: 256,
      pages: { uriTemplate: "{mip}/{x}/{y}.png" },
      virtualSize: [2048, 2048],
    });
    const geometry = {
      bounds: { max: [0.4, 0.4, -1] as const, min: [-0.4, -0.4, -8] as const },
      indices: new Uint8Array([0, 1, 2, 0, 2, 3]),
      key: "oblique-ground",
      positions: new Float32Array([
        -0.4, -0.4, -1,
        0.4, -0.4, -1,
        0.4, 0.4, -8,
        -0.4, 0.4, -8,
      ]),
      textureCoordinates0: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    };
    const model = identityMat4();
    const camera = perspectiveCamera({
      far: 100,
      fovY: Math.PI / 3,
      near: 0.05,
    });
    const projection = projectionMat4(camera, 4096, 4096);
    const workspace = createVirtualTextureDemandWorkspace(128);
    collectVirtualTextureDemand(workspace, groundManifest, [{
      geometry,
      model,
      textureCoordinates: IDENTITY_TEXTURE_COORDINATES,
      worldBounds: transformedWorldBounds(geometry.bounds, model),
    }], [{
      viewProjection: projection,
      viewport: { height: 4096, width: 4096, x: 0, y: 0 },
    }], sampler);

    const requestedMips = Array.from(workspace.mips.slice(0, workspace.count));
    expect(requestedMips).toContain(0);
    expect(requestedMips).toContain(groundManifest.mipCount - 1);
    expect(requestedMips.filter((mip) => mip === 0).length).toBeLessThan(32);
    expect(workspace.count).toBeLessThan(48);
  });

  it("clips an oblique surface through the near plane without losing close demand", () => {
    const camera = perspectiveCamera({ far: 20, near: 0.05 });
    const geometry = {
      bounds: { max: [0.4, 0.4, -0.01] as const, min: [-0.4, -0.4, -2] as const },
      indices: new Uint8Array([0, 1, 2, 0, 2, 3]),
      key: "near-plane-ground",
      positions: new Float32Array([
        -0.02, -0.02, -0.01,
        0.02, -0.02, -0.01,
        0.4, 0.4, -2,
        -0.4, 0.4, -2,
      ]),
      textureCoordinates0: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    };
    const workspace = createVirtualTextureDemandWorkspace(64);
    collectVirtualTextureDemand(workspace, manifest, [{
      geometry,
      model: identityMat4(),
      textureCoordinates: IDENTITY_TEXTURE_COORDINATES,
      worldBounds: geometry.bounds,
    }], [{
      viewProjection: projectionMat4(camera, 1024, 1024),
      viewport: { height: 1024, width: 1024, x: 0, y: 0 },
    }], sampler);

    expect(workspace.count).toBeGreaterThan(1);
    expect(Array.from(workspace.mips.slice(0, workspace.count))).toContain(0);
    expect(workspace.overflow).toBe(false);
  });

  it("fits protection by dropping complete fine levels", () => {
    const workspace = createVirtualTextureDemandWorkspace(64);
    const close = identityMat4();
    close[0] = 16;
    close[5] = 16;
    collectVirtualTextureDemand(workspace, manifest, [surface], [view(close)], sampler);
    expect(workspace.count).toBeGreaterThan(4);

    truncateVirtualTextureDemand(workspace, 4);
    expect(workspace.count).toBeLessThanOrEqual(4);
    expect(workspace.keys.size).toBe(workspace.count);
    expect(workspace.mips[0]).toBe(manifest.mipCount - 1);
    expect(new Set(workspace.mips.slice(0, workspace.count))).toEqual(new Set([2]));
    expect(workspace.overflow).toBe(true);
  });

  it("falls back to the coarsest page for non-finite authored coverage", () => {
    const workspace = createVirtualTextureDemandWorkspace(8);
    const malformed = {
      ...surface,
      geometry: {
        ...surface.geometry,
        textureCoordinates0: new Float32Array([Number.NaN, 0, 1, 0, 1, 1, 0, 1]),
      },
    };
    collectVirtualTextureDemand(workspace, manifest, [malformed], [view()], sampler);
    expect(workspace.count).toBe(1);
    expect(workspace.mips[0]).toBe(manifest.mipCount - 1);
    expect(workspace.xs[0]).toBe(0);
    expect(workspace.ys[0]).toBe(0);
  });

  it("rejects offscreen surfaces before visiting malformed triangle channels", () => {
    const workspace = createVirtualTextureDemandWorkspace(8);
    const malformed = {
      ...surface,
      geometry: {
        ...surface.geometry,
        textureCoordinates0: new Float32Array([Number.NaN, 0, 1, 0, 1, 1, 0, 1]),
      },
      worldBounds: { max: [11, 1, 0] as const, min: [10, -1, 0] as const },
    };

    collectVirtualTextureDemand(workspace, manifest, [malformed], [view()], sampler);

    expect(workspace.count).toBe(0);
  });

  it("trivially rejects offscreen triangles inside a partly visible surface", () => {
    const insideGeometry = {
      ...surface.geometry,
      indices: new Uint8Array([0, 1, 2]),
      positions: new Float32Array([
        -0.5, -0.5, 0,
        0.5, -0.5, 0,
        0.5, 0.5, 0,
      ]),
      textureCoordinates0: new Float32Array([0, 0, 1, 0, 1, 1]),
    };
    const mixedGeometry = {
      ...insideGeometry,
      bounds: { max: [11, 1, 0] as const, min: [-0.5, -0.5, 0] as const },
      indices: new Uint8Array([0, 1, 2, 3, 4, 5]),
      positions: new Float32Array([
        ...insideGeometry.positions,
        10, -0.5, 0,
        11, -0.5, 0,
        11, 0.5, 0,
      ]),
      textureCoordinates0: new Float32Array([
        ...insideGeometry.textureCoordinates0,
        0, 0, 1, 0, 1, 1,
      ]),
    };
    const inside = createVirtualTextureDemandWorkspace(64);
    collectVirtualTextureDemand(
      inside,
      manifest,
      [{ ...surface, geometry: insideGeometry }],
      [view()],
      sampler,
    );
    const mixed = createVirtualTextureDemandWorkspace(64);
    collectVirtualTextureDemand(
      mixed,
      manifest,
      [{ ...surface, geometry: mixedGeometry, worldBounds: mixedGeometry.bounds }],
      [view()],
      sampler,
    );
    expect([...mixed.keys]).toEqual([...inside.keys]);
  });

  it("keeps instanced demand identical when the extra instances are offscreen", () => {
    const visibleOnly = createVirtualTextureDemandWorkspace(64);
    collectVirtualTextureDemand(visibleOnly, manifest, [surface], [view()], sampler);
    const localModels = new Float32Array(32);
    localModels.set(identityMat4(), 0);
    const offscreen = identityMat4();
    offscreen[12] = 100;
    localModels.set(offscreen, 16);
    const instanced = createVirtualTextureDemandWorkspace(64);
    collectVirtualTextureDemand(
      instanced,
      manifest,
      [{ ...surface, instances: { count: 2, localModels } }],
      [view()],
      sampler,
    );
    expect([...instanced.keys]).toEqual([...visibleOnly.keys]);
  });
});
