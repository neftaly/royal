import { readVirtualTexturePage } from "../../packages/renderer-webgl/src/virtual-texture/browser-page-source";
vi.mock("../../packages/renderer-webgl/src/texture/origin-clean", () => ({ proveOriginClean: vi.fn(async () => {}) }));
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
import { SvgRasterCache } from "../../packages/renderer-webgl/src/virtual-texture/svg-raster-cache";
import * as automaticPageSources from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";
import * as virtualTextureDemand from "../../packages/renderer-webgl/src/virtual-texture/demand";
import { parseVirtualTextureManifest, type VirtualTexturePageId } from "../../packages/renderer-webgl/src/virtual-texture/manifest";
import type { EncodedSvgTextureSource } from "../../packages/renderer-webgl/src/texture/source";

const nativePageFormats = [
  ["ktx2-etc2", 152], ["ktx2-astc-6x6", 166], ["ktx2-astc-8x8", 172],
  ["ktx2-bc1", 134], ["ktx2-bc3", 138], ["ktx2-bc7", 146],
] as const;

afterEach(() => vi.unstubAllGlobals());

describe("VT runtime activation core", () => {
  it("keeps delimiter-like content and version values in distinct identity classes", () => {
    const values = [undefined, 0, "0", "/first.json", "manifest", "number", "undefined", '["unversioned"]', '"\\\n🦊'];
    const keys = new Set<string>();
    for (const contentKey of values) for (const version of values) {
      const identity = { ...(contentKey === undefined ? {} : { contentKey }), ...(version === undefined ? {} : { version }) };
      const key = virtualTextureAssetKey(virtualTexture({ manifestUri: "/first.json", ...identity }));
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      const alias = virtualTextureAssetKey(virtualTexture({ manifestUri: "/second.json", ...identity }));
      expect(alias === key).toBe(contentKey !== undefined);
    }
  });

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
  it.each(([undefined, 166, 172] as const).flatMap(vk =>
    ["complete", "cancel", "refill", "failed-refill"].map(mode => ({ vk, mode }))))("overlaps authored tile transport with bounded decode (native: $vk, mode: $mode)", async ({ vk, mode }) => {
    const cancel = mode === "cancel";
    const refill = mode.endsWith("refill");
    const failedRead = mode === "failed-refill";
    const virtualSize = refill ? 512 : 256;
    const owner = new AsyncPreparationOwner(2);
    const requests: { signal: AbortSignal; resolve: () => void; reject: (error: Error) => void }[] = [];
    const extension = vk === undefined ? "png" : "ktx2";
    const storedSize = vk === undefined ? 130 : 144;
    const pageBytes = vk === undefined ? storedSize ** 2 * 4 : (storedSize / (vk === 166 ? 6 : 8)) ** 2 * 16;
    const body = () => vk === undefined ? new Uint8Array([1]).buffer : createKtx2Etc2Fixture(vk, 144, 144, 1).buffer as ArrayBuffer;
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      if (String(input).endsWith(".json")) return new Response(JSON.stringify({
        contractVersion: 2, pageSize: 128, borderTexels: vk === undefined ? 1 : 8, virtualSize: [virtualSize, virtualSize],
        pageEncoding: vk === undefined ? "image" : vk === 166 ? "ktx2-astc-6x6" : "ktx2-astc-8x8",
        pages: { uriTemplate: `{mip}-{x}-{y}.${extension}` },
      }));
      if (String(input).endsWith(`${refill ? 2 : 1}-0-0.${extension}`)) return new Response(body());
      await new Promise<void>((resolve, reject) => {
        requests.push({ signal: init!.signal!, resolve, reject });
        init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return new Response(body());
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
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })), compressedTexSubImage2D: vi.fn() });
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), undefined, owner.runForeground,
      undefined, undefined, true, owner.run);
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: virtualSize, height: virtualSize, x: 0, y: 0 } };
    try {
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
        nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(requests).toHaveLength(4);
      });
      expect(owner.snapshot().activeJobs).toBe(0);
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(4 * pageBytes);
      if (refill) {
        if (failedRead) requests[0]!.reject(new Error("transport failed"));
        else requests[0]!.resolve();
        await waitFor(() => {
          if (!failedRead) runtime.update([view]);
          expect(requests).toHaveLength(5);
          expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: failedRead ? 1 : 2,
            failedPages: failedRead ? 1 : 0, pendingPages: 4, pendingPageBytes: 4 * pageBytes });
        });
        for (let frame = 0; frame < 100; frame++) runtime.update([view]);
        expect(requests).toHaveLength(5);
        expect(owner.snapshot().activeJobs).toBe(0);
        expect(requests.slice(1).every(request => !request.signal.aborted)).toBe(true);
        runtime.dispose();
        await waitFor(() => expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0));
      } else if (cancel) {
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
      expect(maxActive).toBe(vk === undefined ? 1 : 0);
      if (vk !== undefined) expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(refill ? (failedRead ? 1 : 2) : cancel ? 1 : 5);
    } finally { runtime.dispose(); owner.dispose(); }
  });

  it("publishes changed source demand once while preserving lists held by asynchronous readers", () => {
    const collect = vi.spyOn(virtualTextureDemand, "collectVirtualTextureDemand");
    const manifest = parseVirtualTextureManifest({ contractVersion: 2, virtualSize: [512, 512],
      pageSize: 128, borderTexels: 2, pages: { uriTemplate: "{mip}/{x}/{y}.png" } });
    const setDemand = vi.fn((_pages: readonly VirtualTexturePageId[]) => {});
    const hasCachedPage = vi.fn(() => false);
    const close = vi.fn();
    const factory = vi.spyOn(automaticPageSources, "createAutomaticSvgPageSource").mockImplementation(() => ({
      manifest, setDemand, hasCachedPage, close, read: () => new Promise<never>(() => {}),
    }));
    const decoded = { width: 64, height: 64, source: {} as ImageBitmap,
      encodedSvg: { blob: new Blob(["<svg/>"]), byteLength: 6,
        parsed: { document: {} as XMLDocument, viewBox: [0, 0, 64, 64] as const } } };
    const asset = imageTexture({ src: "/demand.svg", sampler: { minFilter: "linear-mipmap-nearest" } });
    const prepared = prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [
      mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) }),
    ] }), undefined, undefined, () => decoded);
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn(), undefined, undefined, {
      acquireDecoded: () => ({ source: decoded, release: vi.fn() }), decoded: () => decoded, onChanged: vi.fn(),
    });
    const matrix = identityMat4(); matrix[0] = matrix[5] = 2; matrix[12] = 1;
    const view = { view: identityMat4(), viewProjection: matrix, viewport: { width: 512, height: 512, x: 0, y: 0 } };
    try {
      runtime.setScene(prepared); runtime.update([view]);
      expect(setDemand).toHaveBeenCalledOnce();
      expect(hasCachedPage).toHaveBeenCalledOnce();
      const first = setDemand.mock.calls[0]![0];
      const original = first.map(page => ({ ...page }));
      runtime.update([view]); // Settle initial atlas admission before measuring reuse.
      const initialCollections = collect.mock.calls.length;
      // Moving the viewport origin preserves its projected page demand.
      for (let frame = 0; frame < 10; frame++) { view.viewport.x = frame; view.viewport.y = -frame; runtime.update([view]); }
      expect(collect).toHaveBeenCalledTimes(initialCollections);
      expect(setDemand).toHaveBeenCalledOnce();
      expect(hasCachedPage).toHaveBeenCalledOnce();
      matrix[12] = -1; runtime.update([view]);
      expect(setDemand).toHaveBeenCalledTimes(2);
      expect(setDemand.mock.calls[1]![0]).toHaveLength(first.length);
      expect(setDemand.mock.calls[1]![0]).not.toEqual(first);
      expect(first).toEqual(original);
      matrix[12] = 10; runtime.update([view]);
      expect(setDemand).toHaveBeenLastCalledWith([]);
      const calls = setDemand.mock.calls.length;
      matrix[12] = 11; runtime.update([view]);
      expect(setDemand).toHaveBeenCalledTimes(calls);
      matrix[12] = 1; runtime.update([view]);
      expect(setDemand).toHaveBeenLastCalledWith(original);
      const restored = setDemand.mock.calls.length;
      runtime.invalidate(); runtime.update([view]);
      expect(setDemand).toHaveBeenCalledTimes(restored);
      runtime.setScene(null); runtime.setScene(prepared); runtime.update([view]);
      expect(factory).toHaveBeenCalledTimes(2);
      expect(setDemand).toHaveBeenCalledTimes(restored + 1);
      expect(close).toHaveBeenCalledOnce();
      for (const dimension of ["width", "height"] as const) {
        const beforeResize = collect.mock.calls.length;
        view.viewport[dimension] *= 2;
        runtime.update([view]);
        expect(collect.mock.calls.length).toBeGreaterThan(beforeResize);
      }
      runtime.update([]);
      expect(setDemand).toHaveBeenLastCalledWith([]);
      const hiddenMatrix = identityMat4(); hiddenMatrix[12] = 10;
      const secondMatrix = identityMat4();
      const hidden = { ...view, viewProjection: hiddenMatrix };
      const second = { ...view, viewProjection: secondMatrix, viewport: { ...view.viewport } };
      runtime.update([hidden, second]);
      expect(setDemand.mock.calls.at(-1)![0].length).toBeGreaterThan(0);
      // Allow atlas growth and admission to settle after restoring visible demand.
      for (let frame = 0; frame < 10; frame++) runtime.update([hidden, second]);
      const beforeOrigin = collect.mock.calls.length;
      for (let frame = 0; frame < 10; frame++) {
        second.viewport.x += 100; second.viewport.y += 100;
        runtime.update([hidden, second]);
        expect(collect).toHaveBeenCalledTimes(beforeOrigin);
      }
      secondMatrix[12] = 10;
      runtime.update([hidden, second]);
      expect(setDemand).toHaveBeenLastCalledWith([]);
      runtime.update([view]);
      expect(setDemand.mock.calls.at(-1)![0].length).toBeGreaterThan(0);
    } finally { runtime.dispose(); factory.mockRestore(); collect.mockRestore(); }
  });

  it.each([512, 1024])("rasterizes %ipx targets once per bounded region before cache eviction", async (viewportSize) => {
    const context = { clearRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(), save: vi.fn(), restore: vi.fn(), scale: vi.fn(), translate: vi.fn() };
    vi.stubGlobal("document", { baseURI: "https://example.test/", createElement: () => ({ getContext: () => context, width: 0, height: 0 }) });
    const attributes = new Map<string, string>();
    vi.stubGlobal("XMLSerializer", class { serializeToString = () => "<svg/>"; });
    const decode = vi.fn(async () => ({ width: Number(attributes.get("width")), height: Number(attributes.get("height")), close: vi.fn() }));
    vi.stubGlobal("createImageBitmap", decode);
    const encoded: EncodedSvgTextureSource = { blob: new Blob(["<svg/>"]), byteLength: 6, parsed: {
      document: {
        documentElement: { getAttribute: () => null, cloneNode: () => ({ setAttribute: vi.fn() }) },
        createElementNS: () => ({ appendChild: vi.fn(), setAttribute: (name: string, value: string) => attributes.set(name, value) }),
      } as unknown as XMLDocument,
      viewBox: [0, 0, 64, 64],
    } };
    const decoded = { width: 64, height: 64, source: {} as ImageBitmap, preview: { encoded, load: async () => encoded } };
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
      // Hundreds of pages need over 120 update turns at four uploads per turn.
      // Allow scheduler contention in the full suite without changing admission.
      await vi.waitFor(() => {
        const uploaded = runtime.runtimeSnapshot().uploadedPages;
        runtime.update([view]);
        expect(runtime.runtimeSnapshot().uploadedPages - uploaded).toBeLessThanOrEqual(4);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: viewportSize === 512 ? 126 : 486, unresidentPages: 0, pendingPages: 0 });
      }, { interval: 1, timeout: 3000 });
      expect(decode).toHaveBeenCalledTimes(viewportSize === 512 ? 12 : 54);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBeLessThanOrEqual(4 * 1024 * 1024 + 6 * 64 * 64 * 4);
      const probes = vi.spyOn(SvgRasterCache.prototype, "has");
      try {
        for (let frame = 0; frame < 10; frame++) runtime.update([view]);
        expect(probes).not.toHaveBeenCalled();
      } finally { probes.mockRestore(); }
    } finally { runtime.dispose(); }
  });

  it("shows preview coverage, loads the adjacent SVG mip, and replaces preview on a coarse-only target", async () => {
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
      parsed: { document: {
        documentElement: { getAttribute: () => null, cloneNode: () => ({ setAttribute: vi.fn() }) },
        createElementNS: () => ({ appendChild: vi.fn(), setAttribute: (key: string, value: string) => attrs.set(key, value) }),
      } as unknown as XMLDocument, viewBox: [0, 0, 64, 64] },
    };
    let resolve!: (value: EncodedSvgTextureSource) => void;
    const detail: { encoded?: EncodedSvgTextureSource; load: () => Promise<EncodedSvgTextureSource> } = {
      load: vi.fn(() => detail.encoded === undefined
        ? new Promise<EncodedSvgTextureSource>((done) => { resolve = done; })
        : Promise.resolve(detail.encoded)),
    };
    const decoded = { width: 64, height: 64, source: {} as ImageBitmap, preview: detail };
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
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 81, pendingPages: 0 });
      });
      expect(sizes).toHaveLength(9);
      expect(sizes.every(size => size <= 1028)).toBe(true);
      expect(runtime.runtimeSnapshot().pageRequests).toBe(81);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBeLessThanOrEqual(64 * 64 * 4 + 4 * 1024 * 1024);
      view.viewport.width = 64;
      view.viewport.height = 64;
      await waitFor(() => {
        runtime.update([view]);
        expect(sizes).toHaveLength(10);
        expect(sizes.at(-1)).toBe(128);
        expect(runtime.runtimeSnapshot().pendingPages).toBe(0);
      });
      expect(runtime.automaticBinding(asset)).toBeDefined();
      expect(runtime.runtimeSnapshot().pageRequests).toBe(82);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBeGreaterThan(64 * 64 * 4);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBeLessThanOrEqual(64 * 64 * 4 + 4 * 1024 * 1024);
    } finally {
      runtime.dispose();
    }
    expect(close).toHaveBeenCalledTimes(10);
  });

  it("uses fractional demand when a native preview has a non-power-of-two size", () => {
    const detail = { size: { width: 512, height: 512 }, load: vi.fn(() => new Promise<never>(() => {})) };
    const source = { kind: "ktx2-native" as const, format: "astc-8x8" as const, colorSpace: "srgb" as const,
      width: 80, height: 80, levels: [{ width: 80, height: 80, blocks: new Uint8Array(1600) }], preview: detail };
    const asset = imageTexture("/preview");
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn(), undefined, undefined, {
      acquireDecoded: () => ({ source, release: vi.fn() }), decoded: () => source, onChanged: vi.fn(),
    });
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 72, height: 72, x: 0, y: 0 } };
    try {
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [
        mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) }),
      ] }), undefined, undefined, () => source));
      runtime.update([view]);
      expect(detail.load).not.toHaveBeenCalled();
      expect(runtime.runtimeSnapshot().atlasBytes).toBe(0);
      view.viewport.width = view.viewport.height = 96;
      runtime.update([view]);
      expect(detail.load).toHaveBeenCalledOnce();
    } finally { runtime.dispose(); }
  });

  it("reserves raster detail before loading, counts shared authority once and retries after release", () => {
    const makeSource = () => {
      const pending = new Promise<never>(() => {});
      const detail = { size: { width: 4096, height: 4096 }, rasterBytes: 40 * 1024 * 1024, retainedBytes: 0,
        load: vi.fn(() => { detail.retainedBytes = detail.rasterBytes; return pending; }) };
      return { kind: "ktx2-native" as const, format: "astc-8x8" as const, colorSpace: "srgb" as const,
        width: 32, height: 32, levels: [{ width: 32, height: 32, blocks: new Uint8Array(256) }], preview: detail };
    };
    const first = makeSource(), second = makeSource();
    const assets = [imageTexture("/first"), imageTexture("/alias"), imageTexture("/second")];
    const decoded = (asset: { kind: string; src?: string }) => asset.src === "/second" ? second : first;
    const release = vi.fn();
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn(), undefined, undefined, {
      acquireDecoded: (asset) => ({ source: decoded(asset), release }), decoded, onChanged: vi.fn(),
    });
    const prepare = (textures: typeof assets) => prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
      nodes: textures.map(texture => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
    }), undefined, undefined, decoded);
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 128, height: 128, x: 0, y: 0 } };
    try {
      runtime.setScene(prepare([assets[0]!]));
      runtime.update([view]);
      // A later sampler/source alias must reuse the existing 40 MiB authority.
      runtime.setScene(prepare(assets));
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      expect(runtime.runtimeSnapshot().automaticResources).toBe(3);
      expect(first.preview.load).toHaveBeenCalled();
      expect(second.preview.load).not.toHaveBeenCalled();
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBe(40 * 1024 * 1024 + 512);
      expect(runtime.runtimeSnapshot().failedPages).toBe(0);
      runtime.setScene(prepare([assets[2]!]));
      runtime.update([view]);
      expect(second.preview.load).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledTimes(2);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBe(40 * 1024 * 1024 + 256);
    } finally { runtime.dispose(); }
  });

  it.each([false, true])("isolates shared-atlas authority failure (failed resource first: %s)", async (failedFirst) => {
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => new Response(String(input).endsWith("healthy.json")
      ? JSON.stringify({ contractVersion: 2, borderTexels: 2, pageSize: 128, physicalSlots: 8,
        virtualSize: [512, 512], pages: { uriTemplate: "page-{mip}-{x}-{y}.png" } })
      : new Uint8Array([1]))));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 132, height: 132, close: vi.fn() })));
    let reject!: (error: Error) => void;
    const detail: { size: { width: number; height: number }; error?: string; load: () => Promise<never> } = {
      size: { width: 512, height: 512 }, load: vi.fn(() => new Promise<never>((_resolve, fail) => { reject = fail; })),
    };
    const decoded = { kind: "ktx2-native" as const, format: "astc-8x8" as const, colorSpace: "srgb" as const,
      width: 32, height: 32, levels: [{ width: 32, height: 32, blocks: new Uint8Array(256) }], preview: detail };
    const healthy = virtualTexture("https://example.test/healthy.json"), failed = imageTexture("https://example.test/failed.png");
    const prepare = (textures: (typeof healthy | typeof failed)[]) => prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}), nodes: textures.map(texture => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
    }), undefined, undefined, () => decoded);
    const gl = fakeGl(), budget = new PersistentGpuBudgetOwner();
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget, undefined, {
      acquireDecoded: () => ({ source: decoded, release: vi.fn() }), decoded: () => decoded, onChanged: vi.fn(),
    });
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 128, height: 128, x: 0, y: 0 } };
    try {
      runtime.setScene(prepare(failedFirst ? [failed, healthy] : [healthy, failed]));
      await waitFor(() => {
        runtime.update([view]);
        expect(detail.load).toHaveBeenCalledOnce();
        expect(runtime.snapshot(healthy).residentPages).toBeGreaterThan(0);
      });
      expect(runtime.runtimeSnapshot().atlasPools).toBe(1);
      const resident = runtime.snapshot(healthy).residentPages;
      const binding = runtime.binding(healthy)!;
      expect(binding).toBeDefined();
      const deleted = vi.mocked(gl.deleteTexture).mock.calls.length;
      detail.error = "Full authority unavailable"; reject(new Error(detail.error));
      await waitFor(() => { runtime.update([view]); expect(runtime.runtimeSnapshot()).toMatchObject({ failedPages: 1, pendingPages: 0 }); });
      for (let frame = 0; frame < 30; frame++) runtime.update([view]);
      expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, residentPages: resident, pendingPages: 0, unresidentPages: 0 });
      expect(runtime.snapshot(healthy).residentPages).toBe(resident);
      expect(runtime.binding(healthy)).toBe(binding);
      expect(vi.mocked(gl.deleteTexture).mock.calls.every(([texture]) =>
        texture !== binding.atlas.texture && texture !== binding.pageTable.texture)).toBe(true);
      expect(gl.deleteTexture).toHaveBeenCalledTimes(deleted + 1); // Failed page table only; shared atlas remains.
      expect(detail.load).toHaveBeenCalledOnce();
      runtime.setScene(prepare([failed]));
      runtime.update([view]);
      expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 0, atlasBytes: 0, residentPages: 0 });
      expect(budget.snapshot().retainedBytes).toBe(0);
    } finally { runtime.dispose(); }
  });

  it.each([false, true])("keeps native preview separate from deferred vector coverage (failure: %s)", async (failure) => {
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
      parsed: { document: {
        documentElement: { getAttribute: () => null, cloneNode: () => ({ setAttribute: vi.fn() }) },
        createElementNS: () => ({ appendChild: vi.fn(), setAttribute: (key: string, value: string) => attrs.set(key, value) }),
      } as unknown as XMLDocument, viewBox: [0, 0, 64, 64] },
    };
    let resolve!: (value: EncodedSvgTextureSource) => void;
    let reject!: (error: Error) => void;
    const detail: { error?: string; encoded?: EncodedSvgTextureSource; load: () => Promise<EncodedSvgTextureSource> } = {
      load: vi.fn(() => detail.encoded === undefined
        ? new Promise<EncodedSvgTextureSource>((done, fail) => { resolve = done; reject = fail; })
        : Promise.resolve(detail.encoded)),
    };
    const decoded = { kind: "ktx2-native" as const, format: "astc-8x8" as const, colorSpace: "srgb" as const,
      width: 64, height: 64, levels: [{ width: 64, height: 64, blocks: new Uint8Array(1024) }], preview: detail };
    const asset = imageTexture("https://example.test/preview.png");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
    }), undefined, undefined, () => decoded);
    const gl = fakeGl();
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), undefined, undefined, {
      acquireDecoded: () => ({ source: decoded, release: vi.fn() }),
      decoded: () => decoded, onChanged: vi.fn(),
    });
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 1024, height: 1024, x: 0, y: 0 } };
    try {
      runtime.setScene(prepared);
      view.viewport.width = 32;
      view.viewport.height = 32;
      for (let frame = 0; frame < 10; frame++) runtime.update([view]);
      expect(detail.load).not.toHaveBeenCalled();
      expect(gl.createTexture).not.toHaveBeenCalled();
      expect(runtime.runtimeSnapshot().residentPages).toBe(0);
      expect(runtime.automaticBinding(asset)).toBeUndefined();
      view.viewport.width = 1024;
      view.viewport.height = 1024;
      await waitFor(() => {
        runtime.update([view]);
        expect(detail.load).toHaveBeenCalledOnce();
      });
      expect(runtime.automaticBinding(asset)).toBeUndefined();
      expect(decode).not.toHaveBeenCalled();
      expect(runtime.runtimeSnapshot().residentPages).toBe(0);
      if (failure) {
        detail.error = "SVG unavailable";
        reject(new Error(detail.error));
        await waitFor(() => {
          runtime.update([view]);
          expect(runtime.runtimeSnapshot().pendingPages).toBe(0);
        });

        for (let frame = 0; frame < 100; frame++) runtime.update([view]);
        expect(detail.load).toHaveBeenCalledOnce();
        expect(runtime.automaticBinding(asset)).toBeUndefined();
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 0, atlasBytes: 0, atlasPools: 0, desiredPages: 0 });
        expect(decode).not.toHaveBeenCalled();
        const allocations = vi.mocked(gl.createTexture).mock.calls.length;
        const alias = imageTexture({ src: "https://example.test/preview.png", sampler: { magFilter: "nearest" } });
        runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [
          mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: alias }) }),
        ] }), undefined, undefined, () => decoded));
        for (let frame = 0; frame < 100; frame++) runtime.update([view]);
        expect(gl.createTexture).toHaveBeenCalledTimes(allocations);
        expect(detail.load).toHaveBeenCalledOnce();
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasBytes: 0, desiredPages: 0, failedPages: 1 });
        return;
      }
      detail.encoded = encoded;
      resolve(encoded);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 81, pendingPages: 0 });
      });
      expect(sizes).toHaveLength(10);
      expect(sizes.every(size => size <= 1028)).toBe(true);
      expect(runtime.runtimeSnapshot().pageRequests).toBe(81);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBeLessThanOrEqual(1024 + 4 * 1024 * 1024);
      view.viewport.width = 64;
      view.viewport.height = 64;
      await waitFor(() => {
        runtime.update([view]);
        expect(sizes).toHaveLength(10);
        expect(runtime.runtimeSnapshot().pendingPages).toBe(0);
      });
      expect(runtime.automaticBinding(asset)).toBeDefined();
      expect(runtime.runtimeSnapshot().pageRequests).toBe(81);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBeGreaterThan(1024);
      expect(runtime.runtimeSnapshot().automaticDecodedBytes).toBeLessThanOrEqual(1024 + 4 * 1024 * 1024);
    } finally {
      runtime.dispose();
    }
    expect(close).toHaveBeenCalledTimes(10);
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
    const decoded = { width: 64, height: 64, source: {} as ImageBitmap, preview: detail };
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

  it.each([
    ["ktx2-etc2", 152, 4, 16, 2052, 0x9279],
    ["ktx2-astc-6x6", 166, 6, 16, 2052, 0x93d4],
    ["ktx2-astc-8x8", 172, 8, 16, 2056, 0x93d7],
    ["ktx2-bc1", 134, 4, 8, 2052, 0x8c4d],
    ["ktx2-bc3", 138, 4, 16, 2052, 0x8c4f],
    ["ktx2-bc7", 146, 4, 16, 2052, 0x8e8d],
  ] as const)("reserves %s bytes through decode, upload, and invalidation", async (encoding, vk, block, blockBytes, storedSize, glFormat) => {
    const bytes = createKtx2Etc2Fixture(vk, storedSize, storedSize);
    const pageBytes = (storedSize / block) ** 2 * blockBytes;
    const manifest = {
      borderTexels: (storedSize - 2048) / 2, contractVersion: 2, pageSize: 2048, pageEncoding: encoding,
      pages: { uriTemplate: "page-{mip}-{x}-{y}.ktx2" }, physicalSlots: 1, virtualSize: [2048, 2048],
    };
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => new Response(
      String(input).endsWith(".json") ? JSON.stringify(manifest) : new Uint8Array(bytes).buffer,
    )));
    const gl = fakeGl();
    const upload = vi.fn();
    Object.assign(gl, { compressedTexSubImage2D: upload, getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })) });
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
      expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPageBytes: pageBytes, pageRequests: 1, failedPages: 0 });
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(asset).residentPages).toBe(1);
      });
      expect(upload).toHaveBeenCalledOnce();
      expect(upload.mock.calls[0]![6]).toBe(glFormat);
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0);
      runtime.invalidate();
      runtime.update([view]);
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(pageBytes);
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
    rejectAtlasUpload = false;
    runtime.update([view]);
    await waitFor(() => expect(pageReads).toHaveLength(3));
    pageReads[2]!.resolve(new Response(new Blob([new Uint8Array([1])])));
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(3));
    texSubImage2D.mockClear();
    runtime.update([view]);
    expect(runtime.binding(first)).toBeDefined();
    expect(runtime.binding(second)).toBeUndefined();
    const tableUploads = texSubImage2D.mock.calls.filter((call) => call.length === 9);
    expect(tableUploads.map((call) => call[1])).toEqual([0, 1, 0, 1]);
    expect(tableUploads.filter((call) => call[1] === 1)
      .map((call) => (call[8] as Uint8Array)[3])).toEqual([255, 0]);
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
    expect(scheduled).not.toHaveBeenCalled();
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    runtime.update([view]);
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
    expect(scheduled.mock.calls.length).toBeGreaterThan(0);

    runtime.update([view]);
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(12));
    expect(texSubImage2D.mock.calls.filter((call) => call.length === 9)
      .slice(-2).map((call) => call[1])).toEqual([0, 1]);
    texSubImage2D.mockClear();
    changed.mockClear();

    runtime.update([view]);
    expect(texSubImage2D).toHaveBeenCalledTimes(3);
    expect(texSubImage2D.mock.calls.filter((call) => call.length === 9)
      .map((call) => call[1])).toEqual([0]);
    expect(changed).toHaveBeenCalled();
    expect(runtime.runtimeSnapshot()).toMatchObject({
      admittedUploadBytes: 92,
      deferredUploads: 1,
      uploadBudgetBytes: 100,
    });
    texSubImage2D.mockClear();
    runtime.update([view]);
    expect(texSubImage2D).toHaveBeenCalledTimes(3);
    expect(texSubImage2D.mock.calls.filter((call) => call.length === 9)
      .map((call) => call[1])).toEqual([0]);
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
    const otherDecoded = { ...decoded, source: {} as ImageBitmap };
    const resolveDecoded = (asset: { kind: string; src?: string }) => asset.src === second.src ? otherDecoded : decoded;
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [first, second].map((texture, index) => mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture }),
        transform: { position: [index * 3, 0, 0] },
      })),
    }), undefined, undefined, resolveDecoded);
    const release = vi.fn();
    const acquireDecoded = vi.fn((asset: { kind: string; src?: string }) => ({ release, source: resolveDecoded(asset) }));
    const runtime = createBrowserVirtualTextureRuntime(
      fakeGl(),
      vi.fn(),
      new PersistentGpuBudgetOwner(),
      (_signal, work) => work(),
      { acquireDecoded, decoded: resolveDecoded, onChanged: vi.fn() },
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

describe("native VT compatibility", () => {
  it.each(nativePageFormats.flatMap(([pageEncoding, vk]) => ["orientation", "color-space", "color-override", "format", "width", "height", "mips"].map(defect => ({ pageEncoding, vk, defect }))))(
    "bounds malformed $pageEncoding $defect page failure and recovers with a new version", async ({ pageEncoding, vk, defect }) => {
    let malformed = true;
    const colorSpace = defect === "color-override" ? "linear" : "srgb";
    const fetch = vi.fn(async (input: URL | RequestInfo) => new Response(
      String(input).endsWith(".json") ? JSON.stringify({
        contractVersion: 2, pageEncoding, pageSize: 128, borderTexels: 8, virtualSize: [128, 128],
        pages: { uriTemplate: "{mip}-{x}-{y}.ktx2" },
      }) : createKtx2Etc2Fixture(
        malformed && defect === "format" ? (vk === 166 ? 172 : 166)
          : (malformed && defect === "color-space") || (!malformed && defect === "color-override") ? vk - 1 : vk,
        malformed && defect === "width" ? 72 : 144,
        malformed && defect === "height" ? 72 : 144,
        malformed && defect === "mips" ? 2 : 1,
        [["KTXorientation", malformed && defect === "orientation" ? "ru" : "rd"]]).buffer as ArrayBuffer,
    ));
    vi.stubGlobal("fetch", fetch);
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })), compressedTexSubImage2D: vi.fn() });
    const budget = new PersistentGpuBudgetOwner();
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
    const asset = virtualTexture({ manifestUri: "https://example.test/malformed.json", colorSpace });
    const setAsset = (texture: typeof asset) => runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
      nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })],
    })));
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
    try {
      setAsset(asset);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(asset)).toMatchObject({ status: "ready", failedPages: 1, pendingPages: 0, residentPages: 0 });
      });
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0);
      expect(budget.snapshot().retainedBytes).toBe(0);
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let frame = 0; frame < 100; frame++) expect(() => runtime.update([view])).not.toThrow();
      runtime.invalidate();
      for (let frame = 0; frame < 100; frame++) expect(() => runtime.update([view])).not.toThrow();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(gl.texStorage2D).toHaveBeenCalledTimes(allocations);
      expect(budget.snapshot().retainedBytes).toBe(0);
      expect(gl.compressedTexSubImage2D).not.toHaveBeenCalled();
      expect(runtime.snapshot(asset)).toMatchObject({ failedPages: 1, pendingPages: 0, residentPages: 0 });
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0);
      runtime.setScene(null);
      expect(runtime.runtimeSnapshot()).toMatchObject({ atlasBytes: 0, pendingPageBytes: 0, failedPages: 0 });
      malformed = false;
      setAsset(asset);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(asset)).toMatchObject({ failedPages: 0, pendingPages: 0, residentPages: 1 });
      });
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(gl.compressedTexSubImage2D).toHaveBeenCalledOnce();
      runtime.setScene(null);
      malformed = true;
      setAsset(asset);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(asset)).toMatchObject({ failedPages: 1, pendingPages: 0, residentPages: 0 });
      });
      expect(fetch).toHaveBeenCalledTimes(6);
      expect(budget.snapshot().retainedBytes).toBe(0);
      malformed = false;
      const replacement = virtualTexture({ manifestUri: asset.manifestUri, colorSpace, version: 1 });
      setAsset(replacement);
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(replacement)).toMatchObject({ failedPages: 0, pendingPages: 0, residentPages: 1 });
      });
      expect(fetch).toHaveBeenCalledTimes(8);
      expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(2);
      runtime.setScene(null);
      expect(runtime.runtimeSnapshot()).toMatchObject({ atlasBytes: 0, pendingPageBytes: 0, failedPages: 0 });
      expect(budget.snapshot().retainedBytes).toBe(0);
    } finally { runtime.dispose(); }
  });

  it.each(([["ktx2-astc-6x6", 166], ["ktx2-astc-8x8", 172]] as const).flatMap(([pageEncoding, vk]) =>
    [false, true].flatMap(brokenFirst => ["orientation", "color-space"].map(defect => ({ pageEncoding, vk, brokenFirst, defect })))))(
    "keeps detail and neighbors usable after $pageEncoding coarse $defect failure, broken first $brokenFirst", async ({ pageEncoding, vk, brokenFirst, defect }) => {
      const brokenCoarse = "https://example.test/broken/1/0/0.ktx2";
      const fetch = vi.fn(async (input: URL | RequestInfo) => new Response(
        String(input).endsWith(".json") ? JSON.stringify({
          contractVersion: 2, pageEncoding, pageSize: 128, borderTexels: 8, virtualSize: [256, 256],
          pages: { uriTemplate: "{mip}/{x}/{y}.ktx2" },
        }) : createKtx2Etc2Fixture(String(input) === brokenCoarse && defect === "color-space" ? vk - 1 : vk, 144, 144, 1,
          [["KTXorientation", String(input) === brokenCoarse && defect === "orientation" ? "ru" : "rd"]]).buffer as ArrayBuffer,
      ));
      vi.stubGlobal("fetch", fetch);
      const gl = fakeGl();
      Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })), compressedTexSubImage2D: vi.fn() });
      const budget = new PersistentGpuBudgetOwner();
      const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
      const broken = virtualTexture("https://example.test/broken/index.json");
      const healthy = virtualTexture("https://example.test/healthy/index.json");
      const setAssets = (assets: typeof broken[]) => runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
        nodes: assets.map(texture => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
      })));
      const matrix = identityMat4();
      const view = { view: matrix, viewProjection: matrix, viewport: { width: 128, height: 128, x: 0, y: 0 } };
      const settle = async () => waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(broken)).toMatchObject({ failedPages: 1, pendingPages: 0, residentPages: 4 });
        expect(runtime.snapshot(healthy)).toMatchObject({ failedPages: 0, pendingPages: 0, residentPages: 5 });
      });
      try {
        setAssets(brokenFirst ? [broken, healthy] : [healthy, broken]);
        await waitFor(() => {
          runtime.update([view]);
          expect(runtime.snapshot(broken)).toMatchObject({ failedPages: 1, pendingPages: 0, residentPages: 0 });
          expect(runtime.snapshot(healthy)).toMatchObject({ failedPages: 0, pendingPages: 0, residentPages: 1 });
        });
        const coarseAllocations = vi.mocked(gl.texStorage2D).mock.calls.length;
        for (let frame = 0; frame < 100; frame++) runtime.update([view]);
        expect(gl.texStorage2D).toHaveBeenCalledTimes(coarseAllocations);
        view.viewport.width = view.viewport.height = 256;
        await settle();
        expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(9);
        for (let frame = 0; frame < 100; frame++) runtime.update([view]);
        expect(fetch).toHaveBeenCalledTimes(12);
        const detailBinding = runtime.binding(broken)!;
        const detailAllocations = vi.mocked(gl.texStorage2D).mock.calls.length;
        view.viewport.width = view.viewport.height = 128;
        for (let frame = 0; frame < 100; frame++) runtime.update([view]);
        expect(runtime.snapshot(broken)).toMatchObject({ failedPages: 1, pendingPages: 0, residentPages: 4 });
        expect(runtime.binding(broken)!.atlas.texture).toBe(detailBinding.atlas.texture);
        expect(gl.texStorage2D).toHaveBeenCalledTimes(detailAllocations);
        expect(fetch).toHaveBeenCalledTimes(12);
        view.viewport.width = view.viewport.height = 256;
        await settle();
        expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(9);
        runtime.invalidate();
        await settle();
        expect(fetch.mock.calls.filter(([input]) => String(input) === brokenCoarse)).toHaveLength(1);
        expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(18);
        const atlas = runtime.binding(healthy)!.atlas.texture;
        setAssets([healthy]); runtime.update([view]);
        expect(runtime.binding(healthy)!.atlas.texture).toBe(atlas);
        expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, failedPages: 0, residentPages: 5, pendingPageBytes: 0 });
        expect(vi.mocked(gl.deleteTexture).mock.calls.every(([texture]) => texture !== atlas)).toBe(true);
        runtime.setScene(null);
        expect(budget.snapshot().retainedBytes).toBe(0);
      } finally { runtime.dispose(); }
    },
  );

  it.each([["ktx2-astc-6x6", 166], ["ktx2-astc-8x8", 172]] as const)(
    "ignores a late cancelled %s failure after the replacement page loads", async (pageEncoding, vk) => {
      let rejectStale!: (reason: Error) => void;
      let staleSignal: AbortSignal | undefined;
      let pageReads = 0;
      vi.stubGlobal("fetch", vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
        if (String(input).endsWith(".json")) return Promise.resolve(new Response(JSON.stringify({
          contractVersion: 2, pageEncoding, pageSize: 128, borderTexels: 8, virtualSize: [128, 128],
          pages: { uriTemplate: "{mip}/{x}/{y}.ktx2" },
        })));
        if (++pageReads === 1) {
          staleSignal = init?.signal ?? undefined;
          return new Promise<Response>((_resolve, reject) => { rejectStale = reject; });
        }
        return Promise.resolve(new Response(createKtx2Etc2Fixture(vk, 144, 144, 1).buffer as ArrayBuffer));
      }));
      const gl = fakeGl();
      Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })), compressedTexSubImage2D: vi.fn() });
      const budget = new PersistentGpuBudgetOwner();
      const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
      const asset = virtualTexture("https://example.test/cancelled/index.json");
      const matrix = identityMat4();
      const view = { view: matrix, viewProjection: matrix, viewport: { width: 128, height: 128, x: 0, y: 0 } };
      try {
        runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
          nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
        })));
        await waitFor(() => { runtime.update([view]); expect(pageReads).toBe(1); });
        const offscreen = identityMat4(); offscreen[12] = 100;
        runtime.update([{ ...view, viewProjection: offscreen }]);
        expect(staleSignal?.aborted).toBe(true);
        await waitFor(() => {
          runtime.update([view]);
          expect(runtime.snapshot(asset)).toMatchObject({ residentPages: 1, failedPages: 0, pendingPages: 0 });
        });
        expect(pageReads).toBe(2);
        rejectStale(new Error("late transport failure after cancellation"));
        await waitFor(() => expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0));
        for (let frame = 0; frame < 100; frame++) runtime.update([view]);
        expect(runtime.snapshot(asset)).toMatchObject({ residentPages: 1, failedPages: 0, pendingPages: 0 });
        expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(1);
        runtime.invalidate();
        await waitFor(() => {
          runtime.update([view]);
          expect(runtime.snapshot(asset)).toMatchObject({ residentPages: 1, failedPages: 0, pendingPages: 0 });
        });
        expect(pageReads).toBe(3);
        expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(2);
        runtime.setScene(null);
        expect(budget.snapshot().retainedBytes).toBe(0);
      } finally { runtime.dispose(); }
    },
  );

  it.each(nativePageFormats)("settles unsupported %s without page downloads or GPU allocation", async (pageEncoding) => {
    const borderTexels = pageEncoding === "ktx2-astc-8x8" ? 4 : 2;
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      contractVersion: 2, pageEncoding, pageSize: 128, borderTexels, virtualSize: [128, 128],
      pages: { uriTemplate: "{mip}-{x}-{y}.ktx2" },
    })));
    vi.stubGlobal("fetch", fetch);
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner();
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget, undefined, undefined, undefined, false);
    const asset = virtualTexture("https://test.invalid/native.json");
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
    try {
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
        nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
      })));
      await waitFor(() => expect(runtime.snapshot(asset).status).toBe("unsupported"));
      for (let frame = 0; frame < 100; frame++) expect(() => runtime.update([view])).not.toThrow();
      expect(runtime.snapshot(asset).status).toBe("unsupported");
      expect(fetch).toHaveBeenCalledOnce();
      expect(gl.getExtension).toHaveBeenCalledTimes(pageEncoding === "ktx2-etc2" ? 0 : 1);
      expect(gl.texStorage2D).not.toHaveBeenCalled();
      expect(budget.snapshot().retainedBytes).toBe(0);
    } finally { runtime.dispose(); }
  });
});

