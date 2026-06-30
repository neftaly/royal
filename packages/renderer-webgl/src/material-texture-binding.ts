import {
  defaultTextureFallbackColor,
  type SolidTextureRef,
  type TextureAssetRef,
  type TextureRef,
  type VirtualTextureAssetRef,
} from "@royal/renderer-core";
import type { RendererWebGlContext } from "./gl";
import type { TextureAssetLoadResult, TextureCache } from "./texture-cache";

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
  }
  | {
    readonly fallbackColor: SolidTextureRef["color"];
    readonly kind: "virtual-asset";
    readonly load?: TextureAssetLoadResult | undefined;
    readonly source: VirtualTextureAssetRef;
  };

export type MaterialBaseColorUniforms = {
  readonly baseColor: WebGLUniformLocation;
  readonly color: WebGLUniformLocation;
  readonly useBaseColorTexture: WebGLUniformLocation;
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

  if (baseColor.kind === "virtual-asset") {
    return {
      fallbackColor:
        baseColor.fallback?.color ??
        baseColor.preview?.fallback?.color ??
        defaultTextureFallbackColor,
      kind: "virtual-asset",
      ...(baseColor.preview === undefined
        ? {}
        : {
          load: options.textureCache.loadTextureAssetBaseColor(
            baseColor.preview,
            options.onTextureSettled,
          ),
        }),
      source: baseColor,
    };
  }

  return {
    fallbackColor: baseColor.fallback?.color ?? defaultTextureFallbackColor,
    kind: "asset",
    load: options.textureCache.loadTextureAssetBaseColor(
      baseColor,
      options.onTextureSettled,
    ),
    source: baseColor,
  };
};

export const bindMaterialBaseColor = (
  gl: RendererWebGlContext,
  uniforms: MaterialBaseColorUniforms,
  binding: MaterialBaseColorBinding,
  textureUnit = 0,
): void => {
  const load = binding.kind === "solid" ? undefined : binding.load;
  if (load?.kind === "ready") {
    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, load.texture);
    gl.uniform1i(uniforms.baseColor, textureUnit);
    gl.uniform1i(uniforms.useBaseColorTexture, 1);
    return;
  }

  gl.uniform4fv(
    uniforms.color,
    binding.kind === "solid" ? binding.color : binding.fallbackColor,
  );
  gl.uniform1i(uniforms.useBaseColorTexture, 0);
};
