const align16 = (value: number): number => Math.ceil(value / 16) * 16;
const align4 = (value: number): number => Math.ceil(value / 4) * 4;

type MetadataEntry = readonly [key: string, value: string];

/** Small structurally valid Royal KTX2 subset fixture; DFD metadata is irrelevant to the parser. */
export const createKtx2Etc2Fixture = (
  vkFormat: number,
  width = 4,
  height = 4,
  levelCount = 1,
  metadata: readonly MetadataEntry[] = [],
): Uint8Array => {
  const indexEnd = 80 + levelCount * 24;
  const dfdByteOffset = indexEnd;
  const dfdByteLength = 28;
  const metadataByteLength = metadata.reduce(
    (total, [key, value]) => total + 4 + align4(key.length + 1 + value.length + 1),
    0,
  );
  const kvdByteOffset = metadataByteLength === 0 ? 0 : dfdByteOffset + dfdByteLength;
  const levels: { byteLength: number; byteOffset: number }[] = [];
  let byteOffset = align16(dfdByteOffset + dfdByteLength + metadataByteLength);
  for (let level = 0; level < levelCount; level += 1) {
    const levelWidth = Math.max(1, Math.floor(width / 2 ** level));
    const levelHeight = Math.max(1, Math.floor(height / 2 ** level));
    const byteLength = Math.ceil(levelWidth / 4) * Math.ceil(levelHeight / 4) * 16;
    levels.push({ byteLength, byteOffset });
    byteOffset = align16(byteOffset + byteLength);
  }
  const bytes = new Uint8Array(byteOffset);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(12, vkFormat, true);
  view.setUint32(16, 1, true);
  view.setUint32(20, width, true);
  view.setUint32(24, height, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, levelCount, true);
  view.setUint32(48, dfdByteOffset, true);
  view.setUint32(52, dfdByteLength, true);
  view.setUint32(56, kvdByteOffset, true);
  view.setUint32(60, metadataByteLength, true);
  view.setUint32(dfdByteOffset, dfdByteLength, true);
  view.setUint16(dfdByteOffset + 8, 2, true);
  view.setUint16(dfdByteOffset + 10, 24, true);
  bytes[dfdByteOffset + 14] = vkFormat === 152 ? 2 : 1;
  bytes.set([3, 3, 0, 0, 16], dfdByteOffset + 16);
  let metadataOffset = kvdByteOffset;
  for (const [key, value] of metadata) {
    const pairLength = key.length + 1 + value.length + 1;
    view.setUint32(metadataOffset, pairLength, true);
    metadataOffset += 4;
    for (let index = 0; index < key.length; index += 1) {
      bytes[metadataOffset + index] = key.charCodeAt(index);
    }
    metadataOffset += key.length + 1;
    for (let index = 0; index < value.length; index += 1) {
      bytes[metadataOffset + index] = value.charCodeAt(index);
    }
    metadataOffset += value.length + 1;
    metadataOffset = align4(metadataOffset);
  }
  for (let level = 0; level < levels.length; level += 1) {
    const entry = levels[level]!;
    const indexOffset = 80 + level * 24;
    view.setBigUint64(indexOffset, BigInt(entry.byteOffset), true);
    view.setBigUint64(indexOffset + 8, BigInt(entry.byteLength), true);
    view.setBigUint64(indexOffset + 16, BigInt(entry.byteLength), true);
    for (let index = 0; index < entry.byteLength; index += 1) {
      bytes[entry.byteOffset + index] = level * 31 + index;
    }
  }
  return bytes;
};
