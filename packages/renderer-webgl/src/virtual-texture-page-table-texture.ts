import type { VirtualTexturePageTableTexelUpload } from "./virtual-texture-upload-plan";

type PageTableTextureGl = Pick<
  WebGL2RenderingContext,
  | "CLAMP_TO_EDGE"
  | "NEAREST"
  | "RGBA"
  | "RGBA8"
  | "TEXTURE_2D"
  | "TEXTURE_MAG_FILTER"
  | "TEXTURE_MIN_FILTER"
  | "TEXTURE_WRAP_S"
  | "TEXTURE_WRAP_T"
  | "UNSIGNED_BYTE"
  | "bindTexture"
  | "createTexture"
  | "texImage2D"
  | "texParameteri"
  | "texSubImage2D"
>;

export type VirtualTexturePageTableMip = {
  readonly height: number;
  readonly width: number;
};

export type VirtualTexturePageTableMipOptions = {
  readonly mipCount: number;
  readonly pageSize: number;
  readonly virtualSize: readonly [number, number];
};

export type VirtualTexturePageTableTexture = {
  readonly mipDimensions: readonly VirtualTexturePageTableMip[];
  readonly texture: WebGLTexture;
};

export type VirtualTexturePageTableUploadResult = {
  readonly bytesUploaded: number;
  readonly texelsUploaded: number;
};

export type VirtualTexturePageTableTexelUploadRange = {
  readonly data: Uint8Array;
  readonly height: 1;
  readonly level: number;
  readonly texelCount: number;
  readonly width: number;
  readonly xOffset: number;
  readonly yOffset: number;
};

export const virtualTexturePageTableMipDimensions = (
  options: VirtualTexturePageTableMipOptions,
): readonly VirtualTexturePageTableMip[] => {
  const virtualWidth = validatePositiveInteger(options.virtualSize[0], "virtualSize[0]");
  const virtualHeight = validatePositiveInteger(options.virtualSize[1], "virtualSize[1]");
  const pageSize = validatePositiveInteger(options.pageSize, "pageSize");
  const mipCount = validatePositiveInteger(options.mipCount, "mipCount");
  const baseWidth = Math.ceil(virtualWidth / pageSize);
  const baseHeight = Math.ceil(virtualHeight / pageSize);

  return Array.from({ length: mipCount }, (_, mip) => ({
    height: Math.max(1, Math.ceil(baseHeight / 2 ** mip)),
    width: Math.max(1, Math.ceil(baseWidth / 2 ** mip)),
  }));
};

export const createVirtualTexturePageTableTexture = (
  gl: PageTableTextureGl,
  mipDimensions: readonly VirtualTexturePageTableMip[],
): VirtualTexturePageTableTexture => {
  const normalized = mipDimensions.map((mip, index) => ({
    height: validatePositiveInteger(mip.height, `mipDimensions[${index}].height`),
    width: validatePositiveInteger(mip.width, `mipDimensions[${index}].width`),
  }));
  if (normalized.length === 0) throw new Error("Virtual texture page table requires at least one mip");

  const texture = gl.createTexture();
  if (texture === null) throw new Error("Failed to create virtual texture page-table texture");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [level, mip] of normalized.entries()) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      level,
      gl.RGBA8,
      mip.width,
      mip.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return { mipDimensions: normalized, texture };
};

export const uploadVirtualTexturePageTableTexels = (
  gl: PageTableTextureGl,
  pageTable: VirtualTexturePageTableTexture,
  uploads: readonly VirtualTexturePageTableTexelUpload[],
): VirtualTexturePageTableUploadResult => {
  gl.bindTexture(gl.TEXTURE_2D, pageTable.texture);

  const ranges = coalesceVirtualTexturePageTableTexelUploads(pageTable, uploads);
  for (const range of ranges) {
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      range.level,
      range.xOffset,
      range.yOffset,
      range.width,
      range.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      range.data,
    );
  }

  return {
    bytesUploaded: uploads.length * 4,
    texelsUploaded: uploads.length,
  };
};

