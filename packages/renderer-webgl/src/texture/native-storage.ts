import type { TextureColorSpace } from "@royal/renderer-core";
import { ETC2_RGBA8_WEBGL_FORMAT, ETC2_SRGB8_ALPHA8_WEBGL_FORMAT, type Ktx2Etc2Texture } from "./etc2-storage";

// [linear Vulkan enum, block extent, block bytes, DFD model, linear GL enum, sRGB GL enum]
// Only native LDR formats. BC1 uses RGBA semantics, avoiding WebGL's ambiguous RGB mapping.
const FORMATS = {
  "etc2-rgba": [151, 4, 16, 161, ETC2_RGBA8_WEBGL_FORMAT, ETC2_SRGB8_ALPHA8_WEBGL_FORMAT],
  "astc-6x6": [165, 6, 16, 162, 0x93b4, 0x93d4],
  "astc-8x8": [171, 8, 16, 162, 0x93b7, 0x93d7],
  "bc1-rgba": [133, 4, 8, 128, 0x83f1, 0x8c4d],
  "bc3-rgba": [137, 4, 16, 130, 0x83f3, 0x8c4f],
  "bc7-rgba": [145, 4, 16, 134, 0x8e8c, 0x8e8d],
} as const;
export type NativeTextureFormat = keyof typeof FORMATS;
export type Ktx2NativeTexture = Ktx2Etc2Texture & Readonly<{ format: NativeTextureFormat }>;
const FORMAT_NAMES = /* @__PURE__ */ Object.keys(FORMATS) as NativeTextureFormat[];
export const nativeFormatFromVk = (vkFormat: number): NativeTextureFormat | undefined => {
  for (const format of FORMAT_NAMES) {
    const linear = FORMATS[format][0];
    if (vkFormat === linear || vkFormat === linear + 1) return format;
  }
  return undefined;
};
export const nativeBlockSize = (format: NativeTextureFormat): number => FORMATS[format][1];
export const nativeBlockBytes = (format: NativeTextureFormat): number => FORMATS[format][2];
export const nativeDfdModel = (format: NativeTextureFormat): number => FORMATS[format][3];
export const nativeWebGlFormat = (format: NativeTextureFormat, colorSpace: TextureColorSpace): number =>
  FORMATS[format][colorSpace === "srgb" ? 5 : 4];

/** Enable exactly the extension required for this native storage interpretation. */
export const nativeTextureAvailable = (
  gl: WebGL2RenderingContext,
  format: NativeTextureFormat,
  colorSpace: TextureColorSpace,
): boolean => {
  if (format === "astc-6x6" || format === "astc-8x8") {
    return gl.getExtension("WEBGL_compressed_texture_astc")?.getSupportedProfiles().includes("ldr") === true;
  }
  const extension = format === "etc2-rgba" ? "WEBGL_compressed_texture_etc"
    : format === "bc7-rgba" ? "EXT_texture_compression_bptc"
    : colorSpace === "srgb" ? "WEBGL_compressed_texture_s3tc_srgb" : "WEBGL_compressed_texture_s3tc";
  return gl.getExtension(extension) !== null;
};

/** WebGL BC base levels must be block aligned, including after mip rebasing. */
export const validateNativeBaseDimensions = (format: NativeTextureFormat, width: number, height: number): void => {
  if (format.startsWith("bc") && (width % 4 !== 0 || height % 4 !== 0)) {
    throw new RangeError("Royal BC KTX2 base dimensions must be multiples of 4");
  }
};
