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

  const texel = new Uint8Array(4);
  for (const upload of uploads) {
    const mip = pageTable.mipDimensions[upload.level];
    if (mip === undefined) throw new Error(`Virtual texture page-table upload level ${upload.level} is not allocated`);
    if (upload.xOffset < 0 || upload.xOffset >= mip.width || upload.yOffset < 0 || upload.yOffset >= mip.height) {
      throw new Error(
        `Virtual texture page-table upload ${upload.xOffset},${upload.yOffset} exceeds ${mip.width}x${mip.height} level ${upload.level}`,
      );
    }

    texel.set(upload.rgba8);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      upload.level,
      upload.xOffset,
      upload.yOffset,
      upload.width,
      upload.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      texel,
    );
  }

  return {
    bytesUploaded: uploads.length * 4,
    texelsUploaded: uploads.length,
  };
};

const validatePositiveInteger = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Virtual texture page table ${label} must be a positive integer`);
  }
  return value;
};
