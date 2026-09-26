import * as demand from "../../packages/renderer-webgl/src/virtual-texture/demand";
import { afterEach, expect, it, vi } from "vitest";
import { imageTexture, mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial } from "@royal/renderer-core";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { createGeneratedVirtualTextureLayout, type VirtualTexturePageId } from "../../packages/renderer-webgl/src/virtual-texture/layout";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { identityMat4, type MutableMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import * as sources from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";
import { fakeGl } from "./support/canvas-root-harness";
import { waitFor } from "./support/wait-for";

afterEach(() => vi.restoreAllMocks());
const harness = (count = 1, gate?: (page: VirtualTexturePageId, signal: AbortSignal) => Promise<void>) => {
  const read = vi.fn(async (page: VirtualTexturePageId, signal: AbortSignal) => {
    await gate?.(page, signal);
    return { kind: "image" as const, source: { width: 132, height: 132 } as ImageBitmap, close: vi.fn() };
  });
  vi.spyOn(sources, "createAutomaticRasterPageSource").mockImplementation((_source, _sampler, colorSpace) => ({
    layout: createGeneratedVirtualTextureLayout({ width: 1024, height: 1024, pageSize: 128, borderTexels: 2, colorSpace }), read,
  }));
  const decoded = { width: 1024, height: 1024, source: {} as ImageBitmap };
  const assets = Array.from({ length: count }, (_, i) => imageTexture(`/texture-${i}.png`));
  const gl = fakeGl();
  const runtime = createBrowserVirtualTextureRuntime(gl, undefined, undefined, {
    decoded: () => decoded, acquireDecoded: () => ({ source: decoded, release: vi.fn() }), onChanged: vi.fn(),
  });
  const setAssets = (textures = assets) => runtime.setScene(prepareCanonicalSurfaceScene(scene({
    camera: perspectiveCamera({}), nodes: textures.map(texture => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
  })));
  setAssets();
  const matrix = identityMat4();
  const view = { view: matrix, viewProjection: matrix, viewport: { width: 512, height: 512, x: 0, y: 0 } };
  return { runtime, gl, view, assets, read, setAssets };
};

it("cancels generated page work when projected demand disappears and resumes on return", async () => {
  const signals: AbortSignal[] = [];
  const h = harness(1, async (_page, signal) => {
    signals.push(signal);
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  try {
    h.runtime.update([h.view]);
    await waitFor(() => expect(signals).toHaveLength(1));
    const hidden = identityMat4(); hidden[12] = 100;
    h.runtime.update([{ ...h.view, viewProjection: hidden }]);
    expect(signals[0]!.aborted).toBe(true);
    await waitFor(() => expect(h.runtime.runtimeSnapshot().pendingPageBytes).toBe(0));
    h.runtime.update([h.view]);
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[1]!.aborted).toBe(false);
  } finally { h.runtime.dispose(); }
});

it("gives every visible texture coarse coverage and detail without camera movement", async () => {
  const h = harness(30);
  try {
    await vi.waitFor(() => {
      h.runtime.update([h.view]);
      for (const asset of h.assets) expect(h.runtime.automaticBinding(asset)).toBeDefined();
      expect(h.runtime.runtimeSnapshot()).toMatchObject({ pendingPages: 0, unresidentPages: 0, failedPages: 0 });
    }, { interval: 1, timeout: 4000 });
    expect(h.runtime.runtimeSnapshot().residentPages).toBeGreaterThan(h.assets.length);
  } finally { h.runtime.dispose(); }
});

it("does not allocate offscreen pages and closes late results after disposal", async () => {
  let release!: () => void;
  const h = harness(1, () => new Promise<void>(resolve => { release = resolve; }));
  const hidden = identityMat4(); hidden[12] = 100;
  h.runtime.update([{ ...h.view, viewProjection: hidden }]);
  expect(h.gl.texStorage2D).not.toHaveBeenCalled();
  expect(h.read).not.toHaveBeenCalled();
  h.runtime.update([h.view]);
  await waitFor(() => expect(release).toBeDefined());
  h.runtime.dispose(); release();
  await waitFor(() => expect(h.runtime.runtimeSnapshot().pendingPages).toBe(0));
  const page = await h.read.mock.results[0]!.value;
  await waitFor(() => expect(page.close).toHaveBeenCalledOnce());
  expect(h.gl.texSubImage2D).not.toHaveBeenCalled();
});

it("keeps committed coarse coverage when a detail upload fails", async () => {
  const h = harness();
  try {
    h.view.viewport.width = h.view.viewport.height = 32;
    await waitFor(() => { h.runtime.update([h.view]); expect(h.runtime.automaticBinding(h.assets[0]!)).toBeDefined(); });
    let failed = false;
    vi.mocked(h.gl.texSubImage2D).mockImplementation((...args) => {
      if (args.length === 7 && !failed) { failed = true; throw new Error("injected raster upload failure"); }
    });
    h.view.viewport.width = h.view.viewport.height = 512;
    await waitFor(() => {
      try { h.runtime.update([h.view]); } catch (error) {
        expect(String(error)).toContain("injected raster upload failure");
      }
      expect(failed).toBe(true);
    });
    expect(h.runtime.automaticBinding(h.assets[0]!)).toBeDefined();
    expect(h.runtime.runtimeSnapshot().residentPages).toBeGreaterThan(0);
    await waitFor(() => {
      h.runtime.update([h.view]);
      expect(h.runtime.runtimeSnapshot()).toMatchObject({ pendingPages: 0, unresidentPages: 0 });
    });
  } finally { h.runtime.dispose(); }
});


it("keeps demand work pending across chunks, captures views, and refits without rescanning geometry", async () => {
  const h = harness();
  const collect = demand.collectVirtualTextureDemandSteps;
  const visits = vi.spyOn(demand, "collectVirtualTextureDemandSteps").mockImplementation(function* (...args) {
    yield;
    yield;
    yield* collect(...args);
  });
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now += 5);
  try {
    expect(h.runtime.update([h.view]).pending).toBe(true);
    expect(h.runtime.runtimeSnapshot()).toMatchObject({ pendingDemandResources: 1, desiredPages: 0 });
    const captured = visits.mock.calls[0]![3][0]!;
    h.view.viewProjection[12] = 0.1;
    expect(captured.viewProjection[12]).toBe(0);
    clock.mockRestore();
    await waitFor(() => {
      h.runtime.update([h.view]);
      expect(h.runtime.runtimeSnapshot().pendingDemandResources ?? 0).toBe(0);
      expect(h.runtime.runtimeSnapshot().pendingPages).toBe(0);
      expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
      expect(h.runtime.automaticBinding(h.assets[0]!)).toBeDefined();
    });
    // One old-view traversal completes without starvation; then the latest view.
    expect(visits).toHaveBeenCalledTimes(2);
    const calls = visits.mock.calls.length;
    for (let frame = 0; frame < 10; frame++) h.runtime.update([h.view]);
    expect(visits).toHaveBeenCalledTimes(calls);
    h.runtime.invalidateSceneGeometry();
    h.runtime.update([h.view]);
    expect(visits).toHaveBeenCalledTimes(calls + 1);
  } finally { clock.mockRestore(); h.runtime.dispose(); }
});

it.each(["transforms", "scene"])("%s animation must not permanently starve demand", (kind) => {
 const h = harness();
 const collect = demand.collectVirtualTextureDemandSteps;
 vi.spyOn(demand, "collectVirtualTextureDemandSteps").mockImplementation(function* (...args) { yield; yield; yield* collect(...args); });
 let now = 0;
 vi.spyOn(performance, "now").mockImplementation(() => now += 5);
 try {
  for (let frame=0;frame<120;frame++) {
   if (kind === "scene") h.setAssets();
   else h.runtime.invalidateSceneGeometry();
   h.runtime.update([h.view]);
  }
  expect(h.runtime.runtimeSnapshot().desiredPages).toBeGreaterThan(0);
 } finally { h.runtime.dispose(); }
});

it.each([false, true])("finishes captured transforms before scanning newer geometry (instanced=%s)", (instanced) => {
  const h = harness();
  const canonical = prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [
    mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: h.assets[0]! }) }),
  ] }));
  const retained = instanced ? { ...canonical, surfaces: canonical.surfaces.map(surface => ({
    ...surface, instances: { key: "captured", count: 1, localModels: new Float32Array(identityMat4()) },
  })) } : canonical;
  h.runtime.setScene(retained);
  const collect = demand.collectVirtualTextureDemandSteps;
  const visits = vi.spyOn(demand, "collectVirtualTextureDemandSteps").mockImplementation(function* (...args) {
    yield; yield; yield* collect(...args);
  });
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now += 5);
  try {
    h.runtime.update([h.view]);
    const captured = visits.mock.calls[0]![2][0]!;
    const live = retained.surfaces[0]!;
    (live.model as MutableMat4)[12] = 100;
    (live.worldBounds.min as [number, number, number])[0] = 99;
    (live.worldBounds.max as [number, number, number])[0] = 101;
    if (live.instances !== undefined) {
      live.instances.localModels[12] = 100;
      expect(captured.instances!.localModels[12]).toBe(0);
      expect(captured.instances).not.toBe(live.instances);
    }
    h.runtime.invalidateSceneGeometry();
    expect(captured.model[12]).toBe(0);
    expect(captured.worldBounds.min[0]).toBe(-1);
    h.runtime.update([h.view]);
    h.runtime.update([h.view]);
    expect(h.runtime.runtimeSnapshot().desiredPages).toBeGreaterThan(0);
    expect(visits).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) h.runtime.update([h.view]);
    expect(h.runtime.runtimeSnapshot().desiredPages).toBe(0);
    expect(h.runtime.runtimeSnapshot().pendingDemandResources ?? 0).toBe(0);
  } finally { h.runtime.dispose(); }
});

