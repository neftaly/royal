import { afterEach, describe, expect, it, vi } from "vitest";
import {
  automaticVirtualTextureEligible,
  createAutomaticRasterPageSource,
  createAutomaticPreviewPageSource,
  planAutomaticVirtualTextureAxis,
} from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    const preview = { kind: "ktx2-native" as const, format: "astc-8x8" as const, colorSpace: "srgb" as const, levels: [], width: 64, height: 64,
      preview: { size: { width: 512, height: 512 }, rasterBytes: 512 * 512 * 4, retainedBytes: 0, load: () => pending } };
    const sampler = { magFilter: "linear", minFilter: "linear-mipmap-linear", wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" } as const;
    const first = createAutomaticPreviewPageSource(preview.preview, sampler, "srgb");
    const survivor = mode === "abort" ? first : createAutomaticPreviewPageSource(preview.preview, sampler, "srgb");
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
