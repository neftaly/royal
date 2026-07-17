import {
  decodedTextureHasCompleteMipChain,
  isDecodedCompressedTexture,
  isDecodedRgbaTexture,
  type LoadedTextureSource,
} from "../texture/sources";
import { prepareTextureUpload } from "./imperative-state";
import type { TextureAssetUploadRef } from "./materials";

export type CompressedTextureUploadCursor = Readonly<{
  blockRow: number;
  levelIndex: number;
}>;

export type CompressedTextureUploadChunk = Readonly<{
  bytes: number;
  data: Uint8Array;
  height: number;
  levelIndex: number;
  next?: CompressedTextureUploadCursor;
  width: number;
  y: number;
}>;

const COMPRESSED_BLOCK_SIZE = 4;
const COMPRESSED_BLOCK_BYTES = 16;

/** Pure block-row planner shared by one-shot and frame-budgeted upload shells. */
export const compressedTextureUploadChunk = (
  source: Extract<LoadedTextureSource, { readonly kind: "compressed-texture" }>,
  mipmapped: boolean,
  cursor: CompressedTextureUploadCursor = { blockRow: 0, levelIndex: 0 },
  maximumBytes = Number.MAX_SAFE_INTEGER,
): CompressedTextureUploadChunk => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError(`compressed texture upload chunk bytes must be a positive safe integer, received ${maximumBytes}`);
  }
  const levelCount = mipmapped ? source.levels.length : Math.min(1, source.levels.length);
  const level = source.levels[cursor.levelIndex];
  if (
    level === undefined
    || cursor.levelIndex >= levelCount
    || !Number.isSafeInteger(cursor.blockRow)
    || cursor.blockRow < 0
  ) throw new RangeError("compressed texture upload cursor is outside the selected mip chain");
  const blocksPerRow = Math.ceil(level.width / COMPRESSED_BLOCK_SIZE);
  const blockRows = Math.ceil(level.height / COMPRESSED_BLOCK_SIZE);
  if (cursor.blockRow >= blockRows) {
    throw new RangeError("compressed texture upload cursor is outside its mip level");
  }
  const rowBytes = blocksPerRow * COMPRESSED_BLOCK_BYTES;
  const rows = Math.min(
    blockRows - cursor.blockRow,
    Math.max(1, Math.floor(maximumBytes / rowBytes)),
  );
  const byteOffset = cursor.blockRow * rowBytes;
  const bytes = rows * rowBytes;
  const nextBlockRow = cursor.blockRow + rows;
  const next = nextBlockRow < blockRows
    ? { blockRow: nextBlockRow, levelIndex: cursor.levelIndex }
    : cursor.levelIndex + 1 < levelCount
      ? { blockRow: 0, levelIndex: cursor.levelIndex + 1 }
      : undefined;
  const y = cursor.blockRow * COMPRESSED_BLOCK_SIZE;
  return {
    bytes,
    data: level.data.subarray(byteOffset, byteOffset + bytes),
    height: Math.min(level.height - y, rows * COMPRESSED_BLOCK_SIZE),
    levelIndex: cursor.levelIndex,
    ...(next === undefined ? {} : { next }),
    width: level.width,
    y,
  };
};

export const samplerConstant = (
  gl: WebGL2RenderingContext,
  value: string | undefined,
  fallback: number,
): number => {
  switch (value) {
    case "clamp-to-edge":
      return gl.CLAMP_TO_EDGE;
    case "linear":
      return gl.LINEAR;
    case "linear-mipmap-linear":
      return gl.LINEAR_MIPMAP_LINEAR;
    case "linear-mipmap-nearest":
      return gl.LINEAR_MIPMAP_NEAREST;
    case "mirrored-repeat":
      return gl.MIRRORED_REPEAT;
    case "nearest":
      return gl.NEAREST;
    case "nearest-mipmap-linear":
      return gl.NEAREST_MIPMAP_LINEAR;
    case "nearest-mipmap-nearest":
      return gl.NEAREST_MIPMAP_NEAREST;
    case "repeat":
      return gl.REPEAT;
    default:
      return fallback;
  }
};

export const usesMipmaps = (value: string | undefined): boolean =>
  value === "linear-mipmap-linear"
  || value === "linear-mipmap-nearest"
  || value === "nearest-mipmap-linear"
  || value === "nearest-mipmap-nearest";

