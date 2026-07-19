import type { TextureColorSpace } from "@royal/renderer-core";
import { parseKtx2Etc2 } from "../texture/ktx2-etc2";

export type Ktx2Etc2Page = Readonly<{
  blocks: Uint8Array;
  colorSpace: TextureColorSpace;
  height: number;
  width: number;
}>;

/** Narrows the shared ordinary/VT parser to one offline-authored VT page level. */
export const parseKtx2Etc2Page = (bytes: Uint8Array): Ktx2Etc2Page => {
  const texture = parseKtx2Etc2(bytes);
  if (texture.levels.length !== 1) {
    throw new TypeError("Royal VT KTX2 pages must contain exactly one level");
  }
  return {
    blocks: texture.levels[0]!.blocks,
    colorSpace: texture.colorSpace,
    height: texture.height,
    width: texture.width,
  };
};