it.each(nativePageFormats.flatMap(([pageEncoding, vk]) => [false, true].map(metadata => ({ pageEncoding, vk, metadata }))))(
  'compacts backing-buffer storage for padded $pageEncoding pages, metadata $metadata', async ({ pageEncoding, vk, metadata }) => {
    const source = createKtx2Etc2Fixture(vk, 144, 144, 1, metadata
      ? [["KTXorientation", "rd"], ["KTXswizzle", "rgba"], ["writer", "fixture".repeat(128)]] : []);
    const index = new DataView(source.buffer);
    const offset = Number(index.getBigUint64(80, true));
    const length = Number(index.getBigUint64(88, true));
    const expectedBlocks = source.subarray(offset, offset + length);
    // Opaque structural payload: exercise every copied byte without claiming rendered codec validity.
    for (let i = 0; i < expectedBlocks.length; i++) expectedBlocks[i] = (i * 31 + 17) % 251;
    const padded = new Uint8Array(source.byteLength + 1024 * 1024);
    padded.set(source);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(padded.buffer)));
    const manifest = parseVirtualTextureManifest({ contractVersion: 2, pageEncoding,
      pageSize: 128, borderTexels: 8, virtualSize: [128, 128], pages: { uriTemplate: '{page}.ktx2' } });
    const decoded = await readVirtualTexturePage('https://fixture.invalid/index.json', manifest,
      { mip: 0, x: 0, y: 0 }, new AbortController().signal);
    expect(decoded).toBeDefined();
    if (!decoded || decoded.kind === 'image') throw new Error('Expected native blocks');
    const blockSize = vk === 166 ? 6 : vk === 172 ? 8 : 4;
    const expected = (144 / blockSize) ** 2 * (vk === 134 ? 8 : 16);
    expect(decoded.blocks.byteLength).toBe(expected);
    expect(decoded.blocks.buffer.byteLength).toBe(expected);
    expect(decoded.blocks.byteOffset).toBe(0);
    expect(decoded.blocks.findIndex((byte, index) => byte !== expectedBlocks[index])).toBe(-1);
    decoded.close();
  },
);

