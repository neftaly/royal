import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "./support/wait-for";
import {
  createBrowserTextureDecoder,
} from "../../packages/renderer-webgl/src/texture/browser-decode";
import { fitOrdinaryTextureStorage } from "../../packages/renderer-webgl/src/texture/storage-fit";
import { createAvifHeader } from "./support/avif-header";
import { createKtx2Etc2Fixture } from "./support/ktx2-etc2-fixture";

const decodeTextureWithBrowser = createBrowserTextureDecoder().decode;

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubValidSvgParser = (): void => {
  const root = {
    attributes: { length: 0 },
    getAttribute: (name: string) => name === "viewBox" ? "0 0 16 8" : null,
    localName: "svg",
    querySelector: () => null,
    querySelectorAll: () => ({ length: 0 }),
  };
  vi.stubGlobal("DOMParser", class {
    parseFromString = (): object => ({ childNodes: { length: 0 }, doctype: null, documentElement: root });
  });
};

describe("browser texture decode shell", () => {
  it("transports known external sources ahead of bitmap decode without refetching", async () => {
    const bitmap = { close: vi.fn(), height: 4, width: 4 } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async () => bitmap);
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { "content-type": "image/avif" },
      }));
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", fetch);
    const decoder = createBrowserTextureDecoder();
    const controllers = Array.from({ length: 40 }, () => new AbortController());
    const assets = controllers.map((_controller, index) => ({
      kind: "asset" as const,
      src: `/texture-${index}.avif`,
    }));

    assets.forEach((asset, index) => {
      decoder.preload(asset, controllers[index]!.signal);
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(40));
    expect(createImageBitmap).not.toHaveBeenCalled();
    const decoded = await decoder.decode(assets[0]!, new AbortController().signal);

    expect(fetch).toHaveBeenCalledTimes(40);
    expect(createImageBitmap).toHaveBeenCalledOnce();
    decoded.close?.();
    controllers.forEach((controller) => controller.abort());
  });

  it("reports bounded encoded transport and releases each staged blob at decode handoff", async () => {
    const bitmap = { close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "content-type": "image/avif" },
      })));
    const changed = vi.fn();
    const decoder = createBrowserTextureDecoder(4, true, false, undefined, changed);
    const controllers = Array.from({ length: 20 }, () => new AbortController());
    const assets = controllers.map((_controller, index) => ({
      kind: "asset" as const,
      src: `/observed-${index}.avif`,
    }));

    assets.forEach((asset, index) => {
      decoder.preload(asset, controllers[index]!.signal);
    });
    await waitFor(() => expect(decoder.readAheadSnapshot()).toMatchObject({
      activeReads: 0,
      queuedReads: 0,
      sourceReservations: 20,
      stagedBytes: 80,
    }));

    const decoded = await decoder.decode(assets[0]!, controllers[0]!.signal);

    expect(decoder.readAheadSnapshot()).toMatchObject({
      sourceReservationLimit: 128,
      sourceReservations: 19,
      stagedBytes: 76,
      stagedByteThreshold: 32 * 1024 * 1024,
    });
    expect(changed).toHaveBeenCalled();
    decoded.close?.();
    controllers.forEach((controller) => controller.abort());
  });

  it("reuses a fast read-ahead failure instead of issuing a second demand read", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetch);
    const decoder = createBrowserTextureDecoder();
    const controller = new AbortController();
    const asset = { kind: "asset" as const, src: "/failed-read-ahead.avif" };

    decoder.preload(asset, controller.signal);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await expect(decoder.decode(asset, controller.signal)).rejects.toThrow("offline");

    expect(fetch).toHaveBeenCalledOnce();
    expect(decoder.readAheadSnapshot()).toMatchObject({
      activeReads: 0,
      sourceReservations: 0,
      stagedBytes: 0,
    });
  });

  it("keeps active read-ahead transport attached to cancellation after demand takes it", async () => {
    let transportSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      transportSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        transportSignal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    }));
    const decoder = createBrowserTextureDecoder();
    const controller = new AbortController();
    const asset = { kind: "asset" as const, src: "/cancelled-read-ahead.avif" };

    decoder.preload(asset, controller.signal);
    await waitFor(() => expect(transportSignal).toBeDefined());
    const demanded = decoder.decode(asset, controller.signal);
    controller.abort();

    await expect(demanded).rejects.toMatchObject({ name: "AbortError" });
    expect(transportSignal?.aborted).toBe(true);
    expect(decoder.readAheadSnapshot()).toMatchObject({
      activeReads: 0,
      sourceReservations: 0,
      stagedBytes: 0,
    });
  });

  it("bounds encoded read-ahead count while demanded work bypasses its pending queue", async () => {
    const bitmap = { close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const fetch = vi.fn(async (_input: string | URL | Request) =>
      new Response(new Uint8Array([1]), {
      headers: { "content-type": "image/avif" },
      }));
    vi.stubGlobal("fetch", fetch);
    const decoder = createBrowserTextureDecoder();
    const controllers = Array.from({ length: 129 }, () => new AbortController());
    const assets = controllers.map((_controller, index) => ({
      kind: "asset" as const,
      src: `/bounded-${index}.avif`,
    }));
    assets.forEach((asset, index) => {
      decoder.preload(asset, controllers[index]!.signal);
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(128));
    const decoded = await decoder.decode(assets[128]!, new AbortController().signal);

    expect(fetch).toHaveBeenCalledTimes(129);
    expect(fetch.mock.calls.at(-1)?.[0]).toBe("/bounded-128.avif");
    decoded.close?.();
    controllers.forEach((controller) => controller.abort());
  });

  it("routes only glTF-owned external images through the injected byte reader", async () => {
    const bitmap = { close: vi.fn(), height: 4, width: 4 } as unknown as ImageBitmap;
    const fetch = vi.fn(async () => ({
      blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      ok: true,
    }));
    const readGltfTexture = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.stubGlobal("fetch", fetch);
    const decode = createBrowserTextureDecoder(4, true, false, readGltfTexture).decode;

    const decoded = await decode({
      gltfResource: true,
      kind: "asset",
      src: "/shared.png",
      version: "release-4",
    }, new AbortController().signal);
    await decode({ kind: "asset", src: "/direct.png" }, new AbortController().signal);

    expect(readGltfTexture).toHaveBeenCalledOnce();
    expect(readGltfTexture).toHaveBeenCalledWith(
      expect.objectContaining({ src: "/shared.png", version: "release-4" }),
      expect.any(AbortSignal),
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/direct.png", expect.any(Object));
    expect(decoded.timings).toEqual({
      decodeDurationMs: expect.any(Number),
      decodeQueueDurationMs: expect.any(Number),
      transportDurationMs: expect.any(Number),
      transportQueueDurationMs: expect.any(Number),
    });
  });

  it("retains a selected glTF texture-extension MIME for opaque resource URLs", async () => {
    const bitmap = { close: vi.fn(), height: 4, width: 4 } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async (_blob: Blob) => bitmap);
    const readGltfTexture = vi.fn(async () => createAvifHeader(4, 4));
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    await createBrowserTextureDecoder(4, true, false, readGltfTexture).decode({
      gltfResource: true,
      kind: "asset",
      mimeType: "image/avif",
      src: "/opaque-image?id=albedo",
    }, new AbortController().signal);

    expect(readGltfTexture).toHaveBeenCalledOnce();
    expect(createImageBitmap.mock.calls[0]![0]).toMatchObject({ type: "image/avif" });
  });

  it("tries an authored SVG first and fetches its raster fallback only after failure", async () => {
    const bitmap = { close: vi.fn(), height: 4, width: 4 } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async () => bitmap);
    const fetch = vi.fn(async (input: string | URL | Request) => String(input) === "/preferred.svg"
      ? { ok: false, status: 503 }
      : {
          blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
          ok: true,
        });
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", fetch);

    const decoded = await createBrowserTextureDecoder().decode({
      fallback: { kind: "asset", src: "/fallback.png" },
      kind: "asset",
      sourceEncoding: "svg",
      src: "/preferred.svg",
    }, new AbortController().signal);

    expect(fetch.mock.calls.map(([input]) => input)).toEqual(["/preferred.svg", "/fallback.png"]);
    expect(decoded).toMatchObject({
      fallbackReason: expect.stringContaining("HTTP 503"),
      height: 4,
      source: bitmap,
      width: 4,
    });
  });

  it("does not request an SVG fallback after the preferred source succeeds", async () => {
    stubValidSvgParser();
    const bitmap = { close: vi.fn(), height: 8, width: 16 } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const fetch = vi.fn(async () => ({
      blob: async () => new Blob([
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 8"/>',
      ], { type: "application/octet-stream" }),
      ok: true,
    }));
    vi.stubGlobal("fetch", fetch);

    const decoded = await createBrowserTextureDecoder(4, true, true).decode({
      fallback: { kind: "asset", src: "/fallback.png" },
      kind: "asset",
      sourceEncoding: "svg",
      src: "/opaque?id=vector",
    }, new AbortController().signal);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/opaque?id=vector", expect.any(Object));
    expect(decoded).toMatchObject({ encodedSvg: { byteLength: expect.any(Number) } });
    expect(decoded).not.toHaveProperty("fallbackReason");
  });

  it("rejects an SVG response masquerading as the raster fallback", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => String(input) === "/preferred.svg"
      ? { ok: false, status: 503 }
      : {
          blob: async () => new Blob(["<svg viewBox=\"0 0 1 1\"/>"], { type: "image/svg+xml" }),
          ok: true,
        });
    vi.stubGlobal("fetch", fetch);

    await expect(createBrowserTextureDecoder().decode({
      fallback: { kind: "asset", src: "/fallback.png" },
      kind: "asset",
      sourceEncoding: "svg",
      src: "/preferred.svg",
    }, new AbortController().signal)).rejects.toThrow("fallback must be an ordinary raster");
  });

  it("retains SVG authority only for roots that request the vector handoff", async () => {
    stubValidSvgParser();
    const bitmap = { close: vi.fn(), height: 8, width: 16 } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 8"/>';
    vi.stubGlobal("fetch", vi.fn(async () => ({
      blob: async () => new Blob([svg], { type: "image/svg+xml" }),
      ok: true,
    })));
    const asset = {
      kind: "asset" as const,
      src: "/opaque-image?id=vector",
    };

    const ordinary = await createBrowserTextureDecoder().decode(
      asset,
      new AbortController().signal,
    );
    const retained = await createBrowserTextureDecoder(4, true, true).decode(
      asset,
      new AbortController().signal,
    );

    expect(ordinary).not.toHaveProperty("encodedSvg");
    expect(retained).toMatchObject({
      encodedSvg: {
        byteLength: new Blob([svg]).size,
        blob: { size: new Blob([svg]).size, type: "image/svg+xml" },
      },
    });
  });

  it("decodes embedded bytes without inventing a URL or network request", async () => {
    const NativeBlob = Blob;
    let blobPart: BlobPart | undefined;
    class TrackingBlob extends NativeBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        blobPart = parts?.[0];
        super(parts, options);
      }
    }
    const bitmap = { close: vi.fn(), height: 8, width: 16 } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async (_blob: Blob, _options?: ImageBitmapOptions) => bitmap);
    const fetch = vi.fn();
    vi.stubGlobal("Blob", TrackingBlob);
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", fetch);
    const bytes = new Uint8Array(new ArrayBuffer(8), 2, 4);
    bytes.set([137, 80, 78, 71]);
    const decoded = await decodeTextureWithBrowser({
      bytes,
      contentKey: "embedded-v1:image:0",
      kind: "embedded-asset",
      label: "model.glb images[0]",
      mimeType: "image/png",
    }, new AbortController().signal);
    expect(fetch).not.toHaveBeenCalled();
    const blob = createImageBitmap.mock.calls[0]![0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob).toMatchObject({ size: 4, type: "image/png" });
    expect(blobPart).toBe(bytes);
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

  it("uses a fitted image-element canvas when createImageBitmap is unavailable", async () => {
    const fitted = fitOrdinaryTextureStorage(2048, 1024, 340);
    const context = { clearRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
      getContext: vi.fn(() => context),
      height: 0,
      width: 0,
    };
    const image: {
      naturalHeight: number;
      naturalWidth: number;
      onerror: (() => void) | null;
      onload: (() => void) | null;
      src: string;
    } = {
      naturalHeight: 1024,
      naturalWidth: 2048,
      onerror: null,
      onload: null,
      src: "",
    };
    let imageSrc = "";
    Object.defineProperty(image, "src", {
      get: () => imageSrc,
      set: (value: string) => {
        imageSrc = value;
        if (value !== "") queueMicrotask(() => image.onload?.());
      },
    });
    const createObjectURL = vi.fn(() => "blob:royal-fallback");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("document", {
      createElement: vi.fn((kind: string) => kind === "img" ? image : canvas),
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const result = await decodeTextureWithBrowser({
      bytes: new Uint8Array([1]),
      contentKey: "dom-fallback",
      kind: "embedded-asset",
      label: "DOM fallback",
      mimeType: "image/png",
    }, new AbortController().signal, 340);

    expect(result).toMatchObject({
      height: fitted.height,
      source: canvas,
      sourceHeight: 1024,
      sourceWidth: 2048,
      width: fitted.width,
    });
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, fitted.width, fitted.height);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:royal-fallback");
  });

  it("rasterizes an SVG image-element fallback before handing pixels to WebGL", async () => {
    stubValidSvgParser();
    const context = { drawImage: vi.fn() };
    const canvas = {
      getContext: vi.fn(() => context),
      height: 0,
      width: 0,
    };
    const image = {
      naturalHeight: 8,
      naturalWidth: 16,
      onerror: null as (() => void) | null,
      onload: null as (() => void) | null,
      src: "",
    };
    let imageSrc = "";
    Object.defineProperty(image, "src", {
      get: () => imageSrc,
      set: (value: string) => {
        imageSrc = value;
        if (value !== "") queueMicrotask(() => image.onload?.());
      },
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      throw new Error("SVG bitmap decode unavailable");
    }));
    vi.stubGlobal("document", {
      createElement: vi.fn((kind: string) => kind === "img" ? image : canvas),
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:royal-svg"),
      revokeObjectURL,
    });

    const result = await decodeTextureWithBrowser({
      bytes: new TextEncoder().encode("<svg/>"),
      contentKey: "svg-canvas",
      kind: "embedded-asset",
      label: "SVG canvas",
      mimeType: "image/svg+xml",
      sourceEncoding: "svg",
    }, new AbortController().signal);

    expect(result).toMatchObject({ height: 8, source: canvas, width: 16 });
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 16, 8);
    expect(image.src).toBe("");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:royal-svg");
    result.close?.();
    expect(canvas).toMatchObject({ height: 1, width: 1 });
  });

  it("hands full-size AVIF pixels from the image-element compatibility fallback to WebGL", async () => {
    let imageSrc = "";
    const image = {
      naturalHeight: 880,
      naturalWidth: 630,
      onerror: null as (() => void) | null,
      onload: null as (() => void) | null,
      src: "",
    };
    Object.defineProperty(image, "src", {
      get: () => imageSrc,
      set: (value: string) => {
        imageSrc = value;
        if (value !== "") queueMicrotask(() => image.onload?.());
      },
    });
    const createImageBitmap = vi.fn(async () => {
      throw new Error("unsupported AVIF bitmap decode");
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("document", { createElement: vi.fn(() => image) });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:royal-avif"),
      revokeObjectURL,
    });

    const result = await decodeTextureWithBrowser({
      bytes: createAvifHeader(630, 880),
      contentKey: "direct-avif",
      kind: "embedded-asset",
      label: "direct AVIF",
      mimeType: "image/avif",
    }, new AbortController().signal);

    expect(result).toMatchObject({ height: 880, source: image, width: 630 });
    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    result.close?.();
    expect(image.src).toBe("");
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:royal-avif");
    result.close?.();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
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

  it("uses an explicit ETC2 source marker for opaque CDN URLs and embedded bytes", async () => {
    const bytes = createKtx2Etc2Fixture(152);
    const createImageBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      bytes.slice().buffer as ArrayBuffer,
      { headers: { "content-type": "application/octet-stream" } },
    )));

    const external = await decodeTextureWithBrowser({
      kind: "asset",
      sourceEncoding: "ktx2-etc2",
      src: "/opaque?id=albedo",
    }, new AbortController().signal);
    const embedded = await decodeTextureWithBrowser({
      bytes,
      contentKey: "embedded-etc2",
      kind: "embedded-asset",
      label: "embedded ETC2",
      mimeType: "image/ktx2",
      sourceEncoding: "ktx2-etc2",
    }, new AbortController().signal);

    expect(external.kind).toBe("ktx2-etc2");
    expect(embedded.kind).toBe("ktx2-etc2");
    expect(createImageBitmap).not.toHaveBeenCalled();
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

  it("rejects explicit ETC2 before transport when the WebGL capability is absent", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const decode = createBrowserTextureDecoder(1, false).decode;
    await expect(decode({
      kind: "asset",
      sourceEncoding: "ktx2-etc2",
      src: "/opaque?id=albedo",
    }, new AbortController().signal)).rejects.toThrow("WEBGL_compressed_texture_etc");
    expect(fetch).not.toHaveBeenCalled();
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

  it("decodes PNG directly to its fitted budget dimensions from a bounded header hint", async () => {
    const NativeBlob = Blob;
    const sliceEnds: Array<number | undefined> = [];
    class TrackingBlob extends NativeBlob {
      override slice(start?: number, end?: number, contentType?: string): Blob {
        sliceEnds.push(end);
        return super.slice(start, end, contentType);
      }
    }
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 13,
      73, 72, 68, 82,
      0, 0, 8, 0,
      0, 0, 4, 0,
    ]);
    const fitted = fitOrdinaryTextureStorage(2048, 1024, 340);
    const bitmap = {
      close: vi.fn(),
      height: fitted.height,
      width: fitted.width,
    } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async (
      _blob: Blob,
      _options?: ImageBitmapOptions,
    ) => bitmap);
    vi.stubGlobal("Blob", TrackingBlob);
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    const result = await decodeTextureWithBrowser({
      bytes,
      contentKey: "large-png",
      kind: "embedded-asset",
      label: "large PNG",
      mimeType: "image/png",
    }, new AbortController().signal, 340);

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(sliceEnds).toEqual([24]);
    expect(createImageBitmap.mock.calls[0]![1]).toMatchObject({
      resizeHeight: fitted.height,
      resizeQuality: "high",
      resizeWidth: fitted.width,
    });
    expect(result).toMatchObject({
      height: fitted.height,
      sourceHeight: 1024,
      sourceWidth: 2048,
      width: fitted.width,
    });
  });

  it("decodes WebP directly to its fitted budget dimensions from its container header", async () => {
    const bytes = new Uint8Array(30);
    bytes.set([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80], 0);
    bytes.set([86, 80, 56, 88, 10, 0, 0, 0], 12);
    bytes.set([0xff, 0x07, 0], 24);
    bytes.set([0xff, 0x03, 0], 27);
    const fitted = fitOrdinaryTextureStorage(2048, 1024, 340);
    const bitmap = {
      close: vi.fn(),
      height: fitted.height,
      width: fitted.width,
    } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async (
      _blob: Blob,
      _options?: ImageBitmapOptions,
    ) => bitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    const result = await decodeTextureWithBrowser({
      bytes,
      contentKey: "large-webp",
      kind: "embedded-asset",
      label: "large WebP",
      mimeType: "image/webp",
    }, new AbortController().signal, 340);

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(createImageBitmap.mock.calls[0]![1]).toMatchObject({
      resizeHeight: fitted.height,
      resizeQuality: "high",
      resizeWidth: fitted.width,
    });
    expect(result).toMatchObject({
      height: fitted.height,
      sourceHeight: 1024,
      sourceWidth: 2048,
      width: fitted.width,
    });
  });

  it("decodes AVIF directly to its fitted budget dimensions from BMFF properties", async () => {
    const bytes = createAvifHeader(2048, 1024);
    const fitted = fitOrdinaryTextureStorage(2048, 1024, 340);
    const bitmap = {
      close: vi.fn(),
      height: fitted.height,
      width: fitted.width,
    } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async (
      _blob: Blob,
      _options?: ImageBitmapOptions,
    ) => bitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    const result = await decodeTextureWithBrowser({
      bytes,
      contentKey: "large-avif",
      kind: "embedded-asset",
      label: "large AVIF",
      mimeType: "image/avif",
    }, new AbortController().signal, 340);

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(createImageBitmap.mock.calls[0]![1]).toMatchObject({
      resizeHeight: fitted.height,
      resizeQuality: "high",
      resizeWidth: fitted.width,
    });
    expect(result).toMatchObject({
      height: fitted.height,
      sourceHeight: 1024,
      sourceWidth: 2048,
      width: fitted.width,
    });
  });

  it("falls back to decode-then-fit when direct Blob resizing is unavailable", async () => {
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 13,
      73, 72, 68, 82,
      0, 0, 8, 0,
      0, 0, 4, 0,
    ]);
    const fitted = fitOrdinaryTextureStorage(2048, 1024, 340);
    const original = { close: vi.fn(), height: 1024, width: 2048 } as unknown as ImageBitmap;
    const resized = {
      close: vi.fn(),
      height: fitted.height,
      width: fitted.width,
    } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn()
      .mockRejectedValueOnce(new Error("Blob resizing unavailable"))
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(resized);
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    const result = await decodeTextureWithBrowser({
      bytes,
      contentKey: "large-png-fallback",
      kind: "embedded-asset",
      label: "large PNG fallback",
      mimeType: "image/png",
    }, new AbortController().signal, 340);

    expect(createImageBitmap).toHaveBeenCalledTimes(3);
    expect(createImageBitmap.mock.calls[1]![1]).not.toHaveProperty("resizeWidth");
    expect(createImageBitmap.mock.calls[2]![0]).toBe(original);
    expect(original.close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      height: fitted.height,
      sourceHeight: 1024,
      sourceWidth: 2048,
      width: fitted.width,
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
    expect(result.alpha).toEqual({
      height: 1,
      levels: [
        { height: 1, values: new Uint8Array([40, 200]), width: 2 },
        { height: 1, values: new Uint8Array([120]), width: 1 },
      ],
      values: new Uint8Array([40, 200]),
      width: 2,
    });
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

  it("leaves lifecycle bounds to the owner while bounding browser bitmap decode", async () => {
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
    const decode = createBrowserTextureDecoder(2).decode;
    const signal = new AbortController().signal;
    const requests = ["/a.avif", "/b.avif", "/c.avif"].map((src) => decode({
      kind: "asset",
      src,
    }, signal));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
    releases.shift()!({ close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap);
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(3));
    for (const release of releases) {
      release({ close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap);
    }
    await expect(Promise.all(requests)).resolves.toHaveLength(3);
  });

  it("rejects queued decode work immediately when its asset is abandoned", async () => {
    let releaseFirst: ((bitmap: ImageBitmap) => void) | undefined;
    const createImageBitmap = vi.fn()
      .mockImplementationOnce(() => new Promise<ImageBitmap>((resolve) => {
        releaseFirst = resolve;
      }))
      .mockResolvedValue({ close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      blob: async () => new Blob([new Uint8Array([1])]),
      ok: true,
      status: 200,
    })));
    const decode = createBrowserTextureDecoder(1).decode;
    const first = decode({ kind: "asset", src: "/first.avif" }, new AbortController().signal);
    const secondController = new AbortController();
    const second = decode({ kind: "asset", src: "/abandoned.avif" }, secondController.signal);
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());

    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(createImageBitmap).toHaveBeenCalledOnce();

    releaseFirst?.({ close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap);
    await expect(first).resolves.toMatchObject({ height: 1, width: 1 });
    expect(createImageBitmap).toHaveBeenCalledOnce();
  });

});
