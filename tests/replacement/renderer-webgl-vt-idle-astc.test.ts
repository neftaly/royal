import { afterEach, expect, it, vi } from "vitest";
import { imageTexture, mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial } from "@royal/renderer-core";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { createGeneratedVirtualTextureLayout } from "../../packages/renderer-webgl/src/virtual-texture/layout";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import * as sources from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";
import { fakeGl } from "./support/canvas-root-harness";
import { writeVirtualTexturePageTable, COMPRESSED_SLOT_BASE } from "../../packages/renderer-webgl/src/virtual-texture/residency";

class EncoderWorker {
  static instances: EncoderWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  steps = 0;
  stopped = false;
  constructor() { EncoderWorker.instances.push(this); }
  postMessage(data: { type: string; id: number; bitmap?: ImageBitmap }): void {
    if (data.type === "cancel") return;
    if (data.type === "start") data.bitmap?.close();
    if (data.type === "step") this.steps++;
    queueMicrotask(() => {
      if (!this.stopped) this.onmessage?.({ data: data.type === "step"
        ? { id: data.id, type: "complete", blocks: new Uint8Array(7744) }
        : { id: data.id, type: "yield" } });
    });
  }
  terminate(): void { this.stopped = true; }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); EncoderWorker.instances = []; });

const harness = async (failAstcProbe = false) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let time = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("Worker", EncoderWorker);
  vi.stubGlobal("document", { baseURI: "https://example.test/" });
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 132, height: 132, close: vi.fn() })));
  const manifest = createGeneratedVirtualTextureLayout({ colorSpace: "srgb", pageSize: 128, borderTexels: 2, width: 1024, height: 1024 });
  let held = false;
  const gates: (() => void)[] = [];
  const read = vi.fn(async () => {
    if (held) await new Promise<void>(resolve => gates.push(resolve));
    return { kind: "image" as const, source: { width: 132, height: 132 } as HTMLCanvasElement, close: vi.fn() };
  });
  vi.spyOn(sources, "createAutomaticRasterPageSource").mockImplementation((_source, _sampler, colorSpace) => ({ layout: { ...manifest, colorSpace }, read }));
  const decoded = { width: 1024, height: 1024, source: {} as ImageBitmap };
  const asset = imageTexture("https://example.test/art.png");
  const gl = fakeGl();
  Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => { if (failAstcProbe) throw new Error("ASTC profile query failed"); return ["ldr"]; } })), compressedTexSubImage2D: vi.fn() });
  const budget = new PersistentGpuBudgetOwner();
  const runtime = createBrowserVirtualTextureRuntime(gl, budget, undefined, {
    decoded: () => decoded, acquireDecoded: () => ({ source: decoded, release: vi.fn() }), onChanged: vi.fn(),
  });
  const matrix = identityMat4();
  const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
  runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [
    mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) }),
  ] }), undefined, undefined, () => decoded));
  const frame = async (ms = 16) => { time += ms; await vi.advanceTimersByTimeAsync(ms); runtime.update([view]); };
  for (let i = 0; i < 20; i++) { runtime.update([view]); await Promise.resolve(); }
  expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThan(0);
  return { runtime, view, gl, budget, frame, asset, read, hold: () => { held = true; }, release: () => { held = false; for (const done of gates.splice(0)) done(); } };
};

it("compresses idle pages and actually reclaims RGBA storage without rerequesting demanded pages", async () => {
  const h = await harness();
  try {
    const before = h.runtime.runtimeSnapshot();
    for (let i = 0; i < 160; i++) await h.frame();
    const after = h.runtime.runtimeSnapshot();
    expect(after.idleAstcFailure).toBeUndefined();
    expect(after.idleAstcBytes).toBeGreaterThan(0);
    expect(after.idleAstcPixelHits).toBeGreaterThan(0);
    expect(after.retainedPagePixelBytes ?? 0).toBeLessThanOrEqual(8 * 132 * 132 * 4);
    expect(after.atlasBytes).toBeLessThan(before.atlasBytes);
    expect(after.residentPages).toBe(before.residentPages);
    expect(after.pageRequests).toBe(before.pageRequests);
    expect(after.unresidentPages).toBe(0);
    expect(h.runtime.automaticBinding(h.asset)?.compressedAtlas).toBeDefined();
    expect(EncoderWorker.instances.every(worker => worker.stopped)).toBe(true);
  } finally { h.runtime.dispose(); }
  expect(h.budget.snapshot().retainedBytes).toBe(0);
});

