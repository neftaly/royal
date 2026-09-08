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
import { AsyncPreparationOwner, type AsyncPreparationScheduler } from "../../packages/renderer-webgl/src/resource/async-preparation-owner";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import type { SurfaceFrameView } from "../../packages/renderer-webgl/src/frame/surface-frame";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import {
  automaticVirtualTextureAssetKey,
  virtualTextureAssetKey,
  virtualTextureRuntimeRequired,
} from "../../packages/renderer-webgl/src/virtual-texture/runtime-contract";
import {
  initialVirtualTextureActivationState,
  reconcileVirtualTextureActivation,
  settleVirtualTextureActivation,
} from "../../packages/renderer-webgl/src/runtime/virtual-texture-activation";
import { fakeGl } from "./support/canvas-root-harness";
import { createKtx2Etc2Fixture } from "./support/ktx2-etc2-fixture";
import type { EncodedSvgTextureSource } from "../../packages/renderer-webgl/src/texture/source";

afterEach(() => vi.unstubAllGlobals());

describe("VT runtime activation core", () => {
  it("keeps typed versions distinct and normalizes equivalent sampler defaults", () => {
    const unversioned = virtualTexture("/map.vt.json");
    const numericZero = virtualTexture({ manifestUri: "/map.vt.json", version: 0 });
    const stringZero = virtualTexture({ manifestUri: "/map.vt.json", version: "0" });
    const explicitContentIdentity = virtualTexture({
      contentKey: "/map.vt.json",
      manifestUri: "/another-map.vt.json",
    });
    const explicitDefaults = virtualTexture({
      colorSpace: "srgb",
      manifestUri: "/map.vt.json",
      sampler: {
        magFilter: "linear",
        minFilter: "linear-mipmap-linear",
        wrapS: "clamp-to-edge",
        wrapT: "clamp-to-edge",
      },
    });

    expect(virtualTextureAssetKey(unversioned)).not.toBe(virtualTextureAssetKey(numericZero));
    expect(virtualTextureAssetKey(numericZero)).not.toBe(virtualTextureAssetKey(stringZero));
    expect(virtualTextureAssetKey(unversioned))
      .not.toBe(virtualTextureAssetKey(explicitContentIdentity));
    expect(virtualTextureAssetKey(unversioned)).toBe(virtualTextureAssetKey(explicitDefaults));

    const ordinary = imageTexture("/map.png");
    const ordinaryExplicitDefaults = imageTexture({
      sampler: {
        magFilter: "linear",
        minFilter: "linear-mipmap-linear",
        wrapS: "clamp-to-edge",
        wrapT: "clamp-to-edge",
      },
      src: "/map.png",
    });
    expect(automaticVirtualTextureAssetKey(ordinary))
      .toBe(automaticVirtualTextureAssetKey(ordinaryExplicitDefaults));
  });

  it("activates lazily for authored or automatic base-color demand", () => {
    const ordinary = imageTexture("/large.png");
    const authored = virtualTexture("/authored.vt.json");
    const empty = { surfaces: [], virtualTextureAssets: [] };
    const ordinaryScene = {
      surfaces: [{ material: { baseColorAsset: ordinary } }],
      virtualTextureAssets: [],
    };
    const authoredScene = { surfaces: [], virtualTextureAssets: [authored] };

    const decoded = () => ({ width: 1024, height: 1024, source: {} as ImageBitmap });
    expect(virtualTextureRuntimeRequired(empty, decoded)).toBe(false);
    expect(virtualTextureRuntimeRequired(ordinaryScene, () => undefined)).toBe(false);
    expect(virtualTextureRuntimeRequired(ordinaryScene, () => ({ width: 128, height: 128, source: {} as ImageBitmap }))).toBe(false);
    expect(virtualTextureRuntimeRequired(ordinaryScene, decoded)).toBe(true);
    expect(virtualTextureRuntimeRequired(authoredScene, () => undefined)).toBe(true);
  });

  it("does not reset upload admission already owned by the surface frame", () => {
    const uploads = new FrameUploadBudgetOwner(100);
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn(), undefined, undefined, undefined, uploads);
    uploads.beginFrame();
    expect(uploads.tryAdmit(80)).toBe(true);
    runtime.update([], false);
    expect(uploads.tryAdmit(30)).toBe(false);
    expect(uploads.snapshot().admittedBytes).toBe(80);
    runtime.update([]);
    expect(uploads.tryAdmit(30)).toBe(true);
    runtime.dispose();
  });

  it("loads once, activates the current generation and detaches on lost demand", () => {
    const requested = reconcileVirtualTextureActivation(
      initialVirtualTextureActivationState,
      true,
    );
    expect(requested).toEqual({ generation: 1, phase: "loading" });
    expect(reconcileVirtualTextureActivation(requested, true)).toBe(requested);

    const active = settleVirtualTextureActivation(requested, 1, true);
    expect(active).toEqual({ generation: 1, phase: "active" });
    if (active === undefined) throw new Error("expected current VT load to activate");
    expect(reconcileVirtualTextureActivation(active, false)).toEqual({
      generation: 1,
      phase: "inactive",
    });
  });

  it("invalidates stale loads and allows a current failure to retry", () => {
    const loading = reconcileVirtualTextureActivation(
      initialVirtualTextureActivationState,
      true,
    );
    const cancelled = reconcileVirtualTextureActivation(loading, false);
    expect(cancelled).toEqual({ generation: 2, phase: "inactive" });
    expect(settleVirtualTextureActivation(cancelled, 1, true)).toBeUndefined();

    const retrying = reconcileVirtualTextureActivation(cancelled, true);
    expect(retrying).toEqual({ generation: 3, phase: "loading" });
    const failed = settleVirtualTextureActivation(retrying, 3, false);
    expect(failed).toEqual({ generation: 3, phase: "inactive" });
    if (failed === undefined) throw new Error("expected current VT failure to settle");
    expect(reconcileVirtualTextureActivation(failed, true)).toEqual({
      generation: 4,
      phase: "loading",
    });
  });
});

