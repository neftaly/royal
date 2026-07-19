import { ROYAL_ENVIRONMENT_METADATA_KEY } from "../../../packages/renderer-webgl/src/environment/royal-environment-ktx1";

const IDENTIFIER = [
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;
const align4 = (value: number): number => (value + 3) & ~3;

export type EnvironmentKtx1Fixture = Readonly<{
  firstImageSizeOffset: number;
  metadataValueOffset: number;
  source: ArrayBuffer;
}>;

export const environmentKtx1Fixture = (
  size: number,
  sh: readonly (readonly [number, number, number])[] = Array.from(
    { length: 9 },
    (_, index) => [index / 10, index / 20, index / 40] as const,
  ),
): EnvironmentKtx1Fixture => {
  const metadataValue = new TextEncoder().encode(JSON.stringify({
    provenance: `fixture-${size}`,
    sh,
    version: 1,
  }));
  const key = new TextEncoder().encode(ROYAL_ENVIRONMENT_METADATA_KEY);
  const pairBytes = key.byteLength + 1 + metadataValue.byteLength;
  const metadataBytes = 4 + align4(pairBytes);
  const mipLevels = Math.log2(size) + 1;
  let imageBytes = 0;
  for (let level = 0; level < mipLevels; level += 1) {
    const levelSize = size / 2 ** level;
    imageBytes += 4 + levelSize * levelSize * 4 * 6;
  }
  const source = new ArrayBuffer(64 + metadataBytes + imageBytes);
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  bytes.set(IDENTIFIER, 0);
  view.setUint32(12, 0x0403_0201, true);
  view.setUint32(16, 0x8c3b, true);
  view.setUint32(20, 4, true);
  view.setUint32(24, 0x1907, true);
  view.setUint32(28, 0x8c3a, true);
  view.setUint32(32, 0x1907, true);
  view.setUint32(36, size, true);
  view.setUint32(40, size, true);
  view.setUint32(52, 6, true);
  view.setUint32(56, mipLevels, true);
  view.setUint32(60, metadataBytes, true);
  view.setUint32(64, pairBytes, true);
  bytes.set(key, 68);
  const metadataValueOffset = 68 + key.byteLength + 1;
  bytes.set(metadataValue, metadataValueOffset);
  let offset = 64 + metadataBytes;
  const firstImageSizeOffset = offset;
  for (let level = 0; level < mipLevels; level += 1) {
    const levelSize = size / 2 ** level;
    const faceBytes = levelSize * levelSize * 4;
    view.setUint32(offset, faceBytes, true);
    offset += 4;
    for (let face = 0; face < 6; face += 1) {
      bytes.fill((level * 37 + face * 11) & 0xff, offset, offset + faceBytes);
      offset += faceBytes;
    }
  }
  return { firstImageSizeOffset, metadataValueOffset, source };
};
