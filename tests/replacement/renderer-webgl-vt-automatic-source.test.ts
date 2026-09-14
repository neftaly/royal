vi.mock("../../packages/renderer-webgl/src/texture/origin-clean", () => ({ proveOriginClean: vi.fn(async () => {}) }));
import { afterEach, describe, expect, it, vi } from "vitest";
import { SvgRasterCache } from "../../packages/renderer-webgl/src/virtual-texture/svg-raster-cache";
import {
  automaticVirtualTextureEligible,
  automaticVirtualTextureIsSvg,
  createAutomaticRasterPageSource,
  createAutomaticSvgPageSource,
  createAutomaticPreviewPageSource,
  planAutomaticVirtualTextureAxis,
} from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";

afterEach(() => {
  vi.unstubAllGlobals();
});

const svgDocument = (attributes = new Map<string, string>()): XMLDocument => ({
  documentElement: {
    getAttribute: () => null,
    cloneNode: () => ({ setAttribute: vi.fn() }),
  },
  createElementNS: () => ({
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    appendChild: vi.fn(),
  }),
}) as unknown as XMLDocument;

describe("automatic virtual texture page source", () => {
  it.each(["abort", "close"] as const)("isolates %s during shared lazy raster loading", async (mode) => {
    const context = { drawImage: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn() };
    const canvas = { getContext: () => context, width: 0, height: 0 };
    const createElement = vi.fn(() => canvas);
    vi.stubGlobal("document", { createElement });
    const close = vi.fn();
    const authority = { source: {} as ImageBitmap, width: 512, height: 512, close };
    let resolve!: (value: typeof authority) => void;
    const pending = new Promise<typeof authority>((done) => { resolve = done; });
    const preview = { source: {} as ImageBitmap, width: 64, height: 64,
      preview: { size: { width: 512, height: 512 }, load: () => pending } };
    const sampler = { magFilter: "linear", minFilter: "linear-mipmap-linear", wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" } as const;
    const first = createAutomaticPreviewPageSource(preview, sampler, "srgb");
    const survivor = mode === "abort" ? first : createAutomaticPreviewPageSource(preview, sampler, "srgb");
    const signal = new AbortController();
    const page = { mip: 0, x: 0, y: 0 };
    const cancelled = expect(first.read(page, signal.signal)).rejects.toMatchObject({ name: "AbortError" });
    const surviving = survivor.read(page, new AbortController().signal);
    if (mode === "abort") signal.abort();
    else first.close?.();
    expect(createElement).not.toHaveBeenCalled();
    resolve(authority);
    await cancelled;
    const decoded = await surviving;
    expect(decoded?.kind).toBe("image");
    expect(createElement).toHaveBeenCalledOnce();
    expect(context.drawImage).toHaveBeenCalled();
    expect(context.drawImage.mock.calls.every(([image]) => image === authority.source)).toBe(true);
    expect(close).not.toHaveBeenCalled();
    decoded?.close();
    expect([canvas.width, canvas.height]).toEqual([1, 1]);
    first.close?.();
    survivor.close?.();
    // The shared decoded-source owner, not either page source, closes the image.
    expect(close).not.toHaveBeenCalled();
  });

  it.each([
    { level: 4, xs: [0, 1, 4, 5], rasters: 2 },
    { level: 2, xs: [0, 1], rasters: 1 },
  ])("retains bounded SVG rasters at level $level across zoom reversals until cache pressure or disposal", async ({ level, xs, rasters }) => {
    const attributes = new Map<string, string>();
    const context = { clearRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn() };
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
      document: svgDocument(attributes),
      viewBox: [0, 0, 16, 8],
    } }, 16, 8, { magFilter: "linear", minFilter: "linear-mipmap-linear", wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" }, "srgb", cache);
    const mip = source.manifest.mipCount - level;
    const pages = xs.map((x) => ({ mip, x, y: 0 }));
    source.setDemand!(pages);
    try {
      expect(source.hasCachedPage!(pages[1]!)).toBe(false);
      (await source.read(pages[0]!, new AbortController().signal))!.close();
      expect(source.hasCachedPage!(pages[1]!)).toBe(true);
      if (pages[2] !== undefined) expect(source.hasCachedPage!(pages[2])).toBe(false);
      for (const page of pages.slice(1)) (await source.read(page, new AbortController().signal))!.close();
      expect(decode).toHaveBeenCalledTimes(rasters);
      expect(source.manifest.pageSize).toBe(128);
      expect(Number(attributes.get("width"))).toBeLessThanOrEqual(1028);
      expect(Number(attributes.get("height"))).toBeLessThanOrEqual(516);
      expect(cache.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(closed).not.toHaveBeenCalled();
      source.setDemand!([]);
      expect(cache.byteLength).toBeGreaterThan(0);
      expect(closed).not.toHaveBeenCalled();
      source.setDemand!(pages);
      for (const page of pages) (await source.read(page, new AbortController().signal))!.close();
      expect(decode).toHaveBeenCalledTimes(rasters);
      // Another source may reclaim the entire cache; old demand must not pin it.
      const pressure = {};
      await cache.use(pressure, 4 * 1024 * 1024,
        async () => ({ width: 1024, height: 1024, source: {} as ImageBitmap }), () => undefined);
      expect(closed).toHaveBeenCalledTimes(rasters);
      expect(source.hasCachedPage!(pages[1]!)).toBe(false);
      cache.delete(pressure);
      source.setDemand!([]);
      source.setDemand!(pages);
      (await source.read(pages[0]!, new AbortController().signal))!.close();
      expect(decode).toHaveBeenCalledTimes(rasters + 1);
    } finally { source.close!(); }
    expect(cache.byteLength).toBe(0);
    expect(closed).toHaveBeenCalledTimes(rasters + 1);
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
          document: Object.assign(svgDocument(), { documentElement: root }),
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
      parsed: { document: svgDocument(), viewBox: [0, 0, 64, 64] as const },
    };
    const load = vi.fn(async () => encoded);
    const source = createAutomaticPreviewPageSource({ width: 64, height: 64, source: previewImage, preview: { encoded, load } },
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
        parsed: { document: svgDocument(attributes), viewBox: [0, 0, width, height] },
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
