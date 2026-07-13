import { afterEach, describe, expect, it, vi } from "vitest";
import { GltfPreparationScheduler } from "../packages/renderer-webgl/src/gltf/preparation-scheduler";
import {
  GENERATED_SVG_VIRTUAL_TEXTURE_MAX_DIMENSION,
  generatedSvgVirtualTextureManifest,
  generatedSvgVirtualTexturePageText,
  loadSvgTextureFromUri,
  prepareSvgTextForImage,
  svgTextureViewport,
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

  it("scales authored pixels uniformly and caps extreme logical sizes", () => {
    const source = { height: 500, label: "wide vector", text: "<svg/>", width: 1_000 };
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

  it("addresses a capped SVG's truncated NPOT edge from its logical texels", () => {
    const capped = generatedSvgVirtualTextureManifest({
      height: 3_333,
      label: "capped vector",
      text: "<svg/>",
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

  it("crops generated edge pages in logical texels while scaling the original SVG", () => {
    const source = { height: 600, label: "edge vector", text: "<svg viewBox=\"0 0 11 6\"/>", width: 1_100 };
    const manifest = generatedSvgVirtualTextureManifest(source, 2);
    const pageText = generatedSvgVirtualTexturePageText(source, manifest, {
      mip: 1,
      x: 4,
      y: 2,
    });

    expect(pageText).toContain('viewBox="2048 1024 152 176"');
    expect(pageText).toContain('width="2200" height="1200" preserveAspectRatio="none"');
  });

  it("reuses one encoded prepared document across pages for a source lifetime", () => {
    const source = {
      height: 1_024,
      label: "reused vector",
      text: '<svg width="1024" height="1024"><path d="M0 0h1024v1024z"/></svg>',
      width: 1_024,
    };
    const manifest = generatedSvgVirtualTextureManifest(source, 2);
    const btoaSpy = vi.spyOn(globalThis, "btoa");
    try {
      generatedSvgVirtualTexturePageText(source, manifest, { mip: 0, x: 0, y: 0 });
      generatedSvgVirtualTexturePageText(source, manifest, { mip: 0, x: 1, y: 0 });
      expect(btoaSpy).toHaveBeenCalledTimes(1);

      // Defensive runtime behavior: readonly is a TypeScript contract, so an
      // untyped caller that mutates text must not receive the stale data URI.
      source.text = '<svg width="1024" height="1024"><circle r="512"/></svg>';
      generatedSvgVirtualTexturePageText(source, manifest, { mip: 0, x: 2, y: 0 });
      expect(btoaSpy).toHaveBeenCalledTimes(2);
    } finally {
      btoaSpy.mockRestore();
    }
  });

  it("retains mip-zero SVG detail when a close view renders enough physical pixels", () => {
    const manifest = generatedSvgVirtualTextureManifest({
      height: 1_024,
      label: "close vector",
      text: "<svg/>",
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
