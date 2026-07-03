import type { DecodedGltfBasisuTexture } from "./gltf/codecs/basisu";

export type LoadedTextureSource = HTMLImageElement | ImageBitmap | DecodedGltfBasisuTexture;

export const isDecodedRgbaTexture = (source: LoadedTextureSource): source is DecodedGltfBasisuTexture =>
  typeof source === "object" && source !== null && "kind" in source && source.kind === "rgba-texture";

export const loadedTextureSourceSize = (source: LoadedTextureSource): readonly [width: number, height: number] => {
  if (isDecodedRgbaTexture(source)) return [source.width, source.height];
  const candidate = source as HTMLImageElement | ImageBitmap;
  const width = "naturalWidth" in candidate && candidate.naturalWidth > 0 ? candidate.naturalWidth : candidate.width;
  const height = "naturalHeight" in candidate && candidate.naturalHeight > 0 ? candidate.naturalHeight : candidate.height;
  return [width, height];
};

export const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
