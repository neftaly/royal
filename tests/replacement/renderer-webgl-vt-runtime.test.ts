import * as automaticSources from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";
import {
  imageTexture,
  perspectiveCamera,
  planeGeometry,
  scene,
  mesh,
  unlitMaterial,
} from "@royal/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "./support/wait-for";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { FrameUploadBudgetOwner } from "../../packages/renderer-webgl/src/resource/frame-upload-budget";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import type { SurfaceFrameView } from "../../packages/renderer-webgl/src/frame/surface-frame";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import {
  automaticVirtualTextureAssetKey,
  virtualTextureRuntimeRequired,
} from "../../packages/renderer-webgl/src/virtual-texture/runtime-contract";
import {
  initialVirtualTextureActivationState,
  reconcileVirtualTextureActivation,
  settleVirtualTextureActivation,
} from "../../packages/renderer-webgl/src/runtime/virtual-texture-activation";
import { fakeGl } from "./support/canvas-root-harness";
import { createGeneratedVirtualTextureLayout } from "../../packages/renderer-webgl/src/virtual-texture/layout";


afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("VT runtime activation core", () => {

  it("keeps typed versions distinct and normalizes equivalent sampler defaults", () => {
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

  it("activates lazily for automatic base-color demand", () => {
    const ordinary = imageTexture("/large.png");
    const empty = { surfaces: [] };
    const ordinaryScene = {
      surfaces: [{ material: { baseColorAsset: ordinary } }],
    };

    const decoded = () => ({ width: 1024, height: 1024, source: {} as ImageBitmap });
    expect(virtualTextureRuntimeRequired(empty, decoded)).toBe(false);
    expect(virtualTextureRuntimeRequired(ordinaryScene, () => undefined)).toBe(false);
    expect(virtualTextureRuntimeRequired(ordinaryScene, () => ({ width: 128, height: 128, source: {} as ImageBitmap }))).toBe(false);
    expect(virtualTextureRuntimeRequired(ordinaryScene, decoded)).toBe(true);
  });

  it("does not reset upload admission already owned by the surface frame", () => {
    const uploads = new FrameUploadBudgetOwner(100);
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), undefined, undefined, undefined, uploads);
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

  it("uses fractional demand when a native preview has a non-power-of-two size", () => {
    const detail = { size: { width: 512, height: 512 }, rasterBytes: 512 * 512 * 4, retainedBytes: 0, load: vi.fn(() => new Promise<never>(() => {})) };
    const source = { kind: "ktx2-native" as const, format: "astc-8x8" as const, colorSpace: "srgb" as const,
      width: 80, height: 80, levels: [{ width: 80, height: 80, blocks: new Uint8Array(1600) }], preview: detail };
    const asset = imageTexture("/preview");
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), undefined, undefined, {
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

  it("releases every sampler lease of a decoded source before restoring its resolution", () => {
    const source = { width: 1024, height: 1024, source: {} as ImageBitmap };
    const decoded = () => source;
    const assets = [imageTexture("/map.png"), imageTexture({ src: "/map.png", sampler: { wrapS: "repeat" } }), imageTexture("/other.png")];
    const release = vi.fn();
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), undefined, undefined, {
      decoded, acquireDecoded: () => ({ source, release }), onChanged: vi.fn(),
    });
    try {
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
        nodes: assets.map(texture => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
      }), undefined, undefined, decoded));
      expect(runtime.runtimeSnapshot().automaticResources).toBe(3);
      runtime.releaseRasterSource(assets[0]!);
      expect(release).toHaveBeenCalledTimes(2);
      expect(runtime.runtimeSnapshot().automaticResources).toBe(1);
      runtime.releaseRasterSource(assets[0]!);
      expect(release).toHaveBeenCalledTimes(2);
    } finally { runtime.dispose(); }
    expect(release).toHaveBeenCalledTimes(3);
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
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), undefined, undefined, {
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
    const healthyDecoded = { width: 1024, height: 1024, source: {} as ImageBitmap };
    vi.spyOn(automaticSources, "createAutomaticRasterPageSource").mockImplementation((_source, _sampler, colorSpace) => ({
      layout: createGeneratedVirtualTextureLayout({ width: 1024, height: 1024, pageSize: 128, borderTexels: 2, colorSpace }),
      read: async () => ({ kind: "image", source: { width: 132, height: 132 } as ImageBitmap, close: vi.fn() }),
    }));
    let reject!: (error: Error) => void;
    const detail: { size: { width: number; height: number }; rasterBytes: number; retainedBytes: number; error?: string; load: () => Promise<never> } = {
      size: { width: 512, height: 512 }, rasterBytes: 512 * 512 * 4, retainedBytes: 0, load: vi.fn(() => new Promise<never>((_resolve, fail) => { reject = fail; })),
    };
    const decoded = { kind: "ktx2-native" as const, format: "astc-8x8" as const, colorSpace: "srgb" as const,
      width: 32, height: 32, levels: [{ width: 32, height: 32, blocks: new Uint8Array(256) }], preview: detail };
    const healthy = imageTexture("https://example.test/healthy.png"), failed = imageTexture("https://example.test/failed.png");
    const resolveDecoded = (asset: { kind: string; src?: string }) => asset.src === healthy.src ? healthyDecoded : decoded;
    const prepare = (textures: (typeof healthy | typeof failed)[]) => prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}), nodes: textures.map(texture => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })),
    }), undefined, undefined, resolveDecoded);
    const gl = fakeGl(), budget = new PersistentGpuBudgetOwner();
    const runtime = createBrowserVirtualTextureRuntime(gl, budget, undefined, {
      acquireDecoded: asset => ({ source: resolveDecoded(asset), release: vi.fn() }), decoded: resolveDecoded, onChanged: vi.fn(),
    });
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { width: 128, height: 128, x: 0, y: 0 } };
    try {
      runtime.setScene(prepare(failedFirst ? [failed, healthy] : [healthy, failed]));
      await waitFor(() => {
        runtime.update([view]);
        expect(detail.load).toHaveBeenCalledOnce();
        expect(runtime.runtimeSnapshot().residentPages).toBeGreaterThan(0);
      });
      expect(runtime.runtimeSnapshot().atlasPools).toBe(1);
      const resident = runtime.runtimeSnapshot().residentPages;
      const binding = runtime.automaticBinding(healthy)!;
      expect(binding).toBeDefined();
      const deleted = vi.mocked(gl.deleteTexture).mock.calls.length;
      detail.error = "Full authority unavailable"; reject(new Error(detail.error));
      await waitFor(() => { runtime.update([view]); expect(runtime.runtimeSnapshot()).toMatchObject({ failedPages: 1, pendingPages: 0 }); });
      for (let frame = 0; frame < 30; frame++) runtime.update([view]);
      expect(runtime.runtimeSnapshot()).toMatchObject({ atlasPools: 1, residentPages: resident, pendingPages: 0, unresidentPages: 0 });
      expect(runtime.runtimeSnapshot().residentPages).toBe(resident);
      expect(runtime.automaticBinding(healthy)).toBe(binding);
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

  it("routes automatic raster pages through the shared demand and residency runtime", async () => {
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
    const runtime = createBrowserVirtualTextureRuntime(gl, new PersistentGpuBudgetOwner(), (_signal, work) => work(), {
        acquireDecoded: () => ({ release, source: decoded }),
        decoded: () => decoded,
        onChanged: changed,
      });
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
    const runtime = createBrowserVirtualTextureRuntime(fakeGl(), new PersistentGpuBudgetOwner(), (_signal, work) => work(), { acquireDecoded, decoded: resolveDecoded, onChanged: vi.fn() });

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