it.each(nativePageFormats.flatMap(([pageEncoding, vk]) =>
  [false, true].map(malformed => ({ pageEncoding, vk, malformed }))))(
  "cancels queued $pageEncoding decoding before inspecting bytes, malformed $malformed", async ({ pageEncoding, vk, malformed }) => {
    const bytes = malformed ? new Uint8Array([0]) : createKtx2Etc2Fixture(vk, 144, 144, 1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes.buffer as ArrayBuffer)));
    const manifest = parseVirtualTextureManifest({ contractVersion: 2, pageEncoding,
      pageSize: 128, borderTexels: 8, virtualSize: [128, 128], pages: { uriTemplate: "{page}.ktx2" } });
    let release: (() => void) | undefined;
    // Deliberately resume cancelled work: the source must also guard its decode boundary.
    const schedule: AsyncPreparationScheduler = async (_signal, prepare) => {
      await new Promise<void>(resolve => { release = resolve; });
      return prepare();
    };
    const controller = new AbortController();
    const pending = readVirtualTexturePage("https://fixture.invalid/index.json", manifest,
      { mip: 0, x: 0, y: 0 }, controller.signal, schedule);
    await waitFor(() => expect(release).toBeDefined());
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    release!();
    await rejected;
  },
);

it.each(nativePageFormats.flatMap(([pageEncoding, vk]) =>
  [false, true].map(loading => ({ pageEncoding, vk, loading }))))(
  "restores $pageEncoding across invalidation, still loading $loading", async ({ pageEncoding, vk, loading }) => {
    let release: (() => void) | undefined;
    let pageSignal: AbortSignal | undefined;
    const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      if (String(input).endsWith(".json")) return new Response(JSON.stringify({ contractVersion: 2,
        pageEncoding, pageSize: 128, borderTexels: 8, virtualSize: [128, 128], pages: { uriTemplate: "{page}.ktx2" } }));
      if (loading) await new Promise<void>((resolve, reject) => {
        release = resolve; pageSignal = init?.signal ?? undefined;
        pageSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
      return new Response(createKtx2Etc2Fixture(vk, 144, 144, 1).buffer as ArrayBuffer);
    });
    vi.stubGlobal("fetch", fetch);
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })), compressedTexSubImage2D: vi.fn() });
    gl.isContextLost.mockReturnValue(true);
    const budget = new PersistentGpuBudgetOwner();
    const changed = vi.fn();
    const runtime = createBrowserVirtualTextureRuntime(gl, changed, budget);
    const asset = virtualTexture("https://example.test/ready/index.json");
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 128, height: 128, x: 0, y: 0 } };
    try {
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
        nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
      })));
      await waitFor(() => expect(runtime.snapshot(asset).status).toBe("ready"));
      expect(gl.getExtension).not.toHaveBeenCalled();
      gl.isContextLost.mockReturnValue(false);
      changed.mockClear();
      runtime.update([view]);
      if (loading) await waitFor(() => expect(release).toBeDefined());
      else await waitFor(() => expect(changed).toHaveBeenCalledWith(asset, true));
      expect(runtime.snapshot(asset)).toMatchObject({ residentPages: 0, pendingPages: 1, failedPages: 0 });
      const pendingBytes = runtime.runtimeSnapshot().pendingPageBytes;
      expect(pendingBytes).toBeGreaterThan(0);
      expect(gl.compressedTexSubImage2D).not.toHaveBeenCalled();
      runtime.invalidate();
      vi.mocked(gl.getExtension).mockClear();
      expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPages: loading ? 1 : 0,
        pendingPageBytes: loading ? pendingBytes : 0, atlasBytes: 0 });
      expect(budget.snapshot().retainedBytes).toBe(0);
      if (loading) {
        expect(pageSignal?.aborted).toBe(false);
        release!();
        await waitFor(() => expect(changed).toHaveBeenCalledWith(asset, true));
        expect(runtime.runtimeSnapshot().atlasBytes).toBe(0);
      }
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(asset)).toMatchObject({ residentPages: 1, pendingPages: 0, failedPages: 0 });
      });
      if (pageEncoding !== "ktx2-etc2") expect(gl.getExtension).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(loading ? 2 : 3);
      expect(gl.compressedTexSubImage2D).toHaveBeenCalledOnce();
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0);
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  },
);

