import { describe, expect, it, vi } from "vitest";
import {
  decodeGltfBasisuTexture,
  decodedGltfBasisuEtc2,
  decodedGltfBasisuRgba,
  parseGltfBasisuWithRuntime,
  retainGltfBasisuWorker,
  type BasisuParseRuntime,
} from "../packages/renderer-webgl/src/gltf/codecs/basisu";

const level = (width: number, height: number, fill: number) => ({
  compressed: false,
  data: new Uint8Array(width * height * 4).fill(fill),
  height,
  textureFormat: "rgba8unorm",
  width,
});

const ktx2Header = (width: number, height: number): ArrayBuffer => {
  const bytes = new Uint8Array(28);
  bytes.set([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A]);
  const header = new DataView(bytes.buffer);
  header.setUint32(20, width, true);
  header.setUint32(24, height, true);
  return bytes.buffer;
};

describe("glTF BasisU RGBA normalization", () => {
  it("adopts a complete ETC2 chain with linear and sRGB upload formats", () => {
    const compressedLevel = (width: number, height: number, fill: number) => ({
      compressed: true,
      data: new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4) * 16).fill(fill),
      format: 0x9278,
      height,
      textureFormat: "etc2-rgba8unorm",
      width,
    });
    const base = compressedLevel(4, 4, 1);
    const decoded = decodedGltfBasisuEtc2([[
      base,
      compressedLevel(2, 2, 2),
      compressedLevel(1, 1, 3),
    ]], "compressed.ktx2");

    expect(decoded).toMatchObject({
      format: 0x9278,
      height: 4,
      kind: "compressed-texture",
      srgbFormat: 0x9279,
      width: 4,
    });
    expect(decoded.levels.map((entry) => entry.data[0])).toEqual([1, 2, 3]);
    expect(decoded.data).toBe(base.data);
  });

  it("owns a valid incomplete ETC2 mip prefix without expanding it to RGBA", () => {
    const compressedLevel = (width: number, height: number, fill: number) => ({
      compressed: true,
      data: new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4) * 16).fill(fill),
      format: 0x9278,
      height,
      textureFormat: "etc2-rgba8unorm",
      width,
    });
    const decoded = decodedGltfBasisuEtc2([[
      compressedLevel(8, 8, 1),
      compressedLevel(4, 4, 2),
    ]], "partial.ktx2");

    expect(decoded.kind).toBe("compressed-texture");
    expect(decoded.levels.map(({ height, width }) => ({ height, width }))).toEqual([
      { height: 8, width: 8 },
      { height: 4, width: 4 },
    ]);
  });

  it("restores sub-block KTX2 dimensions before validating ETC2 and RGBA payloads", () => {
    const paddedEtc2 = {
      compressed: true,
      data: new Uint8Array(16).fill(7),
      format: 0x9278,
      height: 4,
      textureFormat: "etc2-rgba8unorm",
      width: 4,
    };
    const paddedRgba = {
      ...level(4, 4, 9),
      data: new Uint8Array([127, 127, 255, 255]),
    };
    const header = ktx2Header(1, 1);

    expect(decodedGltfBasisuEtc2([[paddedEtc2]], "one-pixel.ktx2", header))
      .toMatchObject({ height: 1, width: 1 });
    expect(decodedGltfBasisuRgba([[paddedRgba]], "one-pixel.ktx2", header))
      .toMatchObject({ data: new Uint8Array([127, 127, 255, 255]), height: 1, width: 1 });
  });

  it("rejects transcoder dimensions that do not match logical or block-padded KTX2 dimensions", () => {
    expect(() => decodedGltfBasisuRgba([[level(4, 4, 1)]], "mismatch.ktx2", ktx2Header(8, 8)))
      .toThrow("dimensions disagree with its KTX2 header");
  });

  it("adopts and preserves a complete authored mip chain", () => {
    const base = level(4, 2, 1);
    const mip1 = level(2, 1, 2);
    const mip2 = level(1, 1, 3);
    const decoded = decodedGltfBasisuRgba([[base, mip1, mip2]], "chain.ktx2");

    expect(decoded).toMatchObject({ height: 2, kind: "rgba-texture", width: 4 });
    expect(decoded.levels?.map(({ data, height, width }) => ({
      first: data[0],
      height,
      width,
    }))).toEqual([
      { first: 1, height: 2, width: 4 },
      { first: 2, height: 1, width: 2 },
      { first: 3, height: 1, width: 1 },
    ]);
    expect(decoded.data).toBe(base.data);
    expect(decoded.levels?.[1]?.data).toBe(mip1.data);
    expect(decoded.levels?.[2]?.data).toBe(mip2.data);
  });

  it("rejects malformed mip dimensions and byte payloads", () => {
    expect(() => decodedGltfBasisuRgba([[level(4, 4, 1), level(3, 2, 2)]], "bad-size.ktx2"))
      .toThrow("invalid mip 1 size");
    expect(() => decodedGltfBasisuRgba([[
      { ...level(2, 2, 1), data: new Uint8Array(3) },
    ]], "bad-bytes.ktx2")).toThrow("invalid RGBA8 payload");
  });

  it("transfers only disposable bytes to the negotiated worker target", async () => {
    const parseMock = vi.fn();
    const runtime: BasisuParseRuntime = {
      parse: parseMock,
      supportsWorker: () => true,
    };
    const firstBytes = new ArrayBuffer(32);
    parseMock.mockImplementationOnce(async (input: ArrayBuffer) => {
      structuredClone(input, { transfer: [input] });
      return "worker";
    });

    await expect(parseGltfBasisuWithRuntime(runtime, firstBytes, "rgba32")).resolves.toBe("worker");
    expect(parseMock.mock.calls[0]?.[0]).not.toBe(firstBytes);
    expect(parseMock.mock.calls[0]?.[1]).toBe("rgba32");
    expect(firstBytes.byteLength).toBe(32);
  });

  it("fails explicitly instead of allocating a decoder on the render thread", async () => {
    const parseMock = vi.fn();
    const runtime: BasisuParseRuntime = {
      parse: parseMock,
      supportsWorker: () => false,
    };
    await expect(parseGltfBasisuWithRuntime(runtime, new ArrayBuffer(24), "etc2"))
      .rejects.toThrow("requires Web Worker support");
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("reuses one burst lane across scheduler waves, then retires it when idle", async () => {
    type Request = Readonly<{ id: number; target: string }>;
    class MockWorker {
      static readonly instances: MockWorker[] = [];
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      request?: Request;
      terminated = false;

      constructor() {
        MockWorker.instances.push(this);
      }

      postMessage(request: Request): void {
        this.request = request;
      }

      respond(fill: number): void {
        this.onmessage?.({
          data: {
            id: this.request?.id,
            result: [[level(1, 1, fill)]],
          },
        } as MessageEvent<unknown>);
      }

      terminate(): void {
        this.terminated = true;
      }
    }

    vi.useFakeTimers();
    vi.stubGlobal("Worker", MockWorker);
    const lease = retainGltfBasisuWorker();
    try {
      const first = decodeGltfBasisuTexture(ktx2Header(1, 1), "first.ktx2");
      const second = decodeGltfBasisuTexture(ktx2Header(1, 1), "second.ktx2");
      await Promise.resolve();
      expect(MockWorker.instances).toHaveLength(2);
      expect(MockWorker.instances.map((worker) => worker.request?.target)).toEqual(["rgba32", "rgba32"]);

      MockWorker.instances[0]!.respond(1);
      MockWorker.instances[1]!.respond(2);
      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
      expect(MockWorker.instances.map((worker) => worker.terminated)).toEqual([false, false]);

      const third = decodeGltfBasisuTexture(ktx2Header(1, 1), "third.ktx2");
      const fourth = decodeGltfBasisuTexture(ktx2Header(1, 1), "fourth.ktx2");
      await Promise.resolve();
      expect(MockWorker.instances).toHaveLength(2);
      MockWorker.instances[0]!.respond(3);
      MockWorker.instances[1]!.respond(4);
      await expect(Promise.all([third, fourth])).resolves.toHaveLength(2);

      await vi.advanceTimersByTimeAsync(100);
      expect(MockWorker.instances.map((worker) => worker.terminated)).toEqual([false, true]);
    } finally {
      lease.release();
      await Promise.resolve();
      await Promise.resolve();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
    expect(MockWorker.instances.map((worker) => worker.terminated)).toEqual([true, true]);
  });
});