describe("browser virtual texture runtime", () => {
  it.each([false, true])("overlaps authored tile transport with bounded decode (cancel: %s)", async (cancel) => {
    const owner = new AsyncPreparationOwner(2);
    const requests: { signal: AbortSignal; resolve: () => void }[] = [];
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      if (String(input).endsWith(".json")) return new Response(JSON.stringify({
        contractVersion: 2, pageSize: 128, borderTexels: 1, virtualSize: [256, 256],
        pages: { uriTemplate: "{mip}-{x}-{y}.png" },
      }));
      if (String(input).endsWith("1-0-0.png")) return new Response(new Uint8Array([1]));
      await new Promise<void>((resolve, reject) => {
        requests.push({ signal: init!.signal!, resolve });
        init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return new Response(new Uint8Array([1]));
    }));
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      active++; maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return { width: 130, height: 130, close: vi.fn() };
    }));
    const asset = virtualTexture("https://example.test/stream.json");
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn(), undefined, owner.runForeground,
      undefined, undefined, true, owner.run);
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
    try {
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
        nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(requests).toHaveLength(4);
      });
      expect(owner.snapshot().activeJobs).toBe(0);
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(4 * 130 * 130 * 4);
      if (cancel) {
        runtime.dispose();
        await waitFor(() => expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0));
        expect(requests.every(request => request.signal.aborted)).toBe(true);
      } else {
        for (const request of requests) request.resolve();
        await waitFor(() => {
          runtime.update([view]);
          expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, pendingPages: 0, pendingPageBytes: 0 });
        });
      }
      expect(maxActive).toBe(1);
    } finally { runtime.dispose(); owner.dispose(); }
  });

  it.each([512, 1024])("rasterizes %ipx targets once per bounded region before cache eviction", async (viewportSize) => {
    const context = { clearRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(), save: vi.fn(), restore: vi.fn(), scale: vi.fn(), translate: vi.fn() };
    vi.stubGlobal("document", { baseURI: "https://example.test/", createElement: () => ({ getContext: () => context, width: 0, height: 0 }) });
    const attributes = new Map<string, string>();
    vi.stubGlobal("XMLSerializer", class { serializeToString = () => "<svg/>"; });
    const decode = vi.fn(async () => ({ width: Number(attributes.get("width")), height: Number(attributes.get("height")), close: vi.fn() }));
    vi.stubGlobal("createImageBitmap", decode);
    const encoded: EncodedSvgTextureSource = { blob: new Blob(["<svg/>"]), byteLength: 6, parsed: {
      document: { documentElement: { cloneNode: () => ({ setAttribute: (name: string, value: string) => attributes.set(name, value) }) } } as unknown as XMLDocument,
      viewBox: [0, 0, 64, 64],
    } };
    const decoded = { width: 64, height: 64, source: {} as ImageBitmap, svgPreview: { encoded, load: async () => encoded } };
    const assets = Array.from({ length: 6 }, (_, i) => imageTexture(`https://example.test/${i}.png`));
    const prepared = prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: assets.map((texture) =>
      mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })) }), undefined, undefined, () => decoded);
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn(), undefined, undefined, {
      acquireDecoded: () => ({ source: decoded, release: vi.fn() }), decoded: () => decoded, onChanged: vi.fn(),
    });
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: viewportSize, height: viewportSize, x: 0, y: 0 } };
    try {
      runtime.setScene(prepared);
      await waitFor(() => {
        const uploaded = runtime.runtimeSnapshot().uploadedPages;
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().uploadedPages - uploaded).toBeLessThanOrEqual(4);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: viewportSize === 512 ? 6 : 30, unresidentPages: 0, pendingPages: 0 });
      });
      expect(decode).toHaveBeenCalledTimes(viewportSize === 512 ? 6 : 12);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBeLessThanOrEqual(4 * 1024 * 1024 + 6 * 64 * 64 * 4);
    } finally { runtime.dispose(); }
  });

  it("shows preview coverage, skips intermediate SVG mips, and replaces preview on a coarse-only target", async () => {
    const context = {
      clearRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(), save: vi.fn(), restore: vi.fn(),
      scale: vi.fn(), translate: vi.fn(),
    };
    vi.stubGlobal("document", {
      baseURI: "https://example.test/",
      createElement: () => ({ getContext: () => context, height: 0, width: 0 }),
    });
    const sizes: number[] = [];
    const attrs = new Map<string, string>();
    vi.stubGlobal("XMLSerializer", class { serializeToString = (): string => "<svg/>"; });
    const close = vi.fn();
    const decode = vi.fn(async () => {
      const width = Number(attrs.get("width"));
      sizes.push(width);
      return { width, height: Number(attrs.get("height")), close };
    });
    vi.stubGlobal("createImageBitmap", decode);
    const encoded: EncodedSvgTextureSource = {
      blob: new Blob(["<svg/>"]), byteLength: 6,
      parsed: { document: { documentElement: { cloneNode: () => ({ setAttribute: (key: string, value: string) => attrs.set(key, value) }) } } as unknown as XMLDocument, viewBox: [0, 0, 64, 64] },
    };
    let resolve!: (value: EncodedSvgTextureSource) => void;
    const detail: { encoded?: EncodedSvgTextureSource; load: () => Promise<EncodedSvgTextureSource> } = {
      load: vi.fn(() => detail.encoded === undefined
        ? new Promise<EncodedSvgTextureSource>((done) => { resolve = done; })
        : Promise.resolve(detail.encoded)),
    };
    const decoded = { width: 64, height: 64, source: {} as ImageBitmap, svgPreview: detail };
    const asset = imageTexture("https://example.test/preview.png");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
    }), undefined, undefined, () => decoded);
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn(), undefined, undefined, {
      acquireDecoded: () => ({ source: decoded, release: vi.fn() }),
      decoded: () => decoded, onChanged: vi.fn(),
    });
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 1024, height: 1024, x: 0, y: 0 } };
    try {
      runtime.setScene(prepared);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.automaticBinding(asset)).toBeDefined();
        expect(detail.load).toHaveBeenCalledOnce();
      });
      expect(decode).not.toHaveBeenCalled();
      expect(runtime.runtimeSnapshot().residentPages).toBe(1);
      detail.encoded = encoded;
      resolve(encoded);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 5, pendingPages: 0 });
      });
      expect(sizes).toHaveLength(2);
      expect(sizes.every(size => size <= 1028)).toBe(true);
      expect(runtime.runtimeSnapshot().pageRequests).toBe(5);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBeLessThanOrEqual(64 * 64 * 4 + 4 * 1024 * 1024);
      view.viewport.width = 64;
      view.viewport.height = 64;
      await waitFor(() => {
        runtime.update([view]);
        expect(sizes).toHaveLength(3);
        expect(sizes.at(-1)).toBe(512);
        expect(runtime.runtimeSnapshot().pendingPages).toBe(0);
      });
      expect(runtime.automaticBinding(asset)).toBeDefined();
      expect(runtime.runtimeSnapshot().pageRequests).toBe(6);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBe(64 * 64 * 4);
    } finally {
      runtime.dispose();
    }
    expect(close).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])("restores coarse preview coverage after vector failure (already failed: %s)", async (alreadyFailed) => {
    const context = {
      clearRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
      scale: vi.fn(), translate: vi.fn(),
    };
    vi.stubGlobal("document", {
      baseURI: "https://example.test/",
      createElement: () => ({ getContext: () => context, height: 0, width: 0 }),
    });
    const detail: { error?: string; load: () => Promise<EncodedSvgTextureSource> } = {
      ...(alreadyFailed ? { error: "optional vector failed" } : {}),
      load: vi.fn(async () => {
        detail.error = "optional vector failed";
        throw new Error(detail.error);
      }),
    };
    const decoded = { width: 64, height: 64, source: {} as ImageBitmap, svgPreview: detail };
    const asset = imageTexture("https://example.test/preview.png");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
    }), undefined, undefined, () => decoded);
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn(), undefined, undefined, {
      acquireDecoded: () => ({ source: decoded, release: vi.fn() }),
      decoded: () => decoded, onChanged: vi.fn(),
    });
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: alreadyFailed ? 64 : 1024, height: alreadyFailed ? 64 : 1024, x: 0, y: 0 } };
    const sourceFailures = alreadyFailed ? 0 : 1;
    try {
      runtime.setScene(prepared);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 1, failedPages: sourceFailures, pendingPages: 0 });
      });
      runtime.invalidate();
      expect(runtime.automaticBinding(asset)).toBeUndefined();
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.automaticBinding(asset)).toBeDefined();
      });
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 1, failedPages: sourceFailures, pendingPages: 0, pendingPageBytes: 0 });
      expect(detail.load).toHaveBeenCalledTimes(alreadyFailed ? 0 : 1);
      const settledRequests = runtime.runtimeSnapshot().pageRequests;
      for (let i = 0; i < 5; i += 1) runtime.update([view]);
      expect(runtime.runtimeSnapshot().pageRequests).toBe(settledRequests);
      context.clearRect.mockImplementation(() => { throw new Error("preview canvas failed"); });
      runtime.invalidate();
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ failedPages: sourceFailures + 1, pendingPages: 0 });
      });
      const failedRequests = runtime.runtimeSnapshot().pageRequests;
      for (let i = 0; i < 5; i += 1) runtime.update([view]);
      expect(runtime.runtimeSnapshot().pageRequests).toBe(failedRequests);
    } finally {
      runtime.dispose();
    }
  });

  it("reserves compressed page bytes through decode, upload, and invalidation", async () => {
    const storedSize = 2052;
    const bytes = createKtx2Etc2Fixture(152, storedSize, storedSize);
    const manifest = {
      borderTexels: 2, contractVersion: 2, pageSize: 2048, pageEncoding: "ktx2-etc2",
      pages: { uriTemplate: "page-{mip}-{x}-{y}.ktx2" }, physicalSlots: 1, virtualSize: [2048, 2048],
    };
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => new Response(
      String(input).endsWith(".json") ? JSON.stringify(manifest) : new Uint8Array(bytes).buffer,
    )));
    const gl = fakeGl();
    const upload = vi.fn();
    Object.assign(gl, { compressedTexSubImage2D: upload });
    const asset = virtualTexture("https://example.test/compressed.vt.json");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
    }));
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn());
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 1024, height: 1024, x: 0, y: 0 } };
    try {
      runtime.setScene(prepared);
      await waitFor(() => expect(runtime.snapshot(asset).status).toBe("ready"));
      runtime.update([view]);
      expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPageBytes: storedSize ** 2, pageRequests: 1, failedPages: 0 });
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(asset).residentPages).toBe(1);
      });
      expect(upload).toHaveBeenCalledOnce();
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0);
      runtime.invalidate();
      runtime.update([view]);
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(storedSize ** 2);
      runtime.dispose();
      await waitFor(() => expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0));
    } finally {
      runtime.dispose();
    }
  });

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
    await waitFor(() => expect(runtime.snapshot(texture).status).toBe("ready"));
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
    await waitFor(() => expect(runtime.snapshot(texture).status).toBe("ready"));
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

  it("refines more than 24 visible textures without camera movement", async () => {
    const manifest = {
      borderTexels: 1, contractVersion: 2, pageSize: 128,
      pages: { uriTemplate: "pages/{mip}-{x}-{y}.png" }, virtualSize: [128, 128],
    };
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: vi.fn(), height: 130, width: 130 })));
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => String(input).endsWith("vt.json")
      ? new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } })
      : new Response(new Blob([new Uint8Array([1])]))));
    const textures = Array.from({ length: 60 }, (_, i) => virtualTexture(`https://example.test/${i}/vt.json`));
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: textures.map((texture) => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
    }));
    const gl = fakeGl();
    Object.assign(gl, { texStorage2D: vi.fn() });
    const budget = new PersistentGpuBudgetOwner();
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
    const matrix = identityMat4();
    const views = [{ view: matrix, viewProjection: matrix, viewport: { height: 1024, width: 1024, x: 0, y: 0 } }];
    try {
      runtime.setScene(prepared);
      await waitFor(() => {
        expect(textures.every((texture) => runtime.snapshot(texture).status === "ready")).toBe(true);
      });
      await waitFor(() => {
        const before = runtime.runtimeSnapshot().uploadedPages;
        runtime.update(views);
        expect(runtime.runtimeSnapshot().uploadedPages - before).toBeLessThanOrEqual(4);
        expect(runtime.runtimeSnapshot().residentPages).toBe(60);
      });
      expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, failedPages: 0, pendingPages: 0 });
    } finally {
      runtime.dispose();
    }
    expect(budget.snapshot().retainedBytes).toBe(0);
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
    const changed = vi.fn();
    const runtime = createBrowserVirtualTextureRuntime(gl, changed, budget);
    const identity = identityMat4();
    const view: SurfaceFrameView = {
      view: identity,
      viewProjection: identity,
      viewport: { height: 1024, width: 1024, x: 0, y: 0 },
    };

    runtime.setScene(prepared);
    await waitFor(() => {
      expect(textures.every((texture) => runtime.snapshot(texture).status === "ready")).toBe(true);
    });
    changed.mockClear();
    runtime.update([view]);
    expect(changed.mock.calls.every(([, presentationChanged]) => presentationChanged === false)).toBe(true);
    // Five compatible logical textures share one atlas and retain five page tables.
    expect(texStorage2D).toHaveBeenCalledTimes(6);
    expect(runtime.runtimeSnapshot()).toMatchObject({
      atlasBytes: 64 * 130 * 130 * 4,
      atlasPools: 1,
    });
    expect(pageReads.map(({ url }) => new URL(url).pathname.split("/")[1]))
      .toEqual(["0", "1", "2", "3"]);

    pageReads[0]!.resolve(new Response(new Blob([new Uint8Array([1])])));
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
    await waitFor(() => expect(changed).toHaveBeenCalledWith(textures[0], true));
    changed.mockClear();
    runtime.update([view]);
    expect(changed.mock.calls.every(([, presentationChanged]) => presentationChanged === false)).toBe(true);

    expect(new URL(pageReads[4]!.url).pathname.split("/")[1]).toBe("4");
    runtime.dispose();
    expect(budget.snapshot().retainedBytes).toBe(0);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(6);
  });

  it("releases pages blocked by a full atlas so another pool can load and retries after eviction", async () => {
    const manifest = {
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 1,
      pages: { uriTemplate: "pages/{mip}-{x}-{y}.png" },
      physicalSlots: 1,
      virtualSize: [1, 1],
    };
    const reads: Array<{ resolve(response: Response): void; url: string }> = [];
    const close = vi.fn();
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close, width: 3, height: 3 })));
    vi.stubGlobal("fetch", vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("vt.json")) {
        return Promise.resolve(new Response(JSON.stringify(manifest)));
      }
      return new Promise<Response>((resolve, reject) => {
        reads.push({ resolve, url });
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }));
    const textures = Array.from({ length: 5 }, (_, index) =>
      virtualTexture(`https://example.test/${index}/vt.json`));
    const otherPool = virtualTexture({
      manifestUri: "https://example.test/other/vt.json",
      colorSpace: "linear",
    });
    const prepare = (assets: readonly ReturnType<typeof virtualTexture>[]) => prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: assets.map((texture) => mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture }),
      })),
    }));
    const gl = fakeGl();
    Object.assign(gl, { getParameter: vi.fn(() => 3) });
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn());
    const matrix = identityMat4();
    const view: SurfaceFrameView = {
      view: matrix,
      viewProjection: matrix,
      viewport: { width: 256, height: 256, x: 0, y: 0 },
    };
    try {
      runtime.setScene(prepare(textures));
      await waitFor(() => expect(textures.every((asset) => runtime.snapshot(asset).status === "ready")).toBe(true));
      runtime.update([view]);
      await waitFor(() => expect(reads).toHaveLength(4));
      for (const read of reads) read.resolve(new Response(new Blob([new Uint8Array([1])])));
      await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(4));
      runtime.update([view]);
      // One cell is resident and protected. The three losing decodes must not
      // reserve the global four-job queue indefinitely or be marked failed.
      expect(runtime.runtimeSnapshot()).toMatchObject({
        residentPages: 1,
        pendingPages: 0,
        pendingPageBytes: 0,
        failedPages: 0,
      });
      expect(close).toHaveBeenCalledTimes(4);
      const settledReads = reads.length;
      for (let frame = 0; frame < 5; frame += 1) expect(runtime.update([view]).pending).toBe(false);
      expect(reads).toHaveLength(settledReads);

      runtime.setScene(prepare([...textures, otherPool]));
      await waitFor(() => expect(runtime.snapshot(otherPool).status).toBe("ready"));
      runtime.update([view]);
      await waitFor(() => expect(reads.some(({ url }) => url.includes("/other/"))).toBe(true));
      reads.find(({ url }) => url.includes("/other/"))!.resolve(new Response(new Blob([new Uint8Array([1])])));
      await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(5));
      runtime.update([view]);
      expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 2, residentPages: 2, pendingPages: 0 });
      expect(runtime.binding(otherPool)).toBeDefined();

      const beforeRetry = reads.length;
      runtime.setScene(prepare([...textures.slice(1), otherPool]));
      runtime.update([view]);
      await waitFor(() => expect(reads.length).toBeGreaterThan(beforeRetry));
      expect(reads[beforeRetry]!.url).not.toContain("/other/");
      reads[beforeRetry]!.resolve(new Response(new Blob([new Uint8Array([1])])));
      await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(6));
      runtime.update([view]);
      expect(runtime.runtimeSnapshot().failedPages).toBe(0);
      expect(textures.slice(1).some((asset) => runtime.binding(asset) !== undefined)).toBe(true);
    } finally {
      runtime.dispose();
      await waitFor(() => expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0));
    }
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
      expect(runtime.snapshot(first).status).toBe("ready");
      expect(runtime.snapshot(second).status).toBe("ready");
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
    await waitFor(() => expect(runtime.snapshot(texture).status).toBe("ready"));
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