it.each(([["ktx2-astc-6x6", 166, 9216], ["ktx2-astc-8x8", 172, 5184]] as const).flatMap(([pageEncoding, vk, pageBytes]) =>
  ([[1, -1, 0], [1, 0, 1], [2, -1, 1], [2, 0, 2]] as const).map(([multiple, adjustment, capacity]) =>
    ({ pageEncoding, vk, pageBytes, byteBudget: pageBytes * multiple + adjustment, capacity }))))(
  "honors $pageEncoding authored byte limit $byteBudget (capacity $capacity)", async ({ pageEncoding, vk, byteBudget, capacity }) => {
    const fetch = vi.fn(async (input: URL | RequestInfo) => new Response(String(input).endsWith(".json")
      ? JSON.stringify({ contractVersion: 2, pageEncoding, pageSize: 128, borderTexels: 8,
        virtualSize: [128, 256], physicalByteBudget: byteBudget, mipCount: 1, pages: { uriTemplate: "{page}.ktx2" } })
      : createKtx2Etc2Fixture(vk, 144, 144, 1).buffer as ArrayBuffer));
    vi.stubGlobal("fetch", fetch);
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })), compressedTexSubImage2D: vi.fn() });
    const budget = new PersistentGpuBudgetOwner();
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
    const asset = virtualTexture("https://example.test/byte-limit.json");
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
    try {
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
        nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }) })],
      })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.snapshot(asset)).toMatchObject({ status: capacity ? "ready" : "unsupported",
          residentPages: capacity, pendingPages: 0, failedPages: 0 });
      });
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let frame = 0; frame < 100; frame++) runtime.update([view]);
      expect(fetch).toHaveBeenCalledTimes(capacity + 1);
      expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(capacity);
      expect(gl.texStorage2D).toHaveBeenCalledTimes(allocations);
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0);
      if (!capacity) expect(budget.snapshot().retainedBytes).toBe(0);
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  },
);

