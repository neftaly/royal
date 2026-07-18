import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserTextureDecoder,
  decodeTextureWithBrowser,
} from "../../packages/renderer-webgl/src/texture/browser-decode";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser texture decode shell", () => {
  it("decodes embedded bytes without inventing a URL or network request", async () => {
    const bitmap = { close: vi.fn(), height: 8, width: 16 } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async (_blob: Blob, _options?: ImageBitmapOptions) => bitmap);
    const fetch = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("fetch", fetch);
    const decoded = await decodeTextureWithBrowser({
      bytes: new Uint8Array([137, 80, 78, 71]),
      contentKey: "embedded-v1:image:0",
      kind: "embedded-asset",
      label: "model.glb images[0]",
      mimeType: "image/png",
    }, new AbortController().signal);
    expect(fetch).not.toHaveBeenCalled();
    const blob = createImageBitmap.mock.calls[0]![0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob).toMatchObject({ size: 4, type: "image/png" });
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

  it("keeps source fetch concurrent while bounding browser bitmap decode", async () => {
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
    const decode = createBrowserTextureDecoder(2);
    const signal = new AbortController().signal;
    const requests = ["/a.avif", "/b.avif", "/c.avif"].map((src) => decode({
      kind: "asset",
      src,
    }, signal));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
    releases.shift()!({ close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(3));
    for (const release of releases) {
      release({ close: vi.fn(), height: 1, width: 1 } as unknown as ImageBitmap);
    }
    await expect(Promise.all(requests)).resolves.toHaveLength(3);
  });
});
