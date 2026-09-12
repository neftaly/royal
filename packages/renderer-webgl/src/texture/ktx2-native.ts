import { completeKtx2MipLevelCount, type Ktx2Etc2Level } from "./etc2-storage";
import { nativeBlockSize, nativeBlockBytes, nativeDfdModel, nativeFormatFromVk, validateNativeBaseDimensions, type Ktx2NativeTexture } from "./native-storage";

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_BYTES = 80;
const LEVEL_INDEX_BYTES = 24;
const KHR_DF_FLAG_ALPHA_PREMULTIPLIED = 1;
const KHR_DF_TRANSFER_LINEAR = 1;
const KHR_DF_TRANSFER_SRGB = 2;

const safeUint64 = (view: DataView, offset: number, label: string): number => {
  const high = view.getUint32(offset + 4, true);
  if (high > 0x1fffff) {
    throw new RangeError(`Royal KTX2 ${label} exceeds safe integer capacity`);
  }
  return view.getUint32(offset, true) + high * 0x1_0000_0000;
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

/** Parses Royal's offline-authored, 2D native compressed KTX2 subset without transcoding or copies. */
export const parseKtx2Native = (bytes: Uint8Array): Ktx2NativeTexture => {
  if (bytes.byteLength < HEADER_BYTES + LEVEL_INDEX_BYTES) {
    throw new TypeError("Royal KTX2 texture is truncated");
  }
  for (let index = 0; index < IDENTIFIER.length; index += 1) {
    if (bytes[index] !== IDENTIFIER[index]) throw new TypeError("Royal texture is not KTX2");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vkFormat = view.getUint32(12, true);
  const format = nativeFormatFromVk(vkFormat);
  if (format === undefined) {
    if (vkFormat === 0) throw new TypeError("Royal requires offline native KTX2 textures; Basis supercompression needs a runtime transcoder");
    throw new TypeError(`Royal KTX2 texture has unsupported vkFormat ${vkFormat}`);
  }
  const blockSize = nativeBlockSize(format);
  const blockBytes = nativeBlockBytes(format);
  const srgb = vkFormat % 2 === 0;
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  if (width < 1 || height < 1) throw new RangeError("Royal KTX2 dimensions must be positive");
  validateNativeBaseDimensions(format, width, height);
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
      "Royal KTX2 textures must be 2D, non-array, single-face, unsupercompressed native blocks with valid mip levels",
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
  const expectedTransfer = srgb
    ? KHR_DF_TRANSFER_SRGB
    : KHR_DF_TRANSFER_LINEAR;
  if (
    bytes[dfdByteOffset + 14] !== expectedTransfer
    || (bytes[dfdByteOffset + 15]! & KHR_DF_FLAG_ALPHA_PREMULTIPLIED) !== 0
    || bytes[dfdByteOffset + 16] !== blockSize - 1
    || bytes[dfdByteOffset + 17] !== blockSize - 1
    || bytes[dfdByteOffset + 18] !== 0
    || bytes[dfdByteOffset + 19] !== 0
    || view.getUint32(dfdByteOffset + 20, true) !== blockBytes
    || view.getUint32(dfdByteOffset + 24, true) !== 0
  ) {
    throw new TypeError(
      "Royal KTX2 descriptor must match straight-alpha native blocks and transfer function",
    );
  }
  if (bytes[dfdByteOffset + 12] !== nativeDfdModel(format)) {
    throw new TypeError("Royal KTX2 descriptor color model does not match native format");
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
    if (format.startsWith("bc") && ((levelWidth > 2 && levelWidth % 4 !== 0) || (levelHeight > 2 && levelHeight % 4 !== 0))) {
      throw new RangeError("Royal BC KTX2 mip dimensions must be 1, 2 or multiples of 4");
    }
    const expectedByteLength = Math.ceil(levelWidth / blockSize)
      * Math.ceil(levelHeight / blockSize)
      * blockBytes;
    if (
      byteOffset < levelIndexEnd
      || byteOffset % blockBytes !== 0
      || byteLength !== expectedByteLength
      || uncompressedByteLength !== byteLength
      || byteOffset + byteLength > bytes.byteLength
    ) throw new RangeError(`Royal KTX2 compressed level ${levelIndex} has invalid block storage`);
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
    format,
    colorSpace: srgb ? "srgb" : "linear",
    height,
    levels,
    width,
  };
};