it("removing a resource during a paused traversal cannot publish it later", async () => {
  const h = harness(2);
  const collect = demand.collectVirtualTextureDemandSteps;
  vi.spyOn(demand, "collectVirtualTextureDemandSteps").mockImplementation(function* (...args) {
    yield; yield; yield* collect(...args);
  });
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now += 5);
  try {
    h.runtime.update([h.view]);
    h.setAssets([h.assets[1]!]);
    clock.mockRestore();
    await waitFor(() => {
      h.runtime.update([h.view]);
      expect(h.runtime.runtimeSnapshot().pendingDemandResources ?? 0).toBe(0);
      expect(h.runtime.automaticBinding(h.assets[1]!)).toBeDefined();
    });
    expect(h.runtime.automaticBinding(h.assets[0]!)).toBeUndefined();
  } finally { h.runtime.dispose(); }
});
it("context invalidation discards paused work and restores complete residency", async () => {
  const h = harness();
  try {
    await waitFor(() => { h.runtime.update([h.view]); expect(h.runtime.automaticBinding(h.assets[0]!)).toBeDefined(); });
    const collect = demand.collectVirtualTextureDemandSteps;
    vi.spyOn(demand, "collectVirtualTextureDemandSteps").mockImplementation(function* (...args) {
      yield; yield; yield* collect(...args);
    });
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now += 5);
    h.runtime.invalidateSceneGeometry();
    h.runtime.update([h.view]);
    h.runtime.invalidate();
    clock.mockRestore();
    await waitFor(() => {
      h.runtime.update([h.view]);
      expect(h.runtime.runtimeSnapshot().pendingDemandResources ?? 0).toBe(0);
      expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
      expect(h.runtime.automaticBinding(h.assets[0]!)).toBeDefined();
    });
  } finally { h.runtime.dispose(); }
});
it("empty views supersede paused visible work and settle without stale demand", () => {
  const h = harness();
  const collect = demand.collectVirtualTextureDemandSteps;
  vi.spyOn(demand, "collectVirtualTextureDemandSteps").mockImplementation(function* (...args) {
    yield; yield; yield* collect(...args);
  });
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now += 5);
  try {
    h.runtime.update([h.view]);
    for (let frame = 0; frame < 20; frame++) h.runtime.update([]);
    expect(h.runtime.runtimeSnapshot().pendingDemandResources ?? 0).toBe(0);
    expect(h.runtime.runtimeSnapshot().desiredPages).toBe(0);
  } finally { h.runtime.dispose(); }
});