export const coalesceVirtualTexturePageTableTexelUploads = (
  pageTable: VirtualTexturePageTableTexture,
  uploads: readonly VirtualTexturePageTableTexelUpload[],
): readonly VirtualTexturePageTableTexelUploadRange[] => {
  const validated = uploads.map((upload, order) => validatePageTableTexelUpload(pageTable, upload, order));
  const coordinateCounts = new Map<string, number>();
  for (const upload of validated) {
    coordinateCounts.set(upload.coordinateKey, (coordinateCounts.get(upload.coordinateKey) ?? 0) + 1);
  }

  const rows = new Map<string, PageTableUploadRow>();
  const duplicateRanges: InternalPageTableTexelUploadRange[] = [];
  for (const upload of validated) {
    if ((coordinateCounts.get(upload.coordinateKey) ?? 0) > 1) {
      duplicateRanges.push(createPageTableTexelUploadRange([upload]));
      continue;
    }

    const rowKey = `${upload.level}:${upload.yOffset}`;
    let row = rows.get(rowKey);
    if (row === undefined) {
      row = { level: upload.level, uploads: [], yOffset: upload.yOffset };
      rows.set(rowKey, row);
    }
    row.uploads.push(upload);
  }

  const ranges: InternalPageTableTexelUploadRange[] = [];
  const sortedRows = [...rows.values()].sort(comparePageTableUploadRows);
  for (const row of sortedRows) {
    row.uploads.sort(comparePageTableTexelUploads);
    let runStart = 0;
    for (let index = 1; index <= row.uploads.length; index += 1) {
      const previous = row.uploads[index - 1];
      const next = row.uploads[index];
      if (previous !== undefined && next !== undefined && next.xOffset === previous.xOffset + 1) continue;
      ranges.push(createPageTableTexelUploadRange(row.uploads.slice(runStart, index)));
      runStart = index;
    }
  }

  return [...ranges, ...duplicateRanges].sort(comparePageTableTexelUploadRanges).map(toPageTableTexelUploadRange);
};

type ValidatedPageTableTexelUpload = VirtualTexturePageTableTexelUpload & {
  readonly coordinateKey: string;
  readonly order: number;
};

type PageTableUploadRow = {
  readonly level: number;
  readonly uploads: ValidatedPageTableTexelUpload[];
  readonly yOffset: number;
};

type InternalPageTableTexelUploadRange = VirtualTexturePageTableTexelUploadRange & {
  readonly firstUploadOrder: number;
};

const validatePageTableTexelUpload = (
  pageTable: VirtualTexturePageTableTexture,
  upload: VirtualTexturePageTableTexelUpload,
  order: number,
): ValidatedPageTableTexelUpload => {
  const mip = pageTable.mipDimensions[upload.level];
  if (mip === undefined) throw new Error(`Virtual texture page-table upload level ${upload.level} is not allocated`);
  if (upload.xOffset < 0 || upload.xOffset >= mip.width || upload.yOffset < 0 || upload.yOffset >= mip.height) {
    throw new Error(
      `Virtual texture page-table upload ${upload.xOffset},${upload.yOffset} exceeds ${mip.width}x${mip.height} level ${upload.level}`,
    );
  }
  if (upload.width !== 1 || upload.height !== 1) {
    throw new Error("Virtual texture page-table uploads must be 1x1 texels");
  }

  return {
    ...upload,
    coordinateKey: `${upload.level}:${upload.xOffset}:${upload.yOffset}`,
    order,
  };
};

const createPageTableTexelUploadRange = (
  uploads: readonly ValidatedPageTableTexelUpload[],
): InternalPageTableTexelUploadRange => {
  const first = uploads[0];
  if (first === undefined) throw new Error("Virtual texture page-table upload range requires at least one texel");

  const data = new Uint8Array(uploads.length * 4);
  let firstUploadOrder = first.order;
  for (const [index, upload] of uploads.entries()) {
    data.set(upload.rgba8, index * 4);
    firstUploadOrder = Math.min(firstUploadOrder, upload.order);
  }

  return {
    data,
    firstUploadOrder,
    height: 1,
    level: first.level,
    texelCount: uploads.length,
    width: uploads.length,
    xOffset: first.xOffset,
    yOffset: first.yOffset,
  };
};

const comparePageTableUploadRows = (a: PageTableUploadRow, b: PageTableUploadRow): number =>
  a.level - b.level || a.yOffset - b.yOffset;

const comparePageTableTexelUploads = (
  a: ValidatedPageTableTexelUpload,
  b: ValidatedPageTableTexelUpload,
): number => a.xOffset - b.xOffset || a.order - b.order;

const comparePageTableTexelUploadRanges = (
  a: InternalPageTableTexelUploadRange,
  b: InternalPageTableTexelUploadRange,
): number =>
  a.firstUploadOrder - b.firstUploadOrder || a.level - b.level || a.yOffset - b.yOffset || a.xOffset - b.xOffset;

const toPageTableTexelUploadRange = (
  range: InternalPageTableTexelUploadRange,
): VirtualTexturePageTableTexelUploadRange => ({
  data: range.data,
  height: range.height,
  level: range.level,
  texelCount: range.texelCount,
  width: range.width,
  xOffset: range.xOffset,
  yOffset: range.yOffset,
});

const validatePositiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Virtual texture page table ${label} must be a positive integer`);
  }
  return value;
};
