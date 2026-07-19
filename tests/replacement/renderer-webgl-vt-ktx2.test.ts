import { describe, expect, it } from "vitest";
import { parseKtx2Etc2Page } from "../../packages/renderer-webgl/src/virtual-texture/ktx2-etc2";

const ktx2Page = (vkFormat: number): Uint8Array => {
  const bytes = new Uint8Array(120);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(12, vkFormat, true);
  view.setUint32(16, 1, true);
  view.setUint32(20, 4, true);
  view.setUint32(24, 4, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, 1, true);
  view.setBigUint64(80, 104n, true);
  view.setBigUint64(88, 16n, true);
  view.setBigUint64(96, 16n, true);
  for (let index = 104; index < bytes.length; index += 1) bytes[index] = index;
  return bytes;
};

describe("VT2 offline KTX2/ETC2 pages", () => {
  it("retains a direct sRGB ETC2 block view without copying or transcoding", () => {
    const bytes = ktx2Page(152);
    const parsed = parseKtx2Etc2Page(bytes);
    expect(parsed).toMatchObject({ colorSpace: "srgb", height: 4, width: 4 });
    expect(parsed.blocks).toEqual(bytes.subarray(104));
    expect(parsed.blocks.buffer).toBe(bytes.buffer);
  });

  it("rejects Basis supercompression instead of silently adding a WASM path", () => {
    expect(() => parseKtx2Etc2Page(ktx2Page(0))).toThrow("runtime transcoder");
  });
});
