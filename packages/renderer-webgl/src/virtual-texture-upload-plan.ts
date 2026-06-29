import type {
  VirtualTextureDirtyPageTableEntry,
  VirtualTexturePageAddress,
  VirtualTexturePageId,
  VirtualTexturePhysicalSlot,
} from "./virtual-texture-runtime";

export type VirtualTextureWebGl2UploadFormat = {
  readonly format: "RGBA";
  readonly internalFormat: "RGBA8";
  readonly target: "TEXTURE_2D";
  readonly type: "UNSIGNED_BYTE";
};

export type VirtualTexturePageTableTexelUpload = {
  readonly batchIndex: number | null;
  readonly dirtySequence: number;
  readonly drainedFrame: number | null;
  readonly format: VirtualTextureWebGl2UploadFormat;
  readonly height: 1;
  readonly kind: "page-table-texel";
  readonly level: number;
  readonly op: VirtualTextureDirtyPageTableEntry["op"];
  readonly reason: string | null;
  readonly residentPageId: VirtualTexturePageId | null;
  readonly rgba8: readonly [number, number, number, number];
  readonly tableCoord: VirtualTexturePageAddress;
  readonly width: 1;
  readonly xOffset: number;
  readonly yOffset: number;
};

export type VirtualTexturePhysicalAtlasPageUpload = {
  readonly batchIndex: number | null;
  readonly byteLength: number;
  readonly bytesPerTexel: number;
  readonly dirtySequence: number;
  readonly drainedFrame: number | null;
  readonly format: VirtualTextureWebGl2UploadFormat;
  readonly height: number;
  readonly kind: "physical-atlas-page";
  readonly level: 0;
  readonly paddedPageSize: number;
  readonly residentPageId: VirtualTexturePageId;
  readonly slot: VirtualTexturePhysicalSlot;
  readonly sourcePage: VirtualTexturePageAddress;
  readonly uploadSerial: number;
  readonly width: number;
  readonly xOffset: number;
  readonly yOffset: number;
};

export type VirtualTextureUploadPlan = {
  readonly pageTableUploads: readonly VirtualTexturePageTableTexelUpload[];
  readonly physicalAtlasUploads: readonly VirtualTexturePhysicalAtlasPageUpload[];
  readonly uploadCount: number;
};

export type VirtualTextureUploadPlanOptions = {
  readonly borderTexels?: number;
  readonly bytesPerTexel?: number;
  readonly pageSize: number;
};

export type VirtualTextureUploadPlanBudget = {
  readonly pageTableUploads: number;
  readonly physicalAtlasUploads: number;
};

export type VirtualTextureUploadPlanSplit = {
  readonly remainder: VirtualTextureUploadPlan;
  readonly slice: VirtualTextureUploadPlan;
};

const rgba8Format: VirtualTextureWebGl2UploadFormat = {
  format: "RGBA",
  internalFormat: "RGBA8",
  target: "TEXTURE_2D",
  type: "UNSIGNED_BYTE",
};

export const planVirtualTextureUploads = (
  dirtyEntries: readonly VirtualTextureDirtyPageTableEntry[],
  options: VirtualTextureUploadPlanOptions,
): VirtualTextureUploadPlan => {
  const pageSize = validatePositiveInteger(options.pageSize, "pageSize");
  const borderTexels = validateNonNegativeInteger(options.borderTexels ?? 0, "borderTexels");
  const bytesPerTexel = validatePositiveInteger(options.bytesPerTexel ?? 4, "bytesPerTexel");
  const paddedPageSize = pageSize + borderTexels * 2;
  const pageTableUploads: VirtualTexturePageTableTexelUpload[] = [];
  const physicalAtlasUploads: VirtualTexturePhysicalAtlasPageUpload[] = [];

  for (const dirty of dirtyEntries) {
    pageTableUploads.push(planPageTableUpload(dirty));
    const atlasUpload = planPhysicalAtlasUpload(dirty, paddedPageSize, bytesPerTexel);
    if (atlasUpload !== null) physicalAtlasUploads.push(atlasUpload);
  }

  return {
    pageTableUploads,
    physicalAtlasUploads,
    uploadCount: pageTableUploads.length + physicalAtlasUploads.length,
  };
};

export const splitVirtualTextureUploadPlan = (
  plan: VirtualTextureUploadPlan,
  budget: VirtualTextureUploadPlanBudget,
): VirtualTextureUploadPlanSplit => {
  const pageTableBudget = validateUploadBudget(budget.pageTableUploads, "pageTableUploads");
  const physicalAtlasBudget = validateUploadBudget(budget.physicalAtlasUploads, "physicalAtlasUploads");
  const physicalAtlasSplit = splitUploadList(plan.physicalAtlasUploads, physicalAtlasBudget);
  const pageTableCount = cappedPageTableUploadCount(
    plan.pageTableUploads,
    plan.physicalAtlasUploads,
    physicalAtlasSplit.slice,
    pageTableBudget,
  );
  const pageTableSplit = splitUploadList(plan.pageTableUploads, pageTableCount);

  return {
    remainder: createUploadPlan(pageTableSplit.remainder, physicalAtlasSplit.remainder),
    slice: createUploadPlan(pageTableSplit.slice, physicalAtlasSplit.slice),
  };
};

