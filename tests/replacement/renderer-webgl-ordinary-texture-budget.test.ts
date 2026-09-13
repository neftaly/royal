import { afterEach, describe, expect, it, vi } from "vitest";
import { ordinaryTextureStorageBudget } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { imageTexture, mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from "@royal/renderer-core";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { SurfaceGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { ScreenSpacePartitionPatternOwner } from "../../packages/renderer-webgl/src/surface/screen-space-partition-pattern";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { fakeGl } from "./support/canvas-root-harness";

import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { waitFor } from "./support/wait-for";
afterEach(() => vi.unstubAllGlobals());

describe("ordinary texture persistent storage budget", () => {
  it.each([1, 3])("reserves the shared authored VT allowance once with %i sources and releases it on removal", async (count) => {
    const bytes = 64 * 1024 * 1024, budget = new PersistentGpuBudgetOwner(bytes), gl = fakeGl();
    const owner = new SurfaceGpuOwner(gl, budget, new ScreenSpacePartitionPatternOwner(gl, budget));
    const geometry = planeGeometry(2);
    const fallback = mesh({ geometry, material: unlitMaterial({ texture: imageTexture("/fallback.svg") }) });
    const ordinary = prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [fallback] }));
    const mixed = prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [fallback,
      ...Array.from({ length: count }, (_, index) => mesh({ geometry,
        material: unlitMaterial({ texture: virtualTexture(`/native-${index}.json`) }) })),
    ] }));
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      contractVersion: 2, pageSize: 128, borderTexels: 1, virtualSize: [256, 256],
      pages: { uriTemplate: "{mip}-{x}-{y}.png" },
    }))));
    try {
      owner.setScene(ordinary);
      const initial = owner.ordinaryTextureStorageBudget(bytes, 512, 512);
      expect(initial).toBe(bytes * 0.75);
      owner.setScene(mixed);
      expect(owner.ordinaryTextureStorageBudget(bytes, 512, 512)).toBeLessThan(bytes * 0.25);
      const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
      owner.setVirtualTextureRuntime(runtime);
      await waitFor(() => expect(runtime.authoredStorageRequired).toBe(true));
      const shared = owner.ordinaryTextureStorageBudget(bytes, 512, 512)!;
      expect(shared).toBeGreaterThan(bytes * 0.2);
      expect(shared + bytes * 0.75).toBeLessThan(bytes);
      owner.setScene(ordinary);
      expect(owner.ordinaryTextureStorageBudget(bytes, 512, 512)).toBe(initial);
    } finally { owner.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it.each(["unused", "unsupported", "failed"])("does not reserve for %s authored VT", async kind => {
    const bytes = 64 * 1024 * 1024, budget = new PersistentGpuBudgetOwner(bytes), gl = fakeGl();
    const owner = new SurfaceGpuOwner(gl, budget, new ScreenSpacePartitionPatternOwner(gl, budget));
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      contractVersion: 2, pageSize: 128, borderTexels: 8, virtualSize: [256, 256],
      pageEncoding: "ktx2-astc-6x6", pages: { uriTemplate: "{mip}-{x}-{y}.ktx2" },
    }), { status: kind === "failed" ? 404 : 200 })));
    const asset = virtualTexture("/native.json");
    const ordinary = prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [
      mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: imageTexture("/fallback.png") }) }),
    ] }));
    const referenced = prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [
      mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) }),
    ] }));
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
    try {
      owner.setScene(kind === "unused" ? { ...ordinary, virtualTextureAssets: [asset] } : referenced);
      owner.setVirtualTextureRuntime(runtime);
      await waitFor(() => expect(runtime.authoredStorageRequired).toBe(false));
      expect(owner.ordinaryTextureStorageBudget(bytes, 512, 512)).toBe(bytes * 0.75);
      expect(gl.createTexture).not.toHaveBeenCalled();
    } finally { owner.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  });

  it("keeps the general-purpose quarter reserve when scene storage is small", () => {
    expect(ordinaryTextureStorageBudget(1_000, 100)).toBe(750);
  });

  it("reserves exact heavy-scene geometry and composite storage before fitting", () => {
    expect(ordinaryTextureStorageBudget(
      268_435_456,
      97_289_244 + 23_890_464,
    )).toBe(147_255_748);
  });

  it("settles at zero when required non-texture storage exhausts the ceiling", () => {
    expect(ordinaryTextureStorageBudget(1_000, 1_500)).toBe(0);
  });
});
