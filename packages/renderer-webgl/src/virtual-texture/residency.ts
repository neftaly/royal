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
  if (target.byteLength !== manifest.tableByteLength) {
    throw new RangeError("Royal VT page-table storage has the wrong byte length");
  }
  target.fill(0);
  // Coarse entries are complete before their children. A missing child can
  // therefore inherit its parent's already-resolved closest ancestor instead
  // of searching the complete ancestor chain again.
  for (let mip = manifest.mipCount - 1; mip >= 0; mip -= 1) {
    const layout = manifest.mipLayouts[mip]!;
    const storageWidth = Math.max(1, manifest.tableWidth / 2 ** mip);
    const parentLayout = manifest.mipLayouts[mip + 1];
    const parentWidth = Math.max(1, manifest.tableWidth / 2 ** (mip + 1));
    for (let y = 0; y < layout.height; y += 1) {
      for (let x = 0; x < layout.width; x += 1) {
        const offset = layout.byteOffset + (y * storageWidth + x) * 4;
        const slot = residentSlots.get(virtualTexturePageKeyParts(mip, x, y));
        if (slot !== undefined) {
          const slotY = Math.floor(slot / atlasColumns);
          if (slotY > 255) throw new RangeError("Royal VT atlas rows must be within 1..256");
          target[offset] = slot % atlasColumns;
          target[offset + 1] = slotY;
          target[offset + 2] = mip;
          target[offset + 3] = 255;
        } else if (parentLayout !== undefined) {
          const parentOffset = parentLayout.byteOffset
            + (Math.floor(y / 2) * parentWidth + Math.floor(x / 2)) * 4;
          target[offset] = target[parentOffset]!;
          target[offset + 1] = target[parentOffset + 1]!;
          target[offset + 2] = target[parentOffset + 2]!;
          target[offset + 3] = target[parentOffset + 3]!;
        }
      }
    }
  }
};
