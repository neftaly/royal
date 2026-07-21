import { afterEach, describe, expect, it, vi } from "vitest";
import {
  automaticVirtualTextureEligible,
  automaticVirtualTextureIsSvg,
  createAutomaticRasterPageSource,
  createAutomaticSvgPageSource,
  planAutomaticVirtualTextureAxis,
} from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("automatic virtual texture page source", () => {
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
