import {
  imageTexture,
  perspectiveCamera,
  planeGeometry,
  scene,
  mesh,
  unlitMaterial,
  virtualTexture,
} from "@royal/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import type { AsyncPreparationScheduler } from "../../packages/renderer-webgl/src/resource/async-preparation-owner";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import type { SurfaceFrameView } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { fakeGl } from "./support/canvas-root-harness";

afterEach(() => vi.unstubAllGlobals());

describe("browser virtual texture runtime", () => {
  it("allocates an authored atlas only after projected demand becomes non-empty", async () => {
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 128,
      pages: { uriTemplate: "pages/{mip}-{x}-{y}.png" },
      virtualSize: [256, 256],
    }))));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      close: vi.fn(),
      height: 130,
      width: 130,
    })));
    const gl = fakeGl();
    const texStorage2D = vi.fn();
    Object.assign(gl, { texStorage2D });
    const texture = virtualTexture("https://example.test/offscreen.vt.json");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture }),
        transform: { position: [100, 0, 0] },
      })],
    }));
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn());
    const identity = identityMat4();
    const viewport = { height: 1024, width: 1024, x: 0, y: 0 };

    runtime.setScene(prepared);
    await vi.waitFor(() => expect(runtime.snapshot(texture).state).toBe("ready"));
    runtime.update([{ view: identity, viewProjection: identity, viewport }]);
    expect(texStorage2D).not.toHaveBeenCalled();

    const visible = identityMat4();
    visible[12] = -100;
    runtime.update([{ view: visible, viewProjection: visible, viewport }]);
    expect(texStorage2D).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("publishes one page-table revision for a frame's admitted page batch", async () => {
    const manifest = {
      borderTexels: 1,
      colorSpace: "srgb",
      contractVersion: 2,
      mipCount: 2,
      pageSize: 1,
      pages: { uriTemplate: "pages/{mip}-{x}-{y}.png" },
      physicalSlots: 8,
      virtualSize: [2, 2],
    };
    const fetchPage = vi.fn(async (input: URL | RequestInfo) => String(input).endsWith("vt.json")
      ? new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/json" },
        })
      : new Response(new Blob([new Uint8Array([1])])));
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", fetchPage);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      close: vi.fn(),
      height: 3,
      width: 3,
    })));
    const gl = fakeGl();
    const texStorage2D = vi.fn();
    const texSubImage2D = vi.fn();
    Object.assign(gl, { texStorage2D, texSubImage2D });
    const changed = vi.fn();
    const scheduled = vi.fn();
    const schedule: AsyncPreparationScheduler = (signal, work) => {
      scheduled(signal);
      return work();
    };
    const texture = virtualTexture("https://example.test/vt.json");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture }),
      })],
    }));
    const runtime = createBrowserVirtualTextureRuntime(
      gl,
      changed,
      new PersistentGpuBudgetOwner(),
      schedule,
    );
    const matrix = identityMat4();
    const view: SurfaceFrameView = {
      view: matrix,
      viewProjection: matrix,
      viewport: { height: 1024, width: 1024, x: 0, y: 0 },
    };

    runtime.setScene(prepared);
    await vi.waitFor(() => expect(runtime.snapshot(texture).state).toBe("ready"));
    expect(scheduled).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    runtime.update([view]);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
    expect(scheduled.mock.calls.length).toBeGreaterThan(1);

    runtime.update([view]);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(12));
    texSubImage2D.mockClear();
    changed.mockClear();

    runtime.update([view]);
    expect(texSubImage2D).toHaveBeenCalledTimes(5);
    expect(changed).toHaveBeenCalledTimes(1);
    const settled = runtime.update([view]);
    expect(runtime.update([view])).toBe(settled);

    runtime.dispose();
  });

  it("routes automatic raster pages through the authored demand and residency runtime", async () => {
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      restore: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
    };
    vi.stubGlobal("document", {
      baseURI: "https://example.test/",
      createElement: vi.fn(() => ({
        getContext: () => context,
        height: 0,
        width: 0,
      })),
    });
    const gl = fakeGl();
    Object.assign(gl, { texStorage2D: vi.fn(), texSubImage2D: vi.fn() });
    const asset = imageTexture("https://example.test/large.png");
    const decoded = {
      height: 512,
      source: {} as ImageBitmap,
      width: 1024,
    };
    const release = vi.fn();
    const changed = vi.fn();
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture: asset }),
      })],
    }), undefined, undefined, () => decoded);
    const runtime = createBrowserVirtualTextureRuntime(
      gl,
      vi.fn(),
      new PersistentGpuBudgetOwner(),
      (_signal, work) => work(),
      {
        acquireDecoded: () => ({ release, source: decoded }),
        decoded: () => decoded,
        onChanged: changed,
      },
    );
    const matrix = identityMat4();
    const view: SurfaceFrameView = {
      view: matrix,
      viewProjection: matrix,
      viewport: { height: 1024, width: 1024, x: 0, y: 0 },
    };

    runtime.setScene(prepared);
    runtime.update([view]);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    for (let attempt = 0; attempt < 8 && runtime.automaticBinding(asset) === undefined; attempt += 1) {
      runtime.update([view]);
      await Promise.resolve();
    }

    expect(runtime.automaticBinding(asset)).toBeDefined();
    expect(context.drawImage).toHaveBeenCalled();
    runtime.dispose();
    expect(release).toHaveBeenCalledOnce();
  });

  it("bounds retained automatic raster sources without blocking ordinary fallback", () => {
    const first = imageTexture("https://example.test/first-large.png");
    const second = imageTexture("https://example.test/second-large.png");
    const decoded = {
      height: 4096,
      source: {} as ImageBitmap,
      width: 4096,
    };
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [first, second].map((texture, index) => mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture }),
        transform: { position: [index * 3, 0, 0] },
      })),
    }), undefined, undefined, () => decoded);
    const release = vi.fn();
    const acquireDecoded = vi.fn(() => ({ release, source: decoded }));
    const runtime = createBrowserVirtualTextureRuntime(
      fakeGl(),
      vi.fn(),
      new PersistentGpuBudgetOwner(),
      (_signal, work) => work(),
      { acquireDecoded, decoded: () => decoded, onChanged: vi.fn() },
    );

    runtime.setScene(prepared);

    expect(runtime.runtimeSnapshot()).toMatchObject({
      automaticCandidates: 2,
      automaticDecodedBytes: 64 * 1024 * 1024,
      automaticIneligible: 1,
      automaticResources: 1,
    });
    expect(acquireDecoded).toHaveBeenCalledOnce();
    runtime.dispose();
    expect(release).toHaveBeenCalledOnce();
  });
});
