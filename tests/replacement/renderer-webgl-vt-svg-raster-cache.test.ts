import { describe, expect, it, vi } from "vitest";
import { SvgRasterCache } from "../../packages/renderer-webgl/src/virtual-texture/svg-raster-cache";
import type { DecodedImageTextureSource } from "../../packages/renderer-webgl/src/texture/source";

const bitmap = (): DecodedImageTextureSource => ({
  width: 256, height: 256, source: {} as ImageBitmap, close: vi.fn(),
});

describe("bounded shared SVG raster storage", () => {
  it("shares in-flight decoding and releases pinned storage after disposal", async () => {
    const cache = new SvgRasterCache(256);
    const key = {};
    const image = bitmap();
    let resolve!: (value: DecodedImageTextureSource) => void;
    const prepare = vi.fn(() => new Promise<DecodedImageTextureSource>((done) => { resolve = done; }));
    const first = cache.use(key, 256, prepare, () => 1);
    const second = cache.use(key, 256, prepare, () => 2);
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledOnce();
    expect(cache.byteLength).toBe(256);
    expect(await cache.use({}, 1, prepare, () => 3)).toBeUndefined();
    cache.clear();
    expect(cache.byteLength).toBe(256);
    resolve(image);
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(image.close).toHaveBeenCalledOnce();
    expect(cache.byteLength).toBe(0);
  });

  it("evicts least recently used rasters and releases rejected decode reservations", async () => {
    const cache = new SvgRasterCache(512);
    const first = bitmap();
    const second = bitmap();
    const third = bitmap();
    const key = {};
    await cache.use(key, 256, async () => first, () => 1);
    await cache.use({}, 256, async () => second, () => 2);
    await cache.use(key, 256, async () => { throw new Error("should reuse"); }, () => 1);
    await cache.use({}, 256, async () => third, () => 3);
    expect(second.close).toHaveBeenCalledOnce();
    expect(first.close).not.toHaveBeenCalled();
    await expect(cache.use({}, 512, async () => { throw new Error("decode failed"); }, () => 0)).rejects.toThrow("decode failed");
    expect(cache.byteLength).toBe(0);
    expect(first.close).toHaveBeenCalledOnce();
    expect(third.close).toHaveBeenCalledOnce();
  });

  it("keeps a shared raster alive when one page is cancelled", async () => {
    const cache = new SvgRasterCache(256);
    const key = {};
    const image = bitmap();
    let resolve!: (value: DecodedImageTextureSource) => void;
    const prepare = () => new Promise<DecodedImageTextureSource>((done) => { resolve = done; });
    const first = cache.use(key, 256, prepare, () => { throw new DOMException("cancelled", "AbortError"); });
    const rejected = expect(first).rejects.toThrow("cancelled");
    const second = cache.use(key, 256, prepare, (decoded) => {
      expect(decoded.close).not.toHaveBeenCalled();
      return "page copied";
    });
    await Promise.resolve();
    resolve(image);
    await rejected;
    expect(await second).toBe("page copied");
    expect(image.close).toHaveBeenCalledOnce();
    expect(cache.byteLength).toBe(0);
  });
});
