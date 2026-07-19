import type { TextureColorSpace } from "@royal/renderer-core";

export type Ktx2Etc2Page = Readonly<{
  blocks: Uint8Array;
  colorSpace: TextureColorSpace;
  height: number;
  width: number;
}>;

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const VK_FORMAT_ETC2_R8G8B8A8_UNORM_BLOCK = 151;
const VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK = 152;

const safeUint64 = (view: DataView, offset: number, label: string): number => {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Royal VT KTX2 ${label} exceeds safe integer capacity`);
  }
  return Number(value);
};

/** Parses one offline-authored, single-level ETC2 RGBA page without transcoding. */
export const parseKtx2Etc2Page = (bytes: Uint8Array): Ktx2Etc2Page => {
  if (bytes.byteLength < 104) throw new TypeError("Royal VT KTX2 page is truncated");
  for (let index = 0; index < IDENTIFIER.length; index += 1) {
    if (bytes[index] !== IDENTIFIER[index]) throw new TypeError("Royal VT page is not KTX2");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vkFormat = view.getUint32(12, true);
  if (
    vkFormat !== VK_FORMAT_ETC2_R8G8B8A8_UNORM_BLOCK
    && vkFormat !== VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK
  ) {
    if (vkFormat === 0) {
      throw new TypeError(
        "Royal VT requires offline ETC2 KTX2 pages; Basis supercompression needs a runtime transcoder",
      );
    }
    throw new TypeError(`Royal VT KTX2 page has unsupported vkFormat ${vkFormat}`);
  }
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  if (width < 1 || height < 1) throw new RangeError("Royal VT KTX2 page dimensions must be positive");
  if (
    view.getUint32(16, true) !== 1
    || view.getUint32(28, true) !== 0
    || view.getUint32(32, true) > 1
    || view.getUint32(36, true) !== 1
    || view.getUint32(40, true) !== 1
    || view.getUint32(44, true) !== 0
  ) {
    throw new TypeError("Royal VT KTX2 pages must be 2D, single-layer, single-face, single-level, and unsupercompressed");
  }
  const byteOffset = safeUint64(view, 80, "level offset");
  const byteLength = safeUint64(view, 88, "level byte length");
  const expectedByteLength = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
  if (
    byteOffset < 104
    || byteOffset % 8 !== 0
    || byteLength !== expectedByteLength
    || byteOffset + byteLength > bytes.byteLength
  ) {
    throw new RangeError("Royal VT KTX2 ETC2 level has invalid block storage");
  }
  return {
    blocks: bytes.subarray(byteOffset, byteOffset + byteLength),
    colorSpace: vkFormat === VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK ? "srgb" : "linear",
    height,
    width,
  };
};
