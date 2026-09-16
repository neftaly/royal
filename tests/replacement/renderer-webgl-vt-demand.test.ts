import { describe, expect, it } from "vitest";
import { perspectiveCamera } from "../../packages/renderer-core/src/camera";
import { IDENTITY_TEXTURE_COORDINATES } from "../../packages/renderer-webgl/src/surface/texture-coordinates";
import {
  identityMat4,
  projectionMat4,
} from "../../packages/renderer-webgl/src/math/mat4";
import { prepareCanonicalGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import type { CanonicalTextureSampler } from "../../packages/renderer-webgl/src/texture/sampler";
import { transformedWorldBounds } from "../../packages/renderer-webgl/src/surface/surface-visibility";
import {
  collectVirtualTextureDemand,
  createVirtualTextureDemandWorkspace,
  resetVirtualTextureDemand,
  truncateVirtualTextureDemand,
} from "../../packages/renderer-webgl/src/virtual-texture/demand";
import { parseVirtualTextureManifest } from "../../packages/renderer-webgl/src/virtual-texture/manifest";
import { virtualTextureFootprintSquared } from "../../packages/renderer-webgl/src/virtual-texture/footprint";

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
  it("uses the minor ellipse axis with a bounded anisotropy ratio, including rotated and sheared footprints", () => {
    expect(virtualTextureFootprintSquared(16, 0, 0, 2, 1)).toBe(256);
    expect(virtualTextureFootprintSquared(16, 0, 0, 2, 4)).toBe(16);
    expect(virtualTextureFootprintSquared(16, 0, 0, 2, 16)).toBe(4);
    const r = Math.SQRT1_2;
    expect(virtualTextureFootprintSquared(16 * r, 16 * r, -2 * r, 2 * r, 16)).toBeCloseTo(4);
    expect(virtualTextureFootprintSquared(16 * r, 2 * r, -16 * r, 2 * r, 16)).toBeCloseTo(4);
    // Parallel derivatives form a degenerate ellipse but retain the ratio cap.
    expect(virtualTextureFootprintSquared(16, 0, 16, 0, 16)).toBe(2);
    expect(virtualTextureFootprintSquared(0, 0, 0, 0, 16)).toBe(0);
  });

  it("requests finer oblique detail, preserves face-on demand and still respects budget coarsening", () => {
    const source = parseVirtualTextureManifest({ borderTexels: 2, contractVersion: 2, pageSize: 128,
      pages: { uriTemplate: "{mip}/{x}/{y}.png" }, virtualSize: [4096, 4096] });
    const isotropic = createVirtualTextureDemandWorkspace(512, "coarsest");
    const anisotropic = createVirtualTextureDemandWorkspace(512, "coarsest");
    collectVirtualTextureDemand(isotropic, source, [surface], [view()], sampler, 0, 1);
    collectVirtualTextureDemand(anisotropic, source, [surface], [view()], sampler, 0, 16);
    expect(anisotropic.keys).toEqual(isotropic.keys);
    resetVirtualTextureDemand(isotropic); resetVirtualTextureDemand(anisotropic);
    const tilted = identityMat4(); tilted[5] = 0.125;
    collectVirtualTextureDemand(isotropic, source, [surface], [view(tilted)], sampler, 0, 1);
    collectVirtualTextureDemand(anisotropic, source, [surface], [view(tilted)], sampler, 0, 16);
    expect(Math.min(...anisotropic.mips.slice(0, anisotropic.count))).toBe(3);
    expect(Math.min(...isotropic.mips.slice(0, isotropic.count))).toBe(5);
    expect(anisotropic.count).toBeGreaterThan(isotropic.count);
    truncateVirtualTextureDemand(anisotropic, 8);
    expect(anisotropic.count).toBeLessThanOrEqual(8);
    resetVirtualTextureDemand(anisotropic);
    collectVirtualTextureDemand(anisotropic, source, [surface], [view(tilted)], sampler, 4, 16);
    expect([...anisotropic.mips.slice(0, anisotropic.count)].every(mip => mip >= 4)).toBe(true);
  });

  it.each(["clamp-to-edge", "repeat", "mirrored-repeat"] as const)("includes directional taps across page and %s boundaries", (wrapS) => {
    const source = parseVirtualTextureManifest({ borderTexels: 2, contractVersion: 2, pageSize: 128,
      pages: { uriTemplate: "{mip}/{x}/{y}.png" }, virtualSize: [1024, 1024] });
    const workspace = createVirtualTextureDemandWorkspace(128, "coarsest");
    const slice = { ...surface, textureCoordinates: {
      row0: [0.4998, 0, 0.0001, 0] as const, row1: [0, 1, 0, 0] as const,
    } };
    const narrow = { ...view(), viewport: { ...view().viewport, width: 32 } };
    collectVirtualTextureDemand(workspace, source, [slice], [narrow], { ...sampler, wrapS, minFilter: "linear-mipmap-nearest" }, 0, 16);
    const columns = [...workspace.xs.slice(0, workspace.count)].filter((_, index) => workspace.mips[index] === 1);
    expect(columns).toContain(2); // Tap past U = 0.5 leaves the triangle's page range.
    if (wrapS === "repeat") expect(columns).toContain(3); // Tap below U = 0 wraps to the last page.
    else expect(columns).not.toContain(3);
    for (let index = 0; index < workspace.count; index++) {
      const layout = source.mipLayouts[workspace.mips[index]!]!;
      expect(workspace.xs[index]).toBeLessThan(layout.width);
      expect(workspace.ys[index]).toBeLessThan(layout.height);
    }
    expect(workspace.overflow).toBe(false);
  });

  it("accumulates bounded visible contribution and preserves it through coarsening", () => {
    const workspace = createVirtualTextureDemandWorkspace(64, "coarsest");
    collectVirtualTextureDemand(workspace, manifest, [surface], [view()], sampler);
    const total = () => [...workspace.keys].reduce<number>((sum, key) => sum + (workspace.importance.get(key) ?? 0), 0);
    const once = total();
    expect(once).toBeGreaterThan(0);
    collectVirtualTextureDemand(workspace, manifest, [surface], [view()], sampler);
    expect(total()).toBeGreaterThan(once);
    const before = total();
    truncateVirtualTextureDemand(workspace, 1);
    expect(total()).toBeCloseTo(before);
    expect(workspace.importance.size).toBe(1);
    resetVirtualTextureDemand(workspace);
    expect(workspace.importance.size).toBe(0);
  });
  it("stops a discarded overflow pass but visits every surface on the coarser retry", () => {
    let visits = 0;
    const later = { ...surface, get geometry() { visits += 1; return surfaceGeometry; } };
    const workspace = createVirtualTextureDemandWorkspace(1);
    collectVirtualTextureDemand(workspace, manifest, [surface, later], [view()], sampler);
    expect(workspace.overflow).toBe(true);
    expect(visits).toBe(0);
    resetVirtualTextureDemand(workspace);
    collectVirtualTextureDemand(workspace, manifest, [surface, later], [view()], sampler, manifest.mipCount - 1);
    expect(workspace.overflow).toBe(false);
    expect(visits).toBe(1);
  });
  it("keeps cache collisions and changing geometry equivalent to compact vertex indexing", () => {
    const positions = new Float32Array([-.5,-.5,0, 0,-.5,0, -.5,.5,0, 0,-.5,0, .5,-.5,0, .5,.5,0]);
    const uvs = new Float32Array([0,1, .5,1, 0,0, .5,1, 1,1, 1,0]);
    const paddedPositions = new Float32Array(259 * 3);
    const paddedUvs = new Float32Array(259 * 2);
    paddedPositions.set(positions.subarray(0, 9)); paddedPositions.set(positions.subarray(9), 256 * 3);
    paddedUvs.set(uvs.subarray(0, 6)); paddedUvs.set(uvs.subarray(6), 256 * 2);
    const compact = { ...surface, geometry: { ...surfaceGeometry, positions,
      textureCoordinates0: uvs, indices: new Uint16Array([0, 1, 2, 3, 4, 5]) } };
    const colliding = { ...surface, geometry: { ...surfaceGeometry, positions: paddedPositions,
      textureCoordinates0: paddedUvs, indices: new Uint16Array([0, 1, 2, 256, 257, 258]) } };
    const expected = createVirtualTextureDemandWorkspace(64);
    const actual = createVirtualTextureDemandWorkspace(64);
    collectVirtualTextureDemand(expected, manifest, [compact], [view()], sampler);
    collectVirtualTextureDemand(actual, manifest, [colliding], [view()], sampler);
    expect([...actual.keys]).toEqual([...expected.keys]);
    // The colliding vertices now carry different outside-plane flags.
    positions.set([2, -.5, 0, 3, -.5, 0, 3, .5, 0], 9);
    paddedPositions.set(positions.subarray(9), 256 * 3);
    resetVirtualTextureDemand(actual); resetVirtualTextureDemand(expected);
    collectVirtualTextureDemand(actual, manifest, [colliding], [view()], sampler);
    collectVirtualTextureDemand(expected, manifest, [compact], [view()], sampler);
    expect([...actual.keys]).toEqual([...expected.keys]);

    resetVirtualTextureDemand(actual);
    collectVirtualTextureDemand(actual, manifest, [surface], [view()], sampler);
    resetVirtualTextureDemand(expected);
    collectVirtualTextureDemand(expected, manifest, [surface], [view()], sampler);
    expect([...actual.keys]).toEqual([...expected.keys]);
  });
  it("refreshes cached clipping and finite flags across views and UV changes", () => {
    const workspace = createVirtualTextureDemandWorkspace(64);
    const broadBounds = { min: [-8, -8, -8] as const, max: [8, 8, 8] as const };
    const item = { ...surface, worldBounds: broadBounds };
    const visible = createVirtualTextureDemandWorkspace(64);
    collectVirtualTextureDemand(visible, manifest, [item], [view()], sampler);
    for (let axis = 0; axis < 3; axis++) for (const direction of [-1, 1]) {
      const outside = identityMat4(); outside[12 + axis] = direction * 3;
      resetVirtualTextureDemand(workspace);
      collectVirtualTextureDemand(workspace, manifest, [item], [view(outside)], sampler);
      expect(workspace.count).toBe(0);
      resetVirtualTextureDemand(workspace);
      collectVirtualTextureDemand(workspace, manifest, [item], [view()], sampler);
      expect([...workspace.keys]).toEqual([...visible.keys]);
    }
    resetVirtualTextureDemand(workspace);
    collectVirtualTextureDemand(workspace, manifest, [{ ...item, textureCoordinates: {
      row0: [Number.NaN, 0, 0, 0], row1: [0, 1, 0, 0],
    } }], [view()], sampler);
    expect(workspace.count).toBe(1);
    expect(workspace.mips[0]).toBe(manifest.mipCount - 1);
    resetVirtualTextureDemand(workspace);
    collectVirtualTextureDemand(workspace, manifest, [item], [view()], sampler);
    expect([...workspace.keys]).toEqual([...visible.keys]);
  });

  it.each(["all", "coarsest"] as const)("keeps repeated %s demand idempotent after capacity truncation", (ancestors) => {
    const workspace = createVirtualTextureDemandWorkspace(64, ancestors);
    const surfaces = [surface];
    const views = [view()];
    const entries = () => Array.from({ length: workspace.count }, (_, index) => [
      workspace.mips[index], workspace.xs[index], workspace.ys[index],
    ]);
    collectVirtualTextureDemand(workspace, manifest, surfaces, views, sampler);
    const complete = entries();
    truncateVirtualTextureDemand(workspace, 4);
    collectVirtualTextureDemand(workspace, manifest, surfaces, views, sampler);
    expect(entries().sort()).toEqual(complete.sort());
    const restored = entries();
    collectVirtualTextureDemand(workspace, manifest, surfaces, views, sampler);
    expect(entries()).toEqual(restored);
  });
  it("requests target pages and one fallback without intermediate SVG levels", () => {
    const source = parseVirtualTextureManifest({
      borderTexels: 2, contractVersion: 2, pageSize: 128,
      pages: { uriTemplate: "{mip}/{x}/{y}.png" }, virtualSize: [16384, 16384],
    });
    const workspace = createVirtualTextureDemandWorkspace(512, "coarsest");
    collectVirtualTextureDemand(workspace, source, [surface], [view()], { ...sampler, minFilter: "linear-mipmap-nearest" });
    // This plane covers 512 backing pixels: sixteen 128px pages plus coverage.
    expect(workspace.count).toBe(17);
    expect(new Set(workspace.mips.slice(0, workspace.count))).toEqual(new Set([7, 5]));
    expect(workspace.coarsestTarget).toBe(false);
    const distant = identityMat4();
    distant[0] = 0.1;
    distant[5] = 0.1;
    collectVirtualTextureDemand(workspace, source, [{
      ...surface, model: distant, worldBounds: transformedWorldBounds(surfaceGeometry.bounds, distant),
    }], [view()], { ...sampler, minFilter: "linear-mipmap-nearest" });
    expect(workspace.coarsestTarget).toBe(true);
    expect(workspace.count).toBe(17);
    truncateVirtualTextureDemand(workspace, 8);
    expect(workspace.count).toBe(5);
    expect(new Set(workspace.mips.slice(0, workspace.count))).toEqual(new Set([7, 6]));
  });
  it("adds only the adjacent blending level to automatic trilinear demand", () => {
    const source = parseVirtualTextureManifest({
      borderTexels: 2, contractVersion: 2, pageSize: 128,
      pages: { uriTemplate: "{mip}/{x}/{y}.png" }, virtualSize: [16384, 16384],
    });
    const workspace = createVirtualTextureDemandWorkspace(512, "coarsest");
    collectVirtualTextureDemand(workspace, source, [surface], [view()], sampler);
    expect(workspace.count).toBe(21);
    expect(new Set(workspace.mips.slice(0, workspace.count))).toEqual(new Set([7, 6, 5]));
    expect(workspace.coarsestTarget).toBe(false);
  });
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

  it.each([false, true])("keeps full-axis repetition independent of the other axis (swap: %s)", (swap) => {
    const cases = [
      { wrap: "clamp-to-edge", offset: 1.5, scale: .1, pages: [3] },
      { wrap: "clamp-to-edge", offset: -.5, scale: .1, pages: [0] },
      { wrap: "repeat", offset: .9, scale: .2, pages: [0, 3] },
      { wrap: "mirrored-repeat", offset: 1.1, scale: .1, pages: [3] },
      { wrap: "mirrored-repeat", offset: -.9, scale: .1, pages: [3] },
    ] as const;
    for (const { wrap, offset, scale, pages } of cases) {
      const workspace = createVirtualTextureDemandWorkspace(64);
      const coordinates = { row0: [swap ? scale : 2, 0, swap ? offset : 0, 0],
        row1: [0, swap ? 2 : scale, swap ? 0 : offset, 0] } as const;
      collectVirtualTextureDemand(workspace, manifest, [{ ...surface, textureCoordinates: coordinates }],
        [{ ...view(), viewport: { height: 8192, width: 8192, x: 0, y: 0 } }],
        { ...sampler, wrapS: swap ? wrap : "repeat", wrapT: swap ? "repeat" : wrap });
      const full = new Set<number>(), narrow = new Set<number>();
      for (let index = 0; index < workspace.count; index++) if (workspace.mips[index] === 0) {
        full.add((swap ? workspace.ys : workspace.xs)[index]!);
        narrow.add((swap ? workspace.xs : workspace.ys)[index]!);
      }
      expect([...full].sort()).toEqual([0, 1, 2, 3]);
      expect([...narrow].sort(), `${wrap} at ${offset}`).toEqual(pages);
    }
  });

  it.each([2 ** 53, -(2 ** 54), 1e30, -1e30])("bounds tile traversal for enormous repeating coordinates (%s)", (offset) => {
    for (const wrap of ["repeat", "mirrored-repeat"] as const) for (const swap of [false, true]) {
      const actual = createVirtualTextureDemandWorkspace(64);
      const expected = createVirtualTextureDemandWorkspace(64);
      const coordinates = (translation: number) => ({
        row0: [swap ? 0 : 1, 0, swap ? translation : 0, 0],
        row1: [0, swap ? 1 : 0, swap ? 0 : translation, 0],
      } as const);
      const repeatSampler = { ...sampler, wrapS: wrap, wrapT: wrap };
      collectVirtualTextureDemand(actual, manifest, [{ ...surface, textureCoordinates: coordinates(offset) }], [view()], repeatSampler);
      collectVirtualTextureDemand(expected, manifest, [{ ...surface, textureCoordinates: coordinates(0) }], [view()], repeatSampler);
      expect(actual.count).toBeGreaterThan(0);
      expect([...actual.keys]).toEqual([...expected.keys]);
      expect(actual.overflow).toBe(false);
    }
  });

  it("covers sampled UVs across independent clamp, repeat and mirror combinations", () => {
    let seed = 0x3915;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const wraps = ["clamp-to-edge", "repeat", "mirrored-repeat"] as const;
    const wrapped = (value: number, wrap: typeof wraps[number]) => {
      if (wrap === "clamp-to-edge") return Math.max(0, Math.min(1, value));
      const tile = Math.floor(value), fraction = value - tile;
      return wrap === "mirrored-repeat" && Math.abs(tile) % 2 === 1 ? 1 - fraction : fraction;
    };
    for (const wrapS of wraps) for (const wrapT of wraps) for (let trial = 0; trial < 30; trial++) {
      const u = random() * 10 - 5, v = random() * 10 - 5;
      const du = random() * 6 - 3, dv = random() * 6 - 3;
      const workspace = createVirtualTextureDemandWorkspace(64);
      collectVirtualTextureDemand(workspace, manifest, [{ ...surface, textureCoordinates: {
        row0: [du, 0, u, 0], row1: [0, dv, v, 0],
      } }], [{ ...view(), viewport: { height: 16384, width: 16384, x: 0, y: 0 } }],
      { ...sampler, wrapS, wrapT });
      const pages = new Set<string>();
      for (let index = 0; index < workspace.count; index++) if (workspace.mips[index] === 0) {
        pages.add(`${workspace.xs[index]}:${workspace.ys[index]}`);
      }
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const px = Math.min(3, Math.floor(wrapped(u + du * (x + .5) / 7, wrapS) * 4));
        const py = Math.min(3, Math.floor(wrapped(v + dv * (y + .5) / 7, wrapT) * 4));
        expect(pages.has(`${px}:${py}`), `${wrapS}/${wrapT}, UV ${u},${v} + ${du},${dv}`).toBe(true);
      }
    }
  });

  it("preserves demand under whole-period translations on both wrapped axes", () => {
    const workspace = createVirtualTextureDemandWorkspace(64);
    for (const wrapS of ["repeat", "mirrored-repeat"] as const)
      for (const wrapT of ["repeat", "mirrored-repeat"] as const)
        for (const scale of [0.125, -0.375, 1.5]) {
          const collect = (u: number, v: number) => {
            resetVirtualTextureDemand(workspace);
            collectVirtualTextureDemand(workspace, manifest, [{ ...surface, textureCoordinates: {
              row0: [scale, 0, 1.125 + u, 0], row1: [0, -scale, 0.375 + v, 0],
            } }], [view()], { ...sampler, wrapS, wrapT });
            expect(workspace.overflow).toBe(false);
            return [...workspace.keys].sort();
          };
          const expected = collect(0, 0);
          expect(expected.length).toBeGreaterThan(0);
          for (const u of [-1024, -3, 5, 1024]) for (const v of [-1024, -3, 5, 1024]) {
            expect(collect(u * (wrapS === "mirrored-repeat" ? 2 : 1),
              v * (wrapT === "mirrored-repeat" ? 2 : 1))).toEqual(expected);
          }
        }
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

  it.each([1e308, -1e308])("keeps fallback coverage when finite UV derivatives overflow (%s)", (scale) => {
    for (let triangle = 0; triangle < 2; triangle++) {
      const workspace = createVirtualTextureDemandWorkspace(8);
      collectVirtualTextureDemand(workspace, manifest, [{
        ...surface,
        geometry: { ...surface.geometry, indices: surface.geometry.indices.slice(triangle * 3, triangle * 3 + 3) },
        textureCoordinates: { row0: [scale, 0, 0, 0], row1: [0, 1, 0, 0] },
      }], [view()], { ...sampler, wrapS: "repeat" });
      expect(workspace.count).toBe(1);
      expect(workspace.mips[0]).toBe(manifest.mipCount - 1);
      expect(workspace.xs[0]).toBe(0);
      expect(workspace.ys[0]).toBe(0);
    }
  });

  it("bounds malformed coverage work when the coarsest authored mip is still large", () => {
    let lookups = 0;
    class CountingKeys extends Set<number | string> {
      override has(key: number | string): boolean { lookups++; return super.has(key); }
    }
    const workspace = { ...createVirtualTextureDemandWorkspace(4), keys: new CountingKeys() };
    const partial = parseVirtualTextureManifest({ contractVersion: 2, pageSize: 256,
      borderTexels: 1, mipCount: 1, virtualSize: [262144, 262144],
      pages: { uriTemplate: "{mip}/{x}/{y}.png" } });
    collectVirtualTextureDemand(workspace, partial, [{ ...surface, textureCoordinates: {
      row0: [Number.NaN, 0, 0, 0], row1: [0, 1, 0, 0],
    } }], [view()], sampler);
    expect(workspace.count).toBe(4);
    expect(workspace.overflow).toBe(true);
    expect([...workspace.xs]).toEqual([0, 1, 2, 3]);
    expect([...workspace.ys]).toEqual([0, 0, 0, 0]);
    expect(lookups).toBeLessThanOrEqual(5);
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