const planPageTableUpload = (dirty: VirtualTextureDirtyPageTableEntry): VirtualTexturePageTableTexelUpload => ({
  batchIndex: dirty.batchIndex ?? null,
  dirtySequence: dirty.sequence,
  drainedFrame: dirty.drainedFrame ?? null,
  format: rgba8Format,
  height: 1,
  kind: "page-table-texel",
  level: dirty.tableCoord.mip,
  op: dirty.op,
  reason: dirty.reason,
  residentPageId: dirty.entry.residentPageId,
  rgba8: copyRgba8(dirty.entry.encodedRgba8),
  tableCoord: copyPage(dirty.tableCoord),
  width: 1,
  xOffset: dirty.tableCoord.x,
  yOffset: dirty.tableCoord.y,
});

const planPhysicalAtlasUpload = (
  dirty: VirtualTextureDirtyPageTableEntry,
  paddedPageSize: number,
  bytesPerTexel: number,
): VirtualTexturePhysicalAtlasPageUpload | null => {
  if (dirty.op !== "upload") return null;
  if (dirty.entry.physicalSlot === null || dirty.entry.residentPageId === null || dirty.entry.uploadSerial === null) {
    return null;
  }

  const slot = dirty.entry.physicalSlot;
  return {
    batchIndex: dirty.batchIndex ?? null,
    byteLength: paddedPageSize * paddedPageSize * bytesPerTexel,
    bytesPerTexel,
    dirtySequence: dirty.sequence,
    drainedFrame: dirty.drainedFrame ?? null,
    format: rgba8Format,
    height: paddedPageSize,
    kind: "physical-atlas-page",
    level: 0,
    paddedPageSize,
    residentPageId: dirty.entry.residentPageId,
    slot: { slot: slot.slot, x: slot.x, y: slot.y },
    sourcePage: copyPage(dirty.entry.virtualPage),
    uploadSerial: dirty.entry.uploadSerial,
    width: paddedPageSize,
    xOffset: slot.x * paddedPageSize,
    yOffset: slot.y * paddedPageSize,
  };
};

const copyPage = (page: VirtualTexturePageAddress): VirtualTexturePageAddress => ({
  mip: page.mip,
  x: page.x,
  y: page.y,
});

const createUploadPlan = (
  pageTableUploads: readonly VirtualTexturePageTableTexelUpload[],
  physicalAtlasUploads: readonly VirtualTexturePhysicalAtlasPageUpload[],
): VirtualTextureUploadPlan => ({
  pageTableUploads,
  physicalAtlasUploads,
  uploadCount: pageTableUploads.length + physicalAtlasUploads.length,
});

const splitUploadList = <Upload>(
  uploads: readonly Upload[],
  count: number,
): { readonly remainder: readonly Upload[]; readonly slice: readonly Upload[] } => ({
  remainder: uploads.slice(count),
  slice: uploads.slice(0, count),
});

const cappedPageTableUploadCount = (
  pageTableUploads: readonly VirtualTexturePageTableTexelUpload[],
  physicalAtlasUploads: readonly VirtualTexturePhysicalAtlasPageUpload[],
  physicalAtlasSlice: readonly VirtualTexturePhysicalAtlasPageUpload[],
  pageTableBudget: number,
): number => {
  const pendingAtlasUploads = atlasUploadKeys(physicalAtlasUploads);
  const slicedAtlasUploads = atlasUploadKeys(physicalAtlasSlice);
  let count = 0;
  const cappedCount = Math.min(pageTableBudget, pageTableUploads.length);

  while (count < cappedCount) {
    const upload = pageTableUploads[count]!;
    const atlasKey = pageTableAtlasDependencyKey(upload);
    if (atlasKey !== null && pendingAtlasUploads.has(atlasKey) && !slicedAtlasUploads.has(atlasKey)) break;
    count += 1;
  }

  return count;
};

const atlasUploadKeys = (
  physicalAtlasUploads: readonly VirtualTexturePhysicalAtlasPageUpload[],
): ReadonlySet<string> => new Set(physicalAtlasUploads.map(physicalAtlasUploadKey));

const pageTableAtlasDependencyKey = (upload: VirtualTexturePageTableTexelUpload): string | null => {
  if (upload.op !== "upload" || upload.residentPageId === null) return null;
  return atlasUploadKey(upload.dirtySequence, upload.residentPageId);
};

const physicalAtlasUploadKey = (upload: VirtualTexturePhysicalAtlasPageUpload): string =>
  atlasUploadKey(upload.dirtySequence, upload.residentPageId);

const atlasUploadKey = (dirtySequence: number, residentPageId: VirtualTexturePageId): string =>
  `${dirtySequence}:${residentPageId}`;

const copyRgba8 = (rgba8: readonly [number, number, number, number]): readonly [number, number, number, number] => [
  rgba8[0],
  rgba8[1],
  rgba8[2],
  rgba8[3],
];

const validateUploadBudget = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Virtual texture upload plan ${label} budget must be a non-negative integer`);
  }
  return value;
};

const validateNonNegativeInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Virtual texture upload plan ${label} must be a non-negative integer`);
  }
  return value;
};

const validatePositiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Virtual texture upload plan ${label} must be a positive integer`);
  }
  return value;
};
