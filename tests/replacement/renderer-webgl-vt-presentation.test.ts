import * as pageSources from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";
import { fitOrdinaryTextureStorage } from "../../packages/renderer-webgl/src/texture/storage-fit";
import { createGeneratedVirtualTextureLayout } from "../../packages/renderer-webgl/src/virtual-texture/layout";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { directionalLight, mesh, perspectiveCamera, planeGeometry, scene, standardMaterial, unlitMaterial, imageTexture } from "@royal/renderer-core";
import { canvasRootHarness, fakeGl } from "./support/canvas-root-harness";
import * as demand from "../../packages/renderer-webgl/src/virtual-texture/demand";
import { waitFor } from "./support/wait-for";

beforeEach(() => {
  vi.spyOn(pageSources, "renderAutomaticPage").mockImplementation(() => ({ kind: "image", source: { width: 132, height: 132 } as ImageBitmap, close: vi.fn() }));
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), clearRect: vi.fn() }) }) });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const decoded = { width: 1024, height: 1024, source: {} as ImageBitmap };
const pageSource = () => vi.spyOn(pageSources, "createAutomaticRasterPageSource").mockReturnValue({
  layout: createGeneratedVirtualTextureLayout({ width: 1024, height: 1024, pageSize: 128, borderTexels: 2, colorSpace: "srgb" }),
  read: async () => ({ kind: "image", source: { width: 132, height: 132 } as ImageBitmap, close: vi.fn() }),
});

it.each([
  { requested: undefined, available: true, expected: 8 },
  { requested: 4, available: true, expected: 4 },
  { requested: 1, available: true, expected: 1 },
  { requested: undefined, available: false, expected: 1 },
])("shares root anisotropy $requested (extension $available) between VT demand and sampling across restoration", async ({ requested, available, expected }) => {
  pageSource();
  let limit = 8;
  const parameters = fakeGl().getParameter;
  const { root, canvas, flushScheduledFrames } = canvasRootHarness({ decodeTexture: async () => decoded }, {
    getExtension: vi.fn(name => name === "EXT_texture_filter_anisotropic" && available
      ? { TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff } : null) as WebGL2RenderingContext["getExtension"],
    getParameter: vi.fn(parameter => parameter === 0x84ff ? limit : parameters(parameter)),
    getUniformLocation: vi.fn((_program, name) => ({ name })),
  }, requested === undefined ? {} : { anisotropy: requested });
  const collect = vi.spyOn(demand, "collectVirtualTextureDemandSteps");
  try {
    root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
    root.setScene(scene({ camera: perspectiveCamera({ position: [0, 0, 3] }), nodes: [
      mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: imageTexture("https://example.test/aniso.json") }) }),
    ] }));
    const check = async (maximum: number) => waitFor(() => {
      flushScheduledFrames();
      expect(root.getSnapshot().resources.virtualTextures.residentPages).toBeGreaterThan(0);
      expect(collect.mock.calls.at(-1)?.[6]).toBe(maximum);
      const settings = vi.mocked(canvas.gl.uniform4fv).mock.calls.filter(([location]) =>
        (location as { name?: string }).name === "virtualSettings1").at(-1)?.[1];
      expect(settings === undefined ? undefined : Array.from(settings)[3]).toBe(maximum);
      expect(root.getSnapshot().resources.imageTextures.residentBytes).toBeLessThan(2 * 1024 * 1024);
    });
    await check(expected);
    root.setSize({ cssWidth: 1024, cssHeight: 1024, pixelRatio: 1 });
    await check(expected);
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    limit = 2;
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    await check(Math.min(expected, 2));
    // The atlas itself must remain isotropic; each virtual tap resolves a page.
    const atlasSampler = vi.mocked(canvas.gl.bindSampler).mock.calls.filter(([unit]) => unit === 4).at(-1)?.[1];
    expect(vi.mocked(canvas.gl.samplerParameterf).mock.calls.some(([sampler]) => sampler === atlasSampler)).toBe(false);
  } finally { collect.mockRestore(); root.dispose(); }
});