it.each(([["ktx2-astc-6x6", 166, 9216], ["ktx2-astc-8x8", 172, 5184], ["image", 0, 82944]] as const).flatMap(([pageEncoding, vk, pageBytes]) =>
  [false, true].flatMap(limitedFirst => ["bytes", "slots"].map(limit => ({ pageEncoding, vk, pageBytes, limitedFirst, limit })))))(
  "bounds moving $pageEncoding residency by $limit in a shared atlas, limited first $limitedFirst",
  async ({ pageEncoding, vk, pageBytes, limitedFirst, limit }) => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 144, height: 144, close: vi.fn() })));
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const uri = String(input);
      return new Response(uri.endsWith(".json") ? JSON.stringify({ contractVersion: 2, pageEncoding,
        pageSize: 128, borderTexels: 8, virtualSize: [256, 128], mipCount: 1,
        ...(limit === "bytes" ? { physicalByteBudget: pageBytes * (uri.includes("limited") ? 1 : 2) }
          : { physicalSlots: uri.includes("limited") ? 1 : 2 }),
        pages: { uriTemplate: "{mip}-{x}-{y}.ktx2" } })
        : vk === 0 ? new Uint8Array([1]) : createKtx2Etc2Fixture(vk, 144, 144, 1).buffer as ArrayBuffer);
    });
    vi.stubGlobal("fetch", fetch);
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })), compressedTexSubImage2D: vi.fn() });
    const budget = new PersistentGpuBudgetOwner();
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
    const limited = virtualTexture("https://example.test/limited/index.json");
    const neighbor = virtualTexture("https://example.test/neighbor/index.json");
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 256, x: 0, y: 0 } };
    const prepare = (x: number) => prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
      nodes: (limitedFirst ? [limited, neighbor] : [neighbor, limited]).map(texture => mesh({
        geometry: planeGeometry(2), material: unlitMaterial({ texture }),
        ...(texture === limited ? { transform: { position: [x, 0, 0] as const, scale: [4, 1, 1] as const } } : {}),
      })),
    }));
    try {
      let uploads = 2;
      for (const x of [2, -2, 2]) {
        runtime.setScene(prepare(x));
        uploads++;
        await waitFor(() => {
          runtime.update([view]);
          expect(runtime.runtimeSnapshot().uploadedPages).toBe(uploads);
          expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, pendingPages: 0, unresidentPages: 0, failedPages: 0 });
        });
        expect(runtime.snapshot(limited).residentPages).toBe(1);
        expect(runtime.snapshot(neighbor).residentPages).toBe(2);
        expect(runtime.binding(limited)!.atlas.texture).toBe(runtime.binding(neighbor)!.atlas.texture);
      }
      const allocations = vi.mocked(gl.texStorage2D).mock.calls.length;
      for (let frame = 0; frame < 100; frame++) runtime.update([view]);
      expect(fetch).toHaveBeenCalledTimes(7);
      expect(runtime.runtimeSnapshot().uploadedPages).toBe(5);
      expect(gl.texStorage2D).toHaveBeenCalledTimes(allocations);
      expect(runtime.runtimeSnapshot().pendingPageBytes).toBe(0);
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  },
);

