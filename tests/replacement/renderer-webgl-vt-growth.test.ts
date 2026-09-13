import { afterEach, describe, expect, it, vi } from "vitest";
import { imageTexture, mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from "@royal/renderer-core";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { fakeGl } from "./support/canvas-root-harness";
import * as automaticPageSources from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";
import * as storagePlans from "../../packages/renderer-webgl/src/virtual-texture/storage-plan";
import { parseVirtualTextureManifest } from "../../packages/renderer-webgl/src/virtual-texture/manifest";
import { createKtx2Fixture } from "./support/ktx2-fixture";
import { waitFor } from "./support/wait-for";

afterEach(() => vi.unstubAllGlobals());

const harness = async (virtualSize = 1024, budgetBytes?: number, maxTextureSize?: number) => {
  vi.stubGlobal("document", { baseURI: "https://example.test/" });
  vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => new Response(
    String(input).endsWith(".json") ? JSON.stringify({
      contractVersion: 2, pageSize: 128, borderTexels: 1, virtualSize: [virtualSize, virtualSize],
      pages: { uriTemplate: "{mip}-{x}-{y}.png" },
    }) : new Blob([new Uint8Array([1])]),
  )));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 130, height: 130, close: vi.fn() })));
  const texture = virtualTexture("https://example.test/vt.json");
  const gl = fakeGl();
  if (maxTextureSize !== undefined) {
    const getParameter = vi.mocked(gl.getParameter).getMockImplementation()!;
    vi.mocked(gl.getParameter).mockImplementation(name => name === gl.MAX_TEXTURE_SIZE ? maxTextureSize : getParameter(name));
  }
  Object.assign(gl, { texStorage2D: vi.fn() });
  const budget = new PersistentGpuBudgetOwner(budgetBytes);
  const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
  const matrix = identityMat4();
  const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
  runtime.setScene(prepareCanonicalSurfaceScene(scene({
    camera: perspectiveCamera({}), nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })],
  })));
  await waitFor(() => {
    runtime.update([view]);
    expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, pendingPages: 0 });
  });
  return { runtime, view, gl, budget, texture };
};