it.each(["unlit", "standard"])("refreshes %s atlas dimensions after resizing without changing the material", async (kind) => {
  pageSource();
  const { root, canvas, flushScheduledFrames } = canvasRootHarness({ decodeTexture: async () => decoded }, {
    getUniformLocation: vi.fn((_program, name) => ({ name })),
  });
  const texture = imageTexture("https://example.test/growing.json");
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({ geometry: planeGeometry(2), material: kind === "unlit" ? unlitMaterial({ texture }) : standardMaterial({ texture }) }), directionalLight({ direction: [0, 0, -1] })],
    }));
    await waitFor(() => {
      flushScheduledFrames();
      expect(root.getSnapshot().resources.virtualTextures.residentPages).toBeGreaterThan(1);
      expect(root.getSnapshot().resources.virtualTextures.pendingPages).toBe(0);
    });
    const before = root.getSnapshot().resources.virtualTextures.atlasBytes;
    root.setSize({ cssWidth: 1024, cssHeight: 1024, pixelRatio: 1 });
    await waitFor(() => {
      flushScheduledFrames();
      const snapshot = root.getSnapshot().resources.virtualTextures;
      expect(snapshot.atlasBytes).toBeGreaterThan(before);
      expect(snapshot.unresidentPages).toBe(0);
      expect(snapshot.pendingPages).toBe(0);
    });
    const expectCurrentDimensions = () => {
      const dimensions = Array.from(vi.mocked(canvas.gl.uniform4fv).mock.calls.filter(([location]) =>
        (location as { name?: string }).name === "virtualSettings1").at(-1)![1]);
      expect(Number(dimensions[0]) * Number(dimensions[1]) * 4)
        .toBe(root.getSnapshot().resources.virtualTextures.atlasBytes);
      expect(dimensions[2]).toBe(1); // Trilinear selection survives atlas migration.
    };
    expectCurrentDimensions();
    const grownBytes = root.getSnapshot().resources.virtualTextures.atlasBytes;
    clock = vi.spyOn(performance, "now").mockReturnValue(0);
    root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
    flushScheduledFrames();
    clock.mockReturnValue(3_600_000);
    root.invalidate();
    await waitFor(() => {
      flushScheduledFrames();
      expect(root.getSnapshot().resources.virtualTextures.atlasBytes).toBe(grownBytes);
    });
    expectCurrentDimensions();
  } finally { root.dispose(); clock?.mockRestore(); }
});

it("activates paging and shares the coarse initial decode with the bounded CPU cache", async () => {
  const close = vi.fn();
  const decodeTexture = vi.fn(async (_asset, _signal, maxBytes?: number) => ({
    ...fitOrdinaryTextureStorage(2048, 2048, maxBytes ?? 16 * 1024 * 1024),
    sourceWidth: 2048, sourceHeight: 2048, source: {} as ImageBitmap, close,
  }));
  const { root, flushScheduledFrames } = canvasRootHarness({ decodeTexture });
  try {
    root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
    root.setScene(scene({ camera: perspectiveCamera({ position: [0, 0, 3] }), nodes: [
      mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: imageTexture("https://example.test/coarse.png") }) }),
    ] }));
    await waitFor(() => {
      flushScheduledFrames();
      expect(root.getSnapshot().resources.virtualTextures.residentPages).toBeGreaterThan(0);
      expect(root.getSnapshot().resources.imageTextures.residentBytes).toBeLessThan(90000);
      expect(root.getSnapshot().resources.imageTexturePreparation.decodedHandoffBytes).toBe(0);
    });
    expect(root.getSnapshot().resources.virtualTextures.automaticResources).toBe(1);
    await waitFor(() => {
      flushScheduledFrames();
      expect(root.getSnapshot().presentation).toBe("ready");
    });
    expect(root.getSnapshot().resources.virtualTextures.rasterCacheReads).toBe(0);
    expect(root.getSnapshot().presentation).not.toBe("failed");
  } finally { root.dispose(); }
});

it.each([32, 64])("bounds paging a large artwork catalog under a %s MiB GPU budget", async budgetMiB => {
  const { root, flushScheduledFrames } = canvasRootHarness({
    decodeTexture: async (_asset, _signal, maxBytes) => maxBytes !== undefined && maxBytes < 1024 * 1024
      ? { width: 128, height: 128, sourceWidth: 4096, sourceHeight: 4096, source: {} as ImageBitmap, close: vi.fn() }
      : { width: 1024, height: 1024, sourceWidth: 4096, sourceHeight: 4096, source: {} as ImageBitmap, close: vi.fn() },
  }, {}, { persistentGpuByteBudget: budgetMiB * 1024 * 1024 });
  try {
    root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
    root.setScene(scene({ camera: perspectiveCamera({ position: [0, 0, 3] }), nodes: Array.from({ length: 20 }, (_, i) =>
      mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: imageTexture(`https://example.test/pressure-${i}.png`) }) })),
    }));
    await waitFor(() => {
      flushScheduledFrames();
      const snapshot = root.getSnapshot();
      expect(snapshot.resources.virtualTextures.automaticResources).toBe(20);
      expect(snapshot.resources.virtualTextures.residentPages).toBeGreaterThanOrEqual(20);
      expect(snapshot.resources.virtualTextures.pendingPages).toBe(0);
      expect(snapshot.resources.virtualTextures.unresidentPages).toBe(0);
      expect(snapshot.resources.virtualTextures.rasterCacheBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
      expect(snapshot.resources.persistentGpu.retainedBytes).toBeLessThanOrEqual(budgetMiB * 1024 * 1024);
      expect(snapshot.resources.imageTextures.residentBytes).toBeLessThan(2 * 1024 * 1024);
      expect(snapshot.lastFrameFailure).toBeUndefined();
    });
  } finally { root.dispose(); }
});
