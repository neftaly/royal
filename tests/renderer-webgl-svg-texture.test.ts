import { afterEach, describe, expect, it, vi } from "vitest";
import { GltfPreparationScheduler } from "../packages/renderer-webgl/src/gltf/preparation-scheduler";
import {
  GENERATED_SVG_VIRTUAL_TEXTURE_MAX_DIMENSION,
  generatedSvgVirtualTextureManifest,
  loadGeneratedSvgVirtualTexturePageImage,
  loadSvgTextureFromUri,
  prepareSvgTextForImage,
  svgTextureViewport,
  svgVirtualTextureSourceForImage,
} from "../packages/renderer-webgl/src/svg-texture";
import {
  virtualTexturePagesForFootprint,
  virtualTextureTargetMip,
} from "../packages/renderer-webgl/src/virtual-texture-demand";

const svg = (hrefs: readonly string[]): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">${hrefs
    .map((href) => `<image href="${href}"/>`)
    .join("")}</svg>`;

const textResponse = (url: string, text: string): Response => ({
  arrayBuffer: vi.fn(async () => new TextEncoder().encode(text).buffer),
  ok: true,
  status: 200,
  statusText: "OK",
  text: vi.fn(async () => text),
  url,
}) as unknown as Response;

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

class AutoLoadingImage extends EventTarget {
  complete = false;
  crossOrigin: string | null = null;
  #src = "";

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
    if (value === "") return;
    queueMicrotask(() => {
      this.complete = true;
      this.dispatchEvent(new Event("load"));
    });
  }

  decode(): Promise<void> {
    return Promise.resolve();
  }
}

describe("SVG texture reference lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects seeded external-reference cycles before reusing a pending cache promise", async () => {
    for (let length = 2; length <= 7; length += 1) {
      const urls = Array.from({ length }, (_, index) => `https://assets.test/cycle-${length}-${index}.svg`);
      const documents = new Map(urls.map((url, index) => [
        url,
        svg([urls[(index + 1) % urls.length]!]),
      ]));
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        return textResponse(url, documents.get(url) ?? "");
      });
      vi.stubGlobal("fetch", fetchMock);

      const first = urls[0]!;
      await expect(prepareSvgTextForImage(
        svg([first]),
        `seeded SVG cycle ${length}`,
        "https://assets.test/root.svg",
      )).rejects.toThrow(
        `cyclic SVG image reference: ${[...urls, first].join(" -> ")}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(length);
    }
  });

  it("coalesces legitimate duplicate nested image loads across sibling SVGs", async () => {
    const rootUrl = "https://assets.test/root.svg";
    const leftUrl = "https://assets.test/left.svg";
    const rightUrl = "https://assets.test/right.svg";
    const sharedUrl = "https://assets.test/shared.png";
    const documents = new Map([
      [leftUrl, svg([sharedUrl])],
      [rightUrl, svg([sharedUrl])],
    ]);
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      fetched.push(url);
      return url === sharedUrl
        ? textResponse(url, "shared-raster-bytes")
        : textResponse(url, documents.get(url) ?? "");
    }));

    await expect(prepareSvgTextForImage(svg([leftUrl, rightUrl]), "duplicate references", rootUrl))
      .resolves.toContain("data:image/svg+xml;base64");
    expect(fetched.filter((url) => url === sharedUrl)).toHaveLength(1);
  });

  it("aborts HTMLImage decode and releases an occupied scheduler lane", async () => {
    class ControlledImage extends EventTarget {
      complete = false;
      crossOrigin: string | null = null;
      src = "";

      decode(): Promise<void> {
        return Promise.resolve();
      }
    }
    class TestUrl extends URL {
      static createObjectURL = vi.fn(() => "blob:royal-svg-abort");
      static revokeObjectURL = vi.fn();
    }
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("URL", TestUrl);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
      return textResponse("https://assets.test/abort.svg", svg([]));
    }));

    const scheduler = new GltfPreparationScheduler(1);
    const controller = new AbortController();
    const active = scheduler.run(controller.signal, () =>
      loadSvgTextureFromUri("https://assets.test/abort.svg", controller.signal));
    let queuedStarted = false;
    const queued = scheduler.run(new AbortController().signal, () => {
      queuedStarted = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await expect(active).rejects.toMatchObject({ name: "AbortError" });
    await queued;
    expect(observedSignal).toBe(controller.signal);
    expect(queuedStarted).toBe(true);
    expect(TestUrl.revokeObjectURL).toHaveBeenCalledWith("blob:royal-svg-abort");
    scheduler.dispose();
  });

  it("reuses one decoded SVG across seeded page crops without embedding or reparsing its text", async () => {
    const objectUrlBlobs: Blob[] = [];
    class TestUrl extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        objectUrlBlobs.push(blob);
        return `blob:royal-svg-${objectUrlBlobs.length}`;
      });
      static revokeObjectURL = vi.fn();
    }
    const largePath = "M0 0h1v1z".repeat(8_192);
    const drawImage = vi.fn();
    const contexts: Array<{
      clearRect: ReturnType<typeof vi.fn>;
      drawImage: typeof drawImage;
      imageSmoothingEnabled: boolean;
      imageSmoothingQuality: ImageSmoothingQuality;
    }> = [];
    vi.stubGlobal("Image", AutoLoadingImage);
    vi.stubGlobal("URL", TestUrl);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        const context = {
          clearRect: vi.fn(),
          drawImage,
          imageSmoothingEnabled: false,
          imageSmoothingQuality: "low" as ImageSmoothingQuality,
        };
        contexts.push(context);
        return {
          getContext: vi.fn(() => context),
          height: 0,
          width: 0,
        };
      }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(
      "https://assets.test/large.svg",
      `<svg width="2050" height="1300"><path d="${largePath}"/></svg>`,
    )));

    const loaded = await loadSvgTextureFromUri("https://assets.test/large.svg");
    const source = svgVirtualTextureSourceForImage(loaded.image);
    expect(source).toBeDefined();
    expect(TestUrl.createObjectURL).toHaveBeenCalledTimes(1);
    expect(TestUrl.revokeObjectURL).toHaveBeenCalledWith("blob:royal-svg-1");

    const manifest = generatedSvgVirtualTextureManifest(source!, 2);
    const requestedPages: Array<{ readonly mip: number; readonly x: number; readonly y: number }> = [];
    let seed = 0x65_76_74;
    for (let index = 0; index < 32; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const mip = seed % 4;
      const scale = 2 ** mip;
      const pagesWide = Math.ceil(manifest.width / (manifest.pageSize * scale));
      const pagesHigh = Math.ceil(manifest.height / (manifest.pageSize * scale));
      const page = {
        mip,
        x: (seed >>> 8) % pagesWide,
        y: (seed >>> 16) % pagesHigh,
      };
      requestedPages.push(page);
      await loadGeneratedSvgVirtualTexturePageImage(source!, manifest, page);
    }

    expect(TestUrl.createObjectURL).toHaveBeenCalledTimes(1);
    expect(objectUrlBlobs).toHaveLength(1);
    expect(contexts).toHaveLength(32);
    expect(drawImage).toHaveBeenCalledTimes(32);
    for (const [index, call] of drawImage.mock.calls.entries()) {
      expect(call[0]).toBe(loaded.image);
      const page = requestedPages[index]!;
      const mipScale = 2 ** page.mip;
      const logicalX = page.x * manifest.pageSize * mipScale;
      const logicalY = page.y * manifest.pageSize * mipScale;
      const logicalWidth = Math.max(1, Math.min(
        manifest.pageSize * mipScale,
        manifest.width - logicalX,
      ));
      const logicalHeight = Math.max(1, Math.min(
        manifest.pageSize * mipScale,
        manifest.height - logicalY,
      ));
      expect(call.slice(1)).toEqual([
        logicalX * source!.width / manifest.width,
        logicalY * source!.height / manifest.height,
        logicalWidth * source!.width / manifest.width,
        logicalHeight * source!.height / manifest.height,
        0,
        0,
        manifest.pageSize,
        manifest.pageSize,
      ]);
    }
    expect(contexts.every((context) => context.imageSmoothingEnabled)).toBe(true);
    expect(contexts.every((context) => context.imageSmoothingQuality === "high")).toBe(true);
  });

  it("does not allocate a page canvas when source generation is aborted before its microtask", async () => {
    class TestUrl extends URL {
      static createObjectURL = vi.fn(() => "blob:royal-svg-abort-page");
      static revokeObjectURL = vi.fn();
    }
    const createElement = vi.fn();
    vi.stubGlobal("Image", AutoLoadingImage);
    vi.stubGlobal("URL", TestUrl);
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(
      "https://assets.test/retry.svg",
      '<svg width="512" height="512"/>',
    )));

    const loaded = await loadSvgTextureFromUri("https://assets.test/retry.svg");
    const source = svgVirtualTextureSourceForImage(loaded.image)!;
    const manifest = generatedSvgVirtualTextureManifest(source);
    const controller = new AbortController();
    const pending = loadGeneratedSvgVirtualTexturePageImage(
      source,
      manifest,
      { mip: 0, x: 0, y: 0 },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(createElement).not.toHaveBeenCalled();
  });
});

describe("generated SVG virtual texture density", () => {
  it("reads only exact root width and height attribute names", async () => {
    const adversarial = [
      "<svg",
      ' stroke-width="900" data-width="800" data-height="700" width-mode="600" height-mode="650"',
      ' aria-label=" width=\'500\' height=\'400\'" viewBox="0 0 16 9"/>',
    ].join("");
    expect(svgTextureViewport(adversarial)).toEqual({
      fromViewBox: true,
      height: 576,
      width: 1_024,
    });

    const normalized = await prepareSvgTextForImage(adversarial, "adversarial attributes", undefined);
    expect(normalized).toContain('stroke-width="900"');
    expect(normalized).toContain('data-width="800"');
    expect(normalized).toContain('width="1024"');
    expect(normalized).toContain('height="576"');

    expect(svgTextureViewport(
      '<svg stroke-width="900" data-width="800" data-height="700" width="640" height="360"/>',
    )).toEqual({ fromViewBox: false, height: 360, width: 640 });
  });

  it("derives bounded intrinsic pixels independently of small and large viewBox coordinates", () => {
    expect(svgTextureViewport('<svg viewBox="0 0 1 2"/>')).toEqual({
      fromViewBox: true,
      height: 1_024,
      width: 512,
    });
    expect(svgTextureViewport('<svg viewBox="-50000 10 100000 50000"/>')).toEqual({
      fromViewBox: true,
      height: 512,
      width: 1_024,
    });
  });

  it("preserves authored CSS size, physical units, and viewBox aspect derivation", () => {
    const a4 = svgTextureViewport('<svg width="210mm" height="297mm" viewBox="0 0 1 1"/>');
    expect(a4?.width).toBeCloseTo(793.700787);
    expect(a4?.height).toBeCloseTo(1_122.519685);
    expect(svgTextureViewport('<svg width="640px" viewBox="0 0 16 9"/>')).toEqual({
      fromViewBox: true,
      height: 360,
      width: 640,
    });
  });

  it("keeps extreme finite authored dimensions finite without distorting representable aspects", () => {
    const largest = String(Number.MAX_VALUE);
    expect(svgTextureViewport(`<svg width="${largest}" height="${largest}"/>`)).toEqual({
      fromViewBox: false,
      height: Number.MAX_VALUE,
      width: Number.MAX_VALUE,
    });
    expect(svgTextureViewport('<svg width="1e308in" height="1e308in"/>')).toEqual({
      fromViewBox: false,
      height: Number.MAX_VALUE,
      width: Number.MAX_VALUE,
    });

    expect(svgTextureViewport(`<svg width="${largest}" viewBox="0 0 1 2"/>`)).toEqual({
      fromViewBox: true,
      height: Number.MAX_VALUE,
      width: Number.MAX_VALUE / 2,
    });
    expect(svgTextureViewport(`<svg height="${largest}" viewBox="0 0 2 1"/>`)).toEqual({
      fromViewBox: true,
      height: Number.MAX_VALUE / 2,
      width: Number.MAX_VALUE,
    });
  });

  it("keeps extreme viewBox-only aspects positive and bounded", async () => {
    const source = `<svg viewBox="0 0 ${String(Number.MAX_VALUE)} ${String(Number.MIN_VALUE)}"/>`;
    const viewport = svgTextureViewport(
      source,
    );
    expect(viewport).toEqual({
      fromViewBox: true,
      height: Number.MIN_VALUE,
      width: 1_024,
    });
    expect(Object.values(viewport ?? {}).every((value) =>
      typeof value !== "number" || (Number.isFinite(value) && value > 0))).toBe(true);
    await expect(prepareSvgTextForImage(source, "extreme viewBox", undefined))
      .resolves.toContain(`height="${String(Number.MIN_VALUE)}"`);
  });

  it("scales authored pixels uniformly and caps extreme logical sizes", () => {
    const source = { height: 500, label: "wide vector", width: 1_000 };
    expect(generatedSvgVirtualTextureManifest(source, 8)).toMatchObject({
      height: 4_000,
      physicalSlots: 64,
      width: 8_000,
    });
    expect(generatedSvgVirtualTextureManifest({ ...source, height: 5_000, width: 10_000 }, 16)).toMatchObject({
      height: GENERATED_SVG_VIRTUAL_TEXTURE_MAX_DIMENSION / 2,
      physicalSlots: 64,
      width: GENERATED_SVG_VIRTUAL_TEXTURE_MAX_DIMENSION,
    });
    expect(() => generatedSvgVirtualTextureManifest(source, 17)).toThrow("at most 16");
  });

  it("caps extreme dimensions before density multiplication can overflow", () => {
    const manifest = generatedSvgVirtualTextureManifest({
      height: Number.MAX_VALUE / 2,
      label: "extreme vector",
      width: Number.MAX_VALUE,
    }, 16);
    expect(manifest).toMatchObject({ height: 8_192, width: 16_384 });
    expect(Number.isSafeInteger(manifest.width)).toBe(true);
    expect(Number.isSafeInteger(manifest.height)).toBe(true);

    expect(generatedSvgVirtualTextureManifest({
      height: Number.MIN_VALUE,
      label: "extreme aspect vector",
      width: Number.MAX_VALUE,
    }, 16)).toMatchObject({ height: 1, width: 16_384 });

    expect(generatedSvgVirtualTextureManifest({
      height: Number.MAX_VALUE,
      label: "sub-unit density vector",
      width: Number.MAX_VALUE,
    }, Number.MIN_VALUE)).toMatchObject({ height: 1, width: 1 });
  });

  it("addresses a capped SVG's truncated NPOT edge from its logical texels", () => {
    const capped = generatedSvgVirtualTextureManifest({
      height: 3_333,
      label: "capped vector",
      width: 10_000,
    }, 16);
    expect(capped).toMatchObject({ height: 5_461, width: 16_384 });

    // At mip 2 the final Y page begins at texel 5120 (V~=0.9376), not
    // at the equal-grid boundary 5/6. This footprint still belongs to y=4.
    expect(virtualTexturePagesForFootprint(capped, 2, {
      maxU: 0.12,
      maxV: 0.9,
      minU: 0.1,
      minV: 0.86,
      screenHeight: 200,
      screenWidth: 200,
    })).toEqual([{ mip: 2, x: 1, y: 4 }]);
  });

  it("retains mip-zero SVG detail when a close view renders enough physical pixels", () => {
    const manifest = generatedSvgVirtualTextureManifest({
      height: 1_024,
      label: "close vector",
      width: 1_024,
    }, 8);
    expect(virtualTextureTargetMip(manifest, {
      minU: 0.45,
      maxU: 0.55,
      minV: 0.45,
      maxV: 0.55,
      screenHeight: 1_024,
      screenWidth: 1_024,
    })).toBe(0);
  });
});
