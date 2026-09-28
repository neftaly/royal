import { afterEach, describe, expect, it, vi } from "vitest";
import { imageTexture, mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial } from "@royal/renderer-core";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { fakeGl } from "./support/canvas-root-harness";
import * as automaticPageSources from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";
import * as storagePlans from "../../packages/renderer-webgl/src/virtual-texture/storage-plan";
import { createGeneratedVirtualTextureLayout } from "../../packages/renderer-webgl/src/virtual-texture/layout";
import { textureStorageKey } from "../../packages/renderer-webgl/src/texture/source";
import { waitFor } from "./support/wait-for";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const harness = async (virtualSize = 1024, budgetBytes?: number, maxTextureSize?: number, cpuPages = false) => {
  const decoded = { width: virtualSize, height: virtualSize, source: {} as ImageBitmap };
  class CpuPixels { width = 130; height = 130; data = new Uint8ClampedArray(130 * 130 * 4); }
  if (cpuPages) vi.stubGlobal("ImageData", CpuPixels);
  const read = vi.fn(async () => ({ kind: "image" as const,
    source: (cpuPages ? new CpuPixels() : { width: 130, height: 130 }) as unknown as ImageBitmap, close: vi.fn() }));
  vi.spyOn(automaticPageSources, "createAutomaticRasterPageSource").mockImplementation((_source, _sampler, colorSpace) => ({
    layout: createGeneratedVirtualTextureLayout({ width: virtualSize, height: virtualSize, pageSize: 128, borderTexels: 1, colorSpace }),
    read,
  }));
  const texture = imageTexture("https://example.test/map.png");
  const gl = fakeGl();
  if (maxTextureSize !== undefined) {
    const getParameter = vi.mocked(gl.getParameter).getMockImplementation()!;
    vi.mocked(gl.getParameter).mockImplementation(name => name === gl.MAX_TEXTURE_SIZE ? maxTextureSize : getParameter(name));
  }
  Object.assign(gl, { texStorage2D: vi.fn() });
  const budget = new PersistentGpuBudgetOwner(budgetBytes);
  const runtime = createBrowserVirtualTextureRuntime(gl, budget, undefined, {
    decoded: () => decoded, acquireDecoded: () => ({ source: decoded, release: vi.fn() }), onChanged: vi.fn(),
  });
  const matrix = identityMat4();
  const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
  runtime.setScene(prepareCanonicalSurfaceScene(scene({
    camera: perspectiveCamera({}), nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })],
  })));
  await waitFor(() => {
    runtime.update([view]);
    expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, pendingPages: 0 });
  });
  return { runtime, view, gl, budget, texture, read };
};

const copiedPages = (gl: ReturnType<typeof fakeGl>): number => gl.copyTexSubImage2D.mock.calls.reduce(
  (total, call) => total + Number(call[6]) * Number(call[7]) / (130 * 130), 0);

