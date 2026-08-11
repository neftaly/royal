import {
  DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS,
  type VirtualTextureManifest,
} from "./manifest";

const DEFAULT_PHYSICAL_BYTES = 32 * 1024 * 1024;
const MAX_ATLAS_AXIS_SLOTS = 256;

export type VirtualTextureAtlasStoragePlan = Readonly<{
  allocationBytes: number;
  atlasColumns: number;
  atlasRows: number;
  compressed: boolean;
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
  manifest: VirtualTextureManifest,
  maxTextureSizeInput: number,
  availableBytesInput: number,
): VirtualTextureAtlasStoragePlan => {
  if (!Number.isSafeInteger(maxTextureSizeInput) || maxTextureSizeInput < 1) {
    throw new RangeError("Royal VT received an invalid WebGL2 texture limit");
  }
  const maxTextureSize = maxTextureSizeInput;
  const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
  const maximumAxisSlots = Math.min(
    MAX_ATLAS_AXIS_SLOTS,
    Math.floor(maxTextureSize / storedPageSize),
  );
  if (maximumAxisSlots < 1) {
    throw new RangeError("Royal VT stored page exceeds this WebGL2 context's texture limit");
  }
  const compressed = manifest.pageEncoding === "ktx2-etc2";
  const bytesPerPage = storedPageSize * storedPageSize * (compressed ? 1 : 4);
  const availableAtlasBytes = Math.max(0, availableBytesInput - manifest.tableByteLength);
  const targetAtlasBytes = Math.min(
    DEFAULT_PHYSICAL_BYTES,
    bytesPerPage * DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS,
  );
  const atlasByteLimit = Math.min(
    targetAtlasBytes,
    availableAtlasBytes,
    Math.max(bytesPerPage, Math.floor(availableAtlasBytes * 0.75)),
  );
  const slotLimit = Math.min(
    Math.floor(atlasByteLimit / bytesPerPage),
    maximumAxisSlots * maximumAxisSlots,
  );
  if (slotLimit < 1) throw new RangeError("Royal VT budget cannot hold one physical page");
  const [atlasColumns, atlasRows] = atlasDimensions(slotLimit, maximumAxisSlots);
  const slotCount = atlasColumns * atlasRows;
  return {
    allocationBytes: slotCount * bytesPerPage,
    atlasColumns,
    atlasRows,
    compressed,
    slotCount,
    storedPageSize,
  };
};

/** Validates one page table and returns its bounded share of a shared atlas. */
export const virtualTextureResidentPageCapacity = (
  manifest: VirtualTextureManifest,
  maxTextureSizeInput: number,
  atlas: Pick<VirtualTextureAtlasStoragePlan, "allocationBytes" | "slotCount">,
): number => {
  if (manifest.tableWidth > maxTextureSizeInput || manifest.tableHeight > maxTextureSizeInput) {
    throw new RangeError("Royal VT page table exceeds this WebGL2 context's texture limit");
  }
  const bytesPerPage = atlas.allocationBytes / atlas.slotCount;
  const byteSlots = manifest.physicalByteBudget === undefined
    ? Infinity
    : Math.floor(manifest.physicalByteBudget / bytesPerPage);
  const maxResidentPages = Math.min(
    manifest.physicalSlots ?? DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS,
    byteSlots,
    atlas.slotCount,
  );
  if (maxResidentPages < 1) throw new RangeError("Royal VT budget cannot hold one physical page");
  return maxResidentPages;
};
