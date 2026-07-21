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
import { waitFor } from "./support/wait-for";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { FrameUploadBudgetOwner } from "../../packages/renderer-webgl/src/resource/frame-upload-budget";
import type { AsyncPreparationScheduler } from "../../packages/renderer-webgl/src/resource/async-preparation-owner";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import type { SurfaceFrameView } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { virtualTextureRuntimeRequired } from "../../packages/renderer-webgl/src/virtual-texture/runtime-contract";
import { fakeGl } from "./support/canvas-root-harness";

afterEach(() => vi.unstubAllGlobals());

describe("VT runtime activation core", () => {
  it("separates authored demand from opt-in automatic base-color demand", () => {
    const ordinary = imageTexture("/large.png");
    const authored = virtualTexture("/authored.vt.json");
    const empty = { surfaces: [], virtualTextureAssets: [] };
    const ordinaryScene = {
      surfaces: [{ material: { baseColorAsset: ordinary } }],
      virtualTextureAssets: [],
    };
    const authoredScene = { surfaces: [], virtualTextureAssets: [authored] };

    expect(virtualTextureRuntimeRequired(empty, false)).toBe(false);
    expect(virtualTextureRuntimeRequired(empty, true)).toBe(false);
    expect(virtualTextureRuntimeRequired(ordinaryScene, false)).toBe(false);
    expect(virtualTextureRuntimeRequired(ordinaryScene, true)).toBe(true);
    expect(virtualTextureRuntimeRequired(authoredScene, false)).toBe(true);
  });
});

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
    await waitFor(() => expect(runtime.snapshot(texture).state).toBe("ready"));
    runtime.update([{ view: identity, viewProjection: identity, viewport }]);
    expect(texStorage2D).not.toHaveBeenCalled();

    const visible = identityMat4();
    visible[12] = -100;
    runtime.update([{ view: visible, viewProjection: visible, viewport }]);
    expect(texStorage2D).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it("cancels page work immediately when camera demand moves away", async () => {
    const manifest = {
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 128,
      pages: { uriTemplate: "pages/{mip}-{x}-{y}.png" },
      physicalSlots: 8,
      virtualSize: [512, 512],
    };
    const pageSignals: AbortSignal[] = [];
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      if (String(input).endsWith("vt.json")) {
        return Promise.resolve(new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/json" },
        }));
      }
      const signal = init?.signal;
      if (signal === undefined || signal === null) throw new Error("page read requires a signal");
      pageSignals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }));
    const texture = virtualTexture("https://example.test/vt.json");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture }),
      })],
    }));
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn());
    const identity = identityMat4();
    const viewport = { height: 1024, width: 1024, x: 0, y: 0 };

    runtime.setScene(prepared);
    await waitFor(() => expect(runtime.snapshot(texture).state).toBe("ready"));
    runtime.update([{ view: identity, viewProjection: identity, viewport }]);
    await waitFor(() => expect(pageSignals.length).toBeGreaterThan(0));

    const offscreen = identityMat4();
    offscreen[12] = 100;
    runtime.update([{ view: offscreen, viewProjection: offscreen, viewport }]);

    expect(pageSignals.every((signal) => signal.aborted)).toBe(true);
    expect(runtime.snapshot(texture).pendingPages).toBe(0);

    runtime.update([{ view: identity, viewProjection: identity, viewport }]);
    await waitFor(() => expect(pageSignals).toHaveLength(2));
    await Promise.resolve();
    expect(pageSignals[1]!.aborted).toBe(false);
    expect(runtime.snapshot(texture).pendingPages).toBe(1);
    runtime.dispose();
  });

  it("round-robins newly available page slots across visible texture resources", async () => {
    const manifest = {
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 128,
      pages: { uriTemplate: "pages/{mip}-{x}-{y}.png" },
      physicalSlots: 8,
      virtualSize: [512, 512],
    };
    const pageReads: Array<{
      resolve(response: Response): void;
      url: string;
    }> = [];
    const createImageBitmap = vi.fn(async () => ({
      close: vi.fn(),
      height: 130,
      width: 130,
    }));
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", vi.fn((input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("vt.json")) {
        return Promise.resolve(new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/json" },
        }));
      }
      return new Promise<Response>((resolve) => { pageReads.push({ resolve, url }); });
    }));
    const textures = Array.from({ length: 5 }, (_, index) =>
      virtualTexture(`https://example.test/${index}/vt.json`));
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: textures.map((texture) => mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture }),
      })),
    }));
    const gl = fakeGl();
    const texStorage2D = vi.fn();
    Object.assign(gl, { texStorage2D });
    const budget = new PersistentGpuBudgetOwner();
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
    const identity = identityMat4();
    const view: SurfaceFrameView = {
      view: identity,
      viewProjection: identity,
      viewport: { height: 1024, width: 1024, x: 0, y: 0 },
    };

    runtime.setScene(prepared);
    await waitFor(() => {
      expect(textures.every((texture) => runtime.snapshot(texture).state === "ready")).toBe(true);
    });
    runtime.update([view]);
    // Five compatible logical textures share one atlas and retain five page tables.
    expect(texStorage2D).toHaveBeenCalledTimes(6);
    expect(runtime.runtimeSnapshot()).toMatchObject({
      atlasBytes: 1_690_000,
      atlasPools: 1,
    });
    expect(pageReads.map(({ url }) => new URL(url).pathname.split("/")[1]))
      .toEqual(["0", "1", "2", "3"]);

    pageReads[0]!.resolve(new Response(new Blob([new Uint8Array([1])])));
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
    runtime.update([view]);

    expect(new URL(pageReads[4]!.url).pathname.split("/")[1]).toBe("4");
    runtime.dispose();
    expect(budget.snapshot().retainedBytes).toBe(0);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(6);
  });

  it("protects current demand and commits replacement only after upload succeeds", async () => {
    const manifest = {
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 1,
      pages: { uriTemplate: "pages/{mip}-{x}-{y}.png" },
      physicalSlots: 1,
      virtualSize: [2, 2],
    };
    const pageReads: Array<{
      resolve(response: Response): void;
      url: string;
    }> = [];
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn((input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("vt.json")) {
        return Promise.resolve(new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/json" },
        }));
      }
      return new Promise<Response>((resolve) => { pageReads.push({ resolve, url }); });
    }));
    const createImageBitmap = vi.fn(async () => ({
      close: vi.fn(),
      height: 3,
      width: 3,
    }));
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const first = virtualTexture("https://example.test/first/vt.json");
    const second = virtualTexture("https://example.test/second/vt.json");
    const preparedScene = (secondPosition: readonly [number, number, number]) =>
      prepareCanonicalSurfaceScene(scene({
        camera: perspectiveCamera({}),
        nodes: [
          mesh({ geometry: planeGeometry(1), material: unlitMaterial({ texture: first }) }),
          mesh({
            geometry: planeGeometry(1),
            material: unlitMaterial({ texture: second }),
            transform: { position: secondPosition },
          }),
        ],
    }));
    const gl = fakeGl();
    let rejectAtlasUpload = false;
    const texSubImage2D = vi.fn((...args: unknown[]) => {
      if (rejectAtlasUpload && !(args[args.length - 1] instanceof Uint8Array)) {
        throw new Error("replacement upload failed");
      }
    });
    Object.assign(gl, { getParameter: vi.fn(() => 3), texSubImage2D });
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn());
    const matrix = identityMat4();
    const view: SurfaceFrameView = {
      view: matrix,
      viewProjection: matrix,
      viewport: { height: 1024, width: 1024, x: 0, y: 0 },
    };

    runtime.setScene(preparedScene([0, 0, 0]));
    await waitFor(() => {
      expect(runtime.snapshot(first).state).toBe("ready");
      expect(runtime.snapshot(second).state).toBe("ready");
    });
    runtime.update([view]);
    await waitFor(() => expect(pageReads).toHaveLength(2));
    const firstRead = pageReads.find(({ url }) => url.includes("/first/"))!;
    const secondRead = pageReads.find(({ url }) => url.includes("/second/"))!;
    secondRead.resolve(new Response(new Blob([new Uint8Array([2])])));
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(1));
    runtime.update([view]);
    expect(runtime.binding(second)).toBeDefined();

    firstRead.resolve(new Response(new Blob([new Uint8Array([1])])));
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
    runtime.setScene(preparedScene([100, 0, 0]));
    rejectAtlasUpload = true;

    expect(() => runtime.update([view])).toThrow("replacement upload failed");
    expect(runtime.binding(first)).toBeUndefined();
    expect(runtime.binding(second)).toBeDefined();
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
      undefined,
      new FrameUploadBudgetOwner(100),
    );
    const matrix = identityMat4();
    const view: SurfaceFrameView = {
      view: matrix,
      viewProjection: matrix,
      viewport: { height: 1024, width: 1024, x: 0, y: 0 },
    };

    runtime.setScene(prepared);
    await waitFor(() => expect(runtime.snapshot(texture).state).toBe("ready"));
    expect(scheduled).toHaveBeenCalledOnce();
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    runtime.update([view]);
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
    expect(scheduled.mock.calls.length).toBeGreaterThan(1);

    runtime.update([view]);
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(12));
    texSubImage2D.mockClear();
    changed.mockClear();

    runtime.update([view]);
    expect(texSubImage2D).toHaveBeenCalledTimes(4);
    expect(texSubImage2D.mock.calls.filter((call) => call.length === 9)
      .map((call) => call[1])).toEqual([0, 1]);
    expect(changed).toHaveBeenCalled();
    expect(runtime.runtimeSnapshot()).toMatchObject({
      admittedUploadBytes: 92,
      deferredUploads: 1,
      uploadBudgetBytes: 100,
    });
    texSubImage2D.mockClear();
    runtime.update([view]);
    expect(texSubImage2D).toHaveBeenCalledTimes(4);
    expect(texSubImage2D.mock.calls.filter((call) => call.length === 9)
      .map((call) => call[1])).toEqual([0, 1]);
    expect(runtime.runtimeSnapshot()).toMatchObject({
      admittedUploadBytes: 92,
      deferredUploads: 0,
    });
    const settled = runtime.update([view]);
    expect(runtime.update([view])).toBe(settled);
    expect(runtime.runtimeSnapshot().pageRequests).toBeLessThanOrEqual(5);

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
    await waitFor(() => expect(changed).toHaveBeenCalled());
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
