import { afterEach, describe, expect, it, vi } from "vitest";
import { mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from "@royal/renderer-core";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { fakeGl } from "./support/canvas-root-harness";
import { waitFor } from "./support/wait-for";

afterEach(() => vi.unstubAllGlobals());

const harness = async (virtualSize = 1024, budgetBytes?: number) => {
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
    const { runtime, view, gl, texture } = await harness();
    const original = runtime.binding(texture)!;
    vi.mocked(gl.getParameter).mockReturnValue(16384);
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
      expect(gl.deleteSync).toHaveBeenCalledTimes(3);
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
      expect(runtime.binding(texture)).toBe(original);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, atlasGrowthFailures: 1 });
      expect(budget.snapshot().retainedBytes).toBe(retained);
      expect(gl.deleteSync).toHaveBeenCalledTimes(2);
    } finally { runtime.dispose(); }
  });

  it("retries a budget-limited growth when another allocation releases its claim", async () => {
    const { runtime, view, gl, budget } = await harness();
    const competing = {};
    expect(budget.tryClaim(competing, budget.availableBytes - 1024)).toBe(true);
    try {
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      for (let i = 0; i < 3; i++) expect(runtime.update([view]).pending).toBe(false);
      expect(gl.copyTexSubImage2D).not.toHaveBeenCalled();
      expect(runtime.runtimeSnapshot()).toMatchObject({ desiredPages: 85, admittedPages: 5, atlasGrowthFailures: 0 });
      budget.release(competing);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 85, unresidentPages: 0 });
      });
    } finally { budget.release(competing); runtime.dispose(); }
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
      runtime.update([view]);
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

  it.each(["dispose", "invalidate", "view"].flatMap((action) => [1, 2, 3, 4].map((frames) => ({ action, frames }))))(
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
    if (frames % 2 === 0 && action !== "invalidate") expect(gl.deleteSync).toHaveBeenCalledTimes(deletedSyncs + 1);
    runtime.dispose();
    expect(budget.snapshot().retainedBytes).toBe(0);
  });
});