it.each(nativePageFormats)("admits later %s textures into an existing native pool", async (pageEncoding, vk) => {
  const fetch = vi.fn(async (input: URL | RequestInfo) => new Response(String(input).endsWith('.json')
    ? JSON.stringify({ contractVersion: 2, pageEncoding, pageSize: 128, borderTexels: 8,
      physicalSlots: 1, virtualSize: [128, 128], pages: { uriTemplate: '{page}.ktx2' } })
    : createKtx2Etc2Fixture(vk, 144, 144, 1).buffer as ArrayBuffer));
  vi.stubGlobal('fetch', fetch);
  const gl = fakeGl();
  Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ['ldr'] })), compressedTexSubImage2D: vi.fn() });
  const budget = new PersistentGpuBudgetOwner();
  const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
  const assets = Array.from({ length: 5 }, (_, index) => virtualTexture(`https://example.test/late/${index}/index.json`));
  const prepare = (textures: typeof assets) => prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
    nodes: textures.map(texture => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
  }));
  const matrix = identityMat4();
  const view = { view: matrix, viewProjection: matrix, viewport: { width: 128, height: 128, x: 0, y: 0 } };
  try {
    runtime.setScene(prepare(assets.slice(0, 1)));
    await waitFor(() => { runtime.update([view]); expect(runtime.snapshot(assets[0]!).residentPages).toBe(1); });
    const atlas = runtime.binding(assets[0]!)!.atlas.texture;
    runtime.setScene(prepare(assets));
    await waitFor(() => {
      runtime.update([view]);
      for (const asset of assets) expect(runtime.snapshot(asset)).toMatchObject({ residentPages: 1, pendingPages: 0, failedPages: 0 });
    });
    for (const asset of assets) expect(runtime.binding(asset)!.atlas.texture).toBe(atlas);
    runtime.setScene(prepare(assets.slice(1)));
    for (let frame = 0; frame < 100; frame++) runtime.update([view]);
    expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, residentPages: 4, pendingPages: 0, pendingPageBytes: 0, unresidentPages: 0 });
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(5);
    expect(gl.texStorage2D).toHaveBeenCalledTimes(6); // One atlas and five page tables.
  } finally { runtime.dispose(); }
  expect(budget.snapshot().retainedBytes).toBe(0);
});

