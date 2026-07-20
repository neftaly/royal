import {
  virtualTexturePageKey,
  virtualTexturePageKeyParts,
  type VirtualTextureManifest,
  type VirtualTexturePageId,
} from "./manifest";

export type VirtualTexturePageKey = number | string;

export type VirtualTextureAdmissionPlan = Readonly<{
  evictedKey?: VirtualTexturePageKey;
  page: VirtualTexturePageId;
  pageKey: VirtualTexturePageKey;
  slot: number;
}>;

export interface ProtectedVirtualTexturePages {
  has(key: VirtualTexturePageKey): boolean;
}

/**
 * Pure bounded LRU decision. Existing mappings remain valid until the caller
 * completes its atlas upload and commits this plan.
 */
export const planVirtualTextureAdmission = (
  page: VirtualTexturePageId,
  slotKeys: readonly (VirtualTexturePageKey | undefined)[],
  lastUsedFrames: ArrayLike<number>,
  protectedPages: ProtectedVirtualTexturePages,
): VirtualTextureAdmissionPlan | undefined => {
  if (slotKeys.length === 0 || slotKeys.length !== lastUsedFrames.length) {
    throw new Error("Royal VT residency slots and recency storage must have equal non-zero length");
  }
  const pageKey = virtualTexturePageKey(page);
  let candidate = -1;
  let oldestFrame = Infinity;
  for (let slot = 0; slot < slotKeys.length; slot += 1) {
    const key = slotKeys[slot];
    if (key === pageKey) return { page, pageKey, slot };
    if (key === undefined) return { page, pageKey, slot };
    if (protectedPages.has(key)) continue;
    const lastUsed = lastUsedFrames[slot]!;
    if (lastUsed < oldestFrame) {
      candidate = slot;
      oldestFrame = lastUsed;
    }
  }
  if (candidate < 0) return undefined;
  const evictedKey = slotKeys[candidate];
  return {
    ...(evictedKey === undefined ? {} : { evictedKey }),
    page,
    pageKey,
    slot: candidate,
  };
};

export const virtualTexturePageTableByteLength = (
  manifest: VirtualTextureManifest,
): number => manifest.tableByteLength;

/**
 * Writes every logical page's closest resident ancestor. A newly uploaded page
 * is therefore never visible before its complete atlas cell is committed.
 */
export const writeVirtualTexturePageTable = (
  manifest: VirtualTextureManifest,
  residentSlots: ReadonlyMap<VirtualTexturePageKey, number>,
  atlasColumns: number,
  target: Uint8Array,
): void => {
  if (!Number.isSafeInteger(atlasColumns) || atlasColumns < 1 || atlasColumns > 256) {
    throw new RangeError("Royal VT atlas columns must be within 1..256");
  }
  if (target.byteLength !== virtualTexturePageTableByteLength(manifest)) {
    throw new RangeError("Royal VT page-table storage has the wrong byte length");
  }
  target.fill(0);
  for (let mip = 0; mip < manifest.mipCount; mip += 1) {
    const layout = manifest.mipLayouts[mip]!;
    for (let y = 0; y < layout.height; y += 1) {
      for (let x = 0; x < layout.width; x += 1) {
        let ancestorMip = mip;
        let ancestorX = x;
        let ancestorY = y;
        let slot: number | undefined;
        while (ancestorMip < manifest.mipCount) {
          slot = residentSlots.get(virtualTexturePageKeyParts(
            ancestorMip,
            ancestorX,
            ancestorY,
          ));
          if (slot !== undefined) break;
          ancestorMip += 1;
          ancestorX = Math.floor(ancestorX / 2);
          ancestorY = Math.floor(ancestorY / 2);
        }
        if (slot === undefined) continue;
        const slotX = slot % atlasColumns;
        const slotY = Math.floor(slot / atlasColumns);
        if (slotY > 255) throw new RangeError("Royal VT atlas rows must be within 1..256");
        const storageWidth = Math.max(1, manifest.tableWidth / 2 ** mip);
        const offset = layout.byteOffset + (y * storageWidth + x) * 4;
        target[offset] = slotX;
        target[offset + 1] = slotY;
        target[offset + 2] = ancestorMip;
        target[offset + 3] = 255;
      }
    }
  }
};
