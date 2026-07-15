import {
  textureAsset,
  virtualTexture,
  type TextureAssetRef,
  type VirtualTextureAssetRef,
} from "@royal/renderer-core";

export type TextureAssetStatusInput = TextureAssetRef | VirtualTextureAssetRef;

/** @internal Validates public texture observation inputs before Canvas availability affects behavior. */
export const validateTextureAssetRef: (
  input: unknown,
  label: string,
) => asserts input is TextureAssetStatusInput = (
  input: unknown,
  label: string,
) => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be a TextureAssetRef or VirtualTextureAssetRef object`);
  }
  const candidate = input as Partial<TextureAssetStatusInput>;
  if (candidate.kind === "asset") {
    const texture = candidate as TextureAssetRef;
    textureAsset({
      ...(texture.colorSpace === undefined ? {} : { colorSpace: texture.colorSpace }),
      ...(texture.contentKey === undefined ? {} : { contentKey: texture.contentKey }),
      ...(texture.sampler === undefined ? {} : { sampler: texture.sampler }),
      src: texture.uri,
      ...(texture.version === undefined ? {} : { version: texture.version }),
    });
    return;
  }
  if (candidate.kind === "virtual-asset") {
    const texture = candidate as VirtualTextureAssetRef;
    virtualTexture({
      ...(texture.colorSpace === undefined ? {} : { colorSpace: texture.colorSpace }),
      ...(texture.contentKey === undefined ? {} : { contentKey: texture.contentKey }),
      manifestUri: texture.manifestUri,
      ...(texture.sampler === undefined ? {} : { sampler: texture.sampler }),
      ...(texture.version === undefined ? {} : { version: texture.version }),
    });
    return;
  }
  throw new TypeError(`${label} kind must be "asset" or "virtual-asset"`);
};

export const textureAssetSemanticKey = (texture: TextureAssetStatusInput): string => JSON.stringify([
  texture.kind,
  texture.kind === "asset" ? texture.uri : texture.manifestUri,
  texture.version ?? null,
  texture.contentKey ?? null,
  texture.colorSpace ?? null,
  texture.sampler?.magFilter ?? null,
  texture.sampler?.minFilter ?? null,
  texture.sampler?.wrapS ?? null,
  texture.sampler?.wrapT ?? null,
]);
