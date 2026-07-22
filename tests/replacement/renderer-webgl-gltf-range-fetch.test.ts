import { afterEach, describe, expect, it, vi } from "vitest";
import { readGltfResourceWithFetch } from "../../packages/renderer-webgl/src/gltf/asset-owner";

const response = (bytes: readonly number[], start: number, total: number): Response =>
  new Response(new Uint8Array(bytes), {
    headers: { "Content-Range": `bytes ${start}-${start + bytes.length - 1}/${total}` },
    status: 206,
  });

describe("glTF selected range transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("probes range support before fetching remaining ranges concurrently", async () => {
    const fetch = vi.fn(async (_uri: string | URL | Request, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (range === "bytes=2-4") return response([2, 3, 4], 2, 10);
      if (range === "bytes=7-8") return response([7, 8], 7, 10);
      throw new Error(`unexpected range ${range ?? "none"}`);
    });
    vi.stubGlobal("fetch", fetch);

    const bytes = await readGltfResourceWithFetch("/scene.bin", new AbortController().signal, {
      byteLength: 10,
      ranges: [
        { byteLength: 3, byteOffset: 2 },
        { byteLength: 2, byteOffset: 7 },
      ],
    });

    expect(bytes).toEqual(new Uint8Array([0, 0, 2, 3, 4, 0, 0, 7, 8, 0]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("accepts a complete response from a server which ignores Range", async () => {
    const complete = new Uint8Array([0, 1, 2, 3]);
    const fetch = vi.fn(async () => new Response(complete, { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(readGltfResourceWithFetch("/scene.bin", new AbortController().signal, {
      byteLength: 4,
      ranges: [{ byteLength: 2, byteOffset: 2 }],
    })).resolves.toEqual(complete);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to a complete read after a broken range response", async () => {
    const complete = new Uint8Array([0, 1, 2, 3]);
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 416 }))
      .mockResolvedValueOnce(new Response(complete, { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(readGltfResourceWithFetch("/scene.bin", new AbortController().signal, {
      byteLength: 4,
      ranges: [{ byteLength: 2, byteOffset: 2 }],
    })).resolves.toEqual(complete);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![1]).toEqual({ signal: expect.any(AbortSignal) });
  });
});