export const textureUploadInternalFormat = (
  gl: WebGL2RenderingContext,
  colorSpace: TextureAssetUploadRef["colorSpace"] | undefined,
): number => colorSpace === "srgb" ? gl.SRGB8_ALPHA8 : gl.RGBA;

const applyTextureSampler = (
  gl: WebGL2RenderingContext,
  texture: TextureAssetUploadRef,
  mipmapped: boolean,
  mipmapLevelsReady: boolean,
  levelCount: number,
): void => {
  if (mipmapped && mipmapLevelsReady && levelCount > 0) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levelCount - 1);
  }
  const sampler = texture.sampler;
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    samplerConstant(gl, sampler?.magFilter, gl.LINEAR),
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    samplerConstant(gl, sampler?.minFilter, gl.LINEAR),
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_S,
    samplerConstant(gl, sampler?.wrapS, gl.CLAMP_TO_EDGE),
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_T,
    samplerConstant(gl, sampler?.wrapT, gl.CLAMP_TO_EDGE),
  );
};

export const beginCompressedTextureUpload = (
  gl: WebGL2RenderingContext,
  textureHandle: WebGLTexture,
  source: Extract<LoadedTextureSource, { readonly kind: "compressed-texture" }>,
  texture: TextureAssetUploadRef,
): void => {
  prepareTextureUpload(gl);
  gl.bindTexture(gl.TEXTURE_2D, textureHandle);
  const mipmapped = usesMipmaps(texture.sampler?.minFilter);
  const levelCount = mipmapped ? source.levels.length : Math.min(1, source.levels.length);
  const format = texture.colorSpace === "srgb" ? source.srgbFormat : source.format;
  const base = source.levels[0]!;
  gl.texStorage2D(gl.TEXTURE_2D, levelCount, format, base.width, base.height);
  applyTextureSampler(gl, texture, mipmapped, mipmapped, levelCount);
};

export const uploadCompressedTextureChunk = (
  gl: WebGL2RenderingContext,
  textureHandle: WebGLTexture,
  format: number,
  chunk: CompressedTextureUploadChunk,
): void => {
  prepareTextureUpload(gl);
  gl.bindTexture(gl.TEXTURE_2D, textureHandle);
  gl.compressedTexSubImage2D(
    gl.TEXTURE_2D,
    chunk.levelIndex,
    0,
    chunk.y,
    chunk.width,
    chunk.height,
    format,
    chunk.data,
  );
};

export const uploadTexture = (
  gl: WebGL2RenderingContext,
  textureHandle: WebGLTexture,
  source: LoadedTextureSource,
  texture: TextureAssetUploadRef,
): void => {
  // Royal and glTF both define authored (0, 0) at the upper-left. WebGL maps
  // the first decoded image row to v=0 when upload flipping is disabled.
  const mipmapped = usesMipmaps(texture.sampler?.minFilter);
  if (isDecodedCompressedTexture(source)) {
    const format = texture.colorSpace === "srgb" ? source.srgbFormat : source.format;
    beginCompressedTextureUpload(gl, textureHandle, source, texture);
    let cursor: CompressedTextureUploadCursor | undefined;
    do {
      const chunk = compressedTextureUploadChunk(source, mipmapped, cursor);
      uploadCompressedTextureChunk(gl, textureHandle, format, chunk);
      cursor = chunk.next;
    } while (cursor !== undefined);
    return;
  }
  prepareTextureUpload(gl);
  gl.bindTexture(gl.TEXTURE_2D, textureHandle);
  const internalFormat = textureUploadInternalFormat(gl, texture.colorSpace);
  let mipmapLevelsReady = false;
  if (isDecodedRgbaTexture(source)) {
    mipmapLevelsReady = mipmapped && decodedTextureHasCompleteMipChain(source);
    const levels = source.levels;
    const levelCount = mipmapLevelsReady && levels !== undefined ? levels.length : 1;
    for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
      const level = levels?.[levelIndex] ?? source;
      gl.texImage2D(
        gl.TEXTURE_2D,
        levelIndex,
        internalFormat,
        level.width,
        level.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        level.data,
      );
    }
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source,
    );
  }
  applyTextureSampler(gl, texture, mipmapped, mipmapLevelsReady, 0);
  if (mipmapped && !mipmapLevelsReady) gl.generateMipmap(gl.TEXTURE_2D);
};