describe("demand-grown RGBA atlases", () => {
  it("keeps resident detail across offscreen and active-set round trips without new reads", async () => {
    const { runtime, view, texture, budget } = await harness();
    try {
      const before = runtime.runtimeSnapshot();
      const binding = runtime.automaticBinding(texture);
      const bytes = budget.snapshot().retainedBytes;
      view.viewProjection = [...identityMat4()] as typeof view.viewProjection;
      view.viewProjection[12] = 100;
      runtime.setActiveStorageKeys!(new Set());
      for (let frame = 0; frame < 20; frame++) runtime.update([view]);
      expect(runtime.runtimeSnapshot().residentPages).toBe(before.residentPages);
      expect(budget.snapshot().retainedBytes).toBe(bytes);
      view.viewProjection[12] = 0;
      // The runtime should retain an existing owner even while registration is
      // reconciled against an empty active set.
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [
        mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) }),
      ] })));
      runtime.setActiveStorageKeys!(new Set([textureStorageKey(texture)]));
      for (let frame = 0; frame < 20; frame++) runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(binding);
      expect(runtime.runtimeSnapshot().pageRequests).toBe(before.pageRequests);
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("reclaims offscreen residency when the texture budget is needed elsewhere", async () => {
    const { runtime, view, budget } = await harness();
    try {
      view.viewProjection = [...identityMat4()] as typeof view.viewProjection;
      view.viewProjection[12] = 100;
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      expect(runtime.runtimeSnapshot().residentPages).toBe(5);
      budget.setTextureBudget(0);
      runtime.update([view]);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 0, atlasBytes: 0, pendingPages: 0 });
      expect(budget.snapshot().retainedBytes).toBe(0);
      budget.setTextureBudget(budget.budgetBytes);
      view.viewProjection[12] = 0;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, unresidentPages: 0 });
      });
    } finally { runtime.dispose(); }
  });

  it("reuploads existing CPU pages after GPU reclamation and context loss without regenerating them", async () => {
    const { runtime, view, budget, read } = await harness(1024, undefined, undefined, true);
    try {
      const reads = read.mock.calls.length;
      expect(runtime.runtimeSnapshot().cpuPageCacheBytes).toBe(5 * 130 * 130 * 4);
      view.viewProjection = [...identityMat4()] as typeof view.viewProjection;
      view.viewProjection[12] = 100;
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      budget.setTextureBudget(0);
      runtime.update([view]);
      expect(runtime.runtimeSnapshot().residentPages).toBe(0);
      budget.setTextureBudget(budget.budgetBytes);
      view.viewProjection[12] = 0;
      await waitFor(() => { runtime.update([view]); expect(runtime.runtimeSnapshot().residentPages).toBe(5); });
      expect(read).toHaveBeenCalledTimes(reads);
      runtime.invalidate();
      await waitFor(() => { runtime.update([view]); expect(runtime.runtimeSnapshot().residentPages).toBe(5); });
      expect(read).toHaveBeenCalledTimes(reads);
      expect(runtime.runtimeSnapshot().cpuPageCacheHits).toBe(10);
      runtime.setScene(null);
      expect(runtime.runtimeSnapshot().cpuPageCacheBytes).toBe(0);
    } finally { runtime.dispose(); }
  });

  it("migrates small resident pages by a bounded byte allowance before requesting zoom detail", async () => {
    const { runtime, view, gl, texture } = await harness();
    try {
      view.viewport.width = view.viewport.height = 512;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 21, pendingPages: 0, unresidentPages: 0 });
      });
      const original = runtime.automaticBinding(texture);
      const requests = runtime.runtimeSnapshot().pageRequests;
      gl.copyTexSubImage2D.mockClear();
      view.viewport.width = view.viewport.height = 1024;
      runtime.update([view]); // allocate
      runtime.update([view]); // fence allocation
      runtime.update([view]); // validate and copy
      const firstBatch = copiedPages(gl);
      expect(firstBatch).toBeGreaterThan(4);
      expect(firstBatch * 130 * 130 * 4).toBeLessThanOrEqual(1024 * 1024);
      // Automatic sources may prepare one detail page during migration.
      expect(runtime.runtimeSnapshot().pageRequests - requests).toBeLessThanOrEqual(1);
      expect(runtime.automaticBinding(texture)).toBe(original);
      runtime.update([view]); // remaining copies
      expect(copiedPages(gl)).toBe(21);
      expect((21 - firstBatch) * 130 * 130 * 4).toBeLessThanOrEqual(1024 * 1024);
      runtime.update([view]); // fence copies
      expect(runtime.automaticBinding(texture)).toBe(original);
      runtime.update([view]); // publish after validation
      expect(runtime.automaticBinding(texture)!.atlas.texture).not.toBe(original!.atlas.texture);
      await waitFor(() => {
        const uploads = runtime.runtimeSnapshot().uploadedPages;
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().uploadedPages - uploads).toBeLessThanOrEqual(4);
        expect(runtime.runtimeSnapshot()).toMatchObject({ unresidentPages: 0, pendingPages: 0, atlasGrowthFailures: 0 });
      });
    } finally { runtime.dispose(); }
  });

  it("releases cached copy attachments and refreshes texture limits after context loss", async () => {
    const { runtime, view, gl } = await harness();
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      });
      const limitQueries = () => vi.mocked(gl.getParameter).mock.calls.filter(([name]) => name === gl.MAX_TEXTURE_SIZE).length;
      expect(limitQueries()).toBe(1);
      expect(gl.createFramebuffer).toHaveBeenCalled();
      expect(vi.mocked(gl.deleteFramebuffer).mock.calls.length).toBe(vi.mocked(gl.createFramebuffer).mock.calls.length);
      runtime.invalidate();
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBe(81);
      });
      expect(limitQueries()).toBe(2);
    } finally { runtime.dispose(); }
  });

  it.each(["dispose", "invalidate", "cancel"].flatMap(action =>
    [1, 2, 3, 4].map(frames => ({ action, frames }))))(
    "releases a forced shrink on $action after $frames frames", async ({ action, frames }) => {
      const { runtime, view, texture, budget, gl } = await harness(4096, 16 * 1024 * 1024);
      try {
        view.viewport.width = view.viewport.height = 2048;
        await waitFor(() => {
          runtime.update([view]);
          expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 321, unresidentPages: 0 });
          expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(65);
        });
        const binding = runtime.automaticBinding(texture);
        const retainedBytes = budget.snapshot().retainedBytes;
        const other = imageTexture({ src: "https://example.test/other.png", colorSpace: "linear" });
        const setAssets = (assets: typeof texture[]) => runtime.setScene(prepareCanonicalSurfaceScene(scene({
          camera: perspectiveCamera({}), nodes: assets.map(asset =>
            mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })),
        })));
        const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
        setAssets([texture, other]);
        await waitFor(() => {
          runtime.update([view]);
          expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBeGreaterThan(allocations);
        });
        for (let frame = 1; frame < frames; frame++) runtime.update([view]);
        expect(runtime.automaticBinding(texture)).toBe(binding);
        expect(budget.snapshot().retainedBytes).toBeLessThanOrEqual(budget.budgetBytes);
        if (action === "cancel") {
          setAssets([texture]);
          runtime.update([view]);
          expect(runtime.automaticBinding(texture)).toBe(binding);
          expect(budget.snapshot().retainedBytes).toBe(retainedBytes);
          await waitFor(() => {
            runtime.update([view]);
            expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, unresidentPages: 0, atlasGrowthFailures: 0 });
          });
        } else {
          if (action === "dispose") runtime.dispose();
          else runtime.invalidate();
          expect(budget.snapshot().retainedBytes).toBe(0);
          if (action === "invalidate") await waitFor(() => {
            runtime.update([view]);
            expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 2, unresidentPages: 0 });
            expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThan(0);
            expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThan(0);
          });
        }
      } finally { runtime.dispose(); }
      expect(budget.snapshot().retainedBytes).toBe(0);
    },
  );

  it("does not reserve coarse coverage for an unallocated offscreen pool", async () => {
    const { runtime, view, texture } = await harness(1024, 16 * 1024 * 1024);
    const hidden = imageTexture({ src: "https://example.test/hidden.png", colorSpace: "linear" });
    try {
      view.viewport.width = view.viewport.height = 1024;
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) }),
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: hidden }), transform: { position: [100, 0, 0] } }),
        ],
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().automaticWaiting).toBe(0);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, residentPages: 85, unresidentPages: 0 });
      });
    } finally { runtime.dispose(); }
  });

  it("shares saturated protected slots with later textures in the same pool", async () => {
    const { runtime, view, texture } = await harness(4096, 16 * 1024 * 1024);
    try {
      view.viewport.width = view.viewport.height = 2048;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 321, unresidentPages: 0 });
      });
      const others = ["second", "third"].map(name => imageTexture(`https://example.test/${name}.png`));
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [texture, ...others].map(asset =>
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })),
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, unresidentPages: 0 });
        for (const asset of [texture, ...others]) expect(runtime.automaticBinding(asset)).toBeDefined();
      });
    } finally { runtime.dispose(); }
  });

  it("shares a saturated budget with a newly visible incompatible pool", async () => {
    const { runtime, view, texture } = await harness(4096, 16 * 1024 * 1024);
    try {
      view.viewport.width = view.viewport.height = 2048;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 321, unresidentPages: 0 });
      });
      const other = imageTexture({ src: "https://example.test/other.png", colorSpace: "linear" });
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [texture, other].map(asset =>
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })),
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 2, unresidentPages: 0 });
        expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(65);
        expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(65);
      });
      expect(runtime.runtimeSnapshot().atlasGrowthFailures).toBe(0);
    } finally { runtime.dispose(); }
  });

  it("retains cached detail when a new pool has ample budget", async () => {
    const { runtime, view, texture } = await harness();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      });
      const original = runtime.automaticBinding(texture)!;
      const other = imageTexture({ src: "https://example.test/other.png", colorSpace: "linear" });
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [
          mesh({ geometry: planeGeometry(0.5), material: unlitMaterial({ texture }) }),
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: other }) }),
        ],
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 2, unresidentPages: 0 });
      });
      clock.mockReturnValue(3_600_000);
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(original);
    } finally { runtime.dispose(); clock.mockRestore(); }
  });

  it("does not lend another pool the bytes of an uncommitted shrink", async () => {
    const { runtime, view, texture, gl, budget } = await harness(1024, 16 * 1024 * 1024);
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      });
      view.viewport.width = view.viewport.height = 256;
      runtime.update([view]);
      vi.mocked(gl.clientWaitSync).mockReturnValue(gl.TIMEOUT_EXPIRED);
      const other = imageTexture({ src: "https://example.test/other.png", colorSpace: "linear" });
      const changeScene = (size: number) => runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [
          mesh({ geometry: planeGeometry(size), material: unlitMaterial({ texture }) }),
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: other }) }),
        ],
      })));
      view.viewport.width = view.viewport.height = 1024;
      changeScene(0.5);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().atlasPools).toBe(2);
      });
      changeScene(2);
      runtime.update([view]);
      expect(runtime.runtimeSnapshot().atlasBytes).toBeLessThanOrEqual(budget.budgetBytes * 0.75);
    } finally { runtime.dispose(); clock.mockRestore(); }
  });

  it.each([false, true])("keeps old residency when a pressure-driven shrink copy fails (chunked=%s)", async (chunked) => {
    const { runtime, view, texture, gl, budget } = await harness(1024, 16 * 1024 * 1024);
    if (chunked) {
      let now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => now += 5);
    }
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(85);
      });
      const large = runtime.automaticBinding(texture)!;
      const other = imageTexture({ src: "https://example.test/other.png", colorSpace: "linear" });
      gl.copyTexSubImage2D.mockImplementation(() => { throw new Error("copy failed"); });
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [
          mesh({ geometry: planeGeometry(0.5), material: unlitMaterial({ texture }) }),
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: other }) }),
        ],
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().atlasGrowthFailures).toBeGreaterThan(0);
      });
      expect(runtime.automaticBinding(texture)).toBe(large);
      expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(85);
      // Once competing requests settle, unchanged failed migrations must stop retrying.
      await waitFor(() => {
        const update = runtime.update([view]);
        const snapshot = runtime.runtimeSnapshot();
        expect(snapshot.pendingDemandResources ?? 0).toBe(0);
        expect(snapshot.pendingPages).toBe(0);
        expect(update.pending).toBe(false);
      });
      for (let frame = 0; frame < 20; frame++) runtime.update([view]);
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let frame = 0; frame < 20; frame++) runtime.update([view]);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
      expect(budget.snapshot().retainedBytes).toBeLessThanOrEqual(budget.budgetBytes);
    } finally { runtime.dispose(); }
  });

  it("rebalances spare slots smaller than half an atlas when another pool needs them", async () => {
    const { runtime, view, texture } = await harness(1024, 16 * 1024 * 1024);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      });
      const other = imageTexture({ src: "https://example.test/other.png", colorSpace: "linear" });
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [texture, other].map(asset =>
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })),
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 162, admittedPages: 162, unresidentPages: 0 });
      });
      expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(65);
      expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(65);
    } finally { runtime.dispose(); }
  });

  it("cancels compaction when competing demand disappears before publication", async () => {
    const { runtime, view, texture, gl, budget } = await harness(1024, 16 * 1024 * 1024);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      });
      const original = runtime.automaticBinding(texture)!;
      const retained = budget.snapshot().retainedBytes;
      const other = imageTexture({ src: "https://example.test/other.png", colorSpace: "linear" });
      const setCompetition = (competing: boolean) => runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [
          mesh({ geometry: planeGeometry(0.5), material: unlitMaterial({ texture }) }),
          ...(competing ? [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: other }) })] : []),
        ],
      })));
      gl.copyTexSubImage2D.mockClear();
      setCompetition(true);
      await waitFor(() => {
        runtime.update([view]);
        expect(gl.copyTexSubImage2D).toHaveBeenCalled();
      });
      expect(runtime.automaticBinding(texture)).toBe(original);
      setCompetition(false);
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(original);
      expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      expect(budget.snapshot().retainedBytes).toBe(retained);
    } finally { runtime.dispose(); }
  });

  it("reclaims spare capacity for an incompatible pool under budget pressure", async () => {
    const { runtime, view, texture, budget } = await harness(1024, 16 * 1024 * 1024);
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0 });
      });
      const large = runtime.automaticBinding(texture)!;
      const requests = runtime.runtimeSnapshot().pageRequests;
      const other = imageTexture({ src: "https://example.test/other.png", colorSpace: "linear" });
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [
          mesh({ geometry: planeGeometry(0.5), material: unlitMaterial({ texture }) }),
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: other }) }),
        ],
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 2, desiredPages: 86, unresidentPages: 0 });
        expect(runtime.automaticBinding(texture)!.atlas.texture).not.toBe(large.atlas.texture);
        expect(runtime.automaticBinding(other)).toBeDefined();
      });
      expect(runtime.runtimeSnapshot().atlasGrowthFailures).toBe(0);
      // Only the new pool is read; compaction copies retained pages on the GPU.
      expect(runtime.runtimeSnapshot().pageRequests).toBe(requests + 81);
      expect(runtime.automaticBinding(texture)).toBeDefined();
      expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(81);
      expect(budget.snapshot().retainedBytes).toBeLessThan(budget.budgetBytes);
    } finally { runtime.dispose(); clock.mockRestore(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("retries initial allocation after temporary budget exhaustion", async () => {
    const { runtime, view, texture, budget } = await harness();
    runtime.invalidate();
    const blocker = {};
    expect(budget.tryClaim(blocker, budget.availableBytes)).toBe(true);
    try {
      for (let frame = 0; frame < 3; frame++) {
        expect(runtime.update([view]).pending).toBe(false);
        expect(runtime.automaticBinding(texture)).toBeUndefined();
      }
      budget.release(blocker);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, unresidentPages: 0 });
      });
    } finally { budget.release(blocker); runtime.dispose(); }
  });

  it("retains and reuses zoom detail indefinitely while there is no competing demand", async () => {
    const { runtime, view, texture, budget } = await harness();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0 });
      });
      const large = runtime.automaticBinding(texture)!;
      const requests = runtime.runtimeSnapshot().pageRequests;
      view.viewport.width = view.viewport.height = 256;
      runtime.update([view]);
      clock.mockReturnValue(3500);
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      view.viewport.width = view.viewport.height = 1024;
      runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(large);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0, pageRequests: requests });
      view.viewport.width = view.viewport.height = 256;
      runtime.update([view]);
      clock.mockReturnValue(30_001);
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(large);
      expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      clock.mockReturnValue(3_600_000);
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      view.viewport.width = view.viewport.height = 1024;
      runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(large);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0, pageRequests: requests });
    } finally { runtime.dispose(); clock.mockRestore(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("keeps existing page coordinates and tables when growth fits below the old rows", async () => {
    const { runtime, view, gl, texture } = await harness(1024, undefined, 16384);
    const original = runtime.automaticBinding(texture)!;
    gl.texSubImage2D.mockClear();
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      for (let frame = 0; frame < 7; frame++) runtime.update([view]);
      const grown = runtime.automaticBinding(texture)!;
      expect(grown.atlas.texture).not.toBe(original.atlas.texture);
      expect(grown.settings1[0]).toBe(original.settings1[0]);
      expect(grown.settings1[1]).toBeGreaterThan(original.settings1[1]!);
      expect(grown.pageTable.texture).toBe(original.pageTable.texture);
      expect(gl.texSubImage2D).not.toHaveBeenCalled();
      expect(copiedPages(gl)).toBe(5);
    } finally { runtime.dispose(); }
  });

  it("keeps drawing the old atlas while allocation is incomplete, without blocking error queries", async () => {
    const { runtime, view, gl, texture } = await harness();
    const original = runtime.automaticBinding(texture);
    vi.mocked(gl.getError).mockClear();
    vi.mocked(gl.clientWaitSync).mockReturnValue(gl.TIMEOUT_EXPIRED);
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      for (let i = 0; i < 5; i++) {
        expect(runtime.update([view]).pending).toBe(true);
        expect(runtime.automaticBinding(texture)).toBe(original);
      }
      expect(gl.getError).not.toHaveBeenCalled();
      expect(gl.copyTexSubImage2D).not.toHaveBeenCalled();
      expect(gl.clientWaitSync).toHaveBeenLastCalledWith(expect.anything(), 0, 0);
      vi.mocked(gl.clientWaitSync).mockReturnValue(gl.CONDITION_SATISFIED);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0 });
      });
      expect(gl.deleteSync).toHaveBeenCalledTimes(2);
    } finally { runtime.dispose(); }
  });

  it.each(["failed", "timeout", "creation"])("rolls back a %s allocation fence without losing coverage", async (failure) => {
    const { runtime, view, gl, budget, texture } = await harness();
    const original = runtime.automaticBinding(texture);
    const retained = budget.snapshot().retainedBytes;
    if (failure === "creation") vi.mocked(gl.fenceSync).mockReturnValueOnce(null);
    else vi.mocked(gl.clientWaitSync).mockReturnValue(failure === "failed" ? gl.WAIT_FAILED : gl.TIMEOUT_EXPIRED);
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      for (let i = 0; i < 125; i++) runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(original);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, atlasGrowthFailures: 1 });
      expect(gl.copyTexSubImage2D).not.toHaveBeenCalled();
      expect(budget.snapshot().retainedBytes).toBe(retained);
    } finally { runtime.dispose(); }
  });

  it("validates asynchronous copy errors before publishing the replacement", async () => {
    const { runtime, view, gl, budget, texture } = await harness();
    const original = runtime.automaticBinding(texture);
    const retained = budget.snapshot().retainedBytes;
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      runtime.update([view]);
      runtime.update([view]);
      runtime.update([view]);
      expect(copiedPages(gl)).toBe(5);
      expect(runtime.automaticBinding(texture)).toBe(original);
      vi.mocked(gl.getError).mockReturnValueOnce(0x0505);
      runtime.update([view]);
      runtime.update([view]);
      runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(original);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, atlasGrowthFailures: 1 });
      expect(budget.snapshot().retainedBytes).toBe(retained);
      expect(gl.deleteSync).toHaveBeenCalledTimes(2);
      expect(runtime.runtimeSnapshot().lastAtlasGrowthFailure).toContain("WebGL 0x505");
    } finally { runtime.dispose(); }
  });

  it("recovers stalled growth through a fully accounted coarse intermediate atlas", async () => {
    const { runtime, view, gl, budget, texture } = await harness(4096);
    const competing = {};
    const pageBytes = 130 * 130 * 4;
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, pendingPages: 0 });
      });
      expect(budget.tryClaim(competing, budget.availableBytes - 250 * pageBytes)).toBe(true);
      view.viewport.width = view.viewport.height = 2048;
      let coarse = false;
      await waitFor(() => {
        const update = runtime.update([view]);
        const snapshot = runtime.runtimeSnapshot();
        // The host stops rendering when pending is false. A coarse intermediate
        // migration must schedule the growth that can now use its freed budget.
        if (snapshot.residentPages === 1 && snapshot.admittedPages === 1) expect(update.pending).toBe(true);
        coarse ||= snapshot.residentPages === 1;
        expect(runtime.automaticBinding(texture)).toBeDefined();
        expect(snapshot.residentPages).toBeGreaterThan(0);
        expect(budget.snapshot().retainedBytes).toBeLessThanOrEqual(budget.budgetBytes);
        expect(snapshot).toMatchObject({ desiredPages: 321, admittedPages: 321, residentPages: 321, pendingPages: 0, unresidentPages: 0 });
      });
      expect(coarse).toBe(true);
      expect(gl.copyTexSubImage2D).toHaveBeenCalled();
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let index = 0; index < 100; index++) runtime.update([view]);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
    } finally { budget.release(competing); runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("keeps coverage and budget accounting when intermediate compaction fails validation", async () => {
    const { runtime, view, gl, budget, texture } = await harness(4096);
    const competing = {};
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => { runtime.update([view]); expect(runtime.runtimeSnapshot().residentPages).toBe(85); });
      expect(budget.tryClaim(competing, budget.availableBytes - 250 * 130 * 130 * 4)).toBe(true);
      view.viewport.width = view.viewport.height = 2048;
      let injected = false, original = runtime.automaticBinding(texture);
      await waitFor(() => {
        runtime.update([view]);
        const allocation = vi.mocked(gl.texStorage2D).mock.calls.at(-1)!;
        if (!injected && allocation[3] === 130 && allocation[4] === 130) {
          original = runtime.automaticBinding(texture);
          vi.mocked(gl.getError).mockReturnValueOnce(0x0505);
          injected = true;
        }
        expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(65);
        expect(budget.snapshot().retainedBytes).toBeLessThanOrEqual(budget.budgetBytes);
        expect(runtime.runtimeSnapshot().atlasGrowthFailures).toBe(1);
      });
      expect(injected).toBe(true);
      expect(runtime.automaticBinding(texture)).toBe(original);
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let frame = 0; frame < 100; frame++) runtime.update([view]);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
      expect(runtime.automaticBinding(texture)).toBe(original);
    } finally { budget.release(competing); runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("retries compaction when a late resource uploads the missing coarse coverage", async () => {
    const { runtime, view, gl, budget, texture } = await harness(4096);
    const competing = {}, second = imageTexture("https://example.test/second/vt.png");
    const factory = vi.mocked(automaticPageSources.createAutomaticRasterPageSource);
    const create = factory.getMockImplementation()!;
    let release!: () => void;
    factory.mockImplementation((...args) => {
      const source = create(...args);
      return { ...source, read: async (page, signal) => {
        if (page.mip === source.layout.mipCount - 1) await new Promise<void>(resolve => { release = resolve; });
        return source.read(page, signal);
      } };
    });
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => { runtime.update([view]); expect(runtime.runtimeSnapshot().residentPages).toBe(85); });
      expect(budget.tryClaim(competing, budget.availableBytes - 250 * 130 * 130 * 4)).toBe(true);
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [texture, second].map(asset =>
        mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })),
      })));
      view.viewport.width = view.viewport.height = 2048;
      await waitFor(() => {
        runtime.update([view]);
        expect(release).toBeDefined();
        expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 642, pendingPages: 1 });
        expect(runtime.runtimeSnapshot().atlasBytes).toBeGreaterThan(200 * 130 * 130 * 4);
      });
      // Let migration complete and the missing-root rejection become cached.
      for (let frame = 0; frame < 100; frame++) runtime.update([view]);
      const before = runtime.runtimeSnapshot().atlasBytes;
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let frame = 0; frame < 100; frame++) runtime.update([view]);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
      release();
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPages: 0, unresidentPages: 0 });
        expect(runtime.runtimeSnapshot().atlasBytes).toBeGreaterThan(before);
      });
      expect(runtime.automaticBinding(texture)).toBeDefined();
      expect(runtime.automaticBinding(second)).toBeDefined();
    } finally { release?.(); budget.release(competing); runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("retries a budget-limited growth when another allocation releases its claim", async () => {
    const { runtime, view, gl, budget } = await harness();
    const plan = vi.spyOn(storagePlans, "planVirtualTextureAtlasStorage");
    const competing = {};
    expect(budget.tryClaim(competing, budget.availableBytes - 1024)).toBe(true);
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      for (let i = 0; i < 3; i++) expect(runtime.update([view]).pending).toBe(false);
      expect(plan).toHaveBeenCalledTimes(1);
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      const reads = runtime.runtimeSnapshot().pageRequests;
      for (let i = 0; i < 100; i++) expect(runtime.update([view]).pending).toBe(false);
      expect(plan).toHaveBeenCalledTimes(1);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
      expect(runtime.runtimeSnapshot().pageRequests).toBe(reads);
      expect(gl.copyTexSubImage2D).not.toHaveBeenCalled();
      expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 81, admittedPages: 5, atlasGrowthFailures: 0 });
      budget.release(competing);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0 });
      });
      expect(plan.mock.calls.length).toBeGreaterThan(1);
    } finally { plan.mockRestore(); budget.release(competing); runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("recollects a complete coarser footprint when raw demand exceeds the workspace", async () => {
    const { runtime, view } = await harness(4096);
    try {
      view.viewport.width = 4096;
      view.viewport.height = 4096;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 321, admittedPages: 321, residentPages: 325, unresidentPages: 0, pendingPages: 0 });
      });
    } finally { runtime.dispose(); }
  });

  it("preserves the old binding through bounded GPU copies and never rereads resident pages", async () => {
    const { runtime, view, gl, budget, texture } = await harness();
    try {
      const initial = runtime.automaticBinding(texture)!;
      const initialBytes = runtime.runtimeSnapshot().atlasBytes;
      expect(initialBytes).toBe(8 * 130 * 130 * 4);
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      const first = runtime.update([view]);
      expect(first.pending).toBe(true);
      expect(gl.copyTexSubImage2D).not.toHaveBeenCalled();
      runtime.update([view]);
      runtime.update([view]);
      expect(copiedPages(gl)).toBe(5);
      expect(runtime.automaticBinding(texture)).toBe(initial);
      // Both textures are accounted until the atomic binding/page-table swap.
      expect(runtime.runtimeSnapshot().atlasBytes).toBe((8 + 128) * 130 * 130 * 4);
      expect(budget.snapshot().retainedBytes).toBeGreaterThan(runtime.runtimeSnapshot().atlasBytes);
      runtime.update([view]);
      // All five pages fit the copy byte allowance. Fence on the next turn,
      // retaining the old binding until validation succeeds.
      expect(runtime.automaticBinding(texture)).toBe(initial);
      runtime.update([view]);
      expect(runtime.automaticBinding(texture)!.atlas.texture).not.toBe(initial.atlas.texture);
      expect(runtime.runtimeSnapshot().atlasBytes).toBe(128 * 130 * 130 * 4);
      await waitFor(() => {
        const uploads = runtime.runtimeSnapshot().uploadedPages;
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().uploadedPages - uploads).toBeLessThanOrEqual(4);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, pendingPages: 0, unresidentPages: 0 });
      });
      expect(runtime.runtimeSnapshot()).toMatchObject({ pageRequests: 85, atlasGrowthFailures: 0 });
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it.each(["allocation", "copy"].flatMap(failure =>
    ["demand", "capacity"].map(recovery => ({ failure, recovery }))))(
    "retains coverage after $failure failure and retries on changed $recovery", async ({ failure, recovery }) => {
    const { runtime, view, gl, budget, texture } = await harness();
    const otherAllocation = {};
    expect(budget.tryClaim(otherAllocation, 1024 * 1024)).toBe(true);
    const original = runtime.automaticBinding(texture);
    const retained = budget.snapshot().retainedBytes;
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      if (failure === "allocation") vi.mocked(gl.getError).mockReturnValueOnce(0x0505);
      else gl.copyTexSubImage2D.mockImplementationOnce(() => { throw new Error("copy failed"); });
      runtime.update([view]);
      runtime.update([view]);
      runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(original);
      expect(budget.snapshot().retainedBytes).toBe(retained);
      expect(runtime.runtimeSnapshot().atlasGrowthFailures).toBe(1);
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let i = 0; i < 5; i++) runtime.update([view]);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, atlasGrowthFailures: 1 });
      if (recovery === "demand") view.viewport.width = view.viewport.height = 512;
      else budget.release(otherAllocation);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({
          residentPages: recovery === "demand" ? 21 : 85,
          pendingPages: 0, unresidentPages: 0, atlasGrowthFailures: 1,
        });
      });
      expect(runtime.automaticBinding(texture)).not.toBe(original);
    } finally { runtime.dispose(); budget.release(otherAllocation); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it.each(["dispose", "invalidate", "view"].flatMap((action) => [1, 2, 3, 4].map((frames) => ({ action, frames }))))(
    "releases an unfinished replacement on $action after $frames frames", async ({ action, frames }) => {
    const { runtime, view, gl, budget, texture } = await harness();
    const before = budget.snapshot().retainedBytes;
    const binding = runtime.automaticBinding(texture);
    view.viewport.width = 1024;
    view.viewport.height = 1024;
    for (let i = 0; i < frames; i++) runtime.update([view]);
    expect(budget.snapshot().retainedBytes).toBeGreaterThan(before);
    const deletedSyncs = vi.mocked(gl.deleteSync).mock.calls.length;
    if (action === "view") {
      view.viewport.width = 256;
      view.viewport.height = 256;
      runtime.update([view]);
      expect(runtime.automaticBinding(texture)).toBe(binding);
      expect(budget.snapshot().retainedBytes).toBe(before);
    } else {
      if (action === "dispose") runtime.dispose();
      else runtime.invalidate();
      expect(budget.snapshot().retainedBytes).toBe(0);
    }
    if ((frames === 2 || frames === 4) && action !== "invalidate") expect(gl.deleteSync).toHaveBeenCalledTimes(deletedSyncs + 1);
    runtime.dispose();
    expect(budget.snapshot().retainedBytes).toBe(0);
  });
});
