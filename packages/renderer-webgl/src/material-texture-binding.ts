import type {
  SolidTextureRef,
  TextureAssetRef,
  TextureRef,
} from "@royal/renderer-core";
import type { TextureAssetLoadResult, TextureCache } from "./texture-cache";

const defaultAssetFallback = [1, 1, 1, 1] as const;

type MaterialTextureLoadCache = Pick<TextureCache, "loadTextureAssetBaseColor">;

export type MaterialBaseColorBinding =
  | {
    readonly color: SolidTextureRef["color"];
    readonly kind: "solid";
    readonly source: SolidTextureRef;
  }
  | {
    readonly fallbackColor: SolidTextureRef["color"];
    readonly kind: "asset";
    readonly load: TextureAssetLoadResult;
    readonly source: TextureAssetRef;
  };

export const lowerMaterialBaseColorBinding = (
  baseColor: TextureRef,
  options: {
    readonly onTextureSettled?: (() => void) | undefined;
    readonly textureCache: MaterialTextureLoadCache;
  },
): MaterialBaseColorBinding => {
  if (baseColor.kind === "solid") {
    return {
      color: baseColor.color,
      kind: "solid",
      source: baseColor,
    };
  }

  return {
    fallbackColor: baseColor.fallback?.color ?? defaultAssetFallback,
    kind: "asset",
    load: options.textureCache.loadTextureAssetBaseColor(
      baseColor,
      options.onTextureSettled,
    ),
    source: baseColor,
  };
};
