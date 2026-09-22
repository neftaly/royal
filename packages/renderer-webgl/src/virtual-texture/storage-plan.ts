import { virtualTexturePageBytes } from "./layout";
import type { VirtualTextureLayout } from "./layout";

const DEFAULT_PHYSICAL_BYTES = 32 * 1024 * 1024;
const MAX_ATLAS_AXIS_SLOTS = 256;

export type VirtualTextureAtlasStoragePlan = Readonly<{
  allocationBytes: number;
  atlasColumns: number;
  atlasRows: number;
  slotCount: number;
  storedPageSize: number;
}>;

const atlasDimensions = (
  slotLimit: number,
  maximumAxisSlots: number,
): readonly [columns: number, rows: number] => {
  let bestColumns = 1;
  let bestRows = 1;
  let bestSlots = 1;
  let bestSkew = Infinity;
  for (let columns = 1; columns <= maximumAxisSlots; columns += 1) {
    const rows = Math.min(maximumAxisSlots, Math.floor(slotLimit / columns));
    if (rows < 1) continue;
    const slots = columns * rows;
    const skew = Math.abs(columns - rows);
    if (
      slots > bestSlots
      || (slots === bestSlots && skew < bestSkew)
    ) {
      bestColumns = columns;
      bestRows = rows;
      bestSlots = slots;
      bestSkew = skew;
    }
  }
  return [bestColumns, bestRows];
};

/**
 * Plans one shared physical atlas after reserving the requesting resource's
 * page table. The returned texture dimensions never exceed either the WebGL
 * axis limit or the bytes available to the atlas.
 */
export const planVirtualTextureAtlasStorage = (
  layout: VirtualTextureLayout,
  maxTextureSizeInput: number,
  availableBytesInput: number,
  targetSlots = Infinity,
  physicalByteLimit = DEFAULT_PHYSICAL_BYTES,
  allocation: "initial" | "migration" = "initial",
): VirtualTextureAtlasStoragePlan => {
  if (!Number.isSafeInteger(maxTextureSizeInput) || maxTextureSizeInput < 1) {
    throw new RangeError("Royal VT received an invalid WebGL2 texture limit");
  }
  const maxTextureSize = maxTextureSizeInput;
  const storedPageSize = layout.pageSize + layout.borderTexels * 2;
  const maximumAxisSlots = Math.min(
    MAX_ATLAS_AXIS_SLOTS,
    Math.floor(maxTextureSize / storedPageSize),
  );
  if (maximumAxisSlots < 1) {
    throw new RangeError("Royal VT stored page exceeds this WebGL2 context's texture limit");
  }
  const bytesPerPage = virtualTexturePageBytes(layout);
  const availableAtlasBytes = Math.max(0, availableBytesInput - (allocation === "initial" ? layout.tableByteLength : 0));
  // This atlas serves all compatible textures, not just the first asset.
  const atlasByteLimit = Math.min(
    physicalByteLimit,
    availableAtlasBytes,
    allocation === "initial" ? Math.max(bytesPerPage, Math.floor(availableAtlasBytes * 0.75)) : Infinity,
  );
  const slotLimit = Math.min(
    Math.floor(atlasByteLimit / bytesPerPage),
    maximumAxisSlots * maximumAxisSlots,
    targetSlots,
  );
  if (slotLimit < 1) throw new RangeError("Royal VT budget cannot hold one physical page");
  const [atlasColumns, atlasRows] = atlasDimensions(slotLimit, maximumAxisSlots);
  const slotCount = atlasColumns * atlasRows;
  return {
    allocationBytes: slotCount * bytesPerPage,
    atlasColumns,
    atlasRows,
    slotCount,
    storedPageSize,
  };
};

/** Validates one page table and returns its bounded share of a shared atlas. */
export const virtualTextureResidentPageCapacity = (
  layout: VirtualTextureLayout,
  maxTextureSizeInput: number,
  atlas: Pick<VirtualTextureAtlasStoragePlan, "allocationBytes" | "slotCount">,
): number => {
  if (layout.tableWidth > maxTextureSizeInput || layout.tableHeight > maxTextureSizeInput) {
    throw new RangeError("Royal VT page table exceeds this WebGL2 context's texture limit");
  }
  return atlas.slotCount;
};
