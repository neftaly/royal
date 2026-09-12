import type { Ktx2Etc2Texture } from "./etc2-storage";

export {
  completeKtx2MipLevelCount,
  fitKtx2Etc2Storage,
  ktx2Etc2StorageBytes,
} from "./etc2-storage";
export type { Ktx2Etc2Level, Ktx2Etc2Texture } from "./etc2-storage";

import { parseKtx2Native } from "./ktx2-native";

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

/** Strict compatibility entry point for the ETC2-only tooling and page contract. */
export const parseKtx2Etc2 = (bytes: Uint8Array): Ktx2Etc2Texture => {
  const { format, ...texture } = parseKtx2Native(bytes);
  if (format !== "etc2-rgba") throw new TypeError("Royal ETC2 KTX2 texture has unsupported vkFormat (non-ETC2)");
  return texture;
};

const ETC2_RGBA_BLOCK_BYTES = 16;
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