describe("demand-grown RGBA atlases", () => {
  it.each([
    [134, "ktx2-bc1"], [138, "ktx2-bc3"], [146, "ktx2-bc7"],
    [152, "ktx2-etc2"], [166, "ktx2-astc-6x6"], [172, "ktx2-astc-8x8"],
  ].flatMap(([vk, encoding]) => [false, true].map(nativeFirst => ({ vk: vk as number, encoding, nativeFirst }))))(
    "reserves image coverage beside $encoding, native first $nativeFirst", async ({ vk, encoding, nativeFirst }) => {
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    const blocks = createKtx2Fixture(vk, 144, 144);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const uri = String(input);
      return new Response(uri.endsWith(".json") ? JSON.stringify({
        contractVersion: 2, pageSize: 128, borderTexels: 8, virtualSize: [512, 512], mipCount: 3,
        pageEncoding: uri.includes("native") ? encoding : "image",
        pages: { uriTemplate: uri.includes("native") ? "{mip}-{x}-{y}.ktx2" : "{mip}-{x}-{y}.png" },
      }) : uri.endsWith(".ktx2") ? blocks.slice().buffer as ArrayBuffer : new Uint8Array([1]));
    }));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 144, height: 144, close: vi.fn() })));
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })),
      compressedTexSubImage2D: vi.fn() });
    const getParameter = vi.mocked(gl.getParameter).getMockImplementation()!;
    vi.mocked(gl.getParameter).mockImplementation(name => name === gl.MAX_TEXTURE_SIZE ? 16384 : getParameter(name));
    const budget = new PersistentGpuBudgetOwner(16 * 1024 * 1024);
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
    const native = virtualTexture("https://example.test/native.json");
    const image = virtualTexture("https://example.test/image.json");
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
    try {
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
        nodes: (nativeFirst ? [native, image] : [image, native]).map(texture =>
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 2, unresidentPages: 0, pendingPages: 0, failedPages: 0 });
        expect(runtime.snapshot(native).residentPages).toBeGreaterThan(0);
        expect(runtime.snapshot(image).residentPages).toBeGreaterThan(0);
      });
      expect(runtime.runtimeSnapshot().atlasBytes).toBeLessThanOrEqual(budget.budgetBytes * 0.75);
      expect(gl.compressedTexSubImage2D).toHaveBeenCalled();
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it.each(["ready", "ineligible", "removed", "denied", "failed"])("settles pending automatic coverage after %s and context invalidation", async outcome => {
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    const manifest = { contractVersion: 2, pageSize: 128, borderTexels: 2,
      virtualSize: [1024, 1024], pages: { uriTemplate: "{mip}-{x}-{y}.png" } };
    const factory = vi.spyOn(automaticPageSources, "createAutomaticRasterPageSource").mockImplementation(() => ({
      manifest: parseVirtualTextureManifest(manifest),
      read: async () => ({ kind: "image", source: { width: 132, height: 132 } as ImageBitmap, close: vi.fn() }),
    }));
    const blocks = createKtx2Fixture(172, 144, 144);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => new Response(
      String(input).endsWith(".json") ? JSON.stringify({ ...manifest, borderTexels: 8,
        pageEncoding: "ktx2-astc-8x8", pages: { uriTemplate: "{mip}-{x}-{y}.ktx2" },
      }) : blocks.slice().buffer as ArrayBuffer,
    )));
    const gl = fakeGl();
    const getParameter = vi.mocked(gl.getParameter).getMockImplementation()!;
    vi.mocked(gl.getParameter).mockImplementation(name => name === gl.MAX_TEXTURE_SIZE ? 16384 : getParameter(name));
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })), compressedTexSubImage2D: vi.fn() });
    const budget = new PersistentGpuBudgetOwner((outcome === "denied" || outcome === "failed") ? 64 * 1024 : 16 * 1024 * 1024);
    let ready = false;
    const decoded = { width: 1024, height: 1024, source: {} as ImageBitmap };
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget, undefined, {
      decoded: () => ready ? outcome === "failed" ? null : decoded : undefined,
      acquireDecoded: () => ({ source: decoded, release: vi.fn() }), onChanged: vi.fn(),
    });
    const native = virtualTexture("https://example.test/native.json");
    const automatic = imageTexture("https://example.test/pending.png");
    const setScene = (includeAutomatic = true) => runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
      nodes: (includeAutomatic ? [native, automatic] : [native]).map(texture => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
    })));
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
    try {
      setScene();
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(native)).toMatchObject({ status: "ready" });
        if (outcome === "denied" || outcome === "failed") expect(runtime.snapshot(native).residentPages).toBe(0);
        else expect(runtime.snapshot(native).residentPages).toBeGreaterThan(0);
        expect(runtime.runtimeSnapshot().automaticWaiting).toBe(1);
      });
      if (outcome === "denied" || outcome === "failed") {
        for (let frame = 0; frame < 100; frame++) runtime.update([view]);
        expect(runtime.snapshot(native)).toMatchObject({ status: "ready", residentPages: 0, failedPages: 0 });
        expect(gl.texStorage2D).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledOnce();
        expect(budget.snapshot().retainedBytes).toBe(0);
      }
      expect(factory).not.toHaveBeenCalled();
      const removed = outcome === "removed" || outcome === "denied";
      ready = !removed;
      if (outcome === "ineligible") decoded.width = decoded.height = 32;
      setScene(!removed);
      const settle = async () => waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: outcome === "ready" ? 2 : 1,
          automaticWaiting: 0, automaticResources: outcome === "ready" ? 1 : 0,
          automaticIneligible: outcome === "ineligible" || outcome === "failed" ? 1 : 0,
          unresidentPages: 0, pendingPages: 0, failedPages: 0 });
        expect(runtime.snapshot(native).residentPages).toBeGreaterThan(0);
      });
      await settle();
      const nativeFetches = vi.mocked(fetch).mock.calls.length;
      runtime.invalidate();
      await settle();
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(nativeFetches);
      expect(factory).toHaveBeenCalledTimes(outcome === "ready" ? 1 : 0);
      expect(runtime.runtimeSnapshot().atlasBytes).toBeLessThanOrEqual(budget.budgetBytes * 0.75);
    } finally { runtime.dispose(); factory.mockRestore(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("releases cached copy attachments and refreshes texture limits after context loss", async () => {
    const { runtime, view, gl, texture } = await harness();
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(texture).residentPages).toBe(85);
      });
      const limitQueries = () => vi.mocked(gl.getParameter).mock.calls.filter(([name]) => name === gl.MAX_TEXTURE_SIZE).length;
      expect(limitQueries()).toBe(1);
      expect(gl.createFramebuffer).toHaveBeenCalled();
      expect(vi.mocked(gl.deleteFramebuffer).mock.calls.length).toBe(vi.mocked(gl.createFramebuffer).mock.calls.length);
      runtime.invalidate();
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(texture).residentPages).toBe(85);
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
          expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 341, unresidentPages: 0 });
          expect(runtime.snapshot(texture).residentPages).toBeGreaterThanOrEqual(85);
        });
        const binding = runtime.binding(texture);
        const retainedBytes = budget.snapshot().retainedBytes;
        const other = virtualTexture({ manifestUri: "https://example.test/other.json", colorSpace: "linear" });
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
        expect(runtime.binding(texture)).toBe(binding);
        expect(budget.snapshot().retainedBytes).toBeLessThanOrEqual(budget.budgetBytes);
        if (action === "cancel") {
          setAssets([texture]);
          runtime.update([view]);
          expect(runtime.binding(texture)).toBe(binding);
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
            expect(runtime.snapshot(other).residentPages).toBeGreaterThan(0);
            expect(runtime.snapshot(texture).residentPages).toBeGreaterThan(0);
          });
        }
      } finally { runtime.dispose(); }
      expect(budget.snapshot().retainedBytes).toBe(0);
    },
  );

  it("does not reserve coarse coverage for an unallocated offscreen pool", async () => {
    const { runtime, view, texture } = await harness(1024, 16 * 1024 * 1024);
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("hidden.json")
      ? new Response(JSON.stringify({ contractVersion: 2, pageSize: 2048, borderTexels: 2,
          virtualSize: [4096, 4096], pages: { uriTemplate: "hidden-{mip}-{x}-{y}.png" } }))
      : original(input));
    const hidden = virtualTexture("https://example.test/hidden.json");
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
        expect(runtime.snapshot(hidden).status).toBe("ready");
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
        expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 341, unresidentPages: 0 });
      });
      const others = ["second", "third"].map(name => virtualTexture(`https://example.test/${name}.json`));
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [texture, ...others].map(asset =>
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })),
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, unresidentPages: 0 });
        for (const asset of [texture, ...others]) expect(runtime.snapshot(asset).residentPages).toBeGreaterThanOrEqual(21);
      });
    } finally { runtime.dispose(); }
  });

  it("shares a saturated budget with a newly visible incompatible pool", async () => {
    const { runtime, view, texture } = await harness(4096, 16 * 1024 * 1024);
    try {
      view.viewport.width = view.viewport.height = 2048;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 341, unresidentPages: 0 });
      });
      const other = virtualTexture({ manifestUri: "https://example.test/other.json", colorSpace: "linear" });
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [texture, other].map(asset =>
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })),
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 2, unresidentPages: 0 });
        expect(runtime.snapshot(texture).residentPages).toBeGreaterThanOrEqual(85);
        expect(runtime.snapshot(other).residentPages).toBeGreaterThanOrEqual(85);
      });
      expect(runtime.runtimeSnapshot().atlasGrowthFailures).toBe(0);
    } finally { runtime.dispose(); }
  });

  it("keeps shrink hysteresis when a new pool has ample budget", async () => {
    const { runtime, view, texture } = await harness();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      });
      const original = runtime.binding(texture)!;
      const other = virtualTexture({ manifestUri: "https://example.test/other.json", colorSpace: "linear" });
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
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      expect(runtime.binding(texture)).toBe(original);
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
      clock.mockReturnValue(2001);
      runtime.update([view]);
      vi.mocked(gl.clientWaitSync).mockReturnValue(gl.TIMEOUT_EXPIRED);
      const other = virtualTexture({ manifestUri: "https://example.test/other.json", colorSpace: "linear" });
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

  it("keeps all old residency when a shrink copy fails and does not retry unchanged pressure", async () => {
    const { runtime, view, texture, gl, budget } = await harness();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      });
      const large = runtime.binding(texture)!;
      const retained = budget.snapshot().retainedBytes;
      view.viewport.width = view.viewport.height = 256;
      runtime.update([view]);
      clock.mockReturnValue(2001);
      gl.copyTexSubImage2D.mockImplementationOnce(() => { throw new Error("copy failed"); });
      for (let frame = 0; frame < 3; frame++) runtime.update([view]);
      expect(runtime.binding(texture)).toBe(large);
      expect(budget.snapshot().retainedBytes).toBe(retained);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0, atlasGrowthFailures: 1 });
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let frame = 0; frame < 5; frame++) runtime.update([view]);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
    } finally { runtime.dispose(); clock.mockRestore(); }
  });

  it("reclaims spare capacity for an incompatible pool without waiting for the idle delay", async () => {
    const { runtime, view, texture, budget } = await harness(1024, 16 * 1024 * 1024);
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0 });
      });
      const large = runtime.binding(texture)!;
      const other = virtualTexture({ manifestUri: "https://example.test/other.json", colorSpace: "linear" });
      runtime.setScene(prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}), nodes: [
          mesh({ geometry: planeGeometry(0.5), material: unlitMaterial({ texture }) }),
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: other }) }),
        ],
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 2, desiredPages: 90, unresidentPages: 0 });
        expect(runtime.binding(texture)!.atlas.texture).not.toBe(large.atlas.texture);
        expect(runtime.binding(other)).toBeDefined();
      });
      expect(runtime.runtimeSnapshot().atlasGrowthFailures).toBe(0);
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
        expect(runtime.binding(texture)).toBeUndefined();
      }
      budget.release(blocker);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, unresidentPages: 0 });
      });
    } finally { budget.release(blocker); runtime.dispose(); }
  });

  it("shrinks sustained low demand by compacting resident pages without rereading them", async () => {
    const { runtime, view, texture, budget } = await harness();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0 });
      });
      const large = runtime.binding(texture)!;
      const retained = budget.snapshot().retainedBytes;
      const requests = runtime.runtimeSnapshot().pageRequests;
      view.viewport.width = view.viewport.height = 256;
      runtime.update([view]);
      expect(runtime.binding(texture)).toBe(large);
      clock.mockReturnValue(1999);
      runtime.update([view]);
      expect(runtime.binding(texture)).toBe(large);
      clock.mockReturnValue(2001);
      runtime.update([view]);
      expect(runtime.binding(texture)).toBe(large);
      expect(budget.snapshot().retainedBytes).toBeGreaterThan(retained);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.binding(texture)!.atlas.texture).not.toBe(large.atlas.texture);
      });
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 8, unresidentPages: 0, pageRequests: requests });
      expect(budget.snapshot().retainedBytes).toBeLessThan(retained);
    } finally { runtime.dispose(); clock.mockRestore(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("cancels a pending shrink when the view needs the larger atlas again", async () => {
    const { runtime, view, texture, budget } = await harness();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      view.viewport.width = view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().residentPages).toBe(85);
      });
      const large = runtime.binding(texture)!;
      const retained = budget.snapshot().retainedBytes;
      view.viewport.width = view.viewport.height = 256;
      runtime.update([view]);
      clock.mockReturnValue(2001);
      runtime.update([view]);
      expect(budget.snapshot().retainedBytes).toBeGreaterThan(retained);
      view.viewport.width = view.viewport.height = 1024;
      runtime.update([view]);
      expect(runtime.binding(texture)).toBe(large);
      expect(budget.snapshot().retainedBytes).toBe(retained);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0 });
    } finally { runtime.dispose(); clock.mockRestore(); }
  });

  it("keeps existing page coordinates and tables when growth fits below the old rows", async () => {
    const { runtime, view, gl, texture } = await harness(1024, undefined, 16384);
    const original = runtime.binding(texture)!;
    gl.texSubImage2D.mockClear();
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      for (let frame = 0; frame < 7; frame++) runtime.update([view]);
      const grown = runtime.binding(texture)!;
      expect(grown.atlas.texture).not.toBe(original.atlas.texture);
      expect(grown.settings1[0]).toBe(original.settings1[0]);
      expect(grown.settings1[1]).toBeGreaterThan(original.settings1[1]!);
      expect(grown.pageTable.texture).toBe(original.pageTable.texture);
      expect(gl.texSubImage2D).not.toHaveBeenCalled();
      expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(5);
    } finally { runtime.dispose(); }
  });

  it("keeps drawing the old atlas while allocation is incomplete, without blocking error queries", async () => {
    const { runtime, view, gl, texture } = await harness();
    const original = runtime.binding(texture);
    vi.mocked(gl.getError).mockClear();
    vi.mocked(gl.clientWaitSync).mockReturnValue(gl.TIMEOUT_EXPIRED);
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      for (let i = 0; i < 5; i++) {
        expect(runtime.update([view]).pending).toBe(true);
        expect(runtime.binding(texture)).toBe(original);
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
    const original = runtime.binding(texture);
    const retained = budget.snapshot().retainedBytes;
    if (failure === "creation") vi.mocked(gl.fenceSync).mockReturnValueOnce(null);
    else vi.mocked(gl.clientWaitSync).mockReturnValue(failure === "failed" ? gl.WAIT_FAILED : gl.TIMEOUT_EXPIRED);
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      for (let i = 0; i < 125; i++) runtime.update([view]);
      expect(runtime.binding(texture)).toBe(original);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, atlasGrowthFailures: 1 });
      expect(gl.copyTexSubImage2D).not.toHaveBeenCalled();
      expect(budget.snapshot().retainedBytes).toBe(retained);
    } finally { runtime.dispose(); }
  });

  it("validates asynchronous copy errors before publishing the replacement", async () => {
    const { runtime, view, gl, budget, texture } = await harness();
    const original = runtime.binding(texture);
    const retained = budget.snapshot().retainedBytes;
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      runtime.update([view]);
      runtime.update([view]);
      runtime.update([view]);
      expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(4);
      expect(runtime.binding(texture)).toBe(original);
      vi.mocked(gl.getError).mockReturnValueOnce(0x0505);
      runtime.update([view]);
      runtime.update([view]);
      runtime.update([view]);
      expect(runtime.binding(texture)).toBe(original);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, atlasGrowthFailures: 1 });
      expect(budget.snapshot().retainedBytes).toBe(retained);
      expect(gl.deleteSync).toHaveBeenCalledTimes(2);
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
        runtime.update([view]);
        const snapshot = runtime.runtimeSnapshot();
        coarse ||= snapshot.residentPages === 1;
        expect(runtime.binding(texture)).toBeDefined();
        expect(snapshot.residentPages).toBeGreaterThan(0);
        expect(budget.snapshot().retainedBytes).toBeLessThanOrEqual(budget.budgetBytes);
        expect(snapshot).toMatchObject({ desiredPages: 341, admittedPages: 341, residentPages: 341, pendingPages: 0, unresidentPages: 0 });
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
      let injected = false, original = runtime.binding(texture);
      await waitFor(() => {
        runtime.update([view]);
        const allocation = vi.mocked(gl.texStorage2D).mock.calls.at(-1)!;
        if (!injected && allocation[3] === 130 && allocation[4] === 130) {
          original = runtime.binding(texture);
          vi.mocked(gl.getError).mockReturnValueOnce(0x0505);
          injected = true;
        }
        expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThanOrEqual(85);
        expect(budget.snapshot().retainedBytes).toBeLessThanOrEqual(budget.budgetBytes);
        expect(runtime.runtimeSnapshot().atlasGrowthFailures).toBe(1);
      });
      expect(injected).toBe(true);
      expect(runtime.binding(texture)).toBe(original);
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let frame = 0; frame < 100; frame++) runtime.update([view]);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
      expect(runtime.binding(texture)).toBe(original);
    } finally { budget.release(competing); runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("retries compaction when a late resource uploads the missing coarse coverage", async () => {
    const { runtime, view, gl, budget, texture } = await harness(4096);
    const competing = {}, second = virtualTexture("https://example.test/second/vt.json");
    const read = vi.mocked(fetch).getMockImplementation()!;
    let release!: () => void;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).includes("/second/5-0-0.png")) await new Promise<void>(resolve => { release = resolve; });
      return read(input, init);
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
        expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 682, pendingPages: 1 });
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
      expect(runtime.binding(texture)).toBeDefined();
      expect(runtime.binding(second)).toBeDefined();
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
      const reads = vi.mocked(fetch).mock.calls.length;
      for (let i = 0; i < 100; i++) expect(runtime.update([view]).pending).toBe(false);
      expect(plan).toHaveBeenCalledTimes(1);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
      expect(vi.mocked(fetch).mock.calls.length).toBe(reads);
      expect(gl.copyTexSubImage2D).not.toHaveBeenCalled();
      expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 85, admittedPages: 5, atlasGrowthFailures: 0 });
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
        expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 341, admittedPages: 341, residentPages: 341, unresidentPages: 0, pendingPages: 0 });
      });
    } finally { runtime.dispose(); }
  });

  it("preserves the old binding through bounded GPU copies and never rereads resident pages", async () => {
    const { runtime, view, gl, budget, texture } = await harness();
    try {
      const initial = runtime.binding(texture)!;
      const initialBytes = runtime.runtimeSnapshot().atlasBytes;
      expect(initialBytes).toBe(8 * 130 * 130 * 4);
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      const first = runtime.update([view]);
      expect(first.pending).toBe(true);
      expect(gl.copyTexSubImage2D).not.toHaveBeenCalled();
      runtime.update([view]);
      runtime.update([view]);
      expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(4);
      expect(runtime.binding(texture)).toBe(initial);
      // Both textures are accounted until the atomic binding/page-table swap.
      expect(runtime.runtimeSnapshot().atlasBytes).toBe((8 + 128) * 130 * 130 * 4);
      expect(budget.snapshot().retainedBytes).toBeGreaterThan(runtime.runtimeSnapshot().atlasBytes);
      const fences = vi.mocked(gl.fenceSync).mock.calls.length;
      runtime.update([view]);
      // The next frame submits the remaining page rather than fencing and
      // waiting for the first batch. The original binding stays drawable.
      expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(5);
      expect(gl.fenceSync).toHaveBeenCalledTimes(fences);
      runtime.update([view]);
      expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(5);
      expect(runtime.binding(texture)).toBe(initial);
      runtime.update([view]);
      runtime.update([view]);
      expect(runtime.binding(texture)!.atlas.texture).not.toBe(initial.atlas.texture);
      expect(runtime.runtimeSnapshot().atlasBytes).toBe(128 * 130 * 130 * 4);
      await waitFor(() => {
        const copies = gl.copyTexSubImage2D.mock.calls.length;
        const uploads = runtime.runtimeSnapshot().uploadedPages;
        runtime.update([view]);
        expect(gl.copyTexSubImage2D.mock.calls.length - copies + runtime.runtimeSnapshot().uploadedPages - uploads).toBeLessThanOrEqual(4);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, pendingPages: 0, unresidentPages: 0 });
      });
      expect(runtime.runtimeSnapshot()).toMatchObject({ pageRequests: 85, atlasGrowthFailures: 0 });
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it.each(["allocation", "copy"])("retains coverage and avoids retry loops on %s failure", async (failure) => {
    const { runtime, view, gl, budget, texture } = await harness();
    const original = runtime.binding(texture);
    const retained = budget.snapshot().retainedBytes;
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      if (failure === "allocation") vi.mocked(gl.getError).mockReturnValueOnce(0x0505);
      else gl.copyTexSubImage2D.mockImplementationOnce(() => { throw new Error("copy failed"); });
      runtime.update([view]);
      runtime.update([view]);
      runtime.update([view]);
      expect(runtime.binding(texture)).toBe(original);
      expect(budget.snapshot().retainedBytes).toBe(retained);
      expect(runtime.runtimeSnapshot().atlasGrowthFailures).toBe(1);
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let i = 0; i < 5; i++) runtime.update([view]);
      expect(vi.mocked(gl.texStorage2D).mock.calls.length).toBe(allocations);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, atlasGrowthFailures: 1 });
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it.each(["dispose", "invalidate", "view"].flatMap((action) => [1, 2, 3, 4, 5].map((frames) => ({ action, frames }))))(
    "releases an unfinished replacement on $action after $frames frames", async ({ action, frames }) => {
    const { runtime, view, gl, budget, texture } = await harness();
    const before = budget.snapshot().retainedBytes;
    const binding = runtime.binding(texture);
    view.viewport.width = 1024;
    view.viewport.height = 1024;
    for (let i = 0; i < frames; i++) runtime.update([view]);
    expect(budget.snapshot().retainedBytes).toBeGreaterThan(before);
    const deletedSyncs = vi.mocked(gl.deleteSync).mock.calls.length;
    if (action === "view") {
      view.viewport.width = 256;
      view.viewport.height = 256;
      runtime.update([view]);
      expect(runtime.binding(texture)).toBe(binding);
      expect(budget.snapshot().retainedBytes).toBe(before);
    } else {
      if (action === "dispose") runtime.dispose();
      else runtime.invalidate();
      expect(budget.snapshot().retainedBytes).toBe(0);
    }
    if ((frames === 2 || frames === 5) && action !== "invalidate") expect(gl.deleteSync).toHaveBeenCalledTimes(deletedSyncs + 1);
    runtime.dispose();
    expect(budget.snapshot().retainedBytes).toBe(0);
  });
});