it.each(nativePageFormats)("preserves capped %s coverage when its replacement upload throws", async (pageEncoding, vk) => {
  const fetch = vi.fn(async (input: URL | RequestInfo) => new Response(String(input).endsWith('.json')
    ? JSON.stringify({ contractVersion: 2, pageEncoding, pageSize: 128, borderTexels: 8,
      physicalSlots: 1, virtualSize: [256, 128], mipCount: 1, pages: { uriTemplate: '{mip}-{x}-{y}.ktx2' } })
    : createKtx2Etc2Fixture(vk, 144, 144, 1).buffer as ArrayBuffer));
  vi.stubGlobal('fetch', fetch);
  const gl = fakeGl();
  let rejectUpload = false;
  Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ['ldr'] })),
    compressedTexSubImage2D: vi.fn(() => { if (rejectUpload) throw new Error('Injected replacement failure'); }) });
  const budget = new PersistentGpuBudgetOwner();
  const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
  const asset = virtualTexture('https://example.test/capped-upload/index.json');
  const matrix = identityMat4();
  const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 128, x: 0, y: 0 } };
  const prepare = (x: number) => prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
    nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }),
      transform: { position: [x, 0, 0], scale: [4, 1, 1] } })],
  }));
  try {
    runtime.setScene(prepare(2));
    await waitFor(() => { runtime.update([view]); expect(runtime.snapshot(asset).residentPages).toBe(1); });
    const binding = runtime.binding(asset);
    const retainedBytes = budget.snapshot().retainedBytes;
    const tableUploads = vi.mocked(gl.texSubImage2D).mock.calls.length;
    rejectUpload = true;
    runtime.setScene(prepare(-2));
    await waitFor(() => expect(() => runtime.update([view])).toThrow('Injected replacement failure'));
    expect(runtime.binding(asset)).toBe(binding);
    expect(runtime.snapshot(asset)).toMatchObject({ residentPages: 1, pendingPages: 0, failedPages: 0 });
    expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPageBytes: 0, uploadedPages: 1 });
    expect(budget.snapshot().retainedBytes).toBe(retainedBytes);
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(tableUploads);
    rejectUpload = false;
    runtime.setScene(prepare(2));
    for (let frame = 0; frame < 100; frame++) runtime.update([view]);
    expect(fetch).toHaveBeenCalledTimes(3); // Manifest, original page, failed replacement.
    expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(2);
    expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 1, pendingPages: 0, unresidentPages: 0 });
    runtime.setScene(prepare(-2));
    await waitFor(() => {
      runtime.update([view]);
      expect(runtime.runtimeSnapshot()).toMatchObject({ uploadedPages: 2, residentPages: 1, pendingPages: 0, unresidentPages: 0 });
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(3);
    expect(gl.texStorage2D).toHaveBeenCalledTimes(2);
  } finally { runtime.dispose(); }
  expect(budget.snapshot().retainedBytes).toBe(0);
});

