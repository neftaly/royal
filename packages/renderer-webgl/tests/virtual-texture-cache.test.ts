import { afterEach, describe, expect, it, vi } from "vitest";

import type { RendererWebGlContext } from "../src/gl";
import { VirtualTextureCache } from "../src/virtual-texture-cache";

type TexImage2DCall = {
  readonly height: number;
  readonly internalFormat: number;
  readonly level: number;
  readonly texture: WebGLTexture | null;
  readonly width: number;
};

type TexSubImage2DCall = {
  readonly byteLength: number;
  readonly height: number;
  readonly level: number;
  readonly texture: WebGLTexture | null;
  readonly width: number;
  readonly xOffset: number;
  readonly yOffset: number;
};

const fakeVirtualTextureGl = (): {
  readonly counts: { readonly createTexture: number };
  readonly gl: RendererWebGlContext;
  readonly texImages: readonly TexImage2DCall[];
  readonly texSubImages: readonly TexSubImage2DCall[];
} => {
  let nextTextureId = 0;
  let boundTexture: WebGLTexture | null = null;
  const counts = { createTexture: 0 };
  const texImages: TexImage2DCall[] = [];
  const texSubImages: TexSubImage2DCall[] = [];

  return {
    counts,
    gl: {
      CLAMP_TO_EDGE: 0x812F,
      NEAREST: 0x2600,
      RGBA: 0x1908,
      RGBA8: 0x8058,
      TEXTURE_2D: 0x0DE1,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      UNSIGNED_BYTE: 0x1401,
      bindTexture(_target: GLenum, value: WebGLTexture | null) {
        boundTexture = value;
      },
      createTexture: () => {
        counts.createTexture += 1;
        nextTextureId += 1;
        return { id: nextTextureId } as WebGLTexture;
      },
      deleteTexture() {},
      texImage2D(
        _target: GLenum,
        level: GLint,
        internalFormat: GLint,
        width: GLsizei,
        height: GLsizei,
      ) {
        texImages.push({ height, internalFormat, level, texture: boundTexture, width });
      },
      texParameteri() {},
      texSubImage2D(
        _target: GLenum,
        level: GLint,
        xOffset: GLint,
        yOffset: GLint,
        width: GLsizei,
        height: GLsizei,
        _format: GLenum,
        _type: GLenum,
        pixels: ArrayBufferView,
      ) {
        texSubImages.push({
          byteLength: pixels.byteLength,
          height,
          level,
          texture: boundTexture,
          width,
          xOffset,
          yOffset,
        });
      },
    } as unknown as RendererWebGlContext,
    texImages,
    texSubImages,
  };
};

const manifest = (id: string): unknown => ({
  id,
  pageSize: 128,
  pages: {
    uriTemplate: "pages/{mip}/{x}/{y}.rgba",
  },
  physicalSlots: 4,
  virtualSize: [256, 256],
});

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

