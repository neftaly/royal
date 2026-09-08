import { afterEach, describe, expect, it, vi } from "vitest";
import { SvgRasterCache } from "../../packages/renderer-webgl/src/virtual-texture/svg-raster-cache";
import {
  automaticVirtualTextureEligible,
  automaticVirtualTextureIsSvg,
  createAutomaticRasterPageSource,
  createAutomaticSvgPageSource,
  createAutomaticSvgPreviewPageSource,
  planAutomaticVirtualTextureAxis,
} from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("automatic virtual texture page source", () => {
  it("shares bounded regions of a large target and releases them when demand leaves", async () => {
    const attributes = new Map<string, string>();
    const context = { drawImage: vi.fn(), getImageData: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn() };
    const closed = vi.fn();
    const decode = vi.fn(async () => ({
      width: Number(attributes.get("width")), height: Number(attributes.get("height")), close: closed,
    }));
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("XMLSerializer", class { serializeToString = () => "<svg/>"; });
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => context, width: 0, height: 0 }) });
    const cache = new SvgRasterCache();
    const blob = new Blob(["<svg/>"]);
    const source = createAutomaticSvgPageSource({ blob, byteLength: blob.size, parsed: {
      document: { documentElement: { cloneNode: () => ({ setAttribute: (name: string, value: string) => attributes.set(name, value) }) } } as unknown as XMLDocument,
      viewBox: [0, 0, 16, 8],
    } }, 16, 8, { magFilter: "linear", minFilter: "linear-mipmap-linear", wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" }, "srgb", cache);
    const mip = source.manifest.mipCount - 4;
    const pages = [0, 1, 4, 5].map((x) => ({ mip, x, y: 0 }));
    source.setDemand!(pages);
    try {
      expect(source.hasCachedPage!(pages[1]!)).toBe(false);
      (await source.read(pages[0]!, new AbortController().signal))!.close();
      expect(source.hasCachedPage!(pages[1]!)).toBe(true);
      expect(source.hasCachedPage!(pages[2]!)).toBe(false);
      for (const page of pages.slice(1)) (await source.read(page, new AbortController().signal))!.close();
      expect(decode).toHaveBeenCalledTimes(2);
      expect(Number(attributes.get("width"))).toBeLessThanOrEqual(516);
      expect(Number(attributes.get("height"))).toBeLessThanOrEqual(516);
      expect(cache.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(closed).not.toHaveBeenCalled();
      source.setDemand!([]);
      expect(cache.byteLength).toBe(0);
      expect(closed).toHaveBeenCalledTimes(2);
      expect(source.hasCachedPage!(pages[1]!)).toBe(false);
    } finally { source.close!(); }
  });

  it("recognizes explicit retained SVG authority instead of guessing from a URL", () => {
    expect(automaticVirtualTextureIsSvg({
      encodedSvg: {
        blob: new Blob(["<svg/>"]),
        byteLength: 6,
        parsed: { document: {} as XMLDocument, viewBox: [0, 0, 1, 1] as const },
      },
      height: 8,
      source: {} as ImageBitmap,
      width: 16,
    })).toBe(true);
    expect(automaticVirtualTextureIsSvg({
      height: 8,
      source: {} as ImageBitmap,
      width: 16,
    })).toBe(false);
  });

  it("reuses one parsed SVG authority without reading or fetching its source again", async () => {
    const root = {
      cloneNode: () => ({ setAttribute: vi.fn() }),
      getAttribute: (name: string) => name === "viewBox" ? "0 0 16 8" : null,
      localName: "svg",
      querySelector: () => null,
    };
    const context = { drawImage: vi.fn(), getImageData: vi.fn() };
    const blob = new Blob(['<svg viewBox="0 0 16 8"/>'], { type: "image/svg+xml" });
    const text = vi.spyOn(blob, "text");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("XMLSerializer", class {
      serializeToString = (): string => "<svg/>";
    });
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      close: vi.fn(),
      height: 132,
      width: 132,
    })));
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => context, height: 0, width: 0 }),
    });
    const source = createAutomaticSvgPageSource(
      {
        blob,
        byteLength: blob.size,
        parsed: {
          document: { documentElement: root } as unknown as XMLDocument,
          viewBox: [0, 0, 16, 8],
        },
      },
      16,
      8,
      {
        magFilter: "linear",
        minFilter: "linear-mipmap-linear",
        wrapS: "clamp-to-edge",
        wrapT: "clamp-to-edge",
      },
      "srgb",
    );

    const first = await source.read({ mip: 0, x: 1, y: 1 }, new AbortController().signal);
    if (first === undefined) throw new Error("expected first SVG page");
    first.close();
    const second = await source.read({ mip: 0, x: 2, y: 2 }, new AbortController().signal);
    if (second === undefined) throw new Error("expected second SVG page");
    second.close();

    expect(text).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    source.close?.();
    await expect(source.read(
      { mip: 0, x: 1, y: 1 },
      new AbortController().signal,
    )).rejects.toThrow("closed");
  });

  it.each([0, 1, 2])("renders early SVG quality level %i with one bounded decode", async (level) => {
    const context = { drawImage: vi.fn(), getImageData: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn() };
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => context, height: 0, width: 0 }) });
    vi.stubGlobal("XMLSerializer", class { serializeToString = (): string => "<svg/>"; });
    const close = vi.fn();
    const bitmap = { close, width: 128, height: 128 };
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    const previewImage = {} as ImageBitmap;
    const encoded = {
      blob: new Blob(["<svg/>"]), byteLength: 6,
      parsed: { document: { documentElement: { cloneNode: () => ({ setAttribute: vi.fn() }) } } as unknown as XMLDocument, viewBox: [0, 0, 64, 64] as const },
    };
    const load = vi.fn(async () => encoded);
    const source = createAutomaticSvgPreviewPageSource({ width: 64, height: 64, source: previewImage, svgPreview: { encoded, load } },
      { magFilter: "linear", minFilter: "linear-mipmap-linear", wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" }, "srgb");
    const page = await source.read({ mip: source.manifest.mipCount - 1 - level, x: 0, y: 0 }, new AbortController().signal);
    expect(load).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(context.drawImage.mock.calls.every(([image]) => image === bitmap)).toBe(true);
    page?.close();
    source.close?.();
  });

  it.each([[64, 64, 0, 0], [64, 64, 3, 3], [64, 17, 3, 0], [1, 64, 0, 3]])(
    "bounds clamped SVG decoding and covers gutters for %i x %i at %i,%i",
    async (width, height, x, y) => {
      const attributes = new Map<string, string>();
      const context = { drawImage: vi.fn(), getImageData: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn() };
      vi.stubGlobal("document", { createElement: () => ({ getContext: () => context, height: 0, width: 0 }) });
      vi.stubGlobal("XMLSerializer", class { serializeToString = (): string => "<svg/>"; });
      const close = vi.fn();
      const decode = vi.fn(async () => ({ close, width: Number(attributes.get("width")), height: Number(attributes.get("height")) }));
      vi.stubGlobal("createImageBitmap", decode);
      const source = createAutomaticSvgPageSource({
        blob: new Blob(["<svg/>"]), byteLength: 6,
        parsed: { document: { documentElement: { cloneNode: () => ({ setAttribute: (key: string, value: string) => attributes.set(key, value) }) } } as unknown as XMLDocument, viewBox: [0, 0, width, height] },
      }, width, height, { magFilter: "linear", minFilter: "linear-mipmap-linear", wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" }, "srgb");
      const page = await source.read({ mip: source.manifest.mipCount - 3, x, y }, new AbortController().signal);
      expect(decode).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      const rasterWidth = Number(attributes.get("width"));
      const rasterHeight = Number(attributes.get("height"));
      expect(rasterWidth).toBeGreaterThan(0);
      expect(rasterHeight).toBeGreaterThan(0);
      expect(rasterWidth).toBeLessThanOrEqual(source.manifest.pageSize + source.manifest.borderTexels * 2);
      expect(rasterHeight).toBeLessThanOrEqual(source.manifest.pageSize + source.manifest.borderTexels * 2);
      let area = 0;
      for (const [, sx, sy, sw, sh, , , dw, dh] of context.drawImage.mock.calls) {
        expect(sx).toBeGreaterThanOrEqual(0);
        expect(sy).toBeGreaterThanOrEqual(0);
        expect(sx + sw).toBeLessThanOrEqual(rasterWidth + 1e-9);
        expect(sy + sh).toBeLessThanOrEqual(rasterHeight + 1e-9);
        area += dw * dh;
      }
      expect(area).toBeCloseTo((source.manifest.pageSize + source.manifest.borderTexels * 2) ** 2);
      page?.close();
      source.close?.();
    },
  );

  it("selects only sufficiently large browser raster sources", () => {
    expect(automaticVirtualTextureEligible({
      height: 128,
      source: {} as ImageBitmap,
      width: 256,
    })).toBe(false);
    expect(automaticVirtualTextureEligible({
      height: 128,
      source: {} as ImageBitmap,
      width: 257,
    })).toBe(false);
    expect(automaticVirtualTextureEligible({
      height: 512,
      source: {} as ImageBitmap,
      width: 1024,
    })).toBe(true);
    expect(automaticVirtualTextureEligible({
      colorSpace: "srgb",
      height: 512,
      kind: "ktx2-etc2",
      levels: [],
      width: 512,
    })).toBe(false);
  });

  it("partitions clamp and mirrored gutters without changing destination coverage", () => {
    const clamped = planAutomaticVirtualTextureAxis(-2, 132, 512, 132, "clamp-to-edge");
    expect(clamped).toEqual([
      {
        destinationExtent: 2,
        destinationStart: 0,
        reversed: false,
        sourceExtent: 1,
        sourceStart: 0,
      },
      {
        destinationExtent: 130,
        destinationStart: 2,
        reversed: false,
        sourceExtent: 130,
        sourceStart: 0,
      },
    ]);
    const mirrored = planAutomaticVirtualTextureAxis(-2, 132, 128, 132, "mirrored-repeat");
    expect(mirrored).toEqual([
      {
        destinationExtent: 2,
        destinationStart: 0,
        reversed: true,
        sourceExtent: 2,
        sourceStart: 0,
      },
      {
        destinationExtent: 128,
        destinationStart: 2,
        reversed: false,
        sourceExtent: 128,
        sourceStart: 0,
      },
      {
        destinationExtent: 2,
        destinationStart: 130,
        reversed: true,
        sourceExtent: 2,
        sourceStart: 126,
      },
    ]);
  });

  it("derives one complete generated manifest from decoded dimensions", () => {
    const source = createAutomaticRasterPageSource({
      height: 1024,
      source: {} as ImageBitmap,
      width: 2048,
    }, {
      magFilter: "linear",
      minFilter: "linear-mipmap-linear",
      wrapS: "repeat",
      wrapT: "clamp-to-edge",
    }, "srgb");
    expect(source.manifest).toMatchObject({
      borderTexels: 2,
      colorSpace: "srgb",
      height: 1024,
      mipCount: 5,
      pageAddressing: "complete",
      pageEncoding: "image",
      pageSize: 128,
      width: 2048,
    });
  });
});
