import { afterEach, describe, expect, it, vi } from "vitest";
import { GltfPreparationScheduler } from "../packages/renderer-webgl/src/gltf/preparation-scheduler";
import {
  loadSvgTextureFromUri,
  prepareSvgTextForImage,
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