const requestInputUri = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;

  return input.url;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VirtualTextureCache", () => {
  it("reuses the same entry for the same virtual texture descriptor", async () => {
    const { counts, gl } = fakeVirtualTextureGl();
    const fetchManifest = vi.fn(() => Promise.resolve(jsonResponse(manifest("terrain"))));
    vi.stubGlobal("fetch", fetchManifest);
    const cache = new VirtualTextureCache(gl);
    const descriptor = {
      id: "terrain",
      manifestUri: "https://assets.example.test/vt/terrain.vt.json",
      revision: "r1",
    };

    const first = cache.loadVirtualTexture(descriptor);
    const second = cache.loadVirtualTexture(descriptor);

    expect(first.kind).toBe("loading");
    expect(second.kind).toBe("loading");
    expect(first.stats.key).toBe(second.stats.key);
    expect(cache.stats()).toEqual({ entries: 1, error: 0, loading: 1, ready: 0 });

    await cache.waitForPendingLoads();
    const ready = cache.loadVirtualTexture(descriptor);
    const readyAgain = cache.loadVirtualTexture(descriptor);

    expect(ready.kind).toBe("ready");
    expect(readyAgain.kind).toBe("ready");
    if (ready.kind !== "ready" || readyAgain.kind !== "ready") throw new Error("Expected ready cache entries");
    expect(readyAgain.resource).toBe(ready.resource);
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(counts.createTexture).toBe(2);
    expect(cache.stats()).toEqual({ entries: 1, error: 0, loading: 0, ready: 1 });
  });

  it("creates distinct entries when revision or manifest URI changes", async () => {
    const { counts, gl } = fakeVirtualTextureGl();
    const fetchManifest = vi.fn((input: RequestInfo | URL) => {
      const uri = requestInputUri(input);
      return Promise.resolve(jsonResponse(manifest(uri)));
    });
    vi.stubGlobal("fetch", fetchManifest);
    const cache = new VirtualTextureCache(gl);

    cache.loadVirtualTexture({
      id: "terrain",
      manifestUri: "https://assets.example.test/vt/terrain.vt.json",
      revision: "r1",
    });
    cache.loadVirtualTexture({
      id: "terrain",
      manifestUri: "https://assets.example.test/vt/terrain.vt.json",
      revision: "r2",
    });
    cache.loadVirtualTexture({
      id: "terrain",
      manifestUri: "https://cdn.example.test/vt/terrain.vt.json",
      revision: "r1",
    });

    expect(cache.stats()).toEqual({ entries: 3, error: 0, loading: 3, ready: 0 });
    await cache.waitForPendingLoads();

    expect(cache.stats()).toEqual({ entries: 3, error: 0, loading: 0, ready: 3 });
    expect(fetchManifest).toHaveBeenCalledTimes(3);
    expect(counts.createTexture).toBe(6);
  });

  it("surfaces manifest fetch failures as non-blocking cache errors", async () => {
    const { gl } = fakeVirtualTextureGl();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("missing", { status: 404 }))));
    const cache = new VirtualTextureCache(gl);
    const descriptor = {
      id: "terrain",
      manifestUri: "https://assets.example.test/vt/missing.vt.json",
    };

    expect(cache.loadVirtualTexture(descriptor).kind).toBe("loading");
    await cache.waitForPendingLoads();
    const result = cache.loadVirtualTexture(descriptor);

    expect(result.kind).toBe("error");
    expect(result.stats).toMatchObject({
      error: "Failed to load virtual texture manifest https://assets.example.test/vt/missing.vt.json: 404",
      status: "error",
    });
    expect(cache.stats()).toEqual({ entries: 1, error: 1, loading: 0, ready: 0 });
  });

  it("loads page bytes from page URIs resolved relative to the manifest", async () => {
    const { gl } = fakeVirtualTextureGl();
    const pageRequests: string[] = [];
    const fetchAsset = vi.fn((input: RequestInfo | URL) => {
      const uri = requestInputUri(input);
      if (uri === "https://assets.example.test/vt/terrain.vt.json") {
        return Promise.resolve(jsonResponse(manifest("terrain")));
      }

      pageRequests.push(uri);
      return Promise.resolve(new Response(new Uint8Array(128 * 128 * 4)));
    });
    vi.stubGlobal("fetch", fetchAsset);
    const cache = new VirtualTextureCache(gl);
    const descriptor = {
      id: "terrain",
      manifestUri: "https://assets.example.test/vt/terrain.vt.json",
    };

    cache.loadVirtualTexture(descriptor);
    await cache.waitForPendingLoads();
    const result = cache.loadVirtualTexture(descriptor);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Expected ready cache entry");

    result.resource.requestPages({
      mip: 0,
      uMax: 0.99,
      uMin: 0.51,
      vMax: 0.49,
      vMin: 0.01,
    });
    await result.resource.waitForPendingRequests();

    expect(pageRequests).toEqual(["https://assets.example.test/vt/pages/0/1/0.rgba"]);
    expect(result.resource.stats().requests).toMatchObject({
      lastError: null,
      pagesFailed: 0,
      pagesLoaded: 1,
      sourceRequests: 1,
    });
  });

  it("loads generated manifest pages without fetching page URIs and uploads them through the VT path", async () => {
    const { gl, texSubImages } = fakeVirtualTextureGl();
    const fetchAsset = vi.fn((input: RequestInfo | URL) => {
      const uri = requestInputUri(input);
      if (uri === "https://assets.example.test/vt/generated.vt.json") {
        return Promise.resolve(jsonResponse({
          borderTexels: 1,
          id: "terrain:generated-debug",
          pageSize: 64,
          pages: {
            generator: "debug-rgba",
            kind: "generated",
          },
          physicalSlots: 2,
          virtualSize: [128, 64],
        }));
      }

      return Promise.resolve(new Response("unexpected page fetch", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchAsset);
    const cache = new VirtualTextureCache(gl);
    const descriptor = {
      id: "terrain:generated-debug",
      manifestUri: "https://assets.example.test/vt/generated.vt.json",
    };

    cache.loadVirtualTexture(descriptor);
    await cache.waitForPendingLoads();
    const result = cache.loadVirtualTexture(descriptor);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Expected ready cache entry");

    const requested = result.resource.requestPages({
      mip: 0,
      uMax: 0.99,
      uMin: 0.51,
      vMax: 0.99,
      vMin: 0.01,
    }, 1);
    await result.resource.waitForPendingRequests();
    const upload = result.resource.uploadFrame({
      frame: 2,
      pageTableUploads: 10,
      physicalAtlasUploads: 10,
    });

    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(requested).toMatchObject({
      pages: [{ mip: 0, x: 1, y: 0 }],
      scheduled: 1,
    });
    expect(upload).toMatchObject({
      bytesUploaded: 66 * 66 * 4 + 4,
      pageTableUploads: 1,
      physicalAtlasUploads: 1,
    });
    expect(texSubImages.map((call) => [call.width, call.height, call.byteLength])).toEqual([
      [66, 66, 66 * 66 * 4],
      [1, 1, 4],
    ]);
    expect(result.resource.stats().requests).toMatchObject({
      lastError: null,
      pagesFailed: 0,
      pagesLoaded: 1,
      sourceRequests: 1,
    });
  });
});