it.each(nativePageFormats.flatMap(([pageEncoding, vk]) => [false, true].map(cancel => ({ pageEncoding, vk, cancel }))))(
  'retains one deferred $pageEncoding replacement until admission or cancellation, cancel $cancel', async ({ pageEncoding, vk, cancel }) => {
    const fetch = vi.fn(async (input: URL | RequestInfo) => new Response(String(input).endsWith('.json')
      ? JSON.stringify({ contractVersion: 2, pageEncoding, pageSize: 128, borderTexels: 8,
        physicalSlots: 1, virtualSize: [256, 128], mipCount: 1, pages: { uriTemplate: '{mip}-{x}-{y}.ktx2' } })
      : createKtx2Etc2Fixture(vk, 144, 144, 1).buffer as ArrayBuffer));
    vi.stubGlobal('fetch', fetch);
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ['ldr'] })), compressedTexSubImage2D: vi.fn() });
    const budget = new PersistentGpuBudgetOwner(), uploads = new FrameUploadBudgetOwner(1);
    const runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget, undefined, undefined, uploads);
    const asset = virtualTexture('https://example.test/deferred-cap/index.json');
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 256, height: 128, x: 0, y: 0 } };
    const prepare = (x: number) => prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
      nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: asset }),
        transform: { position: [x, 0, 0], scale: [4, 1, 1] } })],
    }));
    const busyFrame = () => {
      uploads.beginFrame(); expect(uploads.tryAdmit(1)).toBe(true);
      runtime.update([view], false);
    };
    try {
      runtime.setScene(prepare(2));
      await waitFor(() => { runtime.update([view]); expect(runtime.snapshot(asset).residentPages).toBe(1); });
      const binding = runtime.binding(asset);
      const tableUploads = vi.mocked(gl.texSubImage2D).mock.calls.length;
      runtime.setScene(prepare(-2));
      await waitFor(() => { busyFrame(); expect(uploads.snapshot().deferredUploads).toBe(1); });
      const reservedBytes = runtime.runtimeSnapshot().pendingPageBytes;
      expect(reservedBytes).toBeGreaterThan(0);
      for (let frame = 0; frame < 100; frame++) busyFrame();
      expect(runtime.binding(asset)).toBe(binding);
      expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPages: 1, pendingPageBytes: reservedBytes, residentPages: 1, uploadedPages: 1 });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(gl.compressedTexSubImage2D).toHaveBeenCalledOnce();
      expect(gl.texSubImage2D).toHaveBeenCalledTimes(tableUploads);
      if (cancel) {
        runtime.setScene(prepare(2)); busyFrame();
        expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPages: 0, pendingPageBytes: 0, residentPages: 1, unresidentPages: 0 });
        expect(runtime.binding(asset)).toBe(binding);
        runtime.setScene(prepare(-2));
      }
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPages: 0, pendingPageBytes: 0, residentPages: 1, unresidentPages: 0, uploadedPages: 2 });
      });
      expect(fetch).toHaveBeenCalledTimes(cancel ? 4 : 3);
      expect(gl.compressedTexSubImage2D).toHaveBeenCalledTimes(2);
      expect(gl.texStorage2D).toHaveBeenCalledTimes(2);
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  },
);
