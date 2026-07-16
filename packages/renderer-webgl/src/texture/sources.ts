import type {
  DecodedGltfBasisuCompressedTexture,
  DecodedGltfBasisuRgbaTexture,
  DecodedGltfBasisuTexture,
} from "../gltf/codecs/basisu";

export type LoadedTextureSource = HTMLImageElement | ImageBitmap | DecodedGltfBasisuTexture;

export const isDecodedRgbaTexture = (source: LoadedTextureSource): source is DecodedGltfBasisuRgbaTexture =>
  typeof source === "object" && source !== null && "kind" in source && source.kind === "rgba-texture";

export const isDecodedCompressedTexture = (
  source: LoadedTextureSource,
): source is DecodedGltfBasisuCompressedTexture => typeof source === "object"
  && source !== null
  && "kind" in source
  && source.kind === "compressed-texture";

export const decodedTextureBytes = (source: DecodedGltfBasisuTexture): number => {
  const levels = source.levels;
  if (levels === undefined) return source.data.byteLength;
  let bytes = 0;
  let index = levels.length;
  while (index > 0) bytes += levels[index -= 1]!.data.byteLength;
  return bytes;
};

export const decodedTextureHasCompleteMipChain = (
  source: DecodedGltfBasisuTexture,
): boolean => {
  const levels = source.levels;
  if (levels === undefined) return source.width === 1 && source.height === 1;
  let width = source.width;
  let height = source.height;
  for (const level of levels) {
    if (level.width !== width || level.height !== height) return false;
    if (width > 1) width = Math.max(1, Math.floor(width / 2));
    if (height > 1) height = Math.max(1, Math.floor(height / 2));
  }
  return width === 1 && height === 1;
};

export const loadedTextureSourceSize = (source: LoadedTextureSource): readonly [width: number, height: number] => {
  if (isDecodedRgbaTexture(source) || isDecodedCompressedTexture(source)) return [source.width, source.height];
  const candidate = source as HTMLImageElement | ImageBitmap;
  const width = "naturalWidth" in candidate && candidate.naturalWidth > 0 ? candidate.naturalWidth : candidate.width;
  const height = "naturalHeight" in candidate && candidate.naturalHeight > 0 ? candidate.naturalHeight : candidate.height;
  return [width, height];
};

export const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