it("grants no encoder steps while newly demanded pages are being prepared", async () => {
  const h = await harness();
  try {
    await h.frame(52);
    h.hold(); h.view.viewport.width = h.view.viewport.height = 1024;
    h.runtime.update([h.view]);
    const steps = () => EncoderWorker.instances.reduce((sum, worker) => sum + worker.steps, 0);
    const before = steps();
    for (let i = 0; i < 10; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().pendingPages).toBeGreaterThan(0);
    expect(steps()).toBe(before);
    h.release();
    for (let i = 0; i < 400; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
    expect(steps()).toBeGreaterThan(before);
  } finally { h.release(); h.runtime.dispose(); }
  expect(h.budget.snapshot().retainedBytes).toBe(0);
});

it("encodes the atlas selector independently of inherited mip coverage", () => {
  const manifest = createGeneratedVirtualTextureLayout({ colorSpace: "srgb", pageSize: 128, borderTexels: 2, width: 256, height: 256 });
  const bytes = new Uint8Array(manifest.tableByteLength);
  writeVirtualTexturePageTable(manifest, new Map([[1, COMPRESSED_SLOT_BASE + 3], [0, 1]]), 2, bytes, 4);
  expect(Array.from(bytes.subarray(0, 4))).toEqual([1, 0, 0, 255]);
  expect(Array.from(bytes.subarray(4, 8))).toEqual([3, 0, 1, 128]);
});

it("admits fresh RGBA detail after the old RGBA pages have all been compressed", async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 160; i++) await h.frame();
    const requests = h.runtime.runtimeSnapshot().pageRequests;
    h.hold(); h.view.viewport.width = h.view.viewport.height = 1024;
    h.runtime.update([h.view]);
    // Foreground preparation can begin before any ASTC conversion of new detail.
    for (let i = 0; i < 20; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().pageRequests).toBeGreaterThan(requests);
    h.release();
    for (let i = 0; i < 100; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
    expect(h.runtime.runtimeSnapshot().idleAstcFailure).toBeUndefined();
  } finally { h.release(); h.runtime.dispose(); }
});

it("keeps RGBA coverage when compressed publication fails validation", async () => {
  const h = await harness();
  try {
    const before = h.runtime.runtimeSnapshot();
    const binding = h.runtime.automaticBinding(h.asset);
    vi.mocked(h.gl.compressedTexSubImage2D).mockImplementation(() => {
      vi.mocked(h.gl.getError).mockReturnValueOnce(h.gl.INVALID_OPERATION);
    });
    for (let i = 0; i < 80; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot()).toMatchObject({ residentPages: before.residentPages, unresidentPages: 0 });
    expect(h.runtime.runtimeSnapshot().idleAstcFailure).toBeDefined();
    expect(h.runtime.automaticBinding(h.asset)?.atlas).toBe(binding?.atlas);
    expect(h.runtime.runtimeSnapshot().idleAstcBytes).toBeUndefined();
  } finally { h.runtime.dispose(); }
  expect(h.budget.snapshot().retainedBytes).toBe(0);
});

it.each([3, 8, 20, 70])("releases worker and both GPU representations on disposal after %i frames", async frames => {
  const h = await harness();
  for (let i = 0; i < frames; i++) await h.frame();
  h.runtime.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.budget.snapshot().retainedBytes).toBe(0);
  expect(EncoderWorker.instances.every(worker => worker.stopped)).toBe(true);
});

it("discards compressed context storage and restores from original sources", async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 160; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().idleAstcBytes).toBeGreaterThan(0);
    h.runtime.invalidate();
    expect(h.budget.snapshot().retainedBytes).toBe(0);
    for (let i = 0; i < 160; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
    expect(h.runtime.runtimeSnapshot().idleAstcBytes).toBeGreaterThan(0);
  } finally { h.runtime.dispose(); }
});

