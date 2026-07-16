import {
  decodedTextureHasCompleteMipChain,
  isDecodedCompressedTexture,
  isDecodedRgbaTexture,
  type LoadedTextureSource,
} from "../texture/sources";
import { prepareTextureUpload } from "./imperative-state";
import type { TextureAssetUploadRef } from "./materials";

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

export const uploadTexture = (
  gl: WebGL2RenderingContext,
  textureHandle: WebGLTexture,
  source: LoadedTextureSource,
  texture: TextureAssetUploadRef,
): void => {
  // Royal and glTF both define authored (0, 0) at the upper-left. WebGL maps
  // the first decoded image row to v=0 when upload flipping is disabled.
  prepareTextureUpload(gl);
  gl.bindTexture(gl.TEXTURE_2D, textureHandle);
  const internalFormat = textureUploadInternalFormat(gl, texture.colorSpace);
  const mipmapped = usesMipmaps(texture.sampler?.minFilter);
  let mipmapLevelsReady = false;
  if (isDecodedCompressedTexture(source)) {
    const levels = source.levels;
    const levelCount = mipmapped ? levels.length : Math.min(1, levels.length);
    mipmapLevelsReady = mipmapped;
    const format = texture.colorSpace === "srgb" ? source.srgbFormat : source.format;
    for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
      const level = levels[levelIndex]!;
      gl.compressedTexImage2D(
        gl.TEXTURE_2D,
        levelIndex,
        format,
        level.width,
        level.height,
        0,
        level.data,
      );
    }
    // Compressed levels cannot be synthesized with generateMipmap. Restricting
    // the texture's mip range makes any valid authored prefix complete while
    // retaining every supplied level for minification.
    if (mipmapped && !decodedTextureHasCompleteMipChain(source)) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levelCount - 1);
    }
  } else if (isDecodedRgbaTexture(source)) {
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
  if (mipmapped && !mipmapLevelsReady) gl.generateMipmap(gl.TEXTURE_2D);
};
