import { afterEach, describe, expect, it, vi } from "vitest";
import { GltfPreparationScheduler } from "../packages/renderer-webgl/src/gltf/preparation-scheduler";
import {
  isLoadedSvgTextureSource,
  loadSvgTextureFromUri,
  prepareSvgTextForImage,
  svgTextureViewport,
} from "../packages/renderer-webgl/src/svg-texture";

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

  it("leaves SVG content to secure browser image decoding without fetching or rewriting dependencies", async () => {
    const source = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8">',
      '<script>globalThis.__mustNotRun = true</script>',
      '<rect width="8" height="8" onload="globalThis.__mustNotRun = true"/>',
      '<image href="nested.svg"/>',
      '</svg>',
    ].join("");

    const prepared = await prepareSvgTextForImage(source, "opaque SVG image content");
    expect(prepared).toContain("<script>");
    expect(prepared).toContain("onload=");
    expect(prepared).toContain('href="nested.svg"');
    expect(prepared).not.toContain("data:image/svg+xml;base64");
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

  it("loads one marked ordinary SVG source without constructing VT pages", async () => {
    const objectUrlBlobs: Blob[] = [];
    class TestUrl extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        objectUrlBlobs.push(blob);
        return `blob:royal-svg-${objectUrlBlobs.length}`;
      });
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("Image", AutoLoadingImage);
    vi.stubGlobal("URL", TestUrl);
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(
      "https://assets.test/large.svg",
      '<svg width="2050" height="1300"><path d="M0 0h1v1z"/></svg>',
    )));

    const loaded = await loadSvgTextureFromUri("https://assets.test/large.svg");
    expect(isLoadedSvgTextureSource(loaded.image)).toBe(true);
    expect((loaded.image as unknown as AutoLoadingImage).crossOrigin).toBeNull();
    expect(TestUrl.createObjectURL).toHaveBeenCalledTimes(1);
    expect(TestUrl.revokeObjectURL).toHaveBeenCalledWith("blob:royal-svg-1");
    expect(objectUrlBlobs).toHaveLength(1);
  });
});

describe("SVG texture viewport normalization", () => {
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

    const normalized = await prepareSvgTextForImage(adversarial, "adversarial attributes");
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
    await expect(prepareSvgTextForImage(source, "extreme viewBox"))
      .resolves.toContain(`height="${String(Number.MIN_VALUE)}"`);
  });

});