it("retains uncompressed cached detail when zoom reverses during partial compression", async () => {
  const h = await harness();
  try {
    h.view.viewport.width = h.view.viewport.height = 1024;
    for (let i = 0; i < 500; i++) { h.runtime.update([h.view]); await Promise.resolve(); }
    const before = h.runtime.runtimeSnapshot();
    expect(before.unresidentPages).toBe(0);
    for (let i = 0; i < 10; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().idleAstcBytes).toBeGreaterThan(0);
    h.view.viewport.width = h.view.viewport.height = 256;
    for (let i = 0; i < 20; i++) { h.runtime.update([h.view]); await Promise.resolve(); }
    expect(h.runtime.runtimeSnapshot().residentPages).toBe(before.residentPages);
    h.view.viewport.width = h.view.viewport.height = 1024;
    h.runtime.update([h.view]);
    expect(h.runtime.runtimeSnapshot()).toMatchObject({ unresidentPages: 0, pageRequests: before.pageRequests });
  } finally { h.runtime.dispose(); }
});

it("does not regrow RGBA storage when cached mixed-format detail fits after compaction", async () => {
  const h = await harness();
  try {
    h.view.viewport.width = h.view.viewport.height = 1024;
    for (let i = 0; i < 500; i++) { h.runtime.update([h.view]); await Promise.resolve(); }
    const before = h.runtime.runtimeSnapshot();
    h.view.viewport.width = h.view.viewport.height = 256;
    h.runtime.update([h.view]);
    let compacted = false;
    for (let i = 0; i < 600; i++) {
      await h.frame();
      const state = h.runtime.runtimeSnapshot();
      if (state.atlasBytes - (state.idleAstcBytes ?? 0) < before.atlasBytes) { compacted = true; break; }
    }
    expect(compacted).toBe(true);
    const retained = h.runtime.runtimeSnapshot().atlasBytes;
    h.view.viewport.width = h.view.viewport.height = 1024;
    for (let i = 0; i < 10; i++) h.runtime.update([h.view]);
    const after = h.runtime.runtimeSnapshot();
    expect(after.admittedPages).toBe(after.desiredPages);
    expect(after.unresidentPages).toBe(0);
    expect(after.pageRequests).toBe(before.pageRequests);
    expect(after.atlasBytes).toBe(retained);
  } finally { h.runtime.dispose(); }
});

it("closes the copied bitmap when worker construction is rejected", async () => {
  const h = await harness();
  vi.stubGlobal("Worker", class { constructor() { throw new Error("Worker blocked"); } });
  try {
    for (let i = 0; i < 10; i++) await h.frame();
    const results = vi.mocked(createImageBitmap).mock.results;
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect((await result.value).close).toHaveBeenCalled();
    expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
  } finally { h.runtime.dispose(); }
});

it("backs off denied migration and resumes when GPU headroom returns", async () => {
  const h = await harness(), competing = {};
  expect(h.budget.tryClaim(competing, h.budget.availableBytes)).toBe(true);
  try {
    for (let i = 0; i < 30; i++) await h.frame();
    const denied = h.budget.snapshot().deniedClaims;
    expect(denied).toBeGreaterThan(0);
    expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
    for (let i = 0; i < 30; i++) await h.frame();
    expect(h.budget.snapshot().deniedClaims).toBe(denied);
    h.budget.release(competing);
    for (let i = 0; i < 160; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().idleAstcBytes).toBeGreaterThan(0);
    expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
  } finally { h.budget.release(competing); h.runtime.dispose(); }
  expect(h.budget.snapshot().retainedBytes).toBe(0);
});


it("releases retained foreground pixels exactly once after idle compression and disposal", async () => {
  const h = await harness();
  for (let i = 0; i < 160; i++) await h.frame();
  expect(h.runtime.runtimeSnapshot().retainedPagePixelBytes ?? 0).toBe(0);
  h.runtime.dispose();
  for (const result of h.read.mock.results) expect((await result.value).close).toHaveBeenCalledTimes(1);
});

it("discards retained foreground pixels when the optional encoder fails", async () => {
  const h = await harness();
  try {
    vi.stubGlobal("Worker", class { constructor() { throw new Error("worker unavailable"); } });
    for (let i = 0; i < 30; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().retainedPagePixelBytes ?? 0).toBe(0);
    expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
  } finally { h.runtime.dispose(); }
  for (const result of h.read.mock.results) expect((await result.value).close).toHaveBeenCalledTimes(1);
});


