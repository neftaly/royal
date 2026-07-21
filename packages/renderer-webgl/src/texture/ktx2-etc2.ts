import {
  completeKtx2MipLevelCount,
  type Ktx2Etc2Level,
  type Ktx2Etc2Texture,
} from "./etc2-storage";

export {
  completeKtx2MipLevelCount,
  fitKtx2Etc2Storage,
  ktx2Etc2StorageBytes,
} from "./etc2-storage";
export type { Ktx2Etc2Level, Ktx2Etc2Texture } from "./etc2-storage";

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_BYTES = 80;
const LEVEL_INDEX_BYTES = 24;
const ETC2_RGBA_BLOCK_BYTES = 16;
const KHR_DF_FLAG_ALPHA_PREMULTIPLIED = 1;
const KHR_DF_TRANSFER_LINEAR = 1;
const KHR_DF_TRANSFER_SRGB = 2;
const VK_FORMAT_ETC2_R8G8B8A8_UNORM_BLOCK = 151;
const VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK = 152;

const EAC_ALPHA_MODIFIERS = new Int8Array([
  -3, -6, -9, -15, 2, 5, 8, 14,
  -3, -7, -10, -13, 2, 6, 9, 12,
  -2, -5, -8, -13, 1, 4, 7, 12,
  -2, -4, -6, -13, 1, 3, 5, 12,
  -3, -6, -8, -12, 2, 5, 7, 11,
  -3, -7, -9, -11, 2, 6, 8, 10,
  -4, -7, -8, -11, 3, 6, 7, 10,
  -3, -5, -8, -11, 2, 4, 7, 10,
  -2, -6, -8, -10, 1, 5, 7, 9,
  -2, -5, -8, -10, 1, 4, 7, 9,
  -2, -4, -8, -10, 1, 3, 7, 9,
  -2, -5, -7, -10, 1, 4, 6, 9,
  -3, -4, -7, -10, 2, 3, 6, 9,
  -1, -2, -3, -10, 0, 1, 2, 9,
  -4, -6, -8, -9, 3, 5, 7, 8,
  -3, -5, -7, -9, 2, 4, 6, 8,
]);

