import type {
  TextureSamplerFilter,
  TextureSamplerWrap,
  VirtualTextureAssetRef,
} from "@royal/renderer-core";
import type { TextureSourceRef } from "./source";

/** Complete sampler semantics shared by ordinary textures, VT, and picking. */
export type CanonicalTextureSampler = Readonly<{
  magFilter: "linear" | "nearest";
  minFilter: TextureSamplerFilter;
  wrapS: TextureSamplerWrap;
  wrapT: TextureSamplerWrap;
}>;

/** Resolves omitted public sampler fields exactly once at the texture boundary. */
export const canonicalTextureSampler = (
  asset: Pick<TextureSourceRef | VirtualTextureAssetRef, "sampler">,
): CanonicalTextureSampler => ({
  magFilter: asset.sampler?.magFilter ?? "linear",
  minFilter: asset.sampler?.minFilter ?? "linear-mipmap-linear",
  wrapS: asset.sampler?.wrapS ?? "clamp-to-edge",
  wrapT: asset.sampler?.wrapT ?? "clamp-to-edge",
});

/** Stable identity for one fully resolved sampler recipe. */
export const canonicalTextureSamplerKey = (
  sampler: CanonicalTextureSampler,
): string => JSON.stringify([
  sampler.magFilter,
  sampler.minFilter,
  sampler.wrapS,
  sampler.wrapT,
]);
