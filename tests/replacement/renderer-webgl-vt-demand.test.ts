import { describe, expect, it } from "vitest";
import { IDENTITY_TEXTURE_COORDINATES } from "../../packages/renderer-webgl/src/gltf/texture-coordinates";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { prepareCanonicalGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import type { CanonicalTextureSampler } from "../../packages/renderer-webgl/src/surface/canonical-material";
import {
  collectVirtualTextureSurfaceDemand,
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
const surface = {
  geometry: prepareCanonicalGeometry({ kind: "plane", size: [1, 1] }, true),
  model: identityMat4(),
  textureCoordinates: IDENTITY_TEXTURE_COORDINATES,
};
const view = (projection = identityMat4()) => ({
  viewProjection: projection,
  viewport: { height: 1024, width: 1024, x: 0, y: 0 },
});

describe("VT2 clipped projected demand", () => {
  it("requests finer pages as visible texel density increases", () => {
    const workspace = createVirtualTextureDemandWorkspace(64);
    collectVirtualTextureSurfaceDemand(workspace, manifest, surface, [view()], sampler);
    const ordinaryCount = workspace.count;
    resetVirtualTextureDemand(workspace);
    const close = identityMat4();
    close[0] = 2;
    close[5] = 2;
    collectVirtualTextureSurfaceDemand(workspace, manifest, surface, [view(close)], sampler);
    expect(workspace.count).toBeGreaterThan(ordinaryCount);
    expect(Array.from(workspace.mips.slice(0, workspace.count))).toContain(0);
    expect(workspace.overflow.value).toBe(false);
  });

  it("unions stereo demand and keeps every capacity prefix ancestor-first", () => {
    const mono = createVirtualTextureDemandWorkspace(64);
    const left = identityMat4();
    left[12] = -0.8;
    collectVirtualTextureSurfaceDemand(mono, manifest, surface, [view(left)], sampler);
    const monoCount = mono.count;
    const stereo = createVirtualTextureDemandWorkspace(64);
    const right = identityMat4();
    right[12] = 0.8;
    collectVirtualTextureSurfaceDemand(stereo, manifest, surface, [view(left), view(right)], sampler);
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
    collectVirtualTextureSurfaceDemand(
      workspace,
      manifest,
      { ...surface, textureCoordinates: coordinates },
      [view(close)],
      repeating,
    );
    expect(workspace.count).toBe(3);
    expect(workspace.overflow.value).toBe(true);
    expect(workspace.mips[0]).toBe(manifest.mipCount - 1);
  });

  it("truncates protection to one drawable physical-capacity prefix", () => {
    const workspace = createVirtualTextureDemandWorkspace(64);
    const close = identityMat4();
    close[0] = 16;
    close[5] = 16;
    collectVirtualTextureSurfaceDemand(workspace, manifest, surface, [view(close)], sampler);
    expect(workspace.count).toBeGreaterThan(4);

    truncateVirtualTextureDemand(workspace, 4);
    expect(workspace.count).toBe(4);
    expect(workspace.keys.size).toBe(4);
    expect([...workspace.keys.values()].every((index) => index < 4)).toBe(true);
    expect(workspace.mips[0]).toBe(manifest.mipCount - 1);
    expect(workspace.overflow.value).toBe(true);
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
    collectVirtualTextureSurfaceDemand(workspace, manifest, malformed, [view()], sampler);
    expect(workspace.count).toBe(1);
    expect(workspace.mips[0]).toBe(manifest.mipCount - 1);
    expect(workspace.xs[0]).toBe(0);
    expect(workspace.ys[0]).toBe(0);
  });
});
