import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserTextureDecoder,
  decodeTextureWithBrowser,
} from "../../packages/renderer-webgl/src/texture/browser-decode";
import { createKtx2Etc2Fixture } from "./support/ktx2-etc2-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser texture decode shell", () => {
  it("decodes embedded bytes without inventing a URL or network request", async () => {
    const bitmap = { close: vi.fn(), height: 8, width: 16 } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async (_blob: Blob, _options?: ImageBitmapOptions) => bitmap);
    const fetch = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", fetch);
    const decoded = await decodeTextureWithBrowser({
      bytes: new Uint8Array([137, 80, 78, 71]),
      contentKey: "embedded-v1:image:0",
      kind: "embedded-asset",
      label: "model.glb images[0]",
      mimeType: "image/png",
    }, new AbortController().signal);
    expect(fetch).not.toHaveBeenCalled();
    const blob = createImageBitmap.mock.calls[0]![0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob).toMatchObject({ size: 4, type: "image/png" });
    expect(decoded).toMatchObject({ height: 8, source: bitmap, width: 16 });
    decoded.close?.();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("reports HTTP failures before browser decode", async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(decodeTextureWithBrowser({
      kind: "asset",
      src: "/missing.png",
    }, new AbortController().signal)).rejects.toThrow("HTTP 404");
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("keeps direct KTX2 ETC2 levels compressed and extracts alpha only on demand", async () => {
    const bytes = createKtx2Etc2Fixture(152);
    const createImageBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes.slice().buffer as ArrayBuffer, {
      headers: { "content-type": "image/ktx2" },
    })));

    const decoded = await decodeTextureWithBrowser({
      kind: "asset",
      sampler: { minFilter: "linear" },
      src: "/texture.ktx2?v=1",
    }, new AbortController().signal, 16, true);

    expect(decoded).toMatchObject({
      alpha: { height: 4, width: 4 },
      colorSpace: "srgb",
      height: 4,
      kind: "ktx2-etc2",
      width: 4,
    });
    if (decoded.kind !== "ktx2-etc2") throw new Error("expected compressed texture");
    expect(decoded.levels).toHaveLength(1);
    expect(decoded.levels[0]!.blocks.byteLength).toBe(16);
    expect(decoded.alpha?.values).toHaveLength(16);
    expect(createImageBitmap).not.toHaveBeenCalled();
    decoded.close?.();
    decoded.close?.();
    expect(decoded.levels[0]!.blocks.byteLength).toBe(0);
    expect(decoded.alpha?.values).toHaveLength(16);
  });

  it("rejects KTX2 color-space and exact compressed-storage budget mismatches", async () => {
    const bytes = createKtx2Etc2Fixture(152);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes.slice().buffer as ArrayBuffer)));
    await expect(decodeTextureWithBrowser({
      colorSpace: "linear",
      kind: "asset",
      src: "/texture.ktx2",
    }, new AbortController().signal)).rejects.toThrow("declares srgb ETC2 storage");
    await expect(decodeTextureWithBrowser({
      kind: "asset",
      src: "/texture.ktx2",
    }, new AbortController().signal, 15)).rejects.toThrow("needs at least 16 bytes");
  });

  it("fits compressed storage by rebasing an authored mip suffix without resampling", async () => {
    const bytes = createKtx2Etc2Fixture(152, 8, 8, 4);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes.slice().buffer as ArrayBuffer)));
    const decoded = await decodeTextureWithBrowser({
      kind: "asset",
      src: "/texture.ktx2",
    }, new AbortController().signal, 48);

    expect(decoded).toMatchObject({
      height: 4,
      kind: "ktx2-etc2",
      sourceHeight: 8,
      sourceWidth: 8,
      width: 4,
    });
    if (decoded.kind !== "ktx2-etc2") throw new Error("expected compressed texture");
    expect(decoded.levels.map((level) => level.width)).toEqual([4, 2, 1]);
    expect(decoded.levels.reduce((sum, level) => sum + level.blocks.byteLength, 0)).toBe(48);
  });

  it("resizes decoded pixels to the largest budgeted mip representation", async () => {
    const original = { close: vi.fn(), height: 2048, width: 2048 } as unknown as ImageBitmap;
    const resized = { close: vi.fn(), height: 8, width: 8 } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn()
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(resized);
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const result = await decodeTextureWithBrowser({
      bytes: new Uint8Array([1]),
      contentKey: "large",
      kind: "embedded-asset",
      label: "large",
      mimeType: "image/avif",
    }, new AbortController().signal, 340);

    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(createImageBitmap.mock.calls[1]![1]).toMatchObject({
      resizeHeight: 8,
      resizeQuality: "high",
      resizeWidth: 8,
    });
    expect(original.close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      height: 8,
      source: resized,
      sourceHeight: 2048,
      sourceWidth: 2048,
      width: 8,
    });
  });

  it("extracts only the fitted alpha plane when exact mask picking demands it", async () => {
    const bitmap = { close: vi.fn(), height: 1, width: 2 } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const getImageData = vi.fn(() => ({
      data: new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 200]),
    }));
    const context = { drawImage: vi.fn(), getImageData };
    const canvas = {
      getContext: vi.fn(() => context),
      height: 0,
      width: 0,
    };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });

    const result = await decodeTextureWithBrowser({
      bytes: new Uint8Array([1]),
      contentKey: "mask",
      kind: "embedded-asset",
      label: "mask",
      mimeType: "image/png",
    }, new AbortController().signal, undefined, true);

    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2, 1);
    expect(result.alpha).toEqual({ height: 1, values: new Uint8Array([40, 200]), width: 2 });
    expect(canvas).toMatchObject({ height: 0, width: 0 });
  });

  it("closes decoded browser storage when demanded alpha extraction fails", async () => {
    const bitmap = { close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));

    await expect(decodeTextureWithBrowser({
      bytes: new Uint8Array([1]),
      contentKey: "unreadable-mask",
      kind: "embedded-asset",
      label: "unreadable mask",
      mimeType: "image/png",
    }, new AbortController().signal, undefined, true)).rejects.toThrow("canvas pixel access");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("bounds complete jobs and browser bitmap decode as one pipeline", async () => {
    const releases: Array<(bitmap: ImageBitmap) => void> = [];
    const createImageBitmap = vi.fn(() => new Promise<ImageBitmap>((resolve) => {
      releases.push(resolve);
    }));
    const fetch = vi.fn(async () => ({
      blob: async () => new Blob([new Uint8Array([1])]),
      ok: true,
      status: 200,
    }));
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", fetch);
    const decode = createBrowserTextureDecoder(2, 2);
    const signal = new AbortController().signal;
    const requests = ["/a.avif", "/b.avif", "/c.avif"].map((src) => decode({
      kind: "asset",
      src,
    }, signal));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
    releases.shift()!({ close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(3));
    for (const release of releases) {
      release({ close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap);
    }
    await expect(Promise.all(requests)).resolves.toHaveLength(3);
  });
});