const safeUint64 = (view: DataView, offset: number, label: string): number => {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Royal KTX2 ${label} exceeds safe integer capacity`);
  }
  return Number(value);
};

const matchesAscii = (
  bytes: Uint8Array,
  start: number,
  end: number,
  expected: string,
): boolean => {
  if (end - start !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[start + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
};

const validateMetadataValue = (
  bytes: Uint8Array,
  start: number,
  end: number,
  expected: string,
  label: string,
): void => {
  if (end > start && bytes[end - 1] === 0) end -= 1;
  if (!matchesAscii(bytes, start, end, expected)) {
    throw new TypeError(`Royal KTX2 ${label} must be ${expected}`);
  }
};

const validateKeyValueData = (
  bytes: Uint8Array,
  view: DataView,
  byteOffset: number,
  byteLength: number,
): void => {
  let cursor = byteOffset;
  const end = byteOffset + byteLength;
  let orientationSeen = false;
  let swizzleSeen = false;
  while (cursor < end) {
    if (cursor + 4 > end) throw new TypeError("Royal KTX2 key/value data is truncated");
    const pairLength = view.getUint32(cursor, true);
    const pairStart = cursor + 4;
    const pairEnd = pairStart + pairLength;
    if (pairLength < 2 || pairEnd > end) {
      throw new TypeError("Royal KTX2 key/value entry is truncated");
    }
    let keyEnd = pairStart;
    while (keyEnd < pairEnd && bytes[keyEnd] !== 0) keyEnd += 1;
    if (keyEnd === pairEnd || keyEnd === pairStart) {
      throw new TypeError("Royal KTX2 key/value entry has no terminated key");
    }
    const valueStart = keyEnd + 1;
    if (matchesAscii(bytes, pairStart, keyEnd, "KTXorientation")) {
      if (orientationSeen) throw new TypeError("Royal KTX2 repeats KTXorientation");
      orientationSeen = true;
      validateMetadataValue(bytes, valueStart, pairEnd, "rd", "orientation");
    } else if (matchesAscii(bytes, pairStart, keyEnd, "KTXswizzle")) {
      if (swizzleSeen) throw new TypeError("Royal KTX2 repeats KTXswizzle");
      swizzleSeen = true;
      validateMetadataValue(bytes, valueStart, pairEnd, "rgba", "swizzle");
    }
    cursor = pairEnd + ((4 - pairLength % 4) % 4);
  }
  if (cursor !== end) throw new TypeError("Royal KTX2 key/value padding is invalid");
};

const levelDimension = (base: number, level: number): number =>
  Math.max(1, Math.floor(base / 2 ** level));

/** Parses Royal's offline-authored, 2D ETC2 RGBA KTX2 subset without transcoding or copies. */
export const parseKtx2Etc2 = (bytes: Uint8Array): Ktx2Etc2Texture => {
  if (bytes.byteLength < HEADER_BYTES + LEVEL_INDEX_BYTES) {
    throw new TypeError("Royal KTX2 texture is truncated");
  }
  for (let index = 0; index < IDENTIFIER.length; index += 1) {
    if (bytes[index] !== IDENTIFIER[index]) throw new TypeError("Royal texture is not KTX2");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vkFormat = view.getUint32(12, true);
  if (
    vkFormat !== VK_FORMAT_ETC2_R8G8B8A8_UNORM_BLOCK
    && vkFormat !== VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK
  ) {
    if (vkFormat === 0) {
      throw new TypeError(
        "Royal requires offline ETC2 KTX2 textures; Basis supercompression needs a runtime transcoder",
      );
    }
    throw new TypeError(`Royal KTX2 texture has unsupported vkFormat ${vkFormat}`);
  }
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  if (width < 1 || height < 1) throw new RangeError("Royal KTX2 dimensions must be positive");
  const levelCount = view.getUint32(40, true);
  if (
    view.getUint32(16, true) !== 1
    || view.getUint32(28, true) !== 0
    || view.getUint32(32, true) !== 0
    || view.getUint32(36, true) !== 1
    || levelCount < 1
    || levelCount > completeKtx2MipLevelCount(width, height)
    || view.getUint32(44, true) !== 0
  ) {
    throw new TypeError(
      "Royal KTX2 textures must be 2D, non-array, single-face, unsupercompressed ETC2 with valid mip levels",
    );
  }
  const levelIndexEnd = HEADER_BYTES + levelCount * LEVEL_INDEX_BYTES;
  if (levelIndexEnd > bytes.byteLength) throw new TypeError("Royal KTX2 level index is truncated");
  const dfdByteOffset = view.getUint32(48, true);
  const dfdByteLength = view.getUint32(52, true);
  const descriptorBlockSize = dfdByteOffset + 12 <= bytes.byteLength
    ? view.getUint16(dfdByteOffset + 10, true)
    : 0;
  if (
    dfdByteOffset < levelIndexEnd
    || dfdByteOffset % 4 !== 0
    || dfdByteLength < 28
    || dfdByteOffset + dfdByteLength > bytes.byteLength
    || view.getUint32(dfdByteOffset, true) !== dfdByteLength
    || view.getUint32(dfdByteOffset + 4, true) !== 0
    || view.getUint16(dfdByteOffset + 8, true) !== 2
    || descriptorBlockSize < 24
    || descriptorBlockSize !== dfdByteLength - 4
  ) throw new TypeError("Royal KTX2 data format descriptor is invalid");
  const expectedTransfer = vkFormat === VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK
    ? KHR_DF_TRANSFER_SRGB
    : KHR_DF_TRANSFER_LINEAR;
  if (
    bytes[dfdByteOffset + 14] !== expectedTransfer
    || (bytes[dfdByteOffset + 15]! & KHR_DF_FLAG_ALPHA_PREMULTIPLIED) !== 0
    || bytes[dfdByteOffset + 16] !== 3
    || bytes[dfdByteOffset + 17] !== 3
    || bytes[dfdByteOffset + 18] !== 0
    || bytes[dfdByteOffset + 19] !== 0
    || bytes[dfdByteOffset + 20] !== ETC2_RGBA_BLOCK_BYTES
  ) {
    throw new TypeError(
      "Royal KTX2 descriptor must match straight-alpha ETC2 RGBA blocks and transfer function",
    );
  }
  if (safeUint64(view, 64, "supercompression data offset") !== 0
    || safeUint64(view, 72, "supercompression data length") !== 0) {
    throw new TypeError("Royal unsupercompressed KTX2 textures must not contain global data");
  }
  const kvdByteOffset = view.getUint32(56, true);
  const kvdByteLength = view.getUint32(60, true);
  if (kvdByteLength === 0) {
    if (kvdByteOffset !== 0) throw new TypeError("Royal empty KTX2 key/value data has an offset");
  } else {
    if (
      kvdByteOffset < levelIndexEnd
      || kvdByteOffset % 4 !== 0
      || kvdByteOffset + kvdByteLength > bytes.byteLength
    ) throw new TypeError("Royal KTX2 key/value data range is invalid");
    validateKeyValueData(bytes, view, kvdByteOffset, kvdByteLength);
  }
  const ranges: { end: number; start: number }[] = [];
  ranges.push({ end: dfdByteOffset + dfdByteLength, start: dfdByteOffset });
  if (kvdByteLength > 0) {
    ranges.push({ end: kvdByteOffset + kvdByteLength, start: kvdByteOffset });
  }
  const levels: Ktx2Etc2Level[] = [];
  for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
    const indexOffset = HEADER_BYTES + levelIndex * LEVEL_INDEX_BYTES;
    const byteOffset = safeUint64(view, indexOffset, `level ${levelIndex} offset`);
    const byteLength = safeUint64(view, indexOffset + 8, `level ${levelIndex} byte length`);
    const uncompressedByteLength = safeUint64(
      view,
      indexOffset + 16,
      `level ${levelIndex} uncompressed byte length`,
    );
    const levelWidth = levelDimension(width, levelIndex);
    const levelHeight = levelDimension(height, levelIndex);
    const expectedByteLength = Math.ceil(levelWidth / 4)
      * Math.ceil(levelHeight / 4)
      * ETC2_RGBA_BLOCK_BYTES;
    if (
      byteOffset < levelIndexEnd
      || byteOffset % ETC2_RGBA_BLOCK_BYTES !== 0
      || byteLength !== expectedByteLength
      || uncompressedByteLength !== byteLength
      || byteOffset + byteLength > bytes.byteLength
    ) throw new RangeError(`Royal KTX2 ETC2 level ${levelIndex} has invalid block storage`);
    ranges.push({ end: byteOffset + byteLength, start: byteOffset });
    levels.push({
      blocks: bytes.subarray(byteOffset, byteOffset + byteLength),
      height: levelHeight,
      width: levelWidth,
    });
  }
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      throw new RangeError("Royal KTX2 indexed sections overlap");
    }
  }
  return {
    colorSpace: vkFormat === VK_FORMAT_ETC2_R8G8B8A8_SRGB_BLOCK ? "srgb" : "linear",
    height,
    levels,
    width,
  };
};

/** Extracts only base-level alpha for exact alpha-mask queries; RGB remains compressed. */
export const decodeKtx2Etc2Alpha = (
  texture: Ktx2Etc2Texture,
  levelIndex = 0,
): Uint8Array => {
  const level = texture.levels[levelIndex];
  if (level === undefined) throw new RangeError("Royal ETC2 alpha mip level is out of range");
  const values = new Uint8Array(level.width * level.height);
  const blockColumns = Math.ceil(level.width / 4);
  const blockRows = Math.ceil(level.height / 4);
  for (let blockY = 0; blockY < blockRows; blockY += 1) {
    for (let blockX = 0; blockX < blockColumns; blockX += 1) {
      const blockOffset = (blockY * blockColumns + blockX) * ETC2_RGBA_BLOCK_BYTES;
      const base = level.blocks[blockOffset]!;
      const tableAndMultiplier = level.blocks[blockOffset + 1]!;
      const tableOffset = (tableAndMultiplier & 0x0f) * 8;
      const multiplier = tableAndMultiplier >>> 4;
      let selectorBits = 0;
      let availableBits = 0;
      let selectorByte = blockOffset + 2;
      for (let pixel = 0; pixel < 16; pixel += 1) {
        while (availableBits < 3) {
          selectorBits = (selectorBits << 8) | level.blocks[selectorByte++]!;
          availableBits += 8;
        }
        availableBits -= 3;
        const selector = (selectorBits >>> availableBits) & 7;
        selectorBits &= (1 << availableBits) - 1;
        const localX = pixel >>> 2;
        const localY = pixel & 3;
        const x = blockX * 4 + localX;
        const y = blockY * 4 + localY;
        if (x >= level.width || y >= level.height) continue;
        const decoded = base + multiplier * EAC_ALPHA_MODIFIERS[tableOffset + selector]!;
        values[y * level.width + x] = decoded < 0 ? 0 : decoded > 255 ? 255 : decoded;
      }
    }
  }
  return values;
};