it("prepares bounded automatic detail during growth without publishing into the old atlas", async () => {
  const h = await harness();
  try {
    const before = h.runtime.runtimeSnapshot(), binding = h.runtime.automaticBinding(h.asset);
    h.view.viewport.width = h.view.viewport.height = 1024;
    h.runtime.update([h.view]); // replacement allocation only
    for (let i = 0; i < 100; i++) await Promise.resolve();
    const preparing = h.runtime.runtimeSnapshot();
    expect(preparing.pageRequests).toBeGreaterThan(before.pageRequests);
    expect(preparing.pendingPages).toBeGreaterThan(0);
    expect(preparing.pendingPages).toBeLessThanOrEqual(2);
    expect(preparing.pendingPageBytes).toBeLessThanOrEqual(preparing.pendingPageByteLimit);
    expect(preparing.uploadedPages).toBe(before.uploadedPages);
    expect(h.runtime.automaticBinding(h.asset)?.atlas.texture).toBe(binding?.atlas.texture);
    for (let i = 0; i < 100; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
  } finally { h.runtime.dispose(); }
});

it.each(["reverse", "failure", "remove", "context loss"])("releases growth-prepared detail after %s", async outcome => {
  const h = await harness();
  try {
    const before = h.runtime.runtimeSnapshot();
    h.view.viewport.width = h.view.viewport.height = 1024;
    h.runtime.update([h.view]);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(h.runtime.runtimeSnapshot().pageRequests).toBeGreaterThan(before.pageRequests);
    if (outcome === "reverse") h.view.viewport.width = h.view.viewport.height = 256;
    if (outcome === "remove") h.runtime.setScene(null);
    if (outcome === "context loss") h.runtime.invalidate();
    if (outcome === "failure") {
      h.runtime.update([h.view]); // fence allocation
      vi.mocked(h.gl.getError).mockReturnValueOnce(h.gl.OUT_OF_MEMORY);
    }
    if (outcome !== "context loss") h.runtime.update([h.view]);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(h.runtime.runtimeSnapshot().pendingPages).toBe(0);
    expect(h.runtime.runtimeSnapshot().pendingPageBytes).toBe(0);
    expect(h.runtime.runtimeSnapshot().failedPages).toBe(0);
    if (outcome === "failure") expect(h.runtime.runtimeSnapshot().atlasGrowthFailures).toBeGreaterThan(0);
  } finally { h.runtime.dispose(); }
  for (const result of h.read.mock.results) expect((await result.value).close).toHaveBeenCalledTimes(1);
  expect(h.budget.snapshot().retainedBytes).toBe(0);
});


it("keeps another pool streaming while automatic atlas validation stalls", async () => {
  const h = await harness();
  try {
    const oldAtlas = h.runtime.automaticBinding(h.asset)?.atlas.texture;
    vi.mocked(h.gl.clientWaitSync).mockReturnValue(h.gl.TIMEOUT_EXPIRED);
    h.view.viewport.width = h.view.viewport.height = 1024;
    h.runtime.update([h.view]);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(h.runtime.runtimeSnapshot().pendingPages).toBe(2);
    const other = imageTexture({ src: "https://example.test/other.png", colorSpace: "linear" });
    h.runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [h.asset, other].map(texture =>
      mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
    })));
    for (let i = 0; i < 30; i++) await h.frame();
    expect(h.runtime.automaticBinding(other)).toBeDefined();
    expect(h.runtime.automaticBinding(h.asset)?.atlas.texture).toBe(oldAtlas);
    expect(h.runtime.runtimeSnapshot().pendingPageBytes).toBeLessThanOrEqual(2 * 132 * 132 * 4);
  } finally { h.runtime.dispose(); }
  expect(h.budget.snapshot().retainedBytes).toBe(0);
});


it("keeps foreground RGBA usable when the optional ASTC capability probe throws", async () => {
  const h = await harness(true);
  try {
    for (let i = 0; i < 30; i++) await h.frame();
    expect(h.runtime.runtimeSnapshot().uploadedPages).toBeGreaterThan(0);
    expect(h.runtime.runtimeSnapshot().unresidentPages).toBe(0);
    expect(h.runtime.runtimeSnapshot().idleAstcFailure).toContain("ASTC profile query failed");
    expect(h.runtime.runtimeSnapshot().retainedPagePixelBytes ?? 0).toBe(0);
    expect(EncoderWorker.instances).toHaveLength(0);
  } finally { h.runtime.dispose(); }
  for (const result of h.read.mock.results) expect((await result.value).close).toHaveBeenCalledTimes(1);
});
