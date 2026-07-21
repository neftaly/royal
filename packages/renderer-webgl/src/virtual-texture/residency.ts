import {
  virtualTexturePageKeyParts,
  type VirtualTextureManifest,
} from "./manifest";

export type VirtualTexturePageKey = number | string;

export type VirtualTexturePoolSlot = Readonly<{
  pageKey: VirtualTexturePageKey;
  resourceKey: string;
}>;

export interface ProtectedVirtualTexturePoolPages {
  has(resourceKey: string, pageKey: VirtualTexturePageKey): boolean;
}

/** Pure allocation-free shared-atlas slot choice keyed by logical texture and page. */
export const selectVirtualTexturePoolSlot = (
  resourceKey: string,
  pageKey: VirtualTexturePageKey,
  slots: readonly (VirtualTexturePoolSlot | undefined)[],
  lastUsedFrames: ArrayLike<number>,
  protectedPages: ProtectedVirtualTexturePoolPages,
): number => {
  if (slots.length === 0 || slots.length !== lastUsedFrames.length) {
    throw new Error("Royal VT pool slots and recency storage must have equal non-zero length");
  }
  let candidate = -1;
  let oldestFrame = Infinity;
  for (let slot = 0; slot < slots.length; slot += 1) {
    const resident = slots[slot];
    if (resident?.resourceKey === resourceKey && resident.pageKey === pageKey) {
      return slot;
    }
    if (resident === undefined) return slot;
    if (protectedPages.has(resident.resourceKey, resident.pageKey)) continue;
    const lastUsed = lastUsedFrames[slot]!;
    if (lastUsed < oldestFrame) {
      candidate = slot;
      oldestFrame = lastUsed;
    }
  }
  return candidate;
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
